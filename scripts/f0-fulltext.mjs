#!/usr/bin/env node
// F0-T04：探测正文渠道的请求长度上限，并在同一分支点上对比「全部正文」与「当前记忆引擎」。
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_DIRECTOR_CONFIG,
	StoryStore,
	assembleContext,
	createBackgroundJobRegistry,
	createDefaultContextTemplate,
	createEmbeddingClient,
	createLlmClient,
	createStandardChatProviders,
	createSummaryHandler,
	createTokenEstimator,
	drainBackgroundJobs,
	loadChannelsConfig,
	loadDotEnv,
	parseBlocks,
	renderContextView,
	runModelTurns,
} from "../packages/core/dist/index.js";
import {
	buildStoryVectors,
	importChatFileToStore,
} from "../packages/st-compat/dist/index.js";
import {
	JUDGE_ORDERS,
	PROBE_LEVELS,
	buildFiller,
	buildJudgeMessages,
	chooseBranchPoint,
	parseJudgeOutput,
	renderFulltextSection,
	renderTranscript,
	summarizeBranches,
} from "./f0-fulltext-lib.mjs";
import { replaceMarkedSection } from "./f0-pairs.mjs";

const MARKER = "F0-T04";
const MAP_PATH = path.resolve("eval-private", "reports", "f0-corpus-map.json");
const OUT_DIR = path.resolve("eval-private", "f0");
const PROBE_PATH = path.join(OUT_DIR, "fulltext-probe.json");
const BRANCHES_PATH = path.join(OUT_DIR, "fulltext-branches.json");
const GENERATIONS_PATH = path.join(OUT_DIR, "fulltext-generations.jsonl");
const JUDGEMENTS_PATH = path.join(OUT_DIR, "fulltext-judgements.jsonl");
const SUMMARY_PATH = path.join(OUT_DIR, "fulltext-summary.json");
const CACHE_DIR = path.join(OUT_DIR, "llm-cache");
const DB_PATH = path.join(OUT_DIR, "fulltext", "work.db");
const REPORT_PATH = path.resolve("docs", "dev", "reports", "F0.md");
const CHANNELS_PATH = path.resolve("data", "channels.yaml");

const STORY_LABELS = Object.freeze([128, 132, 10, 223]);
const STORY_ID_PREFIX = "f0ft";
const MAX_BRANCH_RAW_TOKENS = 100_000;
const MIN_ASSISTANT_FLOORS = 20;
const CONTEXT_BUDGET = 120_000;
const GENERATION_MAX_TOKENS = 4096;
const GENERATION_TEMPERATURE = 0.8;
const JUDGE_MAX_TOKENS = 1024;
const PROBE_MAX_TOKENS = 64;
const PROBE_TIMEOUT_MS = 180_000;
const MAIN_CALL_LIMIT = 30;
const PROBE_INSTRUCTION = "请只回复 OK。";
const PROBE_SYSTEM = "你是输入长度探测实验的参与者，收到内容后只回复 OK。";

function stageOf() {
	const stage = process.env.DRAMATICER_F0_FULLTEXT_STAGE ?? "all";
	if (!["all", "probe", "generate", "judge", "report"].includes(stage)) {
		throw new Error(
			`DRAMATICER_F0_FULLTEXT_STAGE 只能是 all、probe、generate、judge、report，收到 ${stage}`,
		);
	}
	return stage;
}

function rerun() {
	return process.env.DRAMATICER_F0_FULLTEXT_RERUN === "1";
}

async function readJsonl(file) {
	let raw;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
	return raw
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line, index) => {
			try {
				return JSON.parse(line);
			} catch (cause) {
				throw new Error(`${path.basename(file)} 第 ${index + 1} 行不是合法 JSON`, {
					cause,
				});
			}
		});
}

async function readJson(file) {
	try {
		return JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

function latestByKey(entries, keyOf) {
	const map = new Map();
	for (const entry of entries) map.set(keyOf(entry), entry);
	return map;
}

function isAliasFailure(message) {
	return /entitlement|membership|所有渠道都失败了|model not found|unauthorized/i.test(
		message,
	);
}

function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

function truncate(text, limit) {
	return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

async function runProbeLevel({ config, alias, level, estimator, now }) {
	const client = createLlmClient(config, {
		defaultModel: alias,
		cacheDir: null,
	});
	const filler = buildFiller(level, estimator);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	const startedAt = now();
	let firstTokenMs = null;
	try {
		const stream = client.stream(
			{
				model: alias,
				messages: [
					{ role: "system", content: PROBE_SYSTEM },
					{ role: "user", content: `${filler}\n\n${PROBE_INSTRUCTION}` },
				],
				maxTokens: PROBE_MAX_TOKENS,
				temperature: 0,
				reasoning: "off",
				signal: controller.signal,
			},
			{ continuation: { maxRounds: 0 } },
		);
		for await (const event of stream) {
			if (event.type === "text_delta" && firstTokenMs === null) {
				firstTokenMs = now() - startedAt;
			}
		}
		const result = await stream.result();
		const durationMs = now() - startedAt;
		const estimatedTokens = estimator(
			`${PROBE_SYSTEM}\n${filler}\n\n${PROBE_INSTRUCTION}`,
		);
		const notes = [];
		if (result.stopReason === "length") notes.push("输出达到上限");
		const inputTokens =
			result.usage.promptTokens === null
				? null
				: result.usage.promptTokens + (result.usage.cachedTokens ?? 0);
		if (inputTokens !== null && inputTokens < estimatedTokens * 0.8) {
			notes.push("报告的输入 token 明显少于估算，疑似输入被截断");
		}
		if (result.text.trim().length === 0) notes.push("没有正文");
		return {
			level,
			estimatedTokens,
			modelAlias: alias,
			ok: result.stopReason !== "error" && result.stopReason !== "aborted",
			promptTokens: result.usage.promptTokens,
			cachedTokens: result.usage.cachedTokens,
			inputTokens,
			completionTokens: result.usage.completionTokens,
			firstTokenMs,
			durationMs,
			stopReason: result.stopReason,
			finishReason: result.finishReason,
			note: notes.length === 0 ? "—" : notes.join("；"),
			error: null,
		};
	} catch (error) {
		const estimatedTokens = estimator(
			`${PROBE_SYSTEM}\n${filler}\n\n${PROBE_INSTRUCTION}`,
		);
		const message = describeError(error);
		return {
			level,
			estimatedTokens,
			modelAlias: alias,
			ok: false,
			promptTokens: null,
			cachedTokens: null,
			inputTokens: null,
			completionTokens: null,
			firstTokenMs,
			durationMs: now() - startedAt,
			stopReason: "error",
			finishReason: null,
			note: controller.signal.aborted
				? `${PROBE_TIMEOUT_MS / 1000} 秒内没有完成`
				: truncate(message, 180),
			error: message,
		};
	} finally {
		clearTimeout(timer);
	}
}

function concludeProbe(entries, alias) {
	const retained = entries.filter((entry) => entry.modelAlias === alias);
	const ladder = retained.length === 0 ? entries : retained;
	const successes = ladder.filter((entry) => entry.ok);
	const largestSuccess = successes.reduce(
		(best, entry) => (entry.level > best.level ? entry : best),
		successes[0] ?? null,
	);
	const firstFailure = ladder.find((entry) => !entry.ok);
	if (successes.length === 0) {
		return "所有探测级别都没有被接受，无法确定上限。";
	}
	const reported =
		largestSuccess.inputTokens === null
			? "渠道没有报告输入 token"
			: `渠道报告输入 ${largestSuccess.inputTokens} token`;
	if (firstFailure === undefined) {
		return `所有探测级别都被接受；最高级别按估算为 ${largestSuccess.level} token（${reported}），没有探测到上限。`;
	}
	return `最大被接受的级别按估算为 ${largestSuccess.level} token（${reported}）；第一次失败在 ${firstFailure.level}（${firstFailure.note}）。`;
}

async function runProbeStage(config) {
	const existing = await readJson(PROBE_PATH);
	if (existing !== null && !rerun()) {
		return existing;
	}
	const estimator = createTokenEstimator();
	const now = Date.now;
	const entries = [];
	const first = await runProbeLevel({
		config,
		alias: "main",
		level: PROBE_LEVELS[0],
		estimator,
		now,
	});
	entries.push(first);
	let alias = "main";
	if (!first.ok && isAliasFailure(first.error ?? "")) {
		alias = "main-fallback";
		entries.push(
			await runProbeLevel({
				config,
				alias,
				level: PROBE_LEVELS[0],
				estimator,
				now,
			}),
		);
		const retried = entries[entries.length - 1];
		if (!retried.ok) {
			throw new Error(
				`正文渠道 ${alias} 在最小探测级别也失败：${retried.note}`,
			);
		}
	}
	for (const level of PROBE_LEVELS.slice(1)) {
		entries.push(
			await runProbeLevel({ config, alias, level, estimator, now }),
		);
	}
	const probe = {
		generatedAt: new Date().toISOString(),
		modelAlias: alias,
		contextWindow: config.models.get(alias)?.contextWindow ?? null,
		switchedFrom: alias === "main" ? null : "main",
		previousCalls:
			(existing?.previousCalls ?? 0) + (existing?.entries.length ?? 0),
		entries,
		conclusion: concludeProbe(entries, alias),
	};
	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(PROBE_PATH, `${JSON.stringify(probe, null, 2)}\n`);
	return probe;
}

function branchDescriptors(store, storyId, estimator) {
	const pathNodes = store.getPathToNode(store.getHead(storyId).id);
	let rawTokens = 0;
	let viewTokens = 0;
	let assistantBefore = 0;
	return pathNodes.map((node, index) => {
		if (node.role === "assistant") assistantBefore += 1;
		rawTokens += estimator(node.raw);
		const view = renderContextView(parseBlocks(node.raw), {
			depth: pathNodes.length - 1 - index,
		});
		viewTokens += estimator(view);
		return {
			id: node.id,
			role: node.role,
			rawTokens,
			viewTokens,
			assistantBefore:
				node.role === "assistant" ? assistantBefore - 1 : assistantBefore,
			index,
		};
	});
}

async function ensureStory({ store, map, label }) {
	const storyId = `${STORY_ID_PREFIX}-${label}`;
	const existing = store.getStory(storyId);
	if (existing !== null) return { storyId, imported: false };
	const entry = map.chats.find((item) => item.label === `对话 ${label}`);
	if (entry === undefined) {
		throw new Error(`语料映射里没有对话 ${label}`);
	}
	await importChatFileToStore(store, entry.path, {
		storyId,
		idPrefix: storyId,
	});
	return { storyId, imported: true };
}

async function ensureVectors({ store, storyId, embedder, log }) {
	if (embedder === null) return null;
	const result = await buildStoryVectors({ store, storyId, embedder });
	log(
		`对话 ${storyId} 的向量：${result.vectorCount}/${result.chunkCount} 个块已有向量`,
	);
	return result;
}

async function ensureSummaries({ store, storyId, config, log }) {
	const summaryRegistry = createBackgroundJobRegistry({
		summary: createSummaryHandler(),
	});
	let alias = "background";
	let client = createLlmClient(config, {
		defaultModel: alias,
		cacheDir: CACHE_DIR,
	});
	let result = await drainBackgroundJobs({
		store,
		registry: summaryRegistry,
		client,
		storyId,
		kinds: ["summary"],
		limit: 1000,
	});
	let failed = result.runs.filter((run) => run.status !== "done");
	if (failed.length > 0 && failed.some((run) => isAliasFailure(run.error ?? ""))) {
		alias = "bg-fallback";
		client = createLlmClient(config, {
			defaultModel: alias,
			cacheDir: CACHE_DIR,
		});
		result = await drainBackgroundJobs({
			store,
			registry: summaryRegistry,
			client,
			storyId,
			kinds: ["summary"],
			limit: 1000,
		});
		failed = result.runs.filter((run) => run.status !== "done");
	}
	if (failed.length > 0) {
		log(
			`对话 ${storyId} 的摘要任务有 ${failed.length} 条未完成：${truncate(
				failed[0]?.error ?? "未知错误",
				160,
			)}`,
		);
	}
	return { alias, failed: failed.length };
}

function fulltextTemplate() {
	const base = createDefaultContextTemplate({ structuredOutput: "text-tags" });
	const protocol = base.segments.find((segment) => segment.kind === "static");
	if (protocol === undefined) {
		throw new Error("默认模板里没有协议段");
	}
	return {
		id: "f0-fulltext",
		segments: [
			{ ...protocol, priority: 95 },
			{ id: "history", kind: "slot", slot: "history", priority: 100 },
		],
	};
}

function fulltextProvider(store) {
	return {
		provide(request) {
			if (request.nodeId === null) return null;
			const nodes = store.getPathToNode(request.nodeId);
			const messages = [];
			let skipped = 0;
			for (const node of nodes) {
				if (node.raw.trim().length === 0) {
					skipped += 1;
					continue;
				}
				messages.push({ role: node.role, content: node.raw });
			}
			if (messages.length === 0) return null;
			return {
				messages,
				source: `fulltext:${messages.length} 楼${skipped === 0 ? "" : `，跳过空楼 ${skipped}`}`,
			};
		},
	};
}

function transcriptText(store, nodeId) {
	const nodes = store.getPathToNode(nodeId);
	return renderTranscript(
		nodes
			.filter((node) => node.raw.trim().length > 0)
			.map((node) => ({
				role: node.role,
				text: node.raw,
			})),
	);
}

async function generateArm({
	store,
	storyId,
	branchNodeId,
	arm,
	client,
	alias,
	template,
	providers,
	now,
}) {
	const assembled = await assembleContext({
		template,
		budgetTokens: CONTEXT_BUDGET,
		storyId,
		nodeId: branchNodeId,
		providers,
	});
	const turn = await runModelTurns({
		client,
		messages: assembled.messages,
		toolContext: {
			store,
			storyId,
			beforeNodeId: branchNodeId,
			embedder: null,
			viewpoint: null,
		},
		maxToolRounds: 0,
		model: alias,
		maxTokens: GENERATION_MAX_TOKENS,
		temperature: GENERATION_TEMPERATURE,
		reasoning: "low",
		continuation: { maxRounds: 0 },
		now,
	});
	return {
		arm,
		text: turn.result.text,
		promptTokens: turn.usage.promptTokens,
		completionTokens: turn.usage.completionTokens,
		reasoningTokens: turn.usage.reasoningTokens,
		assembledTokens: assembled.trace.totalTokens,
		segments: assembled.trace.entries
			.filter((entry) => entry.status === "included")
			.map((entry) => ({
				segment: entry.segmentId,
				source: entry.source,
				tokens: entry.tokens,
			})),
		firstTokenMs: turn.firstTokenMs,
		stopReason: turn.result.stopReason,
		finishReason: turn.result.finishReason,
		attempts: turn.attempts,
	};
}

async function runGenerateStage(config, probe, log) {
	const map = JSON.parse(await readFile(MAP_PATH, "utf8"));
	const estimator = createTokenEstimator();
	const now = Date.now;
	await mkdir(path.dirname(DB_PATH), { recursive: true });
	const embeddingDimensions = config.embeddings.get("default")?.dimensions ?? 1024;
	const embedder = config.embeddings.has("default")
		? createEmbeddingClient(config)
		: null;
	const store = StoryStore.open(DB_PATH, { embeddingDimensions });
	try {
		const existingGenerations = await readJsonl(GENERATIONS_PATH);
		const byKey = latestByKey(
			existingGenerations,
			(entry) => `${entry.label}|${entry.arm}`,
		);
		const branches = [];
		const mainClient = createLlmClient(config, {
			defaultModel: probe.modelAlias,
			cacheDir: null,
		});
		const template = fulltextTemplate();
		let mainCalls = probe.entries.length + byKey.size;
		for (const label of STORY_LABELS) {
			const { storyId } = await ensureStory({ store, map, label });
			await ensureVectors({ store, storyId, embedder, log });
			const summaryResult = await ensureSummaries({
				store,
				storyId,
				config,
				log,
			});
			const descriptors = branchDescriptors(store, storyId, estimator);
			let chosen;
			try {
				chosen = chooseBranchPoint(descriptors, {
					maxRawTokens: MAX_BRANCH_RAW_TOKENS,
					minAssistantFloors: MIN_ASSISTANT_FLOORS,
				});
			} catch (error) {
				throw new Error(`对话 ${label} 没有可用的分支点：${describeError(error)}`);
			}
			const branch = {
				label: String(label),
				storyId,
				branchNodeId: chosen.node.id,
				index: chosen.index,
				priorFloors: chosen.index + 1,
				assistantFloors: chosen.node.assistantBefore,
				rawTokens: chosen.node.rawTokens,
				viewTokens: chosen.node.viewTokens,
				summaryCount: store.getValidSummaries(storyId, chosen.node.id).length,
				stateDiffCount: store.countStateDiffsAlongPath(chosen.node.id),
				summaryAlias: summaryResult.alias,
				summaryFailures: summaryResult.failed,
			};
			branches.push(branch);
			log(
				`对话 ${label}：分支点第 ${branch.priorFloors} 楼，原文 ${branch.rawTokens} token（不含标签 ${branch.viewTokens}），摘要 ${branch.summaryCount} 条，状态 diff ${branch.stateDiffCount} 条`,
			);
			for (const arm of ["full", "memory"]) {
				const key = `${label}|${arm}`;
				const previous = byKey.get(key);
				const needsRun =
					previous === undefined ||
					rerun() ||
					previous.stopReason === "length" ||
					previous.stopReason === "error" ||
					typeof previous.text !== "string" ||
					previous.text.trim().length === 0;
				if (!needsRun) continue;
				if (mainCalls >= MAIN_CALL_LIMIT) {
					throw new Error(`正文渠道调用已达到上限 ${MAIN_CALL_LIMIT}`);
				}
				let providers;
				let armTemplate;
				if (arm === "full") {
					armTemplate = template;
					providers = { history: fulltextProvider(store) };
				} else {
					armTemplate = createDefaultContextTemplate({
						structuredOutput: "text-tags",
					});
					providers = createStandardChatProviders({
						store,
						characterPrompt: null,
						embedder,
						directorConfig: {
							...DEFAULT_DIRECTOR_CONFIG,
							enabled: false,
						},
					});
				}
				const generated = await generateArm({
					store,
					storyId,
					branchNodeId: chosen.node.id,
					arm,
					client: mainClient,
					alias: probe.modelAlias,
					template: armTemplate,
					providers,
					now,
				});
				mainCalls += 1;
				const record = {
					key,
					label: String(label),
					storyId,
					branchNodeId: chosen.node.id,
					arm,
					modelAlias: probe.modelAlias,
					promptTokens: generated.promptTokens,
					completionTokens: generated.completionTokens,
					reasoningTokens: generated.reasoningTokens,
					assembledTokens: generated.assembledTokens,
					segments: generated.segments,
					firstTokenMs: generated.firstTokenMs,
					stopReason: generated.stopReason,
					finishReason: generated.finishReason,
					maxTokens: GENERATION_MAX_TOKENS,
					attempts: generated.attempts,
					createdAt: new Date().toISOString(),
					text: generated.text,
				};
				await appendFile(
					GENERATIONS_PATH,
					`${JSON.stringify(record)}\n`,
				);
				byKey.set(key, record);
				log(
					`对话 ${label} 的${arm === "full" ? "全文" : "记忆引擎"}组：输入 ${record.promptTokens ?? "—"} token，首字 ${record.firstTokenMs ?? "—"} 毫秒，输出 ${record.completionTokens ?? "—"} token，结束原因 ${record.stopReason}`,
				);
			}
		}
		const payload = {
			generatedAt: new Date().toISOString(),
			modelAlias: probe.modelAlias,
			branches,
		};
		await writeFile(BRANCHES_PATH, `${JSON.stringify(payload, null, 2)}\n`);
		return { branches };
	} finally {
		store.close();
	}
}

async function judgeOnce({ config, alias, messages, log }) {
	const client = createLlmClient(config, {
		defaultModel: alias,
		cacheDir: null,
	});
	try {
		const result = await client.complete(
			{
				model: alias,
				messages,
				maxTokens: JUDGE_MAX_TOKENS,
				temperature: 0,
				reasoning: "off",
			},
			{ continuation: { maxRounds: 0 } },
		);
		const parsed = parseJudgeOutput(result.text);
		return { ok: true, ...parsed, error: null };
	} catch (error) {
		const message = describeError(error);
		log(`裁判调用或输出失败：${truncate(message, 160)}`);
		return { ok: false, choice: null, confidence: null, error: message };
	}
}

async function runJudgeStage(config, branchPayload, log) {
	const generations = latestByKey(
		await readJsonl(GENERATIONS_PATH),
		(entry) => `${entry.label}|${entry.arm}`,
	);
	const judgements = latestByKey(
		await readJsonl(JUDGEMENTS_PATH),
		(entry) => `${entry.label}|${entry.order}`,
	);
	const preferredAlias = branchPayload.branches.some(
		(branch) => branch.summaryAlias === "bg-fallback",
	)
		? "bg-fallback"
		: "background";
	const store = StoryStore.open(DB_PATH, {
		embeddingDimensions: config.embeddings.get("default")?.dimensions ?? 1024,
	});
	try {
		for (const branch of branchPayload.branches) {
			const full = generations.get(`${branch.label}|full`);
			const memory = generations.get(`${branch.label}|memory`);
			if (full === undefined || memory === undefined) {
				log(`对话 ${branch.label} 缺少一组生成结果，跳过裁判`);
				continue;
			}
			const transcript = transcriptText(store, branch.branchNodeId);
			for (const order of JUDGE_ORDERS) {
				const key = `${branch.label}|${order}`;
				if (judgements.has(key) && !rerun()) continue;
				const built = buildJudgeMessages({
					transcript,
					fullText: full.text,
					memoryText: memory.text,
					order,
				});
				let alias = preferredAlias;
				let outcome = await judgeOnce({
					config,
					alias,
					messages: built.messages,
					log,
				});
				if (!outcome.ok && isAliasFailure(outcome.error ?? "")) {
					alias = preferredAlias === "background" ? "bg-fallback" : "background";
					outcome = await judgeOnce({
						config,
						alias,
						messages: built.messages,
						log,
					});
				}
				const record = {
					key,
					label: branch.label,
					order,
					modelAlias: alias,
					ok: outcome.ok,
					choice: outcome.choice,
					confidence: outcome.confidence,
					error: outcome.error,
					createdAt: new Date().toISOString(),
				};
				await appendFile(JUDGEMENTS_PATH, `${JSON.stringify(record)}\n`);
				judgements.set(key, record);
				log(
					`对话 ${branch.label} 的裁判（${order}）：${
						outcome.ok ? `${outcome.choice}，置信度 ${outcome.confidence}` : "失败"
					}`,
				);
			}
		}
	} finally {
		store.close();
	}
}

async function runReportStage(config, probe, branchPayload) {
	const allGenerations = await readJsonl(GENERATIONS_PATH);
	const labels = new Set(branchPayload.branches.map((branch) => branch.label));
	const generations = [...latestByKey(
		allGenerations.filter((entry) => labels.has(entry.label)),
		(entry) => `${entry.label}|${entry.arm}`,
	).values()];
	const judgements = [...latestByKey(
		await readJsonl(JUDGEMENTS_PATH),
		(entry) => `${entry.label}|${entry.order}`,
	).values()];
	const reportProbe = {
		...probe,
		contextWindow:
			probe.contextWindow ??
			config.models.get(probe.modelAlias)?.contextWindow ??
			null,
		conclusion: concludeProbe(probe.entries, probe.modelAlias),
	};
	const section = renderFulltextSection({
		generatedAt: new Date().toISOString(),
		probe: reportProbe,
		branches: branchPayload.branches,
		generations,
		judgements,
		callCounts: {
			main:
				probe.entries.length +
				(probe.previousCalls ?? 0) +
				allGenerations.length,
			judge: judgements.length,
			discarded: allGenerations.length - generations.length,
		},
	});
	const existing = await readFile(REPORT_PATH, "utf8");
	const next = replaceMarkedSection(existing, section, MARKER);
	await writeFile(REPORT_PATH, next);
	await writeFile(
		SUMMARY_PATH,
		`${JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				probe,
				branches: branchPayload.branches,
				generations,
				judgements,
				judgeSummary: summarizeBranches(
					branchPayload.branches,
					judgements,
				),
			},
			null,
			2,
		)}\n`,
	);
	return section;
}

async function main() {
	const stage = stageOf();
	const log = (message) => {
		process.stderr.write(`${message}\n`);
	};
	loadDotEnv(path.resolve(".env"));
	const config = await loadChannelsConfig(CHANNELS_PATH);
	await mkdir(OUT_DIR, { recursive: true });
	let probe = await readJson(PROBE_PATH);
	if ((stage === "all" || stage === "probe") && (probe === null || rerun())) {
		probe = await runProbeStage(config);
	}
	if (stage === "report") {
		if (probe === null) throw new Error("缺少上限探测结果，先运行 probe 阶段");
		const branchPayload = await readJson(BRANCHES_PATH);
		if (branchPayload === null) throw new Error("缺少分支点结果");
		const section = await runReportStage(config, probe, branchPayload);
		log(`报告已更新，章节长度 ${section.length}`);
		return;
	}
	if (probe === null) throw new Error("缺少上限探测结果，先运行 probe 阶段");
	if (stage === "all" || stage === "generate") {
		const branchPayload = await runGenerateStage(config, probe, log);
		if (stage === "all") {
			await runJudgeStage(config, branchPayload, log);
			await runReportStage(config, probe, branchPayload);
		}
		return;
	}
	if (stage === "judge") {
		const branchPayload = await readJson(BRANCHES_PATH);
		if (branchPayload === null) throw new Error("缺少分支点结果");
		await runJudgeStage(config, branchPayload, log);
		await runReportStage(config, probe, branchPayload);
	}
}

try {
	await main();
} catch (error) {
	console.error(describeError(error));
	process.exitCode = 1;
}

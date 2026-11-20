#!/usr/bin/env node
// F0-T03：把「被放弃 / 被保留」的回复对隐去标签，以两种顺序交给裁判模型，统计校准指标。
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
} from "../../packages/core/dist/index.js";
import {
	JUDGE_ORDERS,
	buildChoiceMessages,
	countDuplicatePrompts,
	parseChoice,
	picksAccepted,
	renderJudgeSection,
	summarizeJudge,
} from "./f0-judge-lib.mjs";
import { replaceMarkedSection, sampleStratified } from "./f0-pairs.mjs";

const MARKER = "F0-T03";
const OUT_DIR = path.resolve("eval-private", "f0");
const PAIRS_PATH = path.join(OUT_DIR, "pairs.jsonl");
const ATTRIBUTION_PATH = path.join(OUT_DIR, "attribution.jsonl");
const RESULTS_PATH = path.join(OUT_DIR, "judge.jsonl");
const SUMMARY_PATH = path.join(OUT_DIR, "judge-summary.json");
const CACHE_DIR = path.join(OUT_DIR, "llm-cache");
const REPORT_PATH = path.resolve("docs", "dev", "reports", "F0.md");
const CHANNELS_PATH = path.resolve("data", "channels.yaml");
const MODEL_ALIAS = "background";
const SAMPLE_SEED = "f0-t03-v1";
const SAMPLE_TARGETS = Object.freeze({
	"1–10 楼": 70,
	"11–50 楼": 60,
	"51 楼以上": 70,
});

function readPositiveInt(name, fallback) {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} 必须是正整数，收到 ${raw}`);
	}
	return value;
}

async function readJsonl(file, onEntry) {
	let raw;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
	raw.split("\n").forEach((line, index) => {
		if (line.trim() === "") return;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch (cause) {
			throw new Error(`${path.basename(file)} 第 ${index + 1} 行不是合法 JSON`, {
				cause,
			});
		}
		onEntry(entry, index);
	});
	return true;
}

async function readPairs() {
	const pairs = [];
	await readJsonl(PAIRS_PATH, (entry, index) => {
		if (typeof entry?.id !== "string") {
			throw new Error(`pairs.jsonl 第 ${index + 1} 行缺少 id`);
		}
		pairs.push(entry);
	});
	return pairs;
}

async function readAttribution() {
	const byPair = new Map();
	await readJsonl(ATTRIBUTION_PATH, (entry, index) => {
		if (typeof entry?.pair !== "string") {
			throw new Error(`attribution.jsonl 第 ${index + 1} 行缺少 pair`);
		}
		if (entry.ok === true) byPair.set(entry.pair, entry);
	});
	return byPair;
}

async function readResults() {
	const byKey = new Map();
	await readJsonl(RESULTS_PATH, (entry, index) => {
		if (typeof entry?.key !== "string") {
			throw new Error(`judge.jsonl 第 ${index + 1} 行缺少 key`);
		}
		byKey.set(entry.key, entry);
	});
	return byKey;
}

async function runPool(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;
	async function lane() {
		while (true) {
			const index = next;
			next += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	}
	const lanes = Array.from({ length: Math.min(limit, items.length) }, () =>
		lane(),
	);
	await Promise.all(lanes);
	return results;
}

function addUsage(total, usage) {
	return {
		promptTokens:
			total.promptTokens +
			(typeof usage?.promptTokens === "number" ? usage.promptTokens : 0),
		completionTokens:
			total.completionTokens +
			(typeof usage?.completionTokens === "number"
				? usage.completionTokens
				: 0),
		reasoningTokens:
			total.reasoningTokens +
			(typeof usage?.reasoningTokens === "number"
				? usage.reasoningTokens
				: 0),
	};
}

function zeroUsage() {
	return { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
}

async function main() {
	const concurrency = readPositiveInt("DRAMATICER_F0_JUDGE_CONCURRENCY", 4);
	const maxTokens = readPositiveInt("DRAMATICER_F0_JUDGE_MAX_TOKENS", 2_048);

	loadDotEnv(path.resolve(".env"));
	const modelOverride = (process.env.DRAMATICER_F0_JUDGE_MODEL ?? "").trim();
	const rerun = process.env.DRAMATICER_F0_JUDGE_RERUN === "1";
	const configured = await loadChannelsConfig(CHANNELS_PATH);
	const configuredModel = configured.models.get(MODEL_ALIAS);
	if (configuredModel === undefined) {
		throw new Error(`channels.yaml 里没有模型 ${MODEL_ALIAS}`);
	}
	const model =
		modelOverride === ""
			? configuredModel
			: { ...configuredModel, id: modelOverride };
	const channels =
		modelOverride === ""
			? configured
			: {
					...configured,
					models: new Map(configured.models).set(MODEL_ALIAS, model),
				};
	const client = createLlmClient(channels, {
		defaultModel: MODEL_ALIAS,
		cacheDir: CACHE_DIR,
	});
	// 失败过的判断要真的重新请求：缓存里留着不合法输出，命中缓存只会得到同样结果。
	const retryClient = createLlmClient(channels, {
		defaultModel: MODEL_ALIAS,
		cacheDir: null,
	});

	const pairs = await readPairs();
	const attributionByPair = await readAttribution();
	const eligible = pairs.filter((pair) => attributionByPair.has(pair.id));
	const { picked, stats: sampleStats } = sampleStratified(
		eligible,
		SAMPLE_TARGETS,
		SAMPLE_SEED,
	);
	console.error(
		`抽样：从 ${eligible.length} 个已归因配对里取 ${picked.length} 对；按层 ${sampleStats
			.map((item) => `${item.label} ${item.picked}/${item.target}`)
			.join("、")}`,
	);

	const jobs = picked.flatMap((pair) =>
		JUDGE_ORDERS.map((order) => ({
			pair,
			order,
			key: `${pair.id}|${order}`,
		})),
	);
	const existing = await readResults();
	const pending = rerun
		? jobs
		: jobs.filter((job) => existing.get(job.key)?.ok !== true);
	console.error(`判断：共 ${jobs.length} 次，已有 ${jobs.length - pending.length} 次，本次 ${pending.length} 次`);

	await mkdir(OUT_DIR, { recursive: true });
	let appendChain = Promise.resolve();
	function persist(entry) {
		appendChain = appendChain.then(() =>
			appendFile(RESULTS_PATH, `${JSON.stringify(entry)}\n`, "utf8"),
		);
		return appendChain;
	}

	const runStats = {
		calls: 0,
		cacheHits: 0,
		requests: 0,
		retries: 0,
		usage: zeroUsage(),
	};
	let completed = 0;
	await runPool(pending, concurrency, async (job) => {
		runStats.calls += 1;
		let entry;
		try {
			const { messages } = buildChoiceMessages(job.pair, job.order);
			const activeClient =
				existing.get(job.key)?.ok === false ? retryClient : client;
			const request = (tokens) =>
				activeClient.complete({
					messages,
					model: MODEL_ALIAS,
					temperature: 0,
					maxTokens: tokens,
					reasoning: "low",
				});
			let response = await request(maxTokens);
			if (response.cached) runStats.cacheHits += 1;
			else runStats.requests += response.attempts;
			let usage = addUsage(zeroUsage(), response.usage);
			let retried = false;
			if (response.stopReason === "length" || response.text.trim() === "") {
				retried = true;
				runStats.retries += 1;
				response = await request(Math.max(maxTokens, 4096));
				if (response.cached) runStats.cacheHits += 1;
				else runStats.requests += response.attempts;
				usage = addUsage(usage, response.usage);
			}
			runStats.usage = addUsage(runStats.usage, usage);
			const { choice, confidence } = parseChoice(response.text);
			entry = {
				key: job.key,
				pair: job.pair.id,
				order: job.order,
				ok: true,
				choice,
				confidence,
				picksAccepted: picksAccepted(job.order, choice),
				retried,
				cached: response.cached,
				attempts: response.attempts,
				model: response.model,
				channel: response.channel,
				usage,
				at: new Date().toISOString(),
			};
		} catch (error) {
			entry = {
				key: job.key,
				pair: job.pair.id,
				order: job.order,
				ok: false,
				error: String(error?.message ?? error).slice(0, 500),
				at: new Date().toISOString(),
			};
		} finally {
			completed += 1;
			if (completed % 20 === 0 || completed === pending.length) {
				console.error(`裁判进度 ${completed}/${pending.length}`);
			}
		}
		await persist(entry);
	});
	await appendChain;

	const merged = new Map(existing);
	await readJsonl(RESULTS_PATH, (entry) => merged.set(entry.key, entry));
	const selectedResults = jobs
		.map((job) => merged.get(job.key))
		.filter((entry) => entry !== undefined);
	const summary = summarizeJudge(picked, selectedResults, attributionByPair);
	const okEntries = selectedResults.filter((entry) => entry.ok === true);
	if (okEntries.length === 0) {
		throw new Error("没有任何成功的裁判结果，不写报告");
	}
	const usage = okEntries.reduce(
		(total, entry) => addUsage(total, entry.usage),
		zeroUsage(),
	);
	const cost = {
		requests: okEntries.reduce(
			(total, entry) =>
				total + (entry.cached === true ? 0 : Number(entry.attempts) || 0),
			0,
		),
		cacheHits: okEntries.filter((entry) => entry.cached === true).length,
		retries: okEntries.filter((entry) => entry.retried === true).length,
		usage,
	};
	const routeNote =
		modelOverride === ""
			? null
			: `裁判请求发往 magpie 的 \`${modelOverride}\`（DeepSeek V4.1 Flash 的 routing group）。配置里的 \`${configuredModel.id}\` 在 2026-11-07 返回上游 membership entitlement 错误，本次全部判断改用同一模型的路由组；\`eval-private/f0/judge.jsonl\` 里旧的判断被同键的新行覆盖。`;
	const duplicatePrompts = countDuplicatePrompts(picked);
	const generatedAt = new Date().toISOString();
	const result = {
		generatedAt,
		model: model.id,
		sampleTargets: sampleStats,
		availablePairs: eligible.length,
		selectedPairs: picked.length,
		judgements: summary.judgements,
		perOrder: summary.perOrder,
		consistency: summary.consistency,
		confidence: summary.confidence,
		groups: summary.groups,
		thresholds: summary.thresholds,
		failedJudgements: selectedResults.length - okEntries.length,
		cost: { ...cost, thisRun: runStats },
		routeNote,
		duplicatePrompts,
	};
	await writeFile(SUMMARY_PATH, `${JSON.stringify(result, null, "\t")}\n`, "utf8");

	const section = renderJudgeSection({
		summary,
		meta: {
			generatedAt,
			modelId: model.id,
			availablePairs: eligible.length,
			selectedPairs: picked.length,
			sampleStats,
			cost,
			routeNote,
			duplicatePrompts,
			failedJudgements: selectedResults.length - okEntries.length,
		},
	});
	let report;
	try {
		report = await readFile(REPORT_PATH, "utf8");
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		throw new Error("docs/dev/reports/F0.md 不存在，判定门槛必须先写入报告");
	}
	await writeFile(REPORT_PATH, replaceMarkedSection(report, section, MARKER), "utf8");

	console.log(
		JSON.stringify({
			pairs: summary.pairs,
			judgements: summary.judgements.judgements,
			agreement: summary.judgements.agreement,
			positionDeviation: summary.judgements.positionDeviation,
			passed: summary.thresholds.passed,
			thisRunCalls: runStats.calls,
			cacheHits: runStats.cacheHits,
			failed: result.failedJudgements,
			report: path.relative(process.cwd(), REPORT_PATH),
		}),
	);
}

await main();

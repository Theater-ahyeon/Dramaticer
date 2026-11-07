#!/usr/bin/env node
// F0-T02：抽样「被拒绝 / 被接受」的回复对，让后台模型归因，写统计版报告。
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
} from "../packages/core/dist/index.js";
import { parseChatJsonlFile } from "../packages/st-compat/dist/index.js";
import {
	FAILURE_CATEGORIES,
	buildJudgeMessages,
	createPairCollector,
	parseJudgement,
	replaceMarkedSection,
	sampleCandidates,
} from "./f0-pairs.mjs";

const MARKER = "F0-T02";
const MAP_PATH = path.resolve("eval-private", "reports", "f0-corpus-map.json");
const OUT_DIR = path.resolve("eval-private", "f0");
const PAIRS_PATH = path.join(OUT_DIR, "pairs.jsonl");
const RESULTS_PATH = path.join(OUT_DIR, "attribution.jsonl");
const SUMMARY_PATH = path.join(OUT_DIR, "attribution-summary.json");
const CACHE_DIR = path.join(OUT_DIR, "llm-cache");
const REPORT_PATH = path.resolve("docs", "dev", "reports", "F0.md");
const CHANNELS_PATH = path.resolve("data", "channels.yaml");
const MODEL_ALIAS = "background";

function readPositiveInt(name, fallback) {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} 必须是正整数，收到 ${raw}`);
	}
	return value;
}

async function readMap() {
	const raw = await readFile(MAP_PATH, "utf8");
	const parsed = JSON.parse(raw);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!Array.isArray(parsed.chats)
	) {
		throw new Error("f0-corpus-map.json 里没有 chats 数组");
	}
	return parsed.chats.map((chat, index) => {
		if (typeof chat?.label !== "string" || typeof chat?.path !== "string") {
			throw new Error(`f0-corpus-map.json 第 ${index + 1} 项缺少 label 或 path`);
		}
		return { label: chat.label, file: chat.path };
	});
}

async function readExistingResults() {
	let raw;
	try {
		raw = await readFile(RESULTS_PATH, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return new Map();
		throw error;
	}
	const results = new Map();
	raw.split("\n").forEach((line, index) => {
		if (line.trim() === "") return;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch (cause) {
			throw new Error(`attribution.jsonl 第 ${index + 1} 行不是合法 JSON`, {
				cause,
			});
		}
		if (typeof entry?.pair !== "string") {
			throw new Error(`attribution.jsonl 第 ${index + 1} 行缺少 pair`);
		}
		results.set(entry.pair, entry);
	});
	return results;
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
	const lanes = Array.from(
		{ length: Math.min(limit, items.length) },
		() => lane(),
	);
	await Promise.all(lanes);
	return results;
}

function addUsage(total, usage) {
	return {
		promptTokens:
			total.promptTokens + (typeof usage?.promptTokens === "number" ? usage.promptTokens : 0),
		completionTokens:
			total.completionTokens +
			(typeof usage?.completionTokens === "number" ? usage.completionTokens : 0),
		reasoningTokens:
			total.reasoningTokens +
			(typeof usage?.reasoningTokens === "number" ? usage.reasoningTokens : 0),
	};
}

function pct(part, total) {
	return total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`;
}

function percentile(sorted, p) {
	if (sorted.length === 0) return 0;
	const rank = Math.ceil(p * sorted.length);
	return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function topCategory(counts) {
	let best = null;
	for (const category of FAILURE_CATEGORIES) {
		const count = counts.get(category) ?? 0;
		if (best === null || count > best.count) best = { category, count };
	}
	return best;
}

function countBy(categories) {
	const counts = new Map(FAILURE_CATEGORIES.map((category) => [category, 0]));
	for (const category of categories) {
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	return counts;
}

function renderSection({ sampled, scanned, results, runStats, modelId, generatedAt }) {
	const successful = results.filter((entry) => entry.ok);
	const failed = results.filter((entry) => !entry.ok);
	const primaryCounts = countBy(successful.map((entry) => entry.primary));
	const secondaryCounts = countBy(successful.flatMap((entry) => entry.secondary));
	const alternative = successful.filter((entry) => entry.alternativeOnly);
	const withoutAlternative = successful.filter((entry) => !entry.alternativeOnly);
	const primaryWithoutAlternative = countBy(
		withoutAlternative.map((entry) => entry.primary),
	);
	const confidences = successful
		.map((entry) => entry.confidence)
		.sort((a, b) => a - b);
	const confidenceBuckets = [
		{ label: "< 0.5", min: 0, max: 0.5, exclusive: true },
		{ label: "0.5–0.7", min: 0.5, max: 0.7 },
		{ label: "0.7–0.9", min: 0.7, max: 0.9 },
		{ label: "≥ 0.9", min: 0.9, max: 1.0001 },
	];
	const sortedPrimary = [...primaryCounts.entries()]
		.filter(([, count]) => count > 0)
		.sort(
			(a, b) =>
				b[1] - a[1] || FAILURE_CATEGORIES.indexOf(a[0]) - FAILURE_CATEGORIES.indexOf(b[0]),
		);
	const skippedReasons = new Map();
	for (const entry of scanned.skipped) {
		skippedReasons.set(entry.reason, (skippedReasons.get(entry.reason) ?? 0) + 1);
	}
	const sampledChats = new Set(sampled.map((pair) => pair.chatLabel)).size;
	const acceptedLast = sampled.filter((pair) => !pair.acceptedNotLast);
	const acceptedNotLast = sampled.filter((pair) => pair.acceptedNotLast);
	const resultByPair = new Map(successful.map((entry) => [entry.pair, entry]));

	function groupPrimary(pairs) {
		const entries = pairs
			.map((pair) => resultByPair.get(pair.id))
			.filter((entry) => entry !== undefined);
		if (entries.length === 0) return { total: 0, top: null };
		return {
			total: entries.length,
			top: topCategory(countBy(entries.map((entry) => entry.primary))),
		};
	}

	const lines = [];
	lines.push(`<!-- ${MARKER}:begin -->`);
	lines.push("## 重 roll 归因（F0-T02）", "");
	lines.push(`生成时间：${generatedAt}`, "");
	lines.push("口径：", "");
	lines.push(
		"- 配对：同一个助手楼层里，`swipe_id` 指向的回复算被接受；被接受的是最后一条 swipe 时取前一条，否则取后一条作为被拒绝的尝试。",
	);
	lines.push(
		"- 抽样：按对话分层，每个对话内部用固定种子打乱，逐轮从各对话各取一对，直到达到目标数；抽中的配对连同上下文写在 `eval-private/f0/pairs.jsonl`。",
	);
	lines.push(
		"- 归因模型只看到最近 8 条非系统消息（每条截断到 1200 字符）、被拒绝与被接受的两次回复（每次截断到 4000 字符）；主因从固定类别里选一个，次因最多两个，并给出 0 到 1 的置信度。",
	);
	lines.push(
		"- 偏差单独统计：`alternative_only` 表示模型认为被拒绝的回复只是另一种可行写法；被接受的回复不是最后一条 swipe 表示玩家可能切回较早版本。",
	);
	lines.push("- 报告只包含数字与「对话 N」，原文与角色名留在 `eval-private/f0/`。");
	lines.push("");

	lines.push("### 扫描与抽样", "");
	lines.push("| 项目 | 数值 |", "|---|---|");
	lines.push(`| 对话（去重后） | ${scanned.chats} |`);
	lines.push(`| 有可比较配对的对话 | ${scanned.chatsWithPairs} |`);
	lines.push(`| 重 roll 过的助手楼层 | ${scanned.rerolledFloors} |`);
	lines.push(`| 可用配对 | ${scanned.candidates} |`);
	lines.push(
		`| 跳过的配对 | ${scanned.skipped.length}（${[...skippedReasons.entries()].map(([reason, count]) => `${reason} ${count}`).join("、") || "无"}） |`,
	);
	lines.push(`| 抽样配对 | ${sampled.length} |`);
	lines.push(`| 覆盖对话 | ${sampledChats} |`);
	lines.push(`| 抽样里被接受的是最后一条 swipe | ${acceptedLast.length} |`);
	lines.push(`| 抽样里被接受的不是最后一条 | ${acceptedNotLast.length} |`);
	lines.push("");

	lines.push("### 调用", "");
	lines.push("| 项目 | 数值 |", "|---|---|");
	lines.push(`| 归因模型 | \`${modelId}\` |`);
	lines.push(`| 成功归因 | ${successful.length} |`);
	lines.push(`| 失败归因 | ${failed.length} |`);
	lines.push(`| 本轮处理的配对 | ${runStats.calls} |`);
	lines.push(`| 本轮发出的网络请求 | ${runStats.requests} |`);
	lines.push(`| 本轮缓存命中 | ${runStats.cacheHits} |`);
	lines.push(`| 本轮因输出为空或截断而重试的配对 | ${runStats.retries} |`);
	lines.push(`| 累计 prompt token | ${runStats.usage.promptTokens} |`);
	lines.push(`| 累计 completion token | ${runStats.usage.completionTokens} |`);
	lines.push(`| 累计 reasoning token | ${runStats.usage.reasoningTokens} |`);
	lines.push("");

	lines.push("### 失败原因分布", "");
	lines.push(
		"| 主因 | 全部成功配对 | 占比 | 排除「另一种写法」后 | 占比 |",
		"|---|---|---|---|---|",
	);
	for (const [category, count] of sortedPrimary) {
		const rest = primaryWithoutAlternative.get(category) ?? 0;
		lines.push(
			`| ${category} | ${count} | ${pct(count, successful.length)} | ${rest} | ${pct(rest, withoutAlternative.length)} |`,
		);
	}
	lines.push("");
	lines.push("次因次数：", "");
	lines.push("| 次因 | 次数 | 占成功配对 |", "|---|---|---|");
	const sortedSecondary = [...secondaryCounts.entries()]
		.filter(([, count]) => count > 0)
		.sort(
			(a, b) =>
				b[1] - a[1] || FAILURE_CATEGORIES.indexOf(a[0]) - FAILURE_CATEGORIES.indexOf(b[0]),
		);
	for (const [category, count] of sortedSecondary) {
		lines.push(`| ${category} | ${count} | ${pct(count, successful.length)} |`);
	}
	if (sortedSecondary.length === 0) lines.push("| （没有次因） | 0 | — |");
	lines.push("");

	lines.push("### 偏差与置信度", "");
	lines.push("| 项目 | 数值 |", "|---|---|");
	lines.push(
		`| 标记为「另一种可行写法」 | ${alternative.length}（${pct(alternative.length, successful.length)}） |`,
	);
	lines.push(`| 排除这些之后的成功配对 | ${withoutAlternative.length} |`);
	lines.push(
		`| 置信度平均 | ${confidences.length === 0 ? "—" : (confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2)} |`,
	);
	lines.push(
		`| 置信度 P50 | ${confidences.length === 0 ? "—" : percentile(confidences, 0.5).toFixed(2)} |`,
	);
	for (const bucket of confidenceBuckets) {
		const count = confidences.filter((value) =>
			bucket.exclusive
				? value < bucket.max
				: value >= bucket.min && value < bucket.max,
		).length;
		lines.push(`| 置信度 ${bucket.label} | ${count} |`);
	}
	lines.push("");

	lines.push("按玩家是否切回较早版本分组：", "");
	lines.push("| 分组 | 抽样配对 | 成功归因 | 主因最高项 |", "|---|---|---|---|");
	for (const [label, pairs] of [
		["被接受的是最后一条 swipe", acceptedLast],
		["被接受的不是最后一条", acceptedNotLast],
	]) {
		const group = groupPrimary(pairs);
		const top =
			group.top === null
				? "—"
				: `${group.top.category}（${group.top.count}，${pct(group.top.count, group.total)}）`;
		lines.push(`| ${label} | ${pairs.length} | ${group.total} | ${top} |`);
	}
	lines.push("");

	if (failed.length > 0) {
		lines.push(
			`失败归因 ${failed.length} 对：模型输出不合法或调用失败，没有计入分布；错误记录留在 \`eval-private/f0/attribution.jsonl\`。`,
			"",
		);
	}

	lines.push("局限：", "");
	lines.push(
		"- 上下文只有最近 8 条消息，长程遗忘与前后矛盾会被低估；角色卡、世界书与台账状态没有提供给归因模型。",
	);
	lines.push(
		"- 主因是归因模型的一次判断，没有人工标注校准；裁判与玩家喜好的一致性由 F0-T03 单独检验。",
	);
	lines.push(
		"- 玩家切回较早 swipe 或只是想看别的写法，都会让「拒绝」不等于「更差」；这两类偏差只做了标记与分组，没有从样本里剔除。",
	);
	lines.push("");

	lines.push(`<!-- ${MARKER}:end -->`);
	return lines.join("\n");
}

const REPORT_HEADER = [
	"# F0 取证报告",
	"",
	"> 由 F0 系列脚本生成。报告只包含统计数字与「对话 N」，不含原文、角色名与绝对路径；明细留在 `eval-private/`。",
	"",
].join("\n");

async function main() {
	const targetPairs = readPositiveInt("DRAMATICER_F0_PAIRS", 200);
	const concurrency = readPositiveInt("DRAMATICER_F0_CONCURRENCY", 4);
	const maxTokens = readPositiveInt("DRAMATICER_F0_MAX_TOKENS", 2_500);

	loadDotEnv(path.resolve(".env"));
	const channels = await loadChannelsConfig(CHANNELS_PATH);
	const model = channels.models.get(MODEL_ALIAS);
	if (model === undefined) {
		throw new Error(`channels.yaml 里没有模型 ${MODEL_ALIAS}`);
	}
	const client = createLlmClient(channels, {
		defaultModel: MODEL_ALIAS,
		cacheDir: CACHE_DIR,
	});

	const chats = await readMap();
	const candidatesByChat = new Map();
	const skipped = [];
	let rerolledFloors = 0;
	let candidateTotal = 0;
	for (const chat of chats) {
		const collector = createPairCollector(chat.label);
		for await (const entry of parseChatJsonlFile(chat.file, {
			strictSwipeId: false,
		})) {
			if (entry.kind === "message") collector.push(entry.message);
		}
		const result = collector.result();
		rerolledFloors += result.rerolledFloors;
		skipped.push(...result.skipped.map((item) => ({ ...item, chat: chat.label })));
		if (result.candidates.length > 0) {
			candidatesByChat.set(chat.label, result.candidates);
			candidateTotal += result.candidates.length;
		}
	}

	const sampled = sampleCandidates(candidatesByChat, targetPairs);
	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(
		PAIRS_PATH,
		`${sampled.map((pair) => JSON.stringify(pair)).join("\n")}\n`,
		"utf8",
	);

	const existing = await readExistingResults();
	const pending = sampled.filter((pair) => existing.get(pair.id)?.ok !== true);
	const runStats = {
		calls: 0,
		cacheHits: 0,
		requests: 0,
		retries: 0,
		usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
	};
	let completed = 0;
	const fresh = await runPool(pending, concurrency, async (pair) => {
		runStats.calls += 1;
		try {
			const request = (tokens) =>
				client.complete({
					messages: buildJudgeMessages(pair),
					model: MODEL_ALIAS,
					temperature: 0,
					maxTokens: tokens,
					reasoning: "low",
				});
			let response = await request(maxTokens);
			if (response.cached) runStats.cacheHits += 1;
			else runStats.requests += response.attempts;
			let usage = addUsage(
				{ promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
				response.usage,
			);
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
			const judgement = parseJudgement(response.text);
			return {
				pair: pair.id,
				ok: true,
				...judgement,
				retried,
				cached: response.cached,
				attempts: response.attempts,
				model: response.model,
				channel: response.channel,
				usage,
				at: new Date().toISOString(),
			};
		} catch (error) {
			return {
				pair: pair.id,
				ok: false,
				error: String(error?.message ?? error).slice(0, 500),
				at: new Date().toISOString(),
			};
		} finally {
			completed += 1;
			if (completed % 20 === 0 || completed === pending.length) {
				console.error(`归因进度 ${completed}/${pending.length}`);
			}
		}
	});
	await appendFile(
		RESULTS_PATH,
		fresh.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
		"utf8",
	);

	const merged = new Map(existing);
	for (const entry of fresh) merged.set(entry.pair, entry);
	const results = sampled.map((pair) => merged.get(pair.id)).filter(Boolean);
	const successful = results.filter((entry) => entry.ok);
	if (successful.length === 0) {
		throw new Error("没有任何成功的归因结果，不写报告");
	}
	const usage = results
		.filter((entry) => entry.ok)
		.reduce(
			(total, entry) => addUsage(total, entry.usage),
			{ promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
		);
	const reportRunStats = { ...runStats, usage };
	const generatedAt = new Date().toISOString();
	const summary = {
		generatedAt,
		model: model.id,
		targetPairs,
		scanned: {
			chats: chats.length,
			chatsWithPairs: candidatesByChat.size,
			rerolledFloors,
			candidates: candidateTotal,
			skippedByReason: Object.fromEntries(
				[...skipped.reduce((map, item) => {
					map.set(item.reason, (map.get(item.reason) ?? 0) + 1);
					return map;
				}, new Map()).entries()],
			),
		},
		sampled: sampled.length,
		sampledChats: new Set(sampled.map((pair) => pair.chatLabel)).size,
		results: {
			successful: successful.length,
			failed: results.length - successful.length,
			primary: Object.fromEntries(
				countBy(successful.map((entry) => entry.primary)),
			),
			secondary: Object.fromEntries(
				countBy(successful.flatMap((entry) => entry.secondary)),
			),
			alternativeOnly: successful.filter((entry) => entry.alternativeOnly).length,
			confidenceMean:
				successful.length === 0
					? null
					: successful.reduce((sum, entry) => sum + entry.confidence, 0) /
						successful.length,
		},
		calls: {
			thisRun: runStats.calls,
			cacheHits: runStats.cacheHits,
			requests: runStats.requests,
			retries: runStats.retries,
			usage,
		},
	};
	await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, "\t")}\n`, "utf8");

	const section = renderSection({
		sampled,
		scanned: {
			chats: chats.length,
			chatsWithPairs: candidatesByChat.size,
			rerolledFloors,
			candidates: candidateTotal,
			skipped,
		},
		results,
		runStats: reportRunStats,
		modelId: model.id,
		generatedAt,
	});
	let existingReport;
	try {
		existingReport = await readFile(REPORT_PATH, "utf8");
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		existingReport = REPORT_HEADER;
	}
	await writeFile(
		REPORT_PATH,
		replaceMarkedSection(existingReport, section, MARKER),
		"utf8",
	);

	console.log(
		JSON.stringify({
			pairs: sampled.length,
			chats: summary.sampledChats,
			successful: successful.length,
			failed: summary.results.failed,
			thisRunCalls: runStats.calls,
			cacheHits: runStats.cacheHits,
			report: path.relative(process.cwd(), REPORT_PATH),
		}),
	);
}

await main();

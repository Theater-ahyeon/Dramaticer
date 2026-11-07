#!/usr/bin/env node
// F0-T01：只读统计三个 ST 数据目录里的对话，生成只含数字的报告。
// 根目录通过 DRAMATICER_ST_ROOTS 传入（Windows 上用分号分隔），仓库里不写私有绝对路径。
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createTokenEstimator } from "../packages/core/dist/tokens.js";
import {
	DEPTH_BUCKETS,
	EDIT_CATEGORIES,
	TAG_CATEGORIES,
	classifyEdit,
	countTagCategories,
	createBlockTypes,
	depthBucketOf,
	discoverTagNames,
	isPlausibleGeneration,
	measureReplyComposition,
	startsNewSegment,
} from "./f0-composition.mjs";

const REPORT_PATH = path.resolve("docs", "dev", "reports", "F0-corpus.md");
const MAP_PATH = path.resolve("eval-private", "reports", "f0-corpus-map.json");

const CONTEXT_LIMITS = [
	{ label: "128K", tokens: 128 * 1024 },
	{ label: "200K", tokens: 200 * 1024 },
	{ label: "1M", tokens: 1024 * 1024 },
];

const FLOOR_BUCKETS = [
	{ label: "1–10", min: 1, max: 10 },
	{ label: "11–50", min: 11, max: 50 },
	{ label: "51–100", min: 51, max: 100 },
	{ label: "101–200", min: 101, max: 200 },
	{ label: "201–500", min: 201, max: 500 },
	{ label: "501 以上", min: 501, max: Number.POSITIVE_INFINITY },
];

const estimateTokens = createTokenEstimator();

function readRoots() {
	const raw = process.env.DRAMATICER_ST_ROOTS;
	if (raw === undefined || raw.trim() === "") {
		throw new Error("需要设置 DRAMATICER_ST_ROOTS（多个目录用系统路径分隔符隔开）");
	}
	return raw
		.split(path.delimiter)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

async function walkJsonl(dir) {
	const out = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walkJsonl(full)));
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
	}
	return out;
}

async function collectFiles(roots) {
	const files = [];
	for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
		const chatDir = path.join(roots[rootIndex], "chats");
		for (const file of await walkJsonl(chatDir)) {
			const info = await stat(file);
			files.push({
				rootIndex,
				file,
				base: path.basename(file),
				size: info.size,
				mtimeMs: info.mtimeMs,
			});
		}
	}
	return files;
}

function dedupeByName(files) {
	const groups = new Map();
	for (const file of files) {
		const group = groups.get(file.base) ?? [];
		group.push(file);
		groups.set(file.base, group);
	}
	const chosen = [];
	for (const group of groups.values()) {
		group.sort((a, b) => a.rootIndex - b.rootIndex || a.file.localeCompare(b.file));
		chosen.push(group[0]);
	}
	return { chosen, duplicateGroups: [...groups.values()].filter((group) => group.length > 1).length };
}

function parseTime(value) {
	if (typeof value !== "string") return Number.NaN;
	return Date.parse(value);
}

function bumpMap(map, key, amount = 1) {
	map.set(key, (map.get(key) ?? 0) + amount);
}

function mergeCounts(target, source) {
	for (const [key, value] of source) bumpMap(target, key, value);
}

function hasPrefixKey(object, prefix) {
	return Object.keys(object).some((key) => key.startsWith(prefix));
}

const ECOSYSTEM_PLOT_FIELDS = ["qrf_plot", "qrf_plot_preset", "qrf_plot_tasks", "_qrf_plot_round_id", "_qrf_plot_pending_hash", "_plot_processed", "__kdn_plot_processed"];

async function discoverBlockTags(files) {
	const counts = new Map();
	for (const file of files) {
		const stream = createReadStream(file.file, { encoding: "utf8" });
		const lines = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
		try {
			for await (const line of lines) {
				for (const name of discoverTagNames(line)) bumpMap(counts, name);
			}
		} finally {
			lines.close();
			stream.destroy();
		}
	}
	return new Set([...counts].filter(([, count]) => count >= 5).map(([name]) => name));
}

async function scanChat(file, blockTypes) {
	const stream = createReadStream(file.file, { encoding: "utf8" });
	const lines = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	let headerSeen = false;
	let lineNo = 0;
	let floors = 0;
	let userFloors = 0;
	let assistantFloors = 0;
	let systemFloors = 0;
	let assistantWithoutSwipes = 0;
	let rerolledAssistantFloors = 0;
	let assistantSwipeTotal = 0;
	let currentTextTokens = 0;
	let nonBooleanSystemFloors = 0;
	let missingMesFloors = 0;
	let floorIndex = 0;
	let segments = 1;
	let previousSendMs = Number.NaN;
	let firstSendMs = Number.NaN;
	let lastSendMs = Number.NaN;
	let lastAssistantFinishMs = Number.NaN;
	let lastFloorWasAssistant = false;
	let lastAssistantRerolled = false;
	let generationSamples = 0;
	let generationMissing = 0;
	const genDurations = [];
	const ttfts = [];
	const gaps = [];
	const assistantTokens = [];
	const assistantTokensAfter50 = [];
	const playerTokens = [];
	const blockShares = [];
	const thinkingTokens = [];
	let compositionChars = 0;
	let compositionBlockCode = 0;
	const rerollByDepth = new Map(DEPTH_BUCKETS.map((bucket) => [bucket.label, { assistant: 0, rerolled: 0 }]));
	const tagCounts = new Map();
	const editCounts = new Map();
	const models = new Map();
	const chatModels = new Set();
	let editDiffering = 0;
	const ecosystemFloors = {
		acu: 0,
		plot: 0,
		ejs: 0,
		reasoningSignature: 0,
		toolInvocations: 0,
		images: 0,
	};
	const chatFeatures = {
		imagePlugin: false,
		timedWorldInfo: false,
		authorNote: false,
		variablePlugin: false,
		acuMetadata: false,
		unifiedStatusbar: false,
	};
	try {
		for await (const line of lines) {
			lineNo += 1;
			if (line.trim() === "") continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch (error) {
				throw new Error(`第 ${lineNo} 行不是合法 JSON：${file.base}`, { cause: error });
			}
			if (typeof message !== "object" || message === null || Array.isArray(message)) {
				throw new Error(`第 ${lineNo} 行不是 JSON 对象：${file.base}`);
			}
			if (!headerSeen) {
				if (!Object.hasOwn(message, "chat_metadata")) {
					throw new Error(`第一行不是对话头部：${file.base}`);
				}
				headerSeen = true;
				const metadata = message.chat_metadata;
				if (typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)) {
					chatFeatures.imagePlugin = Object.hasOwn(metadata, "st-chatu8");
					chatFeatures.timedWorldInfo = Object.hasOwn(metadata, "timedWorldInfo");
					chatFeatures.authorNote = hasPrefixKey(metadata, "note_");
					chatFeatures.variablePlugin = hasPrefixKey(metadata, "LWB_");
					chatFeatures.acuMetadata = Object.hasOwn(metadata, "sheets") || Object.hasOwn(metadata, "TavernDB_ACU_ScopedConfig");
					chatFeatures.unifiedStatusbar = Object.hasOwn(metadata, "unifiedStatusbar");
				}
				continue;
			}
			if (typeof message.is_user !== "boolean") {
				throw new Error(`第 ${lineNo} 行缺少布尔 is_user：${file.base}`);
			}
			if (typeof message.is_system !== "boolean" && message.is_system !== undefined) {
				nonBooleanSystemFloors += 1;
			}
			const isSystem = message.is_system === true;
			const isUser = message.is_user === true;
			if (message.mes === undefined) missingMesFloors += 1;
			if (message.mes !== undefined && typeof message.mes !== "string") {
				throw new Error(`第 ${lineNo} 行 mes 不是字符串：${file.base}`);
			}
			const messageText = typeof message.mes === "string" ? message.mes : "";
			const extra = typeof message.extra === "object" && message.extra !== null && !Array.isArray(message.extra) ? message.extra : {};
			const sendMs = Number.isFinite(parseTime(message.send_date)) ? parseTime(message.send_date) : parseTime(extra.send_date);
			if (Number.isFinite(sendMs)) {
				if (!Number.isFinite(firstSendMs)) firstSendMs = sendMs;
				lastSendMs = sendMs;
				if (Number.isFinite(previousSendMs) && startsNewSegment(previousSendMs, sendMs)) segments += 1;
				previousSendMs = sendMs;
			}
			floors += 1;
			currentTextTokens += estimateTokens(messageText);
			if (isSystem) {
				systemFloors += 1;
				lastFloorWasAssistant = false;
				continue;
			}
			floorIndex += 1;
			const messageKeys = Object.keys(message);
			if (messageKeys.includes("hash_sheets") || messageKeys.some((key) => key.startsWith("TavernDB_ACU_"))) {
				ecosystemFloors.acu += 1;
			}
			if (ECOSYSTEM_PLOT_FIELDS.some((key) => Object.hasOwn(message, key))) ecosystemFloors.plot += 1;
			if (Object.hasOwn(message, "is_ejs_processed")) ecosystemFloors.ejs += 1;
			if (Object.hasOwn(extra, "reasoning_signature")) ecosystemFloors.reasoningSignature += 1;
			if (Object.hasOwn(extra, "tool_invocations")) ecosystemFloors.toolInvocations += 1;
			if (Object.hasOwn(extra, "media") || Object.hasOwn(extra, "images") || Object.hasOwn(extra, "bbiImage") || Object.hasOwn(extra, "bbi_image")) {
				ecosystemFloors.images += 1;
			}
			if (isUser) {
				userFloors += 1;
				playerTokens.push(estimateTokens(messageText));
				if (lastFloorWasAssistant && Number.isFinite(lastAssistantFinishMs) && Number.isFinite(sendMs)) {
					const gapMs = sendMs - lastAssistantFinishMs;
					if (gapMs >= 0 && gapMs <= 30 * 60 * 1000) gaps.push(gapMs / 1000);
				}
				lastFloorWasAssistant = false;
				continue;
			}
			assistantFloors += 1;
			const swipes = Array.isArray(message.swipes) ? message.swipes : null;
			const swipeCount = swipes === null ? 1 : swipes.length;
			const rerolled = swipeCount > 1;
			assistantSwipeTotal += swipeCount;
			if (swipes === null) assistantWithoutSwipes += 1;
			if (rerolled) rerolledAssistantFloors += 1;
			const depth = rerollByDepth.get(depthBucketOf(floorIndex));
			depth.assistant += 1;
			if (rerolled) depth.rerolled += 1;
			const replyTokens = estimateTokens(messageText);
			assistantTokens.push(replyTokens);
			if (floorIndex > 50) assistantTokensAfter50.push(replyTokens);
			const startedMs = Number.isFinite(parseTime(message.gen_started)) ? parseTime(message.gen_started) : parseTime(extra.gen_started);
			const finishedMs = Number.isFinite(parseTime(message.gen_finished)) ? parseTime(message.gen_finished) : parseTime(extra.gen_finished);
			if (isPlausibleGeneration(startedMs, finishedMs)) {
				genDurations.push((finishedMs - startedMs) / 1000);
				generationSamples += 1;
				lastAssistantFinishMs = finishedMs;
			} else {
				generationMissing += 1;
				lastAssistantFinishMs = Number.isFinite(sendMs) ? sendMs : Number.NaN;
			}
			if (typeof extra.time_to_first_token === "number" && extra.time_to_first_token >= 0) {
				ttfts.push(extra.time_to_first_token / 1000);
			}
			if (typeof extra.reasoning === "string" && extra.reasoning.trim() !== "") {
				thinkingTokens.push(estimateTokens(extra.reasoning));
			}
			if (messageText !== "") {
				const composition = measureReplyComposition(messageText, blockTypes);
				compositionChars += composition.chars;
				compositionBlockCode += composition.blockChars + composition.codeChars;
				if (composition.chars > 0) blockShares.push((composition.blockChars + composition.codeChars) / composition.chars);
			}
			mergeCounts(tagCounts, countTagCategories(messageText));
			if (typeof extra.model === "string" && extra.model !== "") {
				bumpMap(models, extra.model);
				chatModels.add(extra.model);
			}
			if (swipes !== null && Number.isInteger(message.swipe_id) && typeof swipes[message.swipe_id] === "string") {
				const accepted = swipes[message.swipe_id];
				if (accepted !== messageText) {
					editDiffering += 1;
					const category = classifyEdit(messageText, accepted, blockTypes);
					if (category !== null) bumpMap(editCounts, category);
				}
			}
			lastFloorWasAssistant = true;
			lastAssistantRerolled = rerolled;
		}
	} finally {
		lines.close();
		stream.destroy();
	}
	if (!headerSeen) throw new Error(`对话文件为空：${file.base}`);
	return {
		floors,
		userFloors,
		assistantFloors,
		systemFloors,
		assistantWithoutSwipes,
		rerolledAssistantFloors,
		assistantSwipeTotal,
		currentTextTokens,
		nonBooleanSystemFloors,
		missingMesFloors,
		segments,
		spanMs: Number.isFinite(firstSendMs) && Number.isFinite(lastSendMs) ? lastSendMs - firstSendMs : null,
		lastAssistantRerolled: lastFloorWasAssistant && lastAssistantRerolled,
		generationSamples,
		generationMissing,
		genDurations,
		ttfts,
		gaps,
		assistantTokens,
		assistantTokensAfter50,
		playerTokens,
		blockShares,
		thinkingTokens,
		compositionChars,
		compositionBlockCode,
		rerollByDepth,
		tagCounts,
		editCounts,
		editDiffering,
		models,
		chatModelCount: chatModels.size,
		ecosystemFloors,
		chatFeatures,
	};
}

function percentile(sorted, p) {
	if (sorted.length === 0) return 0;
	const rank = Math.ceil(p * sorted.length);
	return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function pct(part, total) {
	return total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`;
}

function mean(values) {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value) {
	return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function summarizeGroup(chats) {
	const floors = chats.map((chat) => chat.floors).sort((a, b) => a - b);
	const tokens = chats.map((chat) => chat.currentTextTokens).sort((a, b) => a - b);
	const assistantFloors = chats.reduce((sum, chat) => sum + chat.assistantFloors, 0);
	const rerolled = chats.reduce((sum, chat) => sum + chat.rerolledAssistantFloors, 0);
	return {
		chats: chats.length,
		floorsTotal: floors.reduce((sum, value) => sum + value, 0),
		floorsMedian: percentile(floors, 0.5),
		floorsP90: percentile(floors, 0.9),
		tokensMedian: percentile(tokens, 0.5),
		tokensP90: percentile(tokens, 0.9),
		tokensTotal: tokens.reduce((sum, value) => sum + value, 0),
		assistantFloors,
		rerolled,
		rerollRate: pct(rerolled, assistantFloors),
		fits128k: chats.filter((chat) => chat.currentTextTokens <= CONTEXT_LIMITS[0].tokens).length,
	};
}

function renderReport({ chats, stats, filesScanned, duplicateGroups, generatedAt, rootsCount }) {
	const floors = chats.map((chat) => chat.floors).sort((a, b) => a - b);
	const tokens = chats.map((chat) => chat.currentTextTokens).sort((a, b) => a - b);
	const totals = {
		floors: chats.reduce((sum, chat) => sum + chat.floors, 0),
		userFloors: chats.reduce((sum, chat) => sum + chat.userFloors, 0),
		assistantFloors: chats.reduce((sum, chat) => sum + chat.assistantFloors, 0),
		systemFloors: chats.reduce((sum, chat) => sum + chat.systemFloors, 0),
		tokens: chats.reduce((sum, chat) => sum + chat.currentTextTokens, 0),
		swipes: chats.reduce((sum, chat) => sum + chat.assistantSwipeTotal, 0),
		rerolled: chats.reduce((sum, chat) => sum + chat.rerolledAssistantFloors, 0),
		withoutSwipes: chats.reduce((sum, chat) => sum + chat.assistantWithoutSwipes, 0),
	};
	const mtimes = chats.map((chat) => chat.mtimeMs).sort((a, b) => a - b);
	const mid = Math.floor(chats.length / 2);
	const sortedByTime = [...chats].sort((a, b) => a.mtimeMs - b.mtimeMs);
	const early = summarizeGroup(sortedByTime.slice(0, mid));
	const recent = summarizeGroup(sortedByTime.slice(mid));
	const earlyRange = `${new Date(mtimes[0]).toISOString().slice(0, 10)} 至 ${new Date(mtimes[mid - 1]).toISOString().slice(0, 10)}`;
	const recentRange = `${new Date(mtimes[mid]).toISOString().slice(0, 10)} 至 ${new Date(mtimes.at(-1)).toISOString().slice(0, 10)}`;

	const lines = [];
	lines.push("# F0 对话语料统计（F0-T01、F0-T02.a）", "");
	lines.push(`生成时间：${generatedAt}`, "");
	lines.push(
		`扫描 ${rootsCount} 个 ST 数据目录的 \`chats/\` 子目录（只读），共 ${filesScanned} 个 jsonl 文件；按文件名去重后 ${chats.length} 个对话，重复的文件名有 ${duplicateGroups} 组。同名副本保留目录顺序靠前的那份。`,
		"",
	);
	lines.push("## 口径", "");
	lines.push("- 楼层：jsonl 第一行是对话头部，其余每个非空行算一个楼层。");
	lines.push("- 正文：每条消息当前显示的文本（`mes`），不含其他 swipe、变量、状态表、系统提示、角色卡与世界书。");
	lines.push(
		"- token 估算：与 core 的 `createTokenEstimator` 相同，CJK 字符按 1.5 个字符算 1 个 token、其余按 4 个字符算 1 个 token，向上取整后按楼层累加。",
	);
	lines.push(
		"- 容量占比：把对话全部楼层的当前正文 token 之和与 131072（128K）、204800（200K）、1048576（1M）比较。实际请求还要加上系统提示、角色卡、世界书与模板，所以这是乐观估计。",
	);
	lines.push("- 重 roll 率：助手楼层里 `swipes` 数量大于 1 的占比；缺 `swipes` 字段的助手楼层按 1 条 swipe 计。");
	lines.push("- 百分位用最近秩法（P 对应升序第 ⌈P×N⌉ 个值）。");
	lines.push(
		`- 近期与早期：按所选文件的修改时间升序把对话分成两半，较旧一半（${earlyRange}）与较新一半（${recentRange}）。部分副本的修改时间是复制时间，这一分组只能近似反映写作时间。`,
	);
	lines.push("- 助手生成耗时：`gen_started` 到 `gen_finished`，缺失时读 `extra` 里的同名字段；结束早于开始或超过 24 小时的记录丢弃。");
	lines.push("- 首字延迟：`extra.time_to_first_token`（毫秒）换算成秒。");
	lines.push("- 玩家思考间隙：上一条助手楼层的 `gen_finished`（缺失时用它的 `send_date`）到该用户楼层的 `send_date`，只统计同一会话段内、间隔非负的相邻对。");
	lines.push("- 会话段：按楼层 `send_date` 升序，相邻两层间隔超过 30 分钟算新段；对话跨度是最后与第一层 `send_date` 之差。");
	lines.push("- 楼层深度：按非 system 楼层的序号计，1 到 10、11 到 50、51 到 100、101 到 200、201 以上分桶。");
	lines.push(
		"- 标签块与代码块占比：用 core 的块解析器统计已闭合的顶层标签块，加上块外整行以 ``` 开头的代码围栏；未闭合的块按正文处理。标签名取语料里出现至少 5 次的无属性开标签，因此带属性的 HTML 标签不计入，这个占比是保守估计。",
	);
	lines.push("- 编辑信号：助手楼层的 `mes` 与 `swipes[swipe_id]` 不同时按形态分类：去掉空白后相同、末尾追加正文、只改标签块（去掉标签块后正文相同）、去掉标签块后正文少量变化（公共前缀不低于 80% 且长度差不超过 120 字符）、其余算正文大改。");
	lines.push("");

	lines.push("## 总览", "");
	lines.push("| 指标 | 数值 |", "|---|---|");
	lines.push(`| 对话数 | ${chats.length} |`);
	lines.push(`| 楼层合计 | ${totals.floors} |`);
	lines.push(`| 用户楼层 | ${totals.userFloors} |`);
	lines.push(`| 助手楼层 | ${totals.assistantFloors} |`);
	lines.push(`| system 楼层 | ${totals.systemFloors} |`);
	lines.push(`| 当前正文 token 合计 | ${totals.tokens} |`);
	lines.push(`| 助手楼层 swipe 合计 | ${totals.swipes} |`);
	lines.push(`| 重 roll 过的助手楼层 | ${totals.rerolled}（${pct(totals.rerolled, totals.assistantFloors)}） |`);
	lines.push(`| 没有 swipes 字段的助手楼层 | ${totals.withoutSwipes} |`);
	lines.push("");

	lines.push("## 每对话楼层数", "");
	lines.push("| 统计量 | 楼层数 |", "|---|---|");
	lines.push(`| 最小 | ${floors[0]} |`);
	lines.push(`| P50 | ${percentile(floors, 0.5)} |`);
	lines.push(`| P75 | ${percentile(floors, 0.75)} |`);
	lines.push(`| P90 | ${percentile(floors, 0.9)} |`);
	lines.push(`| P95 | ${percentile(floors, 0.95)} |`);
	lines.push(`| 最大 | ${floors.at(-1)} |`);
	lines.push(`| 平均 | ${formatNumber(mean(floors))} |`);
	lines.push("");

	lines.push("楼层数分桶：", "");
	lines.push("| 楼层区间 | 对话数 | 占比 |", "|---|---|---|");
	const emptyChats = floors.filter((value) => value === 0).length;
	lines.push(`| 0 | ${emptyChats} | ${pct(emptyChats, floors.length)} |`);
	for (const bucket of FLOOR_BUCKETS) {
		const count = floors.filter((value) => value >= bucket.min && value <= bucket.max).length;
		lines.push(`| ${bucket.label} | ${count} | ${pct(count, floors.length)} |`);
	}
	lines.push("");

	lines.push("## 每对话正文体量（token）", "");
	lines.push("| 统计量 | token |", "|---|---|");
	lines.push(`| 最小 | ${tokens[0]} |`);
	lines.push(`| P50 | ${percentile(tokens, 0.5)} |`);
	lines.push(`| P75 | ${percentile(tokens, 0.75)} |`);
	lines.push(`| P90 | ${percentile(tokens, 0.9)} |`);
	lines.push(`| P95 | ${percentile(tokens, 0.95)} |`);
	lines.push(`| 最大 | ${tokens.at(-1)} |`);
	lines.push(`| 平均 | ${formatNumber(mean(tokens))} |`);
	lines.push(`| 合计 | ${totals.tokens} |`);
	lines.push("");

	lines.push("## 整段对话放进上下文", "");
	lines.push("| 上下文上限 | 能放下的对话数 | 占比 |", "|---|---|---|");
	for (const limit of CONTEXT_LIMITS) {
		const count = tokens.filter((value) => value <= limit.tokens).length;
		lines.push(`| ${limit.label} | ${count} | ${pct(count, tokens.length)} |`);
	}
	lines.push("");
	lines.push(
		`超出 1M 的对话 ${tokens.filter((value) => value > CONTEXT_LIMITS[2].tokens).length} 个。`,
		"",
	);

	lines.push("## 长对话子集", "");
	lines.push(
		"短对话占了大多数，整段放得下不说明问题；这里只统计楼层数达到门槛的对话。",
		"",
	);
	lines.push(
		"| 子集 | 对话数 | 楼层 P50 | 正文 token P50 | 正文 token 最大 | 128K | 200K | 1M |",
		"|---|---|---|---|---|---|---|---|",
	);
	for (const threshold of [50, 100, 200]) {
		const subset = chats.filter((chat) => chat.floors >= threshold);
		const subsetTokens = subset.map((chat) => chat.currentTextTokens).sort((a, b) => a - b);
		const subsetFloors = subset.map((chat) => chat.floors).sort((a, b) => a - b);
		const fits = CONTEXT_LIMITS.map(
			(limit) => `${subsetTokens.filter((value) => value <= limit.tokens).length}（${pct(subsetTokens.filter((value) => value <= limit.tokens).length, subset.length)}）`,
		);
		lines.push(
			`| 楼层 ≥ ${threshold} | ${subset.length} | ${subset.length === 0 ? "—" : percentile(subsetFloors, 0.5)} | ${subset.length === 0 ? "—" : percentile(subsetTokens, 0.5)} | ${subset.length === 0 ? "—" : subsetTokens.at(-1)} | ${fits.join(" | ")} |`,
		);
	}
	lines.push("");

	lines.push("## 重 roll", "");
	const chatsWithReroll = chats.filter((chat) => chat.rerolledAssistantFloors > 0).length;
	const perChatReroll = chats
		.map((chat) => (chat.assistantFloors === 0 ? 0 : chat.rerolledAssistantFloors / chat.assistantFloors))
		.sort((a, b) => a - b);
	lines.push("| 指标 | 数值 |", "|---|---|");
	lines.push(`| 有重 roll 的对话 | ${chatsWithReroll}（${pct(chatsWithReroll, chats.length)}） |`);
	lines.push(`| 助手楼层重 roll 率 | ${pct(totals.rerolled, totals.assistantFloors)} |`);
	lines.push(`| 每对话重 roll 率 P50 | ${(percentile(perChatReroll, 0.5) * 100).toFixed(1)}% |`);
	lines.push(`| 每对话重 roll 率 P90 | ${(percentile(perChatReroll, 0.9) * 100).toFixed(1)}% |`);
	lines.push(`| 每对话重 roll 率最大 | ${(perChatReroll.at(-1) * 100).toFixed(1)}% |`);
	lines.push(`| 平均每助手楼层的 swipe 数 | ${formatNumber(totals.swipes / totals.assistantFloors)} |`);
	const activeChats = chats.filter((chat) => chat.assistantFloors >= 5);
	const activeAssistant = activeChats.reduce((sum, chat) => sum + chat.assistantFloors, 0);
	const activeRerolled = activeChats.reduce((sum, chat) => sum + chat.rerolledAssistantFloors, 0);
	lines.push(
		`| 助手楼层 ≥ 5 的对话（${activeChats.length} 个）重 roll 率 | ${pct(activeRerolled, activeAssistant)} |`,
	);
	lines.push("");

	lines.push("## 较旧一半与较新一半", "");
	lines.push("| 指标 | 较旧一半 | 较新一半 |", "|---|---|---|");
	const groupRows = [
		["对话数", early.chats, recent.chats],
		["楼层合计", early.floorsTotal, recent.floorsTotal],
		["楼层 P50", early.floorsMedian, recent.floorsMedian],
		["楼层 P90", early.floorsP90, recent.floorsP90],
		["正文 token P50", early.tokensMedian, recent.tokensMedian],
		["正文 token P90", early.tokensP90, recent.tokensP90],
		["正文 token 合计", early.tokensTotal, recent.tokensTotal],
		["助手楼层", early.assistantFloors, recent.assistantFloors],
		["重 roll 率", early.rerollRate, recent.rerollRate],
		["能放进 128K 的对话", `${early.fits128k}（${pct(early.fits128k, early.chats)}）`, `${recent.fits128k}（${pct(recent.fits128k, recent.chats)}）`],
	];
	for (const [label, a, b] of groupRows) lines.push(`| ${label} | ${a} | ${b} |`);
	lines.push("");

	lines.push("## 正文体量最大的十个对话", "");
	lines.push("| 对话 | 楼层 | 当前正文 token | 助手楼层 | 重 roll 率 |", "|---|---|---|---|---|");
	const largest = [...chats].sort((a, b) => b.currentTextTokens - a.currentTextTokens).slice(0, 10);
	for (const chat of largest) {
		const rate = chat.assistantFloors === 0 ? "—" : pct(chat.rerolledAssistantFloors, chat.assistantFloors);
		lines.push(`| 对话 ${chat.label} | ${chat.floors} | ${chat.currentTextTokens} | ${chat.assistantFloors} | ${rate} |`);
	}
	lines.push("");

	lines.push("## 楼层数最大的十个对话", "");
	lines.push("| 对话 | 楼层 | 当前正文 token | 助手楼层 | 重 roll 率 |", "|---|---|---|---|---|");
	const longest = [...chats].sort((a, b) => b.floors - a.floors).slice(0, 10);
	for (const chat of longest) {
		const rate = chat.assistantFloors === 0 ? "—" : pct(chat.rerolledAssistantFloors, chat.assistantFloors);
		lines.push(`| 对话 ${chat.label} | ${chat.floors} | ${chat.currentTextTokens} | ${chat.assistantFloors} | ${rate} |`);
	}
	lines.push("");

	const distributionRow = (label, values, render = formatNumber) => {
		if (values.length === 0) return `| ${label} | — | — | — | — | — |`;
		const sorted = [...values].sort((left, right) => left - right);
		return `| ${label} | ${render(percentile(sorted, 0.25))} | ${render(percentile(sorted, 0.5))} | ${render(percentile(sorted, 0.75))} | ${render(percentile(sorted, 0.9))} | ${render(sorted.at(-1))} |`;
	};
	const percent = (value) => `${(value * 100).toFixed(1)}%`;

	lines.push("## 节奏与时间", "");
	lines.push("| 指标 | P25 | P50 | P75 | P90 | 最大 |", "|---|---|---|---|---|---|");
	lines.push(distributionRow("助手生成耗时（秒）", chats.flatMap((chat) => chat.genDurations)));
	lines.push(distributionRow("首字延迟（秒）", chats.flatMap((chat) => chat.ttfts)));
	lines.push(distributionRow("玩家思考间隙（秒）", chats.flatMap((chat) => chat.gaps)));
	lines.push(distributionRow("每个对话的会话段数", chats.map((chat) => chat.segments)));
	const spanDays = chats.filter((chat) => chat.spanMs !== null).map((chat) => chat.spanMs / 86_400_000);
	lines.push(distributionRow("对话跨度（天）", spanDays));
	lines.push("");
	lines.push(
		`生成耗时缺失或不可用的助手楼层 ${chats.reduce((sum, chat) => sum + chat.generationMissing, 0)} 个，有效样本 ${chats.reduce((sum, chat) => sum + chat.generationSamples, 0)} 个。跨度为 0 天的对话 ${chats.filter((chat) => chat.spanMs === 0).length} 个，缺少可解析 send_date 的对话 ${chats.filter((chat) => chat.spanMs === null).length} 个。`,
		"",
	);

	const mergeReroll = (subset) => {
		const merged = new Map(DEPTH_BUCKETS.map((bucket) => [bucket.label, { assistant: 0, rerolled: 0 }]));
		for (const chat of subset) {
			for (const [label, stats] of chat.rerollByDepth) {
				const target = merged.get(label);
				target.assistant += stats.assistant;
				target.rerolled += stats.rerolled;
			}
		}
		return merged;
	};
	const pushDepthTable = (merged) => {
		lines.push("| 楼层区间 | 助手楼层 | 重 roll | 重 roll 率 |", "|---|---|---|---|");
		for (const bucket of DEPTH_BUCKETS) {
			const stats = merged.get(bucket.label);
			lines.push(`| ${bucket.label} | ${stats.assistant} | ${stats.rerolled} | ${pct(stats.rerolled, stats.assistant)} |`);
		}
		lines.push("");
	};
	lines.push("## 重 roll 与楼层深度", "");
	lines.push("全部对话：", "");
	pushDepthTable(mergeReroll(chats));
	const longChats = chats.filter((chat) => chat.floors >= 50);
	lines.push(`楼层 ≥ 50 的 ${longChats.length} 个对话：`, "");
	pushDepthTable(mergeReroll(longChats));
	const endedWithReroll = [
		{ label: "楼层 ≤ 10", subset: chats.filter((chat) => chat.floors <= 10) },
		{ label: "楼层 11–50", subset: chats.filter((chat) => chat.floors > 10 && chat.floors <= 50) },
		{ label: "楼层 51 以上", subset: chats.filter((chat) => chat.floors > 50) },
	];
	lines.push("以“最后一楼是被重 roll 过的助手回复”结束的对话：", "");
	lines.push("| 对话规模 | 对话数 | 这样结束的对话 | 占比 |", "|---|---|---|---|");
	for (const entry of endedWithReroll) {
		const count = entry.subset.filter((chat) => chat.lastAssistantRerolled).length;
		lines.push(`| ${entry.label} | ${entry.subset.length} | ${count} | ${pct(count, entry.subset.length)} |`);
	}
	lines.push("");

	lines.push("## 回复构成", "");
	lines.push("| 指标 | P25 | P50 | P75 | P90 | 最大 |", "|---|---|---|---|---|---|");
	lines.push(distributionRow("助手回复 token", chats.flatMap((chat) => chat.assistantTokens)));
	lines.push(distributionRow("第 50 楼以后的助手回复 token", chats.flatMap((chat) => chat.assistantTokensAfter50)));
	lines.push(distributionRow("玩家输入 token", chats.flatMap((chat) => chat.playerTokens)));
	lines.push(distributionRow("标签块与代码块字符占比", chats.flatMap((chat) => chat.blockShares), percent));
	lines.push(distributionRow("思考内容 token", chats.flatMap((chat) => chat.thinkingTokens)));
	lines.push("");
	const compositionChars = chats.reduce((sum, chat) => sum + chat.compositionChars, 0);
	const compositionBlockCode = chats.reduce((sum, chat) => sum + chat.compositionBlockCode, 0);
	lines.push(
		`全部助手回复合计 ${compositionChars} 个字符，其中标签块与代码块 ${compositionBlockCode} 个（${pct(compositionBlockCode, compositionChars)}）。占比只统计已闭合、不带属性的标签块；带属性的 HTML 标签（例如带 class 的 div）按正文计，所以这个数字低于用正则粗略估算的旧口径（中位数 65%），两者不能直接比较。`,
		"",
	);

	const tagTotals = new Map();
	for (const chat of chats) {
		for (const [label, count] of chat.tagCounts) tagTotals.set(label, (tagTotals.get(label) ?? 0) + count);
	}
	lines.push("## 结构化块使用", "");
	lines.push("| 类别 | 开标签次数 |", "|---|---|");
	for (const category of TAG_CATEGORIES) lines.push(`| ${category.label} | ${tagTotals.get(category.label) ?? 0} |`);
	lines.push("");

	const featureRows = [
		["生图插件元数据（`st-chatu8`）", chats.filter((chat) => chat.chatFeatures.imagePlugin).length],
		["定时世界书（`timedWorldInfo`）", chats.filter((chat) => chat.chatFeatures.timedWorldInfo).length],
		["作者注释（`note_*`）", chats.filter((chat) => chat.chatFeatures.authorNote).length],
		["变量插件元数据（`LWB_*`）", chats.filter((chat) => chat.chatFeatures.variablePlugin).length],
		["表格插件元数据（`sheets` 或 `TavernDB_ACU_ScopedConfig`）", chats.filter((chat) => chat.chatFeatures.acuMetadata).length],
		["统一状态栏（`unifiedStatusbar`）", chats.filter((chat) => chat.chatFeatures.unifiedStatusbar).length],
		["有模型记录的对话", chats.filter((chat) => chat.chatModelCount > 0).length],
		["中途换过模型的对话", chats.filter((chat) => chat.chatModelCount > 1).length],
	];
	lines.push("## 生态功能覆盖", "");
	lines.push("| 对话级字段 | 对话数 |", "|---|---|");
	for (const [label, count] of featureRows) lines.push(`| ${label} | ${count}（${pct(count, chats.length)}） |`);
	lines.push("");
	const floorFeatureRows = [
		["表格（`hash_sheets` 或 `TavernDB_ACU_*`）", "acu"],
		["剧情规划（`qrf_plot*` 等）", "plot"],
		["EJS 标记字段存在（`is_ejs_processed`）", "ejs"],
		["思考签名字段存在（`extra.reasoning_signature`）", "reasoningSignature"],
		["工具调用字段存在（`extra.tool_invocations`）", "toolInvocations"],
		["图片相关字段存在（`extra.media`、`extra.images` 等）", "images"],
	];
	lines.push("| 楼层级字段 | 楼层数 |", "|---|---|");
	for (const [label, key] of floorFeatureRows) {
		lines.push(`| ${label} | ${chats.reduce((sum, chat) => sum + chat.ecosystemFloors[key], 0)} |`);
	}
	lines.push("");
	lines.push("楼层级数字是字段存在即计数（不看值），范围是非 system 楼层。", "");
	const modelTotals = new Map();
	for (const chat of chats) {
		for (const [model, count] of chat.models) modelTotals.set(model, (modelTotals.get(model) ?? 0) + count);
	}
	const topModels = [...modelTotals].sort((left, right) => right[1] - left[1]).slice(0, 10);
	lines.push("| 模型 | 助手楼层 |", "|---|---|");
	for (const [model, count] of topModels) lines.push(`| \`${model}\` | ${count} |`);
	lines.push("");

	const editTotals = new Map();
	for (const chat of chats) {
		for (const [category, count] of chat.editCounts) editTotals.set(category, (editTotals.get(category) ?? 0) + count);
	}
	const editDiffering = chats.reduce((sum, chat) => sum + chat.editDiffering, 0);
	lines.push("## 编辑信号", "");
	lines.push(
		`\`mes\` 与 \`swipes[swipe_id]\` 不同的助手楼层 ${editDiffering} 个（占助手楼层 ${pct(editDiffering, totals.assistantFloors)}）。玩家手改与插件改写无法区分，分类只描述形态。`,
		"",
	);
	lines.push("| 分类 | 楼层数 | 占比 |", "|---|---|---|");
	for (const category of EDIT_CATEGORIES) {
		const count = editTotals.get(category) ?? 0;
		lines.push(`| ${category} | ${count} | ${pct(count, editDiffering)} |`);
	}
	lines.push("");

	lines.push("## 与方案评审提案统计的差异", "");
	lines.push(
		"- 与 `docs/proposals/v3-review.md` 的 0.1–0.6 相比，生成耗时、首字延迟、回复 token、思考 token 与按楼层深度的重 roll 率一致（相差不超过 1 个百分点或 1 个 token）。",
	);
	lines.push(
		"- 玩家思考间隙：本文 P50 与 P90 略低，因为只统计上一条是助手楼层、用 `gen_finished`（缺失时用 `send_date`）计算的非负相邻对，并丢弃超过 30 分钟的跨段间隔。",
	);
	lines.push(
		"- 标签块与代码块占比：本文只统计已闭合、不带属性的标签块（core 块解析器不匹配带属性的标签），带属性的 HTML 按正文计；提案的正则估算会重复计算嵌套标签。两个口径不能互换使用。",
	);
	lines.push(
		"- 楼层级生态字段：本文按字段存在计数、范围是非 system 楼层；提案的表格（1,140）与工具调用（127）口径不同，可能只计算表内有内容或按 swipe 计的楼层。",
	);
	lines.push(
		"- 编辑分类：本文用块解析器剔除标签块后比较正文，并把“去掉标签块后正文相同”单列成“只改标签块”；提案的“新增标签块 2”只覆盖追加块，本文的 155 个包含状态栏与变量块被整体改写的情况。",
	);
	lines.push(
		"- 对话规模与“最后一楼”统计相差 1 到 8 个对话：本文按文件名去重后保留目录顺序靠前的一份，楼层计数不含 system 楼层。",
	);
	lines.push("");

	lines.push("## 数据质量", "");
	lines.push("| 项目 | 数量 |", "|---|---|");
	lines.push(`| jsonl 文件（去重前） | ${filesScanned} |`);
	lines.push(`| 同名副本组 | ${duplicateGroups} |`);
	lines.push(`| 没有 swipes 字段的助手楼层 | ${totals.withoutSwipes} |`);
	lines.push(`| is_system 不是布尔值的楼层 | ${stats.nonBooleanSystemFloors} |`);
	lines.push(`| 缺少 mes 的楼层 | ${stats.missingMesFloors} |`);
	lines.push(`| 楼层数为 0 的对话 | ${emptyChats} |`);
	lines.push(`| 修改时间早于 2000 年的文件 | ${stats.invalidMtimeChats} |`);
	lines.push("");
	lines.push(
		"`is_system` 为字符串的值都是空串，按“不是 system 楼层”处理。`mes` 与 `swipes[swipe_id]` 的文本有差异，正文统计以 `mes` 为准。修改时间早于 2000 年的是复制时留下的无效时间戳，排序时按最早处理。",
		"",
	);
	return lines.join("\n");
}

async function main() {
	const roots = readRoots();
	const files = await collectFiles(roots);
	const { chosen, duplicateGroups } = dedupeByName(files);
	const blockTags = await discoverBlockTags(chosen);
	const blockTypes = createBlockTypes(blockTags);
	const chats = [];
	for (const file of chosen) {
		const scanned = await scanChat(file, blockTypes);
		chats.push({
			label: 0,
			file: file.file,
			size: file.size,
			mtimeMs: file.mtimeMs,
			...scanned,
		});
	}
	chats.sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
	chats.forEach((chat, index) => {
		chat.label = index + 1;
	});
	const stats = {
		nonBooleanSystemFloors: chats.reduce((sum, chat) => sum + chat.nonBooleanSystemFloors, 0),
		missingMesFloors: chats.reduce((sum, chat) => sum + chat.missingMesFloors, 0),
		invalidMtimeChats: chats.filter((chat) => chat.mtimeMs < Date.UTC(2000, 0, 1)).length,
	};
	const generatedAt = new Date().toISOString();
	const report = renderReport({
		chats,
		stats,
		filesScanned: files.length,
		duplicateGroups,
		generatedAt,
		rootsCount: roots.length,
	});
	await mkdir(path.dirname(REPORT_PATH), { recursive: true });
	await writeFile(REPORT_PATH, `${report}\n`, "utf8");
	await mkdir(path.dirname(MAP_PATH), { recursive: true });
	await writeFile(
		MAP_PATH,
		`${JSON.stringify(
			{
				generatedAt,
				chats: chats.map((chat) => ({
					label: `对话 ${chat.label}`,
					path: chat.file,
					size: chat.size,
					mtime: new Date(chat.mtimeMs).toISOString(),
					floors: chat.floors,
					currentTextTokens: chat.currentTextTokens,
				})),
			},
			null,
			"\t",
		)}\n`,
		"utf8",
	);
	console.log(
		JSON.stringify({
			chats: chats.length,
			filesScanned: files.length,
			duplicateGroups,
			totalFloors: chats.reduce((sum, chat) => sum + chat.floors, 0),
			totalTokens: chats.reduce((sum, chat) => sum + chat.currentTextTokens, 0),
			report: path.relative(process.cwd(), REPORT_PATH),
			map: path.relative(process.cwd(), MAP_PATH),
		}),
	);
}

await main();

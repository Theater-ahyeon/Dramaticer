#!/usr/bin/env node
// F0-T01：只读统计三个 ST 数据目录里的对话，生成只含数字的报告。
// 根目录通过 DRAMATICER_ST_ROOTS 传入（Windows 上用分号分隔），仓库里不写私有绝对路径。
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createTokenEstimator } from "../packages/core/dist/tokens.js";

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

async function scanChat(file) {
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
			floors += 1;
			if (isSystem) systemFloors += 1;
			else if (isUser) userFloors += 1;
			else {
				assistantFloors += 1;
				const swipes = Array.isArray(message.swipes) ? message.swipes.length : null;
				if (swipes === null) {
					assistantWithoutSwipes += 1;
					assistantSwipeTotal += 1;
				} else {
					assistantSwipeTotal += swipes;
					if (swipes > 1) rerolledAssistantFloors += 1;
				}
			}
			currentTextTokens += estimateTokens(typeof message.mes === "string" ? message.mes : "");
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
	lines.push("# F0 对话语料统计（F0-T01）", "");
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
	const chats = [];
	for (const file of chosen) {
		const scanned = await scanChat(file);
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

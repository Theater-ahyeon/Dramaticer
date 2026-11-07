import { readFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../json.js";
import type { ChatHealth } from "./chat-health.js";
import { analyzeChat } from "./chat-health.js";
import type { EntityHealth } from "./entity-health.js";
import { analyzeEntityFiles } from "./entity-health.js";
import type { PresetHealth } from "./preset-health.js";
import { analyzePresetFiles } from "./preset-health.js";
import type { TokenEstimator } from "./token-estimate.js";
import { createTokenEstimator } from "./token-estimate.js";

export interface SnapshotManifestFile {
	readonly role: string;
	readonly character?: string;
	readonly target: string;
}

export interface SnapshotManifest {
	readonly generatedAt: string | null;
	readonly files: readonly SnapshotManifestFile[];
}

export interface ChatReportEntry {
	readonly character: string | null;
	readonly fileName: string;
	readonly stats: ChatHealth;
}

export interface HealthTotals {
	readonly chatCount: number;
	readonly messageCount: number;
	readonly swipeCount: number;
	readonly fileBytes: number;
	readonly rawBytes: number;
	readonly bodyBytes: number;
	readonly variablesBytes: number;
	readonly otherBytes: number;
	readonly bodyTokens: number;
	readonly variablesTokens: number;
	readonly otherTokens: number;
	readonly snapshotBytes: number;
	readonly diffBytes: number;
	readonly diffCount: number;
}

export interface HealthReport {
	readonly generatedAt: string;
	readonly manifestGeneratedAt: string | null;
	readonly chats: readonly ChatReportEntry[];
	readonly entities: EntityHealth;
	readonly presets: PresetHealth;
	readonly totals: HealthTotals;
}

export interface CollectHealthReportOptions {
	readonly rawRoot: string;
	readonly tokenEstimator?: TokenEstimator;
	readonly generatedAt?: string;
}

export async function readSnapshotManifest(
	manifestPath: string,
): Promise<SnapshotManifest> {
	const text = await readFile(manifestPath, "utf8");
	return parseSnapshotManifest(JSON.parse(text));
}

export function parseSnapshotManifest(value: unknown): SnapshotManifest {
	if (!isJsonObject(value)) {
		throw new Error("manifest 根必须是对象");
	}
	if (!Array.isArray(value.files)) {
		throw new Error("manifest.files 必须是数组");
	}
	const files = value.files.map((file, index) => {
		if (!isJsonObject(file)) {
			throw new Error(`manifest.files[${index}] 必须是对象`);
		}
		if (typeof file.role !== "string" || file.role.length === 0) {
			throw new Error(`manifest.files[${index}].role 必须是非空字符串`);
		}
		if (typeof file.target !== "string" || file.target.length === 0) {
			throw new Error(`manifest.files[${index}].target 必须是非空字符串`);
		}
		if (file.character !== undefined && typeof file.character !== "string") {
			throw new Error(`manifest.files[${index}].character 必须是字符串`);
		}
		return {
			role: file.role,
			character: file.character,
			target: file.target,
		};
	});
	return {
		generatedAt:
			typeof value.generatedAt === "string" ? value.generatedAt : null,
		files,
	};
}

export async function collectHealthReport(
	options: CollectHealthReportOptions,
): Promise<HealthReport> {
	const rawRoot = path.resolve(options.rawRoot);
	const manifest = await readSnapshotManifest(
		path.join(rawRoot, "manifest.json"),
	);
	const tokenEstimator = options.tokenEstimator ?? createTokenEstimator();
	const chatFiles = filesByRole(manifest, "chat");
	const cardFiles = filesByRole(manifest, "card");
	const worldFiles = filesByRole(manifest, "worldbook");
	const presetFiles = filesByRole(manifest, "preset");
	if (chatFiles.length === 0) {
		throw new Error("manifest 里没有 chat");
	}

	const chats: ChatReportEntry[] = [];
	for (const file of chatFiles) {
		chats.push({
			character: file.character ?? null,
			fileName: file.target,
			stats: await analyzeChat(resolveInside(rawRoot, file.target), {
				tokenEstimator,
			}),
		});
	}

	const entities = await analyzeEntityFiles(
		cardFiles.map((file) => resolveInside(rawRoot, file.target)),
		worldFiles.map((file) => resolveInside(rawRoot, file.target)),
	);
	const presets = await analyzePresetFiles(
		presetFiles.map((file) => resolveInside(rawRoot, file.target)),
		tokenEstimator,
	);

	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		manifestGeneratedAt: manifest.generatedAt,
		chats,
		entities,
		presets,
		totals: sumChats(chats),
	};
}

export function renderPrivateReport(report: HealthReport): string {
	const lines: string[] = [];
	lines.push("# M0 私有体检报告", "");
	lines.push(`生成时间：${report.generatedAt}`);
	if (report.manifestGeneratedAt) {
		lines.push(`快照生成时间：${report.manifestGeneratedAt}`);
	}
	lines.push(
		`数据源：${report.chats.length} 个对话、${report.entities.cards.length} 张卡、${report.entities.worlds.length} 本世界书、${report.presets.presetCount} 个预设。`,
	);
	lines.push("");
	lines.push("## 对话");
	lines.push("");
	lines.push(
		"| 角色 | 文件 | 楼层 | 用户 | 助手 | system | swipe | 文件字节 | 正文字节 | 变量字节 | 其他字节 |",
		"|---|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const chat of report.chats) {
		const stats = chat.stats;
		lines.push(
			`| ${cell(chat.character ?? "未知")} | ${cell(chat.fileName)} | ${stats.messageCount} | ${stats.roleCounts.user} | ${stats.roleCounts.assistant} | ${stats.roleCounts.system} | ${stats.swipeCount} | ${stats.fileBytes} | ${stats.bodyBytes} | ${stats.variablesBytes} | ${stats.otherBytes} |`,
		);
	}
	lines.push("");
	lines.push("## 每对话细节");
	for (const chat of report.chats) {
		lines.push("");
		lines.push(`### ${chat.character ?? "未知角色"}`);
		lines.push("");
		lines.push(`- 文件：${chat.fileName}`);
		lines.push(`- 文件字节：${chat.stats.fileBytes}`);
		lines.push(`- 消息序列化后的字节：${chat.stats.rawBytes}`);
		lines.push(`- 头部字节：${chat.stats.headerBytes}`);
		lines.push(`- 正文 token：${chat.stats.bodyTokens}`);
		lines.push(`- 全部 swipe 正文字节：${chat.stats.swipeBodyBytes}`);
		lines.push(`- 全部 swipe 正文 token：${chat.stats.swipeBodyTokens}`);
		lines.push(`- 变量字节：${chat.stats.variablesBytes}`);
		lines.push(`- 变量 token：${chat.stats.variablesTokens}`);
		lines.push(`- 其他字节：${chat.stats.otherBytes}`);
		lines.push(`- 其他 token：${chat.stats.otherTokens}`);
		lines.push(`- 主路径快照字节：${chat.stats.snapshotBytes}`);
		lines.push(`- 全部物理快照字节：${chat.stats.allSnapshotBytes}`);
		lines.push(
			`- diff 条数：${chat.stats.diffCount}，diff 字节：${chat.stats.diffBytes}，diff/快照：${formatPercent(ratio(chat.stats.diffBytes, chat.stats.snapshotBytes))}`,
		);
		lines.push(`- 助手回复数：${chat.stats.assistantReplyCount}`);
		lines.push(
			`- 重复度：相邻 ${chat.stats.duplication.pairs.length} 对，${chat.stats.duplication.ngramSize}-gram，平均 ${formatDecimal(meanSimilarity(chat.stats))}，持续上升起点：${chat.stats.duplication.riseStartFloor === null ? "无" : `第 ${chat.stats.duplication.riseStartFloor} 楼`}`,
		);
		if (chat.stats.duplication.peakWindow) {
			const peak = chat.stats.duplication.peakWindow;
			lines.push(
				`- 峰值窗口：第 ${peak.startFloor}–${peak.endFloor} 楼，均值 ${formatDecimal(peak.meanSimilarity)}`,
			);
		}
		lines.push("");
		lines.push("其他字段前 10：");
		lines.push("");
		lines.push("| 字段 | 字节 | 占其他比例 |");
		lines.push("|---|---|---|");
		for (const field of chat.stats.fieldBytes) {
			lines.push(
				`| ${cell(field.field)} | ${field.bytes} | ${formatPercent(ratio(field.bytes, chat.stats.otherBytes))} |`,
			);
		}
		if (chat.stats.duplication.windows.length > 0) {
			lines.push("");
			lines.push("重复度窗口：");
			lines.push("");
			lines.push("| 起始楼层 | 结束楼层 | 均值 |");
			lines.push("|---|---|---|");
			for (const window of chat.stats.duplication.windows) {
				lines.push(
					`| ${window.startFloor} | ${window.endFloor} | ${formatDecimal(window.meanSimilarity)} |`,
				);
			}
		}
	}
	lines.push("");
	lines.push("## 角色卡");
	lines.push("");
	lines.push("| 名称 | 规范 | 标签 | 备用开场 | 群聊开场 | 内嵌条目 |");
	lines.push("|---|---|---|---|---|---|");
	for (const card of report.entities.cards) {
		lines.push(
			`| ${cell(card.name)} | ${card.spec} | ${card.tagCount} | ${card.alternateGreetingCount} | ${card.groupOnlyGreetingCount} | ${card.embeddedBookEntryCount} |`,
		);
	}
	for (const card of report.entities.cards) {
		lines.push("");
		lines.push(`### 卡：${card.name}`);
		lines.push("");
		lines.push("| 字段 | 字节 |");
		lines.push("|---|---|");
		for (const field of card.fieldBytes) {
			lines.push(`| ${cell(field.field)} | ${field.bytes} |`);
		}
	}
	lines.push("");
	lines.push("## 世界书");
	lines.push("");
	lines.push(
		"| 名称 | 条目 | 启用 | 常驻 | 主关键词 | 次关键词 | 去重主关键词 | 正文字节 |",
		"|---|---|---|---|---|---|---|---|",
	);
	for (const world of report.entities.worlds) {
		lines.push(
			`| ${cell(world.name ?? "未知")} | ${world.entryCount} | ${world.enabledEntryCount} | ${world.constantEntryCount} | ${world.primaryKeywordCount} | ${world.secondaryKeywordCount} | ${world.distinctPrimaryKeywordCount} | ${world.contentBytes} |`,
		);
	}
	lines.push("");
	lines.push("## 预设");
	lines.push("");
	renderPresetDetails(lines, report.presets);
	return `${lines.join("\n")}\n`;
}

export function renderPublicReport(report: HealthReport): string {
	const lines: string[] = [];
	lines.push("# M0 体检报告（统计版）", "");
	lines.push(`生成时间：${report.generatedAt}`);
	lines.push(
		`数据源：${report.totals.chatCount} 个对话、${report.entities.totals.cardCount} 张角色卡、${report.entities.totals.worldCount} 本世界书、${report.presets.presetCount} 个预设。`,
	);
	lines.push("");
	lines.push(
		"字节按 UTF-8 计算。正文是当前 swipe 的原文，变量是消息里物理存储的 `variables`（包含所有 swipe），其他是消息对象重新序列化之后减去前两项。token 估算按中文 1.5 个字符算 1 个 token、其余字符 4 个算 1 个。",
	);
	lines.push("");
	lines.push("## 对话体量");
	lines.push("");
	lines.push(
		"| 对话 | 楼层 | 用户 | 助手 | system | swipe | 文件字节 | 正文字节 | 变量字节 | 其他字节 | 正文 token | 变量 token | 其他 token |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
	);
	report.chats.forEach((chat, index) => {
		const stats = chat.stats;
		lines.push(
			`| 对话 ${index + 1} | ${stats.messageCount} | ${stats.roleCounts.user} | ${stats.roleCounts.assistant} | ${stats.roleCounts.system} | ${stats.swipeCount} | ${stats.fileBytes} | ${stats.bodyBytes} | ${stats.variablesBytes} | ${stats.otherBytes} | ${stats.bodyTokens} | ${stats.variablesTokens} | ${stats.otherTokens} |`,
		);
	});
	lines.push(
		`| 合计 | ${report.totals.messageCount} | ${sumRole(report.chats, "user")} | ${sumRole(report.chats, "assistant")} | ${sumRole(report.chats, "system")} | ${report.totals.swipeCount} | ${report.totals.fileBytes} | ${report.totals.bodyBytes} | ${report.totals.variablesBytes} | ${report.totals.otherBytes} | ${report.totals.bodyTokens} | ${report.totals.variablesTokens} | ${report.totals.otherTokens} |`,
	);
	lines.push("");
	lines.push("其他字段里占比最大的字段（全部对话合计，不含正文和变量）：");
	lines.push("");
	lines.push("| 字段 | 字节 | 占其他比例 |");
	lines.push("|---|---|---|");
	for (const field of aggregateFields(report.chats)) {
		lines.push(
			`| ${cell(field.field)} | ${field.bytes} | ${formatPercent(ratio(field.bytes, report.totals.otherBytes))} |`,
		);
	}
	lines.push("");
	lines.push("## 状态存储");
	lines.push("");
	lines.push(
		"| 对话 | 主路径快照字节 | 原生 diff 字节 | diff 条数 | diff/快照 |",
		"|---|---|---|---|---|",
	);
	report.chats.forEach((chat, index) => {
		const stats = chat.stats;
		lines.push(
			`| 对话 ${index + 1} | ${stats.snapshotBytes} | ${stats.diffBytes} | ${stats.diffCount} | ${formatPercent(ratio(stats.diffBytes, stats.snapshotBytes))} |`,
		);
	});
	lines.push(
		`| 合计 | ${report.totals.snapshotBytes} | ${report.totals.diffBytes} | ${report.totals.diffCount} | ${formatPercent(ratio(report.totals.diffBytes, report.totals.snapshotBytes))} |`,
	);
	lines.push("");
	lines.push("## 重复度");
	lines.push("");
	lines.push(
		`相邻 AI 回复的字符 n-gram Jaccard 相似度：${ngramDescription(report)}。窗口均值按连续窗口统计，持续上升指连续 5 个窗口不下降且首尾上涨至少 0.02，起点均值不低于 0.03。`,
	);
	lines.push("");
	lines.push(
		"| 对话 | 相邻回复对 | 平均相似度 | 峰值窗口 | 峰值均值 | 持续上升起点 |",
	);
	lines.push("|---|---|---|---|---|---|");
	report.chats.forEach((chat, index) => {
		const duplication = chat.stats.duplication;
		const peak = duplication.peakWindow;
		lines.push(
			`| 对话 ${index + 1} | ${duplication.pairs.length} | ${formatDecimal(meanSimilarity(chat.stats))} | ${peak ? `${peak.startFloor}–${peak.endFloor} 楼` : "无"} | ${peak ? formatDecimal(peak.meanSimilarity) : "无"} | ${duplication.riseStartFloor === null ? "无" : `第 ${duplication.riseStartFloor} 楼`} |`,
		);
	});
	lines.push("");
	lines.push("## 实体");
	lines.push("");
	lines.push("| 指标 | 数量 |");
	lines.push("|---|---|");
	lines.push(`| 角色卡 | ${report.entities.totals.cardCount} |`);
	lines.push(`| 世界书 | ${report.entities.totals.worldCount} |`);
	lines.push(`| 世界书条目 | ${report.entities.totals.worldEntryCount} |`);
	lines.push(
		`| 启用的世界书条目 | ${report.entities.totals.enabledWorldEntryCount} |`,
	);
	lines.push(
		`| 常驻世界书条目 | ${report.entities.totals.constantWorldEntryCount} |`,
	);
	lines.push(
		`| 去重后的主关键词 | ${report.entities.totals.distinctPrimaryKeywordCount} |`,
	);
	lines.push(
		`| 卡内嵌世界书条目 | ${report.entities.totals.embeddedBookEntryCount} |`,
	);
	lines.push("");
	lines.push("| 卡 | 规范 | 标签 | 备用开场 | 群聊开场 | 内嵌条目 |");
	lines.push("|---|---|---|---|---|---|");
	report.entities.cards.forEach((card, index) => {
		lines.push(
			`| 卡 ${index + 1} | ${card.spec} | ${card.tagCount} | ${card.alternateGreetingCount} | ${card.groupOnlyGreetingCount} | ${card.embeddedBookEntryCount} |`,
		);
	});
	lines.push("");
	lines.push("## 预设");
	lines.push("");
	lines.push("| 指标 | 数量 |");
	lines.push("|---|---|");
	lines.push(`| 预设 | ${report.presets.presetCount} |`);
	lines.push(`| 提示词条目 | ${report.presets.promptCount} |`);
	lines.push(`| 启用的提示词条目 | ${report.presets.enabledPromptCount} |`);
	lines.push(`| marker 条目 | ${report.presets.markerPromptCount} |`);
	lines.push(`| 提示词正文字节 | ${report.presets.promptContentBytes} |`);
	lines.push(`| 提示词正文 token | ${report.presets.promptContentTokens} |`);
	lines.push(
		`| 带 assistant prefill 的预设 | ${report.presets.presetsWithAssistantPrefill} |`,
	);
	lines.push(
		`| 无法识别的 \`{{...}}\` | ${report.presets.unrecognizedMacroOccurrences} |`,
	);
	lines.push(`| 正则脚本 | ${report.presets.regexScriptCount} |`);
	lines.push(`| 停用的正则脚本 | ${report.presets.disabledRegexScriptCount} |`);
	lines.push("");
	lines.push("宏的使用频率（提示词正文，前 20）：");
	lines.push("");
	lines.push("| 宏 | 次数 | 涉及预设 |");
	lines.push("|---|---|---|");
	for (const macro of report.presets.macros.slice(0, 20)) {
		lines.push(
			`| ${cell(macro.name)} | ${macro.count} | ${macro.presetCount} |`,
		);
	}
	lines.push("");
	lines.push("正则作用范围：");
	lines.push("");
	lines.push("| 作用范围 | 脚本数 |");
	lines.push("|---|---|");
	for (const placement of report.presets.placements) {
		lines.push(`| ${cell(placement.label)} | ${placement.scriptCount} |`);
	}
	lines.push("");
	lines.push("正则开关与范围标记：");
	lines.push("");
	lines.push("| 标记 | 脚本数 |");
	lines.push("|---|---|");
	lines.push(`| markdownOnly | ${report.presets.markdownOnlyCount} |`);
	lines.push(`| promptOnly | ${report.presets.promptOnlyCount} |`);
	lines.push(`| runOnEdit | ${report.presets.runOnEditCount} |`);
	lines.push(`| 带深度限制 | ${report.presets.depthLimitedCount} |`);
	lines.push("");
	lines.push("findRegex 参数替换方式：");
	lines.push("");
	lines.push("| 方式 | 脚本数 |");
	lines.push("|---|---|");
	for (const substitute of report.presets.substituteRegex) {
		lines.push(`| ${cell(substitute.label)} | ${substitute.scriptCount} |`);
	}
	lines.push("");
	lines.push("## 方法");
	lines.push("");
	lines.push(
		"- 原生 diff 按 ADR-0005 的规则从相邻楼层快照生成，每条 diff 序列化为 `[path, op, value]` 后计字节。",
	);
	lines.push(
		"- 重复度按 Unicode 字符切分，默认 4-gram；窗口大小 20 对相邻回复，步长 10。",
	);
	lines.push(
		"- 实体数量是原始计数：世界书条目、启用的条目、去重后的主关键词、卡内嵌的条目。",
	);
	lines.push(
		"- 宏名取 `{{...}}` 里 `::` 之前、空白之前的第一个词，只统计英文字母开头的标识符；`{{// ...}}` 统一记为 `//`，其余写法计入无法识别的次数。",
	);
	return `${lines.join("\n")}\n`;
}

function renderPresetDetails(lines: string[], presets: PresetHealth): void {
	lines.push(`- 预设数：${presets.presetCount}`);
	lines.push(
		`- 提示词条目：${presets.promptCount}（启用 ${presets.enabledPromptCount}，marker ${presets.markerPromptCount}）`,
	);
	lines.push(
		`- 提示词正文字节：${presets.promptContentBytes}，token：${presets.promptContentTokens}`,
	);
	lines.push(
		`- 正则脚本：${presets.regexScriptCount}（停用 ${presets.disabledRegexScriptCount}）`,
	);
	lines.push(
		`- 无法识别的 \`{{...}}\` 次数：${presets.unrecognizedMacroOccurrences}`,
	);
	lines.push("");
	lines.push("宏：");
	lines.push("");
	lines.push("| 宏 | 次数 | 涉及预设 |");
	lines.push("|---|---|---|");
	for (const macro of presets.macros) {
		lines.push(
			`| ${cell(macro.name)} | ${macro.count} | ${macro.presetCount} |`,
		);
	}
	lines.push("");
	lines.push("正则作用范围：");
	lines.push("");
	lines.push("| 作用范围 | 脚本数 |");
	lines.push("|---|---|");
	for (const placement of presets.placements) {
		lines.push(`| ${cell(placement.label)} | ${placement.scriptCount} |`);
	}
	lines.push("");
	lines.push("正则标记：");
	lines.push("");
	lines.push(
		`- markdownOnly：${presets.markdownOnlyCount}`,
		`- promptOnly：${presets.promptOnlyCount}`,
		`- runOnEdit：${presets.runOnEditCount}`,
		`- 带深度限制：${presets.depthLimitedCount}`,
	);
}

function filesByRole(
	manifest: SnapshotManifest,
	role: string,
): readonly SnapshotManifestFile[] {
	return manifest.files.filter((file) => file.role === role);
}

function resolveInside(rawRoot: string, target: string): string {
	const resolved = path.resolve(rawRoot, target);
	const relative = path.relative(rawRoot, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`manifest 路径越界：${target}`);
	}
	return resolved;
}

function sumChats(chats: readonly ChatReportEntry[]): HealthTotals {
	const totals = {
		chatCount: chats.length,
		messageCount: 0,
		swipeCount: 0,
		fileBytes: 0,
		rawBytes: 0,
		bodyBytes: 0,
		variablesBytes: 0,
		otherBytes: 0,
		bodyTokens: 0,
		variablesTokens: 0,
		otherTokens: 0,
		snapshotBytes: 0,
		diffBytes: 0,
		diffCount: 0,
	};
	for (const chat of chats) {
		const stats = chat.stats;
		totals.messageCount += stats.messageCount;
		totals.swipeCount += stats.swipeCount;
		totals.fileBytes += stats.fileBytes;
		totals.rawBytes += stats.rawBytes;
		totals.bodyBytes += stats.bodyBytes;
		totals.variablesBytes += stats.variablesBytes;
		totals.otherBytes += stats.otherBytes;
		totals.bodyTokens += stats.bodyTokens;
		totals.variablesTokens += stats.variablesTokens;
		totals.otherTokens += stats.otherTokens;
		totals.snapshotBytes += stats.snapshotBytes;
		totals.diffBytes += stats.diffBytes;
		totals.diffCount += stats.diffCount;
	}
	return totals;
}

function aggregateFields(
	chats: readonly ChatReportEntry[],
): readonly { field: string; bytes: number }[] {
	const totals = new Map<string, number>();
	for (const chat of chats) {
		for (const field of chat.stats.fieldBytes) {
			totals.set(field.field, (totals.get(field.field) ?? 0) + field.bytes);
		}
	}
	return [...totals.entries()]
		.map(([field, bytes]) => ({ field, bytes }))
		.sort((left, right) => right.bytes - left.bytes)
		.slice(0, 10);
}

function sumRole(
	chats: readonly ChatReportEntry[],
	role: "user" | "assistant" | "system",
): number {
	return chats.reduce((total, chat) => total + chat.stats.roleCounts[role], 0);
}

function meanSimilarity(stats: ChatHealth): number {
	if (stats.duplication.pairs.length === 0) return 0;
	let total = 0;
	for (const pair of stats.duplication.pairs) total += pair.similarity;
	return total / stats.duplication.pairs.length;
}

function ngramDescription(report: HealthReport): string {
	const sizes = new Set(
		report.chats.map((chat) => chat.stats.duplication.ngramSize),
	);
	return sizes.size === 1
		? `${[...sizes][0]}-gram`
		: [...sizes].map((size) => `${size}-gram`).join("、");
}

function ratio(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : numerator / denominator;
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function formatDecimal(value: number): string {
	return value.toFixed(3);
}

function cell(text: string): string {
	return text.replaceAll("|", "\\|");
}

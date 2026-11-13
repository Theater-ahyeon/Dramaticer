import { type LlmRole, createTokenEstimator } from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import type { StPreset } from "../preset.js";
import {
	type StWorldInfoEntry,
	worldInfoFromCharacterBook,
} from "../world-info.js";
import { type StCardMappingIssue, mapCharacterCard } from "./card.js";
import type {
	StPresetEntryMapping,
	StPresetMapping,
	StPresetMappingIssue,
} from "./preset-mapping.js";

export type StPresetEntryCategory = "summary" | "planning";

export interface StContentCompatEntryReport {
	readonly identifier: string;
	readonly name: string;
	readonly kind: StPresetEntryMapping["kind"];
	readonly enabled: boolean;
	readonly role: LlmRole | null;
	readonly chars: number;
	readonly tokens: number;
	readonly reason: string | null;
	readonly category: StPresetEntryCategory | null;
}

export interface StContentCompatUnmappable {
	readonly identifier: string;
	readonly reason: string;
	readonly detail: string;
}

export interface StContentCompatDuplicate {
	readonly field: "identifier" | "name";
	readonly value: string;
	readonly count: number;
	readonly identifiers: readonly string[];
}

export interface StContentWorldInfoReport {
	readonly entries: number;
	readonly enabled: number;
	readonly disabled: number;
	readonly enabledTokens: number;
}

/** 兼容报告只含标识、名称、计数与原因，不含任何提示词正文。 */
export interface StContentCompatReport {
	readonly presetName: string | null;
	readonly cardName: string;
	readonly entries: readonly StContentCompatEntryReport[];
	readonly enabledEntries: number;
	readonly disabledEntries: number;
	/** 进入 prompt 的条目（静态段与深度注入）的估算 token。 */
	readonly promptTokens: number;
	/** 已启用但无法映射的条目估算 token；它们没有进入 prompt。 */
	readonly unmappedTokens: number;
	readonly tokensByKind: Readonly<Record<StPresetEntryMapping["kind"], number>>;
	readonly unknownMarkers: readonly string[];
	readonly unknownFields: readonly string[];
	readonly extensionKeys: readonly string[];
	readonly unmappable: readonly StContentCompatUnmappable[];
	readonly duplicates: readonly StContentCompatDuplicate[];
	readonly summaryEntries: readonly StContentCompatEntryReport[];
	readonly planningEntries: readonly StContentCompatEntryReport[];
	readonly worldInfo: StContentWorldInfoReport | null;
	readonly presetIssues: readonly StPresetMappingIssue[];
	readonly cardIssues: readonly StCardMappingIssue[];
}

const estimateTokens = createTokenEstimator();
const SUMMARY_PATTERN =
	/(^|[^a-z])(summar(y|ies|ize|ise|ization|isation)|recap|condense|compress)([^a-z]|$)/i;
const SUMMARY_CJK = /总结|摘要|概括|归纳/;
const PLANNING_PATTERN =
	/(^|[^a-z])(plan|planner|planning|outline|director)([^a-z]|$)/i;
const PLANNING_CJK = /规划|大纲|计划|导演/;
const MAPPED_KINDS: Readonly<Record<StPresetEntryMapping["kind"], boolean>> = {
	static: true,
	injection: true,
	slot: false,
	skipped: false,
	unmapped: false,
};
const UNMAPPABLE_REASONS: Readonly<Record<string, true>> = {
	role: true,
	"injection-depth": true,
	"injection-position": true,
	"marker-injection": true,
	"persona-depth": true,
};

/** 识别预设里的总结类与规划类条目；两者仍按酒馆的启用状态留在 prompt 里。 */
export function classifyStPresetEntry(
	identifier: string,
	name: string,
): StPresetEntryCategory | null {
	const label = `${identifier}\n${name}`;
	if (SUMMARY_PATTERN.test(identifier) || SUMMARY_CJK.test(label)) {
		return "summary";
	}
	if (PLANNING_PATTERN.test(identifier) || PLANNING_CJK.test(label)) {
		return "planning";
	}
	return null;
}

export interface StContentCompatReportInput {
	readonly preset: StPreset;
	readonly card: StCharacterCard;
	readonly mapping: StPresetMapping;
}

export function buildStContentCompatReport(
	input: StContentCompatReportInput,
): StContentCompatReport {
	const cardMapping = mapCharacterCard(input.card);
	const prompts = new Map(
		input.preset.prompts.map((prompt) => [prompt.identifier, prompt]),
	);
	const entries: StContentCompatEntryReport[] = input.mapping.entries.map(
		(entry) => {
			const name = prompts.get(entry.identifier)?.name ?? "";
			return {
				...entry,
				name,
				category: classifyStPresetEntry(entry.identifier, name),
			};
		},
	);
	const enabled = entries.filter((entry) => entry.enabled);
	const tokensByKind: Record<StPresetEntryMapping["kind"], number> = {
		static: 0,
		slot: 0,
		injection: 0,
		skipped: 0,
		unmapped: 0,
	};
	for (const entry of enabled) {
		tokensByKind[entry.kind] += entry.tokens;
	}
	const totalPromptTokens = enabled
		.filter((entry) => MAPPED_KINDS[entry.kind])
		.reduce((sum, entry) => sum + entry.tokens, 0);
	const unmappedTokens = enabled
		.filter((entry) => entry.kind === "unmapped")
		.reduce((sum, entry) => sum + entry.tokens, 0);
	const unknownMarkers = [
		...new Set(
			enabled
				.filter(
					(entry) =>
						entry.kind === "unmapped" && entry.reason === "unknown-marker",
				)
				.map((entry) => entry.identifier),
		),
	].sort();
	const unmappable: StContentCompatUnmappable[] = [];
	for (const entry of enabled) {
		const reason = entry.reason;
		if (reason === null || UNMAPPABLE_REASONS[reason] !== true) continue;
		unmappable.push({
			identifier: entry.identifier,
			reason,
			detail: describeUnmappable(reason, prompts.get(entry.identifier)),
		});
	}
	return {
		presetName: input.preset.name,
		cardName: input.card.name,
		entries,
		enabledEntries: enabled.length,
		disabledEntries: entries.length - enabled.length,
		promptTokens: totalPromptTokens,
		unmappedTokens,
		tokensByKind,
		unknownMarkers,
		unknownFields: cardMapping.report.unknownFields,
		extensionKeys: cardMapping.report.extensionKeys,
		unmappable,
		duplicates: detectDuplicates(enabled, prompts),
		summaryEntries: enabled.filter((entry) => entry.category === "summary"),
		planningEntries: enabled.filter((entry) => entry.category === "planning"),
		worldInfo: readWorldInfoReport(input.card),
		presetIssues: input.mapping.issues,
		cardIssues: cardMapping.report.issues,
	};
}

function describeUnmappable(
	reason: string,
	prompt:
		| {
				readonly role: string | null;
				readonly injectionDepth: number | null;
				readonly injectionPosition: number | null;
		  }
		| undefined,
): string {
	if (prompt === undefined) return reason;
	switch (reason) {
		case "role":
			return prompt.role ?? "system";
		case "injection-depth":
			return String(prompt.injectionDepth);
		case "injection-position":
		case "marker-injection":
			return String(prompt.injectionPosition);
		case "persona-depth":
			return "personaDescription";
		default:
			return reason;
	}
}

function detectDuplicates(
	enabled: readonly StContentCompatEntryReport[],
	prompts: ReadonlyMap<string, { readonly name: string }>,
): StContentCompatDuplicate[] {
	const duplicates: StContentCompatDuplicate[] = [];
	const byIdentifier = new Map<string, string[]>();
	for (const entry of enabled) {
		const list = byIdentifier.get(entry.identifier) ?? [];
		list.push(entry.identifier);
		byIdentifier.set(entry.identifier, list);
	}
	for (const [identifier, list] of byIdentifier) {
		if (list.length < 2) continue;
		duplicates.push({
			field: "identifier",
			value: identifier,
			count: list.length,
			identifiers: list,
		});
	}
	const byName = new Map<string, string[]>();
	for (const entry of enabled) {
		const name = prompts.get(entry.identifier)?.name ?? "";
		if (name.length === 0) continue;
		const list = byName.get(name) ?? [];
		list.push(entry.identifier);
		byName.set(name, list);
	}
	for (const [name, list] of byName) {
		if (list.length < 2) continue;
		duplicates.push({
			field: "name",
			value: name,
			count: list.length,
			identifiers: list,
		});
	}
	return duplicates;
}

function readWorldInfoReport(
	card: StCharacterCard,
): StContentWorldInfoReport | null {
	if (card.characterBook === null) return null;
	const world = worldInfoFromCharacterBook(card.characterBook, card.name);
	const enabled = world.entries.filter(
		(entry: StWorldInfoEntry) => !entry.disabled,
	);
	return {
		entries: world.entries.length,
		enabled: enabled.length,
		disabled: world.entries.length - enabled.length,
		enabledTokens: enabled.reduce(
			(sum, entry) => sum + estimateTokens(entry.content),
			0,
		),
	};
}

/** 一行摘要，给日志与共存评测的 notes 使用；不含正文。 */
export function summarizeStContentCompatReport(
	report: StContentCompatReport,
): string {
	const worldInfo =
		report.worldInfo === null
			? "无内嵌世界书"
			: `世界书启用 ${report.worldInfo.enabled}/${report.worldInfo.entries} 条、${report.worldInfo.enabledTokens} token`;
	return [
		`st-content：启用条目 ${report.enabledEntries} 条、进入 prompt ${report.promptTokens} token`,
		`无法映射 ${report.unmappable.length} 条、${report.unmappedTokens} token`,
		`未知 marker ${report.unknownMarkers.length} 个`,
		`重复条目 ${report.duplicates.length} 组`,
		`总结类 ${report.summaryEntries.length} 条、规划类 ${report.planningEntries.length} 条`,
		worldInfo,
	].join("；");
}

export function renderStContentCompatReport(
	report: StContentCompatReport,
): string {
	const lines: string[] = [];
	lines.push("# st-content 兼容报告");
	lines.push("");
	lines.push(`- 预设：${report.presetName ?? "未命名"}`);
	lines.push(`- 角色卡：${report.cardName}`);
	lines.push(
		`- 启用条目：${report.enabledEntries} 条（关闭 ${report.disabledEntries} 条），进入 prompt 的估算 token：${report.promptTokens}`,
	);
	lines.push(
		`- 无法映射的启用条目：${report.unmappable.length} 条，估算 token：${report.unmappedTokens}`,
	);
	lines.push(
		`- 分类：总结类 ${report.summaryEntries.length} 条，规划类 ${report.planningEntries.length} 条`,
	);
	lines.push("");
	lines.push("## 条目");
	lines.push("");
	lines.push("|标识|名称|类型|角色|字符数|估算 token|分类|原因|");
	lines.push("|---|---|---|---|---|---|---|---|");
	for (const entry of report.entries) {
		lines.push(
			`|${entry.identifier}|${entry.name}|${entry.kind}|${entry.role ?? "—"}|${entry.chars}|${entry.tokens}|${categoryLabel(entry.category)}|${entry.reason ?? "—"}|`,
		);
	}
	lines.push("");
	lines.push("## 未识别的 marker");
	lines.push("");
	if (report.unknownMarkers.length === 0) {
		lines.push("没有。");
	} else {
		for (const marker of report.unknownMarkers) lines.push(`- ${marker}`);
	}
	lines.push("");
	lines.push("## 未识别字段与扩展键");
	lines.push("");
	if (report.unknownFields.length === 0 && report.extensionKeys.length === 0) {
		lines.push("没有。");
	} else {
		if (report.unknownFields.length > 0) {
			lines.push(`- 未知字段：${report.unknownFields.join("、")}`);
		}
		if (report.extensionKeys.length > 0) {
			lines.push(`- 扩展键：${report.extensionKeys.join("、")}`);
		}
	}
	lines.push("");
	lines.push("## 无法映射的深度与角色");
	lines.push("");
	if (report.unmappable.length === 0) {
		lines.push("没有。");
	} else {
		lines.push("|标识|原因|细节|");
		lines.push("|---|---|---|");
		for (const item of report.unmappable) {
			lines.push(`|${item.identifier}|${item.reason}|${item.detail}|`);
		}
	}
	lines.push("");
	lines.push("## 重复条目");
	lines.push("");
	if (report.duplicates.length === 0) {
		lines.push("没有。");
	} else {
		lines.push("|字段|值|条数|标识|");
		lines.push("|---|---|---|---|");
		for (const item of report.duplicates) {
			lines.push(
				`|${item.field === "identifier" ? "标识" : "名称"}|${item.value}|${item.count}|${item.identifiers.join("、")}|`,
			);
		}
	}
	lines.push("");
	lines.push("## 总结类与规划类条目");
	lines.push("");
	if (
		report.summaryEntries.length === 0 &&
		report.planningEntries.length === 0
	) {
		lines.push("没有。");
	} else {
		if (report.summaryEntries.length > 0) {
			lines.push(
				`- 总结类：${report.summaryEntries.map((entry) => `${entry.identifier}（${entry.tokens} token）`).join("、")}`,
			);
		}
		if (report.planningEntries.length > 0) {
			lines.push(
				`- 规划类：${report.planningEntries.map((entry) => `${entry.identifier}（${entry.tokens} token）`).join("、")}`,
			);
		}
		lines.push("");
		lines.push(
			"两类条目按酒馆的启用状态留在 prompt 里，不改变条目的位置与顺序。",
		);
	}
	lines.push("");
	lines.push("## 世界书");
	lines.push("");
	if (report.worldInfo === null) {
		lines.push("角色卡没有内嵌世界书。");
	} else {
		lines.push(
			`- 条目 ${report.worldInfo.entries} 条，启用 ${report.worldInfo.enabled} 条、关闭 ${report.worldInfo.disabled} 条，启用条目的估算 token：${report.worldInfo.enabledTokens}`,
		);
	}
	lines.push("");
	lines.push("## 问题");
	lines.push("");
	if (report.presetIssues.length === 0 && report.cardIssues.length === 0) {
		lines.push("没有。");
	} else {
		lines.push("|来源|代码|细节|");
		lines.push("|---|---|---|");
		for (const issue of report.presetIssues) {
			lines.push(`|预设|${issue.code}|${issue.detail}|`);
		}
		for (const issue of report.cardIssues) {
			lines.push(`|角色卡|${issue.code}|${issue.detail}|`);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

function categoryLabel(category: StPresetEntryCategory | null): string {
	if (category === "summary") return "总结";
	if (category === "planning") return "规划";
	return "—";
}

import { type TokenEstimator, createTokenEstimator } from "../tokens.js";
import {
	IMPORT_ENTRY_KINDS,
	type ImportAuditEntry,
	type ImportEntryKind,
	type ImportEntryKindSource,
} from "./import-audit.js";
import type { LoreEntry } from "./lore.js";

/** 与世界书槽位相同的头行；估算只比较相对大小，不调用模型。 */
export const IMPORT_AUDIT_TOKEN_HEADER = "世界书条目：";

export interface ImportAuditKindCount {
	readonly kind: ImportEntryKind;
	readonly count: number;
}

/** 导入分型后每轮常驻量的前后对比；`before` 是现在的常驻条目全文。 */
export interface ImportAuditTokenEstimate {
	readonly before: number;
	readonly after: number;
	readonly beforeEntries: number;
	readonly afterEntries: number;
}

/** 逐条调整接口使用的轻量行：不带正文，避免整份体检载荷随条目变长。 */
export interface ImportAuditEntrySummary {
	readonly source: string;
	readonly title: string;
	readonly kind: ImportEntryKind;
	readonly kindSource: ImportEntryKindSource;
	readonly rulePrimary: ImportEntryKind;
	readonly constant: boolean;
	/** 已转为初始记忆的条目不再进入每轮常驻集合 */
	readonly memory: boolean;
	readonly contentChars: number;
}

/** 需要逐条查看的条目：未识别、作者选项与插件残留都带正文。 */
export interface ImportAuditReviewEntry {
	readonly source: string;
	readonly title: string;
	readonly content: string;
	readonly kind: ImportEntryKind;
	readonly kindSource: ImportEntryKindSource;
	readonly rulePrimary: ImportEntryKind;
	readonly memory: boolean;
}

export interface ImportAuditReport {
	readonly storyId: string;
	readonly total: number;
	/** 按 `IMPORT_ENTRY_KINDS` 的顺序，每类一条。 */
	readonly counts: readonly ImportAuditKindCount[];
	readonly entries: readonly ImportAuditEntrySummary[];
	readonly unknown: readonly ImportAuditReviewEntry[];
	readonly authorOptions: readonly ImportAuditReviewEntry[];
	readonly pluginResidue: readonly ImportAuditReviewEntry[];
	readonly tokens: ImportAuditTokenEstimate;
}

export interface BuildImportAuditReportInput {
	readonly storyId: string;
	readonly entries: readonly ImportAuditEntry[];
	readonly loreEntries: readonly LoreEntry[];
	readonly estimator?: TokenEstimator;
}

/**
 * 汇总导入体检数据：生效类型的条数、需要逐条查看的三组条目，以及分型后
 * 每轮常驻 token 的前后估算。
 *
 * 前后两侧都只算真正导入成 lore 的条目（停用、没有名称或空内容的条目不会
 * 进入任何一侧），已转成初始记忆的条目两边都不算：`before` 是原样模式每轮
 * 注入的常驻条目全文，`after` 是升级模式按类型注入后的常识全文加实体档案的
 * 标题与关键词索引。
 */
export function buildImportAuditReport(
	input: BuildImportAuditReportInput,
): ImportAuditReport {
	const estimator = input.estimator ?? createTokenEstimator();
	const loreBySource = new Map(
		input.loreEntries.map((entry) => [entry.source, entry] as const),
	);
	const counts = new Map<ImportEntryKind, number>(
		IMPORT_ENTRY_KINDS.map((kind) => [kind, 0]),
	);
	const beforeLines: string[] = [];
	const afterLines: string[] = [];
	const unknown: ImportAuditReviewEntry[] = [];
	const authorOptions: ImportAuditReviewEntry[] = [];
	const pluginResidue: ImportAuditReviewEntry[] = [];
	const entries: ImportAuditEntrySummary[] = [];

	for (const entry of input.entries) {
		counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
		entries.push({
			source: entry.source,
			title: entry.title,
			kind: entry.kind,
			kindSource: entry.kindSource,
			rulePrimary: entry.rulePrimary,
			constant: entry.constant,
			memory: entry.memory,
			contentChars: entry.content.length,
		});
		const review: ImportAuditReviewEntry = {
			source: entry.source,
			title: entry.title,
			content: entry.content,
			kind: entry.kind,
			kindSource: entry.kindSource,
			rulePrimary: entry.rulePrimary,
			memory: entry.memory,
		};
		if (entry.kind === "unknown") unknown.push(review);
		if (entry.kind === "options") authorOptions.push(review);
		if (entry.kind === "plugin-residue") pluginResidue.push(review);

		const lore = loreBySource.get(entry.source);
		if (lore === undefined) continue;
		if (entry.memory) continue;
		if (entry.constant) {
			beforeLines.push(`【常驻】${entry.title}：${entry.content}`);
		}
		if (entry.kind === "common") {
			afterLines.push(`${entry.title}：${entry.content}`);
		} else if (entry.kind === "entity") {
			const keywords = lore.keywords.join("、");
			afterLines.push(
				keywords.length === 0 ? entry.title : `${entry.title}：${keywords}`,
			);
		}
	}

	return {
		storyId: input.storyId,
		total: input.entries.length,
		counts: IMPORT_ENTRY_KINDS.map((kind) => ({
			kind,
			count: counts.get(kind) ?? 0,
		})),
		entries,
		unknown,
		authorOptions,
		pluginResidue,
		tokens: {
			before: estimateSection(estimator, beforeLines),
			after: estimateSection(estimator, afterLines),
			beforeEntries: beforeLines.length,
			afterEntries: afterLines.length,
		},
	};
}

function estimateSection(
	estimator: TokenEstimator,
	lines: readonly string[],
): number {
	if (lines.length === 0) return 0;
	return estimator([IMPORT_AUDIT_TOKEN_HEADER, ...lines].join("\n"));
}

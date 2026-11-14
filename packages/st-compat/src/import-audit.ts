import type { NewImportAuditEntry } from "@dramaticer/core";
import type { StWorldInfo } from "./world-info.js";
import { classifyWorldbookEntries } from "./worldbook-classify.js";

export interface WorldbookAuditOptions {
	/** 来源前缀，默认 `world-info`；完整来源是 `<前缀>:<世界书名称>:<条目键>`。 */
	readonly source?: string;
	/** 世界书名称；没有时用 `StWorldInfo.name`，再没有时用 `world`。 */
	readonly worldName?: string;
}

/**
 * 一本世界书的全部条目（含停用、没有名称与空内容）转成导入审计行。
 * 来源与 lore 条目一致，分型结果逐条保存；条目的正文与标题照原样记录。
 */
export function buildWorldbookAuditEntries(
	worldInfo: StWorldInfo,
	options: WorldbookAuditOptions = {},
): NewImportAuditEntry[] {
	const sourcePrefix = options.source ?? "world-info";
	const worldName = options.worldName ?? worldInfo.name ?? "world";
	const classification = classifyWorldbookEntries(worldInfo.entries);
	const bySourceKey = new Map(
		worldInfo.entries.map((entry) => [entry.sourceKey, entry]),
	);
	return classification.entries.map((classified) => {
		const entry = bySourceKey.get(classified.sourceKey);
		if (entry === undefined) {
			throw new Error(
				`分型结果里的条目 ${classified.sourceKey} 不在世界书 ${worldName} 里`,
			);
		}
		return {
			source: `${sourcePrefix}:${worldName}:${classified.sourceKey}`,
			title: classified.title,
			content: entry.content,
			matches: classified.matches,
			rulePrimary: classified.primaryKind,
			constant: entry.constant,
		};
	});
}

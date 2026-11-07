import { normalizeEntityName } from "../entity.js";

/** 世界书条目在核心模型里的通用形式；不出现任何酒馆专用字段名。 */
export interface LoreEntry {
	readonly id: string;
	readonly storyId: string;
	readonly entityId: string | null;
	readonly name: string;
	readonly content: string;
	/** 常驻条目每轮都注入，其余条目按关键词与实体命中检索。 */
	readonly constant: boolean;
	readonly keywords: readonly string[];
	/** 来源标记，同一故事里唯一，用它保证重复导入不会产生重复行。 */
	readonly source: string;
	readonly createdAt: string;
}

export interface NewLoreEntryInput {
	readonly id?: string;
	readonly storyId: string;
	readonly entityId?: string | null;
	readonly name: string;
	readonly content: string;
	readonly constant?: boolean;
	readonly keywords?: readonly string[];
	readonly source: string;
	readonly createdAt?: string;
}

/**
 * 计算一条非恒常条目对当前对话的命中分数：主关键词命中一次算一分，
 * 关联实体的名称或别名命中算两分。零分表示没有命中。
 */
export function loreEntryMatchScore(
	entry: LoreEntry,
	normalizedQuery: string,
	entityAliases: readonly string[],
): number {
	let score = 0;
	const seenKeywords = new Set<string>();
	for (const keyword of entry.keywords) {
		const normalized = normalizeEntityName(keyword);
		if (normalized.length === 0 || seenKeywords.has(normalized)) continue;
		seenKeywords.add(normalized);
		if (normalizedQuery.includes(normalized)) score += 1;
	}
	const seenEntities = new Set<string>();
	for (const alias of entityAliases) {
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0 || seenEntities.has(normalized)) continue;
		seenEntities.add(normalized);
		if (normalizedQuery.includes(normalized)) {
			score += 2;
			break;
		}
	}
	return score;
}

/** 条目去重用的内容键：同一实体或同一规范化正文只保留第一次出现。 */
export function loreEntryContentKey(entry: LoreEntry): string {
	return normalizeEntityName(entry.content);
}

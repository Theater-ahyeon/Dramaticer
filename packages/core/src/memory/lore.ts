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

/** 一个楼层按 BM25 预筛后的世界书结果；只存选中的非恒常条目 id。 */
export interface LorePrefilter {
	readonly nodeId: string;
	readonly storyId: string;
	readonly entryIds: readonly string[];
	readonly createdAt: string;
}

export interface NewLorePrefilterInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly entryIds: readonly string[];
	readonly createdAt?: string;
}

export interface LoreBm25Match {
	readonly entry: LoreEntry;
	readonly score: number;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const BM25_MIN_TOKEN_CHARS = 2;

/** 检索与索引共用同一套规范化后的二字窗口；中文不需要额外分词。 */
function bm25Tokens(text: string): string[] {
	const chars = [...normalizeEntityName(text)];
	if (chars.length < BM25_MIN_TOKEN_CHARS) return [];
	const tokens: string[] = [];
	for (let start = 0; start + BM25_MIN_TOKEN_CHARS <= chars.length; start++) {
		tokens.push(chars.slice(start, start + BM25_MIN_TOKEN_CHARS).join(""));
	}
	return tokens;
}

/**
 * 在内存里对世界书条目做 BM25 排序，只返回分数大于 0 的条目。
 * 分数相同时保持输入顺序；limit 是返回条数上限。
 */
export function rankLoreEntriesByBm25(
	entries: readonly LoreEntry[],
	query: string,
	limit: number,
): LoreBm25Match[] {
	if (!Array.isArray(entries)) {
		throw new Error("世界书条目必须是数组");
	}
	if (typeof query !== "string") {
		throw new Error("世界书预筛的查询必须是字符串");
	}
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("世界书预筛的条数必须是正整数");
	}
	const queryTokens = [...new Set(bm25Tokens(query))];
	if (entries.length === 0 || queryTokens.length === 0) return [];
	const documents = entries.map((entry) => {
		const tokens = [
			...bm25Tokens(entry.name),
			...bm25Tokens(entry.keywords.join(" ")),
			...bm25Tokens(entry.content),
		];
		const frequencies = new Map<string, number>();
		for (const token of tokens) {
			frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
		}
		return { entry, tokens, frequencies };
	});
	const totalLength = documents.reduce(
		(sum, document) => sum + document.tokens.length,
		0,
	);
	const averageLength = totalLength / documents.length;
	const scored = documents.map((document, index) => {
		let score = 0;
		for (const token of queryTokens) {
			const frequency = document.frequencies.get(token);
			if (frequency === undefined) continue;
			const matching = documents.filter((item) =>
				item.frequencies.has(token),
			).length;
			const idf = Math.log(
				1 + (documents.length - matching + 0.5) / (matching + 0.5),
			);
			const denominator =
				frequency +
				BM25_K1 *
					(1 - BM25_B + (BM25_B * document.tokens.length) / averageLength);
			score += (idf * frequency * (BM25_K1 + 1)) / denominator;
		}
		return { entry: document.entry, score, index };
	});
	return scored
		.filter((item) => item.score > 0)
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.slice(0, limit)
		.map(({ entry, score }) => ({ entry, score }));
}

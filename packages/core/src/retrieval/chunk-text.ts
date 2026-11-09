export interface ChunkTextOptions {
	/** 每块的最大字符数（按 Unicode 码点计）。 */
	readonly maxChars?: number;
	/** 相邻块的重复字符数。 */
	readonly overlapChars?: number;
}

export interface ParentChunkOptions extends ChunkTextOptions {
	/** 父段的最大字符数；单个段落超过它时整楼退化成一个父段。 */
	readonly parentMaxChars?: number;
}

/** 一个小块以及它所属的父段。 */
export interface ParentChunkText {
	/** 父段在楼层内的序号，从 0 开始。 */
	readonly parentOrdinal: number;
	/** 命中后注入的父段文本。 */
	readonly parentText: string;
	/** 写进全文索引的小块文本。 */
	readonly text: string;
}

const DEFAULTS = {
	maxChars: 400,
	overlapChars: 80,
	parentMaxChars: 1200,
} as const;

/** 索引策略：固定窗口是旧行为，父子分块检索小块并注入父段。 */
export type ChunkStrategy = "fixed" | "parent-child";

export const DEFAULT_CHUNK_STRATEGY: ChunkStrategy = "parent-child";

export function isChunkStrategy(value: unknown): value is ChunkStrategy {
	return value === "fixed" || value === "parent-child";
}

/**
 * 把一段文本切成固定长度的窗口，用于 BM25 基线。
 * 按码点切分，避免把代理对（emoji 等）拆成两半。
 */
export function chunkText(
	text: string,
	options: ChunkTextOptions = {},
): string[] {
	if (typeof text !== "string") {
		throw new Error("待分块的文本必须是字符串");
	}
	const maxChars = options.maxChars ?? DEFAULTS.maxChars;
	const overlapChars = options.overlapChars ?? DEFAULTS.overlapChars;
	if (!Number.isInteger(maxChars) || maxChars < 3) {
		throw new Error("分块长度必须是不小于 3 的整数");
	}
	if (
		!Number.isInteger(overlapChars) ||
		overlapChars < 0 ||
		overlapChars >= maxChars
	) {
		throw new Error("分块重叠必须是不小于 0、且小于分块长度的整数");
	}

	const chars = [...text.replaceAll("\r\n", "\n")];
	if (chars.length === 0) return [];
	if (chars.length <= maxChars) {
		const single = chars.join("").trim();
		return single === "" ? [] : [single];
	}

	const chunks: string[] = [];
	const step = maxChars - overlapChars;
	for (let start = 0; start < chars.length; start += step) {
		const end = Math.min(start + maxChars, chars.length);
		const chunk = chars.slice(start, end).join("").trim();
		if (chunk !== "") chunks.push(chunk);
		if (end === chars.length) break;
	}
	return chunks;
}

/**
 * 按段落边界切出父段，再在每个父段里切小块供全文检索。
 * 单个段落超过父段上限时无法保持段落完整，整楼退化成一个父段。
 */
export function chunkTextByParent(
	text: string,
	options: ParentChunkOptions = {},
): ParentChunkText[] {
	const parentMaxChars = options.parentMaxChars ?? DEFAULTS.parentMaxChars;
	if (!Number.isInteger(parentMaxChars) || parentMaxChars < 3) {
		throw new Error("父段长度必须是不小于 3 的整数");
	}
	const normalized = text.replaceAll("\r\n", "\n").trim();
	if (normalized === "") return [];
	const paragraphs = normalized
		.split(/\n+/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph !== "");
	if (paragraphs.some((paragraph) => [...paragraph].length > parentMaxChars)) {
		return chunkText(normalized, options).map((chunk) => ({
			parentOrdinal: 0,
			parentText: normalized,
			text: chunk,
		}));
	}
	const parents: string[] = [];
	let current = "";
	for (const paragraph of paragraphs) {
		if (current === "") {
			current = paragraph;
			continue;
		}
		if ([...current].length + 1 + [...paragraph].length <= parentMaxChars) {
			current = `${current}\n${paragraph}`;
		} else {
			parents.push(current);
			current = paragraph;
		}
	}
	if (current !== "") parents.push(current);
	return parents.flatMap((parentText, parentOrdinal) =>
		chunkText(parentText, options).map((chunk) => ({
			parentOrdinal,
			parentText,
			text: chunk,
		})),
	);
}

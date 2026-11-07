export interface ChunkTextOptions {
	/** 每块的最大字符数（按 Unicode 码点计）。 */
	readonly maxChars?: number;
	/** 相邻块的重复字符数。 */
	readonly overlapChars?: number;
}

const DEFAULTS = {
	maxChars: 400,
	overlapChars: 80,
} as const;

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

/** 可替换的 token 估算函数：输入文本，返回估算的 token 数。 */
export type TokenEstimator = (text: string) => number;

export interface TokenEstimatorOptions {
	/** 中日韩字符与全角标点的换算比例，默认 1.5 个字符算 1 个 token。 */
	readonly cjkCharsPerToken?: number;
	/** 其余字符的换算比例，默认 4 个字符算 1 个 token。 */
	readonly otherCharsPerToken?: number;
}

/**
 * 创建一个不依赖分词器的 token 估算函数。
 *
 * 中文按字符数估算、其余字符按 4 个字符估算，适合在体检报告里比较不同字段的相对大小。
 */
export function createTokenEstimator(
	options: TokenEstimatorOptions = {},
): TokenEstimator {
	const cjkCharsPerToken = options.cjkCharsPerToken ?? 1.5;
	const otherCharsPerToken = options.otherCharsPerToken ?? 4;
	if (!(cjkCharsPerToken > 0) || !(otherCharsPerToken > 0)) {
		throw new Error("token 换算比例必须是正数");
	}
	return (text: string): number => {
		let cjk = 0;
		let other = 0;
		for (const char of text) {
			if (isCjkCodePoint(char.codePointAt(0) as number)) {
				cjk += 1;
			} else {
				other += 1;
			}
		}
		return Math.ceil(cjk / cjkCharsPerToken + other / otherCharsPerToken);
	};
}

function isCjkCodePoint(codePoint: number): boolean {
	return (
		(codePoint >= 0x2e80 && codePoint <= 0x2fdf) ||
		(codePoint >= 0x3000 && codePoint <= 0x303f) ||
		(codePoint >= 0x3040 && codePoint <= 0x30ff) ||
		(codePoint >= 0x3100 && codePoint <= 0x312f) ||
		(codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
		(codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
		(codePoint >= 0xff00 && codePoint <= 0xffef) ||
		(codePoint >= 0x20000 && codePoint <= 0x2fa1f)
	);
}

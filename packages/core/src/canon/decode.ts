/**
 * 原著 txt 的编码识别：先看 BOM，再看无 BOM 的 UTF-16 特征，
 * 然后用严格 UTF-8 解码，失败再按 GB18030（含 GBK）解码。
 * 两种都失败就抛错，不做有损替换。
 */

export type CanonTextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "gb18030";

export const CANON_TEXT_ENCODINGS: readonly CanonTextEncoding[] = [
	"utf-8",
	"utf-16le",
	"utf-16be",
	"gb18030",
];

export interface DecodedCanonText {
	readonly text: string;
	readonly encoding: CanonTextEncoding;
}

function decodeStrict(encoding: CanonTextEncoding, bytes: Uint8Array): string {
	return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function hasBom(
	bytes: Uint8Array,
	first: number,
	second: number,
	third?: number,
): boolean {
	if (bytes.length < (third === undefined ? 2 : 3)) return false;
	if (bytes[0] !== first || bytes[1] !== second) return false;
	return third === undefined || bytes[2] === third;
}

/** BOM 缺失时，ASCII 为主的 UTF-16 会在奇数或偶数位上留下大量 0 字节。 */
function guessBomlessUtf16(bytes: Uint8Array): CanonTextEncoding | null {
	if (bytes.length < 4 || bytes.length % 2 !== 0) return null;
	let evenZeros = 0;
	let oddZeros = 0;
	const pairs = bytes.length / 2;
	for (let index = 0; index < bytes.length; index += 2) {
		if (bytes[index] === 0) evenZeros += 1;
		if (bytes[index + 1] === 0) oddZeros += 1;
	}
	const evenRate = evenZeros / pairs;
	const oddRate = oddZeros / pairs;
	if (oddRate > 0.3 && evenRate < 0.05) return "utf-16le";
	if (evenRate > 0.3 && oddRate < 0.05) return "utf-16be";
	return null;
}

export function decodeCanonBytes(bytes: Uint8Array): DecodedCanonText {
	if (bytes.length === 0) {
		throw new Error("原著文件是空的");
	}
	if (hasBom(bytes, 0xef, 0xbb, 0xbf)) {
		return { text: decodeStrict("utf-8", bytes), encoding: "utf-8" };
	}
	if (hasBom(bytes, 0xff, 0xfe)) {
		return { text: decodeStrict("utf-16le", bytes), encoding: "utf-16le" };
	}
	if (hasBom(bytes, 0xfe, 0xff)) {
		return { text: decodeStrict("utf-16be", bytes), encoding: "utf-16be" };
	}
	const utf16 = guessBomlessUtf16(bytes);
	if (utf16 !== null) {
		return { text: decodeStrict(utf16, bytes), encoding: utf16 };
	}
	try {
		return { text: decodeStrict("utf-8", bytes), encoding: "utf-8" };
	} catch {
		// 不是合法 UTF-8，继续试中文编码。
	}
	try {
		return { text: decodeStrict("gb18030", bytes), encoding: "gb18030" };
	} catch {
		throw new Error("无法识别原著文件的编码，只支持 UTF-8、UTF-16 与 GB18030");
	}
}

// v5 §3.5：出处用楼层锚点并宽松匹配原文。引文只用来定位与核对，不逐字也不打回；
// 后台写入只因两件事被拒：与玩家锁定的事实冲突、让未知情者知道了秘密。

const PUNCTUATION =
	/[\s!"'“”‘’《》〈〉()（）[\]{}【】。，、！？；：…—\-_,.;:?·~～「」『』]+/gu;

function normalize(text: string): string {
	return text.normalize("NFKC").replace(PUNCTUATION, "").toLowerCase();
}

function bigrams(text: string): Map<string, number> {
	const grams = new Map<string, number>();
	const chars = [...text];
	for (let index = 0; index < chars.length - 1; index += 1) {
		const gram = `${chars[index]}${chars[index + 1]}`;
		grams.set(gram, (grams.get(gram) ?? 0) + 1);
	}
	return grams;
}

/** 宽松匹配的重合度门槛：引文里至少这么多的相邻两字出现在原文里。 */
export const QUOTE_MATCH_THRESHOLD = 0.6;

/**
 * 引文是否出自这段原文：去掉标点与空白后包含即算；否则看相邻两字的重合度，
 * 改了几个字、换了标点或省略了半句都还认得出来。空引文不算匹配。
 */
export function quoteMatches(raw: string, quote: string): boolean {
	const needle = normalize(quote);
	if (needle.length === 0) return false;
	const haystack = normalize(raw);
	if (haystack.includes(needle)) return true;
	if ([...needle].length < 4) return false;
	const source = bigrams(haystack);
	const wanted = bigrams(needle);
	let total = 0;
	let hit = 0;
	for (const [gram, count] of wanted) {
		total += count;
		hit += Math.min(count, source.get(gram) ?? 0);
	}
	return total > 0 && hit / total >= QUOTE_MATCH_THRESHOLD;
}

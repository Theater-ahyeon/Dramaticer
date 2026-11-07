export interface ReplyText {
	/** 楼层号，从 1 开始。 */
	readonly floor: number;
	readonly text: string;
}

export interface DuplicationPair {
	readonly fromFloor: number;
	readonly toFloor: number;
	readonly similarity: number;
}

export interface DuplicationWindow {
	readonly startPair: number;
	readonly endPair: number;
	readonly startFloor: number;
	readonly endFloor: number;
	readonly meanSimilarity: number;
}

export interface DuplicationCurve {
	readonly ngramSize: number;
	readonly windowSize: number;
	readonly step: number;
	readonly pairs: readonly DuplicationPair[];
	readonly windows: readonly DuplicationWindow[];
	/** 找到持续上升的起点时，取该窗口第一对回复里靠前楼层的楼层号。 */
	readonly riseStartFloor: number | null;
	readonly peakWindow: DuplicationWindow | null;
}

export interface DuplicationOptions {
	readonly ngramSize?: number;
	readonly windowSize?: number;
	readonly step?: number;
	/** 判定"持续上升"需要连续满足的窗口数，默认 5。 */
	readonly riseWindows?: number;
	/** 连续窗口的均值至少要上涨这么多，默认 0.02。 */
	readonly riseDelta?: number;
	/** 上升起点的窗口均值下限，默认 0.03。 */
	readonly riseMinimum?: number;
}

const DEFAULT_NGRAM_SIZE = 4;
const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_STEP = 10;
const DEFAULT_RISE_WINDOWS = 5;
const DEFAULT_RISE_DELTA = 0.02;
const DEFAULT_RISE_MINIMUM = 0.03;

function assertPositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} 必须是正整数：${value}`);
	}
}

/** 按 Unicode 码点切分文本，生成字符 n-gram 集合。 */
export function charNgrams(text: string, size: number): Set<string> {
	if (!Number.isInteger(size) || size <= 0) {
		throw new Error(`n-gram 长度必须是正整数：${size}`);
	}
	const chars = Array.from(text);
	const grams = new Set<string>();
	if (chars.length < size) return grams;
	for (let index = 0; index + size <= chars.length; index += 1) {
		grams.add(chars.slice(index, index + size).join(""));
	}
	return grams;
}

export function jaccardSimilarity(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): number {
	if (left.size === 0 && right.size === 0) return 0;
	let intersection = 0;
	const [small, large] =
		left.size <= right.size ? [left, right] : [right, left];
	for (const gram of small) {
		if (large.has(gram)) intersection += 1;
	}
	const union = left.size + right.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/**
 * 计算相邻 AI 回复的重复度曲线。
 *
 * 相邻指按时间顺序紧挨着的两条 AI 回复，用户和 system 楼层不参与配对。
 * 曲线按窗口取均值，从第一个窗口开始每前进 step 对回复取一个窗口。
 * "持续上升"的判定：从某个窗口起连续 riseWindows 个窗口均值不下降，
 * 且首尾窗口均值上涨至少 riseDelta，并且起点均值不低于 riseMinimum。
 */
export function analyzeDuplication(
	replies: readonly ReplyText[],
	options: DuplicationOptions = {},
): DuplicationCurve {
	const ngramSize = options.ngramSize ?? DEFAULT_NGRAM_SIZE;
	const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
	const step = options.step ?? DEFAULT_STEP;
	const riseWindows = options.riseWindows ?? DEFAULT_RISE_WINDOWS;
	const riseDelta = options.riseDelta ?? DEFAULT_RISE_DELTA;
	const riseMinimum = options.riseMinimum ?? DEFAULT_RISE_MINIMUM;
	assertPositiveInteger(ngramSize, "ngramSize");
	assertPositiveInteger(windowSize, "windowSize");
	assertPositiveInteger(step, "step");
	assertPositiveInteger(riseWindows, "riseWindows");

	const pairs: DuplicationPair[] = [];
	let previous = replies[0];
	for (let index = 1; index < replies.length; index += 1) {
		const current = replies[index];
		pairs.push({
			fromFloor: previous.floor,
			toFloor: current.floor,
			similarity: jaccardSimilarity(
				charNgrams(previous.text, ngramSize),
				charNgrams(current.text, ngramSize),
			),
		});
		previous = current;
	}

	const windows: DuplicationWindow[] = [];
	for (let start = 0; start + windowSize <= pairs.length; start += step) {
		const end = start + windowSize;
		let total = 0;
		for (let index = start; index < end; index += 1) {
			total += pairs[index].similarity;
		}
		windows.push({
			startPair: start,
			endPair: end - 1,
			startFloor: pairs[start].fromFloor,
			endFloor: pairs[end - 1].toFloor,
			meanSimilarity: total / windowSize,
		});
	}

	let riseStartFloor: number | null = null;
	for (let start = 0; start + riseWindows <= windows.length; start += 1) {
		if (windows[start].meanSimilarity < riseMinimum) continue;
		let rising = true;
		for (let index = start; index + 1 < start + riseWindows; index += 1) {
			if (windows[index + 1].meanSimilarity < windows[index].meanSimilarity) {
				rising = false;
				break;
			}
		}
		if (!rising) continue;
		const delta =
			windows[start + riseWindows - 1].meanSimilarity -
			windows[start].meanSimilarity;
		if (delta < riseDelta) continue;
		riseStartFloor = windows[start].startFloor;
		break;
	}

	let peakWindow: DuplicationWindow | null = null;
	for (const window of windows) {
		if (!peakWindow || window.meanSimilarity > peakWindow.meanSimilarity) {
			peakWindow = window;
		}
	}

	return {
		ngramSize,
		windowSize,
		step,
		pairs,
		windows,
		riseStartFloor,
		peakWindow,
	};
}

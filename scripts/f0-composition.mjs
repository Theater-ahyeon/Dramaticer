// F0-T02.a：回复构成、编辑分类与楼层深度分桶。统计口径见 docs/dev/reports/F0-corpus.md。
import { parseBlocks } from "../packages/core/dist/blocks/index.js";

export const DEPTH_BUCKETS = Object.freeze([
	{ label: "1–10", min: 1, max: 10 },
	{ label: "11–50", min: 11, max: 50 },
	{ label: "51–100", min: 51, max: 100 },
	{ label: "101–200", min: 101, max: 200 },
	{ label: "201 以上", min: 201, max: Number.POSITIVE_INFINITY },
]);

export const EDIT_CATEGORIES = Object.freeze([
	"只差空白",
	"末尾追加",
	"只改标签块",
	"少量手改",
	"正文大改",
]);

export const TAG_CATEGORIES = Object.freeze([
	{
		label: "变量更新",
		names: ["UpdateVariable", "UpdateVariables", "UpdateVariableReasoning", "UpdateCalls", "JSONPatch", "json_patch"],
	},
	{
		label: "图片",
		names: ["image", "pic", "bbi_image", "SFW_IMG", "NSFW_IMG", "CG_SFW", "CG_NSFW"],
	},
	{
		label: "选项与交互输入",
		names: ["options", "option", "interactive_input", "bottom_option", "story_options"],
	},
	{ label: "表格编辑与表格思考", names: ["tableEdit", "tableThink"] },
	{
		label: "分析与摘要",
		names: ["analysis", "Analysis", "Analyze", "update_analysis", "summary", "SUMMARY", "thinking", "think", "simple_thinking"],
	},
]);

const SEGMENT_GAP_MS = 30 * 60 * 1000;
const MAX_GENERATION_MS = 24 * 60 * 60 * 1000;

export function depthBucketOf(floor) {
	if (!Number.isInteger(floor) || floor < 1) {
		throw new Error("楼层序号必须是正整数");
	}
	for (const bucket of DEPTH_BUCKETS) {
		if (floor >= bucket.min && floor <= bucket.max) return bucket.label;
	}
	throw new Error(`楼层序号超出分桶范围：${floor}`);
}

/** 相邻楼层间隔超过 30 分钟算新的会话段。 */
export function startsNewSegment(previousSendMs, currentSendMs) {
	if (!Number.isFinite(previousSendMs) || !Number.isFinite(currentSendMs)) return false;
	return currentSendMs - previousSendMs > SEGMENT_GAP_MS;
}

export function isPlausibleGeneration(startMs, finishMs) {
	if (!Number.isFinite(startMs) || !Number.isFinite(finishMs)) return false;
	const duration = finishMs - startMs;
	return duration >= 0 && duration <= MAX_GENERATION_MS;
}

export function countTagCategories(text) {
	const counts = new Map();
	if (typeof text !== "string" || text === "") return counts;
	for (const category of TAG_CATEGORIES) {
		let total = 0;
		for (const name of category.names) {
			const needle = `<${name}`;
			let index = text.indexOf(needle);
			while (index !== -1) {
				const next = text[index + needle.length];
				if (next === ">" || next === "/" || next === " " || next === "\n" || next === "\t" || next === "\r") total += 1;
				index = text.indexOf(needle, index + needle.length);
			}
		}
		if (total > 0) counts.set(category.label, (counts.get(category.label) ?? 0) + total);
	}
	return counts;
}

/** 发现没有属性的开标签名，供块解析器建立注册表。 */
export function discoverTagNames(text) {
	const names = new Set();
	if (typeof text !== "string") return names;
	for (const match of text.matchAll(/<([^\s<>/]+)>/g)) names.add(match[1]);
	return names;
}

export function createBlockTypes(names) {
	return [...names]
		.sort()
		.map((name) => ({
			name,
			display: { kind: "hidden" },
			context: { kind: "drop" },
			semantics: { kind: "none" },
		}));
}

/** 代码围栏的字符数：只认整行以 ``` 开头的围栏，行内围栏不配对。 */
export function measureFencedCodeChars(text) {
	const lines = text.split("\n");
	let total = 0;
	let inside = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const separator = index < lines.length - 1 ? 1 : 0;
		if (line.trimStart().startsWith("```")) {
			inside = !inside;
			total += line.length + separator;
			continue;
		}
		if (inside) total += line.length + separator;
	}
	return total;
}

function blockLength(block) {
	let total = block.name.length * 2 + 5;
	for (const item of block.content) {
		total += item.kind === "text" ? item.text.length : blockLength(item);
	}
	return total;
}

/**
 * 把一条回复拆成标签块、代码围栏与叙事正文。
 * 只统计已闭合的顶层标签块，未闭合的块按正文处理，避免把剩余全文误算成块。
 */
export function measureReplyComposition(text, types) {
	if (typeof text !== "string") throw new TypeError("measureReplyComposition 需要字符串");
	const content = parseBlocks(text, { types });
	let blockChars = 0;
	let codeChars = 0;
	for (const item of content) {
		if (item.kind === "block") {
			if (item.complete) blockChars += blockLength(item);
			continue;
		}
		codeChars += measureFencedCodeChars(item.text);
	}
	const chars = text.length;
	return {
		chars,
		blockChars,
		codeChars,
		narrativeChars: Math.max(0, chars - blockChars - codeChars),
	};
}

function narrativeOnly(text, types) {
	const content = parseBlocks(text, { types });
	let out = "";
	for (const item of content) {
		if (item.kind === "text") out += item.text;
		else if (!item.complete) out += item.raw;
	}
	return out;
}

function stripWhitespace(text) {
	return text.replace(/\s+/g, "");
}

function commonPrefixRatio(left, right) {
	const max = Math.max(left.length, right.length);
	if (max === 0) return 1;
	let index = 0;
	while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
	return index / max;
}

/**
 * 分类 `mes` 与 `swipes[swipe_id]` 的差异。玩家手改与插件改写无法区分，这里只按形态分类。
 */
export function classifyEdit(current, swipe, types) {
	if (typeof current !== "string" || typeof swipe !== "string") {
		throw new TypeError("classifyEdit 需要两个字符串");
	}
	if (current === swipe) return null;
	if (stripWhitespace(current) === stripWhitespace(swipe)) return "只差空白";
	const currentNarrative = stripWhitespace(narrativeOnly(current, types));
	const swipeNarrative = stripWhitespace(narrativeOnly(swipe, types));
	if (
		currentNarrative === swipeNarrative &&
		measureReplyComposition(current, types).blockChars + measureReplyComposition(swipe, types).blockChars > 0
	) {
		return "只改标签块";
	}
	if (current.length > swipe.length && current.startsWith(swipe) && current.slice(swipe.length).trim() !== "") {
		return "末尾追加";
	}
	const lengthDelta = Math.abs(currentNarrative.length - swipeNarrative.length);
	if (commonPrefixRatio(currentNarrative, swipeNarrative) >= 0.8 && lengthDelta <= 120) return "少量手改";
	return "正文大改";
}

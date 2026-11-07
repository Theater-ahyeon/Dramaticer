import type { StRegexScript } from "./preset.js";

/** DESIGN §6 的正则分类。 */
export type RegexCategory =
	| "html_render"
	| "html_script"
	| "delete"
	| "strip_cot"
	| "rewrite_capture"
	| "text_replace"
	| "streaming_variant"
	| "unclassified";

/** 删除类脚本影响哪个视图 */
export type DeleteScope = "display" | "prompt" | "both";

/** 升级之后由哪一层承担原来的正则效果 */
export type BlockStrategy =
	| "block_policy"
	| "renderer"
	| "sandbox_renderer"
	| "keep_regex";

export interface RegexUpgrade {
	readonly applicable: boolean;
	readonly strategy: BlockStrategy;
}

export interface CaptureReference {
	readonly kind: "number" | "named" | "whole";
	readonly number: number | null;
}

export interface RegexClassification {
	readonly category: RegexCategory;
	/** 只有 delete 与 strip_cot 有值 */
	readonly deleteScope: DeleteScope | null;
	readonly depthScoped: boolean;
	readonly rendersHtml: boolean;
	readonly hasInlineScript: boolean;
	readonly streaming: boolean;
	/** 正则唯一指向的标签名；指向多个或没有标签时为 null */
	readonly tagName: string | null;
	readonly tagNames: readonly string[];
	/** 正则匹配完整的 `<tag>…</tag>` 标签块，而不是零散片段 */
	readonly wholeTagBlock: boolean;
	/** 标签块正文落在捕获组里，渲染器才有内容可以渲染 */
	readonly bodyCaptured: boolean;
	readonly captureCount: number;
	readonly captureReferences: readonly CaptureReference[];
	readonly upgrade: RegexUpgrade;
}

export interface RegexParts {
	readonly source: string;
	readonly flags: string;
}

interface TagScan {
	readonly opens: ReadonlyMap<string, number>;
	readonly closes: ReadonlyMap<string, number>;
}

interface TagPair {
	readonly name: string;
	readonly openIndex: number;
	readonly closeIndex: number;
}

interface CoreClassification {
	readonly category: RegexCategory;
	readonly deleteScope: DeleteScope | null;
	readonly depthScoped: boolean;
	readonly rendersHtml: boolean;
	readonly hasInlineScript: boolean;
	readonly streaming: boolean;
	readonly tagName: string | null;
	readonly tagNames: readonly string[];
	readonly wholeTagBlock: boolean;
	readonly bodyCaptured: boolean;
	readonly captureCount: number;
	readonly captureReferences: readonly CaptureReference[];
}

/** 思考链标签，删除它们属于 strip_cot，而不是普通删除 */
const COT_TAGS: Readonly<Record<string, true>> = {
	think: true,
	thinking: true,
	reasoning: true,
	reason: true,
	cot: true,
	chain_of_thought: true,
	thought: true,
	analysis: true,
	scratchpad: true,
	disclose: true,
	reflection: true,
	konatan_planning: true,
	"konatan_planning~": true,
	思考: true,
};

const COT_NAME_HINTS = /思维链|思考|内心|reasoning|cot/i;

const STREAMING_NAME_HINTS =
	/流式|进行中|生成中|排练中|切镜中|校时中|写纸条中|摊纸中|酝酿中/;

/** 只收录真正的 HTML 元素名，避免把 `<content>`、`<options>` 这类自定义标签当成 HTML */
const HTML_ELEMENTS: ReadonlySet<string> = new Set([
	"a",
	"abbr",
	"address",
	"area",
	"article",
	"aside",
	"audio",
	"b",
	"base",
	"bdi",
	"bdo",
	"blockquote",
	"body",
	"br",
	"button",
	"canvas",
	"caption",
	"center",
	"cite",
	"code",
	"col",
	"colgroup",
	"data",
	"datalist",
	"dd",
	"del",
	"details",
	"dfn",
	"dialog",
	"div",
	"dl",
	"dt",
	"em",
	"embed",
	"fieldset",
	"figcaption",
	"figure",
	"font",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"head",
	"header",
	"hr",
	"html",
	"i",
	"iframe",
	"img",
	"input",
	"ins",
	"kbd",
	"label",
	"legend",
	"li",
	"link",
	"main",
	"map",
	"mark",
	"marquee",
	"menu",
	"meta",
	"meter",
	"nav",
	"object",
	"ol",
	"optgroup",
	"option",
	"output",
	"p",
	"picture",
	"pre",
	"progress",
	"q",
	"rp",
	"rt",
	"ruby",
	"s",
	"samp",
	"script",
	"section",
	"select",
	"small",
	"source",
	"span",
	"strong",
	"style",
	"sub",
	"summary",
	"sup",
	"svg",
	"table",
	"tbody",
	"td",
	"template",
	"textarea",
	"tfoot",
	"th",
	"thead",
	"time",
	"title",
	"tr",
	"track",
	"u",
	"ul",
	"var",
	"video",
	"wbr",
]);

/** 拆开酒馆的 `/pattern/flags` 写法；没有分隔符时整串当作 pattern。 */
export function parseRegexLiteral(findRegex: string): RegexParts {
	const text = findRegex.trim();
	if (!text.startsWith("/")) return { source: text, flags: "" };
	const end = text.lastIndexOf("/");
	if (end <= 0) return { source: text, flags: "" };
	const flags = text.slice(end + 1);
	if (!/^[a-z]*$/.test(flags)) return { source: text, flags: "" };
	return { source: text.slice(1, end), flags };
}

export function containsHtmlElement(text: string): boolean {
	if (/<!DOCTYPE\s+html/i.test(text) || /```html/i.test(text)) return true;
	for (const match of text.matchAll(/<([A-Za-z][A-Za-z0-9-]*)/g)) {
		if (HTML_ELEMENTS.has(match[1].toLowerCase())) return true;
	}
	return false;
}

export function containsInlineScript(text: string): boolean {
	return (
		/<script\b/i.test(text) ||
		/<iframe\b/i.test(text) ||
		/<object\b/i.test(text) ||
		/<embed\b/i.test(text) ||
		/\son[a-z]+\s*=/i.test(text) ||
		/javascript\s*:/i.test(text)
	);
}

/** 扫描正则里的捕获组：返回每个捕获组的左括号位置和编号。 */
export function scanCaptureGroups(source: string): readonly {
	index: number;
	number: number;
}[] {
	const groups: { index: number; number: number }[] = [];
	let number = 0;
	let inClass = false;
	for (let i = 0; i < source.length; i += 1) {
		const ch = source[i];
		if (ch === "\\") {
			i += 1;
			continue;
		}
		if (inClass) {
			if (ch === "]") inClass = false;
			continue;
		}
		if (ch === "[") {
			inClass = true;
			continue;
		}
		if (ch !== "(") continue;
		const next = source[i + 1];
		if (next !== "?") {
			number += 1;
			groups.push({ index: i, number });
			continue;
		}
		const after = source[i + 2];
		if (after === ":" || after === "=" || after === "!") continue;
		if (after === "<") {
			const modifier = source[i + 3];
			if (modifier === "=" || modifier === "!") continue;
			number += 1;
			groups.push({ index: i, number });
			continue;
		}
		if (after === "P" && source[i + 3] === "<") {
			number += 1;
			groups.push({ index: i, number });
			continue;
		}
		if (after !== undefined && /[a-zA-Z]/.test(after)) {
			// (?i:...) 这类修饰符组不是捕获组
			continue;
		}
		number += 1;
		groups.push({ index: i, number });
	}
	return groups;
}

/** 读取 replaceString 里的 `$1`、`$<name>`、`$&` 引用。 */
export function readCaptureReferences(
	replacement: string,
): readonly CaptureReference[] {
	const references: CaptureReference[] = [];
	for (const match of replacement.matchAll(/\$(?:\$|&|<[^>]*>|(\d{1,2}))/g)) {
		if (match[0] === "$$") continue;
		if (match[0] === "$&") {
			references.push({ kind: "whole", number: null });
			continue;
		}
		if (match[1] === undefined) {
			references.push({ kind: "named", number: null });
			continue;
		}
		references.push({ kind: "number", number: Number(match[1]) });
	}
	return references;
}

/** 命名组 `(?<name>` 里的 `<` 不是标签，扫描时跳过 */
const TAG_PATTERN =
	/<(\\*)(\/?)\??\s*(?:\((?:\?:)?\s*([\p{L}][\p{L}\p{N}_.:~-]*(?:\s*\|\s*[\p{L}][\p{L}\p{N}_.:~-]*)*)\s*\)|([\p{L}][\p{L}\p{N}_.:~-]*))/gu;

function scanTags(source: string): TagScan {
	const opens = new Map<string, number>();
	const closes = new Map<string, number>();
	for (const match of source.matchAll(TAG_PATTERN)) {
		const at = match.index;
		if (at >= 2 && source[at - 1] === "?" && source[at - 2] === "(") {
			continue;
		}
		const closesTag = match[2] === "/";
		const alternation = match[3];
		const single = match[4];
		const names =
			alternation === undefined
				? [single]
				: alternation.split("|").map((name) => name.trim());
		for (const name of names) {
			if (name === undefined || name === "") continue;
			const target = closesTag ? closes : opens;
			if (!target.has(name)) target.set(name, match.index);
		}
	}
	return { opens, closes };
}

function firstTagPair(scan: TagScan): TagPair | null {
	let best: TagPair | null = null;
	for (const [name, openIndex] of scan.opens) {
		const closeIndex = scan.closes.get(name);
		if (closeIndex === undefined || closeIndex <= openIndex) continue;
		if (best === null || openIndex < best.openIndex) {
			best = { name, openIndex, closeIndex };
		}
	}
	return best;
}

function findBalancedParen(source: string, openIndex: number): number {
	let depth = 0;
	let inClass = false;
	for (let i = openIndex; i < source.length; i += 1) {
		const ch = source[i];
		if (ch === "\\") {
			i += 1;
			continue;
		}
		if (inClass) {
			if (ch === "]") inClass = false;
			continue;
		}
		if (ch === "[") {
			inClass = true;
			continue;
		}
		if (ch === "(") depth += 1;
		else if (ch === ")") {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** 否定前瞻里出现闭合标签：作者在等一个还没写出来的 `</tag>`。 */
function hasUnclosedLookahead(source: string): boolean {
	let index = source.indexOf("(?!");
	while (index !== -1) {
		const close = findBalancedParen(source, index);
		if (close !== -1 && /<\\?\//.test(source.slice(index + 3, close))) {
			return true;
		}
		index = source.indexOf("(?!", index + 1);
	}
	return false;
}

/** 模式末尾是吞掉剩余输入的 `[\s\S]*`。 */
function hasWildcardTail(source: string): boolean {
	const tail = source.trim().replace(/\$+$/, "").replace(/\)+$/, "").trim();
	return (
		/\[\s*\\s\\S\s*\]\s*[*+]?\??$/.test(tail) || /\.\s*[*+]?\??$/.test(tail)
	);
}

function detectsStreaming(source: string, scriptName: string): boolean {
	if (hasUnclosedLookahead(source) && hasWildcardTail(source)) return true;
	return STREAMING_NAME_HINTS.test(scriptName);
}

function deleteScopeOf(script: StRegexScript): DeleteScope {
	if (script.markdownOnly && !script.promptOnly) return "display";
	if (script.promptOnly && !script.markdownOnly) return "prompt";
	return "both";
}

function classifyCore(script: StRegexScript): CoreClassification {
	const { source } = parseRegexLiteral(script.findRegex);
	const replacement = script.replaceString;
	const trimmed = replacement.trim();
	const scan = scanTags(source);
	const pair = firstTagPair(scan);
	const captures = scanCaptureGroups(source);
	const captureReferences = readCaptureReferences(replacement);
	const rendersHtml = containsHtmlElement(replacement);
	const hasInlineScript = containsInlineScript(replacement);
	const streaming = detectsStreaming(source, script.scriptName);
	const tagNames = [
		...new Set([...scan.opens.keys(), ...scan.closes.keys()]),
	].sort();
	const tagName = tagNames.length === 1 ? tagNames[0] : null;
	const deletes = trimmed === "";
	const cotTarget =
		tagNames.some((name) => Object.hasOwn(COT_TAGS, name)) ||
		(deletes && COT_NAME_HINTS.test(script.scriptName));
	const wholeTagBlock = pair !== null;
	const bodyCaptured =
		pair !== null &&
		captures.some(
			(group) => group.index > pair.openIndex && group.index < pair.closeIndex,
		);

	let category: RegexCategory;
	if (source.trim() === "") {
		category = "unclassified";
	} else if (streaming) {
		category = "streaming_variant";
	} else if (hasInlineScript) {
		category = "html_script";
	} else if (rendersHtml) {
		category = "html_render";
	} else if (deletes && cotTarget) {
		category = "strip_cot";
	} else if (deletes) {
		category = "delete";
	} else if (captureReferences.length > 0) {
		category = "rewrite_capture";
	} else if (trimmed !== "") {
		category = "text_replace";
	} else {
		category = "unclassified";
	}

	return {
		category,
		deleteScope:
			category === "delete" || category === "strip_cot"
				? deleteScopeOf(script)
				: null,
		depthScoped: script.minDepth !== null || script.maxDepth !== null,
		rendersHtml,
		hasInlineScript,
		streaming,
		tagName,
		tagNames,
		wholeTagBlock,
		bodyCaptured,
		captureCount: captures.length,
		captureReferences,
	};
}

function hasRenderSibling(
	core: CoreClassification,
	script: StRegexScript,
	siblings: readonly StRegexScript[],
): boolean {
	if (core.tagName === null) return false;
	return siblings.some((sibling) => {
		if (sibling === script) return false;
		const other = classifyCore(sibling);
		return other.category === "html_render" && other.tagName === core.tagName;
	});
}

function referencesInsideCaptures(core: CoreClassification): boolean {
	if (core.captureReferences.length === 0) return false;
	return core.captureReferences.every((reference) => {
		if (reference.kind === "named") return core.captureCount > 0;
		if (reference.kind === "whole") return true;
		return (
			reference.number !== null &&
			reference.number >= 1 &&
			reference.number <= core.captureCount
		);
	});
}

function decideUpgrade(
	core: CoreClassification,
	script: StRegexScript,
	siblings: readonly StRegexScript[],
): RegexUpgrade {
	if (core.hasInlineScript) {
		return { applicable: false, strategy: "sandbox_renderer" };
	}
	switch (core.category) {
		case "html_render":
			return core.wholeTagBlock &&
				core.bodyCaptured &&
				referencesInsideCaptures(core)
				? { applicable: true, strategy: "renderer" }
				: { applicable: false, strategy: "keep_regex" };
		case "html_script":
			return { applicable: false, strategy: "sandbox_renderer" };
		case "streaming_variant":
			return hasRenderSibling(core, script, siblings)
				? { applicable: true, strategy: "renderer" }
				: { applicable: false, strategy: "keep_regex" };
		case "strip_cot":
			return core.wholeTagBlock
				? { applicable: true, strategy: "block_policy" }
				: { applicable: false, strategy: "keep_regex" };
		case "delete":
			return core.wholeTagBlock
				? { applicable: true, strategy: "block_policy" }
				: { applicable: false, strategy: "keep_regex" };
		case "unclassified":
		case "rewrite_capture":
		case "text_replace":
			return { applicable: false, strategy: "keep_regex" };
	}
}

/** 分类单条正则；传入同一个预设里的其他脚本，用来判断流式版本能否合并进渲染器。 */
export function classifyRegexScript(
	script: StRegexScript,
	siblings: readonly StRegexScript[] = [],
): RegexClassification {
	const core = classifyCore(script);
	return { ...core, upgrade: decideUpgrade(core, script, siblings) };
}

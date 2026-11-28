import {
	BlockParser,
	type FloorRendererDefinition,
	type ParsedContent,
	escapeFloorHtml,
	isJsonObject,
} from "@dramaticer/core";
import { ST_HELPER_TAVERN_EVENTS } from "../st-helper-host/events.js";
import {
	ST_CONTENT_RENDERER_ID,
	ST_HELPER_RENDERER_ID,
	ST_RENDERER_PERMISSIONS,
	type StCardUiConfig,
} from "./config.js";
import { applyStDisplayRegexes, displayRegexPattern } from "./display.js";
import { buildStCardUiScript } from "./shim.js";

export const ST_CARD_UI_STYLE = `.st-card-ui { color: inherit; font: inherit; line-height: inherit; }
.st-card-ui #st-floor-root { white-space: pre-wrap; overflow-wrap: anywhere; }
.st-card-ui #st-floor-root[data-st-html="true"] { white-space: normal; }
.st-card-ui img { max-width: 100%; height: auto; }
.st-card-ui button { font: inherit; cursor: pointer; }`;

/**
 * 把 st-compat 的卡片配置变成原生楼层渲染器：显示层正则先变换原文，
 * 再套一层容器；助手脚本与交互桥垫片在同一 iframe 里运行。原文只读（I8）。
 */
export function createStCardFloorRenderer(
	config: StCardUiConfig | null,
): FloorRendererDefinition | null {
	if (config === null) return null;
	const regexActive = config.regexEnabled && config.regexes.length > 0;
	const helperActive = config.helperEnabled && config.scripts.length > 0;
	if (!regexActive && !helperActive) return null;
	const patterns: RegExp[] = [];
	if (regexActive) {
		for (const entry of config.regexes) {
			const pattern = displayRegexPattern(entry);
			if (pattern !== null) patterns.push(pattern);
		}
	}
	// 有启用的助手脚本时，楼层里没有正则命中也要进来跑一遍脚本。
	if (helperActive) patterns.push(/(?:)/);
	if (patterns.length === 0) return null;
	const id = helperActive ? ST_HELPER_RENDERER_ID : ST_CONTENT_RENDERER_ID;
	return {
		id,
		name: "酒馆卡片前端",
		patterns,
		permissions: [...ST_RENDERER_PERMISSIONS],
		render: (input) => {
			const visibleRaw = stripHiddenBlocksForDisplay(input.raw);
			const transformed = regexActive
				? applyStDisplayRegexes(
						visibleRaw,
						config.regexes,
						config.characterName,
					)
				: { text: visibleRaw, applied: false };
			const cleaned = stripResidualMvuTags(transformed.text);
			const unwrapped = transformed.applied
				? unwrapHtmlFences(cleaned)
				: cleaned;
			const htmlMode = transformed.applied && containsHtmlMarkup(unwrapped);
			const body = htmlMode
				? formatMixedStHtml(unwrapped)
				: escapeFloorHtml(unwrapped.trimEnd());
			const state = isJsonObject(input.state) ? input.state : null;
			const mvu = state !== null && isJsonObject(state.mvu) ? state.mvu : {};
			return {
				html: `<div class="st-card-ui"><div id="st-floor-root"${
					htmlMode ? ' data-st-html="true"' : ""
				}>${body}</div></div>`,
				style: ST_CARD_UI_STYLE,
				script: buildStCardUiScript({
					nodeId: input.nodeId,
					characterName: config.characterName,
					raw: input.raw,
					mvu,
					scripts: helperActive ? config.scripts : [],
					events: ST_HELPER_TAVERN_EVENTS,
				}),
			};
		},
	};
}

const VOID_HTML_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

function stripHiddenBlocksForDisplay(raw: string): string {
	const parser = new BlockParser();
	parser.push(raw);
	return renderVisibleContent(parser.finish()).trimEnd();
}

function renderVisibleContent(items: readonly ParsedContent[]): string {
	let output = "";
	for (const item of items) {
		if (item.kind === "text") {
			output += item.text;
			continue;
		}
		if (item.type.display.kind === "hidden") continue;
		const inner = renderVisibleContent(item.content);
		output += item.complete
			? `<${item.name}>${inner}</${item.name}>`
			: `<${item.name}>${inner}`;
	}
	return output;
}

function stripResidualMvuTags(text: string): string {
	return text
		.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, "")
		.replace(/<JSONPatch>[\s\S]*?<\/JSONPatch>/gi, "")
		.replace(/<StatusPlaceHolderImpl\s*\/?>/gi, "")
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n");
}

function unwrapHtmlFences(text: string): string {
	return text.replace(
		/```(?:html?|xml)?\s*\n([\s\S]*?)\n?```/gi,
		(full, inner: string) => {
			const trimmed = inner.trim();
			if (!/^(?:<!doctype\b|<[a-zA-Z])/i.test(trimmed)) return full;
			return trimmed
				.replace(/<!doctype[^>]*>\s*/gi, "")
				.replace(/<\/?(?:html|head|body)\b[^>]*>\s*/gi, "");
		},
	);
}

function containsHtmlMarkup(text: string): boolean {
	return /<[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?>/.test(text);
}

/**
 * HTML 模板往往带有缩进换行，但在它外面的纯文本段落又靠换行分段。
 * 只在闭合标签层级归零的纯文本间隙把换行转成 `<br>`，避免 HTML 卡片内部被撑出大段空白。
 */
function formatMixedStHtml(text: string): string {
	let result = "";
	let depth = 0;
	let index = 0;
	const emitText = (chunk: string) => {
		result += depth === 0 ? chunk.replaceAll("\n", "<br>") : chunk;
	};
	while (index < text.length) {
		const open = text.indexOf("<", index);
		if (open === -1) {
			emitText(text.slice(index));
			break;
		}
		if (open > index) {
			emitText(text.slice(index, open));
		}
		if (text.startsWith("<!--", open)) {
			const commentEnd = text.indexOf("-->", open + 4);
			const end = commentEnd === -1 ? text.length : commentEnd + 3;
			result += text.slice(open, end);
			index = end;
			continue;
		}
		const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/.exec(
			text.slice(open),
		);
		if (match === null) {
			emitText("<");
			index = open + 1;
			continue;
		}
		const closing = match[1] === "/";
		const tagName = (match[2] ?? "").toLowerCase();
		const rest = match[3] ?? "";
		const selfClosing =
			rest.trimEnd().endsWith("/") || VOID_HTML_TAGS.has(tagName);
		const tagEnd = open + match[0].length;
		if (!closing && (tagName === "script" || tagName === "style")) {
			const closeTag = new RegExp(`</${tagName}\\s*>`, "i");
			const closeMatch = closeTag.exec(text.slice(tagEnd));
			const end =
				closeMatch === null
					? text.length
					: tagEnd + closeMatch.index + closeMatch[0].length;
			result += text.slice(open, end);
			index = end;
			continue;
		}
		result += match[0];
		if (closing) {
			depth = Math.max(0, depth - 1);
		} else if (!selfClosing) {
			depth += 1;
		}
		index = tagEnd;
	}
	return result.trim();
}

import type { PluginDisplayState, StoryStore } from "@dramaticer/core";
import type { StHelperScript } from "./scripts.js";

/** HTML 状态栏与开场页的渲染结果在插件显示状态里的插件名。 */
export const ST_HELPER_HTML_PLUGIN_ID = "st-helper-host";

/** 两个页面在显示状态里的键；值是一次渲染的 HTML 快照。 */
export const ST_HELPER_HTML_DISPLAY_KEYS = {
	statusBar: "statusBar",
	openingPage: "openingPage",
} as const;

export type StHelperHtmlPageKind = keyof typeof ST_HELPER_HTML_DISPLAY_KEYS;

export interface StHelperHtmlFragment {
	/** `fenced` 是 ```html 围栏，`document` 是完整 `<html>` 文档，`message` 是整段正文。 */
	readonly kind: "fenced" | "document" | "message";
	readonly html: string;
}

const HTML_FENCE = /```[ \t]*html[ \t]*\r?\n([\s\S]*?)```/gi;
const HTML_DOCUMENT = /<html(?:\s[^>]*)?>[\s\S]*?<\/html\s*>/i;

/**
 * 从楼层或角色卡原文里取 HTML。只认三种载体：```html 围栏、完整
 * `<html>` 文档、以及整段正文就是一段 HTML。判断不解析 HTML 结构，
 * 所以夹杂在散文中间又没有任何标记的 HTML 不会被视为状态栏。
 */
export function extractStHelperHtmlFragments(
	raw: string,
): readonly StHelperHtmlFragment[] {
	if (typeof raw !== "string") {
		throw new Error("HTML 提取的原文必须是字符串");
	}
	const fenced: StHelperHtmlFragment[] = [];
	for (const match of raw.matchAll(HTML_FENCE)) {
		const html = match[1]?.trim() ?? "";
		if (html.length > 0) fenced.push({ kind: "fenced", html });
	}
	if (fenced.length > 0) return fenced;
	const document = HTML_DOCUMENT.exec(raw)?.[0];
	if (document !== undefined) return [{ kind: "document", html: document }];
	const trimmed = raw.trim();
	if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
		return [{ kind: "message", html: trimmed }];
	}
	return [];
}

export interface StHelperRenderRequest {
	readonly page: StHelperHtmlPageKind;
	readonly nodeId: string;
	readonly html: string;
	/** 卡片脚本库里的启用脚本，按脚本库顺序在页面脚本之后执行。 */
	readonly scripts: readonly string[];
}

export type StHelperRenderTraceOutcome =
	| "started"
	| "completed"
	| "failed"
	| "rejected";

/** 一次渲染请求的记录；C-T05.f 把它并入插件 Trace。 */
export interface StHelperRenderTraceEntry {
	readonly plugin: string;
	readonly kind: "render";
	readonly page: StHelperHtmlPageKind | null;
	readonly nodeId: string | null;
	readonly renderId: string | null;
	readonly outcome: StHelperRenderTraceOutcome;
	readonly reason: string | null;
	readonly at: string;
}

export interface StHelperHtmlRendererOptions {
	readonly store: StoryStore;
	readonly displayState: PluginDisplayState;
	/** 把渲染请求送到沙箱 iframe；返回渲染 id。渲染的正文只在 iframe 里。 */
	readonly start: (request: StHelperRenderRequest) => string;
	readonly scripts?: readonly StHelperScript[];
	/** 角色卡开场白；不传时 `renderOpeningPage` 必须显式给原文。 */
	readonly openingRaw?: string;
	readonly plugin?: string;
	/** 同一页面连续自动刷新（变量写入触发）的上限；超出后停止并记录。 */
	readonly maxAutoRefreshes?: number;
	readonly maxTraceEntries?: number;
	readonly now?: () => number;
	readonly onTrace?: (entry: StHelperRenderTraceEntry) => void;
}

interface PageState {
	readonly page: StHelperHtmlPageKind;
	readonly nodeId: string;
	readonly html: string;
}

const DEFAULT_MAX_AUTO_REFRESHES = 8;

/**
 * HTML 状态栏与开场页的宿主侧。渲染在沙箱 iframe 里进行：这里只提取
 * HTML、把请求交给调用方送进 iframe，再把快照写进插件显示状态。原文与
 * 台账都不改（I4、I12）。
 */
export class StHelperHtmlRenderer {
	readonly #store: StoryStore;
	readonly #displayState: PluginDisplayState;
	readonly #start: (request: StHelperRenderRequest) => string;
	readonly #scripts: readonly string[];
	readonly #openingRaw: string | null;
	readonly #plugin: string;
	readonly #maxAutoRefreshes: number;
	readonly #now: () => number;
	readonly #onTrace: ((entry: StHelperRenderTraceEntry) => void) | null;
	readonly #trace: StHelperRenderTraceEntry[] = [];
	readonly #maxTraceEntries: number;
	readonly #pages = new Map<string, PageState>();
	readonly #inflight = new Map<string, string>();
	readonly #renders = new Map<string, string>();
	readonly #pending = new Set<string>();
	readonly #autoCounts = new Map<string, number>();
	readonly #stopped = new Set<string>();

	constructor(options: StHelperHtmlRendererOptions) {
		const plugin = options.plugin ?? ST_HELPER_HTML_PLUGIN_ID;
		if (plugin.trim().length === 0) {
			throw new Error("HTML 渲染的插件名必须是非空字符串");
		}
		const limit = options.maxAutoRefreshes ?? DEFAULT_MAX_AUTO_REFRESHES;
		if (!Number.isInteger(limit) || limit < 0) {
			throw new Error("自动刷新上限必须是非负整数");
		}
		this.#store = options.store;
		this.#displayState = options.displayState;
		this.#start = options.start;
		this.#scripts = (options.scripts ?? [])
			.filter((script) => script.enabled && script.type === "script")
			.map((script) => script.content);
		this.#openingRaw = options.openingRaw ?? null;
		this.#plugin = plugin;
		this.#maxAutoRefreshes = limit;
		this.#maxTraceEntries = options.maxTraceEntries ?? 200;
		if (
			!Number.isInteger(this.#maxTraceEntries) ||
			this.#maxTraceEntries <= 0
		) {
			throw new Error("渲染 Trace 上限必须是正整数");
		}
		this.#now = options.now ?? Date.now;
		this.#onTrace = options.onTrace ?? null;
	}

	get trace(): readonly StHelperRenderTraceEntry[] {
		return [...this.#trace];
	}

	/** 从楼层原文提取 HTML 并开始渲染；没有 HTML 载体时返回 null。 */
	renderStatusBar(nodeId: string): string | null {
		const node = this.#requireNode(nodeId);
		return this.#render("statusBar", nodeId, node.raw);
	}

	/** 从角色卡开场白（或指定原文）提取 HTML 并开始渲染。 */
	renderOpeningPage(nodeId: string, raw?: string): string | null {
		this.#requireNode(nodeId);
		const source = raw ?? this.#openingRaw;
		if (source === null) {
			throw new Error("没有开场页原文；构造渲染器时要传 openingRaw");
		}
		if (typeof source !== "string") {
			throw new Error("开场页原文必须是字符串");
		}
		return this.#render("openingPage", nodeId, source);
	}

	/** 变量写入后按最近一次渲染的内容重新渲染所有状态栏。 */
	refreshStatusBars(): readonly string[] {
		const started: string[] = [];
		for (const [key, page] of [...this.#pages]) {
			if (page.page !== "statusBar") continue;
			const renderId = this.#begin(key, true);
			if (renderId !== null) started.push(renderId);
		}
		return started;
	}

	/** iframe 渲染完成：把快照写进显示状态，并执行排队中的自动刷新。 */
	complete(renderId: string, snapshot: string): void {
		if (typeof snapshot !== "string" || snapshot.length === 0) {
			throw new Error("渲染结果不能为空");
		}
		const key = this.#renders.get(renderId);
		if (key === undefined) {
			throw new Error(`未知的渲染请求：${renderId}`);
		}
		const page = this.#pages.get(key);
		if (page === undefined) {
			throw new Error(`渲染请求 ${renderId} 对应的页面已经移除`);
		}
		this.#displayState.set({
			nodeId: page.nodeId,
			plugin: this.#plugin,
			kind: "display",
			values: { [ST_HELPER_HTML_DISPLAY_KEYS[page.page]]: snapshot },
		});
		this.#renders.delete(renderId);
		this.#inflight.delete(key);
		this.#record(page, renderId, "completed", null);
		if (this.#pending.delete(key)) this.#begin(key, true);
	}

	/** iframe 渲染失败或超时：清掉进行中的请求，不写显示状态。 */
	fail(renderId: string, reason: string): void {
		const message =
			typeof reason === "string" && reason.length > 0 ? reason : "渲染失败";
		const key = this.#renders.get(renderId);
		if (key === undefined) {
			this.#record(null, renderId, "rejected", `未知的渲染请求：${renderId}`);
			return;
		}
		const page = this.#pages.get(key);
		this.#renders.delete(renderId);
		this.#inflight.delete(key);
		this.#pending.delete(key);
		if (page !== undefined) this.#record(page, renderId, "failed", message);
	}

	#render(
		page: StHelperHtmlPageKind,
		nodeId: string,
		raw: string,
	): string | null {
		const fragments = extractStHelperHtmlFragments(raw);
		if (fragments.length === 0) return null;
		const key = pageKey(page, nodeId);
		this.#stopped.delete(key);
		this.#pages.set(key, {
			page,
			nodeId,
			html: fragments.map((fragment) => fragment.html).join("\n"),
		});
		this.#autoCounts.set(key, 0);
		return this.#begin(key, false);
	}

	#begin(key: string, auto: boolean): string | null {
		const page = this.#pages.get(key);
		if (page === undefined) {
			throw new Error(`渲染页面不存在：${key}`);
		}
		if (this.#inflight.has(key)) {
			this.#pending.add(key);
			return null;
		}
		if (auto) {
			if (this.#stopped.has(key)) return null;
			const count = (this.#autoCounts.get(key) ?? 0) + 1;
			if (count > this.#maxAutoRefreshes) {
				this.#stopped.add(key);
				this.#record(
					page,
					null,
					"rejected",
					`自动刷新超过 ${this.#maxAutoRefreshes} 次，停止渲染`,
				);
				return null;
			}
			this.#autoCounts.set(key, count);
		}
		const renderId = this.#start({
			page: page.page,
			nodeId: page.nodeId,
			html: page.html,
			scripts: this.#scripts,
		});
		if (typeof renderId !== "string" || renderId.length === 0) {
			throw new Error("渲染请求没有返回 id");
		}
		if (this.#inflight.has(key)) {
			throw new Error(`页面 ${key} 已有进行中的渲染`);
		}
		this.#inflight.set(key, renderId);
		this.#renders.set(renderId, key);
		this.#record(page, renderId, "started", null);
		return renderId;
	}

	#requireNode(nodeId: string): { readonly raw: string } {
		if (typeof nodeId !== "string" || nodeId.length === 0) {
			throw new Error("渲染的楼层 id 必须是非空字符串");
		}
		const node = this.#store.getNode(nodeId);
		if (node === null) {
			throw new Error(`渲染的目标楼层不存在：${nodeId}`);
		}
		return node;
	}

	#record(
		page: PageState | null,
		renderId: string | null,
		outcome: StHelperRenderTraceOutcome,
		reason: string | null,
	): void {
		const entry: StHelperRenderTraceEntry = {
			plugin: this.#plugin,
			kind: "render",
			page: page?.page ?? null,
			nodeId: page?.nodeId ?? null,
			renderId,
			outcome,
			reason,
			at: new Date(this.#now()).toISOString(),
		};
		this.#trace.push(entry);
		if (this.#trace.length > this.#maxTraceEntries) this.#trace.shift();
		this.#onTrace?.(entry);
	}
}

function pageKey(page: StHelperHtmlPageKind, nodeId: string): string {
	return `${page}\u0000${nodeId}`;
}

/** 读显示状态里的渲染快照；还没有渲染过时返回 null。 */
export function readStHelperHtmlPage(
	displayState: PluginDisplayState,
	nodeId: string,
	page: StHelperHtmlPageKind,
	plugin = ST_HELPER_HTML_PLUGIN_ID,
): string | null {
	const value = displayState.getValue(
		nodeId,
		plugin,
		"display",
		ST_HELPER_HTML_DISPLAY_KEYS[page],
	);
	return typeof value === "string" ? value : null;
}

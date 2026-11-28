import {
	FLOOR_BRIDGE_CAPABILITIES,
	type FloorBridgeCapability,
	buildSandboxContentSecurityPolicy,
} from "@dramaticer/core/sandbox";
import {
	MAX_SANDBOX_HEIGHT,
	MIN_SANDBOX_HEIGHT,
	clampSandboxHeight,
} from "./sandbox";

/** iframe 只能用 allow-scripts；没有 allow-same-origin 才是不同源。 */
export const FLOOR_SANDBOX_ATTRIBUTES = "allow-scripts";

/** 父页面与楼层沙箱交换的消息上限。 */
export const MAX_FLOOR_BRIDGE_TEXT = 4_000;
export const MAX_FLOOR_VIOLATION_LENGTH = 500;

export const FLOOR_THEME_VARIABLES = [
	"--bg",
	"--bg2",
	"--sheet",
	"--paper",
	"--raise",
	"--field",
	"--ink",
	"--muted",
	"--slate",
	"--line",
	"--line-strong",
	"--soft",
	"--cinnabar",
	"--cinnabar-ink",
	"--cinnabar-wash",
	"--ok",
	"--bad",
	"--gold",
	"--gold-ink",
	"--teal",
	"--accent",
	"--accent-soft",
	"--f-display",
	"--f-prose",
	"--f-ui",
	"--f-data",
	"--lh-prose",
	"--t-base",
] as const;

export interface FloorSandboxTheme {
	/** 父页面的 `data-theme`；跟随系统时为空，由 iframe 的媒体查询决定。 */
	readonly dataTheme: string | null;
	readonly variables: Readonly<Record<string, string>>;
}

/** 把主界面的 CSS 变量抄进沙箱；主题切换时父页面再推一次。 */
export function readFloorSandboxTheme(): FloorSandboxTheme {
	const root = document.documentElement;
	const style = getComputedStyle(root);
	const variables: Record<string, string> = {};
	for (const name of FLOOR_THEME_VARIABLES) {
		const value = style.getPropertyValue(name).trim();
		if (value.length > 0) variables[name] = value;
	}
	// v4 的纸面颜色叫 --sheet；渲染面板统一用 --paper 这个名字。
	if (variables["--paper"] === undefined) {
		const paper = variables["--sheet"] ?? variables["--bg"];
		if (paper !== undefined) variables["--paper"] = paper;
	}
	return { dataTheme: root.dataset.theme ?? null, variables };
}

export interface FloorSandboxDocumentInput {
	readonly html: string;
	readonly script: string | null;
	readonly style: string | null;
	readonly allowedDomains: readonly string[];
	readonly theme: FloorSandboxTheme;
	/** 声明过的交互桥权限；父页面按它放行，iframe 只暴露白名单里的方法。 */
	readonly permissions: readonly FloorBridgeCapability[];
}

/**
 * 生成楼层渲染 iframe 的完整文档：CSP 按故事的允许名单生成，
 * 主题变量、交互桥、联网拦截与高度上报都在同一段只读脚本里。
 */
export function buildFloorSandboxDocument(
	input: FloorSandboxDocumentInput,
): string {
	const config = JSON.stringify({
		html: input.html,
		script: input.script,
		style: input.style,
		allowedDomains: input.allowedDomains,
		permissions: input.permissions,
		theme: input.theme,
		bridge: FLOOR_BRIDGE_CAPABILITIES,
	}).replaceAll("<", "\\u003c");
	const csp = buildSandboxContentSecurityPolicy(input.allowedDomains);
	const themeAttribute =
		input.theme.dataTheme === null || input.theme.dataTheme === ""
			? ""
			: ` data-theme="${escapeAttribute(input.theme.dataTheme)}"`;
	return `<!doctype html>
<html${themeAttribute}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
<style>
html { color-scheme: light; }
html[data-theme="dark"] { color-scheme: dark; }
@media (prefers-color-scheme: dark) {
	html:not([data-theme="light"]) { color-scheme: dark; }
}
html, body { margin: 0; padding: 0; background: transparent; }
body {
	color: var(--ink, #211d18);
	font: 18px / var(--lh-prose, 1.9) var(--f-prose, "Source Han Serif SC", serif);
}
img { max-width: 100%; height: auto; }
</style>
</head>
<body>
<div id="floor-root"></div>
<script>
(function () {
	"use strict";
	var config = ${config};
	var root = document.documentElement;
	var pending = new Map();
	var nextId = 1;

	function post(message) {
		parent.postMessage(message, "*");
	}

	function applyTheme(theme) {
		if (!theme) return;
		if (theme.dataTheme) root.setAttribute("data-theme", theme.dataTheme);
		else root.removeAttribute("data-theme");
		var variables = theme.variables || {};
		for (var name in variables) {
			root.style.setProperty(name, variables[name]);
		}
	}

	function postHeight() {
		var height = Math.ceil(
			Math.max(
				document.documentElement ? document.documentElement.scrollHeight : 0,
				document.body ? document.body.scrollHeight : 0
			)
		);
		post({ type: "floor:height", height: height });
	}

	var allowed = new Set(config.allowedDomains || []);

	function hostOf(url) {
		try {
			return new URL(String(url), document.baseURI).hostname.toLowerCase();
		} catch (error) {
			return "";
		}
	}

	function sandboxRefusal(target) {
		post({
			type: "floor:violation",
			kind: "network",
			target: String(target).slice(0, 500),
			reason: "沙箱默认禁止联网：" + hostOf(target)
		});
		throw new Error("沙箱拒绝联网请求：" + target);
	}

	function assertAllowed(url) {
		if (allowed.has(hostOf(url))) return;
		sandboxRefusal(url);
	}

	var nativeFetch = window.fetch;
	window.fetch = function (input) {
		assertAllowed(
			typeof input === "string" ? input : (input && input.url) || String(input)
		);
		return nativeFetch.apply(this, arguments);
	};
	var nativeOpen = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (method, url) {
		assertAllowed(url);
		return nativeOpen.apply(this, arguments);
	};
	var NativeWebSocket = window.WebSocket;
	window.WebSocket = function (url, protocols) {
		assertAllowed(url);
		return protocols === undefined
			? new NativeWebSocket(url)
			: new NativeWebSocket(url, protocols);
	};
	window.WebSocket.prototype = NativeWebSocket.prototype;
	document.addEventListener("securitypolicyviolation", function (event) {
		post({
			type: "floor:violation",
			kind: "network",
			target: String(event.blockedURI || "").slice(0, 500),
			reason: String(event.violatedDirective || "CSP").slice(0, 500)
		});
	});

	function call(method, args) {
		return new Promise(function (resolve, reject) {
			var id = nextId++;
			pending.set(id, { resolve: resolve, reject: reject });
			post({ type: "floor:bridge", id: id, method: method, args: args });
		});
	}

	var bridge = Object.create(null);
	config.bridge.forEach(function (name) {
		bridge[name] = function (value) {
			return call(name, [value]);
		};
	});
	Object.freeze(bridge);
	window.dramaticerBridge = bridge;

	window.addEventListener("message", function (event) {
		if (event.source !== parent) return;
		var data = event.data;
		if (!data || typeof data !== "object") return;
		if (data.type === "floor:bridge-result") {
			var entry = pending.get(data.id);
			if (entry === undefined) return;
			pending.delete(data.id);
			if (data.ok) entry.resolve(data.value);
			else entry.reject(new Error(data.error || "沙箱调用被拒绝"));
			return;
		}
		if (data.type === "floor:theme") {
			applyTheme(data.theme);
			postHeight();
		}
	});

	applyTheme(config.theme);
	if (config.style) {
		var style = document.createElement("style");
		style.textContent = config.style;
		document.head.appendChild(style);
	}
	var nativeAddEventListener = document.addEventListener.bind(document);
	var deferredReadyCallbacks = [];
	var deferDomContentLoaded = true;
	document.addEventListener = function (type, listener, options) {
		if (
			deferDomContentLoaded &&
			type === "DOMContentLoaded" &&
			typeof listener === "function"
		) {
			deferredReadyCallbacks.push(listener);
			return;
		}
		return nativeAddEventListener(type, listener, options);
	};
	if (config.html) {
		document.getElementById("floor-root").innerHTML = config.html;
	}
	if (config.script) {
		var script = document.createElement("script");
		script.textContent = config.script;
		document.body.appendChild(script);
	}
	if (config.html) {
		var floorRoot = document.getElementById("floor-root");
		var inlineScripts = floorRoot ? floorRoot.querySelectorAll("script") : [];
		for (var scriptIndex = 0; scriptIndex < inlineScripts.length; scriptIndex += 1) {
			var oldScript = inlineScripts[scriptIndex];
			var nextScript = document.createElement("script");
			for (var attrIndex = 0; attrIndex < oldScript.attributes.length; attrIndex += 1) {
				var attr = oldScript.attributes[attrIndex];
				nextScript.setAttribute(attr.name, attr.value);
			}
			if (!oldScript.src) {
				nextScript.textContent = oldScript.textContent || "";
			}
			if (oldScript.parentNode) {
				oldScript.parentNode.replaceChild(nextScript, oldScript);
			}
		}
	}
	deferDomContentLoaded = false;
	for (var readyIndex = 0; readyIndex < deferredReadyCallbacks.length; readyIndex += 1) {
		try {
			deferredReadyCallbacks[readyIndex].call(document, new Event("DOMContentLoaded"));
		} catch (error) {
			console.error("[floor-sandbox] DOMContentLoaded 回调失败", error);
		}
	}
	if (typeof ResizeObserver === "function") {
		new ResizeObserver(postHeight).observe(document.documentElement);
	}
	if (typeof MutationObserver === "function") {
		new MutationObserver(postHeight).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true
		});
	}
	window.addEventListener("load", postHeight);
	window.addEventListener("resize", postHeight);
	postHeight();
	post({ type: "floor:ready" });
})();
</script>
</body>
</html>`;
}

export type FloorSandboxMessage =
	| { readonly kind: "ready" }
	| { readonly kind: "height"; readonly height: number }
	| {
			readonly kind: "bridge";
			readonly id: number;
			readonly method: string;
			readonly args: readonly unknown[];
	  }
	| {
			readonly kind: "violation";
			readonly rejection: "bridge" | "network";
			readonly target: string;
			readonly reason: string;
	  };

/** 只认固定形状：其它消息一律忽略，不做任何反射式转发。 */
export function parseFloorSandboxMessage(
	value: unknown,
): FloorSandboxMessage | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const message = value as {
		readonly type?: unknown;
		readonly height?: unknown;
		readonly id?: unknown;
		readonly method?: unknown;
		readonly args?: unknown;
		readonly kind?: unknown;
		readonly target?: unknown;
		readonly reason?: unknown;
	};
	switch (message.type) {
		case "floor:ready":
			return { kind: "ready" };
		case "floor:height": {
			const height = message.height;
			if (typeof height !== "number" || !Number.isFinite(height)) return null;
			if (height < 0 || height > MAX_SANDBOX_HEIGHT) return null;
			return { kind: "height", height: clampSandboxHeight(height) };
		}
		case "floor:bridge": {
			const id = message.id;
			if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
				return null;
			}
			const method = message.method;
			if (
				typeof method !== "string" ||
				method.length === 0 ||
				method.length > 64
			) {
				return null;
			}
			if (!Array.isArray(message.args) || message.args.length > 8) return null;
			return { kind: "bridge", id, method, args: message.args };
		}
		case "floor:violation": {
			if (message.kind !== "bridge" && message.kind !== "network") return null;
			const target = message.target;
			const reason = message.reason;
			if (typeof target !== "string" || typeof reason !== "string") return null;
			return {
				kind: "violation",
				rejection: message.kind,
				target: target.slice(0, MAX_FLOOR_VIOLATION_LENGTH),
				reason: reason.slice(0, MAX_FLOOR_VIOLATION_LENGTH),
			};
		}
		default:
			return null;
	}
}

/** 楼层高度至少一像素，避免空 iframe 把布局挤掉。 */
export const MIN_FLOOR_HEIGHT = MIN_SANDBOX_HEIGHT;

function escapeAttribute(text: string): string {
	return text
		.split("&")
		.join("&amp;")
		.split('"')
		.join("&quot;")
		.split("<")
		.join("&lt;")
		.split(">")
		.join("&gt;");
}

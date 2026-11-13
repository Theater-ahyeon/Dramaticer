/**
 * 酒馆助手脚本的 iframe 沙箱：文档带最小 CSP，父页面只能用 postMessage
 * 与它交换普通 JSON。脚本在 iframe 里执行，拿不到父页面的对象、文件系统
 * 与网络；宿主 API 只暴露权限声明里列出的函数。
 */

export const ST_HELPER_SANDBOX_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

/** iframe 必须使用这个 sandbox 属性；没有 allow-same-origin 才是不同源。 */
export const ST_HELPER_SANDBOX_ATTRIBUTES = "allow-scripts";

export interface StHelperSandboxFrameReady {
	readonly type: "st-helper:ready";
}

export interface StHelperSandboxFrameCall {
	readonly type: "st-helper:call";
	readonly execution: string;
	readonly id: number;
	readonly name: string;
	readonly args: readonly unknown[];
}

export interface StHelperSandboxFrameDone {
	readonly type: "st-helper:done";
	readonly execution: string;
	readonly ok: boolean;
	readonly error?: string;
}

export type StHelperSandboxFrameMessage =
	| StHelperSandboxFrameReady
	| StHelperSandboxFrameCall
	| StHelperSandboxFrameDone;

/** 白名单：ready、call 与 done；其余消息一律忽略。 */
export function parseHelperSandboxFrameMessage(
	value: unknown,
): StHelperSandboxFrameMessage | null {
	if (!isPlainObject(value)) return null;
	if (value.type === "st-helper:ready") {
		return Object.keys(value).length === 1 ? { type: "st-helper:ready" } : null;
	}
	if (value.type === "st-helper:call") {
		if (
			!isNonEmptyString(value.execution) ||
			!isNonNegativeInteger(value.id) ||
			!isNonEmptyString(value.name) ||
			!Array.isArray(value.args)
		) {
			return null;
		}
		return {
			type: "st-helper:call",
			execution: value.execution,
			id: value.id,
			name: value.name,
			args: value.args,
		};
	}
	if (value.type === "st-helper:done") {
		if (
			!isNonEmptyString(value.execution) ||
			typeof value.ok !== "boolean" ||
			(value.error !== undefined && typeof value.error !== "string")
		) {
			return null;
		}
		return {
			type: "st-helper:done",
			execution: value.execution,
			ok: value.ok,
			...(value.error === undefined ? {} : { error: value.error }),
		};
	}
	return null;
}

export interface StHelperSandboxDocumentOptions {
	/** 允许脚本调用的宿主 API；不在名单里的函数不会出现在 iframe 里。 */
	readonly functions: readonly string[];
	readonly events: Readonly<Record<string, string>>;
}

/**
 * 生成 iframe 的完整 srcdoc。配置与脚本正文都以文本插入，不做 HTML 解析；
 * 只有这段文档在沙箱里运行。
 */
export function buildStHelperSandboxDocument(
	options: StHelperSandboxDocumentOptions,
): string {
	const config = JSON.stringify({
		functions: options.functions,
		events: options.events,
	}).replaceAll("<", "\\u003c");
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ST_HELPER_SANDBOX_CSP}">
<style>
html, body { margin: 0; padding: 0; background: transparent; color: #ddd; font: 14px/1.5 system-ui, sans-serif; }
</style>
</head>
<body>
<script>
(function () {
	"use strict";
	const config = ${config};
	const allowed = new Set(config.functions);
	const events = config.events;
	const pending = new Map();
	const listeners = new Map();
	const tokenToListener = new Map();
	let nextCallId = 1;
	let nextToken = 1;
	let current = null;
	let running = false;

	function post(message) {
		parent.postMessage(message, "*");
	}

	function fail(execution, error) {
		post({
			type: "st-helper:done",
			execution: execution,
			ok: false,
			error: error && error.message ? error.message : String(error),
		});
	}

	function call(name, args) {
		return new Promise(function (resolve, reject) {
			const id = nextCallId++;
			pending.set(id, { resolve: resolve, reject: reject });
			post({
				type: "st-helper:call",
				execution: current,
				id: id,
				name: name,
				args: args,
			});
		});
	}

	function removeListenerToken(token) {
		const entry = listeners.get(token);
		if (entry === undefined) return;
		listeners.delete(token);
		tokenToListener.delete(entry.listener);
	}

	const api = Object.create(null);

	if (allowed.has("updateVariablesWith")) {
		api.updateVariablesWith = async function (updater, options) {
			const variables = await api.getVariables(options);
			const next = updater(variables);
			await api.replaceVariables(next, options);
			return next;
		};
	}

	function addListener(type, listener, once) {
		const token = nextToken++;
		listeners.set(token, { type: type, listener: listener, once: once });
		tokenToListener.set(listener, token);
		call("eventOn", [type, token, { once: once }]).catch(function (error) {
			removeListenerToken(token);
			console.error(error);
		});
		return token;
	}

	function stopToken(type, token) {
		removeListenerToken(token);
		call("eventRemoveListener", [type, token]).catch(function () {});
	}

	if (allowed.has("eventOn")) {
		api.eventOn = function (type, listener, options) {
			const once = options !== undefined && options.once === true;
			const token = addListener(type, listener, once);
			return {
				stop: function () {
					stopToken(type, token);
				},
			};
		};
	}

	if (allowed.has("eventOnce")) {
		api.eventOnce = function (type, listener) {
			const token = addListener(type, listener, true);
			return {
				stop: function () {
					stopToken(type, token);
				},
			};
		};
	}

	if (allowed.has("eventRemoveListener")) {
		api.eventRemoveListener = function (type, listener) {
			const token = tokenToListener.get(listener);
			if (token === undefined) return;
			stopToken(type, token);
		};
	}

	if (allowed.has("eventClearEvent")) {
		api.eventClearEvent = function (type) {
			for (const [token, entry] of listeners) {
				if (entry.type === type) removeListenerToken(token);
			}
			call("eventClearEvent", [type]).catch(function () {});
		};
	}

	if (allowed.has("eventClearAll")) {
		api.eventClearAll = function () {
			listeners.clear();
			tokenToListener.clear();
			call("eventClearAll", []).catch(function () {});
		};
	}

	if (allowed.has("eventEmit")) {
		api.eventEmit = function (type) {
			const args = Array.prototype.slice.call(arguments, 1);
			return call("eventEmit", [type].concat(args));
		};
	}

	for (const name of config.functions) {
		if (api[name] !== undefined) continue;
		api[name] = function () {
			return call(name, Array.prototype.slice.call(arguments));
		};
	}

	for (const [name, fn] of Object.entries(api)) {
		window[name] = fn;
	}
	window.TavernHelper = Object.assign({ tavern_events: events }, api);
	window.tavern_events = events;

	function done(execution, ok, error) {
		if (ok) {
			post({ type: "st-helper:done", execution: execution, ok: true });
		} else {
			fail(execution, error);
		}
		running = false;
		current = null;
	}

	window.__stHelperSandboxDone = done;

	window.addEventListener("error", function (event) {
		if (!running || current === null) return;
		done(current, false, event.error || event.message);
	});

	window.addEventListener("message", function (event) {
		if (event.source !== parent) return;
		const data = event.data;
		if (!data || typeof data !== "object") return;
		if (data.type === "st-helper:result") {
			const entry = pending.get(data.id);
			if (entry === undefined) return;
			pending.delete(data.id);
			if (data.ok) entry.resolve(data.value);
			else entry.reject(new Error(data.error || "宿主调用失败"));
			return;
		}
		if (data.type === "st-helper:event") {
			const entry = listeners.get(data.token);
			if (entry === undefined) return;
			if (entry.once) removeListenerToken(data.token);
			try {
				entry.listener.apply(undefined, data.args);
			} catch (error) {
				console.error(error);
			}
			return;
		}
		if (data.type === "st-helper:clear") {
			if (data.event === null) {
				listeners.clear();
				tokenToListener.clear();
			} else {
				for (const [token, entry] of listeners) {
					if (entry.type === data.event) removeListenerToken(token);
				}
			}
			return;
		}
		if (data.type === "st-helper:run") {
			if (running) {
				fail(data.execution, new Error("上一个脚本还没有结束"));
				return;
			}
			running = true;
			current = data.execution;
			const execution = data.execution;
			const element = document.createElement("script");
			element.textContent =
				"(async function () {\\n" +
				data.content +
				"\\n})().then(function () { window.__stHelperSandboxDone(" +
				JSON.stringify(execution) +
				", true); }, function (error) { window.__stHelperSandboxDone(" +
				JSON.stringify(execution) +
				", false, error); });";
			document.body.appendChild(element);
		}
	});

	post({ type: "st-helper:ready" });
})();
</script>
</body>
</html>`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

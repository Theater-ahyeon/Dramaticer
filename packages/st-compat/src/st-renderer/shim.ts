import type { JsonValue } from "@dramaticer/core";
import type { StHelperScript } from "../st-helper-host/scripts.js";

/**
 * 楼层沙箱里的酒馆前端垫片：把 `getVariables` 一类叫法映射到
 * `window.dramaticerBridge`，变量落在台账的 `mvu.*` 命名空间，写入由服务端
 * 结算器校验（I16）。读走本地缓存，保持酒馆脚本习惯的同步调用。
 */
export interface StCardUiScriptInput {
	readonly nodeId: string;
	readonly characterName: string;
	readonly raw: string;
	readonly mvu: JsonValue;
	readonly scripts: readonly Pick<StHelperScript, "id" | "name" | "content">[];
	readonly events: Readonly<Record<string, string>>;
}

export function buildStCardUiScript(input: StCardUiScriptInput): string {
	const bootstrap = JSON.stringify({
		nodeId: input.nodeId,
		characterName: input.characterName,
		raw: input.raw,
		mvu: input.mvu,
		events: input.events,
	}).replaceAll("<", "\\u003c");
	const scriptsJson = JSON.stringify(
		input.scripts.map((script) => ({
			name: script.name,
			content: script.content,
			isModule: isEsModuleScript(script.content),
		})),
	).replaceAll("<", "\\u003c");
	return String.raw`(function () {
	"use strict";
	var boot = ${bootstrap};
	var local = isObject(boot.mvu) ? clone(boot.mvu) : {};
	var listeners = Object.create(null);

	function isObject(value) {
		return value !== null && typeof value === "object" && !Array.isArray(value);
	}
	function clone(value) {
		if (value === undefined) return undefined;
		return JSON.parse(JSON.stringify(value));
	}
	function report(error) {
		console.error("[st-compat]", error);
	}
	function splitPath(path) {
		if (Array.isArray(path)) return path.map(String);
		return String(path === null || path === undefined ? "" : path)
			.replace(/\[(\d+)\]/g, ".$1")
			.split(".")
			.filter(function (segment) { return segment.length > 0; });
	}
	function readPath(root, path) {
		var current = root;
		for (var index = 0; index < path.length; index += 1) {
			if (current === null || typeof current !== "object") return undefined;
			current = current[path[index]];
		}
		return current;
	}
	function writePath(root, path, value) {
		var current = root;
		for (var index = 0; index < path.length - 1; index += 1) {
			var key = path[index];
			if (!isObject(current[key])) current[key] = {};
			current = current[key];
		}
		current[path[path.length - 1]] = value;
	}
	function deletePath(root, path) {
		var current = root;
		for (var index = 0; index < path.length - 1; index += 1) {
			if (!isObject(current[path[index]])) return;
			current = current[path[index]];
		}
		delete current[path[path.length - 1]];
	}
	function writeState(path, op, value) {
		var write = { path: path, op: op };
		if (op === "set") write.value = value;
		return window.dramaticerBridge.writeState(write).catch(function (error) {
			report(error);
			return null;
		});
	}

	function getVariables() {
		return clone(local);
	}
	function getVariable(path) {
		return clone(readPath(local, splitPath(path)));
	}
	function insertOrAssignVariable(path, value) {
		var segments = splitPath(path);
		if (segments.length === 0) throw new Error("变量路径不能为空");
		writePath(local, segments, clone(value));
		writeState(["mvu"].concat(segments), "set", clone(value));
	}
	function insertOrAssignVariables(values) {
		if (!isObject(values)) throw new Error("变量必须是对象");
		Object.keys(values).forEach(function (key) {
			writePath(local, [key], clone(values[key]));
			writeState(["mvu", key], "set", clone(values[key]));
		});
	}
	function deleteVariable(path) {
		var segments = splitPath(path);
		if (segments.length === 0) return;
		deletePath(local, segments);
		writeState(["mvu"].concat(segments), "delete");
	}
	function replaceVariables(values) {
		var before = local;
		var after = isObject(values) ? clone(values) : {};
		local = after;
		Object.keys(after).forEach(function (key) {
			writeState(["mvu", key], "set", clone(after[key]));
		});
		Object.keys(before).forEach(function (key) {
			if (!Object.prototype.hasOwnProperty.call(after, key)) {
				writeState(["mvu", key], "delete");
			}
		});
	}
	function updateVariablesWith(updater) {
		var draft = getVariables();
		var returned = updater(draft);
		var next = returned === undefined ? draft : returned;
		replaceVariables(next);
		return isObject(next) ? clone(next) : {};
	}

	function removeListener(type, entry) {
		var list = listeners[type];
		if (!list) return;
		var index = list.indexOf(entry);
		if (index >= 0) list.splice(index, 1);
	}
	function addListener(type, listener, once) {
		var list = listeners[type] || (listeners[type] = []);
		var entry = { listener: listener, once: once };
		list.push(entry);
		return { stop: function () { removeListener(type, entry); } };
	}
	function eventOn(type, listener, options) {
		return addListener(type, listener, Boolean(options && options.once));
	}
	function eventOnce(type, listener) {
		return addListener(type, listener, true);
	}
	function eventEmit(type) {
		var args = Array.prototype.slice.call(arguments, 1);
		var list = (listeners[type] || []).slice();
		for (var index = 0; index < list.length; index += 1) {
			var entry = list[index];
			if (entry.once) removeListener(type, entry);
			try {
				entry.listener.apply(undefined, args);
			} catch (error) {
				report(error);
			}
		}
	}
	function eventRemoveListener(type, listener) {
		var list = (listeners[type] || []).slice();
		for (var index = 0; index < list.length; index += 1) {
			if (list[index].listener === listener) removeListener(type, list[index]);
		}
	}
	function eventClearEvent(type) {
		listeners[type] = [];
	}
	function eventClearAll() {
		listeners = Object.create(null);
	}

	var message = {
		message_id: 0,
		role: "assistant",
		message: boot.raw,
		name: boot.characterName,
		is_hidden: false,
		swipe_id: 0,
		swipes: [boot.raw]
	};
	function getChatMessages() {
		return [clone(message)];
	}
	function getChatMessage() {
		return clone(message);
	}
	function getLastMessageId() {
		return 0;
	}
	function getCurrentMessageId() {
		return 0;
	}
	function setChatMessages() {
		throw new Error("楼层原文不可修改（I4）");
	}

	function triggerSlash(command) {
		var text = String(command === null || command === undefined ? "" : command).trim();
		var match = /^\/([A-Za-z0-9_-]+)\s*([\s\S]*)$/.exec(text);
		if (match === null) {
			return Promise.reject(new Error("只接受 /send、/setinput 这类指令：" + text));
		}
		var name = match[1].toLowerCase();
		var argument = match[2] || "";
		if (name === "send") {
			if (argument.trim().length === 0) {
				return Promise.reject(new Error("/send 后面要有消息内容"));
			}
			return window.dramaticerBridge.sendMessage(argument).then(function () {
				return "";
			});
		}
		if (name === "setinput" || name === "input") {
			return window.dramaticerBridge.fillInput(argument).then(function () {
				return "";
			});
		}
		if (name === "trigger") {
			eventEmit(argument.trim(), "");
			return Promise.resolve("");
		}
		return Promise.reject(new Error("不支持的指令：/" + name));
	}
	function openImage(source) {
		return window.dramaticerBridge.openImage(source);
	}

	var api = {
		getVariables: getVariables,
		getVariable: getVariable,
		insertOrAssignVariable: insertOrAssignVariable,
		insertOrAssignVariables: insertOrAssignVariables,
		replaceVariables: replaceVariables,
		updateVariablesWith: updateVariablesWith,
		deleteVariable: deleteVariable,
		eventOn: eventOn,
		eventOnce: eventOnce,
		eventEmit: eventEmit,
		eventRemoveListener: eventRemoveListener,
		eventClearEvent: eventClearEvent,
		eventClearAll: eventClearAll,
		getChatMessages: getChatMessages,
		getChatMessage: getChatMessage,
		getLastMessageId: getLastMessageId,
		getCurrentMessageId: getCurrentMessageId,
		setChatMessages: setChatMessages,
		triggerSlash: triggerSlash,
		openImage: openImage,
		tavern_events: boot.events
	};
	Object.keys(api).forEach(function (name) {
		window[name] = api[name];
	});
	window.TavernHelper = api;
	window.tavern_events = boot.events;

	var scripts = ${scriptsJson};
	scripts.forEach(function (entry) {
		if (typeof document !== "undefined" && document.body) {
			var element = document.createElement("script");
			if (entry.isModule) {
				element.type = "module";
				element.textContent = entry.content;
				element.addEventListener("error", function (event) {
					console.error("[st-compat] 模块脚本「" + entry.name + "」加载失败", event);
				});
			} else {
				element.textContent =
					"try {\n\t(function () {\n\t\treturn (async function () {\n" +
					entry.content +
					"\n\t\t})();\n\t})().catch(function (error) {\n\t\tconsole.error(" +
					JSON.stringify("[st-compat] 脚本「" + entry.name + "」失败：") +
					" + error);\n\t});\n} catch (error) {\n\tconsole.error(" +
					JSON.stringify("[st-compat] 脚本「" + entry.name + "」无法执行：") +
					" + error);\n}";
			}
			document.body.appendChild(element);
			return;
		}
		if (entry.isModule) return;
		try {
			var runner = new Function("return (async function () {\n" + entry.content + "\n})();");
			Promise.resolve(runner()).catch(function (error) {
				console.error("[st-compat] 脚本「" + entry.name + "」失败：" + error);
			});
		} catch (error) {
			console.error("[st-compat] 脚本「" + entry.name + "」无法执行：" + error);
		}
	});
})();`;
}

function isEsModuleScript(content: string): boolean {
	return /^\s*(?:import(?:\s+[\s\S]*?\s+from\s+|\s*["'])|export\s+)/m.test(
		content,
	);
}

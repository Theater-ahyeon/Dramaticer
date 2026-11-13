import { assertJsonValue, isJsonObject } from "@dramaticer/core";
import { ST_HELPER_TAVERN_EVENTS } from "./events.js";
import {
	ST_HELPER_IMPLEMENTED_FUNCTIONS,
	type StHelperHostApi,
	type StHelperImplementedFunction,
} from "./host.js";

/** 沙箱脚本默认执行上限；到时由调用方终止 iframe 并重建。 */
export const ST_HELPER_SANDBOX_DEFAULT_TIMEOUT_MS = 10_000;

/** 按用途分组，插件声明权限时用于拼出全量清单。 */
export const ST_HELPER_SANDBOX_FUNCTION_GROUPS = {
	variables: [
		"getVariables",
		"replaceVariables",
		"insertOrAssignVariables",
		"updateVariablesWith",
		"getVariable",
		"insertOrAssignVariable",
		"deleteVariable",
	],
	events: [
		"eventOn",
		"eventOnce",
		"eventEmit",
		"eventRemoveListener",
		"eventClearEvent",
		"eventClearAll",
	],
	messages: [
		"getChatMessages",
		"getChatMessage",
		"getLastMessageId",
		"getCurrentMessageId",
		"setChatMessages",
	],
	slash: ["triggerSlash"],
} as const satisfies Record<string, readonly StHelperImplementedFunction[]>;

/**
 * 代码插件里声明脚本可用的宿主 API。`apis` 是白名单：沙箱里的调用不在
 * 名单里就直接拒绝并记录，宿主不会代为执行。`updateVariablesWith` 在
 * iframe 里由 `getVariables` 与 `replaceVariables` 组合实现，所以声明它时
 * 必须同时声明这两个函数。
 */
export interface StHelperSandboxPermission {
	readonly kind: "st-helper";
	readonly apis: readonly StHelperImplementedFunction[];
}

export const ST_HELPER_SANDBOX_FULL_PERMISSION: StHelperSandboxPermission = {
	kind: "st-helper",
	apis: ST_HELPER_IMPLEMENTED_FUNCTIONS,
};

const IMPLEMENTED: ReadonlySet<string> = new Set(
	ST_HELPER_IMPLEMENTED_FUNCTIONS,
);

export function parseStHelperSandboxPermission(
	value: unknown,
	path = "permission",
): StHelperSandboxPermission {
	if (!isJsonObject(value)) {
		throw new Error(`${path} 必须是对象`);
	}
	for (const key of Object.keys(value)) {
		if (key !== "kind" && key !== "apis") {
			throw new Error(`${path}.${key} 是未知字段`);
		}
	}
	if (value.kind !== "st-helper") {
		throw new Error(`${path}.kind 必须是 st-helper`);
	}
	const apis = readApis(value.apis, `${path}.apis`);
	if (apis.includes("updateVariablesWith")) {
		for (const required of ["getVariables", "replaceVariables"] as const) {
			if (!apis.includes(required)) {
				throw new Error(
					`${path}.apis 声明 updateVariablesWith 时必须同时声明 ${required}`,
				);
			}
		}
	}
	for (const dependent of [
		"eventOnce",
		"eventRemoveListener",
		"eventClearEvent",
		"eventClearAll",
	] as const) {
		if (apis.includes(dependent) && !apis.includes("eventOn")) {
			throw new Error(`${path}.apis 声明 ${dependent} 时必须同时声明 eventOn`);
		}
	}
	return { kind: "st-helper", apis };
}

function readApis(
	value: unknown,
	path: string,
): readonly StHelperImplementedFunction[] {
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const seen = new Set<string>();
	const apis: StHelperImplementedFunction[] = [];
	for (const [index, item] of value.entries()) {
		if (typeof item !== "string" || !IMPLEMENTED.has(item)) {
			throw new Error(
				`${path}[${index}] 不是已实现的宿主 API：${String(item)}`,
			);
		}
		if (seen.has(item)) {
			throw new Error(`${path}[${index}] 重复：${item}`);
		}
		seen.add(item);
		apis.push(item as StHelperImplementedFunction);
	}
	return apis;
}

export type StHelperSandboxTraceKind =
	| "permission"
	| "execution"
	| "render"
	| "protocol"
	| "timeout";

export type StHelperSandboxTraceOutcome =
	| "allowed"
	| "denied"
	| "failed"
	| "completed"
	| "terminated"
	| "rejected";

/** 沙箱执行与权限判定的一条记录；C-T05.f 把它并入插件 Trace。 */
export interface StHelperSandboxTraceEntry {
	readonly plugin: string;
	readonly kind: StHelperSandboxTraceKind;
	readonly execution: string | null;
	readonly scriptId: string | null;
	readonly function: string | null;
	readonly outcome: StHelperSandboxTraceOutcome;
	readonly reason: string | null;
	readonly durationMs: number;
	readonly at: string;
}

/** 宿主发给 iframe 的执行消息；脚本正文只出现在这里。 */
export interface StHelperSandboxRunMessage {
	readonly type: "st-helper:run";
	readonly execution: string;
	readonly script: string;
	readonly content: string;
	readonly functions: readonly string[];
	readonly events: typeof ST_HELPER_TAVERN_EVENTS;
}

export interface StHelperSandboxResultMessage {
	readonly type: "st-helper:result";
	readonly id: number;
	readonly ok: boolean;
	readonly value?: unknown;
	readonly error?: string;
}

export interface StHelperSandboxEventMessage {
	readonly type: "st-helper:event";
	readonly token: number;
	readonly args: readonly unknown[];
	readonly once: boolean;
}

export interface StHelperSandboxClearMessage {
	readonly type: "st-helper:clear";
	/** `null` 表示清空全部事件。 */
	readonly event: string | null;
}

/** 渲染一段 HTML 状态栏或开场页；页面里的脚本与卡片脚本都在 iframe 里执行。 */
export interface StHelperSandboxRenderMessage {
	readonly type: "st-helper:render";
	readonly render: string;
	readonly label: string;
	readonly html: string;
	readonly scripts: readonly string[];
}

export type StHelperSandboxHostMessage =
	| StHelperSandboxRunMessage
	| StHelperSandboxResultMessage
	| StHelperSandboxEventMessage
	| StHelperSandboxClearMessage
	| StHelperSandboxRenderMessage;

export interface StHelperSandboxReadyMessage {
	readonly type: "st-helper:ready";
}

export interface StHelperSandboxCallMessage {
	readonly type: "st-helper:call";
	readonly execution: string;
	readonly id: number;
	readonly name: string;
	readonly args: readonly unknown[];
}

export interface StHelperSandboxDoneMessage {
	readonly type: "st-helper:done";
	readonly execution: string;
	readonly ok: boolean;
	readonly error?: string;
}

export interface StHelperSandboxRenderedMessage {
	readonly type: "st-helper:rendered";
	readonly render: string;
	readonly ok: boolean;
	readonly html?: string;
	readonly error?: string;
}

export type StHelperSandboxFrameMessage =
	| StHelperSandboxReadyMessage
	| StHelperSandboxCallMessage
	| StHelperSandboxDoneMessage
	| StHelperSandboxRenderedMessage;

/**
 * 白名单解析 iframe 发来的消息。未知类型、缺字段、非法 id 与不是 JSON 的
 * 参数一律返回 null；调用方据此记录协议拒绝，不做猜测修复。
 */
export function parseStHelperSandboxFrameMessage(
	value: unknown,
): StHelperSandboxFrameMessage | null {
	if (!isJsonObject(value)) return null;
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
		try {
			assertJsonValue(value.args, "args");
		} catch {
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
	if (value.type === "st-helper:rendered") {
		if (!isNonEmptyString(value.render) || typeof value.ok !== "boolean") {
			return null;
		}
		if (value.ok) {
			if (typeof value.html !== "string") return null;
			return {
				type: "st-helper:rendered",
				render: value.render,
				ok: true,
				html: value.html,
			};
		}
		if (!isNonEmptyString(value.error)) return null;
		return {
			type: "st-helper:rendered",
			render: value.render,
			ok: false,
			error: value.error,
		};
	}
	return null;
}

/** iframe 一次渲染的结果；超时也会回调 `ok: false`，调用方据此清掉进行中的请求。 */
export interface StHelperSandboxRenderOutcome {
	readonly render: string;
	readonly label: string;
	readonly ok: boolean;
	readonly html: string | null;
	readonly error: string | null;
	readonly durationMs: number;
}

export interface StHelperSandboxHostOptions {
	readonly api: StHelperHostApi;
	readonly permission: StHelperSandboxPermission;
	/** 把消息送到 iframe；事件回调也走这里。 */
	readonly send: (message: StHelperSandboxHostMessage) => void;
	/** 超时后由调用方移除 iframe，再新建一个继续执行。 */
	readonly terminate: (execution: string, reason: string) => void;
	readonly onRender?: (outcome: StHelperSandboxRenderOutcome) => void;
	readonly plugin?: string;
	readonly scriptTimeoutMs?: number;
	readonly now?: () => number;
	readonly onTrace?: (entry: StHelperSandboxTraceEntry) => void;
	readonly maxTraceEntries?: number;
}

interface ExecutionState {
	readonly id: string;
	readonly kind: "script" | "render";
	readonly scriptId: string;
	readonly startedAt: number;
	readonly deadline: number;
	done: boolean;
}

interface ListenerState {
	readonly event: string;
	readonly token: number;
	readonly execution: string;
	readonly stop: () => void;
}

const DEFAULT_MAX_TRACE_ENTRIES = 200;

/**
 * iframe 的宿主侧：权限判定、调用分派、事件桥接与执行超时都在这里。
 * 宿主不执行脚本，也不接触 iframe 的全局对象；所有来往都是普通 JSON。
 */
export class StHelperSandboxHost {
	readonly #api: StHelperHostApi;
	readonly #allowed: ReadonlySet<string>;
	readonly #send: (message: StHelperSandboxHostMessage) => void;
	readonly #terminate: (execution: string, reason: string) => void;
	readonly #onRender: ((outcome: StHelperSandboxRenderOutcome) => void) | null;
	readonly #plugin: string;
	readonly #timeoutMs: number;
	readonly #now: () => number;
	readonly #onTrace: ((entry: StHelperSandboxTraceEntry) => void) | null;
	readonly #maxTraceEntries: number;
	readonly #trace: StHelperSandboxTraceEntry[] = [];
	readonly #executions = new Map<string, ExecutionState>();
	readonly #listeners = new Map<number, ListenerState>();
	#counter = 0;
	#disposed = false;

	constructor(options: StHelperSandboxHostOptions) {
		const plugin = options.plugin ?? "st-helper-host";
		if (plugin.trim().length === 0) {
			throw new Error("宿主插件名必须是非空字符串");
		}
		const timeoutMs =
			options.scriptTimeoutMs ?? ST_HELPER_SANDBOX_DEFAULT_TIMEOUT_MS;
		if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
			throw new Error("脚本超时必须是正整数毫秒");
		}
		this.#api = options.api;
		this.#allowed = new Set(options.permission.apis);
		this.#send = options.send;
		this.#terminate = options.terminate;
		this.#onRender = options.onRender ?? null;
		this.#plugin = plugin;
		this.#timeoutMs = timeoutMs;
		this.#now = options.now ?? Date.now;
		this.#onTrace = options.onTrace ?? null;
		this.#maxTraceEntries =
			options.maxTraceEntries ?? DEFAULT_MAX_TRACE_ENTRIES;
	}

	/** 允许脚本调用的 API；iframe 文档按这份清单生成全局函数。 */
	get functions(): readonly StHelperImplementedFunction[] {
		return [...this.#allowed] as StHelperImplementedFunction[];
	}

	get trace(): readonly StHelperSandboxTraceEntry[] {
		return [...this.#trace];
	}

	/** 发送执行消息并开始计时；执行 id 由宿主生成。 */
	startScript(input: {
		readonly id: string;
		readonly content: string;
	}): string {
		this.#assertActive();
		if (input.id.trim().length === 0) {
			throw new Error("脚本 id 必须是非空字符串");
		}
		const id = `exec-${++this.#counter}`;
		const startedAt = this.#now();
		this.#executions.set(id, {
			id,
			kind: "script",
			scriptId: input.id,
			startedAt,
			deadline: startedAt + this.#timeoutMs,
			done: false,
		});
		this.#send({
			type: "st-helper:run",
			execution: id,
			script: input.id,
			content: input.content,
			functions: this.functions,
			events: ST_HELPER_TAVERN_EVENTS,
		});
		return id;
	}

	/**
	 * 让 iframe 渲染一段 HTML 并执行页面脚本与卡片脚本，完成后由 iframe
	 * 发回快照。`label` 只用于 Trace。
	 */
	startRender(input: {
		readonly label: string;
		readonly html: string;
		readonly scripts?: readonly string[];
	}): string {
		this.#assertActive();
		if (typeof input.label !== "string" || input.label.trim().length === 0) {
			throw new Error("渲染标签必须是非空字符串");
		}
		if (typeof input.html !== "string" || input.html.length === 0) {
			throw new Error("渲染的 HTML 不能为空");
		}
		const scripts = input.scripts ?? [];
		if (!Array.isArray(scripts)) {
			throw new Error("渲染的脚本清单必须是数组");
		}
		for (const [index, script] of scripts.entries()) {
			if (typeof script !== "string") {
				throw new Error(`渲染脚本[${index}] 必须是字符串`);
			}
		}
		const id = `render-${++this.#counter}`;
		const startedAt = this.#now();
		this.#executions.set(id, {
			id,
			kind: "render",
			scriptId: input.label,
			startedAt,
			deadline: startedAt + this.#timeoutMs,
			done: false,
		});
		this.#send({
			type: "st-helper:render",
			render: id,
			label: input.label,
			html: input.html,
			scripts,
		});
		return id;
	}

	handleMessage(data: unknown): void {
		if (this.#disposed) return;
		const message = parseStHelperSandboxFrameMessage(data);
		if (message === null) {
			if (isJsonObject(data) && String(data.type).startsWith("st-helper:")) {
				this.#record({
					kind: "protocol",
					execution: null,
					scriptId: null,
					function: null,
					outcome: "rejected",
					reason: "无法识别的沙箱消息",
					durationMs: 0,
				});
			}
			return;
		}
		if (message.type === "st-helper:ready") return;
		if (message.type === "st-helper:done") {
			this.#finish(message);
			return;
		}
		if (message.type === "st-helper:rendered") {
			this.#finishRender(message);
			return;
		}
		this.#call(message);
	}

	/** 找出超过截止时间的执行并终止；返回被终止的执行 id。 */
	sweepTimeouts(): readonly string[] {
		const now = this.#now();
		const expired: string[] = [];
		for (const execution of this.#executions.values()) {
			if (execution.done || now < execution.deadline) continue;
			execution.done = true;
			const what =
				execution.kind === "render"
					? `渲染 ${execution.scriptId}`
					: `脚本 ${execution.scriptId}`;
			const reason = `${what} 执行超过 ${this.#timeoutMs} 毫秒，已终止`;
			this.#record({
				kind: "timeout",
				execution: execution.id,
				scriptId: execution.scriptId,
				function: null,
				outcome: "terminated",
				reason,
				durationMs: now - execution.startedAt,
			});
			for (const listener of [...this.#listeners.values()]) {
				if (listener.execution === execution.id) listener.stop();
			}
			if (execution.kind === "render") {
				this.#onRender?.({
					render: execution.id,
					label: execution.scriptId,
					ok: false,
					html: null,
					error: reason,
					durationMs: now - execution.startedAt,
				});
			}
			this.#terminate(execution.id, reason);
			expired.push(execution.id);
		}
		return expired;
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#api.eventClearAll();
		this.#listeners.clear();
		for (const execution of this.#executions.values()) {
			execution.done = true;
		}
	}

	#call(message: StHelperSandboxCallMessage): void {
		const execution = this.#executions.get(message.execution);
		if (execution === undefined || execution.done) {
			this.#respond(message, false, `执行 ${message.execution} 已结束`);
			this.#record({
				kind: "protocol",
				execution: message.execution,
				scriptId: execution?.scriptId ?? null,
				function: message.name,
				outcome: "rejected",
				reason: "调用来自已结束的执行",
				durationMs: 0,
			});
			return;
		}
		if (!this.#allowed.has(message.name)) {
			const reason = `脚本没有声明调用 ${message.name} 的权限`;
			this.#respond(message, false, reason);
			this.#record({
				kind: "permission",
				execution: execution.id,
				scriptId: execution.scriptId,
				function: message.name,
				outcome: "denied",
				reason,
				durationMs: 0,
			});
			return;
		}
		const startedAt = this.#now();
		let value: unknown;
		try {
			value = this.#dispatch(execution, message);
		} catch (error) {
			this.#failCall(message, execution, error, startedAt);
			return;
		}
		if (value instanceof Promise) {
			void value.then(
				(result) => {
					if (execution.done) return;
					this.#respond(message, true, result);
				},
				(error: unknown) => {
					if (execution.done) return;
					this.#failCall(message, execution, error, startedAt);
				},
			);
			return;
		}
		this.#respond(message, true, value);
	}

	#failCall(
		message: StHelperSandboxCallMessage,
		execution: ExecutionState,
		error: unknown,
		startedAt: number,
	): void {
		const reason = errorText(error);
		this.#respond(message, false, reason);
		this.#record({
			kind: "execution",
			execution: execution.id,
			scriptId: execution.scriptId,
			function: message.name,
			outcome: "failed",
			reason,
			durationMs: this.#now() - startedAt,
		});
	}

	#dispatch(
		execution: ExecutionState,
		message: StHelperSandboxCallMessage,
	): unknown {
		switch (message.name) {
			case "eventOn":
			case "eventOnce":
				return this.#registerListener(execution, message);
			case "eventRemoveListener":
				return this.#removeListener(message);
			case "eventClearEvent":
				return this.#clearEvent(message);
			case "eventClearAll":
				return this.#clearAll();
			case "updateVariablesWith":
				throw new Error("updateVariablesWith 只能在 iframe 内组合调用");
			default:
				return this.#invokeApi(message.name, message.args);
		}
	}

	#invokeApi(name: string, args: readonly unknown[]): unknown {
		const api = this.#api as unknown as Record<
			string,
			(...callArgs: unknown[]) => unknown
		>;
		const method = api[name];
		if (typeof method !== "function") {
			throw new Error(`宿主没有实现 ${name}`);
		}
		const value = method.apply(this.#api, [...args]);
		return value === undefined ? null : value;
	}

	#registerListener(
		execution: ExecutionState,
		message: StHelperSandboxCallMessage,
	): null {
		const type = message.args[0];
		if (typeof type !== "string" || type.length === 0) {
			throw new Error("事件名必须是非空字符串");
		}
		const token = message.args[1];
		if (!isNonNegativeInteger(token)) {
			throw new Error("事件监听器编号必须是非负整数");
		}
		if (this.#listeners.has(token)) {
			throw new Error(`事件监听器编号重复：${token}`);
		}
		const options = message.args[2];
		let once = message.name === "eventOnce";
		if (options !== undefined) {
			if (!isJsonObject(options) || typeof options.once !== "boolean") {
				throw new Error("事件监听参数必须是 { once: boolean }");
			}
			once = options.once;
		}
		const stop = (): void => {
			const current = this.#listeners.get(token);
			if (current === undefined) return;
			this.#listeners.delete(token);
			current.stop();
		};
		const handle =
			message.name === "eventOnce"
				? this.#api.eventOnce(type, (...args: unknown[]) => {
						this.#emitToFrame(token, args, true);
					})
				: this.#api.eventOn(
						type,
						(...args: unknown[]) => {
							this.#emitToFrame(token, args, once);
						},
						{ once },
					);
		this.#listeners.set(token, {
			event: type,
			token,
			execution: execution.id,
			stop: () => {
				handle.stop();
				this.#listeners.delete(token);
			},
		});
		return null;
	}

	#removeListener(message: StHelperSandboxCallMessage): null {
		const type = message.args[0];
		if (typeof type !== "string" || type.length === 0) {
			throw new Error("事件名必须是非空字符串");
		}
		const token = message.args[1];
		if (!isNonNegativeInteger(token)) {
			throw new Error("事件监听器编号必须是非负整数");
		}
		const listener = this.#listeners.get(token);
		if (listener === undefined) return null;
		if (listener.event !== type) {
			throw new Error(
				`事件监听器 ${token} 属于 ${listener.event}，不是 ${type}`,
			);
		}
		listener.stop();
		return null;
	}

	#clearEvent(message: StHelperSandboxCallMessage): null {
		const type = message.args[0];
		if (typeof type !== "string" || type.length === 0) {
			throw new Error("事件名必须是非空字符串");
		}
		this.#api.eventClearEvent(type);
		for (const [token, listener] of this.#listeners) {
			if (listener.event === type) this.#listeners.delete(token);
		}
		this.#send({ type: "st-helper:clear", event: type });
		return null;
	}

	#clearAll(): null {
		this.#api.eventClearAll();
		this.#listeners.clear();
		this.#send({ type: "st-helper:clear", event: null });
		return null;
	}

	#emitToFrame(token: number, args: readonly unknown[], once: boolean): void {
		try {
			assertJsonValue(args, "事件参数");
		} catch (error) {
			this.#record({
				kind: "execution",
				execution: null,
				scriptId: null,
				function: "eventEmit",
				outcome: "failed",
				reason: errorText(error),
				durationMs: 0,
			});
			return;
		}
		if (once) this.#listeners.delete(token);
		this.#send({ type: "st-helper:event", token, args, once });
	}

	#respond(
		message: StHelperSandboxCallMessage,
		ok: boolean,
		value: unknown,
	): void {
		if (ok) {
			try {
				assertJsonValue(value, "返回值");
			} catch (error) {
				const reason = errorText(error);
				this.#send({
					type: "st-helper:result",
					id: message.id,
					ok: false,
					error: reason,
				});
				this.#record({
					kind: "execution",
					execution: message.execution,
					scriptId: null,
					function: message.name,
					outcome: "failed",
					reason,
					durationMs: 0,
				});
				return;
			}
			this.#send({ type: "st-helper:result", id: message.id, ok: true, value });
			return;
		}
		this.#send({
			type: "st-helper:result",
			id: message.id,
			ok: false,
			error: String(value),
		});
	}

	#finish(message: StHelperSandboxDoneMessage): void {
		const execution = this.#executions.get(message.execution);
		if (execution === undefined || execution.done) {
			this.#record({
				kind: "protocol",
				execution: message.execution,
				scriptId: execution?.scriptId ?? null,
				function: null,
				outcome: "rejected",
				reason: "完成消息来自已结束的执行",
				durationMs: 0,
			});
			return;
		}
		execution.done = true;
		this.#record({
			kind: "execution",
			execution: execution.id,
			scriptId: execution.scriptId,
			function: null,
			outcome: message.ok ? "completed" : "failed",
			reason: message.ok ? null : (message.error ?? "脚本执行失败"),
			durationMs: this.#now() - execution.startedAt,
		});
	}

	#finishRender(message: StHelperSandboxRenderedMessage): void {
		const execution = this.#executions.get(message.render);
		if (
			execution === undefined ||
			execution.done ||
			execution.kind !== "render"
		) {
			this.#record({
				kind: "protocol",
				execution: message.render,
				scriptId: execution?.scriptId ?? null,
				function: null,
				outcome: "rejected",
				reason: "渲染结果来自已结束的请求",
				durationMs: 0,
			});
			return;
		}
		execution.done = true;
		const durationMs = this.#now() - execution.startedAt;
		this.#record({
			kind: "render",
			execution: execution.id,
			scriptId: execution.scriptId,
			function: null,
			outcome: message.ok ? "completed" : "failed",
			reason: message.ok ? null : (message.error ?? "渲染失败"),
			durationMs,
		});
		this.#onRender?.({
			render: execution.id,
			label: execution.scriptId,
			ok: message.ok,
			html: message.ok ? (message.html ?? null) : null,
			error: message.ok ? null : (message.error ?? "渲染失败"),
			durationMs,
		});
	}

	#record(entry: {
		readonly kind: StHelperSandboxTraceKind;
		readonly execution: string | null;
		readonly scriptId: string | null;
		readonly function: string | null;
		readonly outcome: StHelperSandboxTraceOutcome;
		readonly reason: string | null;
		readonly durationMs: number;
	}): void {
		const entryWithMeta: StHelperSandboxTraceEntry = {
			plugin: this.#plugin,
			...entry,
			at: new Date(this.#now()).toISOString(),
		};
		this.#trace.push(entryWithMeta);
		if (this.#trace.length > this.#maxTraceEntries) this.#trace.shift();
		this.#onTrace?.(entryWithMeta);
	}

	#assertActive(): void {
		if (this.#disposed) throw new Error("沙箱宿主已经释放");
	}
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

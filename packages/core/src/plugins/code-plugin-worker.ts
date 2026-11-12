import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { BlockTypeDefinition } from "../blocks/types.js";
import type {
	ContextSlotContent,
	ContextSlotRequest,
} from "../context/assembler.js";
import type { ContextMessage } from "../context/template.js";
import {
	assertJsonValue,
	assertPlainObject,
	isJsonObject,
	rejectUnknownKeys,
} from "../json.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { LedgerDiffInput } from "../ledger/schema.js";
import { validateLedgerDiff } from "../ledger/schema.js";
import { LLM_MODEL_ROLE_NAMES } from "../llm/channels.js";
import type { LlmModelRole } from "../llm/channels.js";
import { createDeepToolRegistry } from "../tools/registry.js";
import type { DeepToolDefinition, ToolPhase } from "../tools/registry.js";
import {
	CODE_PLUGIN_PERMISSION_KINDS,
	type CodePluginManifest,
	type CodePluginPermission,
	type CodePluginPermissionKind,
	assertCodePluginRelativePath,
	codePluginPermissionKey,
	parseCodePluginPermissions,
} from "./code-plugins.js";
import type { ExtensionRegistry } from "./registry.js";

/** 代码插件 worker 的当前状态；失败后不再产生任何扩展点输出。 */
export type CodePluginRuntimeState =
	| "starting"
	| "active"
	| "failed"
	| "disposed";

/** Trace 记录的类别：权限判定、生命周期、协议与扩展点注册。 */
export type CodePluginTraceKind =
	| "permission"
	| "lifecycle"
	| "protocol"
	| "registration";

export type CodePluginTraceOutcome =
	| "allowed"
	| "denied"
	| "rejected"
	| "failed"
	| "registered"
	| "unregistered"
	| "disposed";

/**
 * 一条代码插件 Trace。权限拒绝、非法消息、崩溃与超时都写在这里；
 * `capability` 只在权限判定与能力调用时出现。
 */
export interface CodePluginTraceEntry {
	readonly plugin: string;
	readonly kind: CodePluginTraceKind;
	/** 具体动作：network、files.read、model、ledger-write、slot 等。 */
	readonly action: string;
	readonly capability: CodePluginPermissionKind | null;
	/** 被请求的主机、文件路径、模型角色或台账命名空间。 */
	readonly target: string | null;
	readonly outcome: CodePluginTraceOutcome;
	readonly reason: string | null;
	readonly durationMs: number;
	readonly at: string;
}

export interface CodePluginRuntimeStatus {
	readonly name: string;
	readonly state: CodePluginRuntimeState;
	readonly reason: string | null;
}

/** 模型能力请求；模型角色已在主线程按已授予权限校验。 */
export interface CodePluginModelRequest {
	readonly plugin: string;
	readonly role: LlmModelRole;
	readonly messages: readonly JsonValue[];
	readonly options: JsonValue;
}

export type CodePluginModelHandler = (
	request: CodePluginModelRequest,
) => unknown;

/**
 * 待校验台账 diff 的接收器。宿主只能通过这个函数提交 diff，不能接触
 * `StoryStore`；写入仍然由结算器校验与落地（I12、I16）。
 */
export type CodePluginLedgerSink = (
	diffs: readonly LedgerDiffInput[],
	plugin: string,
) => void | Promise<void>;

export interface CodePluginRuntimeOptions {
	/** 插件目录；入口与文件权限的相对路径都从这里解析。 */
	readonly pluginDir: string;
	readonly manifest: CodePluginManifest;
	/** 安装记录里的已授予权限；必须是清单声明权限的子集。 */
	readonly grantedPermissions: readonly CodePluginPermission[];
	readonly config?: JsonValue;
	/** 提供后，插件注册的槽位、工具与块类型进入这个注册表。 */
	readonly registry?: ExtensionRegistry;
	/** 网络实现；默认使用全局 fetch。 */
	readonly fetch?: typeof fetch;
	/** 声明 model 权限后必须提供，否则模型调用记失败。 */
	readonly model?: CodePluginModelHandler;
	/** 声明 ledger-write 权限后必须提供，否则台账写入记失败。 */
	readonly ledger?: CodePluginLedgerSink;
	readonly onTrace?: (entry: CodePluginTraceEntry) => void;
	/** 激活的等待上限；超时按插件失败处理。 */
	readonly activationTimeoutMs?: number;
	/** 一次槽位或工具调用的等待上限；超时终止插件。 */
	readonly invokeTimeoutMs?: number;
	/** 单条 worker 消息与返回值的字节上限。 */
	readonly maxMessageBytes?: number;
	/** 保留的 Trace 条数上限；超出后丢弃最旧的记录。 */
	readonly maxTraceEntries?: number;
}

const DEFAULT_ACTIVATION_TIMEOUT_MS = 10_000;
const DEFAULT_INVOKE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_MESSAGE_BYTES = 1_048_576;
const DEFAULT_MAX_TRACE_ENTRIES = 200;

const CAPABILITY_KINDS: ReadonlySet<string> = new Set(
	CODE_PLUGIN_PERMISSION_KINDS,
);

const TOOL_KEYS = [
	"name",
	"description",
	"parameters",
	"permission",
	"progressLabel",
];

const BLOCK_TYPE_KEYS = ["name", "display", "context", "semantics"];

/**
 * worker 线程里的插件外壳。入口模块导出 `activate(api, config)` 或默认导出
 * 同名函数；所有能力调用都经消息端口交给主线程判定。
 */
const WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");

const slots = new Map();
const tools = new Map();
const disposes = [];
const pending = new Map();
let nextId = 1;
let disposed = false;

function errorText(error) {
	return error && typeof error.message === "string"
		? error.message
		: String(error);
}

function post(message) {
	try {
		parentPort.postMessage(message);
	} catch (error) {
		parentPort.postMessage({
			type: "protocol-error",
			reason: "worker 无法发送消息：" + errorText(error),
		});
	}
}

function request(kind, payload) {
	return new Promise(function (resolve, reject) {
		const id = nextId++;
		pending.set(id, { resolve: resolve, reject: reject });
		post({ type: "capability", id: id, request: Object.assign({ kind: kind }, payload) });
	});
}

const api = {
	name: workerData.pluginName,
	version: workerData.pluginVersion,
	config: workerData.config === undefined ? null : workerData.config,
	network: function (url, options) {
		return request("network", { url: url, options: options });
	},
	readFile: function (path) {
		return request("files", { access: "read", path: path });
	},
	writeFile: function (path, content) {
		return request("files", { access: "write", path: path, content: content });
	},
	model: function (role, messages, options) {
		return request("model", { role: role, messages: messages, options: options });
	},
	writeLedger: function (diffs) {
		return request("ledger-write", { diffs: diffs });
	},
	slot: function (name, handler) {
		if (typeof handler !== "function") {
			throw new Error("槽位处理器必须是函数");
		}
		slots.set(name, handler);
		post({ type: "register", kind: "slot", name: name });
	},
	tool: function (definition, phases, handler) {
		if (typeof handler !== "function") {
			throw new Error("工具处理器必须是函数");
		}
		tools.set(definition && definition.name, handler);
		post({
			type: "register",
			kind: "tool",
			definition: definition,
			phases: phases,
		});
	},
	blockType: function (definition) {
		post({ type: "register", kind: "block-type", definition: definition });
	},
	mechanism: function (name) {
		post({ type: "register", kind: "mechanism", name: name });
	},
	onDispose: function (cleanup) {
		if (typeof cleanup !== "function") {
			throw new Error("卸载回调必须是函数");
		}
		disposes.push(cleanup);
	},
	log: function (message) {
		post({ type: "log", message: String(message) });
	},
};

function invoke(call, name, payload) {
	const handler = call === "slot" ? slots.get(name) : tools.get(name);
	if (typeof handler !== "function") {
		post({
			type: "invoke-result",
			id: payload.id,
			ok: false,
			error: "插件没有注册 " + call + "：" + String(name),
		});
		return;
	}
	Promise.resolve()
		.then(function () {
			return handler(payload.value);
		})
		.then(
			function (value) {
				post({ type: "invoke-result", id: payload.id, ok: true, value: value });
			},
			function (error) {
				post({
					type: "invoke-result",
					id: payload.id,
					ok: false,
					error: errorText(error),
				});
			},
		);
}

parentPort.on("message", function (message) {
	if (!message || typeof message !== "object") return;
	if (message.type === "response") {
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.ok) waiter.resolve(message.value);
		else waiter.reject(new Error(String(message.error)));
		return;
	}
	if (message.type === "invoke") {
		invoke(message.call, message.name, { id: message.id, value: message.payload });
		return;
	}
	if (message.type === "dispose") {
		if (disposed) return;
		disposed = true;
		Promise.resolve()
			.then(async function () {
				for (const cleanup of disposes.splice(0).reverse()) {
					await cleanup();
				}
				post({ type: "disposed" });
				setImmediate(function () {
					process.exit(0);
				});
			})
			.catch(function (error) {
				post({ type: "disposed", error: errorText(error) });
				setImmediate(function () {
					process.exit(0);
				});
			});
	}
});

(async function () {
	try {
		// 插件入口由安装目录在运行时决定，只能用动态 import。
		const loaded = await import(workerData.entryUrl);
		const activate =
			typeof loaded.activate === "function" ? loaded.activate : loaded.default;
		if (typeof activate !== "function") {
			throw new Error("入口模块必须导出 activate 函数或默认导出函数");
		}
		await activate(api, workerData.config === undefined ? null : workerData.config);
		if (disposed) return;
		post({ type: "ready" });
	} catch (error) {
		post({ type: "activation-failed", reason: errorText(error) });
	}
})();
`;

class CapabilityError extends Error {
	readonly outcome: "denied" | "rejected" | "failed";

	constructor(message: string, outcome: "denied" | "rejected" | "failed") {
		super(message);
		this.name = "CapabilityError";
		this.outcome = outcome;
	}
}

interface PendingInvoke {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timer: NodeJS.Timeout;
}

interface Registration {
	readonly action: string;
	readonly target: string;
	readonly remove: () => void;
}

/** 运行时把插件目录、已授予权限与 worker 生命周期绑在一起。 */
export class CodePluginRuntime {
	readonly name: string;
	private readonly options: CodePluginRuntimeOptions;
	private readonly pluginDir: string;
	private readonly granted: readonly CodePluginPermission[];
	private readonly fetchImpl: typeof fetch;
	private readonly activationTimeoutMs: number;
	private readonly invokeTimeoutMs: number;
	private readonly maxMessageBytes: number;
	private readonly maxTraceEntries: number;
	private readonly entries: CodePluginTraceEntry[] = [];
	private readonly registrations: Registration[] = [];
	private readonly pendingInvokes = new Map<number, PendingInvoke>();
	private readonly ready = Promise.withResolvers<CodePluginRuntimeStatus>();
	private pluginRoot: string | null = null;
	private worker: Worker | null = null;
	private nextInvokeId = 1;
	private activationTimer: NodeJS.Timeout | null = null;
	private runtimeState: CodePluginRuntimeState = "starting";
	private failureReason: string | null = null;

	constructor(options: CodePluginRuntimeOptions) {
		this.options = options;
		const manifest = options.manifest;
		this.name = manifest.name;
		this.pluginDir = resolve(options.pluginDir);
		this.fetchImpl = options.fetch ?? globalThis.fetch;
		this.activationTimeoutMs =
			options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
		this.invokeTimeoutMs = options.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
		this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
		this.maxTraceEntries = options.maxTraceEntries ?? DEFAULT_MAX_TRACE_ENTRIES;
		if (
			!Number.isFinite(this.activationTimeoutMs) ||
			this.activationTimeoutMs <= 0
		) {
			throw new Error("activationTimeoutMs 必须是正整数毫秒");
		}
		if (!Number.isFinite(this.invokeTimeoutMs) || this.invokeTimeoutMs <= 0) {
			throw new Error("invokeTimeoutMs 必须是正整数毫秒");
		}
		if (!Number.isInteger(this.maxMessageBytes) || this.maxMessageBytes <= 0) {
			throw new Error("maxMessageBytes 必须是正整数");
		}
		if (!Number.isInteger(this.maxTraceEntries) || this.maxTraceEntries <= 0) {
			throw new Error("maxTraceEntries 必须是正整数");
		}
		if (options.config !== undefined) {
			assertJsonValue(options.config, "config");
		}
		this.granted = parseCodePluginPermissions(
			options.grantedPermissions,
			"grantedPermissions",
		);
		const declared = new Set(
			manifest.permissions.map((permission) =>
				codePluginPermissionKey(permission),
			),
		);
		for (const permission of this.granted) {
			const key = codePluginPermissionKey(permission);
			if (!declared.has(key)) {
				throw new Error(
					`插件 ${manifest.name} 的已授予权限没有在清单里声明：${key}`,
				);
			}
		}
	}

	get state(): CodePluginRuntimeState {
		return this.runtimeState;
	}

	get status(): CodePluginRuntimeStatus {
		return {
			name: this.name,
			state: this.runtimeState,
			reason: this.failureReason,
		};
	}

	/** 权限判定、崩溃与注册的完整记录；按发生顺序排列。 */
	get trace(): readonly CodePluginTraceEntry[] {
		return this.entries;
	}

	/** 取走当前 Trace 并清空，方便把一批记录接到回合报告上。 */
	takeTrace(): CodePluginTraceEntry[] {
		return this.entries.splice(0);
	}

	async start(): Promise<CodePluginRuntimeStatus> {
		if (this.runtimeState !== "starting") {
			throw new Error(`插件 ${this.name} 已经启动或已经结束`);
		}
		try {
			const info = await stat(this.pluginDir);
			if (!info.isDirectory()) {
				throw new Error("不是目录");
			}
			this.pluginRoot = await realpath(this.pluginDir);
		} catch (error) {
			this.fail(`插件目录不可读：${errorText(error)}`, "lifecycle", "activate");
			return this.status;
		}
		const entryPath = resolve(this.pluginRoot, this.options.manifest.entry);
		if (!isInside(this.pluginRoot, entryPath)) {
			this.fail("入口文件不在插件目录内", "lifecycle", "activate");
			return this.status;
		}
		let worker: Worker;
		try {
			worker = new Worker(WORKER_SOURCE, {
				eval: true,
				execArgv: [],
				workerData: {
					pluginName: this.name,
					pluginVersion: this.options.manifest.version,
					entryUrl: pathToFileURL(entryPath).href,
					config: this.options.config,
				},
			});
		} catch (error) {
			this.fail(
				`插件 worker 无法启动：${errorText(error)}`,
				"lifecycle",
				"activate",
			);
			return this.status;
		}
		this.worker = worker;
		worker.on("message", (message: unknown) => this.handleMessage(message));
		worker.on("error", (error: Error) => {
			this.fail(`插件 worker 出错：${error.message}`, "lifecycle", "crash");
		});
		worker.on("exit", (code: number) => {
			if (this.runtimeState === "starting" || this.runtimeState === "active") {
				this.fail(
					`插件 worker 提前退出（退出码 ${code}）`,
					"lifecycle",
					"crash",
				);
			}
		});
		this.activationTimer = setTimeout(() => {
			this.fail(
				`插件激活超过 ${this.activationTimeoutMs} 毫秒`,
				"lifecycle",
				"activate",
			);
		}, this.activationTimeoutMs);
		return this.ready.promise;
	}

	/** 停止 worker 并撤销所有扩展点；失败状态下调用是安全的。 */
	async dispose(): Promise<void> {
		if (this.runtimeState === "disposed") return;
		const wasActive = this.runtimeState === "active";
		this.runtimeState = "disposed";
		this.clearActivationTimer();
		this.cleanupRegistrations();
		this.rejectPending("插件已经卸载");
		const worker = this.worker;
		this.worker = null;
		if (worker !== null) {
			if (wasActive && worker.threadId !== -1) {
				worker.postMessage({ type: "dispose" });
				await Promise.race([onceExit(worker), delay(1_000)]);
			}
			await worker.terminate();
		}
		this.record({
			kind: "lifecycle",
			action: "dispose",
			outcome: "disposed",
			reason: null,
		});
		this.ready.resolve(this.status);
	}

	private handleMessage(message: unknown): void {
		if (this.runtimeState === "failed" || this.runtimeState === "disposed") {
			return;
		}
		if (!isJsonObject(message) || typeof message.type !== "string") {
			this.fail("插件 worker 发送了非法消息", "protocol", "message");
			return;
		}
		const bytes = messageBytes(message);
		if (bytes === null) {
			this.fail("插件 worker 发送了无法序列化的消息", "protocol", "message");
			return;
		}
		if (bytes > this.maxMessageBytes) {
			this.fail(
				`插件 worker 的消息大小 ${bytes} 超过上限 ${this.maxMessageBytes}`,
				"protocol",
				"message",
			);
			return;
		}
		switch (message.type) {
			case "ready":
				this.handleReady();
				return;
			case "activation-failed":
				this.fail(
					`插件激活失败：${readMessageText(message.reason, "激活失败原因")}`,
					"lifecycle",
					"activate",
				);
				return;
			case "protocol-error":
				this.fail(
					`插件 worker 协议错误：${readMessageText(message.reason, "协议错误原因")}`,
					"protocol",
					"message",
				);
				return;
			case "log":
				return;
			case "capability":
				void this.handleCapability(message);
				return;
			case "register":
				this.handleRegistration(message);
				return;
			case "invoke-result":
				this.handleInvokeResult(message);
				return;
			case "disposed":
				return;
			default:
				this.fail(
					`插件 worker 发送了未知消息类型：${message.type}`,
					"protocol",
					"message",
				);
		}
	}

	private handleReady(): void {
		if (this.runtimeState !== "starting") return;
		this.clearActivationTimer();
		this.runtimeState = "active";
		this.record({
			kind: "lifecycle",
			action: "activate",
			outcome: "allowed",
			reason: null,
		});
		this.ready.resolve(this.status);
	}

	private async handleCapability(
		message: Record<string, unknown>,
	): Promise<void> {
		const id = message.id;
		if (!Number.isInteger(id) || (id as number) <= 0) {
			this.fail("插件 worker 发送了非法的能力请求 id", "protocol", "message");
			return;
		}
		const request = message.request;
		if (!isJsonObject(request) || typeof request.kind !== "string") {
			this.fail("插件 worker 发送了非法的能力请求", "protocol", "message");
			return;
		}
		if (!CAPABILITY_KINDS.has(request.kind)) {
			this.fail(
				`插件 worker 请求了未知能力：${request.kind}`,
				"protocol",
				"message",
			);
			return;
		}
		const capability = request.kind as CodePluginPermissionKind;
		const action = capabilityAction(capability, request);
		const target = capabilityTarget(capability, request);
		const startedAt = performance.now();
		try {
			const value = await this.dispatchCapability(capability, request);
			this.record({
				kind: "permission",
				action,
				capability,
				target,
				outcome: "allowed",
				reason: null,
				durationMs: Math.round(performance.now() - startedAt),
			});
			this.sendResponse(id as number, true, value);
		} catch (error) {
			const outcome =
				error instanceof CapabilityError ? error.outcome : "failed";
			const reason = errorText(error);
			this.record({
				kind: "permission",
				action,
				capability,
				target,
				outcome,
				reason,
				durationMs: Math.round(performance.now() - startedAt),
			});
			this.sendResponse(id as number, false, undefined, reason);
		}
	}

	private dispatchCapability(
		capability: CodePluginPermissionKind,
		request: Record<string, unknown>,
	): unknown | Promise<unknown> {
		switch (capability) {
			case "network":
				return this.brokerNetwork(request);
			case "files":
				return this.brokerFiles(request);
			case "model":
				return this.brokerModel(request);
			case "ledger-write":
				return this.brokerLedgerWrite(request);
		}
	}

	private async brokerNetwork(
		request: Record<string, unknown>,
	): Promise<JsonObject> {
		const url = readText(request.url, "network.url");
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new CapabilityError(`网络地址不合法：${url}`, "rejected");
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new CapabilityError(
				`只允许 http 或 https：${parsed.protocol}`,
				"rejected",
			);
		}
		const permission = this.permission("network");
		if (
			permission === undefined ||
			permission.kind !== "network" ||
			!permission.hosts.some((host) => hostMatches(host, parsed))
		) {
			throw new CapabilityError(
				`插件 ${this.name} 没有声明访问 ${parsed.host} 的网络权限`,
				"denied",
			);
		}
		const options = readNetworkOptions(request.options);
		const response = await this.fetchImpl(parsed, options);
		const body = await response.text();
		if (Buffer.byteLength(body, "utf8") > this.maxMessageBytes) {
			throw new CapabilityError(
				`网络响应超过 ${this.maxMessageBytes} 字节上限`,
				"rejected",
			);
		}
		const headers: JsonObject = {};
		for (const [key, value] of response.headers) headers[key] = value;
		return {
			status: response.status,
			ok: response.ok,
			headers,
			body,
		};
	}

	private async brokerFiles(
		request: Record<string, unknown>,
	): Promise<JsonObject> {
		const access = request.access;
		if (access !== "read" && access !== "write") {
			throw new CapabilityError(
				"files.access 只能是 read 或 write",
				"rejected",
			);
		}
		const relative = readPluginRelativePath(request.path);
		const permission = this.permission("files");
		if (permission === undefined || permission.kind !== "files") {
			throw new CapabilityError(`插件 ${this.name} 没有声明文件权限`, "denied");
		}
		if (!permission.paths.some((path) => pathAllows(path, relative))) {
			throw new CapabilityError(
				`插件 ${this.name} 没有声明访问 ${relative} 的文件权限`,
				"denied",
			);
		}
		if (access === "write" && permission.access !== "read-write") {
			throw new CapabilityError(
				`插件 ${this.name} 的文件权限只允许读取`,
				"denied",
			);
		}
		const target = this.resolvePluginPath(relative);
		if (access === "read") {
			const real = await realpath(target);
			if (!isInside(this.pluginRoot as string, real)) {
				throw new CapabilityError(`文件不在插件目录内：${relative}`, "denied");
			}
			const content = await readFile(real, "utf8");
			if (Buffer.byteLength(content, "utf8") > this.maxMessageBytes) {
				throw new CapabilityError(
					`文件内容超过 ${this.maxMessageBytes} 字节上限`,
					"rejected",
				);
			}
			return { content };
		}
		const content = request.content;
		if (typeof content !== "string") {
			throw new CapabilityError("files.content 必须是字符串", "rejected");
		}
		if (Buffer.byteLength(content, "utf8") > this.maxMessageBytes) {
			throw new CapabilityError(
				`写入内容超过 ${this.maxMessageBytes} 字节上限`,
				"rejected",
			);
		}
		await assertExistingPathInside(this.pluginRoot as string, target);
		const parent = await realpath(dirname(target));
		if (!isInside(this.pluginRoot as string, parent)) {
			throw new CapabilityError(`目录不在插件目录内：${relative}`, "denied");
		}
		await writeFile(target, content, "utf8");
		return { written: content.length };
	}

	private async brokerModel(
		request: Record<string, unknown>,
	): Promise<JsonValue> {
		const role = readText(request.role, "model.role");
		if (!(LLM_MODEL_ROLE_NAMES as readonly string[]).includes(role)) {
			throw new CapabilityError(
				`模型角色必须是 ${LLM_MODEL_ROLE_NAMES.join("、")} 之一：${role}`,
				"rejected",
			);
		}
		const permission = this.permission("model");
		if (
			permission === undefined ||
			permission.kind !== "model" ||
			!permission.roles.includes(role as LlmModelRole)
		) {
			throw new CapabilityError(
				`插件 ${this.name} 没有声明调用 ${role} 模型的权限`,
				"denied",
			);
		}
		const messages = request.messages;
		assertJsonValue(messages, "model.messages");
		const options: JsonValue =
			request.options === undefined ? null : (request.options as JsonValue);
		assertJsonValue(options, "model.options");
		if (this.options.model === undefined) {
			throw new CapabilityError(
				`插件 ${this.name} 声明了模型权限，但宿主没有配置模型调用处理器`,
				"failed",
			);
		}
		const value = await this.options.model({
			plugin: this.name,
			role: role as LlmModelRole,
			messages: messages as readonly JsonValue[],
			options,
		});
		assertJsonValue(value, "model.result");
		return value as JsonValue;
	}

	private async brokerLedgerWrite(
		request: Record<string, unknown>,
	): Promise<JsonObject> {
		const raw = request.diffs;
		if (!Array.isArray(raw) || raw.length === 0) {
			throw new CapabilityError(
				"ledger-write.diffs 必须是非空数组",
				"rejected",
			);
		}
		const permission = this.permission("ledger-write");
		const diffs: LedgerDiffInput[] = [];
		for (let index = 0; index < raw.length; index += 1) {
			const value = raw[index];
			if (!isJsonObject(value)) {
				throw new CapabilityError(
					`ledger-write.diffs[${index}] 必须是对象`,
					"rejected",
				);
			}
			const path = value.path;
			if (!Array.isArray(path) || path.length === 0) {
				throw new CapabilityError(
					`ledger-write.diffs[${index}].path 必须是非空数组`,
					"rejected",
				);
			}
			const namespace = path[0];
			if (
				typeof namespace !== "string" ||
				permission === undefined ||
				permission.kind !== "ledger-write" ||
				!permission.namespaces.some((allowed) => allowed === namespace)
			) {
				throw new CapabilityError(
					`插件 ${this.name} 没有声明写入 ${String(namespace)} 台账的权限`,
					"denied",
				);
			}
			const diff: LedgerDiffInput = {
				path: path as string[],
				op: value.op as LedgerDiffInput["op"],
				...(value.value === undefined ? {} : { value: value.value }),
				...(value.storyTime === undefined
					? {}
					: { storyTime: value.storyTime as LedgerDiffInput["storyTime"] }),
				...(value.confidence === undefined
					? {}
					: { confidence: value.confidence as number | null }),
				source: "settler",
			};
			try {
				validateLedgerDiff(diff);
			} catch (error) {
				throw new CapabilityError(
					`台账 diff 校验失败：${errorText(error)}`,
					"rejected",
				);
			}
			diffs.push(diff);
		}
		if (this.options.ledger === undefined) {
			throw new CapabilityError(
				`插件 ${this.name} 声明了台账写入权限，但宿主没有配置待校验 diff 接收器`,
				"failed",
			);
		}
		await this.options.ledger(diffs, this.name);
		return { accepted: diffs.length };
	}

	private handleRegistration(message: Record<string, unknown>): void {
		const kind = message.kind;
		try {
			if (kind === "slot") {
				this.registerSlot(readText(message.name, "slot.name"));
				return;
			}
			if (kind === "tool") {
				this.registerTool(message.definition, message.phases);
				return;
			}
			if (kind === "block-type") {
				this.registerBlockType(message.definition);
				return;
			}
		} catch (error) {
			this.record({
				kind: "registration",
				action: typeof kind === "string" ? kind : "unknown",
				outcome: "rejected",
				target: null,
				reason: errorText(error),
			});
			return;
		}
		if (kind === "mechanism") {
			this.record({
				kind: "registration",
				action: "mechanism",
				outcome: "rejected",
				target: typeof message.name === "string" ? message.name : null,
				reason:
					"Director 机制必须是同步纯函数（I9），代码插件不能注册；请改用声明式插件或后台任务",
			});
			return;
		}
		this.fail(
			`插件 worker 注册了未知扩展点：${String(kind)}`,
			"protocol",
			"message",
		);
	}

	private registerSlot(name: string): void {
		const registry = this.options.registry;
		if (registry === undefined) {
			this.record({
				kind: "registration",
				action: "slot",
				outcome: "rejected",
				target: name,
				reason: "宿主没有提供扩展点注册表",
			});
			return;
		}
		try {
			const remove = registry.addSlot(name, this.name, {
				plugin: this.name,
				provide: async (request) => this.provideSlot(name, request),
			});
			this.registrations.push({ action: "slot", target: name, remove });
			this.record({
				kind: "registration",
				action: "slot",
				outcome: "registered",
				target: name,
				reason: null,
			});
		} catch (error) {
			this.record({
				kind: "registration",
				action: "slot",
				outcome: "rejected",
				target: name,
				reason: errorText(error),
			});
		}
	}

	private async provideSlot(
		name: string,
		request: ContextSlotRequest,
	): Promise<ContextSlotContent | null> {
		if (this.runtimeState !== "active") return null;
		try {
			const value = await this.invokeWorker("slot", name, request);
			return parseSlotContent(value, this.name);
		} catch (error) {
			if (this.runtimeState === "active") {
				this.record({
					kind: "lifecycle",
					action: "slot",
					outcome: "failed",
					target: name,
					reason: errorText(error),
				});
			}
			return null;
		}
	}

	private registerTool(definition: unknown, phases: unknown): void {
		const registry = this.options.registry;
		const parsed = parseToolDefinition(definition, phases);
		if (registry === undefined) {
			this.record({
				kind: "registration",
				action: "tool",
				outcome: "rejected",
				target: parsed.name,
				reason: "宿主没有提供扩展点注册表",
			});
			return;
		}
		try {
			const name = parsed.name;
			const remove = registry.addTool(
				name,
				{
					...parsed,
					execute: (args: JsonObject) => this.invokeWorker("tool", name, args),
				},
				parsed.phases,
			);
			this.registrations.push({ action: "tool", target: name, remove });
			this.record({
				kind: "registration",
				action: "tool",
				outcome: "registered",
				target: name,
				reason: null,
			});
		} catch (error) {
			this.record({
				kind: "registration",
				action: "tool",
				outcome: "rejected",
				target: parsed.name,
				reason: errorText(error),
			});
		}
	}

	private registerBlockType(definition: unknown): void {
		const registry = this.options.registry;
		const parsed = parseBlockTypeDefinition(definition);
		if (registry === undefined) {
			this.record({
				kind: "registration",
				action: "block-type",
				outcome: "rejected",
				target: parsed.name,
				reason: "宿主没有提供扩展点注册表",
			});
			return;
		}
		try {
			const remove = registry.addBlockType(this.name, parsed);
			this.registrations.push({
				action: "block-type",
				target: parsed.name,
				remove,
			});
			this.record({
				kind: "registration",
				action: "block-type",
				outcome: "registered",
				target: parsed.name,
				reason: null,
			});
		} catch (error) {
			this.record({
				kind: "registration",
				action: "block-type",
				outcome: "rejected",
				target: parsed.name,
				reason: errorText(error),
			});
		}
	}

	private handleInvokeResult(message: Record<string, unknown>): void {
		const id = message.id;
		if (!Number.isInteger(id)) {
			this.fail("插件 worker 发送了非法的调用结果 id", "protocol", "message");
			return;
		}
		const pending = this.pendingInvokes.get(id as number);
		if (pending === undefined) {
			this.record({
				kind: "protocol",
				action: "invoke",
				outcome: "rejected",
				target: null,
				reason: `收到未知调用 id ${String(id)} 的结果`,
			});
			return;
		}
		clearTimeout(pending.timer);
		this.pendingInvokes.delete(id as number);
		if (message.ok === true) {
			pending.resolve(message.value);
			return;
		}
		pending.reject(
			new Error(readMessageText(message.error, "插件调用失败原因")),
		);
	}

	private invokeWorker(
		call: "slot" | "tool",
		name: string,
		payload: unknown,
	): Promise<unknown> {
		if (this.runtimeState !== "active" || this.worker === null) {
			return Promise.reject(
				new Error(`插件 ${this.name} 当前状态为 ${this.runtimeState}`),
			);
		}
		const id = this.nextInvokeId++;
		const message = { type: "invoke", id, call, name, payload };
		const bytes = messageBytes(message);
		if (bytes === null || bytes > this.maxMessageBytes) {
			return Promise.reject(
				new Error(
					`调用 ${call}:${name} 的消息大小 ${bytes ?? "未知"} 超过上限 ${this.maxMessageBytes}`,
				),
			);
		}
		const deferred = Promise.withResolvers<unknown>();
		const timer = setTimeout(() => {
			this.pendingInvokes.delete(id);
			const reason = `插件 ${call}:${name} 超过 ${this.invokeTimeoutMs} 毫秒没有返回`;
			this.fail(reason, "lifecycle", call);
			deferred.reject(new Error(reason));
		}, this.invokeTimeoutMs);
		this.pendingInvokes.set(id, {
			resolve: deferred.resolve,
			reject: deferred.reject,
			timer,
		});
		try {
			this.worker.postMessage(message);
		} catch (error) {
			clearTimeout(timer);
			this.pendingInvokes.delete(id);
			return Promise.reject(new Error(`调用消息无法发送：${errorText(error)}`));
		}
		return deferred.promise;
	}

	private sendResponse(
		id: number,
		ok: boolean,
		value?: unknown,
		error?: string,
	): void {
		const worker = this.worker;
		if (worker === null) return;
		let message: Record<string, unknown>;
		if (!ok) {
			message = { type: "response", id, ok: false, error: error ?? "失败" };
		} else {
			try {
				assertJsonValue(value, "capability.result");
			} catch (caught) {
				const reason = `能力返回值不是 JSON：${errorText(caught)}`;
				this.record({
					kind: "protocol",
					action: "response",
					outcome: "rejected",
					target: null,
					reason,
				});
				worker.postMessage({ type: "response", id, ok: false, error: reason });
				return;
			}
			message = { type: "response", id, ok: true, value };
		}
		const bytes = messageBytes(message);
		if (bytes === null || bytes > this.maxMessageBytes) {
			const reason =
				bytes === null
					? "返回值无法序列化"
					: `返回值 ${bytes} 字节超过上限 ${this.maxMessageBytes}`;
			this.record({
				kind: "protocol",
				action: "response",
				outcome: "rejected",
				target: null,
				reason,
			});
			worker.postMessage({ type: "response", id, ok: false, error: reason });
			return;
		}
		worker.postMessage(message);
	}

	private permission(
		kind: CodePluginPermissionKind,
	): CodePluginPermission | undefined {
		return this.granted.find((permission) => permission.kind === kind);
	}

	private resolvePluginPath(relative: string): string {
		const root = this.pluginRoot as string;
		const target = resolve(root, relative);
		if (!isInside(root, target)) {
			throw new CapabilityError(
				`文件路径不在插件目录内：${relative}`,
				"denied",
			);
		}
		return target;
	}

	private fail(
		reason: string,
		kind: CodePluginTraceKind,
		action: string,
	): void {
		if (this.runtimeState === "failed" || this.runtimeState === "disposed") {
			return;
		}
		this.runtimeState = "failed";
		this.failureReason = reason;
		this.clearActivationTimer();
		this.record({
			kind,
			action,
			outcome: "failed",
			reason,
		});
		this.cleanupRegistrations();
		this.rejectPending(reason);
		this.ready.resolve(this.status);
		const worker = this.worker;
		this.worker = null;
		if (worker !== null) void worker.terminate();
	}

	private cleanupRegistrations(): void {
		for (const registration of this.registrations.splice(0).reverse()) {
			registration.remove();
			this.record({
				kind: "registration",
				action: registration.action,
				outcome: "unregistered",
				target: registration.target,
				reason: null,
			});
		}
	}

	private rejectPending(reason: string): void {
		for (const [id, pending] of this.pendingInvokes) {
			clearTimeout(pending.timer);
			pending.reject(new Error(reason));
			this.pendingInvokes.delete(id);
		}
	}

	private clearActivationTimer(): void {
		if (this.activationTimer !== null) {
			clearTimeout(this.activationTimer);
			this.activationTimer = null;
		}
	}

	private record(input: {
		readonly kind: CodePluginTraceKind;
		readonly action: string;
		readonly capability?: CodePluginPermissionKind | null;
		readonly target?: string | null;
		readonly outcome: CodePluginTraceOutcome;
		readonly reason: string | null;
		readonly durationMs?: number;
	}): void {
		const entry: CodePluginTraceEntry = {
			plugin: this.name,
			kind: input.kind,
			action: input.action,
			capability: input.capability ?? null,
			target: input.target ?? null,
			outcome: input.outcome,
			reason: input.reason,
			durationMs: input.durationMs ?? 0,
			at: new Date().toISOString(),
		};
		this.entries.push(entry);
		if (this.entries.length > this.maxTraceEntries) {
			this.entries.splice(0, this.entries.length - this.maxTraceEntries);
		}
		this.options.onTrace?.(entry);
	}
}

/** 启动一个代码插件；插件激活失败时返回 failed 状态的运行时，不抛错。 */
export async function startCodePluginRuntime(
	options: CodePluginRuntimeOptions,
): Promise<CodePluginRuntime> {
	const runtime = new CodePluginRuntime(options);
	await runtime.start();
	return runtime;
}

function capabilityAction(
	capability: CodePluginPermissionKind,
	request: Record<string, unknown>,
): string {
	if (capability === "files") {
		return request.access === "write" ? "files.write" : "files.read";
	}
	return capability;
}

function capabilityTarget(
	capability: CodePluginPermissionKind,
	request: Record<string, unknown>,
): string | null {
	switch (capability) {
		case "network":
			return typeof request.url === "string" ? request.url : null;
		case "files":
			return typeof request.path === "string"
				? `${String(request.access ?? "read")}:${request.path}`
				: null;
		case "model":
			return typeof request.role === "string" ? request.role : null;
		case "ledger-write": {
			if (!Array.isArray(request.diffs)) return null;
			const namespaces = new Set<string>();
			for (const diff of request.diffs) {
				if (!isJsonObject(diff) || !Array.isArray(diff.path)) continue;
				if (typeof diff.path[0] === "string") {
					namespaces.add(diff.path[0]);
				}
			}
			return [...namespaces].join(",");
		}
	}
}

function readNetworkOptions(value: unknown): RequestInit {
	if (value === undefined || value === null) return {};
	if (!isJsonObject(value)) {
		throw new CapabilityError("network.options 必须是对象", "rejected");
	}
	const init: RequestInit = {};
	if (value.method !== undefined) {
		init.method = readText(value.method, "network.options.method");
	}
	if (value.body !== undefined) {
		if (typeof value.body !== "string") {
			throw new CapabilityError(
				"network.options.body 必须是字符串",
				"rejected",
			);
		}
		init.body = value.body;
	}
	if (value.headers !== undefined) {
		if (!isJsonObject(value.headers)) {
			throw new CapabilityError(
				"network.options.headers 必须是对象",
				"rejected",
			);
		}
		const headers: Record<string, string> = {};
		for (const [key, header] of Object.entries(value.headers)) {
			if (typeof header !== "string") {
				throw new CapabilityError(
					`network.options.headers.${key} 必须是字符串`,
					"rejected",
				);
			}
			headers[key] = header;
		}
		init.headers = headers;
	}
	return init;
}

/** 主机权限的匹配：无端口时匹配任意端口，`*.example.com` 匹配子域。 */
function hostMatches(permissionHost: string, url: URL): boolean {
	const { host, port } = splitHostPort(permissionHost);
	if (port !== null && port !== effectivePort(url)) return false;
	const actual = url.hostname.toLowerCase();
	if (host.startsWith("*.")) {
		const suffix = host.slice(2);
		return actual.endsWith(`.${suffix}`);
	}
	return actual === host;
}

function splitHostPort(value: string): {
	readonly host: string;
	readonly port: string | null;
} {
	const index = value.lastIndexOf(":");
	if (index < 0) return { host: value, port: null };
	return { host: value.slice(0, index), port: value.slice(index + 1) };
}

function effectivePort(url: URL): string {
	if (url.port !== "") return url.port;
	return url.protocol === "https:" ? "443" : "80";
}

/** 文件权限的路径匹配：目录前缀匹配，`"."` 表示整个插件目录。 */
function pathAllows(permissionPath: string, requested: string): boolean {
	if (permissionPath === ".") return true;
	return (
		requested === permissionPath || requested.startsWith(`${permissionPath}/`)
	);
}

function parseSlotContent(value: unknown, plugin: string): ContextSlotContent {
	if (!isJsonObject(value)) {
		throw new Error(`插件 ${plugin} 的槽位返回值必须是对象`);
	}
	const messages = value.messages;
	if (!Array.isArray(messages)) {
		throw new Error(`插件 ${plugin} 的槽位返回值缺少 messages 数组`);
	}
	const parsedMessages: ContextMessage[] = messages.map((message, index) => {
		if (!isJsonObject(message)) {
			throw new Error(
				`插件 ${plugin} 的槽位返回值 messages[${index}] 必须是对象`,
			);
		}
		const role = message.role;
		if (role !== "system" && role !== "user" && role !== "assistant") {
			throw new Error(
				`插件 ${plugin} 的槽位返回值 messages[${index}].role 不合法`,
			);
		}
		if (typeof message.content !== "string" || message.content.length === 0) {
			throw new Error(
				`插件 ${plugin} 的槽位返回值 messages[${index}].content 必须是非空字符串`,
			);
		}
		return { role, content: message.content };
	});
	const source = value.source;
	if (typeof source !== "string" || source.trim().length === 0) {
		throw new Error(`插件 ${plugin} 的槽位返回值必须带 source`);
	}
	const suffix = value.suffix;
	if (suffix !== undefined && typeof suffix !== "string") {
		throw new Error(`插件 ${plugin} 的槽位返回值 suffix 必须是字符串`);
	}
	return {
		messages: parsedMessages,
		source,
		...(suffix === undefined ? {} : { suffix }),
	};
}

function parseToolDefinition(
	value: unknown,
	phases: unknown,
): DeepToolDefinition & { readonly phases: readonly ToolPhase[] } {
	assertJsonValue(value, "tool.definition");
	const object = assertPlainObject(value, "tool.definition");
	rejectUnknownKeys(object, TOOL_KEYS, "tool.definition");
	const name = readText(object.name, "tool.definition.name");
	const description = readText(
		object.description,
		"tool.definition.description",
	);
	const parameters = assertPlainObject(
		object.parameters,
		"tool.definition.parameters",
	);
	const permission = object.permission;
	if (
		permission !== "read" &&
		permission !== "propose" &&
		permission !== "control" &&
		permission !== "side_effect"
	) {
		throw new Error(
			"tool.definition.permission 必须是 read、propose、control 或 side_effect",
		);
	}
	if (permission !== "read") {
		throw new Error(
			`工具 ${name} 由代码插件提供时必须是 read 权限；其余权限的执行路径需要内核另行接入`,
		);
	}
	const progressLabel = readText(
		object.progressLabel,
		"tool.definition.progressLabel",
	);
	if (!Array.isArray(phases) || phases.length === 0) {
		throw new Error("tool.phases 必须是非空数组");
	}
	const parsedPhases: ToolPhase[] = phases.map((phase, index) => {
		if (phase !== "fast" && phase !== "deep") {
			throw new Error(`tool.phases[${index}] 必须是 fast 或 deep`);
		}
		return phase;
	});
	const definition: DeepToolDefinition = {
		name,
		description,
		parameters,
		permission,
		progressLabel,
	};
	createDeepToolRegistry([definition]);
	return { ...definition, phases: parsedPhases };
}

function parseBlockTypeDefinition(value: unknown): BlockTypeDefinition {
	assertJsonValue(value, "blockType.definition");
	const object = assertPlainObject(value, "blockType.definition");
	rejectUnknownKeys(object, BLOCK_TYPE_KEYS, "blockType.definition");
	const name = readText(object.name, "blockType.definition.name");
	const semantics = assertPlainObject(
		object.semantics,
		"blockType.definition.semantics",
	);
	if (semantics.kind !== "none") {
		throw new Error(
			"代码插件的块类型只能声明 semantics.kind 为 none；语义处理器必须同步执行",
		);
	}
	const display = object.display;
	const context = object.context;
	if (!isJsonObject(display) || !isJsonObject(context)) {
		throw new Error("blockType.definition 的 display 与 context 必须是对象");
	}
	return {
		name,
		display: display as unknown as BlockTypeDefinition["display"],
		context: context as unknown as BlockTypeDefinition["context"],
		semantics: { kind: "none" },
	};
}

async function assertExistingPathInside(
	root: string,
	target: string,
): Promise<void> {
	try {
		const real = await realpath(target);
		if (!isInside(root, real)) {
			throw new CapabilityError("目标是插件目录外的符号链接", "denied");
		}
	} catch (error) {
		if (error instanceof CapabilityError) throw error;
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function isInside(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function readPluginRelativePath(value: unknown): string {
	try {
		return assertCodePluginRelativePath(value, "files.path");
	} catch (error) {
		throw new CapabilityError(errorText(error), "rejected");
	}
}

function readText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new CapabilityError(`${label} 必须是非空字符串`, "rejected");
	}
	return value;
}

function readMessageText(value: unknown, label: string): string {
	return typeof value === "string" && value.length > 0 ? value : `${label}缺失`;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function messageBytes(value: unknown): number | null {
	try {
		const json = JSON.stringify(value);
		return json === undefined ? null : Buffer.byteLength(json, "utf8");
	} catch {
		return null;
	}
}

function onceExit(worker: Worker): Promise<void> {
	const deferred = Promise.withResolvers<void>();
	worker.once("exit", () => deferred.resolve());
	return deferred.promise;
}

function delay(ms: number): Promise<void> {
	const deferred = Promise.withResolvers<void>();
	setTimeout(deferred.resolve, ms);
	return deferred.promise;
}

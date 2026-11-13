import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import {
	type StEjsExecutionRun,
	type StEjsRuntime,
	StEjsTemplateError,
	type StEjsTemplateExecution,
	type StEjsTemplateExecutor,
	type StEjsTemplateTraceEntry,
} from "./runtime.js";
import { StEjsVariableError } from "./variables.js";

/**
 * 模板执行沙箱：编译与执行都在 worker 里，模板函数在 `node:vm` 上下文里调用；
 * 上下文只拿到序列化后的变量快照，函数调用经同步 RPC 回到主线程执行。
 * 超时直接终止 worker，下一次执行重新启动一个。
 */

export const DEFAULT_SANDBOX_BUDGET_MS = 5_000;
export const DEFAULT_SANDBOX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_IDLE_WORKERS = 2;

const UNDEFINED_KEY = "__st_ejs_undefined__";
const REGEXP_KEY = "__st_ejs_regexp__";
const RESPONSE_SEQUENCE = 0;
const RESPONSE_LENGTH = 1;

/**
 * 沙箱与主线程之间的值编码：`undefined` 与正则换成带标记的对象，
 * 其余按 JSON 传递；函数、bigint 与循环引用直接拒绝。
 */
export function encodeSandboxValue(
	value: unknown,
	seen = new WeakSet(),
): unknown {
	if (value === undefined) return { [UNDEFINED_KEY]: true };
	if (value instanceof RegExp)
		return { [REGEXP_KEY]: [value.source, value.flags] };
	if (typeof value === "function") {
		throw new StEjsVariableError("沙箱执行不支持函数参数");
	}
	if (typeof value === "bigint") {
		throw new StEjsVariableError("沙箱执行不支持 bigint");
	}
	if (typeof value !== "object" || value === null) return value;
	if (seen.has(value)) {
		throw new StEjsVariableError("沙箱执行不支持循环引用");
	}
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((entry) => encodeSandboxValue(entry, seen));
		}
		const output: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			output[key] = encodeSandboxValue(
				(value as Record<string, unknown>)[key],
				seen,
			);
		}
		return output;
	} finally {
		seen.delete(value);
	}
}

export function decodeSandboxValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(decodeSandboxValue);
	if (typeof value !== "object" || value === null) return value;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length === 1 && record[UNDEFINED_KEY] === true) return undefined;
	if (keys.length === 1 && Array.isArray(record[REGEXP_KEY])) {
		const parts = record[REGEXP_KEY] as unknown[];
		const source = typeof parts[0] === "string" ? parts[0] : "";
		const flags = typeof parts[1] === "string" ? parts[1] : "";
		return new RegExp(source, flags);
	}
	const output: Record<string, unknown> = {};
	for (const key of keys) output[key] = decodeSandboxValue(record[key]);
	return output;
}

/** 沙箱里执行一段模板时用的上下文代码；主线程只通过 `host` 传入隐藏的句柄。 */
const SANDBOX_BOOTSTRAP = String.raw`
(function (host) {
	"use strict";
	const control = host.control;
	const response = host.response;
	const encoder = host.encoder;
	const decoder = host.decoder;
	const compile = host.compile;
	const postCall = host.postCall;
	const allowed = new Set(host.allowedNames);
	const RESERVED = new Set(["print", "__append", "define", "evalTemplate", "variables"]);
	const UNDEFINED_KEY = "__st_ejs_undefined__";
	const REGEXP_KEY = "__st_ejs_regexp__";
	const UNSAFE_NAMES = ["__proto__", "constructor", "prototype", "print"];
	const MAX_DEPTH = 16;

	const definitions = new Map();
	const variables = {};
	let escapeMode = "string";
	let callCounter = 0;
	let depth = 0;

	function isPlainObject(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	function encode(value) {
		if (value === undefined) {
			const marker = {};
			marker[UNDEFINED_KEY] = true;
			return marker;
		}
		if (value instanceof RegExp) {
			const marker = {};
			marker[REGEXP_KEY] = [value.source, value.flags];
			return marker;
		}
		if (typeof value === "function") {
			throw new Error("模板参数里不支持函数");
		}
		if (typeof value === "bigint") {
			throw new Error("模板参数里不支持 bigint");
		}
		if (Array.isArray(value)) {
			return value.map(encode);
		}
		if (isPlainObject(value)) {
			const output = {};
			for (const key of Object.keys(value)) {
				output[key] = encode(value[key]);
			}
			return output;
		}
		return value;
	}

	function decode(value) {
		if (Array.isArray(value)) {
			return value.map(decode);
		}
		if (isPlainObject(value)) {
			const keys = Object.keys(value);
			if (keys.length === 1 && value[UNDEFINED_KEY] === true) {
				return undefined;
			}
			if (keys.length === 1 && Array.isArray(value[REGEXP_KEY])) {
				const parts = value[REGEXP_KEY];
				return new RegExp(parts[0], parts[1] || "");
			}
			const output = {};
			for (const key of keys) {
				output[key] = decode(value[key]);
			}
			return output;
		}
		return value;
	}

	function mergeValue(target, source) {
		if (isPlainObject(target) && isPlainObject(source)) {
			for (const key of Object.keys(source)) {
				target[key] = mergeValue(target[key], source[key]);
			}
			return target;
		}
		if (Array.isArray(target) && Array.isArray(source)) {
			for (let index = 0; index < source.length; index += 1) {
				target[index] = mergeValue(target[index], source[index]);
			}
			return target;
		}
		return source;
	}

	function replaceVariables(tree) {
		for (const key of Object.keys(variables)) {
			delete variables[key];
		}
		if (isPlainObject(tree)) {
			for (const key of Object.keys(tree)) {
				variables[key] = tree[key];
			}
		}
	}

	function callSync(name, args) {
		if (name !== "__escape" && !allowed.has(name)) {
			throw new Error("模板函数 " + name + " 不在允许清单里");
		}
		callCounter += 1;
		const id = callCounter;
		let argsJson;
		try {
			argsJson = JSON.stringify(encode(args));
		} catch (error) {
			throw new Error("模板参数无法发送：" + (error && error.message ? error.message : String(error)));
		}
		postCall(id, name, argsJson);
		let seen = Atomics.load(control, 0);
		while (seen < id) {
			Atomics.wait(control, 0, seen);
			seen = Atomics.load(control, 0);
		}
		const length = Atomics.load(control, 1);
		const payload = JSON.parse(decoder.decode(response.subarray(0, length)));
		if (payload.ok !== true) {
			const failure = payload.error || {};
			const error = new Error(failure.message || "远程调用失败");
			if (failure.name) {
				error.name = failure.name;
			}
			throw error;
		}
		replaceVariables(decode(payload.variables));
		return decode(payload.value);
	}

	function stringifyOutput(value) {
		if (value === undefined || value === null) {
			return "";
		}
		return String(value);
	}

	function makeLocals(chunks) {
		const locals = {};
		for (const entry of definitions) {
			const name = entry[0];
			const value = entry[1];
			locals[name] = typeof value === "function" ? value.bind(locals) : value;
		}
		locals.variables = variables;
		for (const name of allowed) {
			if (RESERVED.has(name)) {
				continue;
			}
			locals[name] = function () {
				return callSync(name, Array.prototype.slice.call(arguments));
			};
		}
		const append = function () {
			for (let index = 0; index < arguments.length; index += 1) {
				const value = arguments[index];
				if (value !== undefined && value !== null) {
					chunks.push(String(value));
				}
			}
		};
		locals.print = append;
		locals.__append = append;
		locals.define = function (name, value, merge) {
			if (typeof name !== "string" || name.length === 0) {
				throw new Error("define 的名称必须是非空字符串");
			}
			if (UNSAFE_NAMES.includes(name)) {
				throw new Error("define 不能使用名称 " + name);
			}
			const existing = definitions.get(name);
			if (merge === true && existing !== undefined) {
				definitions.set(name, mergeValue(existing, value));
				return;
			}
			definitions.set(name, value);
		};
		locals.evalTemplate = function (content, data) {
			return render(content, data || {});
		};
		return locals;
	}

	async function render(text, data) {
		if (typeof text !== "string") {
			throw new Error("输入必须是字符串");
		}
		if (depth >= MAX_DEPTH) {
			throw new Error("evalTemplate 嵌套超过 " + MAX_DEPTH + " 层");
		}
		depth += 1;
		try {
			const compiled = compile(text);
			const factory = (0, eval)("(" + compiled + ")");
			const chunks = [];
			const locals = makeLocals(chunks);
			for (const key of Object.keys(data || {})) {
				locals[key] = data[key];
			}
			const escapeFn = escapeMode === "remote"
				? function (value) { return callSync("__escape", [stringifyOutput(value)]); }
				: function (value) { return stringifyOutput(value); };
			const include = function () { throw new Error("沙箱里不支持 include"); };
			const rendered = await factory(locals, escapeFn, include, undefined);
			return chunks.length > 0 ? chunks.join("") : rendered;
		} finally {
			depth -= 1;
		}
	}

	return {
		run: async function (text, variablesJson, source, mode) {
			escapeMode = mode === "remote" ? "remote" : "string";
			replaceVariables(JSON.parse(variablesJson));
			return await render(text, {});
		},
	};
})
`;

/** worker 线程里的外壳：每个执行请求建一个干净的 vm 上下文，编译模板并返回结果。 */
const WORKER_SOURCE = String.raw`
"use strict";
const vm = require("node:vm");
const { parentPort, workerData } = require("node:worker_threads");
const ejs = require(workerData.ejsPath);

function compileTemplate(text) {
	return ejs
		.compile(text, {
			client: true,
			compileDebug: true,
			async: true,
			cache: false,
			localsName: "locals",
		})
		.toString();
}

function errorText(error) {
	return error && typeof error.message === "string" ? error.message : String(error);
}

parentPort.on("message", async (message) => {
	if (!message || message.type !== "execute") return;
	const executionId = message.executionId;
	let api;
	try {
		const control = new Int32Array(workerData.controlSab);
		const response = new Uint8Array(workerData.responseSab);
		const context = vm.createContext({});
		api = vm.runInContext(workerData.bootstrap, context)({
			control,
			response,
			encoder: new TextEncoder(),
			decoder: new TextDecoder(),
			allowedNames: workerData.allowedNames,
			compile: compileTemplate,
			postCall: (id, name, argsJson) => {
				parentPort.postMessage({ type: "call", executionId, id, name, argsJson });
			},
		});
	} catch (error) {
		parentPort.postMessage({
			type: "done",
			executionId,
			error: { name: "Error", message: "沙箱初始化失败：" + errorText(error) },
		});
		return;
	}
	try {
		const output = await api.run(
			message.template,
			message.variablesJson,
			message.source,
			message.escape,
		);
		parentPort.postMessage({ type: "done", executionId, output: String(output) });
	} catch (error) {
		parentPort.postMessage({
			type: "done",
			executionId,
			error: {
				name: (error && error.name) || "Error",
				message: errorText(error),
			},
		});
	}
});
`;

/** 执行记录与运行时共用同一个结构，超时跳过时 `output` 为 null。 */
export type StEjsSandboxTraceEntry = StEjsTemplateTraceEntry;
export type StEjsSandboxRun = StEjsExecutionRun;

export class StEjsSandboxTimeoutError extends Error {
	readonly source: string;
	readonly durationMs: number;
	readonly budgetMs: number;
	readonly functions: readonly string[];

	constructor(input: {
		source: string;
		durationMs: number;
		budgetMs: number;
		functions: readonly string[];
	}) {
		super(
			`模板 ${input.source} 执行超过时间预算 ${input.budgetMs} 毫秒（已执行 ${input.durationMs} 毫秒）`,
		);
		this.name = "StEjsSandboxTimeoutError";
		this.source = input.source;
		this.durationMs = input.durationMs;
		this.budgetMs = input.budgetMs;
		this.functions = input.functions;
	}
}

export interface StEjsSandboxOptions {
	readonly runtime: StEjsRuntime;
	/** 单次执行的时间预算；超时终止 worker。 */
	readonly budgetMs?: number;
	/** 允许模板调用的函数名；缺省是运行时的全部沙箱函数。 */
	readonly allowedFunctions?: readonly string[];
	/** 一次远程调用返回值的大小上限。 */
	readonly responseBytes?: number;
	/** 空闲 worker 的保留数量。 */
	readonly maxIdleWorkers?: number;
}

interface PendingExecution {
	readonly executionId: number;
	readonly source: string;
	readonly functions: string[];
	readonly resolve: (output: string) => void;
	readonly reject: (error: unknown) => void;
	readonly timer: NodeJS.Timeout;
}

interface SandboxWorkerHandle {
	readonly worker: Worker;
	readonly control: Int32Array;
	readonly response: Uint8Array;
	current: PendingExecution | null;
	alive: boolean;
}

interface SandboxCallMessage {
	readonly executionId: number;
	readonly id: number;
	readonly name: string;
	readonly argsJson: string;
}

function assertPositiveInt(value: number, label: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${label}必须是正整数，实际为 ${String(value)}`);
	}
}

export class StEjsSandbox implements StEjsTemplateExecutor {
	readonly #runtime: StEjsRuntime;
	readonly #budgetMs: number;
	readonly #allowedFunctions: readonly string[];
	readonly #responseBytes: number;
	readonly #maxIdleWorkers: number;
	readonly #ejsPath: string;
	readonly #encoder = new TextEncoder();
	readonly #idle: SandboxWorkerHandle[] = [];
	readonly #live = new Set<SandboxWorkerHandle>();
	#executionCounter = 0;
	#disposed = false;

	constructor(options: StEjsSandboxOptions) {
		this.#runtime = options.runtime;
		this.#budgetMs = options.budgetMs ?? DEFAULT_SANDBOX_BUDGET_MS;
		this.#responseBytes =
			options.responseBytes ?? DEFAULT_SANDBOX_RESPONSE_BYTES;
		this.#maxIdleWorkers = options.maxIdleWorkers ?? DEFAULT_MAX_IDLE_WORKERS;
		assertPositiveInt(this.#budgetMs, "沙箱时间预算");
		assertPositiveInt(this.#responseBytes, "沙箱返回值上限");
		assertPositiveInt(this.#maxIdleWorkers, "空闲 worker 数量");
		this.#ejsPath = createRequire(import.meta.url).resolve("ejs");
		const available = options.runtime.listSandboxFunctions();
		if (options.allowedFunctions === undefined) {
			this.#allowedFunctions = available;
		} else {
			for (const name of options.allowedFunctions) {
				if (!available.includes(name)) {
					throw new StEjsVariableError(
						`沙箱函数 ${name} 不存在；可用函数：${available.join("、")}`,
					);
				}
			}
			this.#allowedFunctions = [...new Set(options.allowedFunctions)];
		}
	}

	/** 执行一段模板；超时抛 `StEjsSandboxTimeoutError`，模板错误抛 `StEjsTemplateError`。 */
	async execute(execution: StEjsTemplateExecution): Promise<string> {
		const result = await this.run(execution);
		if (result.output === null) {
			throw new StEjsSandboxTimeoutError({
				source: result.trace.source,
				durationMs: result.trace.durationMs,
				budgetMs: this.#budgetMs,
				functions: result.trace.functions,
			});
		}
		return result.output;
	}

	/**
	 * 执行一段模板并返回执行记录；只有超时走 `output: null`。
	 * `budgetMs` 覆盖构造时的预算，用于回合内按剩余时间执行。
	 */
	async run(
		execution: StEjsTemplateExecution,
		options: { readonly budgetMs?: number } = {},
	): Promise<StEjsSandboxRun> {
		if (this.#disposed) {
			throw new Error("沙箱已经释放");
		}
		const budgetMs = options.budgetMs ?? this.#budgetMs;
		assertPositiveInt(budgetMs, "沙箱时间预算");
		const handle = this.#acquire();
		this.#executionCounter += 1;
		const executionId = this.#executionCounter;
		const startedAt = performance.now();
		try {
			const result = await this.#dispatch(
				handle,
				executionId,
				execution,
				budgetMs,
			);
			return {
				output: result.output,
				trace: {
					source: execution.source,
					durationMs: Math.round(performance.now() - startedAt),
					outcome: "ok",
					reason: null,
					functions: result.functions,
				},
			};
		} catch (error) {
			if (!(error instanceof StEjsSandboxTimeoutError)) throw error;
			return {
				output: null,
				trace: {
					source: execution.source,
					durationMs: error.durationMs,
					outcome: "timeout",
					reason: error.message,
					functions: error.functions,
				},
			};
		}
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const handles = [...this.#live];
		this.#idle.length = 0;
		this.#live.clear();
		await Promise.all(
			handles.map(async (handle) => {
				handle.alive = false;
				const pending = handle.current;
				handle.current = null;
				if (pending !== null) {
					clearTimeout(pending.timer);
					pending.reject(new Error("沙箱已经释放"));
				}
				await handle.worker.terminate();
			}),
		);
	}

	#acquire(): SandboxWorkerHandle {
		while (this.#idle.length > 0) {
			const handle = this.#idle.pop() as SandboxWorkerHandle;
			if (handle.alive) return handle;
		}
		return this.#spawn();
	}

	#spawn(): SandboxWorkerHandle {
		const controlSab = new SharedArrayBuffer(2 * 4);
		const responseSab = new SharedArrayBuffer(this.#responseBytes);
		const worker = new Worker(WORKER_SOURCE, {
			eval: true,
			execArgv: [],
			workerData: {
				bootstrap: SANDBOX_BOOTSTRAP,
				controlSab,
				responseSab,
				allowedNames: this.#allowedFunctions,
				ejsPath: this.#ejsPath,
			},
		});
		const handle: SandboxWorkerHandle = {
			worker,
			control: new Int32Array(controlSab),
			response: new Uint8Array(responseSab),
			current: null,
			alive: true,
		};
		worker.on("message", (message: unknown) => {
			this.#handleMessage(handle, message);
		});
		worker.on("error", (error: Error) => {
			this.#failHandle(handle, error);
		});
		worker.on("exit", (code: number) => {
			handle.alive = false;
			if (handle.current !== null) {
				this.#failHandle(
					handle,
					new Error(`沙箱 worker 提前退出（退出码 ${code}）`),
				);
			}
			const index = this.#idle.indexOf(handle);
			if (index >= 0) this.#idle.splice(index, 1);
		});
		this.#live.add(handle);
		return handle;
	}

	#dispatch(
		handle: SandboxWorkerHandle,
		executionId: number,
		execution: StEjsTemplateExecution,
		budgetMs: number,
	): Promise<{ output: string; functions: string[] }> {
		let variablesJson: string;
		try {
			variablesJson = JSON.stringify(
				encodeSandboxValue(this.#runtime.variables.variables),
			);
		} catch (error) {
			this.#release(handle);
			return Promise.reject(error);
		}
		const { promise, resolve, reject } = Promise.withResolvers<{
			output: string;
			functions: string[];
		}>();
		const startedAt = performance.now();
		const functions: string[] = [];
		const timer = setTimeout(() => {
			if (handle.current === null) return;
			handle.current = null;
			handle.alive = false;
			this.#live.delete(handle);
			void handle.worker.terminate();
			reject(
				new StEjsSandboxTimeoutError({
					source: execution.source,
					durationMs: Math.round(performance.now() - startedAt),
					budgetMs,
					functions: [...functions],
				}),
			);
		}, budgetMs);
		handle.current = {
			executionId,
			source: execution.source,
			functions,
			resolve: (output) => {
				clearTimeout(timer);
				resolve({ output, functions: [...functions] });
			},
			reject: (error) => {
				clearTimeout(timer);
				reject(error);
			},
			timer,
		};
		Atomics.store(handle.control, RESPONSE_SEQUENCE, 0);
		Atomics.store(handle.control, RESPONSE_LENGTH, 0);
		handle.worker.postMessage({
			type: "execute",
			executionId,
			template: execution.template,
			source: execution.source,
			escape: execution.escape,
			variablesJson,
		});
		return promise;
	}

	#handleMessage(handle: SandboxWorkerHandle, message: unknown): void {
		if (typeof message !== "object" || message === null) return;
		const record = message as Record<string, unknown>;
		if (record.type === "call") {
			const call = record as unknown as SandboxCallMessage;
			const pending = handle.current;
			if (pending === null || pending.executionId !== call.executionId) return;
			if (!pending.functions.includes(call.name)) {
				pending.functions.push(call.name);
			}
			void this.#serveCall(handle, call);
			return;
		}
		if (record.type !== "done") return;
		const pending = handle.current;
		if (
			pending === null ||
			pending.executionId !== record.executionId ||
			!handle.alive
		) {
			return;
		}
		handle.current = null;
		clearTimeout(pending.timer);
		const failure = record.error;
		if (typeof failure === "object" && failure !== null) {
			const detail = failure as Record<string, unknown>;
			const text =
				typeof detail.message === "string" ? detail.message : "模板执行失败";
			pending.reject(new StEjsTemplateError(pending.source, null, text));
		} else {
			pending.resolve(typeof record.output === "string" ? record.output : "");
		}
		this.#release(handle);
	}

	async #serveCall(
		handle: SandboxWorkerHandle,
		call: SandboxCallMessage,
	): Promise<void> {
		let payload: Record<string, unknown>;
		try {
			const args = decodeSandboxValue(JSON.parse(call.argsJson));
			if (!Array.isArray(args)) {
				throw new StEjsVariableError("沙箱调用参数必须是数组");
			}
			const value = await this.#runtime.invokeSandboxFunction(call.name, args);
			payload = {
				ok: true,
				value: encodeSandboxValue(value),
				variables: encodeSandboxValue(this.#runtime.variables.variables),
			};
		} catch (error) {
			payload = {
				ok: false,
				error: {
					name: error instanceof Error ? error.name : "Error",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
		const pending = handle.current;
		if (pending === null || pending.executionId !== call.executionId) return;
		if (!handle.alive) return;
		try {
			this.#writeResponse(handle, call.id, payload);
		} catch (error) {
			this.#failHandle(
				handle,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	#writeResponse(
		handle: SandboxWorkerHandle,
		id: number,
		payload: Record<string, unknown>,
	): void {
		let bytes = this.#encoder.encode(JSON.stringify(payload));
		if (bytes.length > handle.response.length) {
			bytes = this.#encoder.encode(
				JSON.stringify({
					ok: false,
					error: {
						name: "StEjsSandboxError",
						message: `返回值 ${bytes.length} 字节，超过沙箱缓冲区 ${handle.response.length} 字节`,
					},
				}),
			);
			if (bytes.length > handle.response.length) {
				throw new Error("沙箱缓冲区太小，无法写回错误信息");
			}
		}
		handle.response.set(bytes, 0);
		Atomics.store(handle.control, RESPONSE_LENGTH, bytes.length);
		Atomics.store(handle.control, RESPONSE_SEQUENCE, id);
		Atomics.notify(handle.control, RESPONSE_SEQUENCE);
	}

	#failHandle(handle: SandboxWorkerHandle, error: Error): void {
		const pending = handle.current;
		handle.current = null;
		handle.alive = false;
		this.#live.delete(handle);
		const index = this.#idle.indexOf(handle);
		if (index >= 0) this.#idle.splice(index, 1);
		if (pending !== null) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
	}

	#release(handle: SandboxWorkerHandle): void {
		if (!handle.alive) return;
		if (this.#disposed || this.#idle.length >= this.#maxIdleWorkers) {
			handle.alive = false;
			this.#live.delete(handle);
			void handle.worker.terminate();
			return;
		}
		this.#idle.push(handle);
	}
}

export function createStEjsSandbox(options: StEjsSandboxOptions): StEjsSandbox {
	return new StEjsSandbox(options);
}

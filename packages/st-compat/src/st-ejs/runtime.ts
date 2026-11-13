import ejs from "ejs";
import lodash from "lodash";
import {
	type StEjsActivateRegexOptions,
	type StEjsActivatedRegexScript,
	type StEjsRegexApplyOptions,
	type StEjsRegexContext,
	StEjsRegexError,
	type StEjsRegexReplacementFunction,
	applyStEjsActivatedRegexes,
	createStEjsActivatedRegex,
} from "./activate-regex.js";
import { evaluateStEjsDecoratorCondition } from "./decorators.js";
import {
	type StEjsInitialVariablesParse,
	parseStEjsInitialVariables,
} from "./injection.js";
import {
	type StEjsMessageFilter,
	type StEjsMessageRole,
	StEjsVariableError,
	type StEjsVariableOptionsInput,
	type StEjsVariableScope,
	StEjsVariableStore,
	type StEjsVariableTree,
	type StEjsVariableWrite,
	type StEjsVariablesSeed,
	isStEjsMessageRole,
	normalizeStEjsVariableOptions,
} from "./variables.js";

/**
 * ST-Prompt-Template 的 EJS 运行时：一个实例对应一次生成或一次消息渲染。
 * 模板只拿到这个运行时提供的函数与变量，执行隔离（worker、时间预算）由调用方负责。
 */

export interface StEjsChatMessage {
	readonly id: number;
	readonly role: StEjsMessageRole;
	readonly content: string;
	readonly swipeId?: number;
	readonly swipes?: readonly string[];
}

export interface StEjsRuntimeOptions {
	readonly variables?: StEjsVariablesSeed;
	readonly messages?: readonly StEjsChatMessage[];
	/** 准备阶段默认不写变量，与 ST-Prompt-Template 的 `dryRun` 一致。 */
	readonly preparation?: boolean;
	/** `<%=` 的输出格式化；生成阶段不传，消息渲染由调用方传入。 */
	readonly formatEscaped?: (value: string) => string;
}

export interface StEjsRenderOptions {
	/** 出错时报告用的来源，例如世界书条目名或预设条目名。 */
	readonly source?: string;
	/** 消息渲染阶段先还原 `&lt;%` 与 `%&gt;`。 */
	readonly unescapeHtmlTags?: boolean;
}

export interface StEjsPostProcess {
	readonly search: string | RegExp;
	readonly replace: string;
}

export interface StEjsMatchChatOptions {
	readonly start?: number;
	readonly end?: number | null;
	readonly role?: StEjsMessageRole;
	readonly and?: boolean;
}

export interface StEjsPromptInjection {
	readonly key: string;
	readonly prompt: string;
	readonly order: number;
	readonly sticky: number;
	readonly uid: string;
}

/** 模板与激活正则共用的变量函数。 */
export interface StEjsVariableFunctions {
	readonly getvar: (
		key: string | null,
		options?: StEjsVariableOptionsInput,
	) => unknown;
	readonly setvar: (
		key: string | null,
		value: unknown,
		options?: StEjsVariableOptionsInput,
	) => unknown;
	readonly incvar: (
		key: string,
		value?: number,
		options?: StEjsVariableOptionsInput,
	) => unknown;
	readonly decvar: (
		key: string,
		value?: number,
		options?: StEjsVariableOptionsInput,
	) => unknown;
	readonly delvar: (
		key: string | null,
		index?: string | number,
		options?: StEjsVariableOptionsInput,
	) => unknown;
	readonly insvar: (
		key: string,
		value: unknown,
		index?: string | number,
		options?: StEjsVariableOptionsInput,
	) => unknown;
}

export class StEjsTemplateError extends Error {
	readonly source: string;
	readonly line: number | null;

	constructor(
		source: string,
		line: number | null,
		message: string,
		cause?: unknown,
	) {
		super(
			`模板 ${source} 渲染失败${line === null ? "" : `（第 ${line} 行）`}：${message}`,
			cause === undefined ? undefined : { cause },
		);
		this.name = "StEjsTemplateError";
		this.source = source;
		this.line = line;
	}
}

const MAX_EVAL_DEPTH = 16;
const UNSAFE_LOCAL_NAMES = ["__proto__", "constructor", "prototype", "print"];

function assertLocalName(name: unknown): string {
	if (typeof name !== "string" || name.length === 0) {
		throw new StEjsVariableError("define 的名称必须是非空字符串");
	}
	if (UNSAFE_LOCAL_NAMES.includes(name)) {
		throw new StEjsVariableError(`define 不能使用名称 ${name}`);
	}
	return name;
}

function stringifyOutput(value: unknown): string {
	if (value === undefined || value === null) return "";
	return String(value);
}

/**
 * 先还原消息渲染里被 HTML 转义的标签，再把 `<#escape-ejs>` 区域里的标签转义成
 * EJS 的字面量形式。顺序不能反，否则 `&lt;%` 会被当成需要保留的标签。
 */
function prepareTemplate(text: string, unescapeHtmlTags: boolean): string {
	const unescaped = unescapeHtmlTags
		? text.replace(/&lt;%/g, "<%").replace(/%&gt;/g, "%>")
		: text;
	return unescaped.replace(
		/<#escape-ejs>([\s\S]*?)<\/#escape-ejs>/gi,
		(_match, body: string) => body.replace(/<%/g, "<%%").replace(/%>/g, "%%>"),
	);
}

function readErrorLine(error: unknown): number | null {
	const line = (error as { line?: unknown }).line;
	return typeof line === "number" && Number.isFinite(line) ? line : null;
}

function resolveChatIndex(
	index: number,
	length: number,
	fallback: number,
): number {
	if (!Number.isInteger(index)) {
		throw new StEjsVariableError(`楼层下标 ${String(index)} 必须是整数`);
	}
	const position = index < 0 ? length + index : index;
	if (position < 0 || position >= length) return fallback;
	return position;
}

function readMessageContent(message: StEjsChatMessage): string {
	if (message.swipeId !== undefined && message.swipes !== undefined) {
		return message.swipes[message.swipeId] ?? message.content;
	}
	return message.content;
}

function matchPattern(pattern: string | RegExp, text: string): boolean {
	if (typeof pattern === "string") return text.includes(pattern);
	pattern.lastIndex = 0;
	const matched = pattern.test(text);
	pattern.lastIndex = 0;
	return matched;
}

export class StEjsRuntime {
	readonly variables: StEjsVariableStore;
	readonly #messages: readonly StEjsChatMessage[];
	readonly #formatEscaped: (value: string) => string;
	readonly #definitions = new Map<string, unknown>();
	readonly #injections: StEjsPromptInjection[] = [];
	readonly #regexes: StEjsActivatedRegexScript[] = [];
	#evalDepth = 0;

	constructor(options: StEjsRuntimeOptions = {}) {
		this.variables = new StEjsVariableStore(options.variables, {
			preparation: options.preparation ?? false,
		});
		this.#messages = options.messages ?? [];
		for (const message of this.#messages) {
			if (!Number.isInteger(message.id)) {
				throw new StEjsVariableError("对话楼层的 id 必须是整数");
			}
			if (!isStEjsMessageRole(message.role)) {
				throw new StEjsVariableError(`楼层 ${message.id} 的角色非法`);
			}
			if (typeof message.content !== "string") {
				throw new StEjsVariableError(`楼层 ${message.id} 的正文必须是字符串`);
			}
		}
		this.#formatEscaped = options.formatEscaped ?? stringifyOutput;
	}

	getWrites(): readonly StEjsVariableWrite[] {
		return this.variables.writes;
	}

	getInjections(): readonly StEjsPromptInjection[] {
		return this.#injections;
	}

	/** 注册一条激活正则；同一实例内按注册顺序保存。 */
	activateRegex(
		pattern: RegExp | string,
		replacement: string | StEjsRegexReplacementFunction,
		options: StEjsActivateRegexOptions = {},
	): void {
		this.#regexes.push(
			createStEjsActivatedRegex(pattern, replacement, options),
		);
	}

	getActivatedRegexes(): readonly StEjsActivatedRegexScript[] {
		return this.#regexes;
	}

	/** 按内容类型、阶段、深度与 HTML 标记执行激活正则。 */
	applyRegex(text: string, options: StEjsRegexApplyOptions): string {
		if (typeof text !== "string") {
			throw new StEjsRegexError("激活正则的输入必须是字符串");
		}
		return applyStEjsActivatedRegexes(
			this.#regexes,
			text,
			options,
			(match): StEjsRegexContext => ({
				...match,
				variables: this.variables.variables,
				...this.#variableFunctions(),
			}),
		);
	}

	/** `@@if` 的表达式：与模板共用同一批局部变量。 */
	evaluateCondition(expression: string): unknown {
		return evaluateStEjsDecoratorCondition(expression, this.#buildLocals({}));
	}

	/** 解析 `[InitialVariables]` 的内容并写进 `initial` 作用域。 */
	defineInitialVariables(text: string): StEjsInitialVariablesParse {
		const parsed = parseStEjsInitialVariables(text);
		this.variables.addInitialVariables(parsed.variables);
		return parsed;
	}

	/** 渲染一段模板。准备阶段的写入拦截由 `StEjsVariableStore` 负责。 */
	async render(
		text: string,
		options: StEjsRenderOptions = {},
	): Promise<string> {
		if (typeof text !== "string") {
			throw new StEjsTemplateError(
				options.source ?? "模板",
				null,
				"输入必须是字符串",
			);
		}
		return this.#render(text, options, {});
	}

	async #render(
		text: string,
		options: StEjsRenderOptions,
		extraLocals: Record<string, unknown>,
	): Promise<string> {
		const source = options.source ?? "模板";
		const prepared = prepareTemplate(text, options.unescapeHtmlTags ?? false);
		const locals = this.#buildLocals(extraLocals);
		const chunks: string[] = [];
		const append = (...values: unknown[]) => {
			for (const value of values) {
				if (value !== undefined && value !== null) chunks.push(String(value));
			}
		};
		locals.print = append;
		locals.__append = append;
		try {
			const rendered = await ejs.render(prepared, locals, {
				async: true,
				cache: false,
				escape: (value: unknown) => this.#formatEscaped(stringifyOutput(value)),
				localsName: "locals",
			});
			return chunks.length > 0 ? chunks.join("") : rendered;
		} catch (error) {
			throw new StEjsTemplateError(
				source,
				readErrorLine(error),
				error instanceof Error ? error.message : String(error),
				error,
			);
		}
	}

	#variableFunctions(): StEjsVariableFunctions {
		const store = this.variables;
		const getvar = (key: string | null, options?: StEjsVariableOptionsInput) =>
			store.read(key, options);
		const setvar = (
			key: string | null,
			value: unknown,
			options?: StEjsVariableOptionsInput,
		) => store.assign(key, value, options);
		const incvar = (
			key: string,
			value = 1,
			options?: StEjsVariableOptionsInput,
		) => this.#stepVariable(key, value, options, 1);
		const decvar = (
			key: string,
			value = 1,
			options?: StEjsVariableOptionsInput,
		) => this.#stepVariable(key, value, options, -1);
		const insvar = (
			key: string,
			value: unknown,
			index?: string | number,
			options?: StEjsVariableOptionsInput,
		) => store.insert(key, value, index, options);
		const delvar = (
			key: string | null,
			index?: string | number,
			options?: StEjsVariableOptionsInput,
		) => store.remove(key, index, options);
		return { getvar, setvar, incvar, decvar, delvar, insvar };
	}

	#buildLocals(extraLocals: Record<string, unknown>): Record<string, unknown> {
		const locals: Record<string, unknown> = {};
		for (const [name, value] of this.#definitions) {
			locals[name] = typeof value === "function" ? value.bind(locals) : value;
		}
		Object.assign(locals, extraLocals);
		const {
			getvar,
			setvar,
			incvar,
			decvar,
			delvar,
			insvar: insertvar,
		} = this.#variableFunctions();
		const scoped = (scope: StEjsVariableScope) => ({
			get: (key: string | null, options?: StEjsVariableOptionsInput) =>
				getvar(key, { ...normalizeStEjsVariableOptions(options), scope }),
			set: (
				key: string | null,
				value: unknown,
				options?: StEjsVariableOptionsInput,
			) =>
				setvar(key, value, {
					...normalizeStEjsVariableOptions(options),
					scope,
				}),
			inc: (key: string, value = 1, options?: StEjsVariableOptionsInput) =>
				incvar(key, value, {
					...normalizeStEjsVariableOptions(options),
					outscope: scope,
				}),
			dec: (key: string, value = 1, options?: StEjsVariableOptionsInput) =>
				decvar(key, value, {
					...normalizeStEjsVariableOptions(options),
					outscope: scope,
				}),
			del: (
				key: string | null,
				index?: string | number,
				options?: StEjsVariableOptionsInput,
			) =>
				delvar(key, index, {
					...normalizeStEjsVariableOptions(options),
					scope,
				}),
			insert: (
				key: string,
				value: unknown,
				index?: string | number,
				options?: StEjsVariableOptionsInput,
			) =>
				insertvar(key, value, index, {
					...normalizeStEjsVariableOptions(options),
					scope,
				}),
		});
		const globalScope = scoped("global");
		const localScope = scoped("local");
		const messageScope = scoped("message");
		Object.assign(locals, {
			variables: this.variables.variables,
			getvar,
			setvar,
			incvar,
			decvar,
			delvar,
			insvar: insertvar,
			getGlobalVar: globalScope.get,
			setGlobalVar: globalScope.set,
			incGlobalVar: globalScope.inc,
			decGlobalVar: globalScope.dec,
			delGlobalVar: globalScope.del,
			insertGlobalVar: globalScope.insert,
			getLocalVar: localScope.get,
			setLocalVar: localScope.set,
			incLocalVar: localScope.inc,
			decLocalVar: localScope.dec,
			delLocalVar: localScope.del,
			insertLocalVar: localScope.insert,
			getMessageVar: messageScope.get,
			setMessageVar: messageScope.set,
			incMessageVar: messageScope.inc,
			decMessageVar: messageScope.dec,
			delMessageVar: messageScope.del,
			insertMessageVar: messageScope.insert,
			define: (name: unknown, value: unknown, merge = false) => {
				const localName = assertLocalName(name);
				const existing = this.#definitions.get(localName);
				if (merge && existing !== undefined) {
					this.#definitions.set(localName, lodash.merge(existing, value));
					return;
				}
				this.#definitions.set(localName, value);
			},
			evalTemplate: (content: string, data: Record<string, unknown> = {}) =>
				this.#evalTemplate(content, data),
			getChatMessage: (index: number, role?: StEjsMessageRole) =>
				this.#getChatMessage(index, role),
			getChatMessages: (...args: unknown[]) => this.#getChatMessages(args),
			matchChatMessages: (
				pattern: string | RegExp | readonly (string | RegExp)[],
				matchOptions?: StEjsMatchChatOptions,
			) => this.#matchChatMessages(pattern, matchOptions),
			injectPrompt: (
				key: string,
				prompt: string,
				order = 100,
				sticky = 0,
				uid = "",
			) => this.#injectPrompt(key, prompt, order, sticky, uid),
			getPromptsInjected: (
				key: string,
				postprocess?: readonly StEjsPostProcess[],
			) => this.#getPromptsInjected(key, postprocess),
			hasPromptsInjected: (key: string) =>
				this.#injections.some((entry) => entry.key === key),
			activateRegex: (
				pattern: RegExp | string,
				replacement: string | StEjsRegexReplacementFunction,
				options?: StEjsActivateRegexOptions,
			) => this.activateRegex(pattern, replacement, options ?? {}),
		});
		return locals;
	}

	async #evalTemplate(
		content: string,
		data: Record<string, unknown>,
	): Promise<string> {
		if (this.#evalDepth >= MAX_EVAL_DEPTH) {
			throw new Error(`evalTemplate 嵌套超过 ${MAX_EVAL_DEPTH} 层`);
		}
		this.#evalDepth += 1;
		try {
			return await this.#render(content, { source: "evalTemplate" }, data);
		} finally {
			this.#evalDepth -= 1;
		}
	}

	/** `incvar` 与 `decvar` 共用：读旧值、按选项计算、再写回。 */
	#stepVariable(
		key: string,
		amount: number,
		input: StEjsVariableOptionsInput | undefined,
		direction: 1 | -1,
	): unknown {
		const options = normalizeStEjsVariableOptions(input);
		const current = this.variables.read(key, {
			scope: options.inscope ?? "cache",
			withMsg: options.withMsg,
			defaults: options.defaults ?? 0,
		});
		if (typeof current !== "number" || !Number.isFinite(current)) {
			throw new StEjsVariableError(`变量 ${key} 不是有限数字，无法增减`);
		}
		let next = current + direction * amount;
		if (options.min !== undefined) next = Math.max(next, options.min);
		if (options.max !== undefined) next = Math.min(next, options.max);
		return this.variables.assign(key, next, {
			...options,
			scope: options.outscope ?? "message",
		});
	}

	#getChatMessage(index: number, role?: StEjsMessageRole): string {
		if (role !== undefined && !isStEjsMessageRole(role)) {
			throw new StEjsVariableError("getChatMessage 的角色非法");
		}
		const position = resolveChatIndex(index, this.#messages.length, -1);
		if (position < 0) return "";
		const message = this.#messages[position] as StEjsChatMessage;
		if (role !== undefined && message.role !== role) return "";
		return readMessageContent(message);
	}

	#getChatMessages(args: unknown[]): string[] {
		if (args.length === 0) return [];
		const first = args[0];
		if (typeof first !== "number") {
			throw new StEjsVariableError("getChatMessages 的第一个参数必须是数字");
		}
		const second = args[1];
		if (typeof second === "number") {
			const role = args[2];
			if (role !== undefined && !isStEjsMessageRole(role)) {
				throw new StEjsVariableError("getChatMessages 的角色非法");
			}
			return this.#sliceMessages(first, second, role);
		}
		if (second !== undefined && !isStEjsMessageRole(second)) {
			throw new StEjsVariableError("getChatMessages 的角色非法");
		}
		const count = first;
		if (!Number.isInteger(count) || count < 0) {
			throw new StEjsVariableError("getChatMessages 的数量必须是非负整数");
		}
		return this.#lastMessages(count, second);
	}

	#lastMessages(count: number, role: StEjsMessageRole | undefined): string[] {
		if (count === 0) return [];
		const selected =
			role === undefined
				? this.#messages.slice(-count)
				: this.#messages
						.filter((message) => message.role === role)
						.slice(-count);
		return selected.map(readMessageContent);
	}

	#sliceMessages(
		start: number,
		end: number,
		role: StEjsMessageRole | undefined,
	): string[] {
		const length = this.#messages.length;
		const from = resolveChatIndex(start, length, length);
		const to = resolveChatIndex(end, length, -1);
		if (from >= length || to < 0 || from > to) return [];
		return this.#messages
			.slice(from, to + 1)
			.filter((message) => role === undefined || message.role === role)
			.map(readMessageContent);
	}

	#matchChatMessages(
		pattern: string | RegExp | readonly (string | RegExp)[],
		input?: StEjsMatchChatOptions,
	): boolean {
		let start = -2;
		let end: number | null = null;
		let role: StEjsMessageRole | undefined;
		let requireAll = false;
		if (input !== undefined) {
			if (typeof input !== "object" || input === null) {
				throw new StEjsVariableError("matchChatMessages 的选项必须是对象");
			}
			if ("start" in input && input.start !== undefined) {
				if (typeof input.start !== "number") {
					throw new StEjsVariableError("matchChatMessages 的 start 必须是数字");
				}
				start = input.start;
			}
			if ("end" in input && input.end !== undefined && input.end !== null) {
				if (typeof input.end !== "number") {
					throw new StEjsVariableError("matchChatMessages 的 end 必须是数字");
				}
				end = input.end;
			}
			if ("role" in input && input.role !== undefined) {
				if (!isStEjsMessageRole(input.role)) {
					throw new StEjsVariableError("matchChatMessages 的角色非法");
				}
				role = input.role;
			}
			if ("and" in input && input.and !== undefined) {
				if (typeof input.and !== "boolean") {
					throw new StEjsVariableError("matchChatMessages 的 and 必须是布尔值");
				}
				requireAll = input.and;
			}
		}
		const length = this.#messages.length;
		const from = resolveChatIndex(start, length, length);
		const to = end === null ? length - 1 : resolveChatIndex(end, length, -1);
		if (from >= length || to < 0 || from > to) return false;
		const patterns = Array.isArray(pattern) ? pattern : [pattern];
		return this.#messages.slice(from, to + 1).some((message) => {
			if (role !== undefined && message.role !== role) return false;
			const text = readMessageContent(message);
			return requireAll
				? patterns.every((entry) => matchPattern(entry, text))
				: patterns.some((entry) => matchPattern(entry, text));
		});
	}

	#injectPrompt(
		key: string,
		prompt: string,
		order: number,
		sticky: number,
		uid: string,
	): void {
		if (typeof key !== "string" || key.length === 0) {
			throw new StEjsVariableError("injectPrompt 的 key 必须是非空字符串");
		}
		if (typeof prompt !== "string") {
			throw new StEjsVariableError("injectPrompt 的 prompt 必须是字符串");
		}
		if (!Number.isFinite(order) || !Number.isFinite(sticky)) {
			throw new StEjsVariableError(
				"injectPrompt 的 order 与 sticky 必须是数字",
			);
		}
		if (typeof uid !== "string") {
			throw new StEjsVariableError("injectPrompt 的 uid 必须是字符串");
		}
		const entry: StEjsPromptInjection = { key, prompt, order, sticky, uid };
		const existing =
			uid === "" ? -1 : this.#injections.findIndex((item) => item.uid === uid);
		if (existing >= 0) {
			this.#injections[existing] = entry;
			return;
		}
		this.#injections.push(entry);
	}

	#getPromptsInjected(key: string, input?: unknown): string {
		if (input !== undefined && !Array.isArray(input)) {
			throw new StEjsVariableError("getPromptsInjected 的后处理必须是数组");
		}
		const selected = this.#injections
			.map((entry, index) => ({ entry, index }))
			.filter((item) => item.entry.key === key)
			.sort(
				(left, right) =>
					left.entry.order - right.entry.order || left.index - right.index,
			)
			.map((item) => item.entry.prompt);
		let text = selected.join("\n");
		for (const step of input ?? []) {
			if (typeof step !== "object" || step === null) {
				throw new StEjsVariableError("后处理条目必须是对象");
			}
			if (!("replace" in step) || typeof step.replace !== "string") {
				throw new StEjsVariableError("后处理条目需要字符串 replace");
			}
			if (!("search" in step)) {
				throw new StEjsVariableError("后处理条目需要 search");
			}
			const search = step.search;
			if (typeof search === "string") {
				text = text.split(search).join(step.replace);
			} else if (search instanceof RegExp) {
				text = text.replace(search, step.replace);
			} else {
				throw new StEjsVariableError("后处理条目的 search 必须是字符串或正则");
			}
		}
		return text;
	}
}

export function createStEjsRuntime(
	options: StEjsRuntimeOptions = {},
): StEjsRuntime {
	return new StEjsRuntime(options);
}

export type { StEjsMessageFilter, StEjsVariableTree };

import lodash from "lodash";

/**
 * EJS 模板的变量存储，语义以 ST-Prompt-Template 的 reference 文档为准。
 * 变量按消息（旧到新）、局部、全局、初始值四层合并；写入默认落在消息变量上，
 * 合并视图与目标作用域同时更新，模板里写后立刻能读到新值。
 */

export const ST_EJS_VARIABLE_SCOPES = [
	"global",
	"local",
	"message",
	"cache",
	"initial",
] as const;

export type StEjsVariableScope = (typeof ST_EJS_VARIABLE_SCOPES)[number];

export const ST_EJS_SET_FLAGS = ["nx", "xx", "n", "nxs", "xxs"] as const;
export type StEjsSetFlag = (typeof ST_EJS_SET_FLAGS)[number];

export const ST_EJS_RESULT_KINDS = ["old", "new", "fullcache"] as const;
export type StEjsResultKind = (typeof ST_EJS_RESULT_KINDS)[number];

export type StEjsVariableTree = Record<string, unknown>;

export type StEjsMessageRole = "system" | "user" | "assistant";

export interface StEjsMessageVariables {
	readonly id: number;
	readonly swipeId?: number;
	readonly role?: StEjsMessageRole;
	readonly variables: StEjsVariableTree;
}

export interface StEjsMessageFilter {
	readonly role?: StEjsMessageRole | "any";
	readonly id?: number;
	readonly swipe_id?: number;
}

export interface StEjsVariablesSeed {
	readonly global?: StEjsVariableTree;
	readonly local?: StEjsVariableTree;
	readonly initial?: StEjsVariableTree;
	/** 旧到新排序；靠后的消息覆盖靠前的。 */
	readonly messages?: readonly StEjsMessageVariables[];
}

export interface StEjsVariableOptions {
	readonly scope?: StEjsVariableScope;
	readonly withMsg?: StEjsMessageFilter;
	readonly defaults?: unknown;
	readonly clone?: boolean;
	readonly flags?: StEjsSetFlag;
	readonly results?: StEjsResultKind;
	readonly merge?: boolean;
	readonly dryRun?: boolean;
	readonly min?: number;
	readonly max?: number;
	readonly inscope?: StEjsVariableScope;
	readonly outscope?: StEjsVariableScope;
}

/** 简写选项：`'nx'`、`'global'`、`'old'` 或 `true`（等同于 `dryRun`）。 */
export type StEjsVariableOptionsInput =
	| StEjsVariableOptions
	| StEjsSetFlag
	| StEjsVariableScope
	| StEjsResultKind
	| boolean;

export type StEjsVariableWriteOperation = "set" | "merge" | "delete" | "insert";

export interface StEjsVariableWrite {
	readonly scope: Exclude<StEjsVariableScope, "cache">;
	readonly messageId: number | null;
	readonly swipeId: number | null;
	readonly key: string | null;
	readonly operation: StEjsVariableWriteOperation;
	readonly value?: unknown;
	readonly index?: string | number;
}

export class StEjsVariableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StEjsVariableError";
	}
}

const UNSAFE_PATH_SEGMENTS = ["__proto__", "constructor", "prototype"];

interface MessageScope {
	id: number | null;
	swipeId: number | null;
	role?: StEjsMessageRole;
	variables: StEjsVariableTree;
}

interface WriteTarget {
	readonly tree: StEjsVariableTree;
	readonly messageId: number | null;
	readonly swipeId: number | null;
}

function isPlainObject(value: unknown): value is StEjsVariableTree {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertTree(value: unknown, label: string): StEjsVariableTree {
	if (!isPlainObject(value)) {
		throw new StEjsVariableError(`${label} 必须是对象`);
	}
	return value;
}

function assertSafePath(key: string, label: string): void {
	const segments = key
		.split(/\.|\[|\]/)
		.map((segment) => segment.replace(/^['"]|['"]$/g, ""))
		.filter((segment) => segment.length > 0);
	for (const segment of segments) {
		if (UNSAFE_PATH_SEGMENTS.includes(segment)) {
			throw new StEjsVariableError(`${label} 不能使用路径 ${key}`);
		}
	}
}

function cloneValue<T>(value: T): T {
	return lodash.cloneDeep(value);
}

function replaceContents(
	target: StEjsVariableTree,
	value: StEjsVariableTree,
): void {
	for (const key of Object.keys(target)) {
		delete target[key];
	}
	Object.assign(target, cloneValue(value));
}

function isContainer(value: unknown): value is unknown[] | StEjsVariableTree {
	return typeof value === "object" && value !== null;
}

function mergeInto(
	target: StEjsVariableTree,
	source: StEjsVariableTree | undefined,
): void {
	if (source === undefined) return;
	lodash.merge(target, cloneValue(source));
}

/** 合并写入：两边都是对象或数组时深合，否则直接替换。 */
function mergeValue(current: unknown, value: unknown): unknown {
	if (isContainer(current) && isContainer(value)) {
		return lodash.merge(cloneValue(current), cloneValue(value));
	}
	return cloneValue(value);
}

function assignToTree(
	tree: StEjsVariableTree,
	key: string | null,
	value: unknown,
	merge: boolean,
): unknown {
	if (key === null) {
		const source = assertTree(value, "整棵树写入");
		if (merge) {
			lodash.merge(tree, cloneValue(source));
		} else {
			replaceContents(tree, source);
		}
		return tree;
	}
	assertSafePath(key, "变量路径");
	const next = merge
		? mergeValue(lodash.get(tree, key), value)
		: cloneValue(value);
	lodash.set(tree, key, next);
	return next;
}

function readTreeValue(
	tree: StEjsVariableTree,
	key: string | null,
	clone: boolean,
): unknown {
	if (key === null) {
		return clone ? cloneValue(tree) : tree;
	}
	assertSafePath(key, "变量路径");
	const value = lodash.get(tree, key);
	return clone ? cloneValue(value) : value;
}

function hasTreePath(tree: StEjsVariableTree, key: string | null): boolean {
	if (key === null) return true;
	assertSafePath(key, "变量路径");
	return lodash.has(tree, key);
}

function isScope(value: string): value is StEjsVariableScope {
	return (ST_EJS_VARIABLE_SCOPES as readonly string[]).includes(value);
}

export function isStEjsMessageRole(value: unknown): value is StEjsMessageRole {
	return value === "system" || value === "user" || value === "assistant";
}

function isSetFlag(value: string): value is StEjsSetFlag {
	return (ST_EJS_SET_FLAGS as readonly string[]).includes(value);
}

function isResultKind(value: string): value is StEjsResultKind {
	return (ST_EJS_RESULT_KINDS as readonly string[]).includes(value);
}

/** 把简写选项与对象选项统一成对象；非法值直接抛错并指出字段。 */
export function normalizeStEjsVariableOptions(
	input?: StEjsVariableOptionsInput,
): StEjsVariableOptions {
	if (input === undefined) return {};
	if (typeof input === "boolean") return { dryRun: input };
	if (typeof input === "string") {
		if (isScope(input)) return { scope: input };
		if (isSetFlag(input)) return { flags: input };
		if (isResultKind(input)) return { results: input };
		throw new StEjsVariableError(`未知的变量选项 ${input}`);
	}
	const options: StEjsVariableOptions = { ...input };
	if (options.scope !== undefined && !isScope(options.scope)) {
		throw new StEjsVariableError(`未知的变量作用域 ${options.scope}`);
	}
	if (options.inscope !== undefined && !isScope(options.inscope)) {
		throw new StEjsVariableError(`未知的读取作用域 ${options.inscope}`);
	}
	if (options.outscope !== undefined && !isScope(options.outscope)) {
		throw new StEjsVariableError(`未知的写入作用域 ${options.outscope}`);
	}
	if (options.flags !== undefined && !isSetFlag(options.flags)) {
		throw new StEjsVariableError(`未知的写入条件 ${options.flags}`);
	}
	if (options.results !== undefined && !isResultKind(options.results)) {
		throw new StEjsVariableError(`未知的返回类型 ${options.results}`);
	}
	if (options.min !== undefined && !Number.isFinite(options.min)) {
		throw new StEjsVariableError("min 必须是有限数字");
	}
	if (options.max !== undefined && !Number.isFinite(options.max)) {
		throw new StEjsVariableError("max 必须是有限数字");
	}
	if (options.withMsg !== undefined) {
		const filter = options.withMsg;
		if (typeof filter !== "object" || filter === null) {
			throw new StEjsVariableError("withMsg 必须是对象");
		}
		if (filter.id !== undefined && !Number.isInteger(filter.id)) {
			throw new StEjsVariableError("withMsg.id 必须是整数");
		}
		if (filter.swipe_id !== undefined && !Number.isInteger(filter.swipe_id)) {
			throw new StEjsVariableError("withMsg.swipe_id 必须是整数");
		}
		if (
			filter.role !== undefined &&
			filter.role !== "any" &&
			!isStEjsMessageRole(filter.role)
		) {
			throw new StEjsVariableError(`withMsg.role 非法：${filter.role}`);
		}
	}
	return options;
}

/**
 * `initial` 作用域的外部后端。接入台账时由它提供 MVU 变量的底层数据，
 * 并把写回交给结算器。`key` 是 lodash 的点路径；`value` 是该键写入后的最终值，
 * `undefined` 表示删除该键。
 */
export interface StEjsVariableBackend {
	read(): StEjsVariableTree;
	write(key: string | null, value: unknown): void;
}

export interface StEjsVariableStoreOptions {
	/** 准备阶段（世界书、预设、角色卡的多次计算）默认不写变量。 */
	readonly preparation?: boolean;
	/** 提供时 `initial` 层改为从后端读取、写入后端；不指定作用域的写也落在 `initial`。 */
	readonly backend?: StEjsVariableBackend | null;
}

export class StEjsVariableStore {
	readonly #global: StEjsVariableTree;
	readonly #local: StEjsVariableTree;
	readonly #initial: StEjsVariableTree;
	readonly #messages: MessageScope[];
	readonly #cache: StEjsVariableTree;
	readonly #writes: StEjsVariableWrite[] = [];
	readonly #backend: StEjsVariableBackend | null;
	#preparation: boolean;

	constructor(
		seed: StEjsVariablesSeed = {},
		options: StEjsVariableStoreOptions = {},
	) {
		this.#initial = cloneValue(assertTree(seed.initial ?? {}, "初始变量"));
		this.#global = cloneValue(assertTree(seed.global ?? {}, "全局变量"));
		this.#local = cloneValue(assertTree(seed.local ?? {}, "局部变量"));
		this.#messages = (seed.messages ?? []).map((message) => {
			if (!Number.isInteger(message.id)) {
				throw new StEjsVariableError("消息变量的 id 必须是整数");
			}
			const scope: MessageScope = {
				id: message.id,
				swipeId: message.swipeId ?? null,
				role: message.role,
				variables: cloneValue(
					assertTree(message.variables, `消息 ${message.id} 的变量`),
				),
			};
			return scope;
		});
		this.#preparation = options.preparation ?? false;
		this.#backend = options.backend ?? null;
		this.#cache = {};
		mergeInto(this.#cache, this.#baseInitial());
		mergeInto(this.#cache, this.#global);
		mergeInto(this.#cache, this.#local);
		for (const message of this.#messages) {
			mergeInto(this.#cache, message.variables);
		}
	}

	/** 模板里看到的 `variables`：合并视图本身，写入会直接反映在这里。 */
	get variables(): StEjsVariableTree {
		return this.#cache;
	}

	get writes(): readonly StEjsVariableWrite[] {
		return this.#writes;
	}

	get preparation(): boolean {
		return this.#preparation;
	}

	setPreparation(value: boolean): void {
		this.#preparation = value;
	}

	/** 准备阶段解析出来的初始变量并进 `initial` 作用域，随后重建合并视图。 */
	addInitialVariables(tree: StEjsVariableTree): void {
		const input = assertTree(tree, "初始变量");
		if (this.#backend !== null) {
			const base = this.#backend.read();
			for (const [key, value] of Object.entries(input)) {
				this.#backend.write(key, mergeValue(base[key], value));
			}
			this.#rebuildCache();
			return;
		}
		mergeInto(this.#initial, input);
		this.#rebuildCache();
	}

	/** `initial` 的当前内容：接入后端时以后端为准。 */
	#baseInitial(): StEjsVariableTree {
		return this.#backend === null ? this.#initial : this.#backend.read();
	}

	#rebuildCache(): void {
		replaceContents(this.#cache, {});
		mergeInto(this.#cache, this.#baseInitial());
		mergeInto(this.#cache, this.#global);
		mergeInto(this.#cache, this.#local);
		for (const message of this.#messages) {
			mergeInto(this.#cache, message.variables);
		}
	}

	/** 按作用域读取；`scope` 缺省为合并视图。 */
	read(key: string | null, input?: StEjsVariableOptionsInput): unknown {
		const options = normalizeStEjsVariableOptions(input);
		const scope = options.scope ?? "cache";
		const value = readTreeValue(
			this.#scopeTree(scope, options.withMsg),
			key,
			options.clone ?? false,
		);
		return value === undefined ? options.defaults : value;
	}

	/** 写入变量，返回值的含义由 `results` 决定；条件不满足或准备阶段被拦截时返回 `undefined`。 */
	assign(
		key: string | null,
		value: unknown,
		input?: StEjsVariableOptionsInput,
	): unknown {
		const options = normalizeStEjsVariableOptions(input);
		if (this.#preparation && options.dryRun !== true) return undefined;
		const scope = options.scope ?? this.#defaultWriteScope();
		if (this.#backend !== null && scope === "initial") {
			const tree = cloneValue(this.#backend.read());
			if (!this.#passesFlags(tree, key, options)) return undefined;
			const previous = readTreeValue(tree, key, true);
			const merge = options.merge === true;
			const next = assignToTree(tree, key, value, merge);
			this.#backend.write(key, key === null ? tree : next);
			this.#rebuildCache();
			this.#record(
				"initial",
				{ tree, messageId: null, swipeId: null },
				key,
				merge ? "merge" : "set",
				next,
			);
			return this.#result(options.results ?? "new", previous, next);
		}
		const target = this.#writeTarget(scope, options.withMsg);
		if (!this.#passesFlags(target.tree, key, options)) return undefined;
		const previous = readTreeValue(target.tree, key, true);
		const merge = options.merge === true;
		const next = assignToTree(target.tree, key, value, merge);
		this.#mirror(scope, key, next, merge);
		this.#record(scope, target, key, merge ? "merge" : "set", next);
		return this.#result(options.results ?? "new", previous, next);
	}

	insert(
		key: string,
		value: unknown,
		index?: string | number,
		input?: StEjsVariableOptionsInput,
	): unknown {
		const options = normalizeStEjsVariableOptions(input);
		if (this.#preparation && options.dryRun !== true) return undefined;
		const scope = options.scope ?? this.#defaultWriteScope();
		if (this.#backend !== null && scope === "initial") {
			const tree = cloneValue(this.#backend.read());
			if (!this.#passesFlags(tree, key, options)) return undefined;
			const previous = readTreeValue(tree, key, true);
			const next = insertIntoValue(previous, value, index, key);
			if (next === undefined) return undefined;
			this.#backend.write(key, next);
			this.#rebuildCache();
			this.#record(
				"initial",
				{ tree, messageId: null, swipeId: null },
				key,
				"insert",
				next,
				index,
			);
			return this.#result(options.results ?? "new", previous, next);
		}
		const target = this.#writeTarget(scope, options.withMsg);
		if (!this.#passesFlags(target.tree, key, options)) return undefined;
		const previous = readTreeValue(target.tree, key, true);
		const next = insertIntoValue(previous, value, index, key);
		if (next === undefined) return undefined;
		lodash.set(target.tree, key, cloneValue(next));
		this.#mirror(scope, key, next);
		this.#record(scope, target, key, "insert", next, index);
		return this.#result(options.results ?? "new", previous, next);
	}

	remove(
		key: string | null,
		index?: string | number,
		input?: StEjsVariableOptionsInput,
	): unknown {
		const options = normalizeStEjsVariableOptions(input);
		if (this.#preparation && options.dryRun !== true) return undefined;
		const scope = options.scope ?? this.#defaultWriteScope();
		if (this.#backend !== null && scope === "initial") {
			const tree = cloneValue(this.#backend.read());
			if (!this.#passesFlags(tree, key, options)) return undefined;
			const previous = readTreeValue(tree, key, true);
			if (key === null) {
				replaceContents(tree, {});
				this.#backend.write(null, tree);
				this.#rebuildCache();
				this.#record(
					"initial",
					{ tree, messageId: null, swipeId: null },
					null,
					"delete",
				);
				return this.#result(options.results ?? "new", previous, tree);
			}
			if (index === undefined) {
				lodash.unset(tree, key);
				this.#backend.write(key, undefined);
				this.#rebuildCache();
				this.#record(
					"initial",
					{ tree, messageId: null, swipeId: null },
					key,
					"delete",
				);
				return this.#result(options.results ?? "new", previous, undefined);
			}
			const next = removeFromValue(previous, index, key);
			if (next === undefined) return undefined;
			this.#backend.write(key, next);
			this.#rebuildCache();
			this.#record(
				"initial",
				{ tree, messageId: null, swipeId: null },
				key,
				"delete",
				undefined,
				index,
			);
			return this.#result(options.results ?? "new", previous, next);
		}
		const target = this.#writeTarget(scope, options.withMsg);
		if (!this.#passesFlags(target.tree, key, options)) return undefined;
		const previous = readTreeValue(target.tree, key, true);
		if (key === null) {
			replaceContents(target.tree, {});
			this.#mirror(scope, null, target.tree);
			this.#record(scope, target, null, "delete", undefined);
			return this.#result(options.results ?? "new", previous, target.tree);
		}
		if (index === undefined) {
			lodash.unset(target.tree, key);
			if (scope !== "cache") lodash.unset(this.#cache, key);
			this.#record(scope, target, key, "delete", undefined);
			return this.#result(options.results ?? "new", previous, undefined);
		}
		const next = removeFromValue(previous, index, key);
		if (next === undefined) return undefined;
		lodash.set(target.tree, key, cloneValue(next));
		this.#mirror(scope, key, next);
		this.#record(scope, target, key, "delete", undefined, index);
		return this.#result(options.results ?? "new", previous, next);
	}

	/** 不指定作用域的写入落在 `initial`（接入台账时就是 MVU 变量）；没有后端时与上游一致落消息变量。 */
	#defaultWriteScope(): StEjsVariableScope {
		return this.#backend === null ? "message" : "initial";
	}

	/** 写前检查 `nx`/`xx`/`nxs`/`xxs`：前两个看合并视图，后两个看目标作用域。 */
	#passesFlags(
		targetTree: StEjsVariableTree,
		key: string | null,
		options: StEjsVariableOptions,
	): boolean {
		const flag = options.flags ?? "n";
		if (flag === "n") return true;
		const fromCache = flag === "nx" || flag === "xx";
		const exists = hasTreePath(fromCache ? this.#cache : targetTree, key);
		return flag === "nx" || flag === "nxs" ? !exists : exists;
	}

	#scopeTree(
		scope: StEjsVariableScope,
		filter?: StEjsMessageFilter,
	): StEjsVariableTree {
		if (scope === "cache") return this.#cache;
		if (scope === "global") return this.#global;
		if (scope === "local") return this.#local;
		if (scope === "initial") return this.#baseInitial();
		return this.#resolveMessage(filter)?.variables ?? {};
	}

	#writeTarget(
		scope: StEjsVariableScope,
		filter?: StEjsMessageFilter,
	): WriteTarget {
		if (scope === "message") {
			const message = this.#resolveMessage(filter, true);
			if (message === undefined) {
				throw new StEjsVariableError("没有可写入的消息变量");
			}
			return {
				tree: message.variables,
				messageId: message.id,
				swipeId: message.swipeId,
			};
		}
		return {
			tree: this.#scopeTree(scope),
			messageId: null,
			swipeId: null,
		};
	}

	/**
	 * 选中消息变量：`id` 优先且可以用负数从末尾数；否则取最后一条匹配角色的消息。
	 * 没有消息变量时按需建一条匿名的当前消息，写入记录里消息 id 为 null。
	 */
	#resolveMessage(
		filter?: StEjsMessageFilter,
		create = false,
	): MessageScope | undefined {
		const messages = this.#messages;
		if (filter?.id !== undefined) {
			const index =
				filter.id < 0
					? messages.length + filter.id
					: messages.findIndex((message) => message.id === filter.id);
			const picked = messages[index];
			if (picked === undefined) {
				return create ? this.#createMessage() : undefined;
			}
			if (filter.swipe_id === undefined || picked.swipeId === filter.swipe_id) {
				return picked;
			}
			for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
				const message = messages[cursor] as MessageScope;
				if (message.id === picked.id && message.swipeId === filter.swipe_id) {
					return message;
				}
			}
			return create ? this.#createMessage() : undefined;
		}
		if (filter?.role !== undefined && filter.role !== "any") {
			for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
				const message = messages[cursor] as MessageScope;
				if (
					message.role === filter.role &&
					(filter.swipe_id === undefined || message.swipeId === filter.swipe_id)
				) {
					return message;
				}
			}
			return create ? this.#createMessage() : undefined;
		}
		const last = messages[messages.length - 1];
		if (last === undefined) {
			return create ? this.#createMessage() : undefined;
		}
		if (filter?.swipe_id === undefined || last.swipeId === filter.swipe_id) {
			return last;
		}
		for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
			const message = messages[cursor] as MessageScope;
			if (message.id === last.id && message.swipeId === filter.swipe_id) {
				return message;
			}
		}
		return create ? this.#createMessage() : undefined;
	}

	#createMessage(): MessageScope {
		const message: MessageScope = {
			id: null,
			swipeId: null,
			variables: {},
		};
		this.#messages.push(message);
		return message;
	}

	/** 目标作用域写完后同步合并视图；`cache` 作用域只写视图本身。 */
	#mirror(
		scope: StEjsVariableScope,
		key: string | null,
		value: unknown,
		merge = false,
	): void {
		if (scope === "cache") return;
		assignToTree(this.#cache, key, value, merge);
	}

	#record(
		scope: StEjsVariableScope,
		target: WriteTarget,
		key: string | null,
		operation: StEjsVariableWriteOperation,
		value?: unknown,
		index?: string | number,
	): void {
		if (scope === "cache") return;
		const write: StEjsVariableWrite = {
			scope,
			messageId: target.messageId,
			swipeId: target.swipeId,
			key,
			operation,
			...(value === undefined ? {} : { value: cloneValue(value) }),
			...(index === undefined ? {} : { index }),
		};
		this.#writes.push(write);
	}

	#result(kind: StEjsResultKind, previous: unknown, next: unknown): unknown {
		if (kind === "old") return previous;
		if (kind === "new") return next;
		return this.#cache;
	}
}

function insertIntoValue(
	current: unknown,
	value: unknown,
	index: string | number | undefined,
	key: string,
): unknown {
	if (Array.isArray(current)) {
		const next = [...current];
		if (index === undefined) {
			next.push(cloneValue(value));
			return next;
		}
		const position = normalizeIndex(index, next.length, true);
		next.splice(position, 0, cloneValue(value));
		return next;
	}
	if (typeof current === "string") {
		const position =
			index === undefined
				? current.length
				: normalizeIndex(index, current.length, true);
		return `${current.slice(0, position)}${String(value)}${current.slice(position)}`;
	}
	if (isPlainObject(current)) {
		if (index === undefined) {
			throw new StEjsVariableError(`对象变量 ${key} 插入时需要下标`);
		}
		const next = cloneValue(current);
		next[String(index)] = cloneValue(value);
		return next;
	}
	return undefined;
}

function removeFromValue(
	current: unknown,
	index: string | number,
	_key: string,
): unknown {
	if (Array.isArray(current)) {
		const position = normalizeIndex(index, current.length, false);
		if (position < 0 || position >= current.length) return current;
		const next = [...current];
		next.splice(position, 1);
		return next;
	}
	if (typeof current === "string") {
		const position = normalizeIndex(index, current.length, false);
		if (position < 0 || position >= current.length) return current;
		return `${current.slice(0, position)}${current.slice(position + 1)}`;
	}
	if (isPlainObject(current)) {
		const next = cloneValue(current);
		delete next[String(index)];
		return next;
	}
	return undefined;
}

function normalizeIndex(
	index: string | number,
	length: number,
	allowEnd: boolean,
): number {
	const parsed = typeof index === "number" ? index : Number.parseInt(index, 10);
	if (!Number.isInteger(parsed)) {
		throw new StEjsVariableError(`下标 ${String(index)} 必须是整数`);
	}
	const position = parsed < 0 ? length + parsed : parsed;
	const limit = allowEnd ? length : length - 1;
	return Math.min(Math.max(position, 0), limit);
}

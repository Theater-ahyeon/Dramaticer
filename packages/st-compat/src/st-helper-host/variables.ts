import lodash from "lodash";
import {
	StEjsVariableError,
	type StEjsVariableOptions,
	type StEjsVariableStore,
	type StEjsVariableTree,
} from "../st-ejs/variables.js";

/** 酒馆助手变量作用域；与 EJS 的存储共用同一份数据。 */
export const ST_HELPER_VARIABLE_TYPES = [
	"message",
	"chat",
	"character",
	"global",
	"preset",
	"script",
] as const;

export type StHelperVariableType = (typeof ST_HELPER_VARIABLE_TYPES)[number];

export interface StHelperVariableOptions {
	/** 缺省为 `message`，与酒馆助手一致。 */
	readonly type?: StHelperVariableType;
	/** 只对 `message` 生效；缺省读最后一条。 */
	readonly message_id?: number | "latest";
}

export type StHelperVariables = Record<string, unknown>;

const UNSAFE_PATH_SEGMENTS = ["__proto__", "constructor", "prototype"];

/**
 * 宿主变量 API 的实现。`message`、`chat`、`character`、`global` 四个作用域
 * 落到 EJS 的同一个 `StEjsVariableStore`：`character` 是台账 `mvu`，
 * `chat` 是局部变量，`message` 是楼层消息变量。`preset` 与 `script`
 * 是插件自己的会话内变量，不入台账。
 */
export class StHelperVariableBank {
	readonly #store: StEjsVariableStore;
	readonly #preset: StEjsVariableTree = {};
	readonly #script: StEjsVariableTree = {};

	constructor(store: StEjsVariableStore) {
		this.#store = store;
	}

	getVariables(options?: StHelperVariableOptions): StHelperVariables {
		const type = resolveType(options);
		if (type === "preset" || type === "script") {
			return cloneTree(this.#localTree(type));
		}
		const tree = this.#store.read(null, this.#storeOptions(type, options));
		return isPlainObject(tree) ? cloneTree(tree) : {};
	}

	replaceVariables(
		variables: StHelperVariables,
		options?: StHelperVariableOptions,
	): void {
		assertTree(variables, "变量");
		const type = resolveType(options);
		if (type === "preset" || type === "script") {
			const target = this.#localTree(type);
			replaceContents(target, cloneTree(variables));
			return;
		}
		this.#store.assign(
			null,
			cloneTree(variables),
			this.#storeOptions(type, options),
		);
	}

	insertOrAssignVariables(
		variables: StHelperVariables,
		options?: StHelperVariableOptions,
	): void {
		assertTree(variables, "变量");
		const type = resolveType(options);
		if (type === "preset" || type === "script") {
			lodash.merge(this.#localTree(type), cloneTree(variables));
			return;
		}
		this.#store.assign(null, cloneTree(variables), {
			...this.#storeOptions(type, options),
			merge: true,
		});
	}

	updateVariablesWith(
		updater: (variables: StHelperVariables) => StHelperVariables,
		options?: StHelperVariableOptions,
	): StHelperVariables {
		if (typeof updater !== "function") {
			throw new StEjsVariableError("updateVariablesWith 的更新函数必须是函数");
		}
		const current = this.getVariables(options);
		const next = updater(current);
		assertTree(next, "updateVariablesWith 的返回值");
		this.replaceVariables(next, options);
		return cloneTree(next);
	}

	getVariable(path: string, options?: StHelperVariableOptions): unknown {
		assertPath(path);
		const type = resolveType(options);
		if (type === "preset" || type === "script") {
			return lodash.cloneDeep(lodash.get(this.#localTree(type), path));
		}
		return this.#store.read(path, {
			...this.#storeOptions(type, options),
			clone: true,
		});
	}

	insertOrAssignVariable(
		path: string,
		value: unknown,
		options?: StHelperVariableOptions,
	): void {
		assertPath(path);
		assertSafeTree(value, `变量 ${path}`);
		const type = resolveType(options);
		if (type === "preset" || type === "script") {
			lodash.set(this.#localTree(type), path, lodash.cloneDeep(value));
			return;
		}
		this.#store.assign(
			path,
			lodash.cloneDeep(value),
			this.#storeOptions(type, options),
		);
	}

	deleteVariable(path: string, options?: StHelperVariableOptions): void {
		assertPath(path);
		const type = resolveType(options);
		if (type === "preset" || type === "script") {
			lodash.unset(this.#localTree(type), path);
			return;
		}
		this.#store.remove(path, undefined, this.#storeOptions(type, options));
	}

	#localTree(type: "preset" | "script"): StEjsVariableTree {
		return type === "preset" ? this.#preset : this.#script;
	}

	#storeOptions(
		type: Exclude<StHelperVariableType, "preset" | "script">,
		options?: StHelperVariableOptions,
	): StEjsVariableOptions {
		if (type === "message") {
			return {
				scope: "message",
				withMsg: { id: resolveMessageId(options) },
			};
		}
		if (type === "chat") return { scope: "local" };
		if (type === "character") return { scope: "initial" };
		return { scope: "global" };
	}
}

function resolveType(options?: StHelperVariableOptions): StHelperVariableType {
	const type = options?.type ?? "message";
	if (!(ST_HELPER_VARIABLE_TYPES as readonly string[]).includes(type)) {
		throw new StEjsVariableError(`变量作用域 type 非法：${String(type)}`);
	}
	return type;
}

function resolveMessageId(options?: StHelperVariableOptions): number {
	const messageId = options?.message_id ?? "latest";
	if (messageId === "latest") return -1;
	if (!Number.isInteger(messageId)) {
		throw new StEjsVariableError("变量 message_id 必须是整数或 latest");
	}
	return messageId;
}

function assertTree(
	value: unknown,
	label: string,
): asserts value is StHelperVariables {
	if (!isPlainObject(value)) {
		throw new StEjsVariableError(`${label}必须是对象`);
	}
	assertSafeTree(value, label);
}

function assertPath(path: unknown): asserts path is string {
	if (typeof path !== "string" || path.length === 0) {
		throw new StEjsVariableError("变量路径必须是非空字符串");
	}
	for (const segment of lodash.toPath(path).map(String)) {
		if (UNSAFE_PATH_SEGMENTS.includes(segment)) {
			throw new StEjsVariableError(`变量路径不能使用 ${segment}`);
		}
	}
}

/** 整棵树写入前递归检查危险键；与 EJS 变量存储的路径保护一致。 */
function assertSafeTree(value: unknown, label: string): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertSafeTree(item, `${label}[${index}]`);
		}
		return;
	}
	if (!isPlainObject(value)) return;
	for (const [key, item] of Object.entries(value)) {
		if (UNSAFE_PATH_SEGMENTS.includes(key)) {
			throw new StEjsVariableError(`${label} 不能使用键 ${key}`);
		}
		assertSafeTree(item, `${label}.${key}`);
	}
}

function isPlainObject(value: unknown): value is StHelperVariables {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneTree(tree: StHelperVariables): StHelperVariables {
	return lodash.cloneDeep(tree);
}

function replaceContents(
	target: StEjsVariableTree,
	value: StEjsVariableTree,
): void {
	for (const key of Object.keys(target)) {
		delete target[key];
	}
	Object.assign(target, cloneTree(value));
}

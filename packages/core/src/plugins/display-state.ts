import {
	type JsonObject,
	type JsonValue,
	assertJsonValue,
	isJsonObject,
} from "../json.js";

/** 显示状态的类别：渲染结果与不入台账的元数据分开存放。 */
export type PluginDisplayStateKind = "display" | "metadata";

export const PLUGIN_DISPLAY_STATE_KINDS: readonly PluginDisplayStateKind[] = [
	"display",
	"metadata",
];

export interface PluginDisplayStateSnapshot {
	readonly display: Readonly<JsonObject>;
	readonly metadata: Readonly<JsonObject>;
}

export interface SetPluginDisplayStateInput {
	readonly nodeId: string;
	readonly plugin: string;
	readonly kind: PluginDisplayStateKind;
	readonly values: Readonly<JsonObject>;
}

interface PluginStateBucket {
	display: JsonObject;
	metadata: JsonObject;
}

/**
 * 插件自己的显示状态：按楼层与应用插件分开存放，只活在当前会话。
 *
 * 显示状态不进入楼层原文（I4）、不进入台账（I12）、不新建楼层节点；它只影响界面
 * 渲染与插件自己的元数据。状态可以由台账快照重新算出，因此不做持久化。
 */
export class PluginDisplayState {
	readonly #nodes = new Map<string, Map<string, PluginStateBucket>>();

	set(input: SetPluginDisplayStateInput): void {
		const nodeId = requireNonEmpty(input.nodeId, "显示状态的楼层 id");
		const plugin = requireNonEmpty(input.plugin, "显示状态的插件名");
		assertKind(input.kind);
		const values = assertStateValues(input.values, input.kind);
		let plugins = this.#nodes.get(nodeId);
		if (plugins === undefined) {
			plugins = new Map();
			this.#nodes.set(nodeId, plugins);
		}
		let bucket = plugins.get(plugin);
		if (bucket === undefined) {
			bucket = { display: {}, metadata: {} };
			plugins.set(plugin, bucket);
		}
		for (const [key, value] of Object.entries(values)) {
			setOwn(bucket[input.kind], key, value);
		}
	}

	get(nodeId: string, plugin: string): PluginDisplayStateSnapshot | null {
		requireNonEmpty(nodeId, "显示状态的楼层 id");
		requireNonEmpty(plugin, "显示状态的插件名");
		const bucket = this.#nodes.get(nodeId)?.get(plugin);
		if (bucket === undefined) return null;
		return {
			display: structuredClone(bucket.display),
			metadata: structuredClone(bucket.metadata),
		};
	}

	getValue(
		nodeId: string,
		plugin: string,
		kind: PluginDisplayStateKind,
		key: string,
	): JsonValue | undefined {
		requireNonEmpty(nodeId, "显示状态的楼层 id");
		requireNonEmpty(plugin, "显示状态的插件名");
		assertKind(kind);
		requireNonEmpty(key, "显示状态的键");
		const value = this.#nodes.get(nodeId)?.get(plugin)?.[kind][key];
		return value === undefined ? undefined : structuredClone(value);
	}

	/** 该楼层上有显示状态的插件名，按首次写入顺序。 */
	listPlugins(nodeId: string): readonly string[] {
		requireNonEmpty(nodeId, "显示状态的楼层 id");
		return [...(this.#nodes.get(nodeId)?.keys() ?? [])];
	}

	/** 清掉一个插件在该楼层的显示状态；不传插件时清掉该楼层的全部状态。 */
	clear(nodeId: string, plugin?: string): void {
		requireNonEmpty(nodeId, "显示状态的楼层 id");
		if (plugin === undefined) {
			this.#nodes.delete(nodeId);
			return;
		}
		requireNonEmpty(plugin, "显示状态的插件名");
		const plugins = this.#nodes.get(nodeId);
		if (plugins === undefined) return;
		plugins.delete(plugin);
		if (plugins.size === 0) this.#nodes.delete(nodeId);
	}
}

function requireNonEmpty(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label}必须是非空字符串`);
	}
	return value;
}

function assertKind(kind: unknown): asserts kind is PluginDisplayStateKind {
	if (kind !== "display" && kind !== "metadata") {
		throw new Error(`显示状态的类别不合法：${String(kind)}`);
	}
}

function assertStateValues(
	values: unknown,
	kind: PluginDisplayStateKind,
): JsonObject {
	if (!isJsonObject(values)) {
		throw new Error(`显示状态 ${kind} 必须是对象`);
	}
	const keys = Object.keys(values);
	if (keys.length === 0) {
		throw new Error(`显示状态 ${kind} 至少需要一个键`);
	}
	for (const key of keys) {
		if (key.length === 0) {
			throw new Error(`显示状态 ${kind} 的键不能为空`);
		}
		assertJsonValue(values[key], `显示状态.${kind}.${key}`);
	}
	return values;
}

function setOwn(target: JsonObject, key: string, value: JsonValue): void {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

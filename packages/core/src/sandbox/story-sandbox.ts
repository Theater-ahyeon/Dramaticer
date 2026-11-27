import { type JsonObject, type JsonValue, isJsonObject } from "../json.js";
import {
	type FloorRendererPlugin,
	parseDeclarativePlugin,
} from "../plugins/declarative.js";
import type { FloorBridgeCapability } from "../plugins/floor-renderers.js";
import type { StoryStore } from "../store/story-store.js";
import { assertSandboxDomain, scanSandboxDomains } from "./domains.js";

const ALLOWED_DOMAINS_KEY = "sandbox.allowedDomains";
const DETECTED_DOMAINS_KEY = "sandbox.detectedDomains";
const RENDERERS_KEY = "sandbox.renderers";

export const SANDBOX_RENDERER_SOURCES = ["card", "player"] as const;

export type SandboxRendererSource = (typeof SANDBOX_RENDERER_SOURCES)[number];

export interface StoredFloorRenderer {
	readonly id: string;
	/** 声明式插件名；同一张卡升级时按它替换。 */
	readonly plugin: string;
	readonly name: string;
	readonly source: SandboxRendererSource;
	readonly installedAt: string;
	readonly definition: FloorRendererPlugin;
}

export interface StorySandboxRendererSummary {
	readonly id: string;
	readonly plugin: string;
	readonly name: string;
	readonly permissions: readonly FloorBridgeCapability[];
}

/** 故事级的联网允许名单与检测结果；默认都不联网。 */
export function readStorySandboxDomains(
	store: StoryStore,
	storyId: string,
): {
	readonly allowed: readonly string[];
	readonly detected: readonly string[];
} {
	return {
		allowed: readDomainList(store, storyId, ALLOWED_DOMAINS_KEY),
		detected: readDomainList(store, storyId, DETECTED_DOMAINS_KEY),
	};
}

function readDomainList(
	store: StoryStore,
	storyId: string,
	key: string,
): string[] {
	const value = store.getStoryValue(storyId, key);
	if (value === null) return [];
	if (!Array.isArray(value)) {
		throw new Error(`故事的 ${key} 必须是数组`);
	}
	return value.map((item, index) =>
		assertSandboxDomain(item, `${key}[${index}]`),
	);
}

function writeDomainList(
	store: StoryStore,
	storyId: string,
	key: string,
	domains: readonly string[],
): string[] {
	const unique = [...new Set(domains.map((item) => assertSandboxDomain(item)))];
	unique.sort();
	store.setStoryValue(storyId, key, unique as JsonValue);
	return unique;
}

/** 玩家逐个允许或取消允许；只动这一条，保存后立即生效。 */
export function allowStorySandboxDomain(
	store: StoryStore,
	storyId: string,
	domain: unknown,
	allowed: boolean,
): string[] {
	const normalized = assertSandboxDomain(domain);
	const current = readDomainList(store, storyId, ALLOWED_DOMAINS_KEY);
	const next = allowed
		? [...current, normalized]
		: current.filter((item) => item !== normalized);
	return writeDomainList(store, storyId, ALLOWED_DOMAINS_KEY, next);
}

export function setStorySandboxAllowedDomains(
	store: StoryStore,
	storyId: string,
	domains: readonly string[],
): string[] {
	return writeDomainList(store, storyId, ALLOWED_DOMAINS_KEY, domains);
}

/** 检测结果只增不减：脚本改过后旧域名仍列着，玩家可以自己取消允许。 */
export function recordStorySandboxDetectedDomains(
	store: StoryStore,
	storyId: string,
	domains: readonly string[],
): string[] {
	const current = readDomainList(store, storyId, DETECTED_DOMAINS_KEY);
	return writeDomainList(store, storyId, DETECTED_DOMAINS_KEY, [
		...current,
		...domains,
	]);
}

/** 从卡的 `extensions.dramaticer.plugins` 里安装随卡带的渲染器；其它插件类型忽略。 */
export function installStoryFloorRenderer(
	store: StoryStore,
	storyId: string,
	plugin: FloorRendererPlugin,
	source: SandboxRendererSource,
): StoredFloorRenderer {
	if (plugin.kind !== "floor-renderer") {
		throw new Error(`插件 ${plugin.name} 不是楼层渲染器`);
	}
	const renderers = [...readStoryFloorRenderers(store, storyId)];
	const collision = renderers.find(
		(entry) => entry.id === plugin.payload.id && entry.plugin !== plugin.name,
	);
	if (collision !== undefined) {
		throw new Error(
			`楼层渲染器 id 重复：${plugin.payload.id}（已经由 ${collision.plugin} 声明）`,
		);
	}
	const record: StoredFloorRenderer = {
		id: plugin.payload.id,
		plugin: plugin.name,
		name: plugin.payload.name,
		source,
		installedAt: new Date().toISOString(),
		definition: plugin,
	};
	const next = renderers.filter((entry) => entry.plugin !== plugin.name);
	next.push(record);
	store.setStoryValue(
		storyId,
		RENDERERS_KEY,
		next.map((entry) => serializeRenderer(entry)) as unknown as JsonValue,
	);
	recordStorySandboxDetectedDomains(
		store,
		storyId,
		scanFloorRendererDomains(plugin),
	);
	return record;
}

export function readStoryFloorRenderers(
	store: StoryStore,
	storyId: string,
): readonly StoredFloorRenderer[] {
	const value = store.getStoryValue(storyId, RENDERERS_KEY);
	if (value === null) return [];
	if (!Array.isArray(value)) {
		throw new Error(`故事的 ${RENDERERS_KEY} 必须是数组`);
	}
	return value.map((item, index) =>
		readRenderer(item, `${RENDERERS_KEY}[${index}]`),
	);
}

export function storySandboxRendererSummaries(
	store: StoryStore,
	storyId: string,
): StorySandboxRendererSummary[] {
	return readStoryFloorRenderers(store, storyId).map((entry) => ({
		id: entry.id,
		plugin: entry.plugin,
		name: entry.name,
		permissions: entry.definition.payload.permissions,
	}));
}

/** 渲染器模板、脚本与样式里出现的外部域名。 */
export function scanFloorRendererDomains(
	plugin: FloorRendererPlugin,
): string[] {
	const found = new Set<string>();
	for (const text of [
		plugin.payload.template,
		plugin.payload.script ?? "",
		plugin.payload.style ?? "",
	]) {
		for (const domain of scanSandboxDomains(text)) found.add(domain);
	}
	return [...found].sort();
}

function serializeRenderer(entry: StoredFloorRenderer): JsonObject {
	return {
		id: entry.id,
		plugin: entry.plugin,
		name: entry.name,
		source: entry.source,
		installedAt: entry.installedAt,
		definition: entry.definition as unknown as JsonObject,
	};
}

function readRenderer(value: unknown, path: string): StoredFloorRenderer {
	if (!isJsonObject(value)) {
		throw new Error(`${path} 必须是对象`);
	}
	const pluginName = value.plugin;
	if (typeof pluginName !== "string" || pluginName.length === 0) {
		throw new Error(`${path}.plugin 必须是非空字符串`);
	}
	const source = value.source;
	if (source !== "card" && source !== "player") {
		throw new Error(`${path}.source 只能是 card 或 player`);
	}
	const installedAt = value.installedAt;
	if (typeof installedAt !== "string" || installedAt.length === 0) {
		throw new Error(`${path}.installedAt 必须是非空字符串`);
	}
	const parsed = parseDeclarativePlugin(value.definition, `${path}.definition`);
	if (parsed.kind !== "floor-renderer") {
		throw new Error(`${path}.definition 必须是楼层渲染器`);
	}
	if (value.id !== parsed.payload.id || value.name !== parsed.payload.name) {
		throw new Error(`${path} 的 id 或显示名与定义不一致`);
	}
	return {
		id: parsed.payload.id,
		plugin: parsed.name,
		name: parsed.payload.name,
		source,
		installedAt,
		definition: parsed,
	};
}

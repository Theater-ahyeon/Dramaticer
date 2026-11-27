import {
	type FloorBridgeCapability,
	type JsonValue,
	type StoryStore,
	isJsonObject,
	scanSandboxDomains,
} from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import type { StRegexScript } from "../preset.js";
import { discoverStHelperScripts } from "../st-helper-host/scripts.js";
import {
	type StDisplayRegex,
	collectStDisplayRegexes,
	scanDisplayRegexDomains,
	toStDisplayRegexes,
} from "./display.js";

/** ST 兼容层在故事上的渲染配置；核心不读这个键，只有 st-compat 认识。 */
export const ST_CARD_UI_KEY = "st.compat.cardUi";

export const ST_CONTENT_RENDERER_ID = "st-content-regex";
export const ST_HELPER_RENDERER_ID = "st-helper-host";

export const ST_RENDERER_IDS = [
	ST_CONTENT_RENDERER_ID,
	ST_HELPER_RENDERER_ID,
] as const;

export type StRendererId = (typeof ST_RENDERER_IDS)[number];

/** 两个渲染插件都通过楼层交互桥读写变量与发消息。 */
export const ST_RENDERER_PERMISSIONS: readonly FloorBridgeCapability[] = [
	"sendMessage",
	"fillInput",
	"readState",
	"writeState",
	"openImage",
];

const ST_RENDERER_NAMES: Readonly<Record<StRendererId, string>> = {
	[ST_CONTENT_RENDERER_ID]: "酒馆美化正则",
	[ST_HELPER_RENDERER_ID]: "酒馆助手脚本",
};

export interface StCardUiScript {
	readonly id: string;
	readonly name: string;
	readonly content: string;
}

export interface StCardUiConfig {
	readonly version: 1;
	readonly characterName: string;
	readonly regexEnabled: boolean;
	readonly helperEnabled: boolean;
	readonly regexes: readonly StDisplayRegex[];
	readonly scripts: readonly StCardUiScript[];
}

export interface StRendererSummary {
	readonly id: StRendererId;
	readonly plugin: string;
	readonly name: string;
	readonly permissions: readonly FloorBridgeCapability[];
	readonly enabled: boolean;
}

export interface StCardUiImportResult {
	readonly config: StCardUiConfig | null;
	readonly domains: readonly string[];
}

export function isStRendererId(value: unknown): value is StRendererId {
	return (
		typeof value === "string" &&
		(ST_RENDERER_IDS as readonly string[]).includes(value)
	);
}

export function readStCardUiConfig(
	store: StoryStore,
	storyId: string,
): StCardUiConfig | null {
	const value = store.getStoryValue(storyId, ST_CARD_UI_KEY);
	if (value === null) return null;
	if (!isJsonObject(value)) {
		throw new Error(`故事的 ${ST_CARD_UI_KEY} 必须是对象`);
	}
	if (value.version !== 1) {
		throw new Error(`${ST_CARD_UI_KEY}.version 只支持 1`);
	}
	const characterName = readString(value.characterName, "characterName");
	const regexEnabled = readBoolean(value.regexEnabled, "regexEnabled");
	const helperEnabled = readBoolean(value.helperEnabled, "helperEnabled");
	if (!Array.isArray(value.regexes)) {
		throw new Error(`${ST_CARD_UI_KEY}.regexes 必须是数组`);
	}
	const regexes = value.regexes.map((item, index) =>
		readRegex(item, `regexes[${index}]`),
	);
	if (!Array.isArray(value.scripts)) {
		throw new Error(`${ST_CARD_UI_KEY}.scripts 必须是数组`);
	}
	const scripts = value.scripts.map((item, index) =>
		readScript(item, `scripts[${index}]`),
	);
	return {
		version: 1,
		characterName,
		regexEnabled,
		helperEnabled,
		regexes,
		scripts,
	};
}

function saveStCardUiConfig(
	store: StoryStore,
	storyId: string,
	config: StCardUiConfig,
): StCardUiConfig {
	store.setStoryValue(storyId, ST_CARD_UI_KEY, config as unknown as JsonValue);
	return config;
}

/**
 * 导入角色卡时把显示层正则与启用的助手脚本转成 st-compat 的渲染配置。
 * 卡里没有这两类内容时清掉旧配置；升级卡时保留玩家已经调好的开关。
 */
export function importStCardUi(
	store: StoryStore,
	storyId: string,
	card: StCharacterCard,
	options: { readonly presetRegexScripts?: readonly StRegexScript[] } = {},
): StCardUiImportResult {
	const previous = readStCardUiConfig(store, storyId);
	const regexes = collectStDisplayRegexes(
		card,
		options.presetRegexScripts ?? [],
	);
	const scripts = discoverStHelperScripts(card)
		.filter((script) => script.enabled && script.type === "script")
		.map((script) => ({
			id: script.id,
			name: script.name,
			content: script.content,
		}));
	if (regexes.length === 0 && scripts.length === 0) {
		store.setStoryValue(storyId, ST_CARD_UI_KEY, null);
		return { config: null, domains: [] };
	}
	const config: StCardUiConfig = {
		version: 1,
		characterName: card.name,
		regexEnabled: previous?.regexEnabled ?? true,
		helperEnabled: previous?.helperEnabled ?? true,
		regexes,
		scripts,
	};
	return {
		config: saveStCardUiConfig(store, storyId, config),
		domains: scanStCardUiDomains(regexes, scripts),
	};
}

/** 预设里带的显示层正则并进当前故事；没有卡配置时也能单独启用。 */
export function importStPresetRegexes(
	store: StoryStore,
	storyId: string,
	presetScripts: readonly StRegexScript[],
	characterName: string,
): StCardUiImportResult {
	const incoming = toStDisplayRegexes(presetScripts);
	if (incoming.length === 0) return { config: null, domains: [] };
	const previous = readStCardUiConfig(store, storyId);
	const seen = new Set<string>();
	const regexes: StDisplayRegex[] = [];
	for (const entry of [...(previous?.regexes ?? []), ...incoming]) {
		if (seen.has(entry.id)) continue;
		seen.add(entry.id);
		regexes.push(entry);
	}
	const config: StCardUiConfig = {
		version: 1,
		characterName: previous?.characterName ?? characterName,
		regexEnabled: previous?.regexEnabled ?? true,
		helperEnabled: previous?.helperEnabled ?? false,
		regexes,
		scripts: previous?.scripts ?? [],
	};
	return {
		config: saveStCardUiConfig(store, storyId, config),
		domains: scanDisplayRegexDomains(incoming),
	};
}

/** 设定页的开关：只改一个渲染插件，另一个保持原样。 */
export function setStRendererEnabled(
	store: StoryStore,
	storyId: string,
	id: StRendererId,
	enabled: boolean,
): StCardUiConfig {
	if (typeof enabled !== "boolean") {
		throw new Error("enabled 必须是布尔值");
	}
	const config = readStCardUiConfig(store, storyId);
	if (config === null) {
		throw new Error("这个故事没有酒馆卡片渲染配置");
	}
	if (id === ST_CONTENT_RENDERER_ID) {
		if (config.regexes.length === 0) {
			throw new Error("这张卡没有可用的美化正则");
		}
		return saveStCardUiConfig(store, storyId, {
			...config,
			regexEnabled: enabled,
		});
	}
	if (config.scripts.length === 0) {
		throw new Error("这张卡没有启用的酒馆助手脚本");
	}
	return saveStCardUiConfig(store, storyId, {
		...config,
		helperEnabled: enabled,
	});
}

/** 渲染器列表里只列真的有内容的插件。 */
export function stRendererSummaries(
	config: StCardUiConfig | null,
): StRendererSummary[] {
	if (config === null) return [];
	const summaries: StRendererSummary[] = [];
	if (config.regexes.length > 0) {
		summaries.push(summary(ST_CONTENT_RENDERER_ID, config.regexEnabled));
	}
	if (config.scripts.length > 0) {
		summaries.push(summary(ST_HELPER_RENDERER_ID, config.helperEnabled));
	}
	return summaries;
}

function summary(id: StRendererId, enabled: boolean): StRendererSummary {
	return {
		id,
		plugin: id,
		name: ST_RENDERER_NAMES[id],
		permissions: ST_RENDERER_PERMISSIONS,
		enabled,
	};
}

/** 写状态的权限查询；不认识的 id 与关掉的插件都返回 null。 */
export function stRendererPermissions(
	store: StoryStore,
	storyId: string,
	id: string,
): readonly FloorBridgeCapability[] | null {
	const config = readStCardUiConfig(store, storyId);
	if (config === null) return null;
	for (const entry of stRendererSummaries(config)) {
		if (entry.id === id) return entry.enabled ? entry.permissions : null;
	}
	return null;
}

function scanStCardUiDomains(
	regexes: readonly StDisplayRegex[],
	scripts: readonly StCardUiScript[],
): string[] {
	const found = new Set(scanDisplayRegexDomains(regexes));
	for (const script of scripts) {
		for (const domain of scanSandboxDomains(script.content)) found.add(domain);
	}
	return [...found].sort();
}

function readRegex(value: unknown, path: string): StDisplayRegex {
	if (!isJsonObject(value)) {
		throw new Error(`${ST_CARD_UI_KEY}.${path} 必须是对象`);
	}
	return {
		id: readString(value.id, `${path}.id`),
		name: readString(value.name, `${path}.name`),
		findRegex: readNonEmptyString(value.findRegex, `${path}.findRegex`),
		replaceString: readString(value.replaceString, `${path}.replaceString`),
		trimStrings: readStringArray(value.trimStrings, `${path}.trimStrings`),
		substituteRegex:
			value.substituteRegex === null || value.substituteRegex === undefined
				? null
				: readNumber(value.substituteRegex, `${path}.substituteRegex`),
	};
}

function readScript(value: unknown, path: string): StCardUiScript {
	if (!isJsonObject(value)) {
		throw new Error(`${ST_CARD_UI_KEY}.${path} 必须是对象`);
	}
	return {
		id: readString(value.id, `${path}.id`),
		name: readString(value.name, `${path}.name`),
		content: readString(value.content, `${path}.content`),
	};
}

function readString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new Error(`${ST_CARD_UI_KEY}.${path} 必须是字符串`);
	}
	return value;
}

function readNonEmptyString(value: unknown, path: string): string {
	const text = readString(value, path);
	if (text.length === 0) {
		throw new Error(`${ST_CARD_UI_KEY}.${path} 不能为空`);
	}
	return text;
}

function readBoolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`${ST_CARD_UI_KEY}.${path} 必须是布尔值`);
	}
	return value;
}

function readNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${ST_CARD_UI_KEY}.${path} 必须是数字`);
	}
	return value;
}

function readStringArray(value: unknown, path: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${ST_CARD_UI_KEY}.${path} 必须是数组`);
	}
	return value.map((item, index) => readString(item, `${path}[${index}]`));
}

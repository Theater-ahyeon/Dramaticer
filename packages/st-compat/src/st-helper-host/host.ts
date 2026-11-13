import type { PluginDisplayState, StoryStore } from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import type { StEjsGenerationScheduler } from "../st-ejs/generation.js";
import {
	type StEjsVariableStore,
	StEjsVariableStore as VariableStore,
} from "../st-ejs/variables.js";
import {
	StHelperEventRegistry as EventRegistry,
	ST_HELPER_TAVERN_EVENTS,
	type StHelperEventHandle,
	type StHelperEventListener,
	type StHelperEventRegistry,
} from "./events.js";
import {
	StHelperGenerationQueue,
	type StHelperGenerationTraceEntry,
} from "./generation.js";
import {
	StHelperHtmlRenderer,
	type StHelperRenderRequest,
	type StHelperRenderTraceEntry,
} from "./html.js";
import {
	type StHelperChatMessage,
	type StHelperChatMessageOptions,
	type StHelperChatMessageRange,
	type StHelperChatMessageUpdate,
	StHelperChatMessages,
	type StHelperSetChatMessagesOptions,
} from "./messages.js";
import { type StHelperScript, discoverStHelperScripts } from "./scripts.js";
import { StHelperSlashRunner } from "./slash.js";
import {
	StHelperVariableBank,
	type StHelperVariableOptions,
	type StHelperVariables,
} from "./variables.js";

/** 宿主暴露给脚本的 API 名称；C-T05.f 用它统计覆盖率。 */
export const ST_HELPER_IMPLEMENTED_FUNCTIONS = [
	"getVariables",
	"replaceVariables",
	"insertOrAssignVariables",
	"updateVariablesWith",
	"getVariable",
	"insertOrAssignVariable",
	"deleteVariable",
	"eventOn",
	"eventOnce",
	"eventEmit",
	"eventRemoveListener",
	"eventClearEvent",
	"eventClearAll",
	"getChatMessages",
	"getChatMessage",
	"getLastMessageId",
	"getCurrentMessageId",
	"setChatMessages",
	"triggerSlash",
] as const;

export type StHelperImplementedFunction =
	(typeof ST_HELPER_IMPLEMENTED_FUNCTIONS)[number];

export interface StHelperHostApi {
	readonly tavern_events: typeof ST_HELPER_TAVERN_EVENTS;
	getVariables(options?: StHelperVariableOptions): StHelperVariables;
	replaceVariables(
		variables: StHelperVariables,
		options?: StHelperVariableOptions,
	): void;
	insertOrAssignVariables(
		variables: StHelperVariables,
		options?: StHelperVariableOptions,
	): void;
	updateVariablesWith(
		updater: (variables: StHelperVariables) => StHelperVariables,
		options?: StHelperVariableOptions,
	): StHelperVariables;
	getVariable(path: string, options?: StHelperVariableOptions): unknown;
	insertOrAssignVariable(
		path: string,
		value: unknown,
		options?: StHelperVariableOptions,
	): void;
	deleteVariable(path: string, options?: StHelperVariableOptions): void;
	eventOn(
		type: string,
		listener: StHelperEventListener,
		options?: { readonly once?: boolean },
	): StHelperEventHandle;
	eventOnce(type: string, listener: StHelperEventListener): StHelperEventHandle;
	eventEmit(type: string, ...args: unknown[]): void;
	eventRemoveListener(type: string, listener: StHelperEventListener): void;
	eventClearEvent(type: string): void;
	eventClearAll(): void;
	getChatMessages(
		range: StHelperChatMessageRange,
		options?: StHelperChatMessageOptions,
	): readonly StHelperChatMessage[];
	getChatMessage(
		messageId: number,
		options?: { readonly include_swipes?: boolean },
	): StHelperChatMessage;
	getLastMessageId(): number;
	getCurrentMessageId(): number;
	setChatMessages(
		updates: readonly StHelperChatMessageUpdate[],
		options?: StHelperSetChatMessagesOptions,
	): void;
	triggerSlash(script: string): Promise<string>;
}

export interface StHelperHostSession {
	readonly api: StHelperHostApi;
	readonly scripts: readonly StHelperScript[];
	readonly events: StHelperEventRegistry;
	/** 脚本发起的生成队列；没有提供调度器时为 null。 */
	readonly generation: StHelperGenerationQueue | null;
	/** HTML 状态栏与开场页；没有提供渲染入口时为 null。 */
	readonly html: StHelperHtmlRenderer | null;
	dispose(): void;
}

export interface StHelperHtmlHostOptions {
	/** 把渲染请求送进沙箱 iframe；通常调用 `StHelperSandboxHost.startRender`。 */
	readonly start: (request: StHelperRenderRequest) => string;
	/** 同一状态栏连续自动刷新的上限，默认 8。 */
	readonly maxAutoRefreshes?: number;
	readonly onTrace?: (entry: StHelperRenderTraceEntry) => void;
}

export interface StHelperHostSessionOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly card: StCharacterCard;
	readonly displayState: PluginDisplayState;
	/** 与 EJS 共用同一份变量存储；不提供时用当前路径建一个空的消息变量种子。 */
	readonly variables?: StEjsVariableStore;
	readonly userName?: string;
	readonly characterName?: string;
	readonly plugin?: string;
	/**
	 * 与 EJS 模板共用的生成调度器；提供后 `/gen`、`/genraw` 只登记后台
	 * 请求，宿主在间隙调用 `session.generation.drain()` 用后台渠道执行。
	 */
	readonly generation?: StEjsGenerationScheduler;
	readonly onGenerationTrace?: (entry: StHelperGenerationTraceEntry) => void;
	/** 提供后，宿主会渲染 HTML 状态栏与开场页，变量写入时自动重渲染状态栏。 */
	readonly html?: StHelperHtmlHostOptions;
}

export function createStHelperHostSession(
	options: StHelperHostSessionOptions,
): StHelperHostSession {
	const plugin = options.plugin ?? "st-helper-host";
	if (plugin.trim().length === 0) {
		throw new Error("宿主插件名必须是非空字符串");
	}
	const path = options.store.getPathToHead(options.storyId);
	const variables =
		options.variables ??
		new VariableStore({
			messages: path.map((node, index) => ({
				id: index,
				role: node.role,
				variables: {},
			})),
		});
	const events = new EventRegistry();
	const scripts = discoverStHelperScripts(options.card);
	let html: StHelperHtmlRenderer | null = null;
	const variableBank = new StHelperVariableBank(variables, {
		onChange: () => {
			html?.refreshStatusBars();
		},
	});
	if (options.html !== undefined) {
		html = new StHelperHtmlRenderer({
			store: options.store,
			displayState: options.displayState,
			start: options.html.start,
			scripts,
			openingRaw: options.card.firstMessage,
			plugin,
			...(options.html.maxAutoRefreshes === undefined
				? {}
				: { maxAutoRefreshes: options.html.maxAutoRefreshes }),
			...(options.html.onTrace === undefined
				? {}
				: { onTrace: options.html.onTrace }),
		});
	}
	const messages = new StHelperChatMessages({
		store: options.store,
		storyId: options.storyId,
		displayState: options.displayState,
		plugin,
		userName: options.userName ?? "用户",
		characterName: options.characterName ?? options.card.name,
	});
	const generation =
		options.generation === undefined
			? null
			: new StHelperGenerationQueue({
					scheduler: options.generation,
					storyId: options.storyId,
					cardId: options.card.name,
					nodeId: path.at(-1)?.id ?? null,
					plugin,
					...(options.onGenerationTrace === undefined
						? {}
						: { onTrace: options.onGenerationTrace }),
				});
	const slash = new StHelperSlashRunner({
		variables: variableBank,
		messages,
		...(generation === null
			? {}
			: {
					generate: (request) => generation.enqueue(request),
					generationResults: { read: (id) => generation.read(id) },
				}),
	});

	const api: StHelperHostApi = {
		tavern_events: ST_HELPER_TAVERN_EVENTS,
		getVariables: (variableOptions) =>
			variableBank.getVariables(variableOptions),
		replaceVariables: (next, variableOptions) =>
			variableBank.replaceVariables(next, variableOptions),
		insertOrAssignVariables: (next, variableOptions) =>
			variableBank.insertOrAssignVariables(next, variableOptions),
		updateVariablesWith: (updater, variableOptions) =>
			variableBank.updateVariablesWith(updater, variableOptions),
		getVariable: (path, variableOptions) =>
			variableBank.getVariable(path, variableOptions),
		insertOrAssignVariable: (path, value, variableOptions) =>
			variableBank.insertOrAssignVariable(path, value, variableOptions),
		deleteVariable: (path, variableOptions) =>
			variableBank.deleteVariable(path, variableOptions),
		eventOn: (type, listener, eventOptions) =>
			events.on(type, listener, eventOptions),
		eventOnce: (type, listener) => events.once(type, listener),
		eventEmit: (type, ...args) => events.emit(type, ...args),
		eventRemoveListener: (type, listener) => events.remove(type, listener),
		eventClearEvent: (type) => events.clearEvent(type),
		eventClearAll: () => events.clearAll(),
		getChatMessages: (range, messageOptions) =>
			messages.getChatMessages(range, messageOptions),
		getChatMessage: (messageId, messageOptions) =>
			messages.getChatMessage(messageId, messageOptions),
		getLastMessageId: () => messages.getLastMessageId(),
		getCurrentMessageId: () => messages.getCurrentMessageId(),
		setChatMessages: (updates, messageOptions) =>
			messages.setChatMessages(updates, messageOptions),
		triggerSlash: (script) => slash.run(script),
	};

	return {
		api,
		scripts,
		events,
		generation,
		html,
		dispose: () => {
			events.clearAll();
		},
	};
}

import { ST_HELPER_IMPLEMENTED_FUNCTIONS } from "./host.js";

/**
 * 酒馆助手（JS-Slash-Runner）4.8.10 的公开类型定义里声明的全部名字。
 * 只记录名字与来源文件名，没有复制上游源码。`functions` 是其中的函数，
 * `others` 是常量、类与对象入口。
 */
export const ST_HELPER_UPSTREAM_API_SNAPSHOT = {
	version: "4.8.10",
	sources: [
		"@types/function/index.d.ts",
		"@types/iframe/event.d.ts",
		"@types/iframe/script.d.ts",
		"@types/iframe/util.d.ts",
		"@types/iframe/variables.d.ts",
	],
	functions: [
		"appendAudioList",
		"appendInexistentScriptButtons",
		"createCharacter",
		"createChatMessages",
		"createLorebook",
		"createLorebookEntries",
		"createOrReplaceCharacter",
		"createOrReplacePreset",
		"createOrReplaceWorldbook",
		"createPreset",
		"createWorldbook",
		"createWorldbookEntries",
		"deleteCharacter",
		"deleteChatMessages",
		"deleteLorebook",
		"deleteLorebookEntries",
		"deletePreset",
		"deleteVariable",
		"deleteWorldbook",
		"deleteWorldbookEntries",
		"errorCatched",
		"eventClearAll",
		"eventClearEvent",
		"eventClearListener",
		"eventEmit",
		"eventEmitAndWait",
		"eventMakeFirst",
		"eventMakeLast",
		"eventOn",
		"eventOnButton",
		"eventOnce",
		"eventRemoveListener",
		"formatAsDisplayedMessage",
		"formatAsTavernRegexedString",
		"generate",
		"generateRaw",
		"getAllEnabledScriptButtons",
		"getAllVariables",
		"getAudioList",
		"getAudioSettings",
		"getButtonEvent",
		"getCharacter",
		"getCharacterNames",
		"getCharAvatarPath",
		"getCharData",
		"getCharLorebooks",
		"getCharWorldbookNames",
		"getChatHistoryBrief",
		"getChatHistoryDetail",
		"getChatMessages",
		"getChatWorldbookName",
		"getCurrentAudio",
		"getCurrentCharPrimaryLorebook",
		"getCurrentMessageId",
		"getExtensionStatus",
		"getExtensionType",
		"getGlobalWorldbookNames",
		"getIframeName",
		"getLastMessageId",
		"getLoadedPresetName",
		"getLorebookEntries",
		"getLorebooks",
		"getLorebookSettings",
		"getMessageId",
		"getModelList",
		"getOrCreateChatLorebook",
		"getOrCreateChatWorldbook",
		"getPreset",
		"getPresetNames",
		"getProxyPresetNames",
		"getScriptButtons",
		"getScriptId",
		"getScriptInfo",
		"getScriptName",
		"getTavernHelperExtensionId",
		"getTavernHelperVersion",
		"getTavernRegexes",
		"getTavernVersion",
		"getVariables",
		"getWorldbook",
		"getWorldbookNames",
		"importRawCharacter",
		"importRawChat",
		"importRawPreset",
		"importRawTavernRegex",
		"importRawWorldbook",
		"initializeGlobal",
		"injectPrompts",
		"insertOrAssignVariables",
		"insertVariables",
		"installExtension",
		"isAdmin",
		"isCharacterTavernRegexesEnabled",
		"isInstalledExtension",
		"isPresetNormalPrompt",
		"isPresetPlaceholderPrompt",
		"isPresetSystemPrompt",
		"loadPreset",
		"pauseAudio",
		"playAudio",
		"rebindCharWorldbooks",
		"rebindChatWorldbook",
		"rebindGlobalWorldbooks",
		"refreshOneMessage",
		"registerMacroLike",
		"reinstallExtension",
		"reloadIframe",
		"renamePreset",
		"replaceAudioList",
		"replaceCharacter",
		"replaceLorebookEntries",
		"replacePreset",
		"replaceScriptButtons",
		"replaceScriptInfo",
		"replaceTavernRegexes",
		"replaceVariables",
		"replaceWorldbook",
		"retrieveDisplayedMessage",
		"rotateChatMessages",
		"setAudioSettings",
		"setChatMessages",
		"setCurrentCharLorebooks",
		"setLorebookEntries",
		"setLorebookSettings",
		"setPreset",
		"stopAllGeneration",
		"stopGenerationById",
		"substitudeMacros",
		"triggerSlash",
		"uninjectPrompts",
		"uninstallExtension",
		"updateCharacterWith",
		"updateExtension",
		"updatelorebookEntriesWith",
		"updatePresetWith",
		"updateScriptButtonsWith",
		"updateTavernRegexesWith",
		"updateVariablesWith",
		"updateWorldbookWith",
		"waitGlobalInitialized",
	],
	others: [
		"RawCharacter",
		"builtin",
		"builtin_prompt_default_order",
		"default_preset",
		"iframe_events",
		"tavern_events",
	],
} as const;

/**
 * C-T05 移植范围内、上游公开类型定义里存在的函数名。范围按任务书写明的
 * 五组能力划分：变量读写、事件监听、`triggerSlash`/STscript、生成、读消息
 * 与改消息。`insertVariables`、`generate`、`generateRaw` 在快照里存在但
 * 没有同名实现：生成能力由 `/gen`、`/genraw` 命令提供。
 */
export const ST_HELPER_SCOPE_FUNCTIONS = [
	"getVariables",
	"replaceVariables",
	"updateVariablesWith",
	"insertOrAssignVariables",
	"insertVariables",
	"deleteVariable",
	"eventOn",
	"eventOnce",
	"eventEmit",
	"eventRemoveListener",
	"eventClearEvent",
	"eventClearAll",
	"triggerSlash",
	"generate",
	"generateRaw",
	"getChatMessages",
	"getLastMessageId",
	"getCurrentMessageId",
	"setChatMessages",
] as const;

/**
 * 本宿主提供、但 4.8.10 的公开类型定义里没有声明的名称。它们来自更早
 * 版本的按路径变量读写与单条消息读取，脚本里仍在用，所以保留。
 */
export const ST_HELPER_EXTENDED_FUNCTIONS = [
	"getVariable",
	"insertOrAssignVariable",
	"getChatMessage",
] as const;

export interface StHelperCoverageSummary {
	/** 上游快照里的函数总数。 */
	readonly upstreamFunctions: number;
	/** 实现了同名的上游函数。 */
	readonly implementedUpstream: number;
	/** 全量覆盖率：`implementedUpstream / upstreamFunctions`。 */
	readonly coverage: number;
	/** C-T05 范围内的上游函数数。 */
	readonly scopeFunctions: number;
	/** 范围内实现了同名的函数数。 */
	readonly implementedInScope: number;
	/** 范围覆盖率：`implementedInScope / scopeFunctions`。 */
	readonly scopeCoverage: number;
	/** 范围内没有同名实现的上游函数。 */
	readonly missingInScope: readonly string[];
	/** 全量里没有同名实现的上游函数。 */
	readonly missing: readonly string[];
	/** 本宿主额外的函数名数量。 */
	readonly extended: number;
}

/**
 * 按当前实现清单计算覆盖率。清单、快照与扩展名之间出现不一致时直接抛错，
 * 不静默跳过未知名称。
 */
export function summarizeStHelperCoverage(): StHelperCoverageSummary {
	const upstream = new Set<string>(ST_HELPER_UPSTREAM_API_SNAPSHOT.functions);
	const implemented = new Set<string>(ST_HELPER_IMPLEMENTED_FUNCTIONS);
	const extended = new Set<string>(ST_HELPER_EXTENDED_FUNCTIONS);
	for (const name of implemented) {
		if (!upstream.has(name) && !extended.has(name)) {
			throw new Error(`已实现函数 ${name} 不在上游快照或扩展清单里`);
		}
	}
	for (const name of extended) {
		if (upstream.has(name)) {
			throw new Error(`扩展函数 ${name} 与上游快照重名`);
		}
		if (!implemented.has(name)) {
			throw new Error(`扩展函数 ${name} 没有实现`);
		}
	}
	for (const name of ST_HELPER_SCOPE_FUNCTIONS) {
		if (!upstream.has(name)) {
			throw new Error(`范围函数 ${name} 不在上游快照里`);
		}
	}
	const implementedUpstream = [...implemented].filter((name) =>
		upstream.has(name),
	);
	const implementedInScope = ST_HELPER_SCOPE_FUNCTIONS.filter((name) =>
		implemented.has(name),
	);
	return {
		upstreamFunctions: upstream.size,
		implementedUpstream: implementedUpstream.length,
		coverage: implementedUpstream.length / upstream.size,
		scopeFunctions: ST_HELPER_SCOPE_FUNCTIONS.length,
		implementedInScope: implementedInScope.length,
		scopeCoverage: implementedInScope.length / ST_HELPER_SCOPE_FUNCTIONS.length,
		missingInScope: ST_HELPER_SCOPE_FUNCTIONS.filter(
			(name) => !implemented.has(name),
		),
		missing: [...upstream].filter((name) => !implemented.has(name)),
		extended: extended.size,
	};
}

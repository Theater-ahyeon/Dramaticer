import { readFile } from "node:fs/promises";
import {
	optionalJsonArray,
	optionalNumber,
	optionalObject,
	optionalString,
	readBoolean,
	readNumberList,
	readObject,
	readString,
	readStringList,
} from "./field-readers.js";
import type { JsonObject, JsonValue } from "./json.js";
import { isJsonObject } from "./json.js";

/** OpenAI 预设里的一条 prompt（酒馆的 Prompt 类） */
export interface StPresetPrompt {
	readonly identifier: string;
	readonly name: string;
	readonly content: string;
	/** system、user、assistant，酒馆里也出现 model */
	readonly role: string | null;
	readonly systemPrompt: boolean;
	/** 标记类条目没有正文，靠 identifier 绑定到酒馆的槽位 */
	readonly marker: boolean;
	/** 字段缺失时酒馆按启用处理，这里同样默认为 true */
	readonly enabled: boolean;
	readonly forbidOverrides: boolean;
	/** 0 按深度注入，1 按绝对位置注入 */
	readonly injectionPosition: number | null;
	readonly injectionDepth: number | null;
	readonly injectionOrder: number | null;
	/** 酒馆的 injection_trigger，未识别的元素留在 raw 里 */
	readonly injectionTrigger: readonly JsonValue[] | null;
	readonly attachIndex: number | null;
	readonly attachRole: string | null;
	readonly attachSide: string | null;
	readonly extra: JsonObject | null;
	/** 原始对象，导出时直接写回 */
	readonly raw: JsonObject;
}

export interface StPromptOrderEntry {
	readonly identifier: string;
	readonly enabled: boolean;
	readonly raw: JsonObject;
}

export interface StPromptOrderGroup {
	/** 100000 表示全局顺序；缺失时为 null */
	readonly characterId: number | null;
	readonly order: readonly StPromptOrderEntry[];
	readonly raw: JsonObject;
}

/** 酒馆正则脚本 */
export interface StRegexScript {
	readonly id: string;
	readonly scriptName: string;
	readonly findRegex: string;
	readonly replaceString: string;
	readonly trimStrings: readonly string[];
	/** 作用位置，数字含义见酒馆的 regex_placement */
	readonly placement: readonly number[];
	readonly disabled: boolean;
	readonly markdownOnly: boolean;
	readonly promptOnly: boolean;
	readonly runOnEdit: boolean;
	readonly substituteRegex: number | null;
	readonly minDepth: number | null;
	readonly maxDepth: number | null;
	readonly raw: JsonObject;
}

export interface StPreset {
	readonly name: string | null;
	readonly temperature: number | null;
	readonly topP: number | null;
	readonly topK: number | null;
	readonly topA: number | null;
	readonly minP: number | null;
	readonly frequencyPenalty: number | null;
	readonly presencePenalty: number | null;
	readonly repetitionPenalty: number | null;
	/** JSON 里的 openai_max_tokens */
	readonly maxTokens: number | null;
	/** JSON 里的 openai_max_context */
	readonly contextSize: number | null;
	readonly seed: number | null;
	readonly n: number | null;
	readonly reasoningEffort: string | null;
	readonly assistantPrefill: string | null;
	readonly assistantImpersonation: string | null;
	readonly prompts: readonly StPresetPrompt[];
	readonly promptOrder: readonly StPromptOrderGroup[];
	/** extensions.regex_scripts */
	readonly regexScripts: readonly StRegexScript[];
	readonly extensions: JsonObject;
	/** 预设原始对象，导出时直接写回 */
	readonly raw: JsonObject;
}

export function parsePresetJson(jsonText: string): StPreset {
	const body = jsonText.charCodeAt(0) === 0xfeff ? jsonText.slice(1) : jsonText;
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch (error) {
		throw new Error("预设不是合法 JSON", { cause: error });
	}
	return normalizePreset(value);
}

export async function parsePresetFile(path: string): Promise<StPreset> {
	try {
		const text = await readFile(path, "utf8");
		return parsePresetJson(text);
	} catch (error) {
		throw new Error(`解析预设失败：${path}`, { cause: error });
	}
}

function normalizePreset(value: unknown): StPreset {
	if (!isJsonObject(value)) throw new Error("预设必须是 JSON 对象");
	const extensions = readObject(value, "extensions", "预设");
	const regexScriptsNode = extensions.regex_scripts;
	if (
		regexScriptsNode !== undefined &&
		regexScriptsNode !== null &&
		!Array.isArray(regexScriptsNode)
	) {
		throw new Error('预设字段 "extensions.regex_scripts" 不是数组');
	}
	return {
		name: optionalString(value, "name", "预设"),
		temperature: readConfigNumber(value, "temperature", "预设"),
		topP: readConfigNumber(value, "top_p", "预设"),
		topK: readConfigNumber(value, "top_k", "预设"),
		topA: readConfigNumber(value, "top_a", "预设"),
		minP: readConfigNumber(value, "min_p", "预设"),
		frequencyPenalty: readConfigNumber(value, "frequency_penalty", "预设"),
		presencePenalty: readConfigNumber(value, "presence_penalty", "预设"),
		repetitionPenalty: readConfigNumber(value, "repetition_penalty", "预设"),
		maxTokens: readConfigNumber(value, "openai_max_tokens", "预设"),
		contextSize: readConfigNumber(value, "openai_max_context", "预设"),
		seed: readConfigNumber(value, "seed", "预设"),
		n: readConfigNumber(value, "n", "预设"),
		reasoningEffort: optionalString(value, "reasoning_effort", "预设"),
		assistantPrefill: optionalString(value, "assistant_prefill", "预设"),
		assistantImpersonation: optionalString(
			value,
			"assistant_impersonation",
			"预设",
		),
		prompts: normalizePrompts(value.prompts),
		promptOrder: normalizePromptOrder(value.prompt_order),
		regexScripts: (regexScriptsNode ?? []).map((item, index) => {
			if (!isJsonObject(item)) {
				throw new Error(
					`预设字段 "extensions.regex_scripts[${index}]" 不是 JSON 对象`,
				);
			}
			return normalizeRegexScript(item);
		}),
		extensions,
		raw: value,
	};
}

function normalizePrompts(value: JsonValue | undefined): StPresetPrompt[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error('预设字段 "prompts" 不是数组');
	return value.map((item, index) => {
		if (!isJsonObject(item)) {
			throw new Error(`预设字段 "prompts[${index}]" 不是 JSON 对象`);
		}
		return normalizePrompt(item, index);
	});
}

function normalizePrompt(raw: JsonObject, index: number): StPresetPrompt {
	const context = `预设字段 "prompts[${index}]"`;
	return {
		identifier: readString(raw, "identifier", context),
		name: readString(raw, "name", context),
		content: readString(raw, "content", context),
		role: optionalString(raw, "role", context),
		systemPrompt: readBoolean(raw, "system_prompt", context, false),
		marker: readBoolean(raw, "marker", context, false),
		enabled: readBoolean(raw, "enabled", context, true),
		forbidOverrides: readBoolean(raw, "forbid_overrides", context, false),
		injectionPosition: optionalNumber(raw, "injection_position", context),
		injectionDepth: optionalNumber(raw, "injection_depth", context),
		injectionOrder: optionalNumber(raw, "injection_order", context),
		injectionTrigger: optionalJsonArray(raw, "injection_trigger", context),
		attachIndex: optionalNumber(raw, "attach_index", context),
		attachRole: optionalString(raw, "attach_role", context),
		attachSide: optionalString(raw, "attach_side", context),
		extra: optionalObject(raw, "extra", context),
		raw,
	};
}

function normalizePromptOrder(
	value: JsonValue | undefined,
): StPromptOrderGroup[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		throw new Error('预设字段 "prompt_order" 不是数组');
	}
	return value.map((item, index) => {
		if (!isJsonObject(item)) {
			throw new Error(`预设字段 "prompt_order[${index}]" 不是 JSON 对象`);
		}
		const orderNode = item.order;
		if (
			orderNode !== undefined &&
			orderNode !== null &&
			!Array.isArray(orderNode)
		) {
			throw new Error(`预设字段 "prompt_order[${index}].order" 不是数组`);
		}
		return {
			characterId: optionalNumber(item, "character_id", "预设"),
			order: (orderNode ?? []).map((entry, entryIndex) => {
				if (!isJsonObject(entry)) {
					throw new Error(
						`预设字段 "prompt_order[${index}].order[${entryIndex}]" 不是 JSON 对象`,
					);
				}
				const context = `预设字段 "prompt_order[${index}].order[${entryIndex}]"`;
				return {
					identifier: readString(entry, "identifier", context),
					enabled: readBoolean(entry, "enabled", context, true),
					raw: entry,
				};
			}),
			raw: item,
		};
	});
}

/** 酒馆部分预设把数值配置保存成字符串（例如 openai_max_context），这里统一成数字 */
function readConfigNumber(
	source: JsonObject,
	key: string,
	context: string,
): number | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (typeof value === "number") return value;
	if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
		return Number(value);
	}
	throw new Error(`${context}字段 "${key}" 不是数字`);
}

function normalizeRegexScript(raw: JsonObject): StRegexScript {
	const context = "预设正则脚本";
	return {
		id: readString(raw, "id", context),
		scriptName: readString(raw, "scriptName", context),
		findRegex: readString(raw, "findRegex", context),
		replaceString: readString(raw, "replaceString", context),
		trimStrings: readStringList(raw, "trimStrings", context),
		placement: readNumberList(raw, "placement", context),
		disabled: readBoolean(raw, "disabled", context, false),
		markdownOnly: readBoolean(raw, "markdownOnly", context, false),
		promptOnly: readBoolean(raw, "promptOnly", context, false),
		runOnEdit: readBoolean(raw, "runOnEdit", context, false),
		substituteRegex: optionalNumber(raw, "substituteRegex", context),
		minDepth: optionalNumber(raw, "minDepth", context),
		maxDepth: optionalNumber(raw, "maxDepth", context),
		raw,
	};
}

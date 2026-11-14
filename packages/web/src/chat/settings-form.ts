import type {
	BlockContextStrategy,
	DirectorConfig,
	DirectorIntensity,
	DirectorMode,
	HistoryBlockPolicy,
	HistoryBlockPolicyMode,
	LlmReasoningLevel,
	StorySettings,
	StorySettingsUpdate,
	StructuredOutputMode,
	TurnMode,
} from "@dramaticer/core";
import { ApiError } from "../api";
import {
	DEEP_CONTEXT_TOKEN_MINIMUM,
	DEEP_MAX_TOOL_CALLS_RANGE,
	DEEP_RECENT_TOOL_STEPS_RANGE,
	DEEP_TIMEOUT_MS_RANGE,
} from "./deep-turn";
import {
	type ImageSettingsDraft,
	buildImageSettingsDraft,
	describeImageConfigPath,
	parseImageSettingsDraft,
} from "./image-form";

export interface FormFieldError {
	/** 与服务端 `details.path` 同一套写法；空字符串表示整份表单。 */
	readonly path: string;
	readonly message: string;
}

export const STRUCTURED_OUTPUT_CHOICES: readonly {
	readonly value: StructuredOutputMode;
	readonly label: string;
}[] = [
	{ value: "text-tags", label: "文本标签" },
	{ value: "function-call", label: "工具调用" },
];

export const REASONING_CHOICES: readonly {
	readonly value: LlmReasoningLevel;
	readonly label: string;
}[] = [
	{ value: "off", label: "关闭" },
	{ value: "minimal", label: "最少" },
	{ value: "low", label: "低" },
	{ value: "medium", label: "中" },
	{ value: "high", label: "高" },
	{ value: "xhigh", label: "很高" },
	{ value: "max", label: "最大" },
];

export const TURN_MODE_CHOICES: readonly {
	readonly value: TurnMode;
	readonly label: string;
}[] = [
	{ value: "fast", label: "快回合" },
	{ value: "deep", label: "深回合" },
];

export const HISTORY_MODE_CHOICES: readonly {
	readonly value: HistoryBlockPolicyMode;
	readonly label: string;
}[] = [
	{ value: "default", label: "省略更早楼层的显示类块" },
	{ value: "full", label: "保留完整原文" },
];

export const HISTORY_STRATEGY_CHOICES: readonly {
	readonly value: "keep" | "drop" | "keep-depth";
	readonly label: string;
}[] = [
	{ value: "keep", label: "保留" },
	{ value: "drop", label: "删除" },
	{ value: "keep-depth", label: "保留到深度" },
];

export interface DirectorNumberField {
	readonly key: DirectorNumberKey;
	readonly label: string;
	readonly integer: boolean;
	readonly minimum: number;
	/** `minimum` 本身是否不允许；默认允许。 */
	readonly exclusiveMinimum?: boolean;
	/** 数值上限；不设置时没有上限。 */
	readonly maximum?: number;
}

export const DIRECTOR_NUMBER_KEYS = [
	"clueAgeWarning",
	"maxOpenClues",
	"maxOpenPromises",
	"stallFloors",
	"surprise",
	"similarityThreshold",
	"similarityWindow",
	"similarityStep",
	"similarityRiseWindows",
	"similarityRiseDelta",
	"similarityRiseMinimum",
	"sceneRepeatThreshold",
	"tensionEscalate",
	"tensionClimax",
	"tensionStateWeight",
	"tensionNoteWeight",
	"tensionEventWeight",
	"tensionStateDiffsPerFloor",
	"tensionNotesPerFloor",
	"pace",
	"minSetupFloors",
	"minEscalateFloors",
	"climaxFloors",
	"breatheFloors",
	"openingFloors",
] as const;

export type DirectorNumberKey = (typeof DIRECTOR_NUMBER_KEYS)[number];

export const DIRECTOR_NUMBER_FIELDS: readonly DirectorNumberField[] = [
	{
		key: "clueAgeWarning",
		label: "线索过老提醒（楼层）",
		integer: true,
		minimum: 0,
	},
	{
		key: "maxOpenClues",
		label: "同时打开的线索上限",
		integer: true,
		minimum: 1,
	},
	{
		key: "maxOpenPromises",
		label: "未兑现伏笔上限",
		integer: true,
		minimum: 0,
	},
	{ key: "stallFloors", label: "停滞判定楼层数", integer: true, minimum: 1 },
	{
		key: "surprise",
		label: "事件池意外频率",
		integer: false,
		minimum: 0,
		maximum: 1,
	},
	{
		key: "similarityThreshold",
		label: "重复度阈值",
		integer: false,
		minimum: 0,
		maximum: 1,
	},
	{ key: "similarityWindow", label: "重复度窗口", integer: true, minimum: 2 },
	{ key: "similarityStep", label: "重复度步长", integer: true, minimum: 1 },
	{
		key: "similarityRiseWindows",
		label: "连续上升窗口数",
		integer: true,
		minimum: 2,
	},
	{
		key: "similarityRiseDelta",
		label: "每窗口最小涨幅",
		integer: false,
		minimum: 0,
	},
	{
		key: "similarityRiseMinimum",
		label: "上升起点下限",
		integer: false,
		minimum: 0,
	},
	{
		key: "sceneRepeatThreshold",
		label: "场景重复提醒（节拍）",
		integer: true,
		minimum: 1,
	},
	{
		key: "tensionEscalate",
		label: "进入升级的张力",
		integer: false,
		minimum: 0,
		maximum: 1,
	},
	{
		key: "tensionClimax",
		label: "进入高潮的张力",
		integer: false,
		minimum: 0,
		maximum: 1,
	},
	{
		key: "tensionStateWeight",
		label: "张力权重·状态",
		integer: false,
		minimum: 0,
	},
	{
		key: "tensionNoteWeight",
		label: "张力权重·笔记",
		integer: false,
		minimum: 0,
	},
	{
		key: "tensionEventWeight",
		label: "张力权重·事件",
		integer: false,
		minimum: 0,
	},
	{
		key: "tensionStateDiffsPerFloor",
		label: "每楼状态变更记满（条）",
		integer: true,
		minimum: 1,
	},
	{
		key: "tensionNotesPerFloor",
		label: "每楼笔记记满（条）",
		integer: true,
		minimum: 1,
	},
	{
		key: "pace",
		label: "节奏快慢",
		integer: false,
		minimum: 0,
		exclusiveMinimum: true,
	},
	{ key: "minSetupFloors", label: "铺垫基础楼层", integer: true, minimum: 1 },
	{
		key: "minEscalateFloors",
		label: "升级基础楼层",
		integer: true,
		minimum: 1,
	},
	{ key: "climaxFloors", label: "高潮持续楼层", integer: true, minimum: 1 },
	{ key: "breatheFloors", label: "喘息持续楼层", integer: true, minimum: 1 },
	{
		key: "openingFloors",
		label: "开场楼层数（0 关闭）",
		integer: true,
		minimum: 0,
	},
];

export const DEEP_NUMBER_KEYS = [
	"deepMaxToolCalls",
	"deepTimeoutMs",
	"deepContextTokenLimit",
	"deepRecentToolSteps",
] as const;

export type DeepNumberKey = (typeof DEEP_NUMBER_KEYS)[number];

export interface DeepNumberField {
	readonly key: DeepNumberKey;
	readonly label: string;
	readonly minimum: number;
	/** 数值上限；不设置时没有上限。 */
	readonly maximum?: number;
}

/** 四段范围与 core 的 `assertDeep*` 一致。 */
export const DEEP_NUMBER_FIELDS: readonly DeepNumberField[] = [
	{
		key: "deepMaxToolCalls",
		label: `深回合工具调用上限（${DEEP_MAX_TOOL_CALLS_RANGE.minimum} 到 ${DEEP_MAX_TOOL_CALLS_RANGE.maximum}）`,
		minimum: DEEP_MAX_TOOL_CALLS_RANGE.minimum,
		maximum: DEEP_MAX_TOOL_CALLS_RANGE.maximum,
	},
	{
		key: "deepTimeoutMs",
		label: `深回合时长上限毫秒（${DEEP_TIMEOUT_MS_RANGE.minimum} 到 ${DEEP_TIMEOUT_MS_RANGE.maximum}）`,
		minimum: DEEP_TIMEOUT_MS_RANGE.minimum,
		maximum: DEEP_TIMEOUT_MS_RANGE.maximum,
	},
	{
		key: "deepContextTokenLimit",
		label: "深回合工具往返 token 上限（正整数）",
		minimum: DEEP_CONTEXT_TOKEN_MINIMUM,
	},
	{
		key: "deepRecentToolSteps",
		label: `深回合保留的最近工具步骤（${DEEP_RECENT_TOOL_STEPS_RANGE.minimum} 到 ${DEEP_RECENT_TOOL_STEPS_RANGE.maximum}）`,
		minimum: DEEP_RECENT_TOOL_STEPS_RANGE.minimum,
		maximum: DEEP_RECENT_TOOL_STEPS_RANGE.maximum,
	},
];

export interface HistoryOverrideFormDraft {
	readonly name: string;
	readonly strategy: BlockContextStrategy["kind"];
	readonly depth: string;
}

export interface HistoryPolicyFormDraft {
	readonly mode: HistoryBlockPolicyMode;
	readonly overrides: readonly HistoryOverrideFormDraft[];
}

export interface DirectorFormDraft {
	readonly mode: DirectorMode;
	readonly intensity: DirectorIntensity;
	readonly openingIntensity: DirectorIntensity;
	readonly numbers: Readonly<Record<DirectorNumberKey, string>>;
	/** 逗号分隔的状态路径；空表示不设置。 */
	readonly scenePath: string;
	readonly tensionPath: string;
}

export interface SettingsFormDraft {
	readonly cardName: string;
	readonly characterPrompt: string;
	readonly persona: string;
	readonly model: string;
	/** 空字符串表示内置默认模板。 */
	readonly templateId: string;
	readonly budgetTokens: string;
	readonly structuredOutput: StructuredOutputMode;
	readonly temperature: string;
	readonly maxTokens: string;
	readonly reasoning: LlmReasoningLevel;
	readonly turnMode: TurnMode;
	readonly maxReadRounds: string;
	readonly deep: Readonly<Record<DeepNumberKey, string>>;
	readonly viewpoint: string;
	readonly gapPassEnabled: boolean;
	readonly gapPlanSeconds: string;
	readonly image: ImageSettingsDraft;
	readonly director: DirectorFormDraft;
	readonly history: HistoryPolicyFormDraft;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
	cardName: "角色卡名称",
	characterPrompt: "角色卡提示词",
	persona: "玩家扮演",
	model: "故事模型",
	templateId: "上下文模板",
	budgetTokens: "上下文预算 token",
	structuredOutput: "结构化输出",
	temperature: "温度",
	maxTokens: "输出上限 token",
	reasoning: "思考档位",
	turnMode: "回合模式",
	maxReadRounds: "读取工具软上限",
	deepMaxToolCalls: "深回合工具调用上限",
	deepTimeoutMs: "深回合时长上限",
	deepContextTokenLimit: "深回合工具往返 token 上限",
	deepRecentToolSteps: "深回合保留的最近工具步骤",
	viewpoint: "知情者视角",
	gapPassEnabled: "间隙合并调用",
	gapPlanSeconds: "可延后任务的间隙秒数",
	directorConfig: "导演配置",
	historyBlockPolicy: "历史块策略",
};

/** 服务端错误路径转成表单上看得懂的名字。 */
export function describeSettingsPath(path: string): string {
	const [head, ...rest] = path.split(".");
	const label = FIELD_LABELS[head ?? ""] ?? head ?? path;
	if (head === "directorConfig" && rest.length > 0) {
		const key = rest.join(".");
		const field = DIRECTOR_NUMBER_FIELDS.find((item) => item.key === key);
		return `导演配置·${field?.label ?? key}`;
	}
	if (head === "historyBlockPolicy" && rest.length > 0) {
		return `历史块策略·${rest.join(".")}`;
	}
	if (head === "imageConfig") {
		return describeImageConfigPath(path);
	}
	return label;
}

function emptyDirectorNumbers(
	config: DirectorConfig,
): Record<DirectorNumberKey, string> {
	const numbers = {} as Record<DirectorNumberKey, string>;
	for (const key of DIRECTOR_NUMBER_KEYS) {
		numbers[key] = String(config[key]);
	}
	return numbers;
}

export function buildSettingsDraft(settings: StorySettings): SettingsFormDraft {
	const director = settings.directorConfig;
	return {
		cardName: settings.cardName ?? "",
		characterPrompt: settings.characterPrompt ?? "",
		persona: settings.persona ?? "",
		model: settings.model ?? "",
		templateId: settings.templateId ?? "",
		budgetTokens: String(settings.budgetTokens),
		structuredOutput: settings.structuredOutput,
		temperature: String(settings.temperature),
		maxTokens: String(settings.maxTokens),
		reasoning: settings.reasoning,
		turnMode: settings.turnMode,
		maxReadRounds: String(settings.maxReadRounds),
		deep: {
			deepMaxToolCalls: String(settings.deepMaxToolCalls),
			deepTimeoutMs: String(settings.deepTimeoutMs),
			deepContextTokenLimit: String(settings.deepContextTokenLimit),
			deepRecentToolSteps: String(settings.deepRecentToolSteps),
		},
		viewpoint: settings.viewpoint ?? "",
		gapPassEnabled: settings.gapPassEnabled,
		gapPlanSeconds: String(settings.gapPlanSeconds),
		image: buildImageSettingsDraft(settings.imageConfig),
		director: {
			mode: director.mode,
			intensity: director.intensity,
			openingIntensity: director.openingIntensity,
			numbers: emptyDirectorNumbers(director),
			scenePath:
				director.scenePath === undefined ? "" : director.scenePath.join("."),
			tensionPath:
				director.tensionPath === undefined
					? ""
					: director.tensionPath.join("."),
		},
		history: {
			mode: settings.historyBlockPolicy.mode,
			overrides: Object.entries(settings.historyBlockPolicy.overrides).map(
				([name, strategy]) => ({
					name,
					strategy: strategy.kind,
					depth: strategy.kind === "keep-depth" ? String(strategy.depth) : "",
				}),
			),
		},
	};
}

function nullableText(text: string): string | null {
	return text.trim().length === 0 ? null : text;
}

function parseInteger(
	text: string,
	path: string,
	minimum: number,
	errors: FormFieldError[],
	maximum?: number,
): number | null {
	const value = Number(text.trim());
	if (
		text.trim().length === 0 ||
		!Number.isInteger(value) ||
		value < minimum ||
		(maximum !== undefined && value > maximum)
	) {
		errors.push({
			path,
			message:
				maximum === undefined
					? `${describeSettingsPath(path)} 必须是不小于 ${minimum} 的整数`
					: `${describeSettingsPath(path)} 必须是 ${minimum} 到 ${maximum} 之间的整数`,
		});
		return null;
	}
	return value;
}

function parseNumber(
	text: string,
	path: string,
	minimum: number,
	maximum: number | undefined,
	errors: FormFieldError[],
	exclusiveMinimum = false,
): number | null {
	const value = Number(text.trim());
	if (
		text.trim().length === 0 ||
		!Number.isFinite(value) ||
		(exclusiveMinimum ? value <= minimum : value < minimum) ||
		(maximum !== undefined && value > maximum)
	) {
		errors.push({
			path,
			message: exclusiveMinimum
				? `${describeSettingsPath(path)} 必须大于 ${minimum}`
				: maximum === undefined
					? `${describeSettingsPath(path)} 必须是不小于 ${minimum} 的数字`
					: `${describeSettingsPath(path)} 必须是 ${minimum} 到 ${maximum} 之间的数字`,
		});
		return null;
	}
	return value;
}

function parseStatePath(
	text: string,
	path: string,
	errors: FormFieldError[],
): readonly string[] | undefined {
	if (text.trim().length === 0) return undefined;
	const segments = text.split(".").map((segment) => segment.trim());
	if (segments.some((segment) => segment.length === 0)) {
		errors.push({
			path,
			message: `${describeSettingsPath(path)} 必须用英文句点分隔且每一段都非空`,
		});
		return undefined;
	}
	return segments;
}

/**
 * 把表单草稿转成整份设置更新；有错误时返回全部错误，不发出请求。
 * 数值范围与 core 的 `assertStorySettingsUpdate`、`assertDirectorConfig` 一致。
 */
export function parseSettingsDraft(draft: SettingsFormDraft): {
	readonly update: StorySettingsUpdate;
	readonly errors: readonly FormFieldError[];
} {
	const errors: FormFieldError[] = [];
	const budgetTokens = parseInteger(
		draft.budgetTokens,
		"budgetTokens",
		0,
		errors,
	);
	const temperature = parseNumber(
		draft.temperature,
		"temperature",
		0,
		2,
		errors,
	);
	const maxTokens = parseInteger(draft.maxTokens, "maxTokens", 1, errors);
	const maxReadRounds = parseInteger(
		draft.maxReadRounds,
		"maxReadRounds",
		0,
		errors,
	);
	const deep = {} as Record<DeepNumberKey, number>;
	for (const field of DEEP_NUMBER_FIELDS) {
		const parsed = parseInteger(
			draft.deep[field.key],
			field.key,
			field.minimum,
			errors,
			field.maximum,
		);
		if (parsed !== null) deep[field.key] = parsed;
	}
	const gapPlanSeconds = parseInteger(
		draft.gapPlanSeconds,
		"gapPlanSeconds",
		0,
		errors,
	);
	const image = parseImageSettingsDraft(draft.image);
	errors.push(...image.errors);

	const numbers = {} as Record<DirectorNumberKey, number>;
	for (const field of DIRECTOR_NUMBER_FIELDS) {
		const path = `directorConfig.${field.key}`;
		const text = draft.director.numbers[field.key];
		const parsed = field.integer
			? parseInteger(text, path, field.minimum, errors)
			: parseNumber(
					text,
					path,
					field.minimum,
					field.maximum,
					errors,
					field.exclusiveMinimum === true,
				);
		if (parsed !== null) numbers[field.key] = parsed;
	}
	const scenePath = parseStatePath(
		draft.director.scenePath,
		"directorConfig.scenePath",
		errors,
	);
	const tensionPath = parseStatePath(
		draft.director.tensionPath,
		"directorConfig.tensionPath",
		errors,
	);

	if (
		numbers.tensionEscalate !== undefined &&
		numbers.tensionClimax !== undefined &&
		numbers.tensionEscalate >= numbers.tensionClimax
	) {
		errors.push({
			path: "directorConfig.tensionEscalate",
			message: "进入升级的张力必须小于进入高潮的张力",
		});
	}
	if (
		numbers.tensionStateWeight !== undefined &&
		numbers.tensionNoteWeight !== undefined &&
		numbers.tensionEventWeight !== undefined &&
		numbers.tensionStateWeight +
			numbers.tensionNoteWeight +
			numbers.tensionEventWeight <=
			0
	) {
		errors.push({
			path: "directorConfig.tensionStateWeight",
			message: "三个张力权重之和必须大于 0",
		});
	}

	const overrides: Record<string, HistoryBlockPolicy["overrides"][string]> = {};
	const seen = new Set<string>();
	draft.history.overrides.forEach((item, index) => {
		const name = item.name.trim();
		const path = `historyBlockPolicy.overrides[${index}]`;
		if (name.length === 0) {
			errors.push({ path, message: "块类型名不能为空" });
			return;
		}
		if (seen.has(name)) {
			errors.push({ path, message: `块类型 ${name} 出现了两次` });
			return;
		}
		seen.add(name);
		if (item.strategy === "compress") {
			errors.push({ path, message: "暂不支持压缩策略" });
			return;
		}
		if (item.strategy === "keep-depth") {
			const depth = parseInteger(item.depth, path, 1, errors);
			if (depth !== null) overrides[name] = { kind: "keep-depth", depth };
			return;
		}
		overrides[name] = { kind: item.strategy };
	});

	const directorConfig: DirectorConfig = {
		mode: draft.director.mode,
		intensity: draft.director.intensity,
		openingIntensity: draft.director.openingIntensity,
		...numbers,
		...(scenePath === undefined ? {} : { scenePath }),
		...(tensionPath === undefined ? {} : { tensionPath }),
	};

	const update: StorySettingsUpdate = {
		cardName: nullableText(draft.cardName),
		characterPrompt: nullableText(draft.characterPrompt),
		persona: nullableText(draft.persona),
		model: nullableText(draft.model),
		templateId: draft.templateId.length === 0 ? null : draft.templateId,
		budgetTokens: budgetTokens ?? 0,
		structuredOutput: draft.structuredOutput,
		temperature: temperature ?? 0,
		maxTokens: maxTokens ?? 1,
		reasoning: draft.reasoning,
		turnMode: draft.turnMode,
		maxReadRounds: maxReadRounds ?? 0,
		deepMaxToolCalls:
			deep.deepMaxToolCalls ?? DEEP_MAX_TOOL_CALLS_RANGE.minimum,
		deepTimeoutMs: deep.deepTimeoutMs ?? DEEP_TIMEOUT_MS_RANGE.minimum,
		deepContextTokenLimit:
			deep.deepContextTokenLimit ?? DEEP_CONTEXT_TOKEN_MINIMUM,
		deepRecentToolSteps:
			deep.deepRecentToolSteps ?? DEEP_RECENT_TOOL_STEPS_RANGE.minimum,
		viewpoint: nullableText(draft.viewpoint),
		gapPassEnabled: draft.gapPassEnabled,
		gapPlanSeconds: gapPlanSeconds ?? 0,
		imageConfig: image.config,
		directorConfig,
		historyBlockPolicy: { mode: draft.history.mode, overrides },
	};
	return { update, errors };
}

/** 服务端拒绝时把 `details.path` 与消息变成字段错误；非 ApiError 原样返回。 */
export function settingsErrorsFromFailure(
	error: unknown,
): readonly FormFieldError[] {
	if (error instanceof ApiError) {
		const details = error.body.details;
		const path =
			typeof details === "object" &&
			details !== null &&
			"path" in details &&
			typeof details.path === "string"
				? details.path
				: "";
		return [{ path, message: error.message }];
	}
	return [
		{
			path: "",
			message: error instanceof Error ? error.message : String(error),
		},
	];
}

/** 历史块策略预览：每一条覆盖写出来，顺序固定按块类型名。 */
export function describeHistoryPolicy(
	draft: HistoryPolicyFormDraft,
): readonly string[] {
	const rows = draft.overrides
		.filter((item) => item.name.trim().length > 0)
		.map((item) =>
			item.strategy === "keep-depth"
				? `${item.name.trim()}：保留到深度 ${item.depth || "?"}`
				: `${item.name.trim()}：${item.strategy === "keep" ? "保留" : "删除"}`,
		);
	return [
		`更早楼层：${draft.mode === "full" ? "保留完整原文" : "省略显示类块"}`,
		...rows,
	];
}

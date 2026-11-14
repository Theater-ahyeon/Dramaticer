import {
	DEFAULT_HISTORY_BLOCK_POLICY,
	type HistoryBlockPolicy,
	assertHistoryBlockPolicy,
} from "../blocks/history.js";
import {
	DEFAULT_DEEP_CONTEXT_TOKEN_LIMIT,
	DEFAULT_DEEP_MAX_TOOL_CALLS,
	DEFAULT_DEEP_RECENT_TOOL_STEPS,
	DEFAULT_DEEP_TIMEOUT_MS,
	DEFAULT_MAX_READ_ROUNDS,
	type TurnMode,
	assertDeepContextTokenLimit,
	assertDeepMaxToolCalls,
	assertDeepRecentToolSteps,
	assertDeepTimeoutMs,
	assertMaxReadRounds,
	isTurnMode,
} from "../chat/mode.js";
import {
	type ContextLayout,
	type ContextTemplate,
	assertContextLayout,
	assertContextTemplate,
} from "../context/template.js";
import { assertDirectorConfig } from "../director/evaluate.js";
import {
	DEFAULT_DIRECTOR_ORGANIZATION,
	type DirectorOrganizationKind,
	assertDirectorOrganizationKind,
} from "../director/organization.js";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorConfig,
} from "../director/types.js";
import {
	DEFAULT_IMAGE_CONFIG,
	type ImageConfig,
	assertImageConfig,
} from "../images/types.js";
import type { JsonObject } from "../json.js";
import { type LlmReasoningLevel, isLlmReasoningLevel } from "../llm/types.js";
import {
	EMPTY_PLAYPACK_USER_OVERRIDES,
	type PlaypackUserOverrides,
	parsePlaypackUserOverrides,
} from "../plugins/playpack-overrides.js";
import {
	type StructuredOutputMode,
	isStructuredOutputMode,
} from "../structured/types.js";
import type { TimelineNode } from "../timeline.js";
import {
	DEFAULT_WORLD_MODEL_KIND,
	type WorldModelKind,
	assertWorldModelKind,
} from "../world-model/types.js";

/** 每个故事独立保存的运行配置；字段与 `story_settings` 表一一对应。 */
export interface StorySettings {
	readonly storyId: string;
	readonly cardName: string | null;
	readonly characterPrompt: string | null;
	readonly persona: string | null;
	/** 为空或等于内置模板 id 时使用内置默认模板。 */
	readonly templateId: string | null;
	/** 模型别名；为空时使用渠道配置里的正文模型。 */
	readonly model: string | null;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
	readonly temperature: number;
	readonly maxTokens: number;
	readonly reasoning: LlmReasoningLevel;
	/** 故事锁定的回合模式；单轮参数可以覆盖。 */
	readonly turnMode: TurnMode;
	/** 快回合里读取工具的软上限。 */
	readonly maxReadRounds: number;
	/** 深回合的工具调用总次数上限。 */
	readonly deepMaxToolCalls: number;
	/** 深回合的运行时长上限（毫秒）。 */
	readonly deepTimeoutMs: number;
	/** 深回合每次请求前允许的工具消息 token 上限。 */
	readonly deepContextTokenLimit: number;
	/** 上下文卫生保留的最近工具步骤数。 */
	readonly deepRecentToolSteps: number;
	/** 知情者视角；为空表示全知。 */
	readonly viewpoint: string | null;
	readonly directorConfig: DirectorConfig;
	/** 导演的组织方式；默认沿用现有机制序列，对比实验按它切换候选。 */
	readonly directorOrganization: DirectorOrganizationKind;
	/** 历史槽位的块 prompt 视图策略。 */
	readonly historyBlockPolicy: HistoryBlockPolicy;
	/** 默认模板的段落排布；`full` 是 v4 之前的顺序，用于对照。 */
	readonly contextLayout: ContextLayout;
	/** 间隙里用一次合并调用代替几个独立后台任务；默认关闭。 */
	readonly gapPassEnabled: boolean;
	/** 执行可延后档后台任务所需的间隙秒数；默认 212。 */
	readonly gapPlanSeconds: number;
	/** 生图模式、workflow 与频率设置。 */
	readonly imageConfig: ImageConfig;
	/** 故事级插件开关与配置覆盖；同一故事的所有分支共享。 */
	readonly pluginOverrides: PlaypackUserOverrides;
	/** 世界模型的表示方式；默认台账，对比实验按它切换候选。 */
	readonly worldModel: WorldModelKind;
	readonly updatedAt: string;
}

export interface StorySettingsUpdate {
	readonly cardName?: string | null;
	readonly characterPrompt?: string | null;
	readonly persona?: string | null;
	readonly templateId?: string | null;
	readonly model?: string | null;
	readonly budgetTokens?: number;
	readonly structuredOutput?: StructuredOutputMode;
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly turnMode?: TurnMode;
	readonly maxReadRounds?: number;
	readonly deepMaxToolCalls?: number;
	readonly deepTimeoutMs?: number;
	readonly deepContextTokenLimit?: number;
	readonly deepRecentToolSteps?: number;
	readonly viewpoint?: string | null;
	readonly directorConfig?: DirectorConfig;
	readonly directorOrganization?: DirectorOrganizationKind;
	readonly historyBlockPolicy?: HistoryBlockPolicy;
	readonly contextLayout?: ContextLayout;
	readonly gapPassEnabled?: boolean;
	readonly gapPlanSeconds?: number;
	readonly imageConfig?: ImageConfig;
	readonly pluginOverrides?: PlaypackUserOverrides;
	readonly worldModel?: WorldModelKind;
}

export const STORY_SETTINGS_UPDATE_KEYS: readonly (keyof StorySettingsUpdate)[] =
	[
		"cardName",
		"characterPrompt",
		"persona",
		"templateId",
		"model",
		"budgetTokens",
		"structuredOutput",
		"temperature",
		"maxTokens",
		"reasoning",
		"turnMode",
		"maxReadRounds",
		"deepMaxToolCalls",
		"deepTimeoutMs",
		"deepContextTokenLimit",
		"deepRecentToolSteps",
		"viewpoint",
		"directorConfig",
		"directorOrganization",
		"historyBlockPolicy",
		"contextLayout",
		"gapPassEnabled",
		"gapPlanSeconds",
		"imageConfig",
		"pluginOverrides",
		"worldModel",
	];

/** 尚未保存设置时使用的数值与枚举；故事 id 与更新时间由调用方补齐。 */
export const DEFAULT_STORY_SETTINGS_VALUES = {
	budgetTokens: 12_000,
	structuredOutput: "text-tags",
	temperature: 0.8,
	maxTokens: 4_096,
	reasoning: "low",
	turnMode: "fast",
	maxReadRounds: DEFAULT_MAX_READ_ROUNDS,
	deepMaxToolCalls: DEFAULT_DEEP_MAX_TOOL_CALLS,
	deepTimeoutMs: DEFAULT_DEEP_TIMEOUT_MS,
	deepContextTokenLimit: DEFAULT_DEEP_CONTEXT_TOKEN_LIMIT,
	deepRecentToolSteps: DEFAULT_DEEP_RECENT_TOOL_STEPS,
	directorConfig: DEFAULT_DIRECTOR_CONFIG,
	directorOrganization: DEFAULT_DIRECTOR_ORGANIZATION,
	historyBlockPolicy: DEFAULT_HISTORY_BLOCK_POLICY,
	contextLayout: "volatility",
	gapPassEnabled: false,
	gapPlanSeconds: 212,
	imageConfig: DEFAULT_IMAGE_CONFIG,
	pluginOverrides: EMPTY_PLAYPACK_USER_OVERRIDES,
	worldModel: DEFAULT_WORLD_MODEL_KIND,
} as const;

export interface ContextTemplateRecord {
	readonly id: string;
	readonly name: string;
	readonly template: ContextTemplate;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface CreateContextTemplateInput {
	readonly name: string;
	readonly template: ContextTemplate;
}

export interface UpdateContextTemplateInput {
	readonly name?: string;
	readonly template?: ContextTemplate;
}

/** 开局包：故事级记录，只作导演输入，不写台账。 */
export interface OpeningPackRecord {
	readonly storyId: string;
	readonly payload: JsonObject;
	/** 生成时的输入摘要；输入变化后重新生成。 */
	readonly inputHash: string;
	/** 生成时使用的首条玩家消息楼层；首次输入之前为 null。 */
	readonly sourceNodeId: string | null;
	readonly createdAt: string;
}

export interface SaveOpeningPackInput {
	readonly storyId: string;
	readonly payload: JsonObject;
	readonly inputHash: string;
	readonly sourceNodeId: string | null;
	readonly createdAt?: string;
}

export const OPENING_CANDIDATE_STATUSES = [
	"pending",
	"chosen",
	"discarded",
] as const;

export type OpeningCandidateStatus =
	(typeof OPENING_CANDIDATE_STATUSES)[number];

export function isOpeningCandidateStatus(
	value: unknown,
): value is OpeningCandidateStatus {
	return (
		typeof value === "string" &&
		(OPENING_CANDIDATE_STATUSES as readonly string[]).includes(value)
	);
}

/** 开场候选：一段完整正文，选中之前不是楼层，也不进入上下文。 */
export interface OpeningCandidateRecord {
	readonly id: string;
	readonly storyId: string;
	/** 故事内的追加顺序；每批新候选接着上一批编号。 */
	readonly ordinal: number;
	readonly raw: string;
	readonly status: OpeningCandidateStatus;
	readonly createdAt: string;
}

export interface AppendOpeningCandidatesInput {
	readonly storyId: string;
	/** 一批候选的完整正文，按给定顺序编号。 */
	readonly raws: readonly string[];
	readonly createdAt?: string;
}

export interface ListOpeningCandidatesOptions {
	readonly status?: OpeningCandidateStatus;
}

/** 选中一条候选后的结果：候选状态已改为 chosen，其余待选候选被丢弃。 */
export interface ChooseOpeningCandidateResult {
	readonly candidate: OpeningCandidateRecord;
	readonly node: TimelineNode;
}

export const CONTEXT_TEMPLATE_UPDATE_KEYS: readonly (keyof UpdateContextTemplateInput)[] =
	["name", "template"];

export const DIRECTOR_CONFIG_KEYS: readonly (keyof DirectorConfig)[] = [
	"mode",
	"clueAgeWarning",
	"maxOpenClues",
	"stallFloors",
	"surprise",
	"similarityThreshold",
	"similarityWindow",
	"similarityStep",
	"similarityRiseWindows",
	"similarityRiseDelta",
	"similarityRiseMinimum",
	"scenePath",
	"sceneRepeatThreshold",
	"tensionPath",
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
	"openingIntensity",
	"intensity",
];

function assertNullableText(value: unknown, label: string): void {
	if (value === null) return;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串或 null`);
	}
}

/** 解析故事设置里的插件开关与配置覆盖；省略或空对象都返回空覆盖。 */
export function parseStoryPluginOverrides(
	value: unknown,
): PlaypackUserOverrides {
	return parsePlaypackUserOverrides(value, "故事设置的 pluginOverrides");
}

/** 校验故事设置的更新内容；只检查出现过的字段。 */
export function assertStorySettingsUpdate(update: StorySettingsUpdate): void {
	if (typeof update !== "object" || update === null) {
		throw new Error("故事设置更新必须是对象");
	}
	if (update.cardName !== undefined) {
		assertNullableText(update.cardName, "故事设置的 cardName");
	}
	if (update.characterPrompt !== undefined) {
		assertNullableText(update.characterPrompt, "故事设置的 characterPrompt");
	}
	if (update.persona !== undefined) {
		assertNullableText(update.persona, "故事设置的 persona");
	}
	if (update.templateId !== undefined) {
		assertNullableText(update.templateId, "故事设置的 templateId");
	}
	if (update.model !== undefined) {
		assertNullableText(update.model, "故事设置的 model");
	}
	if (update.viewpoint !== undefined) {
		assertNullableText(update.viewpoint, "故事设置的 viewpoint");
	}
	if (update.budgetTokens !== undefined) {
		if (!Number.isInteger(update.budgetTokens) || update.budgetTokens < 0) {
			throw new Error("故事设置的 budgetTokens 必须是非负整数");
		}
	}
	if (update.maxTokens !== undefined) {
		if (!Number.isInteger(update.maxTokens) || update.maxTokens < 1) {
			throw new Error("故事设置的 maxTokens 必须是正整数");
		}
	}
	if (update.temperature !== undefined) {
		if (
			typeof update.temperature !== "number" ||
			!Number.isFinite(update.temperature) ||
			update.temperature < 0 ||
			update.temperature > 2
		) {
			throw new Error("故事设置的 temperature 必须是 0 到 2 之间的数字");
		}
	}
	if (
		update.structuredOutput !== undefined &&
		!isStructuredOutputMode(update.structuredOutput)
	) {
		throw new Error(
			`故事设置的 structuredOutput 不合法：${String(update.structuredOutput)}`,
		);
	}
	if (
		update.reasoning !== undefined &&
		!isLlmReasoningLevel(update.reasoning)
	) {
		throw new Error(`故事设置的 reasoning 不合法：${String(update.reasoning)}`);
	}
	if (update.turnMode !== undefined && !isTurnMode(update.turnMode)) {
		throw new Error(`故事设置的 turnMode 不合法：${String(update.turnMode)}`);
	}
	if (update.maxReadRounds !== undefined) {
		assertMaxReadRounds(update.maxReadRounds, "故事设置的 maxReadRounds");
	}
	if (update.deepMaxToolCalls !== undefined) {
		assertDeepMaxToolCalls(
			update.deepMaxToolCalls,
			"故事设置的 deepMaxToolCalls",
		);
	}
	if (update.deepTimeoutMs !== undefined) {
		assertDeepTimeoutMs(update.deepTimeoutMs, "故事设置的 deepTimeoutMs");
	}
	if (update.deepContextTokenLimit !== undefined) {
		assertDeepContextTokenLimit(
			update.deepContextTokenLimit,
			"故事设置的 deepContextTokenLimit",
		);
	}
	if (update.deepRecentToolSteps !== undefined) {
		assertDeepRecentToolSteps(
			update.deepRecentToolSteps,
			"故事设置的 deepRecentToolSteps",
		);
	}
	if (update.directorConfig !== undefined) {
		assertDirectorConfig(update.directorConfig);
	}
	if (update.directorOrganization !== undefined) {
		assertDirectorOrganizationKind(
			update.directorOrganization,
			"故事设置的 directorOrganization",
		);
	}
	if (update.historyBlockPolicy !== undefined) {
		assertHistoryBlockPolicy(
			update.historyBlockPolicy,
			"故事设置的 historyBlockPolicy",
		);
	}
	if (update.contextLayout !== undefined) {
		assertContextLayout(update.contextLayout, "故事设置的 contextLayout");
	}
	if (
		update.gapPassEnabled !== undefined &&
		typeof update.gapPassEnabled !== "boolean"
	) {
		throw new Error("故事设置的 gapPassEnabled 必须是布尔值");
	}
	if (update.gapPlanSeconds !== undefined) {
		if (!Number.isInteger(update.gapPlanSeconds) || update.gapPlanSeconds < 0) {
			throw new Error("故事设置的 gapPlanSeconds 必须是非负整数");
		}
	}
	if (update.imageConfig !== undefined) {
		assertImageConfig(update.imageConfig);
	}
	if (update.pluginOverrides !== undefined) {
		parseStoryPluginOverrides(update.pluginOverrides);
	}
	if (update.worldModel !== undefined) {
		assertWorldModelKind(update.worldModel, "故事设置的 worldModel");
	}
}

/** 模板必须是结构完整的非空模板，空模板无法产生任何消息。 */
export function assertStoredContextTemplate(template: ContextTemplate): void {
	assertContextTemplate(template);
	if (template.segments.length === 0) {
		throw new Error(`上下文模板 ${template.id} 至少需要一个片段`);
	}
}

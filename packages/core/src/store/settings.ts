import {
	DEFAULT_HISTORY_BLOCK_POLICY,
	type HistoryBlockPolicy,
	assertHistoryBlockPolicy,
} from "../blocks/history.js";
import {
	type ContextTemplate,
	assertContextTemplate,
} from "../context/template.js";
import { assertDirectorConfig } from "../director/evaluate.js";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorConfig,
} from "../director/types.js";
import { type LlmReasoningLevel, isLlmReasoningLevel } from "../llm/types.js";
import {
	type StructuredOutputMode,
	isStructuredOutputMode,
} from "../structured/types.js";

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
	/** 知情者视角；为空表示全知。 */
	readonly viewpoint: string | null;
	readonly directorConfig: DirectorConfig;
	/** 历史槽位的块 prompt 视图策略。 */
	readonly historyBlockPolicy: HistoryBlockPolicy;
	/** 间隙里用一次合并调用代替几个独立后台任务；默认关闭。 */
	readonly gapPassEnabled: boolean;
	/** 执行可延后档后台任务所需的间隙秒数；默认 212。 */
	readonly gapPlanSeconds: number;
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
	readonly viewpoint?: string | null;
	readonly directorConfig?: DirectorConfig;
	readonly historyBlockPolicy?: HistoryBlockPolicy;
	readonly gapPassEnabled?: boolean;
	readonly gapPlanSeconds?: number;
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
		"viewpoint",
		"directorConfig",
		"historyBlockPolicy",
		"gapPassEnabled",
		"gapPlanSeconds",
	];

/** 尚未保存设置时使用的数值与枚举；故事 id 与更新时间由调用方补齐。 */
export const DEFAULT_STORY_SETTINGS_VALUES = {
	budgetTokens: 12_000,
	structuredOutput: "text-tags",
	temperature: 0.8,
	maxTokens: 4_096,
	reasoning: "low",
	directorConfig: DEFAULT_DIRECTOR_CONFIG,
	historyBlockPolicy: DEFAULT_HISTORY_BLOCK_POLICY,
	gapPassEnabled: false,
	gapPlanSeconds: 212,
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

export const CONTEXT_TEMPLATE_UPDATE_KEYS: readonly (keyof UpdateContextTemplateInput)[] =
	["name", "template"];

export const DIRECTOR_CONFIG_KEYS: readonly (keyof DirectorConfig)[] = [
	"enabled",
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
];

function assertNullableText(value: unknown, label: string): void {
	if (value === null) return;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串或 null`);
	}
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
	if (update.directorConfig !== undefined) {
		assertDirectorConfig(update.directorConfig);
	}
	if (update.historyBlockPolicy !== undefined) {
		assertHistoryBlockPolicy(
			update.historyBlockPolicy,
			"故事设置的 historyBlockPolicy",
		);
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
}

/** 模板必须是结构完整的非空模板，空模板无法产生任何消息。 */
export function assertStoredContextTemplate(template: ContextTemplate): void {
	assertContextTemplate(template);
	if (template.segments.length === 0) {
		throw new Error(`上下文模板 ${template.id} 至少需要一个片段`);
	}
}

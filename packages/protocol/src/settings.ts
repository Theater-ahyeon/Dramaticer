import type {
	ContextTemplate,
	DirectorConfig,
	LlmReasoningLevel,
	StructuredOutputMode,
} from "@dramaticer/core";

/** 每个故事独立保存的运行配置；字段与 `story_settings` 表一一对应。 */
export interface StorySettings {
	readonly storyId: string;
	readonly cardName: string | null;
	readonly characterPrompt: string | null;
	readonly persona: string | null;
	/** 为空时使用内置默认模板。 */
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
}

export interface ContextTemplateRecord {
	readonly id: string;
	readonly name: string;
	readonly template: ContextTemplate;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface CreateContextTemplateRequest {
	readonly name: string;
	readonly template: ContextTemplate;
}

export interface UpdateContextTemplateRequest {
	readonly name?: string;
	readonly template?: ContextTemplate;
}

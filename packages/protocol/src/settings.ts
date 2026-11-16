import type { ContextStaticSegment, ContextTemplate } from "@dramaticer/core";

export type {
	ContextTemplateRecord,
	CreateContextTemplateInput as CreateContextTemplateRequest,
	StorySettings,
	StorySettingsUpdate,
	UpdateContextTemplateInput as UpdateContextTemplateRequest,
} from "@dramaticer/core";

export type {
	FeatureSwitchChoice as StoryFeatureSwitchChoice,
	FeatureSwitchGroup,
	FeatureTier,
	StoryFeatureGroupView,
	StoryFeatureSwitchView,
	StoryFeatureView,
} from "@dramaticer/core";

/**
 * `GET /api/stories/:id/template` 的响应：故事实际使用的模板。
 * `source` 为 `default` 时 `templateId` 为 null，模板是内置默认模板。
 */
export interface StoryTemplateView {
	readonly storyId: string;
	readonly templateId: string | null;
	readonly source: "default" | "stored";
	readonly template: ContextTemplate;
	/** 当前 `structuredOutput` 对应的 `block_format` 段，界面用它增删该段。 */
	readonly blockFormatSegment: ContextStaticSegment;
}

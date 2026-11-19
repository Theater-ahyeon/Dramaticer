import { createHash } from "node:crypto";
import { type JsonValue, isJsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type FeatureSwitchOverrides,
	type FeatureTier,
	isFeatureTier,
	sanitizeFeatureSwitchOverrides,
} from "./features.js";
import {
	WRITING_MODE_KEY,
	type WritingDials,
	type WritingView,
	readWritingView,
	sanitizeWritingDials,
	saveRecommendedWriting,
	writeWritingOverrides,
} from "./writing.js";

/** 卡的推荐里能写的三种写法；规划写法在存储层是快速回合加准备阶段。 */
export const CARD_WRITING_MODES = ["fast", "plan", "deep"] as const;

export type CardWritingMode = (typeof CARD_WRITING_MODES)[number];

/** 卡的 `extensions.dramaticer.config`：载入时应用，玩家的调整叠在上面。 */
export interface CardRecommendedConfig {
	readonly writing: Partial<WritingDials>;
	readonly mode: CardWritingMode | null;
	readonly featureTier: FeatureTier | null;
	readonly featureSwitches: FeatureSwitchOverrides;
}

const CARD_RECOMMENDED_KEY = "card.recommended";
const STORY_CARD_KEY = "card";

function isCardWritingMode(value: unknown): value is CardWritingMode {
	return (
		typeof value === "string" &&
		(CARD_WRITING_MODES as readonly string[]).includes(value)
	);
}

/**
 * 解析卡带的推荐配置。卡作者写错的项直接跳过，导入不能因为推荐值失败；
 * 未出现的项表示卡对这项没有意见。
 */
export function parseCardRecommendedConfig(
	value: unknown,
): CardRecommendedConfig {
	const root = isJsonObject(value) ? value : {};
	const features = isJsonObject(root.features) ? root.features : {};
	return {
		writing: sanitizeWritingDials(root.writing),
		mode: isCardWritingMode(root.turnMode) ? root.turnMode : null,
		featureTier: isFeatureTier(features.tier) ? features.tier : null,
		featureSwitches: sanitizeFeatureSwitchOverrides(features.switches),
	};
}

/** 保存卡的推荐；写作选项单独存放，读写作视图时已经叠好。 */
export function saveCardRecommendedConfig(
	store: StoryStore,
	storyId: string,
	value: unknown,
): CardRecommendedConfig {
	const config = parseCardRecommendedConfig(value);
	saveRecommendedWriting(store, storyId, config.writing);
	const hasSettings =
		config.mode !== null ||
		config.featureTier !== null ||
		Object.keys(config.featureSwitches).length > 0;
	store.setStoryValue(
		storyId,
		CARD_RECOMMENDED_KEY,
		hasSettings
			? ({
					mode: config.mode,
					featureTier: config.featureTier,
					featureSwitches: config.featureSwitches,
				} as unknown as JsonValue)
			: null,
	);
	return config;
}

/** 卡对写法与开关的推荐；卡没带任何推荐时返回 null。 */
export function readCardRecommendedConfig(
	store: StoryStore,
	storyId: string,
): CardRecommendedConfig | null {
	const raw = store.getStoryValue(storyId, CARD_RECOMMENDED_KEY);
	const writing = readWritingView(store, storyId).recommended ?? {};
	if (raw === null && Object.keys(writing).length === 0) return null;
	const stored = isJsonObject(raw) ? raw : {};
	const switches = sanitizeFeatureSwitchOverrides(stored.featureSwitches);
	return {
		writing,
		mode: isCardWritingMode(stored.mode) ? stored.mode : null,
		featureTier: isFeatureTier(stored.featureTier) ? stored.featureTier : null,
		featureSwitches: switches,
	};
}

function applyWritingMode(
	store: StoryStore,
	storyId: string,
	mode: CardWritingMode,
): void {
	if (mode === "plan") {
		store.setStoryValue(storyId, WRITING_MODE_KEY, "plan");
		store.updateStorySettings(storyId, { turnMode: "fast" });
		return;
	}
	store.setStoryValue(storyId, WRITING_MODE_KEY, null);
	store.updateStorySettings(storyId, { turnMode: mode });
}

function applyRecommendedSettings(
	store: StoryStore,
	storyId: string,
	config: CardRecommendedConfig,
): void {
	if (config.mode !== null) {
		applyWritingMode(store, storyId, config.mode);
	}
	if (
		config.featureTier !== null ||
		Object.keys(config.featureSwitches).length > 0
	) {
		store.updateStorySettings(storyId, {
			...(config.featureTier === null
				? {}
				: { featureTier: config.featureTier }),
			featureSwitches: config.featureSwitches,
		});
	}
}

/**
 * 载入卡时应用推荐。升级时只更新推荐（`applySettings: false`），
 * 玩家已经选好的写法与开关不被覆盖。
 */
export function applyCardRecommendedConfig(
	store: StoryStore,
	storyId: string,
	value: unknown,
	options: { readonly applySettings?: boolean } = {},
): CardRecommendedConfig {
	const config = saveCardRecommendedConfig(store, storyId, value);
	if (options.applySettings !== false) {
		applyRecommendedSettings(store, storyId, config);
	}
	return config;
}

/**
 * 一键回到卡的推荐：清掉写作选项上的调整，写法与功能开关换成卡的推荐。
 * 卡没有推荐的项保持玩家现在的值。
 */
export function resetToCardRecommended(
	store: StoryStore,
	storyId: string,
): WritingView {
	const config = readCardRecommendedConfig(store, storyId);
	if (config !== null) applyRecommendedSettings(store, storyId, config);
	return writeWritingOverrides(store, storyId, null);
}

/** 故事固定的卡版本；卡库更新不会改它，只有玩家选择升级才换。 */
export interface StoryCardSnapshot {
	readonly name: string;
	readonly version: string;
	readonly importedAt: string;
	readonly recommendedMode: CardWritingMode | null;
}

export function readStoryCardSnapshot(
	store: StoryStore,
	storyId: string,
): StoryCardSnapshot | null {
	const raw = store.getStoryValue(storyId, STORY_CARD_KEY);
	if (!isJsonObject(raw)) return null;
	if (typeof raw.version !== "string" || raw.version.length === 0) return null;
	return {
		name: typeof raw.name === "string" ? raw.name : "",
		version: raw.version,
		importedAt: typeof raw.importedAt === "string" ? raw.importedAt : "",
		recommendedMode: isCardWritingMode(raw.recommendedMode)
			? raw.recommendedMode
			: null,
	};
}

export function saveStoryCardSnapshot(
	store: StoryStore,
	storyId: string,
	input: {
		readonly name: string;
		readonly version: string;
		readonly recommendedMode: CardWritingMode | null;
	},
): StoryCardSnapshot {
	const snapshot: StoryCardSnapshot = {
		name: input.name,
		version: input.version,
		importedAt: new Date().toISOString(),
		recommendedMode: input.recommendedMode,
	};
	store.setStoryValue(
		storyId,
		STORY_CARD_KEY,
		snapshot as unknown as JsonValue,
	);
	return snapshot;
}

/** 卡片内容的版本号；同一个文件得到同一个版本。 */
export function storyCardVersion(data: string): string {
	return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

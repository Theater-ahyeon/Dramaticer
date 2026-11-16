import { assertPlainObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";

/** 档位：一键把全部开关换成一组默认值（DESIGN §22）。 */
export const FEATURE_TIERS = ["lite", "standard", "immersive"] as const;

export type FeatureTier = (typeof FEATURE_TIERS)[number];

export const FEATURE_TIER_LABELS: Readonly<Record<FeatureTier, string>> = {
	lite: "轻量",
	standard: "标准",
	immersive: "沉浸",
};

export const DEFAULT_FEATURE_TIER: FeatureTier = "standard";

export function isFeatureTier(value: unknown): value is FeatureTier {
	return (
		typeof value === "string" &&
		(FEATURE_TIERS as readonly string[]).includes(value)
	);
}

export function assertFeatureTier(
	value: unknown,
	label = "开关档位",
): FeatureTier {
	if (!isFeatureTier(value)) {
		throw new Error(
			`${label}必须是 ${FEATURE_TIERS.join("、")} 之一，实际为 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

/** 开关按玩家能感知的效果分组。 */
export const FEATURE_SWITCH_GROUPS = [
	"memory",
	"director",
	"presentation",
	"compat",
] as const;

export type FeatureSwitchGroup = (typeof FEATURE_SWITCH_GROUPS)[number];

export const FEATURE_SWITCH_GROUP_LABELS: Readonly<
	Record<FeatureSwitchGroup, string>
> = {
	memory: "记忆",
	director: "导演",
	presentation: "表现",
	compat: "模型与兼容",
};

/** 卡的能力；卡里没有的能力不显示对应开关。 */
export const FEATURE_CAPABILITIES = [
	"entities",
	"rules",
	"state",
	"writing",
	"presentation",
	"importedContent",
] as const;

export type FeatureCapability = (typeof FEATURE_CAPABILITIES)[number];

export type FeatureCapabilities = Readonly<Record<FeatureCapability, boolean>>;

export const NO_FEATURE_CAPABILITIES: FeatureCapabilities = Object.freeze({
	entities: false,
	rules: false,
	state: false,
	writing: false,
	presentation: false,
	importedContent: false,
});

export type FeatureDirectorValue = "off" | "push" | "always";
export type FeatureDrawValue = "off" | "manual" | "chapter" | "model";
export type FeatureThinkValue = "off" | "low" | "high";

/** 每个开关的取值；新增开关时同步这里与目录。 */
export interface FeatureSwitchValueMap {
	readonly scribe: boolean;
	readonly archive: boolean;
	readonly reunion: boolean;
	readonly search: boolean;
	readonly director: FeatureDirectorValue;
	readonly knows: boolean;
	readonly promiseLimit: number;
	readonly rules: boolean;
	readonly status: boolean;
	readonly choices: boolean;
	readonly draw: FeatureDrawValue;
	readonly bgm: boolean;
	readonly think: FeatureThinkValue;
	readonly tools: boolean;
	readonly style: boolean;
	readonly raw: boolean;
}

export type FeatureSwitchId = keyof FeatureSwitchValueMap;

export type FeatureSwitchValue = FeatureSwitchValueMap[FeatureSwitchId];

export type FeatureSwitchState = Readonly<FeatureSwitchValueMap>;

/** 故事级或单轮的局部覆盖；没有出现的开关沿用档位默认值。 */
export type FeatureSwitchOverrides = Partial<FeatureSwitchValueMap>;

export const EMPTY_FEATURE_SWITCH_OVERRIDES: FeatureSwitchOverrides =
	Object.freeze({});

export interface FeatureSwitchChoice {
	readonly value: string;
	readonly label: string;
}

export interface FeatureSwitchDefinition {
	readonly id: FeatureSwitchId;
	readonly group: FeatureSwitchGroup;
	readonly label: string;
	/** 页面上的一句话说明。 */
	readonly description: string;
	/** 为 null 表示任何卡都能用；否则卡里没有这项能力时不显示。 */
	readonly capability: FeatureCapability | null;
	readonly kind: "toggle" | "choice" | "number";
	/** 只有 choice 有；顺序就是界面顺序。 */
	readonly choices: readonly FeatureSwitchChoice[];
	readonly minimum: number | null;
	readonly maximum: number | null;
	readonly tierValues: Readonly<Record<FeatureTier, FeatureSwitchValue>>;
	/** 能力缺失时使用的值，同时也是这个开关的关闭值。 */
	readonly disabledValue: FeatureSwitchValue;
}

function defineSwitch<K extends FeatureSwitchId>(definition: {
	readonly id: K;
	readonly group: FeatureSwitchGroup;
	readonly label: string;
	readonly description: string;
	readonly capability: FeatureCapability | null;
	readonly kind: "toggle" | "choice" | "number";
	readonly choices?: readonly FeatureSwitchChoice[];
	readonly minimum?: number;
	readonly maximum?: number;
	readonly tierValues: Readonly<Record<FeatureTier, FeatureSwitchValueMap[K]>>;
	readonly disabledValue: FeatureSwitchValueMap[K];
}): FeatureSwitchDefinition {
	return {
		...definition,
		choices: definition.choices ?? [],
		minimum: definition.minimum ?? null,
		maximum: definition.maximum ?? null,
	};
}

export const FEATURE_SWITCHES: readonly FeatureSwitchDefinition[] = [
	defineSwitch({
		id: "scribe",
		group: "memory",
		label: "场记",
		description: "每楼写完后记下状态变化、在场者和这一楼的节拍",
		capability: null,
		kind: "toggle",
		tierValues: { lite: false, standard: true, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "archive",
		group: "memory",
		label: "档案归档",
		description: "一场戏结束时写一份摘要，更新人物档案",
		capability: "entities",
		kind: "toggle",
		tierValues: { lite: false, standard: true, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "reunion",
		group: "memory",
		label: "重逢注入",
		description: "久未出场的人物再次登场时，自动带上他的档案",
		capability: "entities",
		kind: "toggle",
		tierValues: { lite: false, standard: true, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "search",
		group: "memory",
		label: "全文检索",
		description: "在全部楼层里查找相关段落，作为记忆的补充",
		capability: "importedContent",
		kind: "toggle",
		tierValues: { lite: false, standard: false, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "director",
		group: "director",
		label: "导演",
		description: "你按推进时，从剧情线里挑一个具体的下一步",
		capability: null,
		kind: "choice",
		choices: [
			{ value: "off", label: "关" },
			{ value: "push", label: "仅推进时" },
			{ value: "always", label: "始终" },
		],
		// 默认只在玩家交出方向时出手；「始终」要玩家自己打开。
		tierValues: { lite: "push", standard: "push", immersive: "push" },
		disabledValue: "off",
	}),
	defineSwitch({
		id: "knows",
		group: "director",
		label: "知情标注",
		description: "提醒模型谁不在场、谁不知情",
		capability: "entities",
		kind: "toggle",
		tierValues: { lite: false, standard: true, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "promiseLimit",
		group: "director",
		label: "伏笔上限",
		description: "未兑现的伏笔最多留几条，满了就不再新建",
		capability: null,
		kind: "number",
		minimum: 1,
		maximum: 20,
		tierValues: { lite: 3, standard: 5, immersive: 8 },
		disabledValue: 1,
	}),
	defineSwitch({
		id: "rules",
		group: "director",
		label: "规则执行",
		description: "卡里声明了检定与资源时，由程序计算",
		capability: "rules",
		kind: "toggle",
		tierValues: { lite: false, standard: true, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "status",
		group: "presentation",
		label: "状态面板",
		description: "由程序根据状态绘制，不让模型输出",
		capability: "state",
		kind: "toggle",
		tierValues: { lite: true, standard: true, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "choices",
		group: "presentation",
		label: "行动选项",
		description: "每轮备好三四个可点的行动",
		capability: null,
		kind: "toggle",
		tierValues: { lite: false, standard: true, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "draw",
		group: "presentation",
		label: "出图",
		description: "按设置生成插图，数量由剧情决定",
		capability: null,
		kind: "choice",
		choices: [
			{ value: "off", label: "关闭" },
			{ value: "manual", label: "手动" },
			{ value: "chapter", label: "按章提名" },
			{ value: "model", label: "模型主动" },
		],
		tierValues: { lite: "off", standard: "off", immersive: "chapter" },
		disabledValue: "off",
	}),
	defineSwitch({
		id: "bgm",
		group: "presentation",
		label: "背景音乐",
		description: "按场景从卡的配乐表里匹配",
		capability: "presentation",
		kind: "toggle",
		tierValues: { lite: false, standard: false, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "think",
		group: "compat",
		label: "思考档位",
		description: "写之前多想一会，延迟更长",
		capability: null,
		kind: "choice",
		choices: [
			{ value: "off", label: "关闭" },
			{ value: "low", label: "低" },
			{ value: "high", label: "高" },
		],
		tierValues: { lite: "off", standard: "low", immersive: "high" },
		disabledValue: "off",
	}),
	defineSwitch({
		id: "tools",
		group: "compat",
		label: "工具查阅",
		description: "设定库很大时让模型自己查一条设定",
		capability: null,
		kind: "toggle",
		tierValues: { lite: false, standard: false, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "style",
		group: "compat",
		label: "写作指令层",
		description: "卡自带的文风与格式要求",
		capability: "writing",
		kind: "toggle",
		tierValues: { lite: true, standard: true, immersive: true },
		disabledValue: false,
	}),
	defineSwitch({
		id: "raw",
		group: "compat",
		label: "原样兼容",
		description: "照酒馆的方式执行卡里的脚本与正则",
		capability: "importedContent",
		kind: "toggle",
		tierValues: { lite: false, standard: false, immersive: false },
		disabledValue: false,
	}),
];

const FEATURE_SWITCH_BY_ID: ReadonlyMap<
	FeatureSwitchId,
	FeatureSwitchDefinition
> = new Map(FEATURE_SWITCHES.map((definition) => [definition.id, definition]));

export function getFeatureSwitch(id: FeatureSwitchId): FeatureSwitchDefinition {
	const definition = FEATURE_SWITCH_BY_ID.get(id);
	if (definition === undefined) {
		throw new Error(`没有这个功能开关：${id}`);
	}
	return definition;
}

export function isFeatureSwitchId(value: unknown): value is FeatureSwitchId {
	return (
		typeof value === "string" &&
		FEATURE_SWITCH_BY_ID.has(value as FeatureSwitchId)
	);
}

/** 校验一条覆盖值；错误信息带上开关 id，服务端据此返回字段路径。 */
function assertFeatureSwitchValue(
	definition: FeatureSwitchDefinition,
	value: unknown,
	path: string,
): FeatureSwitchValue {
	switch (definition.kind) {
		case "toggle":
			if (typeof value !== "boolean") {
				throw new Error(
					`${path} 必须是布尔值，实际为 ${JSON.stringify(value)}`,
				);
			}
			return value;
		case "choice": {
			const allowed = definition.choices.map((choice) => choice.value);
			if (typeof value !== "string" || !allowed.includes(value)) {
				throw new Error(
					`${path} 必须是 ${allowed.join("、")} 之一，实际为 ${JSON.stringify(value)}`,
				);
			}
			// 目录里的选项值与开关的取值类型一一对应。
			return value as FeatureSwitchValue;
		}
		case "number": {
			const { minimum, maximum } = definition;
			if (minimum === null || maximum === null) {
				throw new Error(`开关 ${definition.id} 缺少数值范围`);
			}
			if (
				typeof value !== "number" ||
				!Number.isInteger(value) ||
				value < minimum ||
				value > maximum
			) {
				throw new Error(
					`${path} 必须是 ${minimum} 到 ${maximum} 之间的整数，实际为 ${JSON.stringify(value)}`,
				);
			}
			return value;
		}
	}
}

/** 解析并校验一份部分覆盖表；未出现的开关不进入结果。 */
export function assertFeatureSwitchOverrides(
	value: unknown,
	label = "功能开关覆盖",
): FeatureSwitchOverrides {
	const object = assertPlainObject(value, label);
	const overrides: Partial<Record<FeatureSwitchId, FeatureSwitchValue>> = {};
	for (const [id, raw] of Object.entries(object)) {
		if (!isFeatureSwitchId(id)) {
			throw new Error(`${label}.${id} 不是已知的功能开关`);
		}
		const definition = getFeatureSwitch(id);
		overrides[id] = assertFeatureSwitchValue(definition, raw, `${label}.${id}`);
	}
	return overrides as FeatureSwitchOverrides;
}

/** 没有覆盖、也没有能力限制时的值。 */
export function readFeatureTierDefaults(tier: FeatureTier): FeatureSwitchState {
	const resolved = assertFeatureTier(tier);
	const values: Record<string, FeatureSwitchValue> = {};
	for (const definition of FEATURE_SWITCHES) {
		values[definition.id] = definition.tierValues[resolved];
	}
	return values as FeatureSwitchState;
}

export function isFeatureSwitchVisible(
	definition: FeatureSwitchDefinition,
	capabilities: FeatureCapabilities,
): boolean {
	return definition.capability === null || capabilities[definition.capability];
}

export interface FeatureStateInput {
	readonly tier: FeatureTier;
	readonly overrides?: FeatureSwitchOverrides;
	readonly capabilities: FeatureCapabilities;
	/** 单轮临时开关；只参与这一次解析，不写故事设置。 */
	readonly turnOverrides?: FeatureSwitchOverrides;
}

export interface FeatureState {
	readonly values: FeatureSwitchState;
	/** 按目录顺序列出当前卡片实际可用的开关。 */
	readonly visible: readonly FeatureSwitchId[];
}

/**
 * 档位默认值 → 故事覆盖 → 单轮覆盖，逐层替换。能力缺失的开关不显示，
 * 固定取其关闭值，故事里的旧覆盖被忽略；未知开关与非法值直接抛错。
 */
export function resolveFeatureState(input: FeatureStateInput): FeatureState {
	const tier = assertFeatureTier(input.tier);
	const overrides =
		input.overrides === undefined
			? EMPTY_FEATURE_SWITCH_OVERRIDES
			: assertFeatureSwitchOverrides(input.overrides, "功能开关覆盖");
	const turnOverrides =
		input.turnOverrides === undefined
			? EMPTY_FEATURE_SWITCH_OVERRIDES
			: assertFeatureSwitchOverrides(input.turnOverrides, "单轮功能开关");
	const visible: FeatureSwitchId[] = [];
	const values: Record<string, FeatureSwitchValue> = {};
	for (const definition of FEATURE_SWITCHES) {
		if (!isFeatureSwitchVisible(definition, input.capabilities)) {
			values[definition.id] = definition.disabledValue;
			continue;
		}
		visible.push(definition.id);
		const override = turnOverrides[definition.id] ?? overrides[definition.id];
		values[definition.id] =
			override === undefined
				? definition.tierValues[tier]
				: (override as FeatureSwitchValue);
	}
	return { values: values as FeatureSwitchState, visible };
}

export interface StoryFeatureSwitchView {
	readonly id: FeatureSwitchId;
	readonly label: string;
	readonly description: string;
	readonly kind: "toggle" | "choice" | "number";
	readonly value: FeatureSwitchValue;
	readonly choices: readonly FeatureSwitchChoice[];
	readonly minimum: number | null;
	readonly maximum: number | null;
}

export interface StoryFeatureGroupView {
	readonly group: FeatureSwitchGroup;
	readonly label: string;
	readonly switches: readonly StoryFeatureSwitchView[];
}

/** 功能开关页需要的全部数据；只列出当前卡片可用的开关。 */
export interface StoryFeatureView {
	readonly storyId: string;
	readonly tier: FeatureTier;
	readonly groups: readonly StoryFeatureGroupView[];
}

export function buildStoryFeatureView(
	storyId: string,
	tier: FeatureTier,
	state: FeatureState,
): StoryFeatureView {
	const visible = new Set(state.visible);
	const groups = FEATURE_SWITCH_GROUPS.map((group) => ({
		group,
		label: FEATURE_SWITCH_GROUP_LABELS[group],
		switches: FEATURE_SWITCHES.filter(
			(definition) => definition.group === group && visible.has(definition.id),
		).map((definition) => ({
			id: definition.id,
			label: definition.label,
			description: definition.description,
			kind: definition.kind,
			value: state.values[definition.id],
			choices: definition.choices,
			minimum: definition.minimum,
			maximum: definition.maximum,
		})),
	}));
	return { storyId, tier: assertFeatureTier(tier), groups };
}

/** 从导入分型、实体、规则声明与世界书推出这张卡自带的能力。 */
export function readStoryFeatureCapabilities(
	store: StoryStore,
	storyId: string,
): FeatureCapabilities {
	const audit = store.listImportAuditEntries(storyId);
	const kinds = new Set(audit.map((entry) => entry.kind));
	const lore = store.listLoreEntries(storyId);
	return {
		entities: store.listEntities(storyId).length > 0 || kinds.has("entity"),
		rules: store.listStoryRules(storyId).length > 0,
		state: kinds.has("state"),
		writing: kinds.has("writing"),
		presentation: kinds.has("presentation"),
		importedContent: audit.length > 0 || lore.length > 0,
	};
}

/** 故事当前生效的开关状态；`turnOverrides` 只影响这一次解析。 */
export function readStoryFeatureState(
	store: StoryStore,
	storyId: string,
	turnOverrides?: FeatureSwitchOverrides,
): FeatureState {
	const settings = store.getStorySettings(storyId);
	return resolveFeatureState({
		tier: settings.featureTier,
		overrides: settings.featureSwitches,
		capabilities: readStoryFeatureCapabilities(store, storyId),
		...(turnOverrides === undefined ? {} : { turnOverrides }),
	});
}

export function readStoryFeatureView(
	store: StoryStore,
	storyId: string,
): StoryFeatureView {
	const settings = store.getStorySettings(storyId);
	const state = readStoryFeatureState(store, storyId);
	return buildStoryFeatureView(storyId, settings.featureTier, state);
}

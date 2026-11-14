import type { JsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import type { DirectorIntensity } from "./intensity.js";

/** 导演对玩家的可见程度；`off` 完全不评估、不注入。 */
export const DIRECTOR_MODES = ["off", "transparent", "blind"] as const;

export type DirectorMode = (typeof DIRECTOR_MODES)[number];

export function isDirectorMode(value: unknown): value is DirectorMode {
	return (
		typeof value === "string" &&
		(DIRECTOR_MODES as readonly string[]).includes(value)
	);
}

export interface DirectorConfig {
	readonly mode: DirectorMode;
	/** 未兑现线索的最老年龄超过这个楼层数时建议回收。 */
	readonly clueAgeWarning: number;
	/** 当前分支上同时打开的线索达到这个数量时建议先回收最老的一条。 */
	readonly maxOpenClues: number;
	/** 当前分支上未兑现的伏笔最多保留几条；满了不再新建。 */
	readonly maxOpenPromises: number;
	/** 距上一次章末规划积累这么多助手楼层后，在间隙做一次章级规划。 */
	readonly chapterFloors: number;
	/** 最近多少个已确认助手楼层都没有进展时判定为停滞。 */
	readonly stallFloors: number;
	/** 事件池的意外频率门槛，取值 0 到 1；0 表示永不触发，1 表示停滞就触发。 */
	readonly surprise: number;
	/** 相邻节拍余弦的绝对阈值，参照小说分布的 P99。 */
	readonly similarityThreshold: number;
	/** 重复度曲线的窗口大小（相邻节拍对的数量），至少为 2。 */
	readonly similarityWindow: number;
	/** 窗口前进的步长（节拍对的数量）。 */
	readonly similarityStep: number;
	/** 判定窗口均值持续上升所需的连续窗口数。 */
	readonly similarityRiseWindows: number;
	/** 连续窗口均值至少上涨这么多才算上升。 */
	readonly similarityRiseDelta: number;
	/** 上升起点的窗口均值下限。 */
	readonly similarityRiseMinimum: number;
	/** 读取场景类型的当前状态路径；不设置时用最近事件的地点。 */
	readonly scenePath?: readonly string[];
	/** 同一场景连续出现的节拍数超过这个值时建议换场景。 */
	readonly sceneRepeatThreshold: number;
	/** 读取张力值的当前状态路径；不设置或取不到时按最近楼层推导。 */
	readonly tensionPath?: readonly string[];
	/** 张力达到这个值时允许从铺垫进入升级。 */
	readonly tensionEscalate: number;
	/** 张力达到这个值时允许从升级进入高潮。 */
	readonly tensionClimax: number;
	/** 推导张力时状态 diff 分量的权重。 */
	readonly tensionStateWeight: number;
	/** 推导张力时新建剧情笔记分量的权重。 */
	readonly tensionNoteWeight: number;
	/** 推导张力时最近事件重要度的权重。 */
	readonly tensionEventWeight: number;
	/** 一个楼层多少个状态 diff 视为该分量达到 1。 */
	readonly tensionStateDiffsPerFloor: number;
	/** 一个楼层多少条新建剧情笔记视为该分量达到 1。 */
	readonly tensionNotesPerFloor: number;
	/** 节奏快慢：越大，进入升级与高潮所需的楼层数越少。 */
	readonly pace: number;
	/** 铺垫阶段进入升级所需的基础楼层数，实际需求按 pace 缩小。 */
	readonly minSetupFloors: number;
	/** 升级阶段进入高潮所需的基础楼层数，实际需求按 pace 缩小。 */
	readonly minEscalateFloors: number;
	/** 高潮阶段持续到这个楼层数后进入喘息。 */
	readonly climaxFloors: number;
	/** 喘息阶段持续到这个楼层数后回到铺垫。 */
	readonly breatheFloors: number;
	/** 当前路径的助手楼层数小于它时启用开场导演；0 表示关闭。 */
	readonly openingFloors: number;
	/** 开场导演的强度档位。 */
	readonly openingIntensity: DirectorIntensity;
	/** 序列拍建议的强度档位；单轮参数优先。 */
	readonly intensity: DirectorIntensity;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
	mode: "transparent",
	clueAgeWarning: 12,
	maxOpenClues: 5,
	maxOpenPromises: 5,
	chapterFloors: 20,
	stallFloors: 3,
	surprise: 1,
	similarityThreshold: 0.73,
	similarityWindow: 20,
	similarityStep: 10,
	similarityRiseWindows: 5,
	similarityRiseDelta: 0.02,
	similarityRiseMinimum: 0.03,
	sceneRepeatThreshold: 7,
	tensionEscalate: 0.33,
	tensionClimax: 0.67,
	tensionStateWeight: 0.4,
	tensionNoteWeight: 0.3,
	tensionEventWeight: 0.3,
	tensionStateDiffsPerFloor: 2,
	tensionNotesPerFloor: 1,
	pace: 1,
	minSetupFloors: 2,
	minEscalateFloors: 2,
	climaxFloors: 7,
	breatheFloors: 6,
	openingFloors: 10,
	openingIntensity: "natural",
	intensity: "natural",
};

export interface DirectorSuggestion {
	readonly mechanism: string;
	readonly priority: number;
	readonly directive: string;
	readonly signals: JsonObject;
}

export interface DirectorMechanismResult {
	readonly triggered: boolean;
	readonly reason: string;
	readonly suggestion: DirectorSuggestion | null;
	readonly signals: JsonObject;
}

export interface DirectorMechanismContext {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly config: DirectorConfig;
}

export interface DirectorMechanism {
	readonly name: string;
	evaluate(context: DirectorMechanismContext): DirectorMechanismResult;
}

export interface DirectorMechanismRecord {
	readonly name: string;
	readonly triggered: boolean;
	readonly reason: string;
}

export interface DirectorDecision {
	readonly nodeId: string;
	readonly storyId: string;
	readonly directive: string | null;
	readonly mechanisms: readonly DirectorMechanismRecord[];
	readonly signals: JsonObject;
	readonly createdAt: string;
}

export interface NewDirectorDecisionInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly directive: string | null;
	readonly mechanisms: readonly DirectorMechanismRecord[];
	readonly signals: JsonObject;
	readonly createdAt?: string;
}

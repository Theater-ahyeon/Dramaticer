import type { JsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";

export interface DirectorConfig {
	readonly enabled: boolean;
	/** 未兑现线索的最老年龄超过这个楼层数时建议回收。 */
	readonly clueAgeWarning: number;
	/** 当前分支上同时打开的线索达到这个数量时建议先回收最老的一条。 */
	readonly maxOpenClues: number;
	/** 最近多少个已确认助手楼层都没有进展时判定为停滞。 */
	readonly stallFloors: number;
	/** 事件池的意外频率门槛，取值 0 到 1；0 表示永不触发，1 表示停滞就触发。 */
	readonly surprise: number;
	/** 留给节奏状态机的参数，当前任务不读取。 */
	readonly pace?: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
	enabled: true,
	clueAgeWarning: 12,
	maxOpenClues: 5,
	stallFloors: 3,
	surprise: 1,
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

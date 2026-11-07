import type { JsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";

export interface DirectorConfig {
	readonly enabled: boolean;
	/** 未兑现线索的最老年龄超过这个楼层数时建议回收。 */
	readonly clueAgeWarning: number;
	/** 当前分支上同时打开的线索达到这个数量时建议先回收最老的一条。 */
	readonly maxOpenClues: number;
	/** 留给节奏状态机的参数，当前任务不读取。 */
	readonly pace?: number;
	/** 留给事件池的触发门槛，当前任务不读取。 */
	readonly surprise?: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
	enabled: true,
	clueAgeWarning: 12,
	maxOpenClues: 5,
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

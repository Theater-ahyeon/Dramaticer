import type {
	DirectorMechanismRecord,
	DirectorMode,
	DirectorPlan,
	Entity,
	JsonObject,
	JsonValue,
	LedgerChangeCard,
	LedgerClue,
	LedgerFact,
	LoreEntry,
	MemoryEvent,
	OpeningCandidateRecord,
	OpeningCandidateStatus,
	PreferenceEvent,
	StateDiff,
	Summary,
	TimelineNode,
	TurnTrace,
} from "@dramaticer/core";
import type { StoryPath } from "./story.js";

/** 对某个楼层操作后返回新楼层与操作后的当前路径。 */
export interface NodeActionResult {
	readonly node: TimelineNode;
	readonly path: StoryPath;
}

/** `POST /api/nodes/:id/swipe` 与 `POST /api/nodes/:id/edit` 的请求体。 */
export interface NodeTextRequest {
	readonly text: string;
}

/**
 * `POST /api/nodes/:id/choice` 的请求体：只带玩家选中的选项正文。
 * 界面按选项块里的原始行文本发送，不做改写。
 */
export interface NodeChoiceRequest {
	readonly text: string;
}

/** `POST /api/nodes/:id/choice` 的响应：写入后的偏好记录。 */
export interface NodeChoiceResult {
	readonly event: PreferenceEvent;
}

/** `POST /api/stories/:id/head` 的请求体。 */
export interface SetHeadRequest {
	readonly nodeId: string;
}

/** `GET /api/nodes/:id/ledger`：该楼层的台账快照、事实与本楼 diff。 */
export interface NodeLedgerView {
	readonly nodeId: string;
	readonly storyId: string;
	readonly state: JsonValue;
	readonly facts: readonly LedgerFact[];
	readonly diffs: readonly StateDiff[];
}

/** `GET /api/nodes/:id/events` 的响应；分页参数原样回显。 */
export interface NodeEventsView {
	readonly nodeId: string;
	readonly limit: number;
	readonly offset: number;
	readonly events: readonly MemoryEvent[];
}

/** `GET /api/nodes/:id/compressions`：覆盖该楼层的记忆压缩记录。 */
export interface NodeCompressionsView {
	readonly nodeId: string;
	readonly compressions: readonly Summary[];
}

/** 盲盒模式下隐去指令与信号之后的导演决策；透明模式就是完整决策。 */
export interface DirectorDecisionView {
	readonly nodeId: string;
	readonly storyId: string;
	readonly directive: string | null;
	readonly mechanisms: readonly DirectorMechanismRecord[];
	/** 盲盒模式不返回。 */
	readonly signals?: JsonObject;
	readonly createdAt: string;
}

/**
 * `GET /api/nodes/:id/director`：该楼层的导演决策，没有评估过时为 null。
 * `mode` 是故事当前的导演模式；盲盒只返回机制触发状态。
 */
export interface NodeDirectorView {
	readonly nodeId: string;
	readonly mode: DirectorMode;
	readonly decision: DirectorDecisionView | null;
}

/** `GET /api/stories/:id/clues`：当前 head 路径上尚未兑现的线索。 */
export interface StoryCluesView {
	readonly storyId: string;
	readonly headNodeId: string | null;
	readonly clues: readonly LedgerClue[];
}

/** `POST /api/clues/:id/fulfill` 的请求体；线索本身不记录所属故事。 */
export interface FulfillClueRequest {
	readonly storyId: string;
}

export interface FulfillClueResult {
	readonly storyId: string;
	readonly clueId: string;
	readonly headNodeId: string;
	readonly diffs: readonly StateDiff[];
}

export interface StoryEntitiesView {
	readonly storyId: string;
	readonly entities: readonly Entity[];
}

export interface StoryLoreView {
	readonly storyId: string;
	readonly entries: readonly LoreEntry[];
}

/** `GET /api/stories/:id/proposals`；`status` 为 `all` 时不过滤。 */
export interface StoryProposalsView {
	readonly storyId: string;
	readonly status: string;
	readonly proposals: readonly LedgerChangeCard[];
}

export interface StoryOpeningsView {
	readonly storyId: string;
	readonly status: OpeningCandidateStatus | "all";
	readonly candidates: readonly OpeningCandidateRecord[];
}

/** `GET` 与 `PUT /api/stories/:id/director/plan` 的载荷。 */
export interface StoryDirectorPlanView {
	readonly storyId: string;
	readonly plan: DirectorPlan;
}

/** `PUT /api/stories/:id/director/plan` 的请求体；整份替换，来源为玩家。 */
export interface StoryDirectorPlanRequest {
	readonly plan: DirectorPlan;
}

/** 选中开场候选后的结果；候选正文已经成为当前路径的根楼层。 */
export interface StoryOpeningPickResult {
	readonly candidate: OpeningCandidateRecord;
	readonly node: TimelineNode;
	readonly path: StoryPath;
}

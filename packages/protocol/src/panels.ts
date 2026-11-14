import type {
	DirectorCandidateAction,
	DirectorConfig,
	DirectorMechanismRecord,
	DirectorMode,
	DirectorPlan,
	Entity,
	JsonObject,
	JsonValue,
	LedgerChangeCard,
	LedgerChangeCardDiff,
	LedgerClue,
	LedgerFact,
	LoreEntry,
	MemoryEvent,
	OpeningCandidateRecord,
	OpeningCandidateStatus,
	PreferenceEvent,
	SceneControl,
	ScenePace,
	SceneSegment,
	SerialBookExport,
	SerialView,
	StateDiff,
	Summary,
	TimelineNode,
	TurnMode,
	TurnRunEvent,
	TurnRunRecord,
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
 * `POST /api/nodes/:id/correct` 的请求体：选中的原文与玩家的意见。
 * 只重写选中的片段，其余正文逐字保留。
 */
export interface NodeCorrectRequest {
	readonly quote: string;
	readonly instruction: string;
}

/** `POST /api/nodes/:id/correct` 的响应：新楼层、路径与写进用户意志的 id。 */
export interface NodeCorrectResult {
	readonly node: TimelineNode;
	readonly path: StoryPath;
	readonly beforeNodeId: string;
	readonly replacement: string;
	readonly willId: string | null;
}

/**
 * `POST /api/nodes/:id/scene-control` 的请求体：三种操作各带自己的载荷。
 * `end-scene` 可以附一句备注，`jump-time` 带目标时间，`pace` 带三档之一。
 */
export type SceneControlRequest =
	| { readonly kind: "end-scene"; readonly note?: string }
	| { readonly kind: "jump-time"; readonly time: string }
	| { readonly kind: "pace"; readonly pace: ScenePace };

/** 场面控制的结果：写入的记录与生效后的场次划分。 */
export interface SceneControlResult {
	readonly control: SceneControl;
	readonly scenes: readonly SceneSegment[];
	/** 调整节奏时是新的导演配置；其余操作为 null。 */
	readonly directorConfig: DirectorConfig | null;
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

/**
 * `POST /api/nodes/:id/retry` 的请求体：以该用户楼层为父节点重新生成回复。
 * 不写新的用户楼层；`mode` 省略时使用故事设置。
 */
export interface NodeRetryRequest {
	readonly mode?: TurnMode;
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

/** `GET /api/nodes/:id/run`：运行摘要与按 seq 升序的事件。 */
export interface NodeRunView {
	readonly nodeId: string;
	readonly run: TurnRunRecord;
	readonly events: readonly TurnRunEvent[];
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

/**
 * `GET /api/nodes/:id/actions`：该楼层在间隙里准备好的候选行动。
 * 4 条行动在前、1 条场景变化在后；候选只供读取，不自动发送。
 */
export interface NodeActionsView {
	readonly nodeId: string;
	readonly actions: readonly DirectorCandidateAction[];
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

/** `POST /api/stories/:id/proposals` 的请求体：玩家直接编辑台账。 */
export interface StoryProposalCreateRequest {
	/** 修改说明；批准时同时记入用户意志。 */
	readonly text: string;
	readonly diffs: readonly LedgerChangeCardDiff[];
}

/** `POST /api/stories/:id/proposals` 的结果：待定卡与当前 head 的台账快照。 */
export interface StoryProposalCreateResult {
	readonly card: LedgerChangeCard;
	readonly ledger: NodeLedgerView | null;
}

/** 变更卡可以执行的三个动作。 */
export const PROPOSAL_DECISION_ACTIONS = [
	"approve",
	"reject",
	"rollback",
] as const;
export type ProposalDecisionAction = (typeof PROPOSAL_DECISION_ACTIONS)[number];

export function isProposalDecisionAction(
	value: unknown,
): value is ProposalDecisionAction {
	return (
		typeof value === "string" &&
		(PROPOSAL_DECISION_ACTIONS as readonly string[]).includes(value)
	);
}

/**
 * `POST /api/proposals/:id/approve|reject|rollback` 的结果：更新后的卡片，
 * 以及卡片所属故事当前 head 的台账快照；故事没有楼层时为 null。
 */
export interface ProposalDecisionResult {
	readonly card: LedgerChangeCard;
	readonly ledger: NodeLedgerView | null;
}

export interface StoryOpeningsView {
	readonly storyId: string;
	readonly status: OpeningCandidateStatus | "all";
	readonly candidates: readonly OpeningCandidateRecord[];
}

/** `POST /api/stories/:id/openings/generate` 的结果；任务立即返回，生成在后台执行。 */
export interface StoryOpeningGenerateResult {
	readonly storyId: string;
	readonly jobId: number;
	readonly kind: string;
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

/**
 * `GET /api/stories/:id/serial`：前情提要、章节目录、人物关系页与时间线
 * 共用的派生视图；查询参数 `nodeId` 省略时取当前 head。
 */
export type StorySerialView = SerialView;

/**
 * `GET /api/stories/:id/serial/export`：按章节目录导出的 Markdown 与
 * 建议的文件名；正文逐字来自楼层原文。
 */
export type StoryBookExport = SerialBookExport;

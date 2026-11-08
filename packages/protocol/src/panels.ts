import type {
	DirectorDecision,
	Entity,
	JsonValue,
	LedgerChangeCard,
	LedgerClue,
	LedgerFact,
	LoreEntry,
	MemoryEvent,
	OpeningCandidateRecord,
	OpeningCandidateStatus,
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

/** `GET /api/nodes/:id/director`：该楼层的导演决策，没有评估过时为 null。 */
export interface NodeDirectorView {
	readonly nodeId: string;
	readonly decision: DirectorDecision | null;
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

/** 选中开场候选后的结果；候选正文已经成为当前路径的根楼层。 */
export interface StoryOpeningPickResult {
	readonly candidate: OpeningCandidateRecord;
	readonly node: TimelineNode;
	readonly path: StoryPath;
}

export type TimelineRole = "system" | "user" | "assistant";

export interface Story {
	readonly id: string;
	readonly title: string;
	readonly createdAt: string;
}

export interface TimelineNode {
	readonly id: string;
	readonly storyId: string;
	readonly parentId: string | null;
	readonly role: TimelineRole;
	readonly raw: string;
	readonly createdAt: string;
}

export type StateDiffOp = "set" | "delete";

export interface StateDiff {
	readonly id: number;
	readonly storyId: string;
	readonly nodeId: string;
	readonly ordinal: number;
	/** 状态路径，例如 ["角色", "卫宫", "好感度"]。空路径不允许。 */
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	/** op 为 set 时是 JSON 值；op 为 delete 时为 null。 */
	readonly value: unknown;
	readonly reason: string | null;
	readonly source: string;
	readonly createdAt: string;
}

interface NewStateDiffBase {
	readonly storyId: string;
	readonly nodeId: string;
	readonly path: readonly string[];
	readonly reason?: string | null;
	readonly source: string;
}

export type NewStateDiff =
	| (NewStateDiffBase & { readonly op: "set"; readonly value: unknown })
	| (NewStateDiffBase & { readonly op: "delete" });

export interface NodeTextMatch {
	readonly nodeId: string;
	readonly storyId: string;
	/** bm25 分数，越小越相关。 */
	readonly score: number;
	readonly snippet: string;
}

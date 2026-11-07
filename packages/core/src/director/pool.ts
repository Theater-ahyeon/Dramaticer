import type { ContextCondition } from "../context/template.js";

/** 事件池的一条：由卡扩展导入，剧情停滞时由导演挑选。 */
export interface EventPoolEntry {
	readonly storyId: string;
	/** 卡扩展里的事件 id，故事内唯一。 */
	readonly sourceId: string;
	readonly text: string;
	readonly preconditions: ContextCondition | null;
	/** 同一事件两次使用之间至少要隔开的楼层数。 */
	readonly cooldown: number;
	/** 为 false 时保留在池里，但导演不会选择。 */
	readonly enabled: boolean;
	/** 来源标记，例如 `card-extension`。 */
	readonly source: string;
	readonly createdAt: string;
}

export interface NewEventPoolEntryInput {
	readonly storyId: string;
	readonly sourceId: string;
	readonly text: string;
	readonly preconditions?: ContextCondition | null;
	readonly cooldown?: number;
	readonly enabled?: boolean;
	readonly source?: string;
	/** 只在首次插入时使用；重复导入保留原来的创建时间。 */
	readonly createdAt?: string;
}

export interface EventPoolUpsertResult {
	readonly inserted: number;
	readonly updated: number;
}

/** 一条 NPC 议程：目标由后台在章节边界推进，进度保留在本地。 */
export interface NpcAgenda {
	readonly storyId: string;
	readonly entityId: string;
	readonly goal: string;
	/** 每隔几个章节推进一次。 */
	readonly everyChapters: number;
	readonly importance: number;
	/** 后台模型最近一次写出的进度；尚未推进时为空字符串。 */
	readonly progress: string;
	readonly lastAdvancedNodeId: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface NewNpcAgendaInput {
	readonly storyId: string;
	readonly entityId: string;
	readonly goal: string;
	readonly everyChapters?: number;
	readonly importance?: number;
	readonly createdAt?: string;
}

export interface NpcAgendaUpsertResult {
	readonly inserted: number;
	readonly updated: number;
}

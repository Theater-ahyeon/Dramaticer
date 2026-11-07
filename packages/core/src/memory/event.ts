export interface MemoryEvent {
	readonly id: string;
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly ordinal: number;
	readonly storyTime: string | null;
	readonly location: string | null;
	readonly participants: readonly string[];
	readonly importance: number;
	readonly knowers: readonly string[];
	readonly text: string;
	/** 事件由哪个后台任务写入，例如抽取或 NPC 议程推进。 */
	readonly source: string;
	readonly createdAt: string;
}

export interface NewMemoryEventInput {
	readonly id?: string;
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly ordinal: number;
	readonly storyTime?: string | null;
	readonly location?: string | null;
	readonly participants: readonly string[];
	readonly importance: number;
	readonly knowers: readonly string[];
	readonly text: string;
	/** 默认是事件抽取。 */
	readonly source?: string;
	readonly createdAt?: string;
}

export interface GetEventsForPathOptions {
	readonly limit?: number;
	readonly offset?: number;
}

export const DEFAULT_MEMORY_EVENT_LIMIT = 100;
export const MAX_MEMORY_EVENT_LIMIT = 1_000;

/** 事件抽取写入的事件来源。 */
export const DEFAULT_MEMORY_EVENT_SOURCE = "events";

/** NPC 议程推进写入的事件来源。 */
export const NPC_AGENDA_EVENT_SOURCE = "npc_agenda";

/** 一次事件抽取请求最多处理的助手楼层数。 */
export const EVENT_WINDOW_FLOORS = 8;

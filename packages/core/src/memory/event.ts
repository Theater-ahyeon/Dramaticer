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
	readonly createdAt?: string;
}

export interface GetEventsForPathOptions {
	readonly limit?: number;
	readonly offset?: number;
}

export const DEFAULT_MEMORY_EVENT_LIMIT = 100;
export const MAX_MEMORY_EVENT_LIMIT = 1_000;

/** 抽取窗口：任务所在楼层加上沿路径往前的最多 8 楼。 */
export const EVENT_WINDOW_FLOORS = 8;

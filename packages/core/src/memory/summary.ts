export type SummaryLevel = "chapter" | "mainline";

export interface Summary {
	readonly id: string;
	readonly storyId: string;
	readonly level: SummaryLevel;
	/** 覆盖区间的第一楼；必须位于终点楼层所在路径上。 */
	readonly startNodeId: string;
	/** 覆盖区间的最后一楼。 */
	readonly endNodeId: string;
	readonly text: string;
	/** 由写入时的估算器计算，不接受调用方传入。 */
	readonly tokenCount: number;
	readonly createdAt: string;
}

export interface NewSummaryInput {
	readonly id?: string;
	readonly storyId: string;
	readonly level: SummaryLevel;
	readonly startNodeId: string;
	readonly endNodeId: string;
	readonly text: string;
	readonly createdAt?: string;
}

/** 每 20 个已确认的助手楼层生成一条章节摘要。 */
export const DEFAULT_CHAPTER_SIZE = 20;

/** 每 5 条章节摘要生成一条主线摘要。 */
export const DEFAULT_MAINLINE_SIZE = 5;

export function isSummaryLevel(value: unknown): value is SummaryLevel {
	return value === "chapter" || value === "mainline";
}

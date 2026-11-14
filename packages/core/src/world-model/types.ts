import type { JsonObject } from "../json.js";
import type { LedgerSource } from "../ledger/schema.js";
import type { StateDiffOp, StoryTime } from "../timeline.js";

/** 世界模型的表示方式；对比实验 X1 的三个候选。 */
export const WORLD_MODEL_KINDS = ["ledger", "wiki", "temporal_graph"] as const;
export type WorldModelKind = (typeof WORLD_MODEL_KINDS)[number];

export const DEFAULT_WORLD_MODEL_KIND: WorldModelKind = "ledger";

export function isWorldModelKind(value: unknown): value is WorldModelKind {
	return (
		typeof value === "string" &&
		(WORLD_MODEL_KINDS as readonly string[]).includes(value)
	);
}

export function assertWorldModelKind(
	value: unknown,
	label = "世界模型的表示方式",
): WorldModelKind {
	if (!isWorldModelKind(value)) {
		throw new Error(`${label}不合法：${String(value)}`);
	}
	return value;
}

/** 硬事实之外的一段内容，例如实体档案或已失效的事实。 */
export interface WorldModelSection {
	readonly title: string;
	readonly text: string;
}

/** 读取选项；时序图谱支持按故事内时间点查询。 */
export interface WorldModelReadOptions {
	/** 故事内时间点的文字标签，例如「第三天」；标签必须在该路径上出现过。 */
	readonly atStoryTime?: string;
}

/** 某个楼层末端的世界模型视图；`state` 保持台账快照的形状。 */
export interface WorldModelView {
	readonly state: JsonObject;
	readonly sections: readonly WorldModelSection[];
	readonly source: string;
}

/** 与存储无关的一条写入；各适配器负责映射到自己的存储。 */
export interface WorldModelWrite {
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	readonly value?: unknown;
	readonly storyTime?: StoryTime | null;
	readonly confidence?: number | null;
	readonly reason?: string | null;
	readonly source: LedgerSource;
}

export interface WorldModelWriteResult {
	readonly written: number;
}

/**
 * 世界模型的统一读写接口。三个候选共用这一组方法；
 * 调用方只选择种类，不接触具体存储。
 */
export interface WorldModel {
	readonly kind: WorldModelKind;
	read(nodeId: string, options?: WorldModelReadOptions): WorldModelView;
	write(
		nodeId: string,
		writes: readonly WorldModelWrite[],
	): WorldModelWriteResult;
}

/** 只有时序图谱支持按时间点查询；其余候选收到查询时直接失败，不静默忽略。 */
export function assertTimeQuerySupported(
	kind: WorldModelKind,
	options?: WorldModelReadOptions,
): void {
	if (options?.atStoryTime === undefined) return;
	if (kind === "temporal_graph") return;
	throw new Error(`世界模型 ${kind} 不支持按故事时间点查询`);
}

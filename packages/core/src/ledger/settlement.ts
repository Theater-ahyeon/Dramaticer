import type { EntityKind } from "../entity.js";
import type { LedgerSource } from "./schema.js";

/** 结算器允许的三种修复动作：补值、删除非法条目、改写线索状态。 */
export const LEDGER_REPAIR_ACTIONS = [
	"fill",
	"delete",
	"rewrite_status",
] as const;
export type LedgerRepairAction = (typeof LEDGER_REPAIR_ACTIONS)[number];

export interface LedgerRepair {
	readonly path: readonly string[];
	readonly action: LedgerRepairAction;
	readonly reason: string;
}

/** 一个楼层的结算结果；与楼层绑定，同一楼层只有一行。 */
export interface LedgerSettlement {
	readonly nodeId: string;
	readonly storyId: string;
	/** 本条结算记录的来源：结构化写入已覆盖全部事实时为 model，调用过模型时为 settler。 */
	readonly source: LedgerSource;
	readonly addedCount: number;
	readonly repairs: readonly LedgerRepair[];
	readonly createdAt: string;
}

export interface NewLedgerSettlement {
	readonly nodeId: string;
	readonly storyId: string;
	readonly source: LedgerSource;
	readonly addedCount: number;
	readonly repairs: readonly LedgerRepair[];
	readonly createdAt?: string;
}

/** 结算时出现、但还没有建档的实体名称。 */
export interface EntityCandidate {
	readonly storyId: string;
	readonly normalizedName: string;
	readonly kind: EntityKind;
	readonly hits: number;
	readonly firstNodeId: string;
	readonly createdAt: string;
}

export interface NewEntityCandidateInput {
	readonly storyId: string;
	readonly name: string;
	readonly kind: EntityKind;
	readonly nodeId: string;
	readonly createdAt?: string;
}

export function isLedgerRepairAction(
	value: unknown,
): value is LedgerRepairAction {
	return (
		typeof value === "string" &&
		(LEDGER_REPAIR_ACTIONS as readonly string[]).includes(value)
	);
}

/** 校验一条修复记录并返回字段完整的副本；错误信息带序号与路径。 */
export function assertLedgerRepair(
	value: unknown,
	label: string,
): LedgerRepair {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const record = value as Record<string, unknown>;
	const path = readRepairPath(record.path, label);
	if (!isLedgerRepairAction(record.action)) {
		throw new Error(
			`${label} 的 action 只能是 ${LEDGER_REPAIR_ACTIONS.join("、")}，收到 ${JSON.stringify(record.action)}`,
		);
	}
	if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
		throw new Error(`${label} 的 reason 必须是非空字符串`);
	}
	return { path, action: record.action, reason: record.reason };
}

export function assertLedgerRepairs(
	value: unknown,
	label: string,
): readonly LedgerRepair[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 的 repairs 必须是数组`);
	}
	return value.map((repair, index) =>
		assertLedgerRepair(repair, `${label} 的 repairs[${index}]`),
	);
}

function readRepairPath(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 的 path 必须是字符串组成的非空数组`);
	}
	for (const [index, segment] of value.entries()) {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`${label} 的 path[${index}] 必须是非空字符串`);
		}
	}
	return value as readonly string[];
}

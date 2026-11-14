import { isJsonObject } from "../json.js";
import { readLedger } from "../ledger/read.js";
import { validateLedgerDiff } from "../ledger/schema.js";
import { userWillStableId } from "../ledger/user-will.js";
import type { StoryStore } from "../store/story-store.js";

/** 重 roll 时玩家可以选的原因；原因进偏好信号，并作为纠正带进重写。 */
export const REROLL_REASONS = [
	"not-progressed",
	"ignored-instruction",
	"too-short",
	"off-character",
	"format",
	"avoid-line",
] as const;

export type RerollReason = (typeof REROLL_REASONS)[number];

export const REROLL_REASON_LABELS: Readonly<Record<RerollReason, string>> = {
	"not-progressed": "没推进",
	"ignored-instruction": "没听我的",
	"too-short": "太短",
	"off-character": "人设不对",
	format: "格式乱",
	"avoid-line": "别推这条线",
};

/**
 * 原因作为长期有效的纠正写进用户意志时的说法。
 * 这些话会被后续每一轮注入，所以只写要求，不提「上一版」。
 */
export const REROLL_REASON_WILLS: Readonly<Record<RerollReason, string>> = {
	"not-progressed": "每一楼都要有实际的进展，不要原地踏步。",
	"ignored-instruction": "按玩家这一轮说的写，不要忽略玩家的指示。",
	"too-short": "回复要写够分量，把场面与人物反应写出来，不要太短。",
	"off-character": "角色要符合卡里的人设与说话方式。",
	format: "按约定的块格式输出，不要写乱格式。",
	"avoid-line": "不要顺着刚才那条线继续推，换一个方向。",
};

/** 原因带给本次重写的即时指示；与长期说法分开，只出现在这一次请求里。 */
export const REROLL_REASON_CORRECTIONS: Readonly<Record<RerollReason, string>> =
	{
		"not-progressed": "上一版没有推进剧情；重写时这一楼要出现实际的进展。",
		"ignored-instruction":
			"上一版没有照玩家说的写；重写时按玩家这一轮的要求来。",
		"too-short": "上一版太短；重写时把场面与人物反应写充实。",
		"off-character": "上一版人设不对；重写时符合角色卡里的性格与说话方式。",
		format: "上一版格式乱了；重写时按约定的块格式输出。",
		"avoid-line": "不要重复上一版的方向；重写时换一条线。",
	};

export function isRerollReason(value: unknown): value is RerollReason {
	return (
		typeof value === "string" &&
		(REROLL_REASONS as readonly string[]).includes(value)
	);
}

export function assertRerollReason(
	value: unknown,
	label = "重 roll 的原因",
): RerollReason {
	if (!isRerollReason(value)) {
		throw new Error(
			`${label}只能是 ${REROLL_REASONS.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

/** 本次重写请求里紧贴生成位置的纠正段。 */
export function formatRerollCorrection(reason: RerollReason): string {
	return `【重写原因】${REROLL_REASON_LABELS[reason]}\n${REROLL_REASON_CORRECTIONS[reason]}`;
}

/** `userWill` 台账路径的第一段。 */
const USER_WILL_NAMESPACE = "userWill";

export interface RerollReasonWillInput {
	readonly store: StoryStore;
	readonly storyId: string;
	/** 写入这条事实的楼层；与楼层写入同一个事务。 */
	readonly nodeId: string;
	/** 玩家选择原因时所在的消息楼层。 */
	readonly sourceNodeId: string;
	readonly reason: RerollReason;
	readonly createdAt?: string;
}

/**
 * 把重 roll 的原因写成一条长期有效的纠正，挂在玩家楼层上，来源为 `player`。
 * 同一句话已经在这条路径上时不重复写入，返回是否新增。
 */
export function applyRerollReasonWill(input: RerollReasonWillInput): boolean {
	const text = REROLL_REASON_WILLS[input.reason];
	const id = userWillStableId(text);
	const existing = readLedger(input.store, input.sourceNodeId, [
		USER_WILL_NAMESPACE,
	]);
	if (isJsonObject(existing) && Object.hasOwn(existing, id)) return false;
	const path = [USER_WILL_NAMESPACE, id];
	const value = {
		kind: "correction",
		text,
		sourceNodeId: input.sourceNodeId,
		createdAt: input.createdAt ?? new Date().toISOString(),
	};
	validateLedgerDiff({ path, op: "set", value, source: "player" });
	input.store.appendStateDiffs([
		{
			storyId: input.storyId,
			nodeId: input.nodeId,
			path,
			op: "set",
			value,
			source: "player",
			reason: `重 roll 原因：${REROLL_REASON_LABELS[input.reason]}`,
		},
	]);
	return true;
}

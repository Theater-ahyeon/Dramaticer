import { isJsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import type { StateDiff } from "../timeline.js";
import { readLedger } from "./read.js";
import { validateLedgerDiff } from "./schema.js";

export interface FulfillClueOptions {
	/** 决定时间；缺省用当前时间。 */
	readonly at?: string;
}

/**
 * 玩家手动兑现一条线索：在当前 head 楼层追加 `status` 与 `updatedAt` 两条
 * 事实。写入前按台账规则校验；已经兑现或不存在时直接抛错。
 */
export async function fulfillLedgerClue(
	store: StoryStore,
	storyId: string,
	clueId: string,
	options: FulfillClueOptions = {},
): Promise<StateDiff[]> {
	if (clueId.trim().length === 0) {
		throw new Error("线索 id 必须是非空字符串");
	}
	const head = store.getHead(storyId);
	if (head === null) {
		throw new Error(`故事 ${storyId} 还没有楼层，不能兑现线索`);
	}
	const clue = readLedger(store, head.id, ["clue", clueId]);
	if (clue === undefined) {
		throw new Error(`线索不存在：${clueId}`);
	}
	if (!isJsonObject(clue)) {
		throw new Error(`台账路径 clue.${clueId} 必须是对象`);
	}
	if (clue.status === "fulfilled") {
		throw new Error(`线索已经兑现：${clueId}`);
	}
	const at = options.at ?? new Date().toISOString();
	const writes = [
		{
			storyId,
			nodeId: head.id,
			path: ["clue", clueId, "status"],
			op: "set" as const,
			value: "fulfilled",
			source: "player" as const,
			reason: `玩家兑现线索 ${clueId}`,
		},
		{
			storyId,
			nodeId: head.id,
			path: ["clue", clueId, "updatedAt"],
			op: "set" as const,
			value: at,
			source: "player" as const,
			reason: `玩家兑现线索 ${clueId}`,
		},
	];
	for (const write of writes) {
		validateLedgerDiff({
			path: write.path,
			op: write.op,
			value: write.value,
			source: write.source,
		});
	}
	return store.runInTransaction(() => store.appendStateDiffs(writes));
}

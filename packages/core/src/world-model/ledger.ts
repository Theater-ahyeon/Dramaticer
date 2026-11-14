import { isJsonObject } from "../json.js";
import { readLedger } from "../ledger/read.js";
import { validateLedgerDiff } from "../ledger/schema.js";
import type { StoryStore } from "../store/story-store.js";
import type { NewStateDiff } from "../timeline.js";
import type {
	WorldModel,
	WorldModelView,
	WorldModelWrite,
	WorldModelWriteResult,
} from "./types.js";

/** 现有台账作为世界模型：读取状态快照，写入校验后追加 diff。 */
export function createLedgerWorldModel(store: StoryStore): WorldModel {
	return {
		kind: "ledger",
		read(nodeId: string): WorldModelView {
			const state = readLedger(store, nodeId);
			if (!isJsonObject(state)) {
				throw new Error(`台账快照 ${nodeId} 不是对象`);
			}
			return {
				state,
				sections: [],
				source: `state:${store.countStateDiffsAlongPath(nodeId)} 条 diff`,
			};
		},
		write(
			nodeId: string,
			writes: readonly WorldModelWrite[],
		): WorldModelWriteResult {
			const node = store.getNode(nodeId);
			if (node === null) {
				throw new Error(`楼层节点不存在：${nodeId}`);
			}
			const inputs = writes.map((write) => {
				validateLedgerDiff({
					path: write.path,
					op: write.op,
					value: write.value,
					storyTime: write.storyTime,
					source: write.source,
					confidence: write.confidence,
				});
				return toStateDiff(node.storyId, nodeId, write);
			});
			if (inputs.length === 0) return { written: 0 };
			store.appendStateDiffs(inputs);
			return { written: inputs.length };
		},
	};
}

function toStateDiff(
	storyId: string,
	nodeId: string,
	write: WorldModelWrite,
): NewStateDiff {
	const base = {
		storyId,
		nodeId,
		path: [...write.path],
		reason: write.reason ?? null,
		source: write.source,
		storyTime: write.storyTime ?? null,
		confidence: write.confidence ?? null,
	} as const;
	if (write.op === "set") {
		return { ...base, op: "set", value: write.value };
	}
	return { ...base, op: "delete" };
}

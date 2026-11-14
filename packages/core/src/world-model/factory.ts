import type { StoryStore } from "../store/story-store.js";
import { createLedgerWorldModel } from "./ledger.js";
import {
	DEFAULT_WORLD_MODEL_KIND,
	type WorldModel,
	type WorldModelKind,
	assertWorldModelKind,
} from "./types.js";

/**
 * 按种类创建世界模型。`wiki` 与 `temporal_graph` 由 X1.b、X1.c 实现；
 * 未实现的种类在选择时直接失败，不回落到台账。
 */
export function createWorldModel(
	store: StoryStore,
	kind: WorldModelKind = DEFAULT_WORLD_MODEL_KIND,
): WorldModel {
	assertWorldModelKind(kind);
	switch (kind) {
		case "ledger":
			return createLedgerWorldModel(store);
		case "wiki":
			throw new Error("世界模型 wiki 尚未实现");
		case "temporal_graph":
			throw new Error("世界模型 temporal_graph 尚未实现");
	}
}

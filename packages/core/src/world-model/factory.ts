import type { StoryStore } from "../store/story-store.js";
import { createLedgerWorldModel } from "./ledger.js";
import {
	DEFAULT_WORLD_MODEL_KIND,
	type WorldModel,
	type WorldModelKind,
	assertWorldModelKind,
} from "./types.js";

/**
 * 按种类创建世界模型。只剩台账一种实现；旧库里存的 `wiki`、`temporal_graph`
 * 按台账处理（ADR-0166）。
 */
export function createWorldModel(
	store: StoryStore,
	kind: WorldModelKind = DEFAULT_WORLD_MODEL_KIND,
): WorldModel {
	assertWorldModelKind(kind);
	return createLedgerWorldModel(store);
}

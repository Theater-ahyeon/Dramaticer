import type { StoryStore } from "../store/story-store.js";
import { createLedgerWorldModel } from "./ledger.js";
import {
	DEFAULT_WORLD_MODEL_KIND,
	type WorldModel,
	type WorldModelKind,
	assertWorldModelKind,
} from "./types.js";
import { createWikiWorldModel } from "./wiki.js";

/**
 * 按种类创建世界模型。`temporal_graph` 由 X1.c 实现；
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
			return createWikiWorldModel(store);
		case "temporal_graph":
			throw new Error("世界模型 temporal_graph 尚未实现");
	}
}

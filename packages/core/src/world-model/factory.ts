import type { StoryStore } from "../store/story-store.js";
import { createLedgerWorldModel } from "./ledger.js";
import { createTemporalGraphWorldModel } from "./temporal-graph.js";
import {
	DEFAULT_WORLD_MODEL_KIND,
	type WorldModel,
	type WorldModelKind,
	assertWorldModelKind,
} from "./types.js";
import { createWikiWorldModel } from "./wiki.js";

/** 按种类创建世界模型；三个候选共用同一组读写方法。 */
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
			return createTemporalGraphWorldModel(store);
	}
}

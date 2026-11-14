import { isJsonObject } from "../json.js";
import { readLedger } from "../ledger/read.js";
import { type LedgerSource, validateLedgerDiff } from "../ledger/schema.js";
import type { StoryStore } from "../store/story-store.js";
import type { NewStateDiff, StoryTime } from "../timeline.js";
import {
	type WorldModel,
	type WorldModelReadOptions,
	type WorldModelSection,
	type WorldModelView,
	type WorldModelWrite,
	type WorldModelWriteResult,
	assertTimeQuerySupported,
} from "./types.js";

/** 档案修订在写入路径里的第一段；台账命名空间之外的写都进档案。 */
export const WIKI_PROFILE_NAMESPACE = "profile";

/** 一条实体档案修订；正文与出处楼层只追加，不覆盖。 */
export interface WikiRevision {
	readonly id: number;
	readonly storyId: string;
	readonly entityId: string;
	readonly nodeId: string;
	readonly text: string;
	readonly storyTime: StoryTime | null;
	readonly source: LedgerSource;
	readonly createdAt: string;
}

export interface NewWikiRevision {
	readonly storyId: string;
	readonly entityId: string;
	readonly nodeId: string;
	readonly text: string;
	readonly storyTime?: StoryTime | null;
	readonly source: LedgerSource;
	readonly createdAt?: string;
}

/**
 * 台账加实体档案：硬事实仍然进台账 diff，人物档案以只追加的正文版本
 * 叠加在台账之上。档案用 `["profile", <人物>]` 写入。
 */
export function createWikiWorldModel(store: StoryStore): WorldModel {
	return {
		kind: "wiki",
		read(nodeId: string, options?: WorldModelReadOptions): WorldModelView {
			assertTimeQuerySupported("wiki", options);
			const state = readLedger(store, nodeId);
			if (!isJsonObject(state)) {
				throw new Error(`台账快照 ${nodeId} 不是对象`);
			}
			const revisions = store.listWikiRevisionsAlongPath(nodeId);
			return {
				state,
				sections: buildProfileSections(revisions),
				source: `state:${store.countStateDiffsAlongPath(nodeId)} 条 diff，档案 ${revisions.length} 版`,
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
			const ledgerInputs: NewStateDiff[] = [];
			const profileInputs: NewWikiRevision[] = [];
			for (const write of writes) {
				if (write.path[0] === WIKI_PROFILE_NAMESPACE) {
					profileInputs.push(toProfileRevision(node.storyId, nodeId, write));
					continue;
				}
				validateLedgerDiff({
					path: write.path,
					op: write.op,
					value: write.value,
					storyTime: write.storyTime,
					source: write.source,
					confidence: write.confidence,
				});
				ledgerInputs.push(toStateDiff(node.storyId, nodeId, write));
			}
			assertProfileEntities(store, nodeId, writes, profileInputs);
			if (ledgerInputs.length > 0) store.appendStateDiffs(ledgerInputs);
			if (profileInputs.length > 0) store.appendWikiRevisions(profileInputs);
			return { written: ledgerInputs.length + profileInputs.length };
		},
	};
}

function buildProfileSections(
	revisions: readonly WikiRevision[],
): WorldModelSection[] {
	const byEntity = new Map<string, WikiRevision[]>();
	for (const revision of revisions) {
		const list = byEntity.get(revision.entityId);
		if (list === undefined) byEntity.set(revision.entityId, [revision]);
		else list.push(revision);
	}
	const sections: WorldModelSection[] = [];
	for (const entityId of [...byEntity.keys()].sort()) {
		const list = byEntity.get(entityId) ?? [];
		const latest = list[list.length - 1];
		const first = list[0];
		if (latest === undefined || first === undefined) continue;
		sections.push({
			title: `档案：${entityId}`,
			text: [
				latest.text,
				`版本数：${list.length}；出处楼层：${latest.nodeId}；最早出处：${first.nodeId}`,
			].join("\n"),
		});
	}
	return sections;
}

/**
 * 档案只能写给台账里已经存在的人物；同一批写入里新建的人物也算已存在。
 */
function assertProfileEntities(
	store: StoryStore,
	nodeId: string,
	writes: readonly WorldModelWrite[],
	profileInputs: readonly NewWikiRevision[],
): void {
	if (profileInputs.length === 0) return;
	const state = readLedger(store, nodeId);
	const characters = new Set<string>();
	const namespace = isJsonObject(state) ? state.character : undefined;
	if (isJsonObject(namespace)) {
		for (const id of Object.keys(namespace)) characters.add(id);
	}
	for (const write of writes) {
		if (write.path[0] !== "character" || write.path.length < 2) continue;
		const entityId = write.path[1];
		if (write.op === "delete") {
			if (write.path.length === 2) characters.delete(entityId);
			continue;
		}
		characters.add(entityId);
	}
	for (const input of profileInputs) {
		if (!characters.has(input.entityId)) {
			throw new Error(
				`档案路径 ${JSON.stringify([WIKI_PROFILE_NAMESPACE, input.entityId])} 的人物不存在：${input.entityId}`,
			);
		}
	}
}

function toProfileRevision(
	storyId: string,
	nodeId: string,
	write: WorldModelWrite,
): NewWikiRevision {
	const path = write.path;
	if (path.length !== 2) {
		throw new Error(
			`档案路径必须形如 ["profile", "<人物>"]，收到 ${JSON.stringify(path)}`,
		);
	}
	const entityId = path[1];
	if (typeof entityId !== "string" || entityId.trim().length === 0) {
		throw new Error(
			`档案路径 ${JSON.stringify(path)} 的人物 id 必须是非空字符串`,
		);
	}
	if (write.op !== "set") {
		throw new Error(`档案路径 ${JSON.stringify(path)} 只追加，不能删除或改写`);
	}
	if (typeof write.value !== "string" || write.value.trim().length === 0) {
		throw new Error(`档案 ${entityId} 的正文必须是非空字符串`);
	}
	return {
		storyId,
		entityId,
		nodeId,
		text: write.value,
		storyTime: write.storyTime ?? null,
		source: write.source,
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

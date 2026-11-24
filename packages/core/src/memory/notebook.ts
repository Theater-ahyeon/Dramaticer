import type {
	NotebookPastEntry,
	NotebookSection,
	NotebookVersion,
} from "../store/repos/memory.js";
import type { StoryStore } from "../store/story-store.js";
import { readMemoryState } from "./view.js";

export {
	NOTEBOOK_SECTIONS,
	type NotebookPastEntry,
	type NotebookSection,
	type NotebookVersion,
} from "../store/repos/memory.js";

// 故事记事（v5 §3.1）：每个实体一页，三节——底色（只追加）、现在（2–3 句，
// 场末刷新）、经历（带楼层锚点，只追加）。每个版本是整页快照，挂在产生它的
// 楼层上，沿当前路径取最近的版本；旧版本不改不删，回滚也是新版本（§3.4）。

/** 后台任务：旧故事打开后给当前路径上的实体建初版记事页（不调用模型）。 */
export const NOTEBOOK_INIT_JOB_KIND = "notebook_init";

/** 当前路径上是否还有实体没有记事页。 */
export function notebookInitNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	const head = store.getHead(storyId)?.id ?? null;
	if (head === null) return false;
	const pages = new Set(
		readNotebookPages(store, storyId, head).map((page) => page.entityId),
	);
	return store.listEntities(storyId).some((entity) => !pages.has(entity.id));
}

/** 当前路径上的一页记事。 */
export interface NotebookPage {
	readonly entityId: string;
	readonly name: string;
	readonly kind: string;
	readonly base: string;
	readonly now: string;
	readonly past: readonly NotebookPastEntry[];
	readonly locked: readonly NotebookSection[];
	readonly versionId: number;
	readonly nodeId: string | null;
	readonly source: NotebookVersion["source"];
}

/** 场末整理给一个人物的补丁；没有的字段不动。 */
export interface NotebookPatch {
	readonly who: string;
	/** 刷新「现在」，2–3 句。 */
	readonly now?: string | null;
	/** 这一场的一句经历。 */
	readonly past?: string | null;
	/** 不可逆的转折才写，追加到底色。 */
	readonly base?: string | null;
}

function pathIds(store: StoryStore, nodeId: string | null): Set<string> | null {
	if (nodeId === null) return null;
	return new Set(store.getPathToNode(nodeId).map((node) => node.id));
}

/** 某一页在这条路径上可见的版本（按创建顺序）。 */
function visible(
	versions: readonly NotebookVersion[],
	ids: ReadonlySet<string> | null,
): NotebookVersion[] {
	return versions.filter(
		(version) =>
			version.nodeId === null || ids === null || ids.has(version.nodeId),
	);
}

/** 沿当前路径读出每个实体最新的一版记事页；还没有版本的实体不出现。 */
export function readNotebookPages(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
): NotebookPage[] {
	const ids = pathIds(store, nodeId);
	const byEntity = new Map<string, NotebookVersion[]>();
	for (const version of store.listNotebookVersions(storyId)) {
		const list = byEntity.get(version.entityId) ?? [];
		list.push(version);
		byEntity.set(version.entityId, list);
	}
	const pages: NotebookPage[] = [];
	for (const entity of store.listEntities(storyId)) {
		const latest = visible(byEntity.get(entity.id) ?? [], ids).at(-1);
		if (latest === undefined) continue;
		pages.push(toPage(entity.name, entity.kind, latest));
	}
	return pages;
}

function toPage(
	name: string,
	kind: string,
	version: NotebookVersion,
): NotebookPage {
	return {
		entityId: version.entityId,
		name,
		kind,
		base: version.base,
		now: version.now,
		past: version.past,
		locked: version.locked,
		versionId: version.id,
		nodeId: version.nodeId,
		source: version.source,
	};
}

/** 一页在当前路径上的全部版本，新的在前；给界面回看与回滚。 */
export function listNotebookHistory(
	store: StoryStore,
	storyId: string,
	entityId: string,
	nodeId: string | null,
): NotebookVersion[] {
	return visible(
		store.listNotebookVersions(storyId, entityId),
		pathIds(store, nodeId),
	).reverse();
}

/**
 * 给当前路径上还没有记事页的实体建初版：底色取卡里的描述，现在取台账里的
 * 状态与位置，经历取当前路径上它在场的已归档场次。只用已有记录，不调用模型。
 * 返回新建的页数。
 */
export function ensureNotebookInit(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = store.getHead(storyId)?.id ?? null,
): number {
	if (nodeId === null) return 0;
	const existing = new Set(
		readNotebookPages(store, storyId, nodeId).map((page) => page.entityId),
	);
	const entities = store
		.listEntities(storyId)
		.filter((entity) => !existing.has(entity.id));
	if (entities.length === 0) return 0;
	const path = store.getPathToNode(nodeId);
	const floorOf = new Map(path.map((node, index) => [node.id, index + 1]));
	const archives = store.listSceneArchivesAlongPath(nodeId);
	const state = readMemoryState(store, storyId, nodeId);
	for (const entity of entities) {
		const now = state
			.filter(
				(item) =>
					item.path[0] === "character" &&
					item.path[1] === entity.name &&
					typeof item.value === "string",
			)
			.map((item) => describeField(item.item, String(item.value)))
			.join("，");
		const past: NotebookPastEntry[] = archives
			.filter((archive) => archive.present.includes(entity.name))
			.map((archive) => ({
				text: archive.summary,
				fromFloor: floorOf.get(archive.startNodeId) ?? null,
				toFloor: floorOf.get(archive.endNodeId) ?? null,
				nodeId: archive.endNodeId,
			}));
		store.appendNotebookVersion({
			storyId,
			entityId: entity.id,
			nodeId,
			base: entity.description.trim(),
			now: now.length === 0 ? "" : `${now}。`,
			past,
			locked: [],
			source: "init",
			note: "用已有记录建的初版",
		});
	}
	return entities.length;
}

function describeField(field: string, value: string): string {
	switch (field) {
		case "location":
			return `在${value}`;
		case "outfit":
			return `穿着${value}`;
		default:
			return value;
	}
}

/**
 * 场末补丁编译：每个补丁在这一页当前版本上新建一版——刷新「现在」、追加一条
 * 「经历」、底色只在不可逆转折时追加。玩家锁定的节跳过。同一场重编译时按
 * 场末楼层替换那一条经历，不重复追加。返回新建的版本数。
 */
export function applyNotebookPatches(
	store: StoryStore,
	storyId: string,
	scene: {
		readonly endNodeId: string;
		readonly startNodeId: string;
	},
	patches: readonly NotebookPatch[],
): number {
	if (patches.length === 0) return 0;
	ensureNotebookInit(store, storyId, scene.endNodeId);
	const path = store.getPathToNode(scene.endNodeId);
	const floorOf = new Map(path.map((node, index) => [node.id, index + 1]));
	const pages = new Map(
		readNotebookPages(store, storyId, scene.endNodeId).map((page) => [
			page.name,
			page,
		]),
	);
	let created = 0;
	for (const patch of patches) {
		const entity = store.findEntityByName(storyId, patch.who);
		if (entity === null) continue;
		const page = pages.get(entity.name);
		if (page === undefined) continue;
		const locked = new Set(page.locked);
		const now =
			locked.has("now") || !hasText(patch.now) ? page.now : patch.now.trim();
		const base =
			locked.has("base") || !hasText(patch.base)
				? page.base
				: [page.base, patch.base.trim()].filter(hasText).join("\n");
		const past =
			locked.has("past") || !hasText(patch.past)
				? page.past
				: [
						...page.past.filter((entry) => entry.nodeId !== scene.endNodeId),
						{
							text: patch.past.trim(),
							fromFloor: floorOf.get(scene.startNodeId) ?? null,
							toFloor: floorOf.get(scene.endNodeId) ?? null,
							nodeId: scene.endNodeId,
						},
					];
		if (
			now === page.now &&
			base === page.base &&
			JSON.stringify(past) === JSON.stringify(page.past)
		) {
			continue;
		}
		store.appendNotebookVersion({
			storyId,
			entityId: entity.id,
			nodeId: scene.endNodeId,
			base,
			now,
			past,
			locked: page.locked,
			source: "compile",
			note: "场末整理",
		});
		created += 1;
	}
	return created;
}

function hasText(value: string | null | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * 玩家直接改一节：新建一版，这一节自动锁定，之后的场末整理跳过它。
 * 「经历」按整节替换（界面逐条编辑后整节提交）。
 */
export function editNotebookSection(
	store: StoryStore,
	storyId: string,
	input: {
		readonly entityId: string;
		readonly section: NotebookSection;
		readonly text?: string;
		readonly past?: readonly NotebookPastEntry[];
		readonly locked?: boolean;
		readonly nodeId?: string | null;
	},
): NotebookVersion {
	const nodeId = input.nodeId ?? store.getHead(storyId)?.id ?? null;
	ensureNotebookInit(store, storyId, nodeId);
	const page = readNotebookPages(store, storyId, nodeId).find(
		(item) => item.entityId === input.entityId,
	);
	if (page === undefined) {
		throw new Error(`记事页不存在：${input.entityId}`);
	}
	const locked = new Set(page.locked);
	if (input.locked === false) locked.delete(input.section);
	else locked.add(input.section);
	return store.appendNotebookVersion({
		storyId,
		entityId: page.entityId,
		nodeId,
		base:
			input.section === "base" && input.text !== undefined
				? input.text.trim()
				: page.base,
		now:
			input.section === "now" && input.text !== undefined
				? input.text.trim()
				: page.now,
		past:
			input.section === "past" && input.past !== undefined
				? input.past
				: page.past,
		locked: [...locked],
		source: "player",
		note: input.locked === false ? "解锁" : "玩家修改",
	});
}

/** 回到某一版：追加一个内容相同的新版本，旧版本不动。 */
export function rollbackNotebook(
	store: StoryStore,
	storyId: string,
	versionId: number,
	nodeId: string | null = store.getHead(storyId)?.id ?? null,
): NotebookVersion {
	const target = store
		.listNotebookVersions(storyId)
		.find((version) => version.id === versionId);
	if (target === undefined) {
		throw new Error(`记事页版本不存在：${versionId}`);
	}
	return store.appendNotebookVersion({
		storyId,
		entityId: target.entityId,
		nodeId,
		base: target.base,
		now: target.now,
		past: target.past,
		locked: target.locked,
		source: "rollback",
		note: `回到第 ${versionId} 版`,
	});
}

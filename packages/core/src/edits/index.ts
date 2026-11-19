import { type JsonValue, isJsonObject } from "../json.js";
import { isLedgerNamespace, validateLedgerDiff } from "../ledger/schema.js";
import type { LoreEntry } from "../memory/lore.js";
import type { StoryStore } from "../store/story-store.js";

/**
 * 玩家可以直接修改的对象种类。每一种的 `target` 是对象在自己那一类里的键：
 * 状态是路径的 JSON，其余是对象 id。
 */
export const PLAYER_EDIT_KINDS = [
	"state",
	"secret",
	"wiki",
	"summary",
	"pref",
	"lore",
	"line",
	"scene",
	"outline",
	"writing",
	"card",
] as const;

export type PlayerEditKind = (typeof PLAYER_EDIT_KINDS)[number];

/** 写入者：玩家、恢复原样，或被锁定挡下的后台写入（只留痕，不生效）。 */
export type PlayerEditSource = "player" | "restore" | "ai" | "rejected";

/**
 * 一次修改。修改只追加：当前值是当前路径上最后一条生效的修改，
 * 历史就是这张表，回滚是再追加一条内容相同的修改。
 */
export interface PlayerEdit {
	readonly id: number;
	readonly storyId: string;
	/** 修改从哪一楼起生效；null 表示对整个故事生效。 */
	readonly nodeId: string | null;
	readonly kind: PlayerEditKind;
	readonly target: string;
	/** 修改后的内容；null 表示回到原样（没有覆盖）。 */
	readonly value: JsonValue | null;
	readonly locked: boolean;
	/** 删除是停用：对象还在，只是不再使用。 */
	readonly disabled: boolean;
	readonly source: PlayerEditSource;
	readonly note: string | null;
	readonly createdAt: string;
}

export interface NewPlayerEdit {
	readonly storyId: string;
	readonly nodeId?: string | null;
	readonly kind: PlayerEditKind;
	readonly target: string;
	readonly value?: JsonValue | null;
	readonly locked?: boolean;
	readonly disabled?: boolean;
	readonly source?: PlayerEditSource;
	readonly note?: string | null;
}

export function isPlayerEditKind(value: unknown): value is PlayerEditKind {
	return (
		typeof value === "string" &&
		(PLAYER_EDIT_KINDS as readonly string[]).includes(value)
	);
}

/** 根到给定楼层（不给时是当前 head）的楼层 id；分支隔离靠它。 */
export function editPathIds(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
): ReadonlySet<string> {
	const anchor = nodeId ?? store.getHead(storyId)?.id ?? null;
	if (anchor === null) return new Set();
	return new Set(store.getPathToNode(anchor).map((node) => node.id));
}

/** 某一类对象在当前路径上生效的修改；每个对象只留最后一条。 */
export function readEffectiveEdits(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	kind: PlayerEditKind,
): Map<string, PlayerEdit> {
	const ids = editPathIds(store, storyId, nodeId);
	const result = new Map<string, PlayerEdit>();
	for (const edit of store.listPlayerEdits(storyId, { kind })) {
		if (edit.source === "rejected") continue;
		if (edit.nodeId !== null && !ids.has(edit.nodeId)) continue;
		result.set(edit.target, edit);
	}
	return result;
}

/** 一个对象在当前路径上的修改历史，从旧到新；被挡下的后台写入也列出。 */
export function readEditHistory(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	kind: PlayerEditKind,
	target: string,
): PlayerEdit[] {
	const ids = editPathIds(store, storyId, nodeId);
	return store
		.listPlayerEdits(storyId, { kind, target })
		.filter((edit) => edit.nodeId === null || ids.has(edit.nodeId));
}

/**
 * 后台或 AI 想改一个对象：锁定时拒绝并留痕，返回 false；
 * 调用方拿到 false 只能把内容当作建议。
 */
export function guardBackgroundWrite(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	kind: PlayerEditKind,
	target: string,
	attempted: JsonValue | null,
	writer: string,
): boolean {
	const current = readEffectiveEdits(store, storyId, nodeId, kind).get(target);
	if (current === undefined) return true;
	if (!current.locked) {
		// 没锁的对象交还给后台：撤掉玩家的覆盖，后台这次写的内容才看得见。
		if (current.value !== null || current.disabled) {
			store.savePlayerEdit({
				storyId,
				nodeId,
				kind,
				target,
				value: null,
				source: "ai",
				note: `${writer} 更新了这一项`,
			});
		}
		return true;
	}
	store.savePlayerEdit({
		storyId,
		nodeId,
		kind,
		target,
		value: attempted,
		locked: true,
		source: "rejected",
		note: `${writer} 的写入被锁定挡下`,
	});
	return false;
}

/** 回滚到历史里的某一条：追加一条内容相同的修改。 */
export function rollbackPlayerEdit(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	editId: number,
): PlayerEdit {
	const source = store
		.listPlayerEdits(storyId)
		.find((edit) => edit.id === editId);
	if (source === undefined) throw new Error(`修改记录不存在：${editId}`);
	if (source.source === "rejected") {
		throw new Error(`被拒绝的写入不能回滚：#${editId}`);
	}
	const anchor = nodeId ?? store.getHead(storyId)?.id ?? null;
	if (
		source.nodeId !== null &&
		!editPathIds(store, storyId, anchor).has(source.nodeId)
	) {
		throw new Error(`修改记录 #${editId} 不在这条分支上`);
	}
	if (source.kind === "state") {
		applyStateEdit(store, storyId, anchor, source.target, source.value);
	} else if (source.kind === "pref") {
		applyPrefEdit(
			store,
			storyId,
			anchor,
			source.target,
			source.disabled ? null : source.value,
		);
	}
	return store.savePlayerEdit({
		storyId,
		nodeId: anchor,
		kind: source.kind,
		target: source.target,
		value: source.value,
		locked: true,
		disabled: source.disabled,
		source: "player",
		note: `回滚到 #${editId}`,
	});
}

export function stateTargetOf(path: readonly string[]): string {
	return JSON.stringify(path);
}

function applyStateEdit(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	target: string,
	value: JsonValue | null,
): void {
	const anchor = nodeId ?? store.getHead(storyId)?.id ?? null;
	if (anchor === null) throw new Error("故事还没有楼层，无法修改状态");
	const path = JSON.parse(target) as string[];
	const diff =
		value === null
			? ({ path, op: "delete", source: "player" } as const)
			: ({ path, op: "set", value, source: "player" } as const);
	// 玩家的修改走与后台相同的格式校验（I12）。
	if (isLedgerNamespace(path[0] ?? "")) validateLedgerDiff(diff);
	store.appendStateDiffs([
		{ ...diff, storyId, nodeId: anchor, reason: "玩家直接修改" },
	]);
}

/** 偏好存在台账的 userWill 里；回滚要同时把台账恢复到那一版。 */
function applyPrefEdit(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	id: string,
	value: JsonValue | null,
): void {
	const anchor = nodeId ?? store.getHead(storyId)?.id ?? null;
	if (anchor === null) throw new Error("故事还没有楼层，无法修改偏好");
	const path = ["userWill", id];
	const diff =
		value === null
			? ({ path, op: "delete", source: "player" } as const)
			: ({ path, op: "set", value, source: "player" } as const);
	validateLedgerDiff(diff);
	store.appendStateDiffs([
		{ ...diff, storyId, nodeId: anchor, reason: "玩家回滚偏好" },
	]);
}

/** 玩家直接改一个状态值：校验、写入台账、记一条修改并锁定。 */
export function editState(
	store: StoryStore,
	storyId: string,
	nodeId: string | null,
	path: readonly string[],
	value: JsonValue | null,
): PlayerEdit {
	if (path.length === 0) throw new Error("状态路径不能为空");
	const target = stateTargetOf(path);
	applyStateEdit(store, storyId, nodeId, target, value);
	return store.savePlayerEdit({
		storyId,
		nodeId: nodeId ?? store.getHead(storyId)?.id ?? null,
		kind: "state",
		target,
		value,
		locked: true,
		source: "player",
	});
}

/** 设定条目在这个故事里的样子：卡里的原样、玩家的修改、是否停用。 */
export interface LoreCopyEntry {
	readonly entry: LoreEntry;
	readonly original: LoreEntry;
	readonly edited: boolean;
	readonly disabled: boolean;
	readonly locked: boolean;
}

/**
 * 故事自己的设定副本：导入时每个故事已经各有一份条目，玩家的修改叠在上面，
 * 原条目不动，所以恢复原卡就是追加一条「回到原样」。
 */
export function readLoreCopy(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = null,
): LoreCopyEntry[] {
	const edits = readEffectiveEdits(store, storyId, nodeId, "lore");
	return store.listLoreEntries(storyId).map((original) => {
		const edit = edits.get(original.id);
		const value = isJsonObject(edit?.value) ? edit.value : null;
		const entry: LoreEntry =
			value === null
				? original
				: {
						...original,
						name: typeof value.name === "string" ? value.name : original.name,
						content:
							typeof value.content === "string"
								? value.content
								: original.content,
						constant:
							typeof value.constant === "boolean"
								? value.constant
								: original.constant,
						keywords: Array.isArray(value.keywords)
							? value.keywords.filter(
									(item): item is string => typeof item === "string",
								)
							: original.keywords,
					};
		return {
			entry,
			original,
			edited: value !== null,
			disabled: edit?.disabled === true,
			locked: edit?.locked === true,
		};
	});
}

/** 上下文组装用的设定：带上玩家的修改，去掉停用的条目。 */
export function readEffectiveLore(
	store: StoryStore,
	storyId: string,
	nodeId: string | null = null,
): LoreEntry[] {
	if (store.listPlayerEdits(storyId, { kind: "lore" }).length === 0) {
		return store.listLoreEntries(storyId);
	}
	return readLoreCopy(store, storyId, nodeId)
		.filter((item) => !item.disabled)
		.map((item) => item.entry);
}

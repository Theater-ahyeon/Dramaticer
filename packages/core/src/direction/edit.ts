import {
	type BlueprintDiff,
	type BlueprintEntry,
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintTension,
	type BlueprintVolume,
	assertBlueprintTension,
} from "../blueprint/index.js";
import type { DirectorLine } from "../director/lines.js";
import { readEffectiveEdits } from "../edits/index.js";
import type { JsonValue } from "../json.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import { editSceneGoal, readSceneGoal } from "../ledger/scene-goal.js";
import type { StoryStore } from "../store/story-store.js";
import { type DirectionEditResult, readDirectionView } from "./view.js";

/** 剧情走向页的写入命令。 */
export const DIRECTION_EDIT_OPS = [
	"add-want",
	"edit-want",
	"lock-want",
	"delete-want",
	"set-tension",
	"edit-open",
	"lock-open",
	"close-open",
] as const;

export type DirectionEditOp = (typeof DIRECTION_EDIT_OPS)[number];

export type DirectionEdit =
	| { readonly op: "add-want"; readonly text: string }
	| { readonly op: "edit-want"; readonly id: string; readonly text: string }
	| { readonly op: "lock-want"; readonly id: string; readonly locked: boolean }
	| { readonly op: "delete-want"; readonly id: string }
	| { readonly op: "set-tension"; readonly tension: BlueprintTension }
	| { readonly op: "edit-open"; readonly id: string; readonly text: string }
	| { readonly op: "lock-open"; readonly id: string; readonly locked: boolean }
	| { readonly op: "close-open"; readonly id: string };

function readText(
	value: unknown,
	label: string,
	options: { readonly allowEmpty?: boolean } = {},
): string {
	if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
	const text = value.trim();
	if (text.length === 0 && options.allowEmpty !== true) {
		throw new Error(`${label} 不能是空字符串`);
	}
	return text;
}

/** 校验一条写入命令；字段路径写进错误信息。 */
export function assertDirectionEdit(value: unknown): DirectionEdit {
	const record = assertPlainObject(value, "走向修改");
	const raw = record.op;
	if (
		typeof raw !== "string" ||
		!(DIRECTION_EDIT_OPS as readonly string[]).includes(raw)
	) {
		throw new Error(
			`走向修改.op 只能是 ${DIRECTION_EDIT_OPS.join("、")}，收到 ${JSON.stringify(raw)}`,
		);
	}
	// 已按上面的清单校验过；收窄成联合类型供后续分支使用。
	const op = raw as DirectionEditOp;
	if (op === "add-want") {
		rejectUnknownKeys(record, ["op", "text"], "走向修改");
		return { op, text: readText(record.text, "走向修改.text") };
	}
	if (op === "set-tension") {
		rejectUnknownKeys(record, ["op", "tension"], "走向修改");
		return {
			op,
			tension: assertBlueprintTension(record.tension, "走向修改.tension"),
		};
	}
	if (op === "edit-want" || op === "edit-open") {
		rejectUnknownKeys(record, ["op", "id", "text"], "走向修改");
		return {
			op,
			id: readText(record.id, "走向修改.id"),
			text: readText(record.text, "走向修改.text", { allowEmpty: true }),
		};
	}
	if (op === "lock-want" || op === "lock-open") {
		rejectUnknownKeys(record, ["op", "id", "locked"], "走向修改");
		if (typeof record.locked !== "boolean") {
			throw new Error("走向修改.locked 必须是布尔值");
		}
		return {
			op,
			id: readText(record.id, "走向修改.id"),
			locked: record.locked,
		};
	}
	rejectUnknownKeys(record, ["op", "id"], "走向修改");
	return { op, id: readText(record.id, "走向修改.id") };
}

function splitId(id: string, allowed: readonly string[], label: string) {
	const index = id.indexOf(":");
	if (index <= 0) {
		throw new Error(`${label} 缺少种类与对象 id：${id}`);
	}
	const kind = id.slice(0, index);
	const key = id.slice(index + 1);
	if (!allowed.includes(kind) || key.length === 0) {
		throw new Error(`${label} 的 id 不合法：${id}`);
	}
	return { kind, key };
}

function headNode(store: StoryStore, storyId: string): string {
	const head = store.getHead(storyId);
	if (head === null) {
		throw new Error("故事还没有楼层，先写第一楼再加方向");
	}
	return head.id;
}

function requireEntry<T extends BlueprintEntry>(
	entries: readonly BlueprintEntry[],
	kind: T["kind"],
	id: string,
	label: string,
): T {
	const entry = entries.find(
		(candidate) => candidate.kind === kind && candidate.id === id,
	);
	if (entry === undefined) throw new Error(`${label}不存在：${id}`);
	return entry as T;
}

function saveWants(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	diffs: readonly BlueprintDiff[],
): void {
	store.saveStoryBlueprint({ nodeId, storyId, source: "player", diffs });
}

function emptyPremise(): BlueprintPremise {
	return {
		id: "premise",
		kind: "premise",
		source: "player",
		locked: true,
		coreQuestion: "",
		tone: "",
		endings: [],
		redLines: [],
		tension: "loose",
	};
}

function editPremise(
	premise: BlueprintPremise,
	id: string,
	text: string,
): BlueprintPremise {
	const next: BlueprintPremise = { ...premise, source: "player", locked: true };
	if (id === "premise:question") return { ...next, coreQuestion: text };
	if (id === "premise:tone") return { ...next, tone: text };
	return {
		...next,
		redLines: text
			.split(/[；;]/)
			.map((item) => item.trim())
			.filter((item) => item !== ""),
	};
}

function currentLine(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
): DirectorLine {
	const state = store
		.readDirectorLineStates(nodeId)
		.find((item) => item.line.id === id);
	if (state === undefined) throw new Error(`剧情线不存在：${id}`);
	return state.line;
}

function writeLine(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	line: DirectorLine,
	locked: boolean,
): void {
	store.savePlayerEdit({
		storyId,
		nodeId,
		kind: "line",
		target: line.id,
		value: JSON.parse(JSON.stringify(line)) as JsonValue,
		locked,
	});
}

function closeLine(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
): void {
	const current = readEffectiveEdits(store, storyId, nodeId, "line").get(id);
	store.savePlayerEdit({
		storyId,
		nodeId,
		kind: "line",
		target: id,
		value: current?.value ?? null,
		locked: current?.locked ?? false,
		disabled: true,
	});
}

function parseLineText(
	current: DirectorLine,
	text: string,
): Pick<DirectorLine, "who" | "want"> {
	if (current.who === "玩家") return { who: current.who, want: text };
	const index = text.indexOf("想要");
	if (index > 0) {
		const who = text.slice(0, index).trim();
		const want = text.slice(index + 2).trim();
		if (who.length > 0 && want.length > 0) return { who, want };
	}
	return { who: current.who, want: text };
}

function requireNote(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
): void {
	const note = store.getOpenPlotNotes(storyId).find((item) => item.id === id);
	if (note === undefined) throw new Error(`场记笔记不存在或已经收下：${id}`);
	const onPath = store
		.getPathToNode(nodeId)
		.some((item) => item.id === note.sourceNodeId);
	if (!onPath) throw new Error(`场记笔记不在当前分支上：${id}`);
}

function editWant(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
	text: string,
): void {
	if (id.startsWith("premise:")) {
		const entries = store.readBlueprintEntries(nodeId);
		const premise =
			entries.find(
				(entry): entry is BlueprintPremise => entry.kind === "premise",
			) ?? emptyPremise();
		saveWants(store, storyId, nodeId, [
			{ action: "set", entry: editPremise(premise, id, text) },
		]);
		return;
	}
	if (id === "scene") {
		const goal = readSceneGoal(store, storyId, nodeId);
		if (goal === null) throw new Error("这一场还没有本场目标");
		if (text.length === 0) throw new Error("本场目标不能是空字符串");
		editSceneGoal(
			store,
			storyId,
			nodeId,
			{ present: goal.present, change: text },
			{ locked: true },
		);
		return;
	}
	const parsed = splitId(id, ["volume", "milestone", "line"], "方向");
	if (parsed.kind === "volume") {
		const entries = store.readBlueprintEntries(nodeId);
		const volume = requireEntry<BlueprintVolume>(
			entries,
			"volume",
			parsed.key,
			"卷",
		);
		saveWants(store, storyId, nodeId, [
			{
				action: "set",
				entry: { ...volume, source: "player", locked: true, title: text },
			},
		]);
		return;
	}
	if (parsed.kind === "milestone") {
		const entries = store.readBlueprintEntries(nodeId);
		const milestone = requireEntry<BlueprintMilestone>(
			entries,
			"milestone",
			parsed.key,
			"关键事件",
		);
		saveWants(store, storyId, nodeId, [
			{
				action: "set",
				entry: { ...milestone, source: "player", locked: true, want: text },
			},
		]);
		return;
	}
	if (parsed.kind === "line") {
		const current = currentLine(store, storyId, nodeId, parsed.key);
		writeLine(
			store,
			storyId,
			nodeId,
			{ ...current, ...parseLineText(current, text) },
			true,
		);
	}
}

function lockWant(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
	locked: boolean,
): void {
	if (id.startsWith("premise:")) {
		const entries = store.readBlueprintEntries(nodeId);
		const premise =
			entries.find(
				(entry): entry is BlueprintPremise => entry.kind === "premise",
			) ?? emptyPremise();
		saveWants(store, storyId, nodeId, [
			{ action: "set", entry: { ...premise, locked } },
		]);
		return;
	}
	if (id === "scene") {
		const goal = readSceneGoal(store, storyId, nodeId);
		if (goal === null) throw new Error("这一场还没有本场目标");
		editSceneGoal(
			store,
			storyId,
			nodeId,
			{ present: goal.present, change: goal.change },
			{ locked },
		);
		return;
	}
	const parsed = splitId(id, ["volume", "milestone", "line"], "方向");
	if (parsed.kind === "volume" || parsed.kind === "milestone") {
		const entries = store.readBlueprintEntries(nodeId);
		const entry = requireEntry<BlueprintEntry>(
			entries,
			parsed.kind,
			parsed.key,
			parsed.kind === "volume" ? "卷" : "关键事件",
		);
		saveWants(store, storyId, nodeId, [
			{ action: "set", entry: { ...entry, locked } },
		]);
		return;
	}
	if (parsed.kind === "line") {
		const current = currentLine(store, storyId, nodeId, parsed.key);
		const edit = readEffectiveEdits(store, storyId, nodeId, "line").get(
			parsed.key,
		);
		const value =
			edit?.value ?? (JSON.parse(JSON.stringify(current)) as JsonValue);
		store.savePlayerEdit({
			storyId,
			nodeId,
			kind: "line",
			target: parsed.key,
			value,
			locked,
		});
	}
}

function deleteWant(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
): void {
	const parsed = splitId(id, ["volume", "milestone", "line"], "方向");
	if (parsed.kind === "line") {
		closeLine(store, storyId, nodeId, parsed.key);
		return;
	}
	const entries = store.readBlueprintEntries(nodeId);
	if (parsed.kind === "milestone") {
		requireEntry<BlueprintMilestone>(
			entries,
			"milestone",
			parsed.key,
			"关键事件",
		);
		saveWants(store, storyId, nodeId, [{ action: "delete", id: parsed.key }]);
		return;
	}
	const volume = requireEntry<BlueprintVolume>(
		entries,
		"volume",
		parsed.key,
		"卷",
	);
	const diffs: BlueprintDiff[] = [{ action: "delete", id: volume.id }];
	for (const entry of entries) {
		if (entry.kind === "milestone" && entry.volumeId === volume.id) {
			diffs.push({ action: "delete", id: entry.id });
		}
	}
	saveWants(store, storyId, nodeId, diffs);
}

function noteValue(text: string): JsonValue {
	return { text };
}

function editOpen(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
	text: string,
): void {
	const parsed = splitId(id, ["line", "note"], "线索");
	if (parsed.kind === "line") {
		const current = currentLine(store, storyId, nodeId, parsed.key);
		writeLine(
			store,
			storyId,
			nodeId,
			{ ...current, ...parseLineText(current, text) },
			true,
		);
		return;
	}
	requireNote(store, storyId, nodeId, parsed.key);
	if (text.length === 0) throw new Error("这条线不能是空字符串");
	store.savePlayerEdit({
		storyId,
		nodeId,
		kind: "note",
		target: parsed.key,
		value: noteValue(text),
		locked: true,
	});
}

function lockOpen(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
	locked: boolean,
): void {
	const parsed = splitId(id, ["line", "note"], "线索");
	if (parsed.kind === "line") {
		lockWant(store, storyId, nodeId, `line:${parsed.key}`, locked);
		return;
	}
	requireNote(store, storyId, nodeId, parsed.key);
	const edit = readEffectiveEdits(store, storyId, nodeId, "note").get(
		parsed.key,
	);
	store.savePlayerEdit({
		storyId,
		nodeId,
		kind: "note",
		target: parsed.key,
		value: edit?.value ?? null,
		locked,
	});
}

function closeOpen(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	id: string,
): void {
	const parsed = splitId(id, ["line", "note"], "线索");
	if (parsed.kind === "line") {
		closeLine(store, storyId, nodeId, parsed.key);
		return;
	}
	requireNote(store, storyId, nodeId, parsed.key);
	store.savePlayerEdit({
		storyId,
		nodeId,
		kind: "note",
		target: parsed.key,
		value: null,
		disabled: true,
	});
}

/** 调整约束档位；没有总纲时先建一条。 */
function setTension(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	tension: BlueprintTension,
): void {
	const entries = store.readBlueprintEntries(nodeId);
	const premise =
		entries.find(
			(entry): entry is BlueprintPremise => entry.kind === "premise",
		) ?? emptyPremise();
	saveWants(store, storyId, nodeId, [
		{ action: "set", entry: { ...premise, source: "player", tension } },
	]);
}

/** 玩家写下的一条新方向：作为主线方向存进剧情线，并按规则自动锁定。 */
function addWant(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	text: string,
): void {
	const line: DirectorLine = {
		id: `want-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
		kind: "main",
		who: "玩家",
		want: text,
		obstacle: "还没有定",
		countdown: null,
		preparations: [],
	};
	writeLine(store, storyId, nodeId, line, true);
}

/** 执行一条写入命令，返回写入后重新读出的两栏内容。 */
export function applyDirectionEdit(
	store: StoryStore,
	storyId: string,
	value: unknown,
): DirectionEditResult {
	if (store.getStory(storyId) === null) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const edit = assertDirectionEdit(value);
	const nodeId = headNode(store, storyId);
	if (edit.op === "add-want") addWant(store, storyId, nodeId, edit.text);
	else if (edit.op === "edit-want") {
		editWant(store, storyId, nodeId, edit.id, edit.text);
	} else if (edit.op === "lock-want") {
		lockWant(store, storyId, nodeId, edit.id, edit.locked);
	} else if (edit.op === "delete-want") {
		deleteWant(store, storyId, nodeId, edit.id);
	} else if (edit.op === "set-tension") {
		setTension(store, storyId, nodeId, edit.tension);
	} else if (edit.op === "edit-open") {
		editOpen(store, storyId, nodeId, edit.id, edit.text);
	} else if (edit.op === "lock-open") {
		lockOpen(store, storyId, nodeId, edit.id, edit.locked);
	} else {
		closeOpen(store, storyId, nodeId, edit.id);
	}
	return { storyId, view: readDirectionView(store, storyId) };
}

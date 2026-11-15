import { assertPlainObject, rejectUnknownKeys } from "../json.js";

/** 蓝图的三层：总纲、卷、里程碑。 */
export const BLUEPRINT_ENTRY_KINDS = [
	"premise",
	"volume",
	"milestone",
] as const;

export type BlueprintEntryKind = (typeof BLUEPRINT_ENTRY_KINDS)[number];

export const BLUEPRINT_ENTRY_KIND_LABELS: Record<BlueprintEntryKind, string> = {
	premise: "总纲",
	volume: "卷",
	milestone: "里程碑",
};

/** 每条蓝图的出处：玩家写的、AI 补的。 */
export const BLUEPRINT_SOURCES = ["player", "ai"] as const;

export type BlueprintSource = (typeof BLUEPRINT_SOURCES)[number];

export const BLUEPRINT_SOURCE_LABELS: Record<BlueprintSource, string> = {
	player: "玩家",
	ai: "AI",
};

/** 蓝图拉力三档：松、中、紧。导演按它调整候选动作的顺序。 */
export const BLUEPRINT_TENSIONS = ["loose", "medium", "tight"] as const;

export type BlueprintTension = (typeof BLUEPRINT_TENSIONS)[number];

export const BLUEPRINT_TENSION_LABELS: Record<BlueprintTension, string> = {
	loose: "松",
	medium: "中",
	tight: "紧",
};

/** 没有写拉力时的默认档位；旧记录读出来也按这一档补齐。 */
export const DEFAULT_BLUEPRINT_TENSION: BlueprintTension = "medium";

/** 里程碑的硬性与软性。 */
export const BLUEPRINT_MILESTONE_HARDNESS = ["hard", "soft"] as const;

export type BlueprintMilestoneHardness =
	(typeof BLUEPRINT_MILESTONE_HARDNESS)[number];

export const BLUEPRINT_MILESTONE_HARDNESS_LABELS: Record<
	BlueprintMilestoneHardness,
	string
> = {
	hard: "硬性",
	soft: "软性",
};

export const BLUEPRINT_DIFF_ACTIONS = ["set", "delete"] as const;

export type BlueprintDiffAction = (typeof BLUEPRINT_DIFF_ACTIONS)[number];

/** 一个楼层最多的蓝图修改条数。 */
export const MAX_BLUEPRINT_DIFFS_PER_FLOOR = 50;

/** 蓝图条目 id 的最大长度。 */
export const MAX_BLUEPRINT_ID_CHARS = 64;

/** 蓝图里单个文本字段的最大长度。 */
export const MAX_BLUEPRINT_TEXT_CHARS = 500;

/** 一个列表字段最多的条数。 */
export const MAX_BLUEPRINT_LIST_ITEMS = 12;

interface BlueprintEntryBase {
	/** 故事内唯一，里程碑的先后约束按它引用。 */
	readonly id: string;
	readonly source: BlueprintSource;
	/** 锁定的条目只接受玩家修改，AI 的修改直接拒绝。 */
	readonly locked: boolean;
}

/** 总纲：核心问题、基调、候选结局、红线与拉力。 */
export interface BlueprintPremise extends BlueprintEntryBase {
	readonly kind: "premise";
	readonly coreQuestion: string;
	readonly tone: string;
	readonly endings: readonly string[];
	readonly redLines: readonly string[];
	/** 拉力：松、中、紧；只影响导演的候选顺序，不改变玩家当轮的行动。 */
	readonly tension: BlueprintTension;
}

/** 一卷：这一卷的核心问题与起止状态。 */
export interface BlueprintVolume extends BlueprintEntryBase {
	readonly kind: "volume";
	readonly title: string;
	readonly coreQuestion: string;
	readonly startState: string;
	readonly endState: string;
}

/** 一个里程碑：希望发生的事、前提条件、先后约束与硬性程度。 */
export interface BlueprintMilestone extends BlueprintEntryBase {
	readonly kind: "milestone";
	/** 所属的卷。 */
	readonly volumeId: string;
	readonly want: string;
	readonly prerequisites: readonly string[];
	/** 必须在这几个里程碑之后发生。 */
	readonly after: readonly string[];
	readonly hardness: BlueprintMilestoneHardness;
}

export type BlueprintEntry =
	| BlueprintPremise
	| BlueprintVolume
	| BlueprintMilestone;

/** 楼层上的一条蓝图修改；`set` 带完整条目，`delete` 只带 id。 */
export type BlueprintDiff =
	| { readonly action: "set"; readonly entry: BlueprintEntry }
	| { readonly action: "delete"; readonly id: string };

/**
 * 一个楼层上的一批蓝图修改。同一楼层可以有多批：玩家逐条接受建议时，
 * 每接受一条就追加一批，`seq` 从 1 起递增。
 */
export interface StoryBlueprintRecord {
	readonly nodeId: string;
	/** 这一批在该楼层上的顺序，从 1 起递增。 */
	readonly seq: number;
	readonly storyId: string;
	/** 写这一批修改的是谁：玩家或 AI。 */
	readonly source: BlueprintSource;
	readonly diffs: readonly BlueprintDiff[];
	readonly createdAt: string;
}

export interface NewStoryBlueprintRecordInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly source: BlueprintSource;
	readonly diffs: readonly BlueprintDiff[];
	readonly createdAt?: string;
}

/** 沿路径累加后的一版蓝图；条目与楼层上写的 diff 一起回看。 */
export interface BlueprintVersion {
	readonly nodeId: string;
	/** 这一版对应的批次序号。 */
	readonly seq: number;
	readonly source: BlueprintSource;
	readonly diffs: readonly BlueprintDiff[];
	readonly createdAt: string;
	/** 这个楼层写完之后沿路径累加到该楼层得到的条目。 */
	readonly entries: readonly BlueprintEntry[];
}

/** 回滚到某一版：把该版本楼层的蓝图照原样写成一个新的楼层记录。 */
export interface BlueprintRollbackInput {
	/** 写入回滚记录的目标楼层。 */
	readonly nodeId: string;
	readonly storyId: string;
	/** 要回到的那一版所在的楼层。 */
	readonly versionNodeId: string;
	/** 该楼层上的批次序号；省略时取这个楼层的最后一批。 */
	readonly versionSeq?: number;
	readonly createdAt?: string;
}

const ENTRY_KEYS: Record<BlueprintEntryKind, readonly string[]> = {
	premise: [
		"id",
		"kind",
		"source",
		"locked",
		"coreQuestion",
		"tone",
		"endings",
		"redLines",
		"tension",
	],
	volume: [
		"id",
		"kind",
		"source",
		"locked",
		"title",
		"coreQuestion",
		"startState",
		"endState",
	],
	milestone: [
		"id",
		"kind",
		"source",
		"locked",
		"volumeId",
		"want",
		"prerequisites",
		"after",
		"hardness",
	],
};

export function isBlueprintEntryKind(
	value: unknown,
): value is BlueprintEntryKind {
	return (
		typeof value === "string" &&
		(BLUEPRINT_ENTRY_KINDS as readonly string[]).includes(value)
	);
}

export function isBlueprintSource(value: unknown): value is BlueprintSource {
	return (
		typeof value === "string" &&
		(BLUEPRINT_SOURCES as readonly string[]).includes(value)
	);
}

export function isBlueprintTension(value: unknown): value is BlueprintTension {
	return (
		typeof value === "string" &&
		(BLUEPRINT_TENSIONS as readonly string[]).includes(value)
	);
}

/** 校验拉力档位；旧记录没有这个字段时按默认档位补齐。 */
export function assertBlueprintTension(
	value: unknown,
	label = "蓝图拉力",
): BlueprintTension {
	if (value === undefined) return DEFAULT_BLUEPRINT_TENSION;
	if (!isBlueprintTension(value)) {
		throw new Error(
			`${label} 只能是 ${BLUEPRINT_TENSIONS.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

export function assertBlueprintSource(
	value: unknown,
	label = "蓝图来源",
): BlueprintSource {
	if (!isBlueprintSource(value)) {
		throw new Error(
			`${label}只能是 ${BLUEPRINT_SOURCES.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

/** 校验一个条目 id；首尾空白去掉后必须非空且不超过上限。 */
export function readBlueprintId(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const id = value.trim();
	if (id.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	if (id.length > MAX_BLUEPRINT_ID_CHARS) {
		throw new Error(`${label} 不能超过 ${MAX_BLUEPRINT_ID_CHARS} 字`);
	}
	return id;
}

/**
 * 文本字段可以先留空：玩家用自然语言写到一半、AI 还要补全的条目都是合法状态。
 */
function readText(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const text = value.trim();
	if (text.length > MAX_BLUEPRINT_TEXT_CHARS) {
		throw new Error(`${label} 不能超过 ${MAX_BLUEPRINT_TEXT_CHARS} 字`);
	}
	return text;
}

function readTextList(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	if (value.length > MAX_BLUEPRINT_LIST_ITEMS) {
		throw new Error(`${label} 最多 ${MAX_BLUEPRINT_LIST_ITEMS} 条`);
	}
	const seen = new Set<string>();
	return value.map((item, index) => {
		const text = readText(item, `${label}[${index}]`);
		if (text.length === 0) {
			throw new Error(`${label}[${index}] 必须是非空字符串`);
		}
		if (seen.has(text)) {
			throw new Error(`${label}[${index}] 与前面的条目重复`);
		}
		seen.add(text);
		return text;
	});
}

function assertBlueprintEntryLocked(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`${label} 必须是布尔值`);
	}
	return value;
}

/** 校验一条蓝图；字段路径写进错误信息。 */
export function assertBlueprintEntry(
	value: unknown,
	label: string,
): BlueprintEntry {
	const record = assertPlainObject(value, label);
	const kind = record.kind;
	if (!isBlueprintEntryKind(kind)) {
		throw new Error(
			`${label}.kind 只能是 ${BLUEPRINT_ENTRY_KINDS.join("、")}，收到 ${JSON.stringify(kind)}`,
		);
	}
	rejectUnknownKeys(record, ENTRY_KEYS[kind], label);
	const base = {
		id: readBlueprintId(record.id, `${label}.id`),
		source: assertBlueprintSource(record.source, `${label}.source`),
		locked: assertBlueprintEntryLocked(record.locked, `${label}.locked`),
	};
	switch (kind) {
		case "premise":
			return {
				...base,
				kind,
				coreQuestion: readText(record.coreQuestion, `${label}.coreQuestion`),
				tone: readText(record.tone, `${label}.tone`),
				endings: readTextList(record.endings, `${label}.endings`),
				redLines: readTextList(record.redLines, `${label}.redLines`),
				tension: assertBlueprintTension(record.tension, `${label}.tension`),
			};
		case "volume":
			return {
				...base,
				kind,
				title: readText(record.title, `${label}.title`),
				coreQuestion: readText(record.coreQuestion, `${label}.coreQuestion`),
				startState: readText(record.startState, `${label}.startState`),
				endState: readText(record.endState, `${label}.endState`),
			};
		case "milestone": {
			const hardness = record.hardness;
			if (
				typeof hardness !== "string" ||
				!(BLUEPRINT_MILESTONE_HARDNESS as readonly string[]).includes(hardness)
			) {
				throw new Error(
					`${label}.hardness 只能是 ${BLUEPRINT_MILESTONE_HARDNESS.join("、")}，收到 ${JSON.stringify(hardness)}`,
				);
			}
			const after = readTextList(record.after, `${label}.after`).map(
				(id, index) => readBlueprintId(id, `${label}.after[${index}]`),
			);
			return {
				...base,
				kind,
				volumeId: readBlueprintId(record.volumeId, `${label}.volumeId`),
				want: readText(record.want, `${label}.want`),
				prerequisites: readTextList(
					record.prerequisites,
					`${label}.prerequisites`,
				),
				after,
				hardness: hardness as BlueprintMilestoneHardness,
			};
		}
	}
}

/** 先后约束不能成环，否则里程碑永远排不出顺序。 */
function assertMilestoneOrderAcyclic(
	milestones: readonly BlueprintMilestone[],
	label: string,
): void {
	const byId = new Map(milestones.map((entry) => [entry.id, entry] as const));
	const visiting = new Set<string>();
	const done = new Set<string>();
	const visit = (id: string, trail: readonly string[]): void => {
		if (done.has(id)) return;
		if (visiting.has(id)) {
			throw new Error(`${label} 的先后约束成环：${[...trail, id].join(" → ")}`);
		}
		visiting.add(id);
		const entry = byId.get(id);
		if (entry) {
			for (const after of entry.after) visit(after, [...trail, id]);
		}
		visiting.delete(id);
		done.add(id);
	};
	for (const entry of milestones) visit(entry.id, []);
}

/**
 * 校验一整套蓝图：id 不重复、总纲只有一条、里程碑指向存在的卷、
 * 先后约束指向存在的里程碑且不成环。
 */
export function assertBlueprintEntries(
	value: unknown,
	label = "蓝图条目",
): BlueprintEntry[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	const entries = value.map((item, index) =>
		assertBlueprintEntry(item, `${label}[${index}]`),
	);
	const byId = new Map<string, BlueprintEntry>();
	for (const entry of entries) {
		if (byId.has(entry.id)) {
			throw new Error(`${label} 的 id 重复：${entry.id}`);
		}
		byId.set(entry.id, entry);
	}
	const premiseCount = entries.filter(
		(entry) => entry.kind === "premise",
	).length;
	if (premiseCount > 1) {
		throw new Error(`${label} 里总纲最多一条，收到 ${premiseCount} 条`);
	}
	const milestones: BlueprintMilestone[] = [];
	for (const entry of entries) {
		if (entry.kind !== "milestone") continue;
		const volume = byId.get(entry.volumeId);
		if (volume === undefined || volume.kind !== "volume") {
			throw new Error(
				`${label} 的里程碑 ${entry.id} 指向的卷 ${entry.volumeId} 不存在`,
			);
		}
		milestones.push(entry);
	}
	for (const entry of milestones) {
		for (const afterId of entry.after) {
			if (afterId === entry.id) {
				throw new Error(`${label} 的里程碑 ${entry.id} 不能把自己列为先后约束`);
			}
			const target = byId.get(afterId);
			if (target === undefined || target.kind !== "milestone") {
				throw new Error(
					`${label} 的里程碑 ${entry.id} 的先后约束 ${afterId} 不存在`,
				);
			}
		}
	}
	assertMilestoneOrderAcyclic(milestones, label);
	return entries;
}

/**
 * 蓝图里的拉力档位；没有总纲时为 null，导演据此保持常规行为。
 */
export function readBlueprintTension(
	entries: readonly BlueprintEntry[],
): BlueprintTension | null {
	const premise = entries.find(
		(entry): entry is BlueprintPremise => entry.kind === "premise",
	);
	return premise === undefined ? null : premise.tension;
}

/** 校验一条蓝图修改；`set` 必须带完整条目，`delete` 只带 id。 */
export function assertBlueprintDiff(
	value: unknown,
	label: string,
): BlueprintDiff {
	const record = assertPlainObject(value, label);
	const action = record.action;
	if (
		typeof action !== "string" ||
		!(BLUEPRINT_DIFF_ACTIONS as readonly string[]).includes(action)
	) {
		throw new Error(
			`${label}.action 只能是 set 或 delete，收到 ${JSON.stringify(action)}`,
		);
	}
	if (action === "delete") {
		rejectUnknownKeys(record, ["action", "id"], label);
		return {
			action: "delete",
			id: readBlueprintId(record.id, `${label}.id`),
		};
	}
	rejectUnknownKeys(record, ["action", "entry"], label);
	return {
		action: "set",
		entry: assertBlueprintEntry(record.entry, `${label}.entry`),
	};
}

/** 校验一个楼层的蓝图修改数组；最多 50 条。 */
export function assertBlueprintDiffs(
	value: unknown,
	label: string,
): BlueprintDiff[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	if (value.length > MAX_BLUEPRINT_DIFFS_PER_FLOOR) {
		throw new Error(`${label} 最多 ${MAX_BLUEPRINT_DIFFS_PER_FLOOR} 条`);
	}
	return value.map((diff, index) =>
		assertBlueprintDiff(diff, `${label}[${index}]`),
	);
}

/**
 * 依次应用一个楼层的蓝图修改；后写的楼层覆盖先前的内容。
 * 结果必须仍然是一套合法的蓝图，否则整批修改被拒绝。
 */
export function applyBlueprintDiffs(
	entries: readonly BlueprintEntry[],
	diffs: readonly BlueprintDiff[],
	label = "蓝图修改",
): BlueprintEntry[] {
	const base = assertBlueprintEntries(entries, `${label}之前的蓝图`);
	const parsed = assertBlueprintDiffs(diffs, `${label}的 diffs`);
	const map = new Map(base.map((entry) => [entry.id, entry] as const));
	for (const diff of parsed) {
		if (diff.action === "set") {
			map.set(diff.entry.id, diff.entry);
		} else {
			map.delete(diff.id);
		}
	}
	return assertBlueprintEntries(
		[...map.values()].sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
		),
		`${label}之后的蓝图`,
	);
}

/**
 * 锁定的条目只接受玩家修改：AI 的 set 与 delete 都被拒绝，
 * 包括把 locked 改成 false。玩家写的修改不受限制。
 */
export function assertBlueprintWriteAllowed(
	entries: readonly BlueprintEntry[],
	diffs: readonly BlueprintDiff[],
	source: BlueprintSource,
	label = "蓝图修改",
): void {
	const parsedSource = assertBlueprintSource(source, `${label}的来源`);
	const base = assertBlueprintEntries(entries, `${label}之前的蓝图`);
	const parsed = assertBlueprintDiffs(diffs, `${label}的 diffs`);
	if (parsedSource === "player") return;
	const byId = new Map(base.map((entry) => [entry.id, entry] as const));
	for (const diff of parsed) {
		const id = diff.action === "set" ? diff.entry.id : diff.id;
		const existing = byId.get(id);
		if (existing?.locked) {
			throw new Error(
				`${label}来自 AI，不能改动锁定的${BLUEPRINT_ENTRY_KIND_LABELS[existing.kind]}：${id}`,
			);
		}
	}
}

/**
 * 把当前蓝图回滚到某一版需要的修改：多出来的条目删除，内容不同的条目重写。
 * 已经是那一版时返回空数组；写入仍由调用方以玩家来源保存。
 */
export function planBlueprintRollback(
	current: readonly BlueprintEntry[],
	target: readonly BlueprintEntry[],
	label = "蓝图回滚",
): BlueprintDiff[] {
	const from = assertBlueprintEntries(current, `${label}之前的蓝图`);
	const to = assertBlueprintEntries(target, `${label}目标的蓝图`);
	const fromById = new Map(from.map((entry) => [entry.id, entry] as const));
	const toById = new Map(to.map((entry) => [entry.id, entry] as const));
	const diffs: BlueprintDiff[] = [];
	for (const id of [...fromById.keys()].sort()) {
		if (!toById.has(id)) diffs.push({ action: "delete", id });
	}
	for (const id of [...toById.keys()].sort()) {
		const targetEntry = toById.get(id) as BlueprintEntry;
		const currentEntry = fromById.get(id);
		if (
			currentEntry &&
			JSON.stringify(currentEntry) === JSON.stringify(targetEntry)
		) {
			continue;
		}
		diffs.push({ action: "set", entry: targetEntry });
	}
	return diffs;
}

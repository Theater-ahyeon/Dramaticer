import {
	type MilestoneDeviation,
	readMilestoneDeviation,
} from "../blueprint/deviations.js";
import {
	type BlueprintHiddenCounts,
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintSource,
	type BlueprintSpoilerMode,
	type BlueprintTension,
	type BlueprintVolume,
	readBlueprintTension,
	readBlueprintView,
} from "../blueprint/index.js";
import { resolveCanonCursor } from "../canon/cursor.js";
import { listEffectiveCanonTimeline } from "../canon/edits.js";
import type { CanonWindowMode } from "../canon/types.js";
import type { DirectorLineKind, DirectorLineState } from "../director/lines.js";
import { DIRECTOR_LINE_KIND_LABELS } from "../director/lines.js";
import { readEffectiveEdits } from "../edits/index.js";
import { isJsonObject } from "../json.js";
import { readSceneGoal } from "../ledger/scene-goal.js";
import { readStoryPromiseLimit } from "../settings/features.js";
import type { StoryStore } from "../store/story-store.js";

/** 「想发生的」一栏里的条目种类。 */
export const DIRECTION_WANT_KINDS = [
	"premise",
	"volume",
	"milestone",
	"line",
	"scene",
] as const;

export type DirectionWantKind = (typeof DIRECTION_WANT_KINDS)[number];

/** 「还没收的线」一栏里的条目种类。 */
export const DIRECTION_OPEN_KINDS = ["line", "note"] as const;

export type DirectionOpenKind = (typeof DIRECTION_OPEN_KINDS)[number];

/**
 * 「想发生的」一行。`id` 是这类行在编辑命令里的键：`premise:question`、
 * `volume:<id>`、`milestone:<id>`、`line:<id>`、`scene`。
 */
export interface DirectionWantItem {
	readonly id: string;
	readonly kind: DirectionWantKind;
	/** 行的类别名，界面直接显示。 */
	readonly label: string;
	readonly text: string;
	/** 补充说明；没有时为 null。 */
	readonly detail: string | null;
	readonly source: BlueprintSource;
	readonly locked: boolean;
	/** 已经发生（里程碑达成）。 */
	readonly done: boolean;
	/** 里程碑所属的卷，其余为 null。 */
	readonly volumeId: string | null;
	readonly deletable: boolean;
}

/** 「还没收的线」一行：剧情线或场记笔记。 */
export interface DirectionOpenItem {
	/** `line:<id>` 或 `note:<id>`。 */
	readonly id: string;
	readonly kind: DirectionOpenKind;
	readonly label: string;
	readonly text: string;
	readonly detail: string | null;
	readonly source: BlueprintSource;
	readonly locked: boolean;
	readonly muted: boolean;
	/** 引入时的助手楼层深度；越老越小。 */
	readonly introducedDepth: number;
}

/** 推进菜单里的一个方向：从走向页的两栏里取，越老越靠前。 */
export interface PushDirection {
	/** 对应走向页那一行的 id。 */
	readonly id: string;
	readonly text: string;
	readonly detail: string | null;
	readonly from: "want" | "open" | "canon";
}

/** 剧情走向页上的原著位置；没有绑定原著时为 null。 */
export interface CanonDirectionView {
	readonly bookId: string;
	readonly bookTitle: string;
	readonly eventId: number;
	readonly eventOrdinal: number;
	readonly chapterOrdinal: number;
	readonly title: string;
	readonly summary: string;
	readonly upcoming: readonly {
		readonly id: number;
		readonly title: string;
		readonly summary: string;
	}[];
	readonly pendingAdvance: number;
	readonly windowMode: CanonWindowMode;
	readonly allowFullBookSpoilers: boolean;
}

/** 剧情走向一页：两栏与约束、剧透设置。 */
export interface DirectionView {
	readonly storyId: string;
	readonly nodeId: string | null;
	readonly spoilers: BlueprintSpoilerMode;
	readonly tension: BlueprintTension;
	readonly wants: readonly DirectionWantItem[];
	readonly opens: readonly DirectionOpenItem[];
	/** 推进菜单里给玩家点选的 2–3 个方向。 */
	readonly pushDirections: readonly PushDirection[];
	readonly hidden: BlueprintHiddenCounts | null;
	readonly maxOpenPromises: number;
	/** 故事已经有楼层，可以新增方向。 */
	readonly canAdd: boolean;
	/** 原著故事当前演到的事件与接下来几件。 */
	readonly canon: CanonDirectionView | null;
}

/** 编辑命令返回的结果：写入后重新读出的整页内容。 */
export interface DirectionEditResult {
	readonly storyId: string;
	readonly view: DirectionView;
}

const OPEN_LINE_KINDS: readonly DirectorLineKind[] = [
	"relationship",
	"opposition",
	"promise",
];

const OPEN_LINE_LABELS: Record<string, string> = DIRECTOR_LINE_KIND_LABELS;

function lineText(state: DirectorLineState): string {
	const line = state.line;
	if (line.who === "玩家") return line.want;
	return `${line.who}想要${line.want}`;
}

function lineDetail(state: DirectorLineState): string {
	return `阻碍：${state.line.obstacle}`;
}

function pathDepths(store: StoryStore, nodeId: string): Map<string, number> {
	const depths = new Map<string, number>();
	let depth = 0;
	for (const node of store.getPathToNode(nodeId)) {
		if (node.role === "assistant") depth += 1;
		depths.set(node.id, depth);
	}
	return depths;
}

function premiseItems(premise: BlueprintPremise | null): DirectionWantItem[] {
	const source = premise?.source ?? "player";
	const locked = premise?.locked ?? true;
	const base = {
		kind: "premise" as const,
		source,
		locked,
		done: false,
		volumeId: null,
		deletable: false,
	};
	return [
		{
			...base,
			id: "premise:question",
			label: "核心问题",
			text: premise?.coreQuestion ?? "",
			detail: null,
		},
		{
			...base,
			id: "premise:tone",
			label: "基调",
			text: premise?.tone ?? "",
			detail: null,
		},
		{
			...base,
			id: "premise:red-lines",
			label: "不要发生",
			text: premise?.redLines.join("；") ?? "",
			detail: null,
		},
	];
}

function volumeItem(volume: BlueprintVolume): DirectionWantItem {
	return {
		id: `volume:${volume.id}`,
		kind: "volume",
		label: "卷",
		text: volume.title,
		detail: volume.coreQuestion,
		source: volume.source,
		locked: volume.locked,
		done: false,
		volumeId: volume.id,
		deletable: true,
	};
}

function milestoneItem(
	milestone: BlueprintMilestone,
	deviation: MilestoneDeviation | undefined,
): DirectionWantItem {
	const prerequisites =
		milestone.prerequisites.length === 0
			? null
			: `要先埋：${milestone.prerequisites.join("；")}`;
	// 只有受阻与已不可能才把原因摆出来；仍可达的说明没有信息量。
	const blocked =
		deviation !== undefined &&
		(deviation.state === "blocked" || deviation.state === "lost");
	return {
		id: `milestone:${milestone.id}`,
		kind: "milestone",
		label: "关键事件",
		text: milestone.want,
		detail: blocked ? deviation.reason : prerequisites,
		source: milestone.source,
		locked: milestone.locked,
		done: deviation?.state === "achieved",
		volumeId: milestone.volumeId,
		deletable: true,
	};
}

/** 推进菜单最多给几个方向。 */
export const MAX_PUSH_DIRECTIONS = 3;

/**
 * 推进菜单的方向：还没收的线越老越靠前，再补上「想发生的」里还没达成的
 * 关键事件、主线方向与本场目标。两条线都为空时没有方向可点。
 */
function pushDirectionsFromView(
	wants: readonly DirectionWantItem[],
	opens: readonly DirectionOpenItem[],
): PushDirection[] {
	const openPicks: PushDirection[] = opens
		.filter((item) => !item.muted && item.text !== "")
		.map((item) => ({
			id: item.id,
			text: item.text,
			detail: item.detail,
			from: "open" as const,
		}));
	const wantPicks: PushDirection[] = wants
		.filter(
			(item) =>
				!item.done &&
				item.text !== "" &&
				(item.kind === "milestone" ||
					item.kind === "line" ||
					item.kind === "scene"),
		)
		.map((item) => ({
			id: item.id,
			text: item.text,
			detail: item.detail,
			from: "want" as const,
		}));
	const picks: PushDirection[] = [];
	const seen = new Set<string>();
	const push = (item: PushDirection | undefined): void => {
		if (item === undefined || seen.has(item.text)) return;
		seen.add(item.text);
		picks.push(item);
	};
	push(openPicks[0]);
	push(wantPicks[0]);
	for (const item of [...openPicks.slice(1), ...wantPicks.slice(1)]) {
		if (picks.length >= MAX_PUSH_DIRECTIONS) break;
		push(item);
	}
	return picks;
}

/**
 * 读出剧情走向：把大纲、主线方向、本场目标合成「想发生的」，把其余剧情线
 * 与未收的场记笔记合成「还没收的线」。只读派生，两栏里的每一项仍由原来的
 * 存储负责写入，旧故事不需要迁移数据就能得到完整两栏。
 */
export function readDirectionView(
	store: StoryStore,
	storyId: string,
	nodeId?: string | null,
): DirectionView {
	const story = store.getStory(storyId);
	if (story === null) throw new Error(`故事不存在：${storyId}`);
	const head = nodeId ?? store.getHead(storyId)?.id ?? null;
	if (head !== null) {
		const node = store.getNode(head);
		if (node === null) throw new Error(`楼层节点不存在：${head}`);
		if (node.storyId !== storyId) {
			throw new Error(`楼层节点 ${head} 属于另一个故事 ${node.storyId}`);
		}
	}
	const settings = store.getStorySettings(storyId);
	const entries =
		head === null
			? store.readStoryBlueprintBaseline(storyId)
			: store.readBlueprintEntries(head);
	const visible = readBlueprintView(entries, settings.blueprintSpoilers);
	const premise =
		visible.entries.find(
			(entry): entry is BlueprintPremise => entry.kind === "premise",
		) ?? null;
	const volumes = visible.entries.filter(
		(entry): entry is BlueprintVolume => entry.kind === "volume",
	);
	const milestones = visible.entries.filter(
		(entry): entry is BlueprintMilestone => entry.kind === "milestone",
	);
	const deviations = new Map(
		(head === null ? [] : readMilestoneDeviation(store, storyId, head)).map(
			(item) => [item.milestoneId, item] as const,
		),
	);

	const states = head === null ? [] : store.readDirectorLineStates(head);
	const lineEdits =
		head === null
			? new Map()
			: readEffectiveEdits(store, storyId, head, "line");
	const muted =
		head === null
			? new Set<string>()
			: new Set(
					store.listMutedDirectorLines(storyId).map((item) => item.lineId),
				);
	const depths =
		head === null ? new Map<string, number>() : pathDepths(store, head);
	const noteEdits =
		head === null
			? new Map()
			: readEffectiveEdits(store, storyId, head, "note");

	const wants: DirectionWantItem[] = [
		...(premise === null && (visible.hidden?.premise ?? 0) > 0
			? []
			: premiseItems(premise)),
	];
	for (const volume of volumes) {
		wants.push(volumeItem(volume));
		for (const milestone of milestones) {
			if (milestone.volumeId !== volume.id) continue;
			wants.push(milestoneItem(milestone, deviations.get(milestone.id)));
		}
	}
	const mainLines = states
		.filter((state) => state.line.kind === "main")
		.sort((left, right) =>
			left.openedDepth === right.openedDepth
				? left.line.id < right.line.id
					? -1
					: 1
				: left.openedDepth - right.openedDepth,
		);
	for (const state of mainLines) {
		wants.push({
			id: `line:${state.line.id}`,
			kind: "line",
			label: "方向",
			text: lineText(state),
			detail: lineDetail(state),
			source: lineEdits.get(state.line.id)?.value != null ? "player" : "ai",
			locked: lineEdits.get(state.line.id)?.locked === true,
			done: false,
			volumeId: null,
			deletable: true,
		});
	}
	const goal = head === null ? null : readSceneGoal(store, storyId, head);
	if (goal !== null) {
		wants.push({
			id: "scene",
			kind: "scene",
			label: "本场",
			text: goal.change,
			detail:
				goal.present.length === 0
					? null
					: goal.present
							.map((actor) => `${actor.who}想要${actor.want}`)
							.join("；"),
			source: goal.source,
			locked: goal.locked,
			done: false,
			volumeId: null,
			deletable: false,
		});
	}

	const opens: DirectionOpenItem[] = [];
	const retired =
		head === null
			? new Set<string>()
			: new Set(
					store
						.listDirectorChapterReviewsAlongPath(head)
						.flatMap((review) =>
							review.payload.promises
								.filter((decision) => decision.disposition === "retire")
								.map((decision) => decision.lineId),
						),
				);
	for (const state of states) {
		if (!OPEN_LINE_KINDS.includes(state.line.kind)) continue;
		if (retired.has(state.line.id)) continue;
		const edit = lineEdits.get(state.line.id);
		opens.push({
			id: `line:${state.line.id}`,
			kind: "line",
			label: OPEN_LINE_LABELS[state.line.kind] ?? "剧情线",
			text: lineText(state),
			detail: lineDetail(state),
			source: edit?.value != null ? "player" : "ai",
			locked: edit?.locked === true,
			muted: muted.has(state.line.id),
			introducedDepth: state.openedDepth,
		});
	}
	if (head !== null) {
		for (const note of store.getOpenPlotNotes(storyId)) {
			const noteDepth = depths.get(note.sourceNodeId);
			if (noteDepth === undefined) continue;
			const edit = noteEdits.get(note.id);
			if (edit?.disabled === true) continue;
			const value =
				isJsonObject(edit?.value) && typeof edit.value.text === "string"
					? edit.value.text
					: undefined;
			opens.push({
				id: `note:${note.id}`,
				kind: "note",
				label: "场记",
				text: typeof value === "string" ? value : note.text,
				detail: null,
				source: typeof value === "string" ? "player" : "ai",
				locked: edit?.locked === true,
				muted: false,
				introducedDepth: noteDepth,
			});
		}
	}
	opens.sort((left, right) =>
		left.introducedDepth === right.introducedDepth
			? left.id < right.id
				? -1
				: 1
			: left.introducedDepth - right.introducedDepth,
	);

	const resolvedCanon =
		head === null ? null : resolveCanonCursor(store, storyId, head);
	const book =
		resolvedCanon === null
			? null
			: store.getCanonBook(resolvedCanon.binding.bookId);
	const canonTimeline =
		resolvedCanon === null
			? []
			: listEffectiveCanonTimeline(store, storyId, head);
	const canonCurrent =
		resolvedCanon === null ? undefined : canonTimeline[resolvedCanon.index];
	const canon: CanonDirectionView | null =
		resolvedCanon === null || canonCurrent === undefined
			? null
			: {
					bookId: resolvedCanon.binding.bookId,
					bookTitle: book?.title ?? "",
					eventId: canonCurrent.event.id,
					eventOrdinal: resolvedCanon.eventOrdinal,
					chapterOrdinal: resolvedCanon.chapterOrdinal,
					title: canonCurrent.event.title,
					summary: canonCurrent.event.summary,
					upcoming: canonTimeline
						.slice(resolvedCanon.index + 1, resolvedCanon.index + 4)
						.map((entry) => ({
							id: entry.event.id,
							title: entry.event.title,
							summary: entry.event.summary,
						})),
					pendingAdvance: resolvedCanon.binding.pendingAdvance,
					windowMode: resolvedCanon.binding.windowMode,
					allowFullBookSpoilers: resolvedCanon.binding.allowFullBookSpoilers,
				};
	const canonPicks: PushDirection[] =
		resolvedCanon === null
			? []
			: canonTimeline
					.slice(resolvedCanon.index, resolvedCanon.index + MAX_PUSH_DIRECTIONS)
					.map((entry) => ({
						id: `canon:${entry.event.id}`,
						text: entry.event.title,
						detail: entry.event.summary,
						from: "canon" as const,
					}));
	return {
		storyId,
		nodeId: head,
		spoilers: settings.blueprintSpoilers,
		tension: readBlueprintTension(entries) ?? "loose",
		wants,
		opens,
		pushDirections: [
			...canonPicks,
			...pushDirectionsFromView(wants, opens),
		].slice(0, MAX_PUSH_DIRECTIONS),
		hidden: visible.hidden,
		maxOpenPromises: readStoryPromiseLimit(store, storyId),
		canAdd: head !== null,
		canon,
	};
}

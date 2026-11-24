import type { ContextItemSource } from "../context/assembler.js";
import { type JsonValue, isJsonObject } from "../json.js";
import { readSceneGoal } from "../ledger/scene-goal.js";
import type { StoryStore } from "../store/story-store.js";
import { type TokenEstimator, createTokenEstimator } from "../tokens.js";
import { readNotebookPages } from "./notebook.js";
import {
	type MemoryStateItem,
	compileWikiPages,
	readMemorySecrets,
	readMemoryState,
} from "./view.js";

// v5 §3.1：此刻局面卡与世界索引。都由程序从已有的状态、在场者、秘密与记事
// 拼成自然语言，不调用模型；进上下文时每行都带出处，Trace 能定位到修改处。

/** 局面卡的 token 上限（v5 §3.1）；超出时先丢优先级低的行。 */
export const SITUATION_MAX_TOKENS = 500;

/** 世界索引的字数上限，约 200 字；超出时按最近出场排序截断。 */
export const WORLD_INDEX_MAX_CHARS = 240;

const CHARACTER_FIELDS: readonly { field: string; label: string }[] = [
	{ field: "status", label: "" },
	{ field: "location", label: "在" },
	{ field: "outfit", label: "穿" },
];

const DEAD = /死|亡|身故|遇害|阵亡/;

/** 局面卡按结构渲染的台账命名空间；其余路径原样列出。 */
const KNOWN_NAMESPACES: ReadonlySet<string> = new Set([
	"character",
	"relation",
	"item",
	"scene",
	"time",
	"clue",
	"knowledge",
	"userWill",
	"mvu",
	"rule",
]);

export interface SituationLine {
	readonly text: string;
	readonly source: ContextItemSource;
	/** 数字越小越先保留。 */
	readonly priority: number;
}

export interface SituationCard {
	/** 分节标题与正文，已按预算裁剪。 */
	readonly text: string;
	readonly lines: readonly SituationLine[];
	readonly tokens: number;
	/** 卡自带状态体系（MVU 等）时只保留卡没覆盖的部分。 */
	readonly cardStateful: boolean;
}

function textOf(value: JsonValue | undefined): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length === 0 ? null : trimmed;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return null;
}

function stateSource(item: MemoryStateItem, label: string): ContextItemSource {
	return { kind: "state", target: item.target, label };
}

/** 按 owner（character.<名>）分组的状态项。 */
function groupByOwner(
	items: readonly MemoryStateItem[],
): Map<string, Map<string, MemoryStateItem>> {
	const groups = new Map<string, Map<string, MemoryStateItem>>();
	for (const item of items) {
		const key = item.path.slice(0, -1).join("\u0000");
		const fields = groups.get(key) ?? new Map<string, MemoryStateItem>();
		fields.set(item.item, item);
		groups.set(key, fields);
	}
	return groups;
}

/**
 * 把当前路径上的状态、在场者、场面目标与秘密渲染成局面卡。没有任何可写的
 * 内容时返回 null。秘密只出现在「知情边界」一节里，并写明谁不知道；人物
 * 自己的那一行只写状态、位置与衣着，不带秘密内容。
 */
export function renderSituationCard(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	options: {
		readonly maxTokens?: number;
		readonly estimator?: TokenEstimator;
	} = {},
): SituationCard | null {
	const estimator = options.estimator ?? createTokenEstimator();
	const maxTokens = options.maxTokens ?? SITUATION_MAX_TOKENS;
	const items = readMemoryState(store, storyId, nodeId);
	const cardStateful = items.some((item) => item.path[0] === "mvu");
	const groups = groupByOwner(items);
	const lines: SituationLine[] = [];
	const log = store.getLatestSceneLogOnPath(nodeId);
	const present = log?.present ?? [];

	if (!cardStateful) {
		const time = items.find(
			(item) => item.path[0] === "time" && item.item === "current",
		);
		const place = items.find(
			(item) =>
				item.path[0] === "scene" &&
				item.path[1] === "current" &&
				item.item === "place",
		);
		const where = [
			time === undefined ? null : textOf(time.value),
			place === undefined ? null : textOf(place.value),
		].filter((value): value is string => value !== null);
		if (where.length > 0) {
			const anchor = time ?? place;
			if (anchor !== undefined) {
				lines.push({
					text: `时间地点：${where.join("，")}`,
					source: stateSource(anchor, "时间地点"),
					priority: 0,
				});
			}
		}
	}

	// 在场者：有场记时按场记，没有时取最近有状态的人物。
	const characters = [...groups.entries()]
		.filter(([key]) => key.startsWith("character\u0000"))
		.map(([key, fields]) => ({ name: key.split("\u0000")[1] ?? "", fields }));
	const presentSet = new Set(present);
	const shown =
		present.length > 0
			? present.map((name) => ({
					name,
					fields:
						characters.find((item) => item.name === name)?.fields ??
						new Map<string, MemoryStateItem>(),
				}))
			: characters
					.sort(
						(left, right) =>
							Math.max(...[...right.fields.values()].map((f) => f.floorNo)) -
							Math.max(...[...left.fields.values()].map((f) => f.floorNo)),
					)
					.slice(0, 4);
	for (const person of shown) {
		const details = cardStateful
			? []
			: CHARACTER_FIELDS.flatMap(({ field, label }) => {
					const value = textOf(person.fields.get(field)?.value);
					return value === null ? [] : [`${label}${value}`];
				});
		const first = [...person.fields.values()][0];
		lines.push({
			text: `${presentSet.has(person.name) ? "在场" : "人物"}：${person.name}${details.length > 0 ? `（${details.join("，")}）` : ""}`,
			source:
				first === undefined
					? {
							kind: "state",
							target: `character|${person.name}`,
							label: person.name,
						}
					: stateSource(first, person.name),
			priority: presentSet.has(person.name) ? 1 : 3,
		});
	}

	if (!cardStateful) {
		for (const [key, fields] of groups) {
			if (!key.startsWith("item\u0000")) continue;
			const name = key.split("\u0000")[1] ?? "";
			const holder = textOf(fields.get("holder")?.value);
			const where = textOf(fields.get("location")?.value);
			const detail = [
				holder === null ? null : `在${holder}手里`,
				where === null ? null : `在${where}`,
			].filter((value): value is string => value !== null);
			const first = [...fields.values()][0];
			if (first === undefined || detail.length === 0) continue;
			lines.push({
				text: `物品：${name}${detail.join("，")}`,
				source: stateSource(first, name),
				priority: 4,
			});
		}
	}

	// 正文模型自己用 state_update 记的、台账命名空间以外的状态（I13）照样带上。
	for (const item of items) {
		if (KNOWN_NAMESPACES.has(item.path[0] ?? "")) continue;
		const value = textOf(item.value) ?? JSON.stringify(item.value);
		const label = item.path.join(" · ");
		lines.push({
			text: `${label}：${value}`,
			source: stateSource(item, label),
			priority: 3,
		});
	}

	const goal = readSceneGoal(store, storyId, nodeId);
	if (goal !== null) {
		lines.push({
			text: `当前冲突：${goal.present.map((actor) => `${actor.who}想要${actor.want}`).join("；")}；这一场要改变的是${goal.change}`,
			source: { kind: "scene", nodeId },
			priority: 2,
		});
	}

	const dead = characters.filter((person) => {
		const status = textOf(person.fields.get("status")?.value);
		return status !== null && DEAD.test(status);
	});
	if (dead.length > 0) {
		const first = [...(dead[0]?.fields.values() ?? [])][0];
		if (first !== undefined) {
			lines.push({
				text: `已死之人：${dead.map((person) => person.name).join("、")}`,
				source: stateSource(first, "已死之人"),
				priority: 1,
			});
		}
	}

	const secrets = readMemorySecrets(store, storyId, nodeId)
		.filter((secret) => secret.unaware.length > 0)
		.slice(-6);
	for (const secret of secrets) {
		lines.push({
			text: `知情边界：「${secret.text}」——${secret.knowers.length > 0 ? `${secret.knowers.join("、")}知道；` : ""}${secret.unaware.join("、")}不知道`,
			source: {
				kind: "state",
				target: `secret|${secret.id}`,
				label: "知情边界",
			},
			priority: 2,
		});
	}

	// 卡自带的变量（MVU 等）原样带上：它们只从这里进上下文，卡的提示词按自己的
	// 写法读它们；不计入 500 token 的裁剪，体积由卡自己决定。
	const snapshot = store.getStateSnapshot(nodeId).state as unknown;
	const cardVariables =
		cardStateful && isJsonObject(snapshot) && snapshot.mvu !== undefined
			? {
					text: `卡的变量：${JSON.stringify({ mvu: snapshot.mvu })}`,
					source: {
						kind: "state",
						target: JSON.stringify(["mvu"]),
						label: "卡的变量",
					} as ContextItemSource,
					priority: 0,
				}
			: null;
	if (lines.length === 0 && cardVariables === null) return null;
	const kept = [
		...(lines.length === 0 ? [] : trimToBudget(lines, maxTokens, estimator)),
		...(cardVariables === null ? [] : [cardVariables]),
	];
	const text = ["此刻局面：", ...kept.map((line) => `- ${line.text}`)].join(
		"\n",
	);
	return { text, lines: kept, tokens: estimator(text), cardStateful };
}

/** 超出预算时从优先级最低的行开始丢，保留原来的顺序。 */
function trimToBudget(
	lines: readonly SituationLine[],
	maxTokens: number,
	estimator: TokenEstimator,
): SituationLine[] {
	const kept = [...lines];
	const total = () =>
		estimator(
			["此刻局面：", ...kept.map((line) => `- ${line.text}`)].join("\n"),
		);
	while (kept.length > 1 && total() > maxTokens) {
		let worst = 0;
		for (let index = 1; index < kept.length; index += 1) {
			if ((kept[index]?.priority ?? 0) >= (kept[worst]?.priority ?? 0)) {
				worst = index;
			}
		}
		kept.splice(worst, 1);
	}
	return kept;
}

export interface WorldIndexLine {
	readonly text: string;
	readonly source: ContextItemSource;
}

export interface WorldIndex {
	readonly text: string;
	readonly lines: readonly WorldIndexLine[];
}

/**
 * 世界索引：每个实体与每条未收的线一行，从记事页的一行简介拼出，约 200 字。
 * 解决「模型不会去搜它不知道自己忘了的东西」。没有内容时返回 null。
 */
export function renderWorldIndex(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	options: { readonly maxChars?: number } = {},
): WorldIndex | null {
	const maxChars = options.maxChars ?? WORLD_INDEX_MAX_CHARS;
	const lines: WorldIndexLine[] = [];
	// 一行简介优先取记事页的「现在」，其次底色；还没有记事页的实体用百科简介。
	const notebook = new Map(
		readNotebookPages(store, storyId, nodeId).map((page) => [page.name, page]),
	);
	const pages = [...compileWikiPages(store, storyId, nodeId)].sort(
		(left, right) => right.uptoFloor - left.uptoFloor,
	);
	for (const page of pages) {
		const note = notebook.get(page.name);
		const lead = firstSentence(
			note === undefined
				? page.lead
				: note.now.trim().length > 0
					? note.now
					: note.base.trim().length > 0
						? note.base
						: page.lead,
		);
		lines.push({
			text: lead.length === 0 ? page.name : `${page.name}——${lead}`,
			source: { kind: "wiki", id: page.id, name: page.name },
		});
	}
	const state = store.getStateSnapshot(nodeId).state as unknown;
	const clues =
		isJsonObject(state) && isJsonObject(state.clue) ? state.clue : {};
	for (const [id, value] of Object.entries(clues)) {
		if (!isJsonObject(value)) continue;
		if (value.status === "fulfilled") continue;
		const text = typeof value.text === "string" ? value.text : id;
		lines.push({
			text: `未收的线：${text}`,
			source: {
				kind: "state",
				target: JSON.stringify(["clue", id]),
				label: text,
			},
		});
	}
	if (lines.length === 0) return null;
	const kept: WorldIndexLine[] = [];
	let used = 0;
	for (const line of lines) {
		if (kept.length > 0 && used + line.text.length > maxChars) break;
		kept.push(line);
		used += line.text.length;
	}
	return {
		text: ["世界索引：", ...kept.map((line) => `- ${line.text}`)].join("\n"),
		lines: kept,
	};
}

function firstSentence(text: string): string {
	const trimmed = text.trim();
	const end = trimmed.search(/[。！？!?\n]/);
	const sentence = end < 0 ? trimmed : trimmed.slice(0, end);
	return sentence.length > 40 ? `${sentence.slice(0, 40)}…` : sentence;
}

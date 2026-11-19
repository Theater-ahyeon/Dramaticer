import type { BackgroundJobHandler } from "../background/types.js";
import {
	DIRECTOR_PUSH_LABELS,
	type DirectorPush,
	formatDirectorLine,
} from "../director/lines.js";
import { readEffectiveLore } from "../edits/index.js";
import { normalizeEntityName } from "../entity.js";
import { type JsonValue, isJsonObject } from "../json.js";
import { readSceneGoal } from "../ledger/scene-goal.js";
import {
	type LlmClient,
	type LlmMessage,
	NO_CONTINUATION,
} from "../llm/types.js";
import {
	compileWikiPages,
	readMemoryPrefs,
	readMemorySecrets,
	readMemoryState,
} from "../memory/view.js";
import { readStoryFeatureState } from "../settings/features.js";
import type { StoryStore } from "../store/story-store.js";

/**
 * 规划写法：程序规定的固定阶段，每个阶段一次调用（I6、I7）。
 * 准备阶段最多三个，之后是正文；复查在后台，不阻塞正文显示。
 */
export const PLAN_PREP_PHASES = ["挑记忆", "角色意图", "定计划"] as const;

/** 规划写法一楼的阶段上限：三个准备阶段、正文、可选的复查。 */
export const MAX_PLAN_PHASES = 5;

/** 准备阶段里每段材料最多带进去的字数；只防失控，不为省字数压缩内容。 */
const CLIP = 400;

/** 一次角色意图最多考虑的在场角色数。 */
const MAX_INTENT_CHARACTERS = 4;

/** 故事级配置里记「玩家选了规划写法」的键；存储层的回合模式仍是快速或深度。 */
export const WRITING_MODE_KEY = "writingMode";

export interface PlanPhaseTrace {
	readonly name: string;
	readonly durationMs: number;
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
}

/** 写进 Trace 的规划记录：走了哪些阶段，是不是用了提前备好的结果。 */
export interface PlanTurnTrace {
	readonly prepared: boolean;
	readonly phases: readonly PlanPhaseTrace[];
}

export interface PlanPreparation {
	/** 交给正文调用的一段参考；模型可以不采纳（I13）。 */
	readonly text: string;
	readonly trace: PlanTurnTrace;
}

export interface PlanPhasesInput {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly storyId: string;
	/** 玩家输入之前的最后一楼；准备阶段只读到这里。 */
	readonly anchorNodeId: string;
	readonly playerMessage: string;
	readonly push: DirectorPush | null;
	readonly signal?: AbortSignal;
	readonly onProgress?: (phase: string, detail: string) => void;
}

function clip(text: string, max = CLIP): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function show(value: unknown): string {
	return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

/** 提前备好的结果按玩家的输入取：推进三档各一个键，行动选项按文字。 */
export function planInputKey(
	playerMessage: string,
	push: DirectorPush | null,
): string {
	return push !== null
		? `push:${push}`
		: `text:${normalizeEntityName(playerMessage).slice(0, 120)}`;
}

function preparedKey(anchorNodeId: string): string {
	return `prepared:${anchorNodeId}`;
}

/** 读取间隙里备好的准备结果；没有命中时返回 null。 */
export function readPreparedPlan(
	store: StoryStore,
	storyId: string,
	anchorNodeId: string,
	playerMessage: string,
	push: DirectorPush | null,
): PlanPreparation | null {
	const value = store.getStoryValue(storyId, preparedKey(anchorNodeId));
	if (!isJsonObject(value)) return null;
	const hit = value[planInputKey(playerMessage, push)];
	if (!isJsonObject(hit) || typeof hit.text !== "string") return null;
	return {
		text: hit.text,
		trace: {
			prepared: true,
			phases: Array.isArray(hit.phases)
				? (hit.phases as unknown as PlanPhaseTrace[])
				: [],
		},
	};
}

async function ask(
	input: PlanPhasesInput,
	name: string,
	system: string,
	user: string,
	phases: PlanPhaseTrace[],
): Promise<string> {
	const started = Date.now();
	const messages: LlmMessage[] = [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
	const result = await input.client.complete(
		{ messages, temperature: 0.3, signal: input.signal },
		NO_CONTINUATION,
	);
	phases.push({
		name,
		durationMs: Date.now() - started,
		promptTokens: result.usage?.promptTokens ?? null,
		completionTokens: result.usage?.completionTokens ?? null,
	});
	return result.text.trim();
}

/**
 * 跑完三个准备阶段。任何一个阶段失败都不让这一楼失败：
 * 已经得到的部分照常交给正文，剩下的阶段跳过。
 */
export async function runPlanPhases(
	input: PlanPhasesInput,
): Promise<PlanPreparation> {
	const { store, storyId, anchorNodeId } = input;
	const phases: PlanPhaseTrace[] = [];
	const path = store.getPathToNode(anchorNodeId);
	const recent = path
		.slice(-4)
		.map(
			(node) =>
				`${node.role === "user" ? "玩家" : "正文"}：${clip(node.raw, 600)}`,
		)
		.join("\n");
	const playerLine =
		input.push !== null
			? `玩家把方向交了出来：${DIRECTOR_PUSH_LABELS[input.push]}。`
			: `玩家这一轮写的是：${input.playerMessage}`;
	const pages = compileWikiPages(store, storyId, anchorNodeId);
	const state = readMemoryState(store, storyId, anchorNodeId);
	const secrets = readMemorySecrets(store, storyId, anchorNodeId);
	const lore = readEffectiveLore(store, storyId, anchorNodeId).filter(
		(entry) => !entry.constant,
	);
	const scene = store.getLatestSceneLogOnPath(anchorNodeId);
	const sceneGoal = readSceneGoal(store, storyId, anchorNodeId);
	const present = (scene?.present ?? []).slice(0, MAX_INTENT_CHARACTERS);
	const sections: string[] = [];

	try {
		// 阶段一：从目录里挑这一轮用得上的页面与设定，正文不用再全量带。
		input.onProgress?.("挑记忆", "从百科与设定的目录里挑这一轮用得上的");
		const catalog = [
			...pages.map((page, index) => ({
				id: `p${index}`,
				label: `${page.kind} ${page.name}`,
				body: [
					page.lead,
					...page.sections.flatMap((section) =>
						section.statements
							.filter((statement) => !statement.old)
							.slice(-6)
							.map((statement) => statement.text),
					),
				]
					.filter((line) => line !== "")
					.join("；"),
			})),
			...lore.slice(0, 80).map((entry, index) => ({
				id: `l${index}`,
				label: `设定 ${entry.name}`,
				body: entry.content,
			})),
		];
		let picked: typeof catalog = [];
		if (catalog.length > 0) {
			const answer = await ask(
				input,
				"挑记忆",
				'你在为下一楼正文准备材料。从目录里挑出这一轮最可能用到的条目，最多 6 条。只输出一个 JSON 数组，元素是条目的 id，例如 ["p0","l3"]；不要解释。',
				`${playerLine}\n\n最近的楼层：\n${recent}\n\n目录：\n${catalog
					.map((item) => `${item.id} ${item.label}`)
					.join("\n")}`,
				phases,
			);
			const ids = new Set(answer.match(/[pl]\d+/g) ?? []);
			picked = catalog.filter((item) => ids.has(item.id)).slice(0, 6);
		}
		if (picked.length > 0) {
			sections.push(
				`这一轮用得上的记忆与设定：\n${picked
					.map((item) => `- ${item.label}：${clip(item.body)}`)
					.join("\n")}`,
			);
		}

		// 阶段二：在场角色各凭自己知道的事提出意图；不知道的事不出现在他那一段里。
		if (present.length > 0) {
			input.onProgress?.("角色意图", `${present.join("、")}各自想做什么`);
			const events = store.getEventsForPath(anchorNodeId, { limit: 1000 });
			const blocks = present.map((name) => {
				const key = normalizeEntityName(name);
				const known = events
					.filter(
						(event) =>
							event.knowers.length === 0 ||
							event.knowers.includes("*") ||
							[...event.knowers, ...event.participants].some(
								(who) => normalizeEntityName(who) === key,
							),
					)
					.slice(-10)
					.map((event) => `- ${event.text}`);
				const own = state
					.filter((item) =>
						item.path
							.slice(0, -1)
							.some((segment) => normalizeEntityName(segment) === key),
					)
					.slice(0, 8)
					.map((item) => `- ${item.item}：${show(item.value)}`);
				const want =
					sceneGoal?.present.find((actor) => actor.who === name)?.want ?? null;
				return [
					`【${name}】`,
					want === null ? "" : `这一场想要：${want}`,
					own.length > 0 ? `自己的状态：\n${own.join("\n")}` : "",
					known.length > 0
						? `知道的事：\n${known.join("\n")}`
						: "知道的事：没有记录",
				]
					.filter((line) => line !== "")
					.join("\n");
			});
			const intents = await ask(
				input,
				"角色意图",
				"下面每一段是一个在场角色自己知道的事。逐个角色写一句他此刻想做什么、会怎么做。写某个角色时只能用他那一段里的内容，不能用别人那一段里的事。每个角色一行，格式「名字：意图」，不要多写。",
				`${playerLine}\n\n最近的楼层：\n${recent}\n\n${blocks.join("\n\n")}`,
				phases,
			);
			if (intents !== "") sections.push(`在场角色的意图：\n${intents}`);
		}

		// 阶段三：把上面的材料收成这一楼的计划。只写局面，不写写作命令。
		input.onProgress?.("定计划", "这一楼要发生什么");
		const unaware = secrets
			.filter((secret) => secret.unaware.some((name) => present.includes(name)))
			.slice(0, 6)
			.map(
				(secret) => `- ${secret.text}（${secret.unaware.join("、")}不知道）`,
			);
		const lines = store
			.readDirectorLineStates(anchorNodeId)
			.slice(0, 6)
			.map((item) => `- ${formatDirectorLine(item.line)}`);
		const plan = await ask(
			input,
			"定计划",
			"根据材料写出下一楼的计划：三到五行，每行一件这一楼里会发生的事，按先后排。玩家写了自己的行动时，计划必须从他的行动开始并且只顺着它展开。不要写文风要求，不要替玩家角色做决定。",
			[
				playerLine,
				`最近的楼层：\n${recent}`,
				...sections,
				unaware.length > 0 ? `要守住的秘密：\n${unaware.join("\n")}` : "",
				input.push !== null && lines.length > 0
					? `在走的剧情线：\n${lines.join("\n")}`
					: "",
			]
				.filter((part) => part !== "")
				.join("\n\n"),
			phases,
		);
		if (plan !== "") sections.push(`这一楼的计划：\n${plan}`);
	} catch (error) {
		if (input.signal?.aborted) throw error;
		// 准备阶段出错不挡住正文：有多少用多少。
		input.onProgress?.("定计划", "准备阶段没有走完，直接写正文");
	}

	return {
		text:
			sections.length === 0
				? ""
				: `【本轮准备】以下是写这一楼之前理出来的材料，供参考，可以不照着写。\n\n${sections.join("\n\n")}`,
		trace: { prepared: false, phases },
	};
}

/** 这个故事现在是不是规划写法。 */
export function isPlanWritingMode(store: StoryStore, storyId: string): boolean {
	return store.getStoryValue(storyId, WRITING_MODE_KEY) === "plan";
}

/** 后台任务类型：回复落定后把推进三档与每个行动选项的准备阶段先跑完。 */
export const PLAN_PREPARE_JOB_KIND = "plan_prepare";

/** 一次最多为几个行动选项提前准备。 */
const MAX_PREPARED_ACTIONS = 4;

function prepareAnchor(store: StoryStore, storyId: string): string | null {
	const head = store.getHead(storyId);
	return head !== null && head.role === "assistant" ? head.id : null;
}

/** 入队判定：选了规划写法、打开了「提前备好」，而且这一楼还没有备过。 */
export function planPrepareNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	if (!isPlanWritingMode(store, storyId)) return false;
	if (readStoryFeatureState(store, storyId).values.prepare !== true)
		return false;
	const anchor = prepareAnchor(store, storyId);
	if (anchor === null) return false;
	return store.getStoryValue(storyId, preparedKey(anchor)) === null;
}

/** 间隙里的提前准备：命中时回合内只剩一次正文调用。 */
export function createPlanPrepareHandler(
	options: { readonly client?: LlmClient } = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const anchor = prepareAnchor(store, job.storyId);
		if (anchor === null) return;
		if (store.getStoryValue(job.storyId, preparedKey(anchor)) !== null) return;
		const inputs: { message: string; push: DirectorPush | null }[] = [
			{ message: "", push: "advance" },
			{ message: "", push: "quick" },
			{ message: "", push: "jump" },
			...store
				.listDirectorCandidateActions(anchor)
				.slice(0, MAX_PREPARED_ACTIONS)
				.map((action) => ({ message: action.text, push: null })),
		];
		const prepared: Record<string, JsonValue> = {};
		for (const item of inputs) {
			// 玩家已经发了新的一楼：剩下的不用备了。
			if (store.getHead(job.storyId)?.id !== anchor) break;
			const result = await runPlanPhases({
				store,
				client: options.client ?? client,
				storyId: job.storyId,
				anchorNodeId: anchor,
				playerMessage: item.message,
				push: item.push,
				signal,
			});
			if (result.text === "") continue;
			prepared[planInputKey(item.message, item.push)] = {
				text: result.text,
				phases: result.trace.phases as unknown as JsonValue,
			};
		}
		store.setStoryValue(job.storyId, preparedKey(anchor), prepared);
	};
}

/**
 * 深度写法的自查清单：由程序从状态、不知情者、最近节拍、偏好与待埋伏笔生成，
 * 模型交稿前逐项对一遍。清单只陈述事实，不规定怎么写。
 */
export function buildSelfCheckList(
	store: StoryStore,
	storyId: string,
	anchorNodeId: string,
): string[] {
	const scene = store.getLatestSceneLogOnPath(anchorNodeId);
	const present = scene?.present ?? [];
	const keys = new Set(present.map((name) => normalizeEntityName(name)));
	const items: string[] = [];
	const state = readMemoryState(store, storyId, anchorNodeId)
		.filter((item) =>
			item.path
				.slice(0, -1)
				.some((segment) => keys.has(normalizeEntityName(segment))),
		)
		.slice(0, 10);
	if (state.length > 0) {
		items.push(
			`状态对得上：${state.map((item) => `${item.owner} 的${item.item}是${clip(show(item.value), 40)}`).join("；")}`,
		);
	}
	const unaware = readMemorySecrets(store, storyId, anchorNodeId)
		.filter((secret) => secret.unaware.some((name) => present.includes(name)))
		.slice(0, 5);
	if (unaware.length > 0) {
		items.push(
			`没有写出不知情的人知道的事：${unaware.map((secret) => `${secret.unaware.filter((name) => present.includes(name)).join("、")}不知道「${clip(secret.text, 40)}」`).join("；")}`,
		);
	}
	const beats = store
		.getPathToNode(anchorNodeId)
		.filter((node) => node.role === "assistant")
		.slice(-2)
		.map((node) => store.getSceneLog(node.id)?.beat ?? null)
		.filter((beat): beat is string => beat !== null && beat !== "");
	if (beats.length > 0) {
		items.push(`上两楼的节拍是「${beats.join("、")}」，这一楼换一个节拍`);
	}
	const prefs = readMemoryPrefs(store, storyId, anchorNodeId)
		.filter((pref) => !pref.disabled)
		.slice(0, 6);
	if (prefs.length > 0) {
		items.push(`玩家的偏好：${prefs.map((pref) => pref.text).join("；")}`);
	}
	const promises = store
		.readDirectorLineStates(anchorNodeId)
		.filter((item) => item.line.kind === "promise")
		.slice(0, 4);
	if (promises.length > 0) {
		items.push(
			`还没收的伏笔（合适就埋或收，不合适不用勉强）：${promises.map((item) => item.line.want).join("；")}`,
		);
	}
	return items;
}

export function formatSelfCheckList(items: readonly string[]): string | null {
	if (items.length === 0) return null;
	return `【交稿前自查】先在草稿里写完，再逐项对一遍，有出入就改草稿，然后交稿。\n${items
		.map((item) => `- ${item}`)
		.join("\n")}`;
}

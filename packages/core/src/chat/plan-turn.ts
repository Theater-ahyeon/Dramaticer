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
import { parseJsonOutputObject } from "../memory/json-output.js";
import {
	compileWikiPages,
	readMemoryPrefs,
	readMemorySecrets,
	readMemoryState,
} from "../memory/view.js";
import { readStoryFeatureState } from "../settings/features.js";
import { WRITING_MODE_KEY } from "../settings/writing.js";
import type { StoryStore } from "../store/story-store.js";

/**
 * 规划写法：程序规定的固定阶段，每个阶段一次调用（I6、I7）。
 * 准备阶段最多三个，之后是正文；复查在后台，不阻塞正文显示。
 */
export const PLAN_PREP_PHASES = ["挑记忆", "角色意图", "定计划"] as const;

/**
 * 规划写法一楼的固定顺序：写完计划再写正文，最后由后台复查。
 * 顺序与阶段上限都由这个常量决定，写进 Trace 的就是它。
 */
export const PLAN_TURN_STEPS = [...PLAN_PREP_PHASES, "正文", "复查"] as const;

/** 规划写法一楼的阶段上限：三个准备阶段、正文、可选的复查。 */
export const MAX_PLAN_PHASES = PLAN_TURN_STEPS.length;

/** 准备阶段里每段材料最多带进去的字数；只防失控，不为省字数压缩内容。 */
const CLIP = 400;

/** 一次角色意图最多考虑的在场角色数；每个角色单独一次调用。 */
const MAX_INTENT_CHARACTERS = 4;

export interface PlanPhaseTrace {
	readonly name: string;
	readonly durationMs: number;
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
}

/** 写进 Trace 的规划记录：固定的阶段顺序、实际走过的阶段，是不是用了提前备好的结果。 */
export interface PlanTurnTrace {
	readonly prepared: boolean;
	/** 程序规定的阶段顺序；数量由 MAX_PLAN_PHASES 封顶。 */
	readonly schedule: readonly string[];
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

/**
 * 一个角色是否知道某条事件：公开事件（没有知情者或标了 *）人人知道，
 * 其余只算知情者与参与者。自己的状态另由路径判断。
 */
function eventKnownTo(
	event: {
		readonly knowers: readonly string[];
		readonly participants: readonly string[];
	},
	key: string,
): boolean {
	if (event.knowers.length === 0 || event.knowers.includes("*")) return true;
	return [...event.knowers, ...event.participants].some(
		(who) => normalizeEntityName(who) === key,
	);
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
			schedule: PLAN_TURN_STEPS,
			phases: Array.isArray(hit.phases)
				? (hit.phases as unknown as PlanPhaseTrace[])
				: [],
		},
	};
}

function addTokens(
	previous: number | null,
	next: number | null,
): number | null {
	if (previous === null && next === null) return null;
	return (previous ?? 0) + (next ?? 0);
}

/**
 * 一个阶段里可能有多角色各一次调用；同名阶段合并成一条记录，
 * Trace 里的阶段数与顺序仍然只由 PLAN_TURN_STEPS 决定。
 */
function addPhaseTrace(
	phases: PlanPhaseTrace[],
	name: string,
	durationMs: number,
	usage: {
		readonly promptTokens: number | null;
		readonly completionTokens: number | null;
	} | null,
): void {
	const index = phases.findIndex((phase) => phase.name === name);
	const promptTokens = usage?.promptTokens ?? null;
	const completionTokens = usage?.completionTokens ?? null;
	if (index < 0) {
		phases.push({ name, durationMs, promptTokens, completionTokens });
		return;
	}
	const previous = phases[index];
	if (previous === undefined) return;
	phases[index] = {
		name,
		durationMs: previous.durationMs + durationMs,
		promptTokens: addTokens(previous.promptTokens, promptTokens),
		completionTokens: addTokens(previous.completionTokens, completionTokens),
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
	addPhaseTrace(phases, name, Date.now() - started, result.usage);
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

		// 阶段二：在场角色各凭自己知道的事提出意图。每个角色单独一次调用，
		// 调用里只有他自己知道的事（含他被告知的秘密），别人的材料根本不出现。
		if (present.length > 0) {
			input.onProgress?.("角色意图", `${present.join("、")}各自想做什么`);
			const events = store.getEventsForPath(anchorNodeId, { limit: 1000 });
			const intents: string[] = [];
			for (const name of present) {
				const key = normalizeEntityName(name);
				const known = events
					.filter((event) => eventKnownTo(event, key))
					.slice(-10)
					.map((event) => `- ${event.text}`);
				const told = secrets
					.filter((secret) =>
						secret.knowers.some((who) => normalizeEntityName(who) === key),
					)
					.slice(0, 6)
					.map((secret) => `- ${secret.text}`);
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
				const material = [
					`【${name}】`,
					want === null ? "" : `这一场想要：${want}`,
					own.length > 0 ? `自己的状态：\n${own.join("\n")}` : "",
					known.length > 0
						? `知道的事：\n${known.join("\n")}`
						: "知道的事：没有记录",
					told.length > 0 ? `自己知道、别人未必知道：\n${told.join("\n")}` : "",
				]
					.filter((line) => line !== "")
					.join("\n");
				const intent = await ask(
					input,
					"角色意图",
					`你只写「${name}」一个人此刻想做什么、会怎么做。下面只有「${name}」自己知道的事；不要提到这一段之外的人、事或秘密。只输出一行，格式「${name}：意图」，不要解释。`,
					`${playerLine}\n\n${material}`,
					phases,
				);
				if (intent !== "") intents.push(intent);
			}
			if (intents.length > 0) {
				sections.push(`在场角色的意图：\n${intents.join("\n")}`);
			}
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

	if (phases.length > MAX_PLAN_PHASES) {
		throw new Error(
			`规划写法一楼最多 ${MAX_PLAN_PHASES} 个阶段，实际记了 ${phases.length} 个`,
		);
	}

	return {
		text:
			sections.length === 0
				? ""
				: `【本轮准备】以下是写这一楼之前理出来的材料，供参考，可以不照着写。\n\n${sections.join("\n\n")}`,
		trace: { prepared: false, schedule: PLAN_TURN_STEPS, phases },
	};
}

/** 这个故事现在是不是规划写法。 */
export function isPlanWritingMode(store: StoryStore, storyId: string): boolean {
	return store.getStoryValue(storyId, WRITING_MODE_KEY) === "plan";
}

/** 后台任务类型：回复落定后把推进三档与每个行动选项的准备阶段先跑完。 */
export const PLAN_PREPARE_JOB_KIND = "plan_prepare";

/** 「提前备好」开关：关掉时既不备，也不吃以前备下的结果。 */
export function isPlanPrepareEnabled(
	store: StoryStore,
	storyId: string,
): boolean {
	return readStoryFeatureState(store, storyId).values.prepare === true;
}

/** 一次最多为几个行动选项提前准备：候选固定的四条行动加一条场景变化。 */
const MAX_PREPARED_ACTIONS = 5;

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
	if (!isPlanPrepareEnabled(store, storyId)) return false;
	const anchor = prepareAnchor(store, storyId);
	if (anchor === null) return false;
	return store.getStoryValue(storyId, preparedKey(anchor)) === null;
}

/** 间隙里的提前准备：命中时回合内只剩一次正文调用。 */
export function createPlanPrepareHandler(
	options: { readonly client?: LlmClient } = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		if (!isPlanPrepareEnabled(store, job.storyId)) return;
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

/** 后台任务类型：正文落定后复查状态矛盾与串戏，结果存成可切换的版本。 */
export const PLAN_REVIEW_JOB_KIND = "plan_review";

/** 复查结果：没有问题时 variantNodeId 为 null，有问题时指向兄弟楼层。 */
export interface PlanReviewRecord {
	readonly nodeId: string;
	readonly issues: readonly string[];
	readonly variantNodeId: string | null;
	readonly phase: PlanPhaseTrace;
	readonly checkedAt: string;
}

function reviewKey(nodeId: string): string {
	return `planReview:${nodeId}`;
}

function readReviewIssues(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("规划复查输出.issues 必须是数组");
	}
	return value.map((item, index) => {
		if (typeof item !== "string" || item.trim() === "") {
			throw new Error(`规划复查输出.issues[${index}] 必须是非空字符串`);
		}
		return item.trim();
	});
}

/** 读取某一楼的复查结果；没有复查过时返回 null。 */
export function readPlanReview(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): PlanReviewRecord | null {
	const value = store.getStoryValue(storyId, reviewKey(nodeId));
	if (!isJsonObject(value)) return null;
	const issues = Array.isArray(value.issues)
		? value.issues.filter((item): item is string => typeof item === "string")
		: [];
	const phase = isJsonObject(value.phase) ? value.phase : null;
	if (
		phase === null ||
		typeof phase.name !== "string" ||
		typeof phase.durationMs !== "number"
	) {
		return null;
	}
	return {
		nodeId,
		issues,
		variantNodeId:
			typeof value.variantNodeId === "string" ? value.variantNodeId : null,
		phase: {
			name: phase.name,
			durationMs: phase.durationMs,
			promptTokens:
				typeof phase.promptTokens === "number" ? phase.promptTokens : null,
			completionTokens:
				typeof phase.completionTokens === "number"
					? phase.completionTokens
					: null,
		},
		checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : "",
	};
}

/** 入队判定：规划写法、打开了「复查」，head 是规划写出来的一楼且还没复查过。 */
export function planReviewNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	if (!isPlanWritingMode(store, storyId)) return false;
	if (readStoryFeatureState(store, storyId).values.review !== true)
		return false;
	const anchor = prepareAnchor(store, storyId);
	if (anchor === null) return false;
	if (store.getTurnTrace(anchor)?.plan === undefined) return false;
	return store.getStoryValue(storyId, reviewKey(anchor)) === null;
}

const REVIEW_SYSTEM_PROMPT = [
	"你是规划写法的复查阶段。检查这一楼正文有没有状态矛盾与串戏。",
	"状态矛盾指位置、衣着、伤势、物品、在场者与前文或台账对不上；串戏指写出了某人不知道的事，或让不在场的人出现。",
	"只根据给出的材料判断，不要新增设定。",
	'只输出一个 JSON 对象：{"issues":["..."],"rewrite":"修正后的完整正文"}。',
	"没有问题时空数组与空字符串；有问题时 rewrite 输出修正后的完整正文，长度与文风接近原文，只改有矛盾的地方。",
	"不要输出代码块标记、解释或 JSON 之外的任何内容。",
].join("\n");

/**
 * 复查在正文之后单独跑一次后台调用，结果写成兄弟楼层；
 * head 不动，玩家自己切换过去（I7：不阻塞正文显示）。
 */
export function createPlanReviewHandler(
	options: { readonly client?: LlmClient } = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const anchor = prepareAnchor(store, job.storyId);
		if (anchor === null) return;
		if (store.getTurnTrace(anchor)?.plan === undefined) return;
		if (store.getStoryValue(job.storyId, reviewKey(anchor)) !== null) return;
		if (readStoryFeatureState(store, job.storyId).values.review !== true) {
			return;
		}
		const node = store.getNode(anchor);
		if (node === null) return;
		const present = store.getLatestSceneLogOnPath(anchor)?.present ?? [];
		const keys = new Set(present.map((name) => normalizeEntityName(name)));
		const state = readMemoryState(store, job.storyId, anchor)
			.filter((item) =>
				item.path
					.slice(0, -1)
					.some((segment) => keys.has(normalizeEntityName(segment))),
			)
			.slice(0, 10)
			.map((item) => `- ${item.owner} 的${item.item}：${show(item.value)}`);
		const secrets = readMemorySecrets(store, job.storyId, anchor)
			.filter((secret) => secret.unaware.some((name) => present.includes(name)))
			.slice(0, 6)
			.map(
				(secret) => `- ${secret.text}（${secret.unaware.join("、")}不知道）`,
			);
		const user = [
			`这一楼的正文：\n${node.raw}`,
			present.length > 0 ? `在场者：${present.join("、")}` : "",
			state.length > 0 ? `在场者的状态：\n${state.join("\n")}` : "",
			secrets.length > 0 ? `要守住的秘密：\n${secrets.join("\n")}` : "",
		]
			.filter((part) => part !== "")
			.join("\n\n");
		const started = Date.now();
		const result = await (options.client ?? client).complete(
			{
				messages: [
					{ role: "system", content: REVIEW_SYSTEM_PROMPT },
					{ role: "user", content: user },
				],
				temperature: 0.2,
				signal,
			},
			NO_CONTINUATION,
		);
		const phase: PlanPhaseTrace = {
			name: "复查",
			durationMs: Date.now() - started,
			promptTokens: result.usage?.promptTokens ?? null,
			completionTokens: result.usage?.completionTokens ?? null,
		};
		const parsed = parseJsonOutputObject(result.text, "规划复查输出");
		const issues = readReviewIssues(parsed.issues);
		if (typeof parsed.rewrite !== "string") {
			throw new Error("规划复查输出.rewrite 必须是字符串");
		}
		const rewrite = parsed.rewrite.trim();
		if (issues.length > 0 && rewrite === "") {
			throw new Error("规划复查发现了问题，但没有给出修正后的正文");
		}
		const variantNodeId =
			issues.length > 0 && rewrite !== node.raw
				? store.appendReplyVariant(node.id, rewrite).id
				: null;
		const record: PlanReviewRecord = {
			nodeId: node.id,
			issues,
			variantNodeId,
			phase,
			checkedAt: new Date().toISOString(),
		};
		store.setStoryValue(
			job.storyId,
			reviewKey(node.id),
			record as unknown as JsonValue,
		);
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

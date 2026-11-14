import type { BackgroundJobHandler } from "../background/types.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import { readSceneSegments } from "../ledger/scenes.js";
import {
	type LlmClient,
	type LlmMessage,
	NO_CONTINUATION,
} from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import {
	type DirectorChapterReviewPayload,
	MIN_CHAPTER_FOCUS_LINES,
	assertDirectorChapterReviewPayload,
} from "./chapter.js";
import {
	type DirectorLineDiff,
	type DirectorLineState,
	assertDirectorLineDiffs,
	directorLineRemaining,
	formatDirectorLine,
} from "./lines.js";

/** 后台任务类型：章末在间隙里清点伏笔、规划下一章并更新线。 */
export const CHAPTER_PLAN_JOB_KIND = "chapter_plan";

/** 章级规划读取的最近楼层数。 */
export const CHAPTER_PLAN_WINDOW_FLOORS = 12;

/** 模型输出：这一批线修改与章末清点。 */
export interface ChapterPlan {
	readonly diffs: readonly DirectorLineDiff[];
	readonly review: DirectorChapterReviewPayload;
}

const RESPONSE_KEYS = ["lines", "review"] as const;

const SYSTEM_PROMPT = [
	"你是故事的长线规划者。一章结束时，你清点伏笔、确定下一章聚焦的线，并更新线的倒计时与预备发展。只输出一个 JSON 对象，不要解释、前后缀或代码块标记。",
	'{"lines":[{"action":"set","line":{"id":"…","kind":"main","who":"…","want":"…","obstacle":"…","countdown":3,"preparations":["…"]}},{"action":"delete","id":"…"}],"review":{"promises":[{"lineId":"…","disposition":"carry"}],"focus":["…","…"]}}',
	"- lines：这一批线修改，可以为空数组；set 必须带完整线，delete 只带 id。",
	"- kind 只能是 main、relationship、opposition、promise；countdown 是非负整数或 null；preparations 最多三条。",
	"- review.promises：逐条处理清点之前已经存在的未兑现伏笔（kind 为 promise 的线）；disposition 取 carry（带到下一章）或 retire（作废）。",
	"- review.focus：下一章聚焦的线，2 到 3 条；必须已经出现在当前线清单里，不能是同一份清点里 retire 的伏笔，也不能在这批修改里被删除。",
	"- 新建伏笔不能让未兑现伏笔超过输入里给出的上限。",
	"- 线的倒计时按助手楼层计；修改 countdown 就是重设时钟。",
	"- 只写局面与人物意图，不要写写作指令。",
].join("\n");

export interface ChapterPlanInput {
	readonly nodeId: string;
	readonly storyId: string;
	/** 当前路径上的助手楼层数。 */
	readonly floorDepth: number;
	/** 距上一次章末清点的助手楼层数。 */
	readonly chapterFloors: number;
	readonly lines: readonly DirectorLineState[];
	readonly floors: readonly TimelineNode[];
	/** 这一场开始时的场面卡；没有时为空。 */
	readonly sceneCard: string | null;
	readonly previousReview: DirectorChapterReviewPayload | null;
	readonly maxOpenPromises: number;
}

/** 当前路径上最后一个助手楼层；章级规划写在它上面。 */
export function chapterPlanNodeId(store: StoryStore, storyId: string): string {
	const head = store.getHead(storyId);
	if (head === null) {
		throw new Error(`故事 ${storyId} 还没有楼层，无法做章级规划`);
	}
	const assistants = store
		.getPathToNode(head.id)
		.filter((node) => node.role === "assistant");
	const last = assistants.at(-1);
	if (last === undefined) {
		throw new Error(`故事 ${storyId} 还没有助手楼层，无法做章级规划`);
	}
	return last.id;
}

/**
 * 入队判定：导演打开、这一章已经积累够 `chapterFloors` 个助手楼层、
 * 最近一楼标记了这一场结束，并且路径上至少有两条线可聚焦。
 */
export function chapterPlanNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	const config = store.getStorySettings(storyId).directorConfig;
	if (config.mode === "off") return false;
	const head = store.getHead(storyId);
	if (head === null) return false;
	const assistants = store
		.getPathToNode(head.id)
		.filter((node) => node.role === "assistant");
	const node = assistants.at(-1);
	if (node === undefined) return false;
	const latest = store.getLatestSceneLogOnPath(node.id);
	if (latest === null || !latest.sceneEnds) return false;
	const states = store.readDirectorLineStates(node.id);
	if (states.length < MIN_CHAPTER_FOCUS_LINES) return false;
	if (store.getDirectorChapterReview(node.id) !== null) return false;
	if (store.getDirectorLines(node.id) !== null) return false;
	const reviews = store.listDirectorChapterReviewsAlongPath(node.id);
	const previous = reviews.at(-1);
	let sinceReview = assistants.length;
	if (previous !== undefined) {
		const index = assistants.findIndex((item) => item.id === previous.nodeId);
		if (index < 0) {
			throw new Error(
				`章末清点的楼层 ${previous.nodeId} 不在当前路径的助手楼层里`,
			);
		}
		sinceReview = assistants.length - index - 1;
	}
	return sinceReview >= config.chapterFloors;
}

/** 收集一次章级规划的输入；没有线可清点时返回 null。 */
export function collectChapterPlanInput(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): ChapterPlanInput | null {
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const path = store.getPathToNode(nodeId);
	const assistants = path.filter((item) => item.role === "assistant");
	const floors = assistants.slice(-CHAPTER_PLAN_WINDOW_FLOORS);
	const states = store.readDirectorLineStates(nodeId);
	if (states.length === 0) return null;
	const reviews = store.listDirectorChapterReviewsAlongPath(nodeId);
	const previousReview = reviews.at(-1)?.payload ?? null;
	const previousFloor = reviews.at(-1);
	let chapterFloors = assistants.length;
	if (previousFloor !== undefined) {
		const index = assistants.findIndex(
			(item) => item.id === previousFloor.nodeId,
		);
		if (index < 0) {
			throw new Error(
				`章末清点的楼层 ${previousFloor.nodeId} 不在当前路径的助手楼层里`,
			);
		}
		chapterFloors = assistants.length - index - 1;
	}
	const segment = readSceneSegments(store, nodeId).find((item) =>
		item.floorIds.includes(nodeId),
	);
	let sceneCard: string | null = null;
	if (segment !== undefined) {
		for (const id of segment.floorIds) {
			const card = store.getSceneLog(id)?.sceneCard ?? null;
			if (card === null) continue;
			const wants = card.present
				.map((actor) => `${actor.who}想要${actor.want}`)
				.join("；");
			sceneCard = `${wants}。这一场结束时应该改变：${card.change}`;
			break;
		}
	}
	return {
		nodeId,
		storyId,
		floorDepth: assistants.length,
		chapterFloors,
		lines: states,
		floors,
		sceneCard,
		previousReview,
		maxOpenPromises:
			store.getStorySettings(storyId).directorConfig.maxOpenPromises,
	};
}

/** 把收集到的输入拼成规划器共用的用户消息。 */
export function buildChapterPlanUserContent(input: ChapterPlanInput): string {
	const lines: string[] = [
		`当前路径共有 ${input.floorDepth} 个助手楼层，这一章覆盖最近 ${input.chapterFloors} 个。`,
		`未兑现伏笔上限：${input.maxOpenPromises} 条。`,
	];
	lines.push("", "当前线：");
	if (input.lines.length === 0) {
		lines.push("无。");
	} else {
		for (const state of input.lines) {
			const remaining = directorLineRemaining(state, input.floorDepth);
			const countdown =
				remaining === null ? "没有倒计时" : `倒计时余量 ${remaining}`;
			const preparations =
				state.line.preparations.length === 0
					? ""
					: `；预备：${state.line.preparations.join("；")}`;
			lines.push(
				`- ${state.line.id}（${state.line.kind}，${countdown}）：${formatDirectorLine(state.line)}${preparations}`,
			);
		}
	}
	if (input.sceneCard !== null) {
		lines.push("", "这一场的场面卡：");
		lines.push(input.sceneCard);
	}
	lines.push("", "上一次章末清点：");
	if (input.previousReview === null) {
		lines.push("还没有。");
	} else {
		lines.push(JSON.stringify(input.previousReview));
	}
	lines.push("", "这一章最近楼层的原文：");
	for (const node of input.floors) {
		lines.push(`<楼层 id="${node.id}" 角色="${node.role}">`);
		lines.push(node.raw);
		lines.push("</楼层>");
	}
	return lines.join("\n");
}

/** 外部输出与模型输出的唯一校验入口；未知字段与形状错误整批拒绝。 */
export function parseChapterPlanResponse(text: string): ChapterPlan {
	const record = assertPlainObject(
		parseJsonOutputObject(text, "章级规划"),
		"章级规划",
	);
	rejectUnknownKeys(record, RESPONSE_KEYS, "章级规划");
	const diffs = assertDirectorLineDiffs(record.lines, "章级规划.lines");
	const review = assertDirectorChapterReviewPayload(
		record.review,
		"章级规划.review",
	);
	return { diffs, review };
}

/**
 * 作废的伏笔必须从线上删掉：程序按清点补一条 delete，模型已经删过的不重复补。
 * 声明带到下一章的伏笔不能被这批修改删除或改成别的种类。
 */
export function chapterReviewLineDiffs(
	plan: ChapterPlan,
): readonly DirectorLineDiff[] {
	const dispositions = new Map(
		plan.review.promises.map(
			(decision) => [decision.lineId, decision.disposition] as const,
		),
	);
	for (const diff of plan.diffs) {
		if (diff.action === "delete") {
			if (dispositions.get(diff.id) === "carry") {
				throw new Error(`章级规划删除了声明带到下一章的伏笔：${diff.id}`);
			}
			continue;
		}
		if (
			dispositions.get(diff.line.id) === "carry" &&
			diff.line.kind !== "promise"
		) {
			throw new Error(
				`章级规划把声明带到下一章的伏笔改成了 ${diff.line.kind}：${diff.line.id}`,
			);
		}
	}
	const deleted = new Set(
		plan.diffs
			.filter((diff) => diff.action === "delete")
			.map((diff) => diff.id),
	);
	const retire: DirectorLineDiff[] = [];
	for (const decision of plan.review.promises) {
		if (decision.disposition !== "retire") continue;
		if (deleted.has(decision.lineId)) continue;
		retire.push({ action: "delete", id: decision.lineId });
	}
	return [...plan.diffs, ...retire];
}

export interface ChapterPlanHandlerOptions {
	/** 覆盖任务上下文里的后台客户端；生产用 `planner` 角色的客户端。 */
	readonly client?: LlmClient;
}

/** 章末规划的后台处理器：一次调用更新线与章末清点，写在最后一个助手楼层。 */
export function createChapterPlanHandler(
	options: ChapterPlanHandlerOptions = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const nodeId = chapterPlanNodeId(store, job.storyId);
		// 同一楼层已经清点过：这次执行不追加任何记录。
		if (store.getDirectorChapterReview(nodeId) !== null) return;
		const input = collectChapterPlanInput(store, job.storyId, nodeId);
		if (input === null) {
			throw new Error(`故事 ${job.storyId} 没有可清点的线`);
		}
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildChapterPlanUserContent(input) },
		];
		const result = await (options.client ?? client).complete(
			{
				messages,
				temperature: 0,
				signal,
			},
			NO_CONTINUATION,
		);
		const plan = parseChapterPlanResponse(result.text);
		const diffs = chapterReviewLineDiffs(plan);
		store.saveDirectorChapterPlan({
			nodeId,
			storyId: job.storyId,
			diffs,
			review: plan.review,
		});
	};
}

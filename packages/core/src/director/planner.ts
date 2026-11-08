import type { BackgroundJobHandler } from "../background/types.js";
import type { JsonValue } from "../json.js";
import { listLedgerEntities, readLedger } from "../ledger/read.js";
import type {
	LedgerCharacter,
	LedgerClue,
	LedgerRelation,
} from "../ledger/read.js";
import type { LlmClient, LlmMessage } from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type DirectorPlan,
	mergePlannedArcs,
	parseDirectorPlan,
	readDirectorPlan,
	resolveCurrentBeat,
} from "./plan.js";

/** 后台任务类型：在间隙里生成或修订故事的长线计划。 */
export const DIRECTOR_PLAN_JOB_KIND = "director_plan";

const SYSTEM_PROMPT = [
	"你是故事的导演规划器。根据角色卡、台账与现有计划，设计接下来的故事弧线与节拍。",
	"- 只输出一个 JSON 对象，不要解释、前后缀或代码块标记；形如：",
	'{"arcs":[{"id":"…","title":"…","throughLine":"…","difficulty":0.4,"redLines":["…"],"sequences":[{"id":"…","title":"…","beats":[{"id":"…","goal":"…","entrySigns":["…"],"fitPoints":["…"]}]}]}]}',
	"- arcs 是弧线数组；每条包含 id、title、throughLine、difficulty、redLines、sequences。",
	"- difficulty 是 0 到 1 之间的数字，越大越难推进；redLines 可以是空数组。",
	"- sequences 是序列数组；每条包含 id、title、beats。",
	"- beats 是节拍数组；每条包含 id、goal、entrySigns、fitPoints，后两者至少一条。",
	"- 除 redLines 外所有字段都是非空字符串；id 在整个计划内唯一。",
	"- 现有计划里的弧线与序列必须保留：相同 id 表示修订同一项；玩家编辑过的内容不要改动，只在末尾追加后续序列与节拍。",
	"- 节拍要具体到人和事：goal 写这一拍要达成的变化，entrySigns 写观众能观察到的起始迹象，fitPoints 写可以利用的具体人、物或事。",
	"- 不要编造输入里没有出现的设定。",
].join("\n");

/** 生成计划的输入；没有角色卡与台账素材时返回 null。 */
export interface DirectorPlanInput {
	/** 计划落点：当前 head；故事还没有楼层时为 null。 */
	readonly headNodeId: string | null;
	readonly cardName: string | null;
	readonly characterPrompt: string;
	readonly characters: readonly LedgerCharacter[];
	readonly relations: readonly LedgerRelation[];
	readonly openClues: readonly LedgerClue[];
	readonly items: JsonValue | undefined;
	readonly userWills: JsonValue | undefined;
	readonly summary: string | null;
	readonly plan: DirectorPlan;
}

export interface DirectorPlanHandlerOptions {
	/** 规划器专用客户端；不设置时使用任务上下文里的后台客户端。 */
	readonly client?: LlmClient;
	/** 覆盖客户端默认模型。 */
	readonly model?: string;
}

export interface GenerateDirectorPlanOptions {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly storyId: string;
	readonly model?: string;
	readonly signal?: AbortSignal;
}

/**
 * 收集规划器的输入。故事既没有角色卡也没有任何台账素材时返回 null，
 * 没有素材时补建任务只会浪费一次模型调用。
 */
export function collectDirectorPlanInput(
	store: StoryStore,
	storyId: string,
): DirectorPlanInput | null {
	const settings = store.getStorySettings(storyId);
	const head = store.getHead(storyId);
	const characterPrompt = settings.characterPrompt ?? "";
	const ledger = head === null ? null : listLedgerEntities(store, head.id);
	const characters = ledger?.characters ?? [];
	const relations = ledger?.relations ?? [];
	const openClues = ledger?.openClues ?? [];
	const items =
		head === null ? undefined : readLedger(store, head.id, ["item"]);
	const userWills =
		head === null ? undefined : readLedger(store, head.id, ["userWill"]);
	const plan = readDirectorPlan(store, storyId);
	const summary =
		head === null
			? null
			: (store.getValidSummaries(storyId, head.id)[0]?.text ?? null);
	const hasLedgerMaterial =
		characters.length > 0 ||
		relations.length > 0 ||
		openClues.length > 0 ||
		!isEmptyValue(items) ||
		!isEmptyValue(userWills);
	if (characterPrompt.trim().length === 0 && !hasLedgerMaterial) return null;
	return {
		headNodeId: head?.id ?? null,
		cardName: settings.cardName,
		characterPrompt,
		characters,
		relations,
		openClues,
		items,
		userWills,
		summary,
		plan,
	};
}

/**
 * 入队条件为 story 的判定：有素材，并且没有计划或当前拍已经耗尽。
 * 当前拍在 head 上仍能解析出来时不补建任务。
 */
export function directorPlanNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	const input = collectDirectorPlanInput(store, storyId);
	if (input === null) return false;
	if (input.plan.arcs.length === 0) return true;
	if (input.headNodeId === null) return false;
	return resolveCurrentBeat(store, storyId, input.headNodeId) === null;
}

/** 把收集到的输入拼成规划器共用的用户消息。 */
export function buildDirectorPlanUserContent(input: DirectorPlanInput): string {
	const lines: string[] = ["角色卡："];
	lines.push(input.cardName === null ? "名称：无" : `名称：${input.cardName}`);
	lines.push(
		input.characterPrompt.trim().length === 0
			? "（没有正文）"
			: input.characterPrompt,
	);

	lines.push("", "台账人物：");
	if (input.characters.length === 0) {
		lines.push("无。");
	} else {
		for (const character of input.characters) {
			lines.push(formatCharacter(character));
		}
	}

	lines.push("", "人物关系：");
	if (input.relations.length === 0) {
		lines.push("无。");
	} else {
		for (const relation of input.relations) {
			lines.push(formatRelation(relation));
		}
	}

	lines.push("", "未兑现线索：");
	if (input.openClues.length === 0) {
		lines.push("无。");
	} else {
		for (const clue of input.openClues) {
			lines.push(formatClue(clue));
		}
	}

	lines.push("", "物品：");
	lines.push(
		isEmptyValue(input.items) ? "无。" : JSON.stringify(input.items, null, 2),
	);

	lines.push("", "用户意志：");
	lines.push(
		isEmptyValue(input.userWills)
			? "无。"
			: JSON.stringify(input.userWills, null, 2),
	);

	lines.push("", "最近章节摘要：");
	lines.push(input.summary ?? "无。");

	lines.push("", "现有计划：");
	lines.push(
		input.plan.arcs.length === 0 ? "无。" : JSON.stringify(input.plan, null, 2),
	);
	return lines.join("\n");
}

/**
 * 执行一次规划：收集输入、请求模型、严格校验后按 `model` 来源合并。
 * 没有素材时返回 null；输出不合法时抛错，调用方不写入任何行。
 */
export async function generateDirectorPlan(
	options: GenerateDirectorPlanOptions,
): Promise<DirectorPlan | null> {
	const input = collectDirectorPlanInput(options.store, options.storyId);
	if (input === null) return null;
	const messages: LlmMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: buildDirectorPlanUserContent(input) },
	];
	const result = await options.client.complete({
		messages,
		model: options.model,
		temperature: 0,
		...(options.signal === undefined ? {} : { signal: options.signal }),
	});
	const plan = parseDirectorPlan(
		parseJsonOutputObject(result.text, "导演计划"),
	);
	mergePlannedArcs(options.store, options.storyId, plan, "model");
	return plan;
}

/** 后台任务处理器的实现；与 `dramaticer director plan --generate` 共用。 */
export function createDirectorPlanHandler(
	options: DirectorPlanHandlerOptions = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		await generateDirectorPlan({
			store,
			client: options.client ?? client,
			storyId: job.storyId,
			model: options.model,
			signal,
		});
	};
}

function formatCharacter(character: LedgerCharacter): string {
	const details = [
		character.tier === undefined ? null : `层级 ${character.tier}`,
		character.identity ?? null,
		character.status === undefined ? null : `状态 ${character.status}`,
		character.location === undefined ? null : `位置 ${character.location}`,
	].filter((part): part is string => part !== null && part.length > 0);
	return details.length === 0
		? `- ${character.id}`
		: `- ${character.id}：${details.join("，")}`;
}

function formatRelation(relation: LedgerRelation): string {
	const details = [
		relation.type === undefined ? null : `类型 ${relation.type}`,
		relation.stage === undefined ? null : `阶段 ${relation.stage}`,
		relation.affectionOuter === undefined
			? null
			: `外在 ${relation.affectionOuter}`,
		relation.affectionInner === undefined
			? null
			: `内在 ${relation.affectionInner}`,
	].filter((part): part is string => part !== null);
	return details.length === 0
		? `- ${relation.from} → ${relation.to}`
		: `- ${relation.from} → ${relation.to}：${details.join("，")}`;
}

function formatClue(clue: LedgerClue): string {
	const status = clue.status === undefined ? "" : `（${clue.status}）`;
	return clue.text === undefined
		? `- ${clue.id}${status}`
		: `- ${clue.id}${status}：${clue.text}`;
}

function isEmptyValue(value: JsonValue | undefined): boolean {
	if (value === undefined || value === null) return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "object") return Object.keys(value).length === 0;
	return false;
}

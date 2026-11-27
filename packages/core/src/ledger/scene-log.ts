import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import {
	type ResolvedCanonCursor,
	advanceCanonCursor,
	holdCanonCursor,
	resolveCanonCursor,
} from "../canon/cursor.js";
import {
	collectDirectorBitJudgmentInput,
	parseDirectorBitJudgmentResponse,
} from "../director/bit-judgments.js";
import type { DirectorBit } from "../director/bits.js";
import { guardBackgroundWrite } from "../edits/index.js";
import {
	type JsonObject,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import {
	type ExtractedEvent,
	parseEventExtraction,
	recordExtractedEvents,
} from "../memory/extract.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import { quoteMatches } from "../memory/quote.js";
import { readStoryFeatureState } from "../settings/features.js";
import type { StoryStore } from "../store/story-store.js";
import type { StateDiffOp, StoryTime, TimelineNode } from "../timeline.js";
import { readSceneSegments } from "./scenes.js";
import {
	type FloorProposals,
	LEDGER_PATH_GUIDE,
	applySettlementProposals,
	prepareSettlementForNodes,
} from "./settle.js";
import { type LedgerRepair, assertLedgerRepairs } from "./settlement.js";
import {
	type CapturedUserWill,
	applyCapturedUserWills,
	parseUserWillResponse,
	readExistingWills,
} from "./user-will.js";

export const SCENE_LOG_JOB_KIND = "scene_log";

/** 后台写入被拒的第二种原因（v5 §3.5）；另一种是与玩家锁定的事实冲突。 */
export const SECRET_LEAK_REASON = "让未知情者知道了秘密，原文里没有得知的经过";

/** 场记读取的最近楼层数；默认 6，与现场分析一致。 */
export const SCENE_LOG_WINDOW_FLOORS = 6;

/** 调度说明的定界符：提示词里的占位说明。 */
const BEAT_EXAMPLES = "安抚、试探、冲突升级、揭示";

const STATE_FIELDS = [
	"path",
	"op",
	"value",
	"reason",
	"confidence",
	"storyTime",
	"sourceQuote",
] as const;

const RESPONSE_KEYS = [
	"beat",
	"states",
	"present",
	"sceneEnds",
	"sceneCard",
	"bits",
	"conditions",
	"options",
	"events",
	"will",
	"canonCompleted",
] as const;

/** 局面更新顺带产出的行动选项条数范围。 */
const OPTION_MIN = 2;
const OPTION_MAX = 4;

/**
 * 局面更新（v5）在场记这一次调用里顺带产出的部分；每楼只发这一次后台调用，
 * 替代候选行动、事件抽取与用户意志的分散调用。
 */
export interface SituationParts {
	/** 2–4 条行动选项；功能页「行动选项」关掉时不要。 */
	readonly options: boolean;
	/** 这一楼值得记住的事件，写进只追加的记录表。 */
	readonly events: boolean;
	/** 最近一条玩家消息里跨楼层有效的偏好、底线与纠正。 */
	readonly will: boolean;
}

export const NO_SITUATION_PARTS: SituationParts = {
	options: false,
	events: false,
	will: false,
};

/** 按故事的功能开关决定这一楼的局面更新要顺带哪些部分。 */
export function readSituationParts(
	store: StoryStore,
	storyId: string,
): SituationParts {
	const features = readStoryFeatureState(store, storyId).values;
	return { options: features.choices === true, events: true, will: true };
}

const CONDITION_KEYS = ["id", "matched", "reason"] as const;

const SCENE_CARD_KEYS = ["present", "change"] as const;

const SCENE_CARD_PRESENT_KEYS = ["who", "want"] as const;

/** 场面卡里一个在场者：谁、此刻想要什么。 */
export interface SceneCardActor {
	readonly who: string;
	readonly want: string;
}

/** 一场开始时写下的场面卡；这一场结束时应该改变什么也在这里。 */
export interface SceneCard {
	readonly present: readonly SceneCardActor[];
	readonly change: string;
}

/** 一条通过引文校验的硬状态提案；引文逐字摘自任务楼层的原文。 */
export interface SceneLogState {
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	/** op 为 delete 时为 null。 */
	readonly value: unknown;
	readonly storyTime: StoryTime | null;
	readonly confidence: number;
	readonly reason: string | null;
	readonly sourceQuote: string;
}

/** 对一条文本条件的判断；与剧情小品任务共用同一形状。 */
export interface SceneLogConditionJudgment {
	readonly id: string;
	readonly matched: boolean;
	readonly reason: string;
}

export interface SceneLogQuoteStats {
	/** 模型提交的 states 条目数。 */
	readonly submitted: number;
	/** 引文逐字出现在任务楼层原文里的条目数。 */
	readonly verified: number;
}

/** 一个楼层的场记记录；与楼层绑定，同一楼层只有一行。 */
export interface SceneLog {
	readonly nodeId: string;
	readonly storyId: string;
	readonly beat: string;
	readonly present: readonly string[];
	readonly sceneEnds: boolean;
	/** 这一楼开了一个新场时写下的场面卡；其余楼层为 null。 */
	readonly sceneCard: SceneCard | null;
	readonly bits: readonly string[];
	readonly conditions: readonly SceneLogConditionJudgment[];
	readonly states: readonly SceneLogState[];
	readonly quotes: SceneLogQuoteStats;
	readonly repairs: readonly LedgerRepair[];
	readonly createdAt: string;
}

export interface NewSceneLog {
	readonly nodeId: string;
	readonly storyId: string;
	readonly beat: string;
	readonly present: readonly string[];
	readonly sceneEnds: boolean;
	readonly sceneCard: SceneCard | null;
	readonly bits: readonly string[];
	readonly conditions: readonly SceneLogConditionJudgment[];
	readonly states: readonly SceneLogState[];
	readonly quotes: SceneLogQuoteStats;
	readonly repairs: readonly LedgerRepair[];
	readonly createdAt?: string;
}

/** 校验场面卡；空在场者、空文本与重复人物都拒绝。 */
export function assertSceneCard(value: unknown, label: string): SceneCard {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, SCENE_CARD_KEYS, label);
	if (!Array.isArray(record.present)) {
		throw new Error(`${label}.present 必须是数组`);
	}
	if (record.present.length === 0) {
		throw new Error(`${label}.present 至少要有一个人`);
	}
	const seen = new Set<string>();
	const present = record.present.map((item, index): SceneCardActor => {
		const path = `${label}.present[${index}]`;
		const actor = assertPlainObject(item, path);
		rejectUnknownKeys(actor, SCENE_CARD_PRESENT_KEYS, path);
		const who = requireNonEmptyString(actor.who, `${path}.who`);
		if (seen.has(who)) {
			throw new Error(`${path}.who 与前面的人物重复：${who}`);
		}
		seen.add(who);
		return { who, want: requireNonEmptyString(actor.want, `${path}.want`) };
	});
	return {
		present,
		change: requireNonEmptyString(record.change, `${label}.change`),
	};
}

/** 校验存储里的一条场记状态；引文只查形状，原文可能已经不在当前路径上。 */
export function assertSceneLogState(
	value: unknown,
	label: string,
): SceneLogState {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, STATE_FIELDS, label);
	const path = readPath(record.path, `${label}.path`);
	const op = record.op;
	if (op !== "set" && op !== "delete") {
		throw new Error(`${label}.op 只能是 set 或 delete`);
	}
	if (op === "delete" && record.value !== null) {
		throw new Error(`${label} 的 delete 的 value 必须是 null`);
	}
	if (op === "set" && !Object.hasOwn(record, "value")) {
		throw new Error(`${label} 的 set 必须带 value`);
	}
	const confidence = record.confidence;
	if (
		typeof confidence !== "number" ||
		!Number.isFinite(confidence) ||
		confidence < 0 ||
		confidence > 1
	) {
		throw new Error(`${label}.confidence 必须是 0 到 1 的数字`);
	}
	const storyTime = readStoryTime(record.storyTime, `${label}.storyTime`);
	const reason = readNullableText(record.reason, `${label}.reason`);
	const sourceQuote = requireNonEmptyString(
		record.sourceQuote,
		`${label}.sourceQuote`,
	);
	return {
		path,
		op,
		value: op === "set" ? record.value : null,
		storyTime,
		confidence,
		reason,
		sourceQuote,
	};
}

/** 校验存储里的一组状态；错误信息带序号。 */
export function assertSceneLogStates(
	value: unknown,
	label: string,
): readonly SceneLogState[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	return value.map((item, index) =>
		assertSceneLogState(item, `${label}[${index}]`),
	);
}

/** 校验一条存储里的条件判断。 */
export function assertSceneLogCondition(
	value: unknown,
	label: string,
): SceneLogConditionJudgment {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, CONDITION_KEYS, label);
	const id = requireNonEmptyString(record.id, `${label}.id`);
	if (typeof record.matched !== "boolean") {
		throw new Error(`${label}.matched 必须是布尔值`);
	}
	const reason = requireNonEmptyString(record.reason, `${label}.reason`);
	return { id, matched: record.matched, reason };
}

/** 校验一组条件判断；错误信息带序号。 */
export function assertSceneLogConditions(
	value: unknown,
	label: string,
): readonly SceneLogConditionJudgment[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	return value.map((item, index) =>
		assertSceneLogCondition(item, `${label}[${index}]`),
	);
}

/** 校验引文统计。 */
export function assertSceneLogQuotes(
	value: unknown,
	label: string,
): SceneLogQuoteStats {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, ["submitted", "verified"], label);
	const submitted = readCount(record.submitted, `${label}.submitted`);
	const verified = readCount(record.verified, `${label}.verified`);
	if (verified > submitted) {
		throw new Error(`${label}.verified 不能大于 submitted`);
	}
	return { submitted, verified };
}

function readCount(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(`${label} 必须是非负整数`);
	}
	return value;
}

export interface SceneLogParseInput {
	readonly nodeId: string;
	/** 任务楼层的原文；引文必须逐字出现在里面。 */
	readonly floorRaw: string;
	/** 这一楼是否开了一个新场；新场必须给场面卡。 */
	readonly sceneStarts: boolean;
	/** 故事里已有的剧情小品；bits 只能从这个列表里选。 */
	readonly bits: readonly DirectorBit[];
	/** 需要判断的文本条件；conditions 必须恰好覆盖这些 id。 */
	readonly conditions: readonly {
		readonly id: string;
		readonly text: string;
	}[];
	/** 要顺带的部分；不传时只解析场记本身。 */
	readonly parts?: SituationParts;
	/** 用户意志的引文只能来自这些玩家楼层。 */
	readonly players?: readonly TimelineNode[];
}

export interface ParsedSceneLog {
	readonly beat: string;
	readonly states: readonly SceneLogState[];
	readonly present: readonly string[];
	readonly sceneEnds: boolean;
	readonly sceneCard: SceneCard | null;
	readonly bits: readonly string[];
	readonly conditions: readonly SceneLogConditionJudgment[];
	readonly quotes: SceneLogQuoteStats;
	readonly repairs: readonly LedgerRepair[];
	readonly options: readonly string[];
	readonly events: readonly ExtractedEvent[];
	readonly will: readonly CapturedUserWill[];
	/** 本楼是否演完了当前原著事件；故事没有绑定原著时为 null。 */
	readonly canonCompleted: boolean | null;
}

/**
 * 解析场记输出：形状错误整次拒绝；单条状态引文对不上只拒绝这一条，并把
 * 原因记进 repairs。`bits` 里不认识的 id 同样逐条拒绝。
 */
export function parseSceneLogResponse(
	text: string,
	input: SceneLogParseInput,
): ParsedSceneLog {
	const record = assertPlainObject(
		parseJsonOutputObject(text, "场记记录"),
		"场记记录",
	);
	rejectUnknownKeys(record, RESPONSE_KEYS, "场记记录");
	const beat = requireNonEmptyString(record.beat, "场记记录.beat");
	if (!Array.isArray(record.states)) {
		throw new Error("场记记录.states 必须是数组");
	}
	if (!Array.isArray(record.present)) {
		throw new Error("场记记录.present 必须是数组");
	}
	if (typeof record.sceneEnds !== "boolean") {
		throw new Error("场记记录.sceneEnds 必须是布尔值");
	}
	const repairs: LedgerRepair[] = [];
	let submitted = 0;
	let verified = 0;
	const states: SceneLogState[] = [];
	for (const [index, value] of record.states.entries()) {
		submitted += 1;
		const label = `场记记录.states[${index}]`;
		const quote = quoteOf(value);
		const matched = quote !== null && quoteMatches(input.floorRaw, quote);
		if (matched) verified += 1;
		try {
			const state = readProposedState(value, label);
			// v5 §3.5：引文只用来定位，对不上照样按楼层锚点写入；只有「谁得知了
			// 什么」必须在原文里有得知的经过，否则就是让未知情者知道了秘密。
			if (!matched && state.path[0] === "knowledge") {
				repairs.push({
					path: state.path,
					action: "delete",
					reason: `${SECRET_LEAK_REASON}：${state.path.join(".")}`,
				});
				continue;
			}
			states.push(state);
		} catch (error) {
			repairs.push({
				path: bestEffortPath(value),
				action: "delete",
				reason: `${label}：${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	const present = record.present.map((name, index) =>
		requireNonEmptyString(name, `场记记录.present[${index}]`),
	);
	const sceneCard = readSceneCard(record.sceneCard, input.sceneStarts, repairs);
	const bits = readBits(record.bits, input.bits, repairs);
	const conditions =
		input.conditions.length === 0
			? readEmptyConditions(record.conditions, repairs)
			: parseDirectorBitJudgmentResponse(
					JSON.stringify({ judgments: record.conditions }),
					input.conditions.map((condition) => condition.id),
				);
	const parts = input.parts ?? NO_SITUATION_PARTS;
	const canonCompleted = record.canonCompleted;
	if (canonCompleted !== undefined && typeof canonCompleted !== "boolean") {
		throw new Error("场记记录.canonCompleted 必须是布尔值");
	}
	return {
		beat,
		states,
		present: dedupe(present),
		sceneEnds: record.sceneEnds,
		sceneCard,
		bits,
		conditions,
		quotes: { submitted, verified },
		repairs,
		options: parts.options ? readOptions(record.options, repairs) : [],
		events: parts.events ? readEvents(record.events, repairs) : [],
		will: parts.will ? readWill(record.will, input.players ?? [], repairs) : [],
		canonCompleted: canonCompleted ?? null,
	};
}

/**
 * 顺带的部分格式不对时只丢掉这一部分并记进 repairs，场记本身照常落地：
 * v5 的校验只拦冲突与泄密，格式问题由程序修复，不打回。
 */
function readOptions(value: unknown, repairs: LedgerRepair[]): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		repairs.push({
			path: ["options"],
			action: "delete",
			reason: "场记记录.options 不是数组，已丢弃",
		});
		return [];
	}
	const options = dedupe(
		value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0),
	).slice(0, OPTION_MAX);
	if (options.length < OPTION_MIN) {
		if (value.length > 0) {
			repairs.push({
				path: ["options"],
				action: "delete",
				reason: `场记记录.options 少于 ${OPTION_MIN} 条可用选项，已丢弃`,
			});
		}
		return [];
	}
	return options;
}

function readEvents(
	value: unknown,
	repairs: LedgerRepair[],
): readonly ExtractedEvent[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		repairs.push({
			path: ["events"],
			action: "delete",
			reason: "场记记录.events 不是数组，已丢弃",
		});
		return [];
	}
	const events: ExtractedEvent[] = [];
	for (const [index, item] of value.entries()) {
		try {
			events.push(...parseEventExtraction(JSON.stringify([item])));
		} catch (error) {
			repairs.push({
				path: ["events", String(index)],
				action: "delete",
				reason: `场记记录.events[${index}]：${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	return events;
}

function readWill(
	value: unknown,
	players: readonly TimelineNode[],
	repairs: LedgerRepair[],
): readonly CapturedUserWill[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		repairs.push({
			path: ["will"],
			action: "delete",
			reason: "场记记录.will 不是数组，已丢弃",
		});
		return [];
	}
	const captured: CapturedUserWill[] = [];
	for (const [index, item] of value.entries()) {
		try {
			captured.push(...parseUserWillResponse(JSON.stringify([item]), players));
		} catch (error) {
			repairs.push({
				path: ["will", String(index)],
				action: "delete",
				reason: `场记记录.will[${index}]：${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
	return captured;
}

/**
 * 场面卡只在新场的第一楼要求；其余楼层模型照旧给出时按空处理并记入
 * repairs，不整次拒绝。
 */
function readSceneCard(
	value: unknown,
	sceneStarts: boolean,
	repairs: LedgerRepair[],
): SceneCard | null {
	if (value === undefined || value === null) {
		if (sceneStarts) {
			throw new Error("场记记录.sceneCard 必须给出这一场的场面卡");
		}
		return null;
	}
	if (!sceneStarts) {
		repairs.push({
			path: ["sceneCard"],
			action: "delete",
			reason: "这一楼没有开场，sceneCard 已丢弃",
		});
		return null;
	}
	return assertSceneCard(value, "场记记录.sceneCard");
}

function readEmptyConditions(
	value: unknown,
	repairs: LedgerRepair[],
): readonly SceneLogConditionJudgment[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error("场记记录.conditions 必须是数组");
	}
	if (value.length > 0) {
		repairs.push({
			path: ["conditions"],
			action: "delete",
			reason: "故事里没有待判断的文本条件，conditions 里给出的条目已丢弃",
		});
	}
	return [];
}

function readBits(
	value: unknown,
	known: readonly DirectorBit[],
	repairs: LedgerRepair[],
): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error("场记记录.bits 必须是数组");
	}
	const allowed = new Set(known.map((bit) => bit.id));
	const selected: string[] = [];
	for (const [index, item] of value.entries()) {
		const id = requireNonEmptyString(item, `场记记录.bits[${index}]`);
		if (!allowed.has(id)) {
			repairs.push({
				path: ["bits", id],
				action: "delete",
				reason: `场记记录.bits[${index}] 不是这个故事的剧情小品：${id}`,
			});
			continue;
		}
		selected.push(id);
	}
	return dedupe(selected);
}

function readProposedState(value: unknown, label: string): SceneLogState {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, STATE_FIELDS, label);
	const state = assertSceneLogState(
		{
			...record,
			value: record.op === "delete" ? null : record.value,
		},
		label,
	);
	return state;
}

function quoteOf(value: unknown): string | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const quote = (value as Record<string, unknown>).sourceQuote;
	return typeof quote === "string" && quote.length > 0 ? quote : null;
}

export interface SceneLogHandlerOptions {
	/** 场记读取的最近楼层数；默认 6。 */
	readonly windowFloors?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型（settler 角色）。 */
	readonly model?: string;
	/** 按故事决定这一楼顺带哪些部分；不设置时只写场记本身。 */
	readonly parts?: (store: StoryStore, storyId: string) => SituationParts;
}

/** 只放在有剧情小品时出现的说明。 */
function buildSystemPrompt(
	hasBits: boolean,
	hasConditions: boolean,
	sceneStarts: boolean,
	parts: SituationParts = NO_SITUATION_PARTS,
	hasCanon = false,
): string {
	const shape = [
		'"beat":"试探"',
		'"states":[{"path":["scene","current","place"],"op":"set","value":"教室","confidence":0.9,"sourceQuote":"原文里的原句"}]',
		'"present":["凛"]',
		'"sceneEnds":false',
		...(sceneStarts
			? [
					'"sceneCard":{"present":[{"who":"凛","want":"拿回那封信"}],"change":"凛离开教室，把信交出去"}',
				]
			: []),
		...(hasBits ? ['"bits":[]'] : []),
		...(hasConditions
			? ['"conditions":[{"id":"…","matched":true,"reason":"…"}]']
			: []),
		...(parts.options ? ['"options":["我先把信收好","问她刚才去了哪里"]'] : []),
		...(parts.events
			? [
					'"events":[{"text":"凛把信交给了老师","participants":["凛","老师"],"knowers":["凛","老师"],"importance":0.6,"quote":"原文里的原句"}]',
				]
			: []),
		...(parts.will
			? [
					'"will":[{"kind":"preference","text":"剧情保持轻松","sourceQuote":"玩家原话"}]',
				]
			: []),
		...(hasCanon ? ['"canonCompleted":false'] : []),
	];
	return [
		"你是故事的场记。回复落定后，你为这一楼写一条记录。只输出一个 JSON 对象，不要解释、前后缀或代码块标记。",
		`{${shape.join(",")}}`,
		`- beat：这一楼的节拍标签，一个短语，例如 ${BEAT_EXAMPLES}。`,
		"- states：这一楼确立的硬状态变化。只写位置、衣着、伤势、持有物、故事时间、在场者与卡定义的变量这类下一楼必须对得上的项；性格、关系史这类软知识不要写。",
		"- 每条 states 带 sourceQuote，摘自这一楼正文里支撑它的原句，尽量照抄。knowledge（谁得知了什么）必须是正文里确实写了得知的经过。",
		"- op 只能是 set 或 delete；delete 不能带 value；confidence 是 0 到 1 的数字。",
		"- present：这一楼结束时在场的人物名称，用卡里的写法。",
		"- sceneEnds：这一楼是否结束了一个场次。",
		...(sceneStarts
			? [
					"- sceneCard：这一楼开了一个新的场次，写下这一场的场面卡。present 是此刻在场者各自想要什么；change 是这一场结束时应该改变什么。两项都只写局面与人物意图。",
				]
			: []),
		...(hasBits
			? [
					"- bits：这一楼适合触发的剧情小品 id，只能从给定的列表里选，可以为空数组。",
				]
			: []),
		...(hasConditions
			? [
					"- conditions：对给定文本条件的判断，必须为每一条给出恰好一条记录，id 与输入完全一致。",
				]
			: []),
		...(parts.options
			? [
					`- options：玩家下一步可以直接发送的 ${OPTION_MIN} 到 ${OPTION_MAX} 条行动或台词，第一人称，具体到人和物，互不重复，不复述已经发生的事。`,
				]
			: []),
		...(parts.events
			? [
					"- events：这一楼里之后仍可能被提起的事实性事件，没有就给空数组。knowers 为空数组表示公开；quote 摘自这一楼正文里的原句。用克制、中性的表述概括。",
				]
			: []),
		...(parts.will
			? [
					"- will：只看最近一条玩家消息里玩家明确说出的、跨楼层仍然有效的偏好（preference）、底线（boundary）或纠正（correction）；角色台词与这一轮的具体行动不算；已经记录过的不要重复；sourceQuote 逐字摘自玩家原话。没有就给空数组。",
				]
			: []),
		...(hasCanon
			? [
					"- canonCompleted：当前原著事件是否已经在这一楼演完，只判断是或否；不要写任何时刻格式，也不要为了对上原著而硬推剧情。",
				]
			: []),
		"命名空间与路径：",
		...LEDGER_PATH_GUIDE,
	].join("\n");
}

function buildUserContent(
	snapshot: JsonObject,
	floors: readonly TimelineNode[],
	bits: readonly DirectorBit[],
	conditions: readonly {
		readonly id: string;
		readonly text: string;
	}[],
	knownWills: readonly string[] = [],
	canon: ResolvedCanonCursor | null = null,
): string {
	const lines: string[] = [
		"当前台账快照（截至这一楼）：",
		JSON.stringify(snapshot),
		"",
	];
	if (canon !== null) {
		lines.push(
			"当前原著事件（只判断这一楼是否演完，不写时刻）：",
			`- 「${canon.event.title}」（第 ${canon.chapterOrdinal} 章）`,
			`- 概要：${canon.event.summary}`,
			canon.event.digest.trim().length === 0
				? ""
				: `- 缩写：${canon.event.digest}`,
			"",
		);
	}
	lines.push("最近楼层的原文：");
	for (const node of floors) {
		lines.push(`<楼层 id="${node.id}" 角色="${node.role}">`);
		lines.push(node.raw);
		lines.push("</楼层>");
	}
	if (bits.length > 0) {
		lines.push("", "剧情小品：");
		for (const bit of bits) {
			lines.push(`- ${bit.id}：${bit.instruction}`);
		}
	}
	if (conditions.length > 0) {
		lines.push("", "待判断的文本条件：");
		lines.push(JSON.stringify(conditions));
	}
	if (knownWills.length > 0) {
		lines.push("", "已经记录过的玩家要求：");
		for (const text of knownWills) lines.push(`- ${text}`);
	}
	return lines.join("\n");
}

/**
 * 场记的后台任务：处理一个已落定的助手楼层。一次调用产出节拍、硬状态、
 * 在场者与场次边界；有剧情小品时顺带给出适用的小品与文本条件判断。
 * 状态写入走结算器，引文已经在解析时逐条核对。
 */
export function createSceneLogHandler(
	options: SceneLogHandlerOptions = {},
): BackgroundJobHandler {
	const windowFloors = positiveInteger(
		options.windowFloors ?? SCENE_LOG_WINDOW_FLOORS,
		"场记的最近楼层窗口",
	);
	return async ({ store, client, job, signal }) => {
		const nodeId = requireJobNodeId(job);
		const node = store.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		if (node.role !== "assistant") {
			throw new Error(`场记只处理助手楼层：${nodeId}`);
		}
		const floors = store
			.getPathToNode(nodeId)
			.filter((item) => item.raw.trim().length > 0)
			.slice(-windowFloors);
		const bits = store.listDirectorBits(job.storyId);
		const conditionInput = collectDirectorBitJudgmentInput(
			store,
			job.storyId,
			nodeId,
		);
		const conditions = conditionInput?.conditions ?? [];
		const segment = readSceneSegments(store, nodeId).find((item) =>
			item.floorIds.includes(nodeId),
		);
		const sceneStarts = segment !== undefined && segment.startNodeId === nodeId;
		const parts = options.parts?.(store, job.storyId) ?? NO_SITUATION_PARTS;
		// 用户意志只看紧挨这一楼的那条玩家消息；更早的消息已经被前面的楼层看过。
		const lastPlayer = [...floors]
			.reverse()
			.find((item) => item.role === "user" && item.raw.trim().length > 0);
		const players = lastPlayer === undefined ? [] : [lastPlayer];
		const effective: SituationParts = {
			...parts,
			will: parts.will && players.length > 0,
		};
		const canon = resolveCanonCursor(store, job.storyId, nodeId);
		const messages: LlmMessage[] = [
			{
				role: "system",
				content: buildSystemPrompt(
					bits.length > 0,
					conditions.length > 0,
					sceneStarts,
					effective,
					canon !== null,
				),
			},
			{
				role: "user",
				content: buildUserContent(
					store.getStateSnapshot(nodeId).state,
					floors,
					bits,
					conditions,
					effective.will ? readExistingWills(store, nodeId).texts : [],
					canon,
				),
			},
		];
		const result = await client.complete(
			{
				messages,
				model: options.model,
				temperature: 0,
				signal,
			},
			NO_CONTINUATION,
		);
		const parsed = parseSceneLogResponse(result.text, {
			nodeId,
			floorRaw: node.raw,
			sceneStarts,
			bits,
			conditions,
			parts: effective,
			players,
		});
		const window = prepareSettlementForNodes(store, job.storyId, [nodeId]);
		if (window === null) {
			throw new Error(`场记无法为楼层 ${nodeId} 构建结算窗口`);
		}
		const proposals: FloorProposals = {
			diffs: parsed.states,
			conflicts: [],
			beatCompleted: null,
			beatCompletedError: null,
		};
		// 重跑同一个楼层时结算记录已经存在，状态也已经写过；只更新场记行。
		const existingSettlement = store.getLedgerSettlement(nodeId);
		if (existingSettlement === null) {
			applySettlementProposals(store, window, new Map([[nodeId, proposals]]));
		}
		if (conditionInput !== null && parsed.conditions.length > 0) {
			store.saveDirectorBitJudgments({
				storyId: job.storyId,
				nodeId,
				fingerprint: conditionInput.fingerprint,
				judgments: parsed.conditions,
			});
		}
		const settlement = existingSettlement ?? store.getLedgerSettlement(nodeId);
		const settlementRepairs = settlement?.repairs.filter(
			(repair) => repair.action !== "fill",
		);
		// 玩家锁定的本场目标，场记只能把这次写下的内容留作建议。
		const sceneCard =
			parsed.sceneCard === null ||
			guardBackgroundWrite(
				store,
				job.storyId,
				nodeId,
				"scene",
				segment?.startNodeId ?? nodeId,
				JSON.parse(JSON.stringify(parsed.sceneCard)),
				"场记",
			)
				? parsed.sceneCard
				: null;
		store.saveSceneLog({
			nodeId,
			storyId: job.storyId,
			beat: parsed.beat,
			present: parsed.present,
			sceneEnds: parsed.sceneEnds,
			sceneCard,
			bits: parsed.bits,
			conditions: parsed.conditions,
			states: parsed.states,
			quotes: parsed.quotes,
			repairs: [...parsed.repairs, ...(settlementRepairs ?? [])],
		});
		// 原著游标：只有模型明确说这一楼演完了当前事件才前进；玩家偏离或
		// 没演完时原地写回。「从这里开始」的待演出游标先消费一格，不自动前进。
		if (canon !== null) {
			const anchored = canon.cursor?.fromHere === true;
			const advanced =
				parsed.canonCompleted === true && !anchored
					? advanceCanonCursor(store, job.storyId, nodeId)
					: null;
			if (advanced === null) {
				holdCanonCursor(
					store,
					job.storyId,
					nodeId,
					canon,
					anchored && parsed.canonCompleted !== true,
				);
			}
		}
		// 被拦下的泄密写入进检视器的拒收列表。
		for (const repair of parsed.repairs) {
			if (!repair.reason.startsWith(SECRET_LEAK_REASON)) continue;
			store.recordMemoryRejection({
				storyId: job.storyId,
				nodeId,
				kind: "state",
				text: repair.path.join("."),
				reason: SECRET_LEAK_REASON,
			});
		}
		// 顺带的部分都挂在这一楼上：楼层被重写后它们随旧楼一起离开当前路径。
		if (effective.options && parsed.options.length > 0) {
			store.replaceDirectorCandidateActions({
				storyId: job.storyId,
				nodeId,
				actions: parsed.options.map((text) => ({
					kind: "action" as const,
					text,
				})),
			});
		}
		if (effective.events) {
			recordExtractedEvents(
				store,
				job.storyId,
				{ floors: [node], span: [node], before: null, after: null },
				[{ nodeId, events: parsed.events }],
			);
		}
		if (effective.will && parsed.will.length > 0) {
			applyCapturedUserWills(store, job.storyId, nodeId, parsed.will);
		}
	};
}

function readPath(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是字符串组成的非空数组`);
	}
	const path: string[] = [];
	for (const [index, segment] of value.entries()) {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`${label}[${index}] 必须是非空字符串`);
		}
		path.push(segment);
	}
	return path;
}

function readStoryTime(value: unknown, label: string): StoryTime | null {
	if (value === undefined || value === null) return null;
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, ["start", "end"], label);
	return {
		start: readNullableText(record.start, `${label}.start`),
		end: readNullableText(record.end, `${label}.end`),
	};
}

function readNullableText(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	return requireNonEmptyString(value, label);
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function bestEffortPath(value: unknown): readonly string[] {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const path = (value as Record<string, unknown>).path;
		if (
			Array.isArray(path) &&
			path.length > 0 &&
			path.every((segment) => typeof segment === "string" && segment.length > 0)
		) {
			return path as readonly string[];
		}
	}
	return ["-"];
}

function dedupe(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

function positiveInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label}必须是正整数`);
	}
	return value;
}

/** 供存储层读取时复用的完整校验；返回字段齐全的副本。 */
export function assertNewSceneLog(input: NewSceneLog): NewSceneLog {
	return {
		nodeId: requireNonEmptyString(input.nodeId, "场记记录的楼层 id"),
		storyId: requireNonEmptyString(input.storyId, "场记记录的故事 id"),
		beat: requireNonEmptyString(input.beat, "场记记录的 beat"),
		present: input.present.map((name, index) =>
			requireNonEmptyString(name, `场记记录的 present[${index}]`),
		),
		sceneEnds: input.sceneEnds,
		sceneCard:
			input.sceneCard === null
				? null
				: assertSceneCard(input.sceneCard, "场记记录的 sceneCard"),
		bits: input.bits.map((id, index) =>
			requireNonEmptyString(id, `场记记录的 bits[${index}]`),
		),
		conditions: assertSceneLogConditions(
			input.conditions,
			"场记记录的 conditions",
		),
		states: assertSceneLogStates(input.states, "场记记录的 states"),
		quotes: assertSceneLogQuotes(input.quotes, "场记记录的 quotes"),
		repairs: assertLedgerRepairs(input.repairs, "场记记录的 repairs"),
	};
}

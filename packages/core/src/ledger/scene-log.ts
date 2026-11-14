import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import {
	collectDirectorBitJudgmentInput,
	parseDirectorBitJudgmentResponse,
} from "../director/bit-judgments.js";
import type { DirectorBit } from "../director/bits.js";
import {
	type JsonObject,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import type { StateDiffOp, StoryTime, TimelineNode } from "../timeline.js";
import {
	type FloorProposals,
	LEDGER_PATH_GUIDE,
	applySettlementProposals,
	prepareSettlementForNodes,
} from "./settle.js";
import { type LedgerRepair, assertLedgerRepairs } from "./settlement.js";

export const SCENE_LOG_JOB_KIND = "scene_log";

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
	"bits",
	"conditions",
] as const;

const CONDITION_KEYS = ["id", "matched", "reason"] as const;

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
	readonly bits: readonly string[];
	readonly conditions: readonly SceneLogConditionJudgment[];
	readonly states: readonly SceneLogState[];
	readonly quotes: SceneLogQuoteStats;
	readonly repairs: readonly LedgerRepair[];
	readonly createdAt?: string;
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
	/** 故事里已有的剧情小品；bits 只能从这个列表里选。 */
	readonly bits: readonly DirectorBit[];
	/** 需要判断的文本条件；conditions 必须恰好覆盖这些 id。 */
	readonly conditions: readonly {
		readonly id: string;
		readonly text: string;
	}[];
}

export interface ParsedSceneLog {
	readonly beat: string;
	readonly states: readonly SceneLogState[];
	readonly present: readonly string[];
	readonly sceneEnds: boolean;
	readonly bits: readonly string[];
	readonly conditions: readonly SceneLogConditionJudgment[];
	readonly quotes: SceneLogQuoteStats;
	readonly repairs: readonly LedgerRepair[];
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
		if (quote !== null && input.floorRaw.includes(quote)) verified += 1;
		try {
			const state = readProposedState(value, label);
			if (!input.floorRaw.includes(state.sourceQuote)) {
				repairs.push({
					path: state.path,
					action: "delete",
					reason: `${label}.sourceQuote 不在楼层 ${input.nodeId} 的原文里：${state.sourceQuote}`,
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
	const bits = readBits(record.bits, input.bits, repairs);
	const conditions =
		input.conditions.length === 0
			? readEmptyConditions(record.conditions, repairs)
			: parseDirectorBitJudgmentResponse(
					JSON.stringify({ judgments: record.conditions }),
					input.conditions.map((condition) => condition.id),
				);
	return {
		beat,
		states,
		present: dedupe(present),
		sceneEnds: record.sceneEnds,
		bits,
		conditions,
		quotes: { submitted, verified },
		repairs,
	};
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
}

/** 只放在有剧情小品时出现的说明。 */
function buildSystemPrompt(hasBits: boolean, hasConditions: boolean): string {
	const shape = [
		'"beat":"试探"',
		'"states":[{"path":["scene","current","place"],"op":"set","value":"教室","confidence":0.9,"sourceQuote":"原文里的原句"}]',
		'"present":["凛"]',
		'"sceneEnds":false',
		...(hasBits ? ['"bits":[]'] : []),
		...(hasConditions
			? ['"conditions":[{"id":"…","matched":true,"reason":"…"}]']
			: []),
	];
	return [
		"你是故事的场记。回复落定后，你为这一楼写一条记录。只输出一个 JSON 对象，不要解释、前后缀或代码块标记。",
		`{${shape.join(",")}}`,
		`- beat：这一楼的节拍标签，一个短语，例如 ${BEAT_EXAMPLES}。`,
		"- states：这一楼确立的硬状态变化。只写位置、衣着、伤势、持有物、故事时间、在场者与卡定义的变量这类下一楼必须对得上的项；性格、关系史这类软知识不要写。",
		"- 每条 states 必须带 sourceQuote，逐字摘自这一楼的正文，不要改写、概括或跨楼层拼接；对不上整条被拒绝。",
		"- op 只能是 set 或 delete；delete 不能带 value；confidence 是 0 到 1 的数字。",
		"- present：这一楼结束时在场的人物名称，用卡里的写法。",
		"- sceneEnds：这一楼是否结束了一个场次。",
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
): string {
	const lines: string[] = [
		"当前台账快照（截至这一楼）：",
		JSON.stringify(snapshot),
		"",
		"最近楼层的原文：",
	];
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
		const messages: LlmMessage[] = [
			{
				role: "system",
				content: buildSystemPrompt(bits.length > 0, conditions.length > 0),
			},
			{
				role: "user",
				content: buildUserContent(
					store.getStateSnapshot(nodeId).state,
					floors,
					bits,
					conditions,
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
			bits,
			conditions,
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
		store.saveSceneLog({
			nodeId,
			storyId: job.storyId,
			beat: parsed.beat,
			present: parsed.present,
			sceneEnds: parsed.sceneEnds,
			bits: parsed.bits,
			conditions: parsed.conditions,
			states: parsed.states,
			quotes: parsed.quotes,
			repairs: [...parsed.repairs, ...(settlementRepairs ?? [])],
		});
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

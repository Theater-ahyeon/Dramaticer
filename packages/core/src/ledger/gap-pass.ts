import {
	BackgroundJobDeferredError,
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import {
	type JsonObject,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import type { LlmMessage } from "../llm/types.js";
import { EVENT_WINDOW_FLOORS } from "../memory/event.js";
import {
	type EventWindow,
	formatEventWindow,
	parseEventBatchExtraction,
	recordExtractedEvents,
	selectEventWindow,
} from "../memory/extract.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import { SCENE_WINDOW_FLOORS, saveSceneAnalysisText } from "../memory/scene.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import {
	MEMORY_REVISION_WINDOW_FLOORS,
	applyRevisionDrafts,
	parseRevisionResponse,
} from "./revision.js";
import {
	LEDGER_PATH_GUIDE,
	type PrepareSettlementOptions,
	type SettlementWindow,
	applySettlementProposals,
	parseSettleResponse,
	prepareSettlement,
} from "./settle.js";
import {
	USER_WILL_WINDOW_FLOORS,
	applyCapturedUserWills,
	parseUserWillResponse,
	readExistingWills,
} from "./user-will.js";

export const GAP_PASS_JOB_KIND = "gap_pass";

/** 合并调用输出里的段落名；每个段落各自校验、各自写入。 */
export const GAP_PASS_SEGMENTS = [
	"settlement",
	"scene",
	"userWill",
	"revision",
	"events",
] as const;
export type GapPassSegment = (typeof GAP_PASS_SEGMENTS)[number];

export function isGapPassSegment(value: unknown): value is GapPassSegment {
	return (
		typeof value === "string" &&
		(GAP_PASS_SEGMENTS as readonly string[]).includes(value)
	);
}

/** 一次合并调用里被拒绝的段落与原因；其余段落照常写入。 */
export interface GapPassSegmentRejection {
	readonly segment: GapPassSegment;
	readonly reason: string;
}

/** 会按楼层逐条判定的段落：窗口外的条目丢弃，不连累同一段的其他条目。 */
export const GAP_PASS_DROPPED_SEGMENTS = ["settlement", "events"] as const;
export type GapPassDroppedSegment = (typeof GAP_PASS_DROPPED_SEGMENTS)[number];

/** 合并调用里逐条丢弃的窗口外条目；只丢弃这一条，不整段拒绝。 */
export interface GapPassDroppedEntry {
	readonly segment: GapPassDroppedSegment;
	readonly nodeId: string;
	readonly reason: string;
}

/** 一个楼层的合并调用执行记录；同一楼层重复执行覆盖同一行。 */
export interface GapPassRun {
	readonly nodeId: string;
	readonly storyId: string;
	readonly rejectedSegments: readonly GapPassSegmentRejection[];
	readonly droppedEntries: readonly GapPassDroppedEntry[];
	readonly createdAt: string;
}

export interface NewGapPassRun {
	readonly nodeId: string;
	readonly storyId: string;
	readonly rejectedSegments: readonly GapPassSegmentRejection[];
	readonly droppedEntries?: readonly GapPassDroppedEntry[];
	readonly createdAt?: string;
}

/** 校验一组段落拒绝记录并返回去掉首尾空白的副本。 */
export function assertGapPassRejections(
	value: unknown,
	label: string,
): readonly GapPassSegmentRejection[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	return value.map((item, index) => {
		const entryLabel = `${label}[${index}]`;
		const record = assertPlainObject(item, entryLabel);
		rejectUnknownKeys(record, ["segment", "reason"], entryLabel);
		if (!isGapPassSegment(record.segment)) {
			throw new Error(
				`${entryLabel}.segment 只能是 ${GAP_PASS_SEGMENTS.join("、")}`,
			);
		}
		const reason = record.reason;
		if (typeof reason !== "string" || reason.trim().length === 0) {
			throw new Error(`${entryLabel}.reason 必须是非空字符串`);
		}
		return { segment: record.segment, reason: reason.trim() };
	});
}

/** 校验一组丢弃记录并返回去掉首尾空白的副本。 */
export function assertGapPassDroppedEntries(
	value: unknown,
	label: string,
): readonly GapPassDroppedEntry[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	return value.map((item, index) => {
		const entryLabel = `${label}[${index}]`;
		const record = assertPlainObject(item, entryLabel);
		rejectUnknownKeys(record, ["segment", "nodeId", "reason"], entryLabel);
		if (
			typeof record.segment !== "string" ||
			!(GAP_PASS_DROPPED_SEGMENTS as readonly string[]).includes(record.segment)
		) {
			throw new Error(
				`${entryLabel}.segment 只能是 ${GAP_PASS_DROPPED_SEGMENTS.join("、")}`,
			);
		}
		const nodeId = record.nodeId;
		if (typeof nodeId !== "string" || nodeId.trim().length === 0) {
			throw new Error(`${entryLabel}.nodeId 必须是非空字符串`);
		}
		const reason = record.reason;
		if (typeof reason !== "string" || reason.trim().length === 0) {
			throw new Error(`${entryLabel}.reason 必须是非空字符串`);
		}
		return {
			segment: record.segment as GapPassDroppedSegment,
			nodeId: nodeId.trim(),
			reason: reason.trim(),
		};
	});
}

export interface GapPassHandlerOptions extends PrepareSettlementOptions {
	/** 现场分析读取的最近楼层数；默认 6。 */
	readonly sceneWindowFloors?: number;
	/** 用户意志读取的最近玩家消息条数；默认 6。 */
	readonly userWillWindowFloors?: number;
	/** 修订草案读取的最近玩家消息条数；默认 6。 */
	readonly revisionWindowFloors?: number;
	/** 事件抽取的窗口楼层数；默认 8。 */
	readonly eventWindowFloors?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型（settler 角色）。 */
	readonly model?: string;
}

interface GapPassInputs {
	readonly window: SettlementWindow | null;
	readonly snapshot: JsonObject;
	readonly sceneFloors: readonly TimelineNode[];
	readonly existingWills: readonly string[];
	readonly existingCards: readonly string[];
	readonly players: readonly TimelineNode[];
	readonly eventWindow: EventWindow | null;
}

/**
 * 间隙合并调用的后台任务：一次请求同时产出结算、现场分析、用户意志与修订
 * 候选，事件作为可选段。每个段落单独校验；某一段不合格只丢弃这一段并把
 * 原因记进执行记录，其余段落照常写入。
 */
export function createGapPassHandler(
	options: GapPassHandlerOptions = {},
): BackgroundJobHandler {
	const settlementOptions: PrepareSettlementOptions = {
		windowSize: options.windowSize,
		conflictWindowFloors: options.conflictWindowFloors,
	};
	const sceneWindow = positiveInteger(
		options.sceneWindowFloors ?? SCENE_WINDOW_FLOORS,
		"合并调用的现场分析楼层窗口",
	);
	const userWillWindow = positiveInteger(
		options.userWillWindowFloors ?? USER_WILL_WINDOW_FLOORS,
		"合并调用的用户意志窗口",
	);
	const revisionWindow = positiveInteger(
		options.revisionWindowFloors ?? MEMORY_REVISION_WINDOW_FLOORS,
		"合并调用的修订草案窗口",
	);
	const eventWindowFloors = positiveInteger(
		options.eventWindowFloors ?? EVENT_WINDOW_FLOORS,
		"合并调用的事件窗口",
	);
	const playerWindow = Math.max(userWillWindow, revisionWindow);

	return async ({ store, client, job }) => {
		const nodeId = requireJobNodeId(job);
		const window = prepareSettlement(store, job.storyId, settlementOptions);
		const inWindow = window?.nodeIds.includes(nodeId);
		const hasSettlement = store.getLedgerSettlement(nodeId) !== null;
		if (!inWindow && !hasSettlement) {
			throw new BackgroundJobDeferredError();
		}
		const path = store.getPathToNode(nodeId);
		const players = path
			.filter((node) => node.role === "user" && node.raw.trim().length > 0)
			.slice(-playerWindow);
		const eventWindow = selectEventWindow(
			store,
			job.storyId,
			eventWindowFloors,
		);
		const inputs: GapPassInputs = {
			window,
			snapshot: store.getStateSnapshot(nodeId).state,
			sceneFloors: path
				.slice(-sceneWindow)
				.filter((node) => node.raw.trim().length > 0),
			existingWills: readExistingWills(store, nodeId).texts,
			existingCards: store
				.listLedgerChangeCards(job.storyId)
				.filter(
					(card) => card.status === "pending" || card.status === "approved",
				)
				.map((card) => card.text),
			players,
			eventWindow,
		};
		const messages: LlmMessage[] = [
			{
				role: "system",
				content: buildSystemPrompt({
					settlement: window !== null,
					userWill: players.length > 0,
					revision: players.length > 0,
					events: eventWindow !== null,
				}),
			},
			{ role: "user", content: buildUserContent(inputs) },
		];
		const result = await client.complete({
			messages,
			model: options.model,
			temperature: 0,
		});
		const response = parseGapPassResponse(result.text);
		const rejections: GapPassSegmentRejection[] = [];
		const dropped: GapPassDroppedEntry[] = [];
		// 没有结算窗口时这一段不在输入里；模型仍然输出时按空处理，不算拒绝。
		if (response.settlement !== undefined && window !== null) {
			applySegment(rejections, dropped, "settlement", () => {
				const filtered = filterWindowEntries(
					"settlement",
					response.settlement,
					window.nodeIds,
					"结算段",
				);
				if (filtered.kept.length > 0) {
					applySettlementProposals(
						store,
						window,
						parseSettleResponse(JSON.stringify(filtered.kept), window.nodeIds),
					);
				}
				return filtered.dropped;
			});
		}
		if (response.scene !== undefined) {
			applySegment(rejections, dropped, "scene", () => {
				if (typeof response.scene !== "string") {
					throw new Error("scene 段必须是字符串");
				}
				if (store.getLedgerSettlement(nodeId) === null) {
					throw new Error("楼层还没有结算记录，现场分析留到结算完成后再做");
				}
				saveSceneAnalysisText(store, job.storyId, nodeId, response.scene);
				return [];
			});
		}
		if (response.userWill !== undefined) {
			applySegment(rejections, dropped, "userWill", () => {
				const captured = parseUserWillResponse(
					JSON.stringify(response.userWill),
					players.slice(-userWillWindow),
				);
				applyCapturedUserWills(store, job.storyId, nodeId, captured);
				return [];
			});
		}
		if (response.revision !== undefined) {
			applySegment(rejections, dropped, "revision", () => {
				const drafts = parseRevisionResponse(
					JSON.stringify(response.revision),
					players.slice(-revisionWindow),
				);
				applyRevisionDrafts(
					store,
					job.storyId,
					nodeId,
					drafts,
					store.getStateSnapshot(nodeId).state,
				);
				return [];
			});
		}
		if (response.events !== undefined && eventWindow !== null) {
			applySegment(rejections, dropped, "events", () => {
				const windowIds = eventWindow.floors.map((node) => node.id);
				const filtered = filterWindowEntries(
					"events",
					response.events,
					windowIds,
					"事件段",
				);
				if (filtered.kept.length > 0) {
					recordExtractedEvents(
						store,
						job.storyId,
						eventWindow,
						parseEventBatchExtraction(JSON.stringify(filtered.kept), windowIds),
					);
				}
				return filtered.dropped;
			});
		}
		store.saveGapPassRun({
			nodeId,
			storyId: job.storyId,
			rejectedSegments: rejections,
			droppedEntries: dropped,
		});
	};
}

interface GapPassRequestedSegments {
	readonly settlement: boolean;
	readonly userWill: boolean;
	readonly revision: boolean;
	readonly events: boolean;
}

function applySegment(
	rejections: GapPassSegmentRejection[],
	dropped: GapPassDroppedEntry[],
	segment: GapPassSegment,
	action: () => readonly GapPassDroppedEntry[] | undefined,
): void {
	try {
		const entries = action();
		if (entries !== undefined) dropped.push(...entries);
	} catch (error) {
		rejections.push({
			segment,
			reason: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * 只把本楼层有的段落写进提示词：没有结算窗口就不提 settlement，没有事件
 * 窗口就不提 events，没有玩家消息就不提 userWill 与 revision。
 */
function buildSystemPrompt(requested: GapPassRequestedSegments): string {
	const shape = [
		...(requested.settlement ? ['"settlement":[…]'] : []),
		'"scene":"…"',
		...(requested.userWill ? ['"userWill":[…]'] : []),
		...(requested.revision ? ['"revision":[…]'] : []),
		...(requested.events ? ['"events":[…]'] : []),
	];
	return [
		"你在替故事引擎完成一次后台记录。阅读输入，只输出一个 JSON 对象；没有内容可写的段落直接省略。",
		`{${shape.join(",")}}`,
		"- 只输出这个 JSON 对象，不要解释、前缀后缀或代码块标记。",
		"- 只输出下面说明的段落；没有说明的段落一概不要输出。",
		"- 每个段落都会被单独校验；某一段不合格只丢弃这一段，其余段落照常采用。",
		...(requested.settlement
			? [
					"settlement：结算结果数组，每项形如：",
					'{"nodeId":"结算窗口里的楼层 id","diffs":[{"path":["clue","c1","status"],"op":"set","value":"open","confidence":0.8,"reason":"一句话依据"}],"conflicts":[{"path":["character","凛","location"],"reason":"最近一楼明确写她还在教室"}]}',
					"- nodeId 必须是结算窗口里的楼层，每个楼层最多出现一次；op 只能是 set 或 delete；confidence 是 0 到 1 的数字；楼层里已经写入的路径不要重复输出。",
					"- 与冲突检查窗口的原文明确矛盾的事实不要写进 diffs，写进同一楼层的 conflicts。",
				]
			: []),
		"scene：一段纯文本现场分析，写明在场人物各自此刻想要什么、各自知道什么、彼此之间的张力在哪里，控制在两百字以内。",
		...(requested.userWill
			? [
					'userWill：用户意志数组，每项形如 {"kind":"preference","text":"剧情保持轻松","sourceQuote":"原文里的原句"}；kind 取 preference、boundary、correction；sourceQuote 必须逐字摘自玩家消息；已有的条目不要重复记录。',
				]
			: []),
		...(requested.revision
			? [
					'revision：变更卡草案数组，每项形如 {"text":"把凛的所在地改成屋顶","sourceQuote":"原文里的原句","diffs":[{"path":["character","凛","location"],"op":"set","value":"屋顶"}]}；只处理玩家明确要求修改事实的句子，sourceQuote 必须逐字摘自玩家消息；已有的变更卡不要重复生成。',
				]
			: []),
		...(requested.events
			? [
					'events：事件抽取数组，每项形如 {"nodeId":"事件窗口里的助手楼层 id","events":[{"text":"一句话描述","participants":["凛"],"knowers":["凛"],"importance":0.5,"storyTime":"故事内时间","location":"地点"}]}；只为事件窗口里有 id 的助手楼层输出，其余楼层不要输出记录。',
				]
			: []),
		"命名空间与路径：",
		...LEDGER_PATH_GUIDE,
	].join("\n");
}

function buildUserContent(inputs: GapPassInputs): string {
	const lines: string[] = [];
	const jobSnapshot = JSON.stringify(inputs.snapshot);
	if (inputs.window === null) {
		lines.push(
			"当前台账快照（截至本楼层）：",
			jobSnapshot,
			"",
			"没有待结算的楼层，本轮不要输出 settlement 段。",
		);
	} else {
		lines.push(
			"当前台账快照（截至结算窗口最后一楼）：",
			JSON.stringify(inputs.window.snapshot),
			"",
			"冲突检查窗口（最近楼层的原文，只用来核对冲突，不是可写入的楼层）：",
		);
		for (const node of inputs.window.conflictWindow) {
			lines.push(`<最近楼层 角色="${node.role}">`);
			lines.push(node.raw);
			lines.push("</最近楼层>");
		}
		lines.push("", "结算窗口（只有这里出现 id 的楼层可以写进结算段）：");
		for (const floor of inputs.window.floors) {
			lines.push(`<楼层 id="${floor.nodeId}">`);
			lines.push("正文：");
			lines.push(floor.raw);
			if (floor.covered.length === 0) {
				lines.push("本楼层没有通过校验的结构化写入。");
			} else {
				lines.push("本楼层已经写入的路径（不要重复输出）：");
				for (const covered of floor.covered) {
					lines.push(JSON.stringify(covered.path));
				}
			}
			lines.push("</楼层>");
		}
		if (JSON.stringify(inputs.window.snapshot) !== jobSnapshot) {
			lines.push("", "本楼层的台账快照（截至要分析的楼层）：", jobSnapshot);
		}
	}
	lines.push(
		"",
		"现场分析用的最近楼层（只作上下文，不能写进结算段与事件段）：",
	);
	for (const node of inputs.sceneFloors) {
		lines.push(`<楼层 角色="${node.role}">`);
		lines.push(node.raw);
		lines.push("</楼层>");
	}
	lines.push("", "已有的用户意志（不要重复记录）：");
	if (inputs.existingWills.length === 0) lines.push("无。");
	for (const text of inputs.existingWills) lines.push(`- ${text}`);
	lines.push("", "已有的变更卡（不要重复生成）：");
	if (inputs.existingCards.length === 0) lines.push("无。");
	for (const text of inputs.existingCards) lines.push(`- ${text}`);
	lines.push(
		"",
		"最近的玩家消息（只用来找 userWill 与 revision 的原句，不是可写入的楼层）：",
	);
	if (inputs.players.length === 0) lines.push("无。");
	for (const node of inputs.players) {
		lines.push("<玩家消息>");
		lines.push(node.raw);
		lines.push("</玩家消息>");
	}
	if (inputs.eventWindow !== null) {
		lines.push("", "事件抽取窗口：", formatEventWindow(inputs.eventWindow));
	}
	return lines.join("\n");
}

/** 按楼层过滤一个段落的条目：窗口外的与重复的楼层逐条丢弃并给出原因。 */
function filterWindowEntries(
	segment: GapPassDroppedSegment,
	value: unknown,
	windowIds: readonly string[],
	label: string,
): {
	readonly kept: readonly unknown[];
	readonly dropped: readonly GapPassDroppedEntry[];
} {
	if (!Array.isArray(value)) {
		throw new Error(`${label}必须是数组`);
	}
	const allowed = new Set(windowIds);
	const seen = new Set<string>();
	const kept: unknown[] = [];
	const dropped: GapPassDroppedEntry[] = [];
	for (const item of value) {
		const nodeId = entryNodeId(item);
		if (nodeId === null) {
			kept.push(item);
			continue;
		}
		if (!allowed.has(nodeId)) {
			dropped.push({
				segment,
				nodeId,
				reason: `${label}里的楼层 ${nodeId} 不在本次窗口内，已丢弃`,
			});
			continue;
		}
		if (seen.has(nodeId)) {
			dropped.push({
				segment,
				nodeId,
				reason: `${label}里的楼层 ${nodeId} 重复出现，只保留第一条`,
			});
			continue;
		}
		seen.add(nodeId);
		kept.push(item);
	}
	return { kept, dropped };
}

function entryNodeId(value: unknown): string | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const nodeId = (value as Record<string, unknown>).nodeId;
	return typeof nodeId === "string" ? nodeId : null;
}

function parseGapPassResponse(text: string): Record<string, unknown> {
	const record = parseJsonOutputObject(text, "合并调用结果");
	rejectUnknownKeys(record, GAP_PASS_SEGMENTS, "合并调用结果");
	return record;
}

function positiveInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label}必须是正整数`);
	}
	return value;
}

import type { BackgroundJobHandler } from "../background/types.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { LlmClient, LlmMessage } from "../llm/types.js";
import { NO_CONTINUATION } from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import {
	type BlueprintDiff,
	type BlueprintEntry,
	type StoryBlueprintRecord,
	applyBlueprintDiffs,
	assertBlueprintDiffs,
} from "./story-blueprint.js";

/** 玩家可以发起的五个蓝图建议操作。 */
export const BLUEPRINT_SUGGESTION_OPERATIONS = [
	"complete",
	"find-flaws",
	"three-directions",
	"expand-volume",
	"recent-update",
] as const;

export type BlueprintSuggestionOperation =
	(typeof BLUEPRINT_SUGGESTION_OPERATIONS)[number];

export const BLUEPRINT_SUGGESTION_OPERATION_LABELS: Record<
	BlueprintSuggestionOperation,
	string
> = {
	complete: "帮我补全",
	"find-flaws": "找漏洞",
	"three-directions": "给三种走向",
	"expand-volume": "展开这一卷",
	"recent-update": "按最近剧情更新",
};

const OPERATION_INSTRUCTIONS: Record<BlueprintSuggestionOperation, string> = {
	complete:
		"补全空白或缺失的部分：没有总纲时给出总纲，卷与里程碑不完整时补齐结构与文本。保留玩家已经写下的内容，除非它是明显的错误。",
	"find-flaws":
		"对照当前蓝图、最近剧情与已知设定找矛盾：前后不一致、前提条件无法满足、里程碑指向的卷不存在、红线与走向冲突。每条建议只处理一个矛盾。",
	"three-directions":
		"给出三种明显不同的走向，每种走向一条建议；三条建议之间不能只是措辞不同。",
	"expand-volume":
		"把当前卷展开成里程碑：优先使用玩家补充里点名的卷，没有点名时用蓝图里最后一卷。里程碑要有前提条件、先后约束与硬性程度。",
	"recent-update":
		"按最近剧情更新蓝图：把已经发生的事写进卷的起止状态或里程碑，调整明显不再可达的里程碑，不要删除玩家锁定的内容。",
};

/** 后台任务类型：为一条待处理的建议请求生成建议。 */
export const BLUEPRINT_SUGGESTION_JOB_KIND = "blueprint_suggestion";

/** 建议读取的最近楼层数。 */
export const BLUEPRINT_SUGGESTION_WINDOW_FLOORS = 12;

/** 一轮最多返回的建议条数。 */
export const MAX_BLUEPRINT_SUGGESTIONS = 5;

/** 建议标题的最大长度。 */
export const MAX_BLUEPRINT_SUGGESTION_TITLE_CHARS = 80;

/** 建议理由的最大长度。 */
export const MAX_BLUEPRINT_SUGGESTION_REASON_CHARS = 500;

/** 玩家补充说明的最大长度。 */
export const MAX_BLUEPRINT_SUGGESTION_NOTE_CHARS = 500;

/** 建议请求的状态：等待生成或已经生成。 */
export const BLUEPRINT_SUGGESTION_REQUEST_STATUSES = [
	"pending",
	"done",
] as const;

export type BlueprintSuggestionRequestStatus =
	(typeof BLUEPRINT_SUGGESTION_REQUEST_STATUSES)[number];

/** 建议的状态：等待玩家决定、已接受或已拒绝。 */
export const BLUEPRINT_SUGGESTION_STATUSES = [
	"pending",
	"accepted",
	"rejected",
] as const;

export type BlueprintSuggestionStatus =
	(typeof BLUEPRINT_SUGGESTION_STATUSES)[number];

export const BLUEPRINT_SUGGESTION_STATUS_LABELS: Record<
	BlueprintSuggestionStatus,
	string
> = {
	pending: "待决定",
	accepted: "已接受",
	rejected: "已拒绝",
};

/** 玩家发起的一次建议请求；后台任务一次处理一条待处理的请求。 */
export interface BlueprintSuggestionRequest {
	readonly id: number;
	readonly storyId: string;
	readonly operation: BlueprintSuggestionOperation;
	/** 玩家补充说明；可以为空。 */
	readonly note: string;
	readonly status: BlueprintSuggestionRequestStatus;
	readonly createdAt: string;
	readonly finishedAt: string | null;
}

export interface NewBlueprintSuggestionRequestInput {
	readonly storyId: string;
	readonly operation: BlueprintSuggestionOperation;
	readonly note?: string;
	readonly createdAt?: string;
}

/** 一条建议；生成时不写蓝图，玩家接受后才写入。 */
export interface BlueprintSuggestion {
	readonly id: number;
	readonly requestId: number;
	readonly storyId: string;
	readonly title: string;
	readonly reason: string;
	readonly diffs: readonly BlueprintDiff[];
	readonly status: BlueprintSuggestionStatus;
	readonly createdAt: string;
	readonly decidedAt: string | null;
}

export interface NewBlueprintSuggestionInput {
	readonly title: string;
	readonly reason: string;
	readonly diffs: readonly BlueprintDiff[];
}

export interface AcceptBlueprintSuggestionInput {
	readonly id: number;
	/** 接受后把修改写入的楼层；通常是当前 head。 */
	readonly nodeId: string;
	readonly createdAt?: string;
}

export interface BlueprintSuggestionAcceptance {
	readonly suggestion: BlueprintSuggestion;
	readonly record: StoryBlueprintRecord;
}

export interface RejectBlueprintSuggestionInput {
	readonly id: number;
	readonly decidedAt?: string;
}

export function isBlueprintSuggestionOperation(
	value: unknown,
): value is BlueprintSuggestionOperation {
	return (
		typeof value === "string" &&
		(BLUEPRINT_SUGGESTION_OPERATIONS as readonly string[]).includes(value)
	);
}

export function assertBlueprintSuggestionOperation(
	value: unknown,
	label = "蓝图建议操作",
): BlueprintSuggestionOperation {
	if (!isBlueprintSuggestionOperation(value)) {
		throw new Error(
			`${label}只能是 ${BLUEPRINT_SUGGESTION_OPERATIONS.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

export function isBlueprintSuggestionStatus(
	value: unknown,
): value is BlueprintSuggestionStatus {
	return (
		typeof value === "string" &&
		(BLUEPRINT_SUGGESTION_STATUSES as readonly string[]).includes(value)
	);
}

export function assertBlueprintSuggestionStatus(
	value: unknown,
	label = "蓝图建议状态",
): BlueprintSuggestionStatus {
	if (!isBlueprintSuggestionStatus(value)) {
		throw new Error(
			`${label}只能是 ${BLUEPRINT_SUGGESTION_STATUSES.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

export function isBlueprintSuggestionRequestStatus(
	value: unknown,
): value is BlueprintSuggestionRequestStatus {
	return (
		typeof value === "string" &&
		(BLUEPRINT_SUGGESTION_REQUEST_STATUSES as readonly string[]).includes(value)
	);
}

export function assertBlueprintSuggestionRequestStatus(
	value: unknown,
	label = "蓝图建议请求状态",
): BlueprintSuggestionRequestStatus {
	if (!isBlueprintSuggestionRequestStatus(value)) {
		throw new Error(
			`${label}只能是 ${BLUEPRINT_SUGGESTION_REQUEST_STATUSES.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
	return value;
}

/** 建议的补充说明允许为空，但不能超过上限。 */
export function readBlueprintSuggestionNote(
	value: unknown,
	label = "蓝图建议的补充说明",
): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const note = value.trim();
	if (note.length > MAX_BLUEPRINT_SUGGESTION_NOTE_CHARS) {
		throw new Error(
			`${label} 不能超过 ${MAX_BLUEPRINT_SUGGESTION_NOTE_CHARS} 字`,
		);
	}
	return note;
}

function readSuggestionText(
	value: unknown,
	label: string,
	maxChars: number,
): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const text = value.trim();
	if (text.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	if (text.length > maxChars) {
		throw new Error(`${label} 不能超过 ${maxChars} 字`);
	}
	return text;
}

/**
 * 跳过锁定条目的修改。AI 生成与玩家接受都用这一处口径：生成时模型改写
 * 锁定的条目会被丢掉，接受时蓝图已经变化（后来被锁定）的条目同样跳过。
 */
export function filterLockedBlueprintDiffs(
	entries: readonly BlueprintEntry[],
	diffs: readonly BlueprintDiff[],
	label = "蓝图建议",
): BlueprintDiff[] {
	const parsed = assertBlueprintDiffs(diffs, `${label}的 diffs`);
	const locked = new Set(
		entries.filter((entry) => entry.locked).map((entry) => entry.id),
	);
	return parsed.filter((diff) => {
		const id = diff.action === "set" ? diff.entry.id : diff.id;
		return !locked.has(id);
	});
}

/**
 * AI 建议里的条目出处固定为 AI，锁定标记沿用当前条目；新条目不加锁。
 * 锁定条目的修改在此之前已经被过滤掉。
 */
function normalizeSuggestionDiffs(
	entries: readonly BlueprintEntry[],
	diffs: readonly BlueprintDiff[],
	label: string,
): BlueprintDiff[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
	return filterLockedBlueprintDiffs(entries, diffs, label).map(
		(diff): BlueprintDiff => {
			if (diff.action === "delete") return diff;
			return {
				action: "set",
				entry: {
					...diff.entry,
					source: "ai",
					locked: byId.get(diff.entry.id)?.locked ?? false,
				},
			};
		},
	);
}

/** 模型输出的一条建议草稿；导入存储前已经去掉了被锁定的修改。 */
export function assertBlueprintSuggestionDraft(
	value: unknown,
	entries: readonly BlueprintEntry[],
	label: string,
): NewBlueprintSuggestionInput | null {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, ["title", "reason", "diffs"], label);
	const title = readSuggestionText(
		record.title,
		`${label}.title`,
		MAX_BLUEPRINT_SUGGESTION_TITLE_CHARS,
	);
	const reason = readSuggestionText(
		record.reason,
		`${label}.reason`,
		MAX_BLUEPRINT_SUGGESTION_REASON_CHARS,
	);
	const parsed = assertBlueprintDiffs(record.diffs, `${label}.diffs`);
	if (parsed.length === 0) {
		throw new Error(`${label}.diffs 至少要有一条`);
	}
	const diffs = normalizeSuggestionDiffs(entries, parsed, label);
	if (diffs.length === 0) return null;
	applyBlueprintDiffs(entries, diffs, label);
	return { title, reason, diffs };
}

/** 校验已经归一化的建议；存储层不接受未标为 AI 或带锁的条目。 */
export function assertStoredBlueprintSuggestion(
	value: unknown,
	label: string,
): NewBlueprintSuggestionInput {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, ["title", "reason", "diffs"], label);
	const title = readSuggestionText(
		record.title,
		`${label}.title`,
		MAX_BLUEPRINT_SUGGESTION_TITLE_CHARS,
	);
	const reason = readSuggestionText(
		record.reason,
		`${label}.reason`,
		MAX_BLUEPRINT_SUGGESTION_REASON_CHARS,
	);
	const diffs = assertBlueprintDiffs(record.diffs, `${label}.diffs`);
	if (diffs.length === 0) {
		throw new Error(`${label}.diffs 至少要有一条`);
	}
	for (const diff of diffs) {
		if (diff.action !== "set") continue;
		if (diff.entry.source !== "ai") {
			throw new Error(`${label} 的条目出处必须是 AI：${diff.entry.id}`);
		}
		if (diff.entry.locked) {
			throw new Error(`${label} 不能自己锁定条目：${diff.entry.id}`);
		}
	}
	return { title, reason, diffs };
}

const RESPONSE_KEYS = ["suggestions"] as const;

const SYSTEM_PROMPT = [
	"你是故事蓝图顾问。玩家维护总纲、卷与里程碑三层蓝图；你只提出建议，不直接改蓝图。",
	"只输出一个 JSON 对象，不要解释、前后缀或代码块标记。",
	'{"suggestions":[{"title":"…","reason":"…","diffs":[{"action":"set","entry":{…}}]}]}',
	"- suggestions 是 1 到 5 条建议；title 不超过 80 字，reason 不超过 500 字。",
	"- diffs 是这一条建议对当前蓝图的一组修改：set 必须带完整条目，delete 只带 id。",
	"- premise 条目字段：id、kind、source、locked、coreQuestion、tone、endings、redLines。",
	"- volume 条目字段：id、kind、source、locked、title、coreQuestion、startState、endState。",
	"- milestone 条目字段：id、kind、source、locked、volumeId、want、prerequisites、after、hardness。",
	"- source 固定写 ai，locked 固定写 false；不要修改当前蓝图里 locked 为 true 的条目。",
	"- hardness 只能是 hard 或 soft；after 引用其他里程碑的 id，不能成环。",
	"- 文本可以为空，但列表项不能是空串；单个文本不超过 500 字，每个列表最多 12 条。",
	"- 只写局面与人物意图，不要写写作指令。",
].join("\n");

export interface BlueprintSuggestionInput {
	readonly request: BlueprintSuggestionRequest;
	/** 接受建议时写入的楼层；故事还没有楼层时为空。 */
	readonly nodeId: string | null;
	readonly entries: readonly BlueprintEntry[];
	readonly floors: readonly TimelineNode[];
}

/** 有待处理的请求时才补建后台任务。 */
export function blueprintSuggestionNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	return store.findPendingBlueprintSuggestionRequest(storyId) !== null;
}

/** 当前蓝图的写入楼层是 head；最近剧情取 head 路径上的最后十二个楼层。 */
export function collectBlueprintSuggestionInput(
	store: StoryStore,
	storyId: string,
	request: BlueprintSuggestionRequest,
): BlueprintSuggestionInput {
	const head = store.getHead(storyId);
	if (head === null) {
		return { request, nodeId: null, entries: [], floors: [] };
	}
	const path = store.getPathToNode(head.id);
	return {
		request,
		nodeId: head.id,
		entries: store.readBlueprintEntries(head.id),
		floors: path.slice(-BLUEPRINT_SUGGESTION_WINDOW_FLOORS),
	};
}

/** 把当前蓝图、操作与最近剧情拼成建议请求的用户消息。 */
export function buildBlueprintSuggestionUserContent(
	input: BlueprintSuggestionInput,
): string {
	const operation =
		BLUEPRINT_SUGGESTION_OPERATION_LABELS[input.request.operation];
	const lines: string[] = [
		`操作：${operation}`,
		`操作要求：${OPERATION_INSTRUCTIONS[input.request.operation]}`,
		`玩家补充：${input.request.note.length === 0 ? "（没有）" : input.request.note}`,
		"",
		"当前蓝图：",
		input.entries.length === 0
			? "（空）"
			: JSON.stringify(input.entries, null, 2),
		"",
		`最近剧情（最后 ${input.floors.length} 个楼层）：`,
	];
	if (input.floors.length === 0) {
		lines.push("（还没有楼层）");
	} else {
		for (const node of input.floors) {
			lines.push(
				`<楼层 id=${JSON.stringify(node.id)} 角色=${node.role}>`,
				node.raw,
				"</楼层>",
			);
		}
	}
	return lines.join("\n");
}

/** 模型输出的唯一校验入口；被锁定的修改被跳过，整条没有修改时丢弃。 */
export function parseBlueprintSuggestionResponse(
	text: string,
	entries: readonly BlueprintEntry[],
	label = "蓝图建议",
): NewBlueprintSuggestionInput[] {
	const record = assertPlainObject(parseJsonOutputObject(text, label), label);
	rejectUnknownKeys(record, RESPONSE_KEYS, label);
	const raw = record.suggestions;
	if (!Array.isArray(raw)) {
		throw new Error(`${label}.suggestions 必须是数组`);
	}
	if (raw.length === 0 || raw.length > MAX_BLUEPRINT_SUGGESTIONS) {
		throw new Error(
			`${label}.suggestions 必须是 1 到 ${MAX_BLUEPRINT_SUGGESTIONS} 条`,
		);
	}
	const suggestions: NewBlueprintSuggestionInput[] = [];
	raw.forEach((item, index) => {
		const draft = assertBlueprintSuggestionDraft(
			item,
			entries,
			`${label}.suggestions[${index}]`,
		);
		if (draft !== null) suggestions.push(draft);
	});
	if (suggestions.length === 0) {
		throw new Error(`${label} 的修改都命中了锁定条目`);
	}
	return suggestions;
}

export interface BlueprintSuggestionHandlerOptions {
	/** 覆盖任务上下文里的后台客户端；生产用 `planner` 角色的客户端。 */
	readonly client?: LlmClient;
}

/** 建议请求的后台处理器：一次调用生成一批建议，不写蓝图。 */
export function createBlueprintSuggestionHandler(
	options: BlueprintSuggestionHandlerOptions = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const request = store.findPendingBlueprintSuggestionRequest(job.storyId);
		if (request === null) return;
		const input = collectBlueprintSuggestionInput(store, job.storyId, request);
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildBlueprintSuggestionUserContent(input) },
		];
		const result = await (options.client ?? client).complete(
			{
				messages,
				temperature: 0,
				signal,
			},
			NO_CONTINUATION,
		);
		const suggestions = parseBlueprintSuggestionResponse(
			result.text,
			input.entries,
		);
		store.saveBlueprintSuggestions({
			requestId: request.id,
			suggestions,
		});
	};
}

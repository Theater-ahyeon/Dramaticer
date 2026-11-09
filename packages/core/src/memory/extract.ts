import type {
	BackgroundJob,
	BackgroundJobHandler,
} from "../background/types.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import { EVENT_WINDOW_FLOORS, type NewMemoryEventInput } from "./event.js";
import { parseJsonOutputArray } from "./json-output.js";

export interface ExtractedEvent {
	readonly text: string;
	readonly participants: readonly string[];
	readonly knowers: readonly string[];
	readonly importance: number;
	readonly storyTime: string | null;
	readonly location: string | null;
}

/** 一次请求里某个助手楼层的抽取结果；没有事件时 `events` 为空数组。 */
export interface BatchExtractedEvents {
	readonly nodeId: string;
	readonly events: readonly ExtractedEvent[];
}

export interface EventExtractionOptions {
	/** 一次请求最多处理的助手楼层数；默认为 8。 */
	readonly windowFloors?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

const EVENT_FIELDS: Readonly<Record<string, true>> = {
	text: true,
	participants: true,
	knowers: true,
	importance: true,
	storyTime: true,
	location: true,
};

const BATCH_FIELDS: Readonly<Record<string, true>> = {
	nodeId: true,
	events: true,
};

const SYSTEM_PROMPT = [
	"你是故事记忆抽取器。阅读给定的楼层，只从窗口内的助手楼层抽取之后仍可能被提起的事实性事件。",
	"只输出一个 JSON 数组，不要输出解释、前后缀或代码块标记。",
	"数组的每一项对应一个窗口内的助手楼层，格式：",
	'{"nodeId":"窗口内助手楼层的 id","events":[{"text":"事件的一句话描述","participants":["参与者"],"knowers":["知情者"],"importance":0.5,"storyTime":"故事内时间","location":"地点"}]}',
	"- nodeId 必须原样使用窗口里 role 为 assistant 的楼层 id；每个楼层最多出现一次。",
	"- 上下文楼层只用来理解前后经过，不要为它们输出记录。",
	"- text：非空字符串。",
	'- participants 与 knowers：字符串数组，元素都不能为空。knowers 为空数组表示公开事件；不确定谁知道时用 ["*"]。',
	"- importance：0 到 1 之间的数字，越重要越接近 1。",
	"- storyTime 与 location：可选；不确定就省略。",
	"没有值得记住的事件时省略该楼层；一个事件都没有时输出 []。不要把楼层里没有出现的信息编进事件。",
].join("\n");

export function parseEventExtraction(text: string): ExtractedEvent[] {
	const parsed = parseJsonOutputArray(text, "事件抽取结果");
	return parsed.map((item, index) => parseEvent(item, `事件[${index}]`));
}

/**
 * 解析批量抽取结果。`nodeId` 必须是本次窗口里的助手楼层，
 * 出现窗口外楼层或重复楼层时整批拒绝。
 */
export function parseEventBatchExtraction(
	text: string,
	windowNodeIds: readonly string[],
): BatchExtractedEvents[] {
	const allowed = new Set(windowNodeIds);
	const seen = new Set<string>();
	const parsed = parseJsonOutputArray(text, "事件抽取结果");
	return parsed.map((item, index) => {
		const label = `抽取结果[${index}]`;
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			throw new Error(`${label} 必须是对象`);
		}
		const record = item as Record<string, unknown>;
		for (const key of Object.keys(record)) {
			if (BATCH_FIELDS[key] !== true) {
				throw new Error(`${label} 包含未知字段 ${key}`);
			}
		}
		const nodeId = requireNonEmptyString(record.nodeId, `${label}.nodeId`);
		if (!allowed.has(nodeId)) {
			throw new Error(`${label}.nodeId 不在本次窗口内：${nodeId}`);
		}
		if (seen.has(nodeId)) {
			throw new Error(`${label}.nodeId 重复：${nodeId}`);
		}
		seen.add(nodeId);
		if (!Array.isArray(record.events)) {
			throw new Error(`${label}.events 必须是数组`);
		}
		return {
			nodeId,
			events: record.events.map((event, eventIndex) =>
				parseEvent(event, `楼层 ${nodeId} 的事件[${eventIndex}]`),
			),
		};
	});
}

function parseEvent(value: unknown, label: string): ExtractedEvent {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (EVENT_FIELDS[key] !== true) {
			throw new Error(`${label} 包含未知字段 ${key}`);
		}
	}
	return {
		text: requireNonEmptyString(record.text, `${label}.text`),
		participants: requireStringArray(
			record.participants,
			`${label}.participants`,
		),
		knowers: requireStringArray(record.knowers, `${label}.knowers`),
		importance: requireImportance(record.importance, `${label}.importance`),
		storyTime: optionalString(record.storyTime, `${label}.storyTime`),
		location: optionalString(record.location, `${label}.location`),
	};
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${label} 不能是空字符串`);
	}
	return trimmed;
}

function requireStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是字符串数组`);
	}
	return value.map((item, index) => {
		if (typeof item !== "string") {
			throw new Error(`${label}[${index}] 必须是字符串`);
		}
		const trimmed = item.trim();
		if (trimmed.length === 0) {
			throw new Error(`${label}[${index}] 不能是空字符串`);
		}
		return trimmed;
	});
}

function requireImportance(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${label} 必须是数字`);
	}
	if (value < 0 || value > 1) {
		throw new Error(`${label} 必须在 0 到 1 之间`);
	}
	return value;
}

function optionalString(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	return requireNonEmptyString(value, label);
}

/** 生成事件抽取的后台任务处理器。 */
export function createEventExtractionHandler(
	options: EventExtractionOptions = {},
): BackgroundJobHandler {
	const baseWindowFloors = options.windowFloors ?? EVENT_WINDOW_FLOORS;
	if (!Number.isInteger(baseWindowFloors) || baseWindowFloors < 1) {
		throw new Error("事件抽取窗口必须是不小于 1 的整数");
	}
	return async ({ store, client, job, signal }) => {
		let windowFloors = baseWindowFloors;
		for (;;) {
			const window = selectEventWindow(store, job.storyId, windowFloors);
			if (window === null) return;
			const messages: LlmMessage[] = [
				{ role: "system", content: SYSTEM_PROMPT },
				{
					role: "user",
					content: formatEventWindow(window, retryHint(job, window)),
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
			let batches: BatchExtractedEvents[];
			try {
				batches = parseEventBatchExtraction(
					result.text,
					window.floors.map((node) => node.id),
				);
			} catch (error) {
				// 输出被截断时 JSON 通常缺尾巴；把窗口对半缩小后重新请求，
				// 单个楼层仍然截断才按失败交给任务框架。
				if (result.truncation !== null && window.floors.length > 1) {
					windowFloors = Math.max(1, Math.floor(window.floors.length / 2));
					continue;
				}
				if (result.truncation !== null) {
					throw new Error(
						`事件抽取输出被截断（${result.truncation}），单个楼层仍无法完整输出`,
						{ cause: error },
					);
				}
				throw error;
			}
			recordExtractedEvents(store, job.storyId, window, batches);
			return;
		}
	};
}

/**
 * 把一批已解析的事件写进只追加的事件表，并给窗口内每个楼层写抽取记录；
 * 没有事件的楼层也记一笔，重跑不再调用模型。
 */
export function recordExtractedEvents(
	store: StoryStore,
	storyId: string,
	window: EventWindow,
	batches: readonly BatchExtractedEvents[],
): void {
	const events: NewMemoryEventInput[] = [];
	for (const batch of batches) {
		batch.events.forEach((event, ordinal) => {
			events.push({
				storyId,
				sourceNodeId: batch.nodeId,
				ordinal,
				storyTime: event.storyTime,
				location: event.location,
				participants: event.participants,
				importance: event.importance,
				knowers: event.knowers,
				text: event.text,
			});
		});
	}
	store.recordEventExtractions({
		storyId,
		nodeIds: window.floors.map((node) => node.id),
		events,
	});
}

export interface EventWindow {
	/** 需要抽取的助手楼层，按路径顺序排列。 */
	readonly floors: readonly TimelineNode[];
	/** 窗口内的全部楼层，含助手楼层之间的玩家楼层。 */
	readonly span: readonly TimelineNode[];
	readonly before: TimelineNode | null;
	readonly after: TimelineNode | null;
}

/**
 * 从当前路径上取最早的一段连续未抽取助手楼层，一次最多 `windowFloors` 个。
 * 已抽取的助手楼层会切断窗口，避免反复处理同一段。
 */
export function selectEventWindow(
	store: StoryStore,
	storyId: string,
	windowFloors: number,
): EventWindow | null {
	const path = store.getPathToHead(storyId);
	if (path.length === 0) return null;
	const extracted = new Set(store.listExtractedEventNodeIds(storyId));
	const indices: number[] = [];
	for (let index = 0; index < path.length; index += 1) {
		const node = path[index];
		if (node === undefined || node.role !== "assistant") continue;
		const confirmed = index < path.length - 1 || store.isNodeConfirmed(node.id);
		if (confirmed && !extracted.has(node.id)) {
			indices.push(index);
			continue;
		}
		if (indices.length > 0) break;
	}
	const chosen = indices.slice(0, windowFloors);
	const floors: TimelineNode[] = [];
	for (const index of chosen) {
		const node = path[index];
		if (node === undefined) {
			throw new Error("事件抽取窗口引用了路径之外的楼层");
		}
		floors.push(node);
	}
	const first = chosen[0];
	const last = chosen[chosen.length - 1];
	if (first === undefined || last === undefined) return null;
	return {
		floors,
		span: path.slice(first, last + 1),
		before: first > 0 ? (path[first - 1] ?? null) : null,
		after: last + 1 < path.length ? (path[last + 1] ?? null) : null,
	};
}

/**
 * 上一次输出没有通过校验时，在重试请求末尾附上具体错误与允许的 nodeId。
 * 这次请求的内容因此与上一次不同，响应缓存不会把同一条坏结果再送回模型重试。
 */
function retryHint(job: BackgroundJob, window: EventWindow): string | null {
	if (job.attempts <= 1 || job.lastError === null) return null;
	const lines = [
		`这是第 ${job.attempts} 次请求。上一次输出没有通过校验：${job.lastError}`,
		"请只使用下面列出的 nodeId，逐字复制，不要改动后缀：",
		...window.floors.map((node) => `- ${node.id}`),
	];
	return lines.join("\n");
}

export function formatEventWindow(
	window: EventWindow,
	hint: string | null = null,
): string {
	const writable = new Set(window.floors.map((node) => node.id));
	const lines = [
		"以下是按时间顺序排列的楼层。只从 <窗口> 内带 id 的助手楼层抽取事件；其余楼层只用来理解前后经过，不要为它们输出记录。",
	];
	if (window.before !== null) {
		lines.push(
			'<上下文 位置="前">',
			formatFloor(window.before, false),
			"</上下文>",
		);
	}
	lines.push("<窗口>");
	for (const node of window.span) {
		lines.push(formatFloor(node, writable.has(node.id)));
	}
	lines.push("</窗口>");
	if (window.after !== null) {
		lines.push(
			'<上下文 位置="后">',
			formatFloor(window.after, false),
			"</上下文>",
		);
	}
	if (hint !== null) lines.push(hint);
	return lines.join("\n");
}

function formatFloor(node: TimelineNode, withId: boolean): string {
	const attributes = withId
		? ` id="${node.id}" role="${node.role}"`
		: ` role="${node.role}"`;
	return `<楼层${attributes}>\n${node.raw}\n</楼层>`;
}

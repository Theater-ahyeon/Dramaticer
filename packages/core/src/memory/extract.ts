import type { BackgroundJobHandler } from "../background/types.js";
import type { LlmMessage } from "../llm/types.js";
import { DEFAULT_MEMORY_EVENT_SOURCE, EVENT_WINDOW_FLOORS } from "./event.js";
import { parseJsonOutputArray } from "./json-output.js";
import { formatFloors } from "./window.js";

export interface ExtractedEvent {
	readonly text: string;
	readonly participants: readonly string[];
	readonly knowers: readonly string[];
	readonly importance: number;
	readonly storyTime: string | null;
	readonly location: string | null;
}

export interface EventExtractionOptions {
	/** 沿路径往前带上的楼层数；默认为 8。 */
	readonly windowSize?: number;
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

const SYSTEM_PROMPT = [
	"你是故事记忆抽取器。阅读给定的楼层，抽取之后仍可能被提起的事实性事件。",
	"只输出一个 JSON 数组，不要输出解释、前后缀或代码块标记。",
	"数组的每一项包含这些字段：",
	'{"text":"事件的一句话描述","participants":["参与者"],"knowers":["知情者"],"importance":0.5,"storyTime":"故事内时间","location":"地点"}',
	"- text：非空字符串。",
	'- participants 与 knowers：字符串数组，元素都不能为空。knowers 为空数组表示公开事件；不确定谁知道时用 ["*"]。',
	"- importance：0 到 1 之间的数字，越重要越接近 1。",
	"- storyTime 与 location：可选；不确定就省略。",
	"没有值得记住的事件时输出 []。不要把楼层里没有出现的信息编进事件。",
].join("\n");

export function parseEventExtraction(text: string): ExtractedEvent[] {
	const parsed = parseJsonOutputArray(text, "事件抽取结果");
	return parsed.map((item, index) => parseEvent(item, index));
}

function parseEvent(value: unknown, index: number): ExtractedEvent {
	const label = `事件[${index}]`;
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
	const windowSize = options.windowSize ?? EVENT_WINDOW_FLOORS;
	if (!Number.isInteger(windowSize) || windowSize < 0) {
		throw new Error("事件抽取窗口必须是不小于 0 的整数");
	}
	return async ({ store, client, job }) => {
		if (store.countEventsForNode(job.nodeId, DEFAULT_MEMORY_EVENT_SOURCE) > 0) {
			return;
		}
		const path = store.getPathToNode(job.nodeId);
		const window = path.slice(-(windowSize + 1));
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: formatFloors(window) },
		];
		const result = await client.complete({
			messages,
			model: options.model,
			temperature: 0,
		});
		const events = parseEventExtraction(result.text);
		if (events.length === 0) return;
		store.insertMemoryEvents(
			events.map((event, ordinal) => ({
				storyId: job.storyId,
				sourceNodeId: job.nodeId,
				ordinal,
				storyTime: event.storyTime,
				location: event.location,
				participants: event.participants,
				importance: event.importance,
				knowers: event.knowers,
				text: event.text,
			})),
		);
	};
}

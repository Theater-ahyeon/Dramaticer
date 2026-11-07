import {
	type LlmClient,
	type LlmReasoningLevel,
	type LlmRequest,
	type LlmResult,
	isJsonObject,
} from "@dramaticer/core";
import type { StChatEntry, StChatMessage } from "../chat-jsonl.js";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import { messageNodeId, parseMessageIndex } from "../node-id.js";
import { requireNonEmpty } from "./shared.js";

export interface EventQuestion {
	readonly id: string;
	readonly story: string;
	readonly askAtNode: string;
	readonly question: string;
	readonly answer: string;
	readonly evidenceNodes: readonly string[];
	readonly kind: "event";
}

export interface EventQuestionOptions {
	readonly storyId: string;
	/** 楼层 id 前缀，默认等于 storyId。 */
	readonly idPrefix?: string;
	readonly minQuestions?: number;
	readonly maxQuestions?: number;
	/** 每个窗口向模型要多少道题，默认 5。 */
	readonly questionsPerWindow?: number;
	/** 最多使用多少个窗口，默认 24；窗口会沿故事均匀取样。 */
	readonly maxWindows?: number;
	readonly maxWindowChars?: number;
	readonly maxFloorChars?: number;
	readonly overlapFloors?: number;
	readonly minWindowFloors?: number;
	/** 证据楼层与提问楼层的最小间隔，默认 2。 */
	readonly minEvidenceGap?: number;
	readonly maxQuestionLength?: number;
	readonly maxAnswerLength?: number;
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly model?: string;
	readonly reasoning?: LlmReasoningLevel;
}

export interface EventQuestionFailure {
	readonly askAtNode: string;
	readonly reason: string;
}

export interface EventQuestionStats {
	readonly story: string;
	readonly availableWindowCount: number;
	readonly windowCount: number;
	readonly requestCount: number;
	readonly cachedRequests: number;
	readonly failedWindows: number;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly reasoningTokens: number;
	readonly candidateCount: number;
}

export interface EventQuestionBuildResult {
	readonly questions: readonly EventQuestion[];
	readonly stats: EventQuestionStats;
	readonly failures: readonly EventQuestionFailure[];
}

export interface EventQuestionVerification {
	readonly checked: number;
	readonly failures: readonly EventQuestionFailure[];
}

interface ChatFloor {
	readonly messageIndex: number;
	readonly nodeId: string;
	readonly name: string;
	readonly text: string;
	readonly position: number;
}

interface Window {
	readonly start: number;
	/** 不含。 */
	readonly end: number;
}

interface ResolvedOptions {
	readonly storyId: string;
	readonly idPrefix: string;
	readonly minQuestions: number;
	readonly maxQuestions: number;
	readonly questionsPerWindow: number;
	readonly maxWindows: number;
	readonly maxWindowChars: number;
	readonly maxFloorChars: number;
	readonly overlapFloors: number;
	readonly minWindowFloors: number;
	readonly minEvidenceGap: number;
	readonly maxQuestionLength: number;
	readonly maxAnswerLength: number;
	readonly temperature: number;
	readonly maxTokens: number;
	readonly model: string | undefined;
	readonly reasoning: LlmReasoningLevel | undefined;
}

interface Candidate {
	readonly askFloor: ChatFloor;
	readonly evidenceFloors: readonly ChatFloor[];
	readonly question: string;
	readonly answer: string;
}

interface ModelQuestion {
	readonly question: string;
	readonly answer: string;
	readonly evidenceNodes: readonly string[];
}

interface ChatIndex {
	readonly messageCount: number;
	readonly floors: readonly ChatFloor[];
	readonly byNodeId: ReadonlyMap<string, ChatFloor>;
	readonly allNodeIndexes: ReadonlyMap<string, number>;
}

const SYSTEM_PROMPT = [
	"你是长对话记忆评测的出题器。用户会给出一段带楼层 id 的故事对话。",
	"请针对窗口里已经发生的事件出题，所有问题都在窗口最后一楼被提问。",
	"规则：",
	"1. 问题必须能由窗口内的原文回答，答案是一句简短中文，写清人物和结果，不超过 60 个汉字。",
	"2. evidenceNodes 填支撑答案的楼层 id，至少一个，按时间顺序排列，并且比提问楼层至少早若干楼（见用户消息）。",
	"3. 每道题问不同的事件，要具体到人物、动作和后果，不要问“发生了什么”这种笼统问题。",
	"4. 不要依赖窗口之外的设定，不要问窗口最后一楼之后才发生的事。",
	"只输出 JSON 数组，不要代码块，不要解释。每个元素的格式：",
	'{"question":"问题","answer":"答案","evidenceNodes":["楼层id"]}',
].join("\n");

export interface EventQuestionPlan {
	readonly story: string;
	readonly floorCount: number;
	readonly availableWindowCount: number;
	readonly windowCount: number;
	/** 每个窗口一次请求，未考虑缓存命中。 */
	readonly requestCount: number;
}

/**
 * 只计算事件题生成需要多少个窗口与请求，不调用模型。
 * 用于把新增语料的出题成本写进报告。
 */
export async function planEventQuestions(
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
	options: EventQuestionOptions,
): Promise<EventQuestionPlan> {
	const resolved = resolveOptions(options);
	const chat = await collectChat(entries, resolved);
	const allWindows = buildWindows(chat.floors, resolved);
	const windows = sampleEvenly(allWindows, resolved.maxWindows);
	return {
		story: resolved.storyId,
		floorCount: chat.floors.length,
		availableWindowCount: allWindows.length,
		windowCount: windows.length,
		requestCount: windows.length,
	};
}

export async function planEventQuestionsFromFile(
	filePath: string,
	options: EventQuestionOptions,
): Promise<EventQuestionPlan> {
	return planEventQuestions(parseChatJsonlFile(filePath), options);
}

/**
 * 让后台模型按窗口阅读聊天，生成事件类记忆题。
 *
 * 每个窗口的最后一楼是提问楼层，模型只能引用窗口内更早的楼层作为证据；
 * 生成结果会逐条校验并去重，再按窗口轮转选取，避免所有题目集中在故事开头。
 */
export async function buildEventQuestions(
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
	client: LlmClient,
	options: EventQuestionOptions,
): Promise<EventQuestionBuildResult> {
	const resolved = resolveOptions(options);
	const chat = await collectChat(entries, resolved);
	if (chat.floors.length === 0) {
		throw new Error(`故事 ${resolved.storyId} 没有可用于出题的楼层`);
	}
	const allWindows = buildWindows(chat.floors, resolved);
	if (allWindows.length === 0) {
		throw new Error(`故事 ${resolved.storyId} 构造不出窗口`);
	}
	const windows = sampleEvenly(allWindows, resolved.maxWindows);

	const candidatesByWindow: Candidate[][] = windows.map(() => []);
	const failures: EventQuestionFailure[] = [];
	const seen = new Set<string>();
	let requestCount = 0;
	let cachedRequests = 0;
	let failedWindows = 0;
	let promptTokens = 0;
	let completionTokens = 0;
	let reasoningTokens = 0;

	for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
		const window = windows[windowIndex];
		if (!window) continue;
		const askFloor = chat.floors[window.end - 1];
		if (!askFloor) continue;
		const request = buildRequest(chat, window, resolved);
		let result: LlmResult;
		try {
			result = await client.complete(request);
		} catch (error) {
			failedWindows += 1;
			failures.push({
				askAtNode: askFloor.nodeId,
				reason: `请求失败：${error instanceof Error ? error.message : String(error)}`,
			});
			continue;
		}
		requestCount += 1;
		if (result.cached) cachedRequests += 1;
		promptTokens += result.usage.promptTokens ?? 0;
		completionTokens += result.usage.completionTokens ?? 0;
		reasoningTokens += result.usage.reasoningTokens ?? 0;

		let parsed: ParsedModelQuestions;
		try {
			parsed = parseModelQuestions(result.text);
		} catch (error) {
			failedWindows += 1;
			failures.push({
				askAtNode: askFloor.nodeId,
				reason: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		for (const rejection of parsed.rejected) {
			failures.push({ askAtNode: askFloor.nodeId, reason: rejection });
		}
		if (parsed.items.length === 0 && parsed.rejected.length === 0) {
			failures.push({
				askAtNode: askFloor.nodeId,
				reason: "模型输出里没有题目",
			});
		}

		const accepted: Candidate[] = [];
		for (const item of parsed.items) {
			const candidate = validateCandidate(
				item,
				window,
				chat,
				resolved,
				askFloor,
			);
			if (!candidate) {
				failures.push({
					askAtNode: askFloor.nodeId,
					reason: "模型给出的题目没有通过结构校验",
				});
				continue;
			}
			const key = normalizeQuestion(candidate.question);
			if (seen.has(key)) {
				failures.push({
					askAtNode: askFloor.nodeId,
					reason: "题目与已生成的题目重复",
				});
				continue;
			}
			seen.add(key);
			accepted.push(candidate);
		}
		if (accepted.length === 0) failedWindows += 1;
		candidatesByWindow[windowIndex] = accepted;
	}

	const selected = selectCandidates(candidatesByWindow, resolved.maxQuestions);
	if (selected.length < resolved.minQuestions) {
		const detail = failures
			.slice(0, 3)
			.map((failure) => `${failure.askAtNode}：${failure.reason}`)
			.join("；");
		throw new Error(
			`故事 ${resolved.storyId} 只生成了 ${selected.length} 道有效事件题，低于下限 ${resolved.minQuestions}；失败 ${failures.length} 条${detail ? `：${detail}` : ""}`,
		);
	}
	selected.sort((left, right) => {
		if (left.askFloor.messageIndex !== right.askFloor.messageIndex) {
			return left.askFloor.messageIndex - right.askFloor.messageIndex;
		}
		return left.question.localeCompare(right.question);
	});

	const perAsk = new Map<string, number>();
	const questions: EventQuestion[] = selected.map((candidate) => {
		const sequence = (perAsk.get(candidate.askFloor.nodeId) ?? 0) + 1;
		perAsk.set(candidate.askFloor.nodeId, sequence);
		return {
			id: `event:${resolved.storyId}:${candidate.askFloor.messageIndex + 1}:${sequence}`,
			story: resolved.storyId,
			askAtNode: candidate.askFloor.nodeId,
			question: candidate.question,
			answer: candidate.answer,
			evidenceNodes: candidate.evidenceFloors.map((floor) => floor.nodeId),
			kind: "event",
		};
	});
	const candidateCount = candidatesByWindow.reduce(
		(total, list) => total + list.length,
		0,
	);
	return {
		questions,
		stats: {
			story: resolved.storyId,
			availableWindowCount: allWindows.length,
			windowCount: windows.length,
			requestCount,
			cachedRequests,
			failedWindows,
			promptTokens,
			completionTokens,
			reasoningTokens,
			candidateCount,
		},
		failures,
	};
}

export async function buildEventQuestionsFromFile(
	filePath: string,
	client: LlmClient,
	options: EventQuestionOptions,
): Promise<EventQuestionBuildResult> {
	return buildEventQuestions(parseChatJsonlFile(filePath), client, options);
}

/**
 * 重新解析聊天，核对题目引用的提问楼层和证据楼层确实存在，且证据在提问之前。
 * 答案内容无法用规则判定，交给 HUMAN-03 的抽查。
 */
export async function verifyEventQuestions(
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
	questions: readonly EventQuestion[],
	options: Pick<
		EventQuestionOptions,
		"storyId" | "idPrefix" | "minEvidenceGap"
	>,
): Promise<EventQuestionVerification> {
	const storyId = requireNonEmpty(options.storyId, "故事 id");
	const idPrefix = options.idPrefix ?? storyId;
	const minEvidenceGap = options.minEvidenceGap ?? 2;
	const chat = await collectChat(entries, {
		...resolveOptions({ storyId, idPrefix, minEvidenceGap }),
	});
	const failures: EventQuestionFailure[] = [];
	for (const question of questions) {
		const failure = verifyQuestion(
			question,
			chat,
			storyId,
			idPrefix,
			minEvidenceGap,
		);
		if (failure) failures.push(failure);
	}
	return { checked: questions.length, failures };
}

export async function verifyEventQuestionsFromFile(
	filePath: string,
	questions: readonly EventQuestion[],
	options: Pick<
		EventQuestionOptions,
		"storyId" | "idPrefix" | "minEvidenceGap"
	>,
): Promise<EventQuestionVerification> {
	return verifyEventQuestions(parseChatJsonlFile(filePath), questions, options);
}

function resolveOptions(options: EventQuestionOptions): ResolvedOptions {
	const storyId = requireNonEmpty(options.storyId, "故事 id");
	const minQuestions = options.minQuestions ?? 50;
	const maxQuestions = options.maxQuestions ?? 50;
	const questionsPerWindow = options.questionsPerWindow ?? 5;
	const maxWindows = options.maxWindows ?? 24;
	const maxWindowChars = options.maxWindowChars ?? 24_000;
	const maxFloorChars = options.maxFloorChars ?? 3_000;
	const overlapFloors = options.overlapFloors ?? 3;
	const minWindowFloors = options.minWindowFloors ?? 4;
	const minEvidenceGap = options.minEvidenceGap ?? 2;
	const maxQuestionLength = options.maxQuestionLength ?? 200;
	const maxAnswerLength = options.maxAnswerLength ?? 200;
	const temperature = options.temperature ?? 0.7;
	const maxTokens = options.maxTokens ?? 4_096;
	for (const [label, value, minimum] of [
		["minQuestions", minQuestions, 1],
		["maxQuestions", maxQuestions, minQuestions],
		["questionsPerWindow", questionsPerWindow, 1],
		["maxWindows", maxWindows, 1],
		["maxWindowChars", maxWindowChars, 100],
		["maxFloorChars", maxFloorChars, 100],
		["overlapFloors", overlapFloors, 0],
		["minWindowFloors", minWindowFloors, 2],
		["minEvidenceGap", minEvidenceGap, 1],
		["maxQuestionLength", maxQuestionLength, 10],
		["maxAnswerLength", maxAnswerLength, 10],
		["maxTokens", maxTokens, 64],
	] as const) {
		if (!Number.isInteger(value) || value < minimum) {
			throw new Error(`${label} 必须是大于等于 ${minimum} 的整数`);
		}
	}
	if (!(temperature >= 0 && temperature <= 2)) {
		throw new Error("temperature 必须在 0 到 2 之间");
	}
	return {
		storyId,
		idPrefix: options.idPrefix ?? storyId,
		minQuestions,
		maxQuestions,
		questionsPerWindow,
		maxWindows,
		maxWindowChars,
		maxFloorChars,
		overlapFloors,
		minWindowFloors,
		minEvidenceGap,
		maxQuestionLength,
		maxAnswerLength,
		temperature,
		maxTokens,
		model: options.model,
		reasoning: options.reasoning,
	};
}

async function collectChat(
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
	options: Pick<ResolvedOptions, "idPrefix" | "maxFloorChars">,
): Promise<ChatIndex> {
	const floors: ChatFloor[] = [];
	const byNodeId = new Map<string, ChatFloor>();
	const allNodeIndexes = new Map<string, number>();
	let messageCount = 0;
	for await (const entry of entries) {
		if (entry.kind === "header") continue;
		const message = entry.message;
		messageCount += 1;
		const nodeId = messageNodeId(options.idPrefix, message);
		allNodeIndexes.set(nodeId, message.index);
		if (message.isSystem) continue;
		const text = message.text.trim();
		if (text.length === 0) continue;
		const floor: ChatFloor = {
			messageIndex: message.index,
			nodeId,
			name: floorName(message),
			text,
			position: floors.length,
		};
		floors.push(floor);
		byNodeId.set(nodeId, floor);
	}
	return { messageCount, floors, byNodeId, allNodeIndexes };
}

function floorName(message: StChatMessage): string {
	const name = message.name.trim();
	if (name.length > 0) return name;
	return message.isUser ? "用户" : "角色";
}

function buildWindows(
	floors: readonly ChatFloor[],
	options: Pick<
		ResolvedOptions,
		"maxWindowChars" | "maxFloorChars" | "overlapFloors" | "minWindowFloors"
	>,
): Window[] {
	const windows: Window[] = [];
	let start = 0;
	while (start < floors.length) {
		let end = start;
		let chars = 0;
		while (end < floors.length) {
			const floor = floors[end];
			if (!floor) break;
			const cost = Math.min(floor.text.length, options.maxFloorChars) + 32;
			if (end > start && chars + cost > options.maxWindowChars) break;
			chars += cost;
			end += 1;
		}
		if (end - start >= options.minWindowFloors) {
			windows.push({ start, end });
		}
		if (end >= floors.length) break;
		const stride = Math.max(1, end - start - options.overlapFloors);
		start += stride;
	}
	return windows;
}

function sampleEvenly(windows: readonly Window[], limit: number): Window[] {
	if (windows.length <= limit) return [...windows];
	if (limit === 1) return [windows[0] as Window];
	const selected: Window[] = [];
	for (let index = 0; index < limit; index += 1) {
		const position = Math.round((index * (windows.length - 1)) / (limit - 1));
		const window = windows[position];
		if (window && selected.at(-1) !== window) selected.push(window);
	}
	return selected;
}

function buildRequest(
	chat: ChatIndex,
	window: Window,
	options: ResolvedOptions,
): LlmRequest {
	const askFloor = chat.floors[window.end - 1];
	if (!askFloor) {
		throw new Error(`窗口 ${window.start}-${window.end} 缺少提问楼层`);
	}
	const lines: string[] = [
		`故事：${options.storyId}`,
		`窗口最后一楼（所有问题的提问楼层）：${askFloor.nodeId}`,
		`证据楼层必须比提问楼层至少早 ${options.minEvidenceGap} 楼。`,
		"对话：",
	];
	for (let index = window.start; index < window.end; index += 1) {
		const floor = chat.floors[index];
		if (!floor) continue;
		lines.push(
			`[${floor.nodeId}] ${floor.name}：${truncateFloor(floor.text, options.maxFloorChars)}`,
		);
	}
	lines.push(`请生成 ${options.questionsPerWindow} 道题。`);
	const request: LlmRequest = {
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: lines.join("\n") },
		],
		temperature: options.temperature,
		maxTokens: options.maxTokens,
	};
	return {
		...request,
		...(options.model === undefined ? {} : { model: options.model }),
		...(options.reasoning === undefined
			? {}
			: { reasoning: options.reasoning }),
	};
}

function truncateFloor(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}…（后续内容已截断）`;
}

interface ParsedModelQuestions {
	readonly items: readonly ModelQuestion[];
	readonly rejected: readonly string[];
}

function parseModelQuestions(text: string): ParsedModelQuestions {
	const body = stripCodeFence(text.trim());
	const parsed = tryParseJson(body) ?? tryParseJson(extractJson(body));
	if (parsed === undefined) {
		throw new Error("模型输出里找不到 JSON");
	}
	const list = Array.isArray(parsed)
		? parsed
		: isJsonObject(parsed) && Array.isArray(parsed.questions)
			? parsed.questions
			: null;
	if (!list) {
		throw new Error("模型输出的 JSON 不是数组，也没有 questions 数组");
	}
	const items: ModelQuestion[] = [];
	const rejected: string[] = [];
	list.forEach((item, index) => {
		const label = `模型输出的第 ${index + 1} 条题目`;
		if (!isJsonObject(item)) {
			rejected.push(`${label}不是对象`);
			return;
		}
		if (
			typeof item.question !== "string" ||
			typeof item.answer !== "string" ||
			!isStringArray(item.evidenceNodes)
		) {
			rejected.push(`${label}缺少 question、answer 或 evidenceNodes`);
			return;
		}
		items.push({
			question: item.question.trim(),
			answer: item.answer.trim(),
			evidenceNodes: item.evidenceNodes.map((id) => id.trim()),
		});
	});
	return { items, rejected };
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function stripCodeFence(text: string): string {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ?? text;
}

function tryParseJson(text: string | null): unknown {
	if (text === null || text.length === 0) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function extractJson(text: string): string | null {
	const arrayStart = text.indexOf("[");
	const arrayEnd = text.lastIndexOf("]");
	if (arrayStart >= 0 && arrayEnd > arrayStart) {
		return text.slice(arrayStart, arrayEnd + 1);
	}
	const objectStart = text.indexOf("{");
	const objectEnd = text.lastIndexOf("}");
	if (objectStart >= 0 && objectEnd > objectStart) {
		return text.slice(objectStart, objectEnd + 1);
	}
	return null;
}

function validateCandidate(
	item: ModelQuestion,
	window: Window,
	chat: ChatIndex,
	options: ResolvedOptions,
	askFloor: ChatFloor,
): Candidate | null {
	const question = item.question.trim();
	const answer = item.answer.trim();
	if (question.length === 0 || question.length > options.maxQuestionLength) {
		return null;
	}
	if (answer.length === 0 || answer.length > options.maxAnswerLength) {
		return null;
	}
	if (item.evidenceNodes.length === 0) return null;
	const evidenceFloors: ChatFloor[] = [];
	for (const nodeId of item.evidenceNodes) {
		const floor = chat.byNodeId.get(nodeId);
		if (!floor) return null;
		if (floor.position < window.start || floor.position >= window.end) {
			return null;
		}
		if (askFloor.position - floor.position < options.minEvidenceGap) {
			return null;
		}
		evidenceFloors.push(floor);
	}
	const unique = new Set(evidenceFloors.map((floor) => floor.position));
	if (unique.size !== evidenceFloors.length) return null;
	return {
		askFloor,
		evidenceFloors,
		question: ensureQuestionMark(question),
		answer,
	};
}

function ensureQuestionMark(question: string): string {
	return /[？?]$/.test(question) ? question : `${question}？`;
}

function normalizeQuestion(question: string): string {
	return question
		.toLowerCase()
		.replace(/[\s，。！？、,.!?:：;；"'“”‘’（）()【】\[\]]/g, "");
}

function selectCandidates(
	byWindow: readonly (readonly Candidate[])[],
	maxQuestions: number,
): Candidate[] {
	const selected: Candidate[] = [];
	let round = 0;
	while (selected.length < maxQuestions) {
		let added = false;
		for (const list of byWindow) {
			const candidate = list[round];
			if (!candidate) continue;
			selected.push(candidate);
			added = true;
			if (selected.length >= maxQuestions) break;
		}
		if (!added) break;
		round += 1;
	}
	return selected;
}

function verifyQuestion(
	question: EventQuestion,
	chat: ChatIndex,
	storyId: string,
	idPrefix: string,
	minEvidenceGap: number,
): EventQuestionFailure | null {
	if (question.story !== storyId) {
		return {
			askAtNode: question.askAtNode,
			reason: `题目的故事是 ${question.story}`,
		};
	}
	if (question.kind !== "event") {
		return { askAtNode: question.askAtNode, reason: "题目类型不是 event" };
	}
	if (question.question.trim().length === 0) {
		return { askAtNode: question.askAtNode, reason: "问题为空" };
	}
	if (question.answer.trim().length === 0) {
		return { askAtNode: question.askAtNode, reason: "答案为空" };
	}
	const askPosition = chat.allNodeIndexes.get(question.askAtNode);
	if (askPosition === undefined) {
		return { askAtNode: question.askAtNode, reason: "提问楼层不存在" };
	}
	const askIndex = parseMessageIndex(idPrefix, question.askAtNode);
	if (askIndex !== askPosition) {
		return { askAtNode: question.askAtNode, reason: "提问楼层序号不一致" };
	}
	if (question.evidenceNodes.length === 0) {
		return { askAtNode: question.askAtNode, reason: "缺少证据楼层" };
	}
	for (const evidenceId of question.evidenceNodes) {
		const evidenceIndex = chat.allNodeIndexes.get(evidenceId);
		if (evidenceIndex === undefined) {
			return {
				askAtNode: question.askAtNode,
				reason: `证据楼层 ${evidenceId} 不存在`,
			};
		}
		if (askIndex - evidenceIndex < minEvidenceGap) {
			return {
				askAtNode: question.askAtNode,
				reason: "证据楼层不在提问楼层之前，或间隔不足",
			};
		}
	}
	return null;
}

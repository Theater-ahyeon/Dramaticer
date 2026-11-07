import { isDeepStrictEqual } from "node:util";
import type {
	NewStateDiff,
	Story,
	StoryStore,
	TimelineRole,
} from "@dramaticer/core";
import type { StChatEntry, StChatMessage } from "./chat-jsonl.js";
import { parseChatJsonlFile } from "./chat-jsonl.js";
import type { JsonObject, JsonValue } from "./json.js";
import { isJsonObject } from "./json.js";

export interface ImportChatOptions {
	readonly storyId: string;
	/** 缺省时使用头部的 character_name，再缺省时使用 storyId。 */
	readonly title?: string;
	/** 楼层 id 的前缀，默认等于 storyId。 */
	readonly idPrefix?: string;
	/** 写入 StateDiff.source 的值，默认 `"import"`。 */
	readonly source?: string;
}

export interface ChatImportResult {
	readonly story: Story;
	/** 主路径（当前 swipe）上的楼层 id，顺序从根楼层开始。 */
	readonly mainPathNodeIds: readonly string[];
	/** 写入的楼层节点总数，包含其他 swipe 形成的兄弟节点。 */
	readonly nodeCount: number;
	readonly stateDiffCount: number;
}

/**
 * 把 ST 聊天记录写入 StoryStore。
 *
 * 当前 swipe 依次连成主路径；同一条消息的其他 swipe 作为父节点相同的兄弟节点，
 * 插入顺序与 swipe 下标一致。每条楼层都携带相对父楼层的 MVU 变量快照 diff：
 * null 快照表示这一层没有更新，数组整体替换，对象逐键递归。
 */
export async function importChatToStore(
	store: StoryStore,
	entries: AsyncIterable<StChatEntry> | Iterable<StChatEntry>,
	options: ImportChatOptions,
): Promise<ChatImportResult> {
	const storyId = requireNonEmpty(options.storyId, "故事 id");
	const source = requireNonEmpty(options.source ?? "import", "diff 来源");
	const idPrefix = requireNonEmpty(options.idPrefix ?? storyId, "楼层 id 前缀");
	if (options.title !== undefined) {
		requireNonEmpty(options.title, "故事标题");
	}

	let story: Story | null = null;
	let parentId: string | null = null;
	let currentVariables: JsonObject | null = null;
	const mainPathNodeIds: string[] = [];
	let nodeCount = 0;
	let stateDiffCount = 0;

	for await (const entry of entries) {
		if (entry.kind === "header") {
			if (story) {
				throw new Error("聊天记录里出现了第二个头部");
			}
			story = store.createStory({
				id: storyId,
				title: options.title ?? entry.header.characterName ?? storyId,
			});
			continue;
		}
		if (!story) {
			throw new Error("聊天记录缺少头部");
		}
		const message = entry.message;
		const role = roleOf(message);
		const createdAt = createdAtFromSendDate(message.sendDate);
		const currentSwipe = currentSwipeIndex(message);
		const mainNodeId = `${idPrefix}:m${message.index}:s${currentSwipe}`;

		store.appendNode({
			id: mainNodeId,
			storyId,
			parentId,
			role,
			raw: message.text,
			createdAt,
		});
		nodeCount += 1;

		const diffs: NewStateDiff[] = [];
		const mainVariables = readSnapshot(
			message.variables,
			`第 ${message.index} 条消息`,
		);
		collectSnapshotDiffs(
			diffs,
			storyId,
			mainNodeId,
			currentVariables,
			mainVariables,
			source,
		);

		for (let index = 0; index < message.swipes.length; index += 1) {
			if (index === currentSwipe) continue;
			const swipe = message.swipes[index];
			const siblingId = `${idPrefix}:m${message.index}:s${index}`;
			store.appendNode({
				id: siblingId,
				storyId,
				parentId,
				role,
				raw: swipe.text,
				createdAt,
			});
			nodeCount += 1;
			const swipeVariables = readSnapshot(
				swipe.variables,
				`第 ${message.index} 条消息的第 ${index} 个 swipe`,
			);
			collectSnapshotDiffs(
				diffs,
				storyId,
				siblingId,
				currentVariables,
				swipeVariables,
				source,
			);
		}

		stateDiffCount += store.appendStateDiffs(diffs).length;
		mainPathNodeIds.push(mainNodeId);
		parentId = mainNodeId;
		if (mainVariables !== null) {
			currentVariables = mainVariables;
		}
	}

	if (!story) {
		throw new Error("聊天记录为空：缺少头部");
	}
	return { story, mainPathNodeIds, nodeCount, stateDiffCount };
}

/** 从文件导入，逐行流式读取，不把整个聊天记录载入内存。 */
export async function importChatFileToStore(
	store: StoryStore,
	path: string,
	options: ImportChatOptions,
): Promise<ChatImportResult> {
	return importChatToStore(store, parseChatJsonlFile(path), options);
}

function requireNonEmpty(value: string, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

function roleOf(message: StChatMessage): TimelineRole {
	if (message.isSystem) return "system";
	if (message.isUser) return "user";
	return "assistant";
}

function currentSwipeIndex(message: StChatMessage): number {
	if (message.swipes.length === 0) return 0;
	const swipeId = message.swipeId;
	if (
		swipeId !== null &&
		Number.isInteger(swipeId) &&
		swipeId >= 0 &&
		swipeId < message.swipes.length
	) {
		return swipeId;
	}
	return 0;
}

function createdAtFromSendDate(
	sendDate: string | number | null,
): string | undefined {
	if (sendDate === null) return undefined;
	if (typeof sendDate === "number") {
		const date = new Date(sendDate * 1000);
		return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
	}
	const parsed = Date.parse(sendDate);
	return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function readSnapshot(value: JsonValue, label: string): JsonObject | null {
	if (value === null) return null;
	if (!isJsonObject(value)) {
		throw new Error(`${label}的 MVU 变量快照必须是对象或 null`);
	}
	return value;
}

function collectSnapshotDiffs(
	diffs: NewStateDiff[],
	storyId: string,
	nodeId: string,
	base: JsonObject | null,
	next: JsonObject | null,
	source: string,
): void {
	if (next === null) return;
	collectObjectDiffs(diffs, storyId, nodeId, base ?? {}, next, [], source);
}

function collectObjectDiffs(
	diffs: NewStateDiff[],
	storyId: string,
	nodeId: string,
	base: JsonObject,
	next: JsonObject,
	path: readonly string[],
	source: string,
): void {
	for (const key of Object.keys(next)) {
		const nextPath = [...path, key];
		const nextValue = next[key];
		if (Object.hasOwn(base, key)) {
			collectValueDiff(
				diffs,
				storyId,
				nodeId,
				base[key],
				nextValue,
				nextPath,
				source,
			);
		} else {
			collectFreshValue(diffs, storyId, nodeId, nextValue, nextPath, source);
		}
	}
	for (const key of Object.keys(base)) {
		if (Object.hasOwn(next, key)) continue;
		diffs.push({
			storyId,
			nodeId,
			path: [...path, key],
			op: "delete",
			source,
		});
	}
}

function collectValueDiff(
	diffs: NewStateDiff[],
	storyId: string,
	nodeId: string,
	base: JsonValue,
	next: JsonValue,
	path: readonly string[],
	source: string,
): void {
	if (isDeepStrictEqual(base, next)) return;
	if (isJsonObject(base) && isJsonObject(next)) {
		collectObjectDiffs(diffs, storyId, nodeId, base, next, path, source);
		return;
	}
	diffs.push({ storyId, nodeId, path, op: "set", value: next, source });
}

function collectFreshValue(
	diffs: NewStateDiff[],
	storyId: string,
	nodeId: string,
	next: JsonValue,
	path: readonly string[],
	source: string,
): void {
	if (isJsonObject(next) && Object.keys(next).length > 0) {
		collectObjectDiffs(diffs, storyId, nodeId, {}, next, path, source);
		return;
	}
	diffs.push({ storyId, nodeId, path, op: "set", value: next, source });
}

import {
	type JsonObject,
	type NewStateDiff,
	type Story,
	type StoryStore,
	type TimelineRole,
	mvuLedgerPath,
} from "@dramaticer/core";
import type {
	StChatDocument,
	StChatEntry,
	StChatHeader,
	StChatMessage,
} from "./chat-jsonl.js";
import { parseChatJsonlFile } from "./chat-jsonl.js";
import { currentSwipeIndex, messageNodeId, swipeNodeId } from "./node-id.js";
import type { SnapshotDiff } from "./state-diff.js";
import { diffSnapshots, readSnapshot } from "./state-diff.js";

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
	/**
	 * 导入的原始记录，包含 store 不保存的头部元数据、未知字段、swipe_info 与原始
	 * send_date；导出时传回去可以原样补回这些字段。
	 */
	readonly document: StChatDocument;
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
	let header: StChatHeader | null = null;
	const sourceMessages: StChatMessage[] = [];
	let parentId: string | null = null;
	let currentVariables: JsonObject | null = null;
	const mainPathNodeIds: string[] = [];
	let nodeCount = 0;
	let stateDiffCount = 0;

	const write = async (): Promise<ChatImportResult> => {
		for await (const entry of entries) {
			if (entry.kind === "header") {
				if (story) {
					throw new Error("聊天记录里出现了第二个头部");
				}
				header = entry.header;
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
			sourceMessages.push(message);
			const role = roleOf(message);
			const createdAt = createdAtFromSendDate(message.sendDate);
			const mainNodeId = messageNodeId(idPrefix, message);
			const currentSwipe = currentSwipeIndex(message);

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
			diffs.push(
				...toStateDiffs(
					diffSnapshots(currentVariables, mainVariables),
					storyId,
					mainNodeId,
					source,
				),
			);

			for (let index = 0; index < message.swipes.length; index += 1) {
				if (index === currentSwipe) continue;
				const swipe = message.swipes[index];
				const siblingId = swipeNodeId(idPrefix, message.index, index);
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
				diffs.push(
					...toStateDiffs(
						diffSnapshots(currentVariables, swipeVariables),
						storyId,
						siblingId,
						source,
					),
				);
			}

			stateDiffCount += store.appendStateDiffs(diffs).length;
			mainPathNodeIds.push(mainNodeId);
			parentId = mainNodeId;
			if (mainVariables !== null) {
				currentVariables = mainVariables;
			}
		}

		if (!story || !header) {
			throw new Error("聊天记录为空：缺少头部");
		}
		// 其他 swipe 是后追加的兄弟节点，head 要回到主路径末端。
		const lastMainNodeId = mainPathNodeIds[mainPathNodeIds.length - 1];
		if (lastMainNodeId !== undefined) {
			store.setHead(story.id, lastMainNodeId);
		}
		return {
			story,
			mainPathNodeIds,
			nodeCount,
			stateDiffCount,
			document: { header, messages: sourceMessages },
		};
	};

	return store.runInTransaction(write);
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

function toStateDiffs(
	diffs: readonly SnapshotDiff[],
	storyId: string,
	nodeId: string,
	source: string,
): NewStateDiff[] {
	return diffs.map((diff) =>
		diff.op === "set"
			? {
					storyId,
					nodeId,
					path: mvuLedgerPath(diff.path),
					op: "set",
					value: diff.value,
					source,
				}
			: {
					storyId,
					nodeId,
					path: mvuLedgerPath(diff.path),
					op: "delete",
					source,
				},
	);
}

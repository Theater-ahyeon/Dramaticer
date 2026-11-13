import { isDeepStrictEqual } from "node:util";
import {
	type JsonObject,
	type JsonValue,
	type StoryStore,
	type TimelineNode,
	isJsonObject,
} from "@dramaticer/core";
import {
	type StChatDocument,
	type StChatMessage,
	createChatDocument,
	serializeChatJsonl,
	writeChatJsonlFile,
} from "./chat-jsonl.js";

export interface ExportChatHeader {
	readonly userName?: string;
	readonly characterName?: string;
	readonly chatMetadata?: JsonValue;
}

export interface ExportChatOptions {
	readonly storyId: string;
	/**
	 * 导入时返回的文档。store 只保存正文、角色与变量 diff，头部元数据、未知字段、
	 * swipe_info 与原始 send_date 由这里补回；不传时按 store 里的信息尽力生成。
	 */
	readonly source?: StChatDocument;
	/** 没有 source 时覆盖头部字段；source 里已有的字段优先保留。 */
	readonly header?: ExportChatHeader;
}

/**
 * 把当前 head 路径导出成 ST 聊天记录。主路径上的每个楼层是一条消息，同一父楼层下
 * 的其他兄弟楼层作为它的 swipe；其他分支不进导出。variables 由沿路径的状态快照
 * 还原，所以只包含 `mvu` 命名空间。
 */
export function exportChatDocument(
	store: StoryStore,
	options: ExportChatOptions,
): StChatDocument {
	const story = store.getStory(options.storyId);
	if (!story) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const path = store.getPathToHead(options.storyId);
	if (path.length === 0) {
		throw new Error(`故事还没有楼层，无法导出：${options.storyId}`);
	}
	const settings = store.getStorySettings(options.storyId);
	const source = options.source;
	const headerRaw: JsonObject = { ...(source?.header.raw ?? {}) };
	const characterName =
		options.header?.characterName ??
		source?.header.characterName ??
		settings.cardName ??
		story.title;
	const userName =
		options.header?.userName ?? source?.header.userName ?? "User";
	headerRaw.character_name = characterName;
	headerRaw.user_name = userName;
	if (
		options.header?.chatMetadata !== undefined ||
		Object.hasOwn(headerRaw, "chat_metadata")
	) {
		headerRaw.chat_metadata =
			options.header?.chatMetadata ?? source?.header.chatMetadata ?? {};
	}

	const siblingsByParent = groupByParent(store.listStoryNodes(options.storyId));
	const messages = path.map((node, index) =>
		buildMessage(store, {
			node,
			siblings: sortSiblings(siblingsByParent.get(node.parentId) ?? [node]),
			header: { userName, characterName },
			source: source?.messages[index],
		}),
	);
	return createChatDocument(headerRaw, messages);
}

export function exportChatJsonl(
	store: StoryStore,
	options: ExportChatOptions,
): string {
	return serializeChatJsonl(exportChatDocument(store, options));
}

export async function exportChatFile(
	store: StoryStore,
	path: string,
	options: ExportChatOptions,
): Promise<void> {
	await writeChatJsonlFile(path, exportChatDocument(store, options));
}

interface BuildMessageInput {
	readonly node: TimelineNode;
	readonly siblings: readonly TimelineNode[];
	readonly header: {
		readonly userName: string;
		readonly characterName: string;
	};
	readonly source: StChatMessage | undefined;
}

function buildMessage(store: StoryStore, input: BuildMessageInput): JsonObject {
	const { node, siblings, source } = input;
	const swipeId = siblings.findIndex((sibling) => sibling.id === node.id);
	if (swipeId < 0) {
		throw new Error(`楼层 ${node.id} 不在同一父楼层的兄弟列表中`);
	}
	const raw: JsonObject = { ...(source?.raw ?? {}) };
	if (!Object.hasOwn(raw, "name")) {
		raw.name = defaultName(
			node.role,
			input.header.userName,
			input.header.characterName,
		);
	}
	if (node.role === "user" || Object.hasOwn(raw, "is_user")) {
		raw.is_user = node.role === "user";
	}
	if (node.role === "system" || Object.hasOwn(raw, "is_system")) {
		raw.is_system = node.role === "system";
	}
	if (!Object.hasOwn(raw, "send_date") && source === undefined) {
		raw.send_date = node.createdAt;
	}
	raw.mes = node.raw;

	const parentState = readMvuSnapshotAt(store, node.parentId);
	const states = siblings.map((sibling) =>
		readMvuSnapshotAt(store, sibling.id),
	);
	if (
		siblings.length > 1 ||
		Object.hasOwn(raw, "swipes") ||
		Object.hasOwn(raw, "swipe_id")
	) {
		const sourceSwipes = Array.isArray(source?.raw.swipes)
			? source.raw.swipes
			: null;
		const restoreSwipes = sourceSwipes !== null && source?.text === node.raw;
		raw.swipes = siblings.map((sibling, index) => {
			const sourceText = sourceSwipes?.[index];
			return restoreSwipes && typeof sourceText === "string"
				? sourceText
				: sibling.raw;
		});
		raw.swipe_id = swipeId;
	}
	const sourceVariables = Array.isArray(source?.raw.variables)
		? source.raw.variables
		: null;
	if (
		sourceVariables !== null ||
		siblings.length > 1 ||
		states.some((state) => !isDeepStrictEqual(state, parentState))
	) {
		raw.variables = states.map((state, index) =>
			keepNoUpdateMarker(sourceVariables?.[index], state, parentState),
		);
	}
	return raw;
}

/**
 * ST 用空对象表示这一层没有更新。导出时如果源记录是空标记、store 里这一层也确实
 * 没有变化，就写回原标记；否则写 store 里算出的完整快照。
 */
function keepNoUpdateMarker(
	value: JsonValue | undefined,
	state: JsonObject,
	parentState: JsonObject,
): JsonValue {
	if (!isDeepStrictEqual(state, parentState)) return state;
	if (value === null) return null;
	if (isJsonObject(value) && Object.keys(value).length === 0) return value;
	return state;
}

function defaultName(
	role: TimelineNode["role"],
	userName: string,
	characterName: string,
): string {
	if (role === "user") return userName;
	if (role === "assistant") return characterName;
	return "System";
}

function readMvuSnapshotAt(
	store: StoryStore,
	nodeId: string | null,
): JsonObject {
	if (nodeId === null) return {};
	const state = store.getStateSnapshot(nodeId).state;
	const mvu = state.mvu;
	return isJsonObject(mvu) ? mvu : {};
}

function groupByParent(
	nodes: readonly TimelineNode[],
): Map<string | null, TimelineNode[]> {
	const groups = new Map<string | null, TimelineNode[]>();
	for (const node of nodes) {
		const group = groups.get(node.parentId);
		if (group === undefined) {
			groups.set(node.parentId, [node]);
		} else {
			group.push(node);
		}
	}
	return groups;
}

const SWIPE_NODE_ID = /:m\d+:s(\d+)$/;

/**
 * 导入生成的兄弟楼层 id 带 swipe 下标，按它排序才能还原原来的 swipe 顺序；
 * 其他来源的兄弟楼层按创建顺序（listStoryNodes 的顺序）作为 swipe 顺序。
 */
function sortSiblings(
	siblings: readonly TimelineNode[],
): readonly TimelineNode[] {
	const indexes: number[] = [];
	for (const sibling of siblings) {
		const match = SWIPE_NODE_ID.exec(sibling.id);
		if (!match) return siblings;
		indexes.push(Number(match[1]));
	}
	if (new Set(indexes).size !== indexes.length) return siblings;
	return siblings
		.map((sibling, position) => ({ sibling, index: indexes[position] }))
		.sort((left, right) => left.index - right.index)
		.map((entry) => entry.sibling);
}

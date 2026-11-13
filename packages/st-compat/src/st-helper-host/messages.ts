import {
	type PluginDisplayState,
	type StoryStore,
	type TimelineNode,
	type TimelineRole,
	applyMessageModification,
} from "@dramaticer/core";

export interface StHelperChatMessage {
	readonly message_id: number;
	readonly name: string;
	readonly role: TimelineRole;
	readonly message: string;
	readonly is_hidden: boolean;
	readonly swipe_id: number;
	readonly swipes?: readonly string[];
}

export interface StHelperChatMessageOptions {
	readonly role?: "all" | TimelineRole;
	readonly hide_state?: "all" | "hidden" | "unhidden";
	readonly include_swipes?: boolean;
}

export type StHelperChatMessageRange =
	| number
	| string
	| { readonly start?: number; readonly end?: number };

export interface StHelperChatMessageUpdate {
	readonly message_id: number;
	readonly message?: string;
	readonly is_hidden?: boolean;
	readonly swipe_id?: number;
}

export interface StHelperSetChatMessagesOptions {
	readonly refresh?: "none" | "affected" | "all";
}

/**
 * 把酒馆助手的消息 API 映射到楼层树：读取是当前 head 路径上的楼层，
 * 改正文追加兄弟楼层（界面里的新 swipe），只改显示写插件显示状态。
 */
export class StHelperChatMessages {
	readonly #store: StoryStore;
	readonly #storyId: string;
	readonly #displayState: PluginDisplayState;
	readonly #plugin: string;
	readonly #userName: string;
	readonly #characterName: string;

	constructor(input: {
		readonly store: StoryStore;
		readonly storyId: string;
		readonly displayState: PluginDisplayState;
		readonly plugin: string;
		readonly userName: string;
		readonly characterName: string;
	}) {
		this.#store = input.store;
		this.#storyId = input.storyId;
		this.#displayState = input.displayState;
		this.#plugin = input.plugin;
		this.#userName = input.userName;
		this.#characterName = input.characterName;
	}

	getLastMessageId(): number {
		return this.#path().length - 1;
	}

	getCurrentMessageId(): number {
		return this.getLastMessageId();
	}

	getChatMessages(
		range: StHelperChatMessageRange,
		options: StHelperChatMessageOptions = {},
	): readonly StHelperChatMessage[] {
		const path = this.#path();
		const [start, end] = resolveRange(range, path.length);
		assertMessageOptions(options);
		const messages: StHelperChatMessage[] = [];
		for (let index = start; index <= end; index += 1) {
			const node = path[index];
			if (node === undefined) continue;
			const message = this.#messageAt(
				node,
				index,
				options.include_swipes === true,
			);
			if (
				options.role !== undefined &&
				options.role !== "all" &&
				message.role !== options.role
			) {
				continue;
			}
			if (
				options.hide_state !== undefined &&
				options.hide_state !== "all" &&
				message.is_hidden !== (options.hide_state === "hidden")
			) {
				continue;
			}
			messages.push(message);
		}
		return messages;
	}

	getChatMessage(
		messageId: number,
		options: { readonly include_swipes?: boolean } = {},
	): StHelperChatMessage {
		const path = this.#path();
		const node = this.#nodeAt(path, messageId);
		return this.#messageAt(node, messageId, options.include_swipes === true);
	}

	setChatMessages(
		updates: readonly StHelperChatMessageUpdate[],
		options: StHelperSetChatMessagesOptions = {},
	): void {
		if (!Array.isArray(updates)) {
			throw new Error("setChatMessages 的第一个参数必须是数组");
		}
		if (
			options.refresh !== undefined &&
			options.refresh !== "none" &&
			options.refresh !== "affected" &&
			options.refresh !== "all"
		) {
			throw new Error(
				`setChatMessages 的 refresh 非法：${String(options.refresh)}`,
			);
		}
		for (const update of updates) {
			this.#applyUpdate(update);
		}
	}

	/** 给最后一条助手消息追加一个 swipe（同父的新楼层），返回它的下标。 */
	addSwipe(
		text: string,
		options: { readonly switchTo?: boolean } = {},
	): number {
		if (typeof text !== "string" || text.length === 0) {
			throw new Error("addSwipe 需要非空的正文");
		}
		const path = this.#path();
		const last = path.at(-1);
		if (last === undefined) {
			throw new Error("当前聊天没有可以添加 swipe 的消息");
		}
		if (last.role !== "assistant") {
			throw new Error("只能给助手消息添加 swipe");
		}
		const siblings = this.#siblings(last);
		const node = this.#store.appendNode({
			storyId: this.#storyId,
			parentId: last.parentId,
			role: last.role,
			raw: text,
		});
		if (options.switchTo === true) {
			this.#store.setHead(this.#storyId, node.id);
		} else {
			// appendNode 会把 head 移到新楼层；addswipe 默认不切换 swipe
			this.#store.setHead(this.#storyId, last.id);
		}
		return siblings.length;
	}

	/** 在最后一条消息的 swipe 之间循环切换；返回新 swipe 的下标。 */
	switchSwipe(direction: "left" | "right"): number {
		const path = this.#path();
		const last = path.at(-1);
		if (last === undefined) {
			throw new Error("当前聊天没有可以切换的消息");
		}
		const siblings = this.#siblings(last);
		if (siblings.length < 2) {
			throw new Error("当前消息没有其他 swipe");
		}
		const current = siblings.findIndex((sibling) => sibling.id === last.id);
		const index = current < 0 ? 0 : current;
		const step = direction === "right" ? 1 : -1;
		const next = (index + step + siblings.length) % siblings.length;
		this.#store.setHead(this.#storyId, siblings[next].id);
		return next;
	}

	#applyUpdate(update: StHelperChatMessageUpdate): void {
		if (typeof update !== "object" || update === null) {
			throw new Error("setChatMessages 的条目必须是对象");
		}
		const path = this.#path();
		let node = this.#nodeAt(path, update.message_id);
		const hasContent = update.message !== undefined;
		const hasHidden = update.is_hidden !== undefined;
		const hasSwipe = update.swipe_id !== undefined;
		if (!hasContent && !hasHidden && !hasSwipe) {
			throw new Error(
				`消息 ${update.message_id} 的修改至少要有 message、is_hidden 或 swipe_id 中的一项`,
			);
		}
		if (hasSwipe) {
			if (!Number.isInteger(update.swipe_id)) {
				throw new Error("swipe_id 必须是整数");
			}
			const siblings = this.#siblings(node);
			const target = siblings[update.swipe_id as number];
			if (target === undefined) {
				throw new Error(
					`消息 ${update.message_id} 没有 swipe_id ${String(update.swipe_id)}`,
				);
			}
			this.#store.setHead(this.#storyId, target.id);
			node = target;
		}
		if (hasContent) {
			if (typeof update.message !== "string") {
				throw new Error("消息正文必须是字符串");
			}
			if (node.raw !== update.message) {
				const result = applyMessageModification({
					store: this.#store,
					displayState: this.#displayState,
					plugin: this.#plugin,
					request: { nodeId: node.id, raw: update.message },
				});
				if (result.kind !== "content") {
					throw new Error("改正文的消息修改没有返回新楼层");
				}
				node = result.node;
			}
		}
		if (hasHidden) {
			if (typeof update.is_hidden !== "boolean") {
				throw new Error("is_hidden 必须是布尔值");
			}
			this.#displayState.set({
				nodeId: node.id,
				plugin: this.#plugin,
				kind: "metadata",
				values: { is_hidden: update.is_hidden },
			});
		}
	}

	#messageAt(
		node: TimelineNode,
		messageId: number,
		includeSwipes: boolean,
	): StHelperChatMessage {
		const siblings = this.#siblings(node);
		const swipeId = siblings.findIndex((sibling) => sibling.id === node.id);
		const message: StHelperChatMessage = {
			message_id: messageId,
			name: node.role === "user" ? this.#userName : this.#characterName,
			role: node.role,
			message: node.raw,
			is_hidden: this.#isHidden(node.id),
			swipe_id: swipeId < 0 ? 0 : swipeId,
			...(includeSwipes
				? { swipes: siblings.map((sibling) => sibling.raw) }
				: {}),
		};
		return message;
	}

	#isHidden(nodeId: string): boolean {
		return (
			this.#displayState.get(nodeId, this.#plugin)?.metadata.is_hidden === true
		);
	}

	#path(): TimelineNode[] {
		return this.#store.getPathToHead(this.#storyId);
	}

	#nodeAt(path: readonly TimelineNode[], messageId: number): TimelineNode {
		if (!Number.isInteger(messageId) || messageId < 0) {
			throw new Error(`消息 id 必须是非负整数：${String(messageId)}`);
		}
		const node = path[messageId];
		if (node === undefined) {
			throw new Error(`消息 id ${messageId} 不存在`);
		}
		return node;
	}

	#siblings(node: TimelineNode): TimelineNode[] {
		return this.#store
			.listStoryNodes(this.#storyId)
			.filter((candidate) => candidate.parentId === node.parentId);
	}
}

function assertMessageOptions(options: StHelperChatMessageOptions): void {
	if (
		options.role !== undefined &&
		options.role !== "all" &&
		options.role !== "system" &&
		options.role !== "user" &&
		options.role !== "assistant"
	) {
		throw new Error(`getChatMessages 的 role 非法：${String(options.role)}`);
	}
	if (
		options.hide_state !== undefined &&
		options.hide_state !== "all" &&
		options.hide_state !== "hidden" &&
		options.hide_state !== "unhidden"
	) {
		throw new Error(
			`getChatMessages 的 hide_state 非法：${String(options.hide_state)}`,
		);
	}
}

/** 支持数字（最后 N 条）、`latest`、`start-end` 与 `{start, end}`；负数从末尾数。 */
function resolveRange(
	range: StHelperChatMessageRange,
	length: number,
): [number, number] {
	if (typeof range === "number") {
		if (!Number.isInteger(range) || range < 0) {
			throw new Error("getChatMessages 的数量必须是非负整数");
		}
		if (range === 0 || length === 0) return [0, -1];
		return [Math.max(0, length - range), length - 1];
	}
	if (typeof range === "string") {
		const text = range.trim();
		if (text === "latest") {
			return length === 0 ? [0, -1] : [length - 1, length - 1];
		}
		const match = /^(-?\d+)-(-?\d+|latest)$/.exec(text);
		if (match === null) {
			throw new Error(`getChatMessages 的范围非法：${range}`);
		}
		const start = resolveIndex(Number(match[1]), length);
		const end =
			match[2] === "latest"
				? length - 1
				: resolveIndex(Number(match[2]), length);
		return [start, end];
	}
	if (typeof range === "object" && range !== null) {
		const start =
			range.start === undefined ? 0 : resolveIndex(range.start, length);
		const end =
			range.end === undefined ? length - 1 : resolveIndex(range.end, length);
		return [start, end];
	}
	throw new Error("getChatMessages 的范围必须是数字、字符串或对象");
}

function resolveIndex(index: number, length: number): number {
	if (!Number.isInteger(index)) {
		throw new Error(`消息下标必须是整数：${String(index)}`);
	}
	return index < 0 ? length + index : index;
}

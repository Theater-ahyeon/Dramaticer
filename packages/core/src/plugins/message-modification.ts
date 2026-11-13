import type { JsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import type { PluginDisplayState } from "./display-state.js";

/** 一条消息修改只有三类：改正文、改显示、改元数据。 */
export const MESSAGE_MODIFICATION_KINDS = [
	"content",
	"display",
	"metadata",
] as const;

export type MessageModificationKind =
	(typeof MESSAGE_MODIFICATION_KINDS)[number];

export interface MessageModificationRequest {
	readonly nodeId: string;
	/** 新正文；只允许与显示、元数据中的一类同时出现。 */
	readonly raw?: string;
	/** 渲染结果；写进插件显示状态，不进入楼层原文与台账。 */
	readonly display?: Readonly<JsonObject>;
	/** 插件元数据；同样只进显示状态。 */
	readonly metadata?: Readonly<JsonObject>;
}

export function classifyMessageModification(
	request: MessageModificationRequest,
): MessageModificationKind {
	const present: MessageModificationKind[] = [];
	if (request.raw !== undefined) present.push("content");
	if (request.display !== undefined) present.push("display");
	if (request.metadata !== undefined) present.push("metadata");
	if (present.length === 0) {
		throw new Error("消息修改至少要有正文、显示或元数据中的一项");
	}
	if (present.length > 1) {
		throw new Error(`消息修改只能属于一类，收到：${present.join("、")}`);
	}
	return present[0];
}

export type MessageModificationResult =
	| {
			readonly kind: "content";
			/** 被修改的原楼层；原文保持逐字节不变。 */
			readonly previousNodeId: string;
			/** 新追加的兄弟楼层，在界面里显示为新的 swipe。 */
			readonly node: TimelineNode;
	  }
	| {
			readonly kind: "display" | "metadata";
			readonly nodeId: string;
			readonly values: Readonly<JsonObject>;
	  };

export interface ApplyMessageModificationInput {
	readonly store: StoryStore;
	readonly displayState: PluginDisplayState;
	readonly plugin: string;
	readonly request: MessageModificationRequest;
}

/**
 * 执行一条消息修改。改正文时追加一个兄弟节点，原楼层保持逐字节不变（I4）；
 * 只改显示或元数据时写进插件显示状态，不新建节点、不写台账。
 *
 * 插件改写正文不记偏好信号：偏好记录只反映玩家自己的接受与放弃。
 */
export function applyMessageModification(
	input: ApplyMessageModificationInput,
): MessageModificationResult {
	const kind = classifyMessageModification(input.request);
	const original = input.store.getNode(input.request.nodeId);
	if (original === null) {
		throw new Error(`消息修改的目标楼层不存在：${input.request.nodeId}`);
	}
	if (kind === "content") {
		const raw = input.request.raw;
		if (typeof raw !== "string" || raw.length === 0) {
			throw new Error("改正文的消息修改需要非空的新正文");
		}
		if (raw === original.raw) {
			throw new Error(`楼层 ${original.id} 的新正文与原文相同，不生成新 swipe`);
		}
		const node = input.store.appendNode({
			storyId: original.storyId,
			parentId: original.parentId,
			role: original.role,
			raw,
		});
		return { kind, previousNodeId: original.id, node };
	}
	const values = input.request[kind];
	if (values === undefined) {
		throw new Error(`消息修改缺少 ${kind} 内容`);
	}
	input.displayState.set({
		nodeId: original.id,
		plugin: input.plugin,
		kind,
		values,
	});
	return { kind, nodeId: original.id, values };
}

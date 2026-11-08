import type {
	DisplayedContent,
	SseEvent,
	TurnCompletedPayload,
} from "@dramaticer/protocol";

export interface ToolCallRecord {
	readonly name: string;
	readonly ok: boolean;
}

/** 正在流式生成的回合；完成后页面重新取路径并丢弃这份草稿。 */
export interface TurnDraft {
	readonly started: boolean;
	readonly userNodeId: string | null;
	readonly text: string;
	readonly thinking: string;
	readonly blocks: readonly DisplayedContent[];
	readonly tools: readonly ToolCallRecord[];
	readonly completed: TurnCompletedPayload | null;
	readonly errorMessage: string | null;
}

export function createTurnDraft(): TurnDraft {
	return {
		started: false,
		userNodeId: null,
		text: "",
		thinking: "",
		blocks: [],
		tools: [],
		completed: null,
		errorMessage: null,
	};
}

/** 按 SSE 事件推进草稿；事件只增不减，停止后已经收到的正文仍然保留。 */
export function applyTurnEvent(draft: TurnDraft, event: SseEvent): TurnDraft {
	switch (event.event) {
		case "turn.started":
			return {
				...draft,
				started: true,
				userNodeId: event.data.userNodeId,
			};
		case "text.delta":
			return { ...draft, text: draft.text + event.data.delta };
		case "thinking.delta":
			return { ...draft, thinking: draft.thinking + event.data.delta };
		case "blocks.replace":
			return { ...draft, blocks: event.data.blocks };
		case "tool.call":
			return {
				...draft,
				tools: [...draft.tools, { name: event.data.name, ok: event.data.ok }],
			};
		case "turn.completed":
			return {
				...draft,
				completed: event.data,
				text: draft.text.length === 0 ? event.data.node.raw : draft.text,
				errorMessage: null,
			};
		case "turn.error":
			return { ...draft, errorMessage: event.data.message };
	}
}

export function markTurnFailed(draft: TurnDraft, message: string): TurnDraft {
	return { ...draft, errorMessage: message };
}

export type RetryAction =
	| { readonly kind: "resend" }
	| { readonly kind: "regenerate"; readonly nodeId: string }
	| { readonly kind: "blocked"; readonly message: string };

/**
 * 失败后怎么重试：还没写用户楼层时重发同一段文字；已经写了用户楼层时只对
 * 已保存的助手楼层重新生成；两者都不成立就不提供重试，避免重复写楼层。
 */
export function resolveRetryAction(input: {
	readonly started: boolean;
	readonly assistantNodeId: string | null;
}): RetryAction {
	if (!input.started) return { kind: "resend" };
	if (input.assistantNodeId !== null) {
		return { kind: "regenerate", nodeId: input.assistantNodeId };
	}
	return {
		kind: "blocked",
		message:
			"玩家楼层已经写入，但这一轮没有生成回复；再发送同样内容会追加新的楼层，请换一条行动继续。",
	};
}

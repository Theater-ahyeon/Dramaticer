import type {
	DisplayedContent,
	DraftReplacePayload,
	SseEvent,
	TurnCommittedPayload,
	TurnCompletedPayload,
	TurnProgressPayload,
} from "@dramaticer/protocol";

export interface ToolCallRecord {
	readonly name: string;
	readonly ok: boolean;
}

/** 深回合投影出来的草稿；提交前不写楼层。 */
export interface LiveDraft {
	readonly text: string;
	readonly version: number;
}

/** 正在流式生成的回合；完成后页面重新取路径并丢弃这份草稿。 */
export interface TurnDraft {
	readonly started: boolean;
	readonly userNodeId: string | null;
	/** 深回合的运行 id；快回合为 null。 */
	readonly runId: string | null;
	readonly text: string;
	readonly thinking: string;
	readonly blocks: readonly DisplayedContent[];
	readonly tools: readonly ToolCallRecord[];
	/** 最近一条阶段提示；正文开始流出后清空。 */
	readonly progress: TurnProgressPayload | null;
	readonly liveDraft: LiveDraft | null;
	/** 运行中被接受并回显的追加要求，按接受顺序排列。 */
	readonly guidance: readonly string[];
	readonly committed: TurnCommittedPayload | null;
	readonly completed: TurnCompletedPayload | null;
	readonly errorMessage: string | null;
}

export function createTurnDraft(): TurnDraft {
	return {
		started: false,
		userNodeId: null,
		runId: null,
		text: "",
		thinking: "",
		blocks: [],
		tools: [],
		progress: null,
		liveDraft: null,
		guidance: [],
		committed: null,
		completed: null,
		errorMessage: null,
	};
}

/**
 * 草稿快照只向前合并：迟到的旧版本不覆盖新版本。
 * 版本号由运行时控制器逐次加一，重复版本视为同一快照。
 */
export function applyDraftSnapshot(
	current: LiveDraft | null,
	snapshot: DraftReplacePayload,
): LiveDraft {
	if (current !== null && snapshot.version <= current.version) return current;
	return { text: snapshot.text, version: snapshot.version };
}

/** 阶段提示的显示文字；没有进度时返回 null。 */
export function describeProgress(
	progress: TurnProgressPayload | null,
): string | null {
	if (progress === null) return null;
	const phase = progress.phase.trim();
	return phase.length === 0 ? null : phase;
}

/** 按 SSE 事件推进草稿；事件只增不减，停止后已经收到的正文仍然保留。 */
export function applyTurnEvent(draft: TurnDraft, event: SseEvent): TurnDraft {
	switch (event.event) {
		case "turn.started":
			return {
				...draft,
				started: true,
				userNodeId: event.data.userNodeId,
				runId: event.data.runId,
			};
		case "text.delta":
			return { ...draft, text: draft.text + event.data.delta, progress: null };
		case "thinking.delta":
			return { ...draft, thinking: draft.thinking + event.data.delta };
		case "blocks.replace":
			return { ...draft, blocks: event.data.blocks, progress: null };
		case "tool.call":
			return {
				...draft,
				tools: [...draft.tools, { name: event.data.name, ok: event.data.ok }],
			};
		case "turn.progress":
			return { ...draft, progress: event.data };
		case "draft.replace":
			return {
				...draft,
				liveDraft: applyDraftSnapshot(draft.liveDraft, event.data),
			};
		case "turn.steering":
			return { ...draft, guidance: [...draft.guidance, event.data.text] };
		case "turn.committed":
			return {
				...draft,
				committed: event.data,
				blocks: event.data.blocks,
				progress: null,
			};
		case "turn.completed":
			return {
				...draft,
				completed: event.data,
				text: draft.text.length === 0 ? event.data.node.raw : draft.text,
				progress: null,
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
	| { readonly kind: "retry"; readonly nodeId: string }
	| { readonly kind: "blocked"; readonly message: string };

/**
 * 失败后怎么重试：还没写用户楼层时重发同一段文字；已经有助手楼层时重新生成
 * 那一楼；只有用户楼层时以该楼层为父节点重试这一轮，不追加新的用户楼层。
 */
export function resolveRetryAction(input: {
	readonly started: boolean;
	readonly assistantNodeId: string | null;
	readonly userNodeId?: string | null;
}): RetryAction {
	if (!input.started) return { kind: "resend" };
	if (input.assistantNodeId !== null) {
		return { kind: "regenerate", nodeId: input.assistantNodeId };
	}
	if (input.userNodeId !== undefined && input.userNodeId !== null) {
		return { kind: "retry", nodeId: input.userNodeId };
	}
	return {
		kind: "blocked",
		message:
			"玩家楼层已经写入，但这一轮没有生成回复；再发送同样内容会追加新的楼层，请换一条行动继续。",
	};
}

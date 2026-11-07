import { parseBlocks } from "../blocks/parser.js";
import { renderContextView } from "../blocks/view.js";
import type {
	ContextSlotContent,
	ContextSlotProvider,
} from "../context/assembler.js";
import type { ContextMessage } from "../context/template.js";
import { applyStateDiffs } from "../state.js";
import type { StoryStore } from "../store/story-store.js";

export interface HistorySlotProviderOptions {
	/** 最多带最近多少楼，默认 20。 */
	readonly limit?: number;
}

export const DEFAULT_HISTORY_LIMIT = 20;

/** 把固定的消息集合包装成槽位提供者，例如角色卡生成的系统提示词。 */
export function createStaticSlotProvider(
	messages: readonly ContextMessage[],
	source: string,
): ContextSlotProvider {
	if (typeof source !== "string" || source.length === 0) {
		throw new Error("槽位内容的来源描述必须是非空字符串");
	}
	if (messages.length === 0) {
		throw new Error(`槽位 ${source} 至少要有一条消息`);
	}
	for (const message of messages) {
		if (typeof message.content !== "string" || message.content.length === 0) {
			throw new Error(`槽位 ${source} 的消息内容必须是非空字符串`);
		}
	}
	const frozen = messages.map((message) => ({ ...message }));
	return {
		provide(): ContextSlotContent {
			return { messages: frozen, source };
		},
	};
}

/** 把路径上的最近若干楼渲染成上下文视图，交给历史槽位。 */
export function createHistorySlotProvider(
	store: StoryStore,
	options: HistorySlotProviderOptions = {},
): ContextSlotProvider {
	const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("历史槽位的楼数上限必须是正整数");
	}
	return {
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const path = store.getPathToNode(request.nodeId);
			const nodes = path.slice(-limit);
			const messages: ContextMessage[] = [];
			nodes.forEach((node, index) => {
				const depth = nodes.length - 1 - index;
				const text = renderContextView(parseBlocks(node.raw), { depth });
				if (text.trim().length === 0) return;
				messages.push({ role: node.role, content: text });
			});
			if (messages.length === 0) return null;
			return { messages, source: `history:最近 ${messages.length} 楼` };
		},
	};
}

/** 沿路径回放状态 diff，把当前状态渲染成系统消息。 */
export function createStateSlotProvider(
	store: StoryStore,
): ContextSlotProvider {
	return {
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const diffs = store.getStateDiffsAlongPath(request.nodeId);
			const state = applyStateDiffs(diffs);
			if (Object.keys(state).length === 0) return null;
			return {
				messages: [
					{
						role: "system",
						content: `当前状态：\n${JSON.stringify(state, null, 2)}`,
					},
				],
				source: `state:${diffs.length} 条 diff`,
			};
		},
	};
}

import type {
	AssistantConversationListView,
	AssistantConversationMatch,
	AssistantConversationView,
} from "@dramaticer/protocol";

export interface ConversationListState {
	readonly conversations: readonly AssistantConversationView[];
	/** 搜索命中的片段；不带查询词时为空。 */
	readonly matches: Readonly<Record<string, AssistantConversationMatch>>;
	readonly activeId: string | null;
}

export function createConversationListState(): ConversationListState {
	return { conversations: [], matches: {}, activeId: null };
}

/** 用服务端的一次响应替换列表；活动会话保持不变。 */
export function applyConversationList(
	state: ConversationListState,
	view: AssistantConversationListView,
): ConversationListState {
	return {
		...state,
		conversations: view.conversations,
		matches: indexMatches(view),
	};
}

export function selectConversation(
	state: ConversationListState,
	id: string | null,
): ConversationListState {
	return { ...state, activeId: id };
}

/** 新建或改名后的会话放到最前面，保持与列表接口的更新时间顺序一致。 */
export function upsertConversation(
	state: ConversationListState,
	conversation: AssistantConversationView,
): ConversationListState {
	const rest = state.conversations.filter(
		(item) => item.id !== conversation.id,
	);
	return {
		...state,
		conversations: [conversation, ...rest],
		activeId: conversation.id,
	};
}

/** 改名与设置变更只替换同一条，不改变搜索结果的顺序。 */
export function patchConversation(
	state: ConversationListState,
	conversation: AssistantConversationView,
): ConversationListState {
	return {
		...state,
		conversations: state.conversations.map((item) =>
			item.id === conversation.id ? conversation : item,
		),
	};
}

/** 删除后如果删的是活动会话，选列表里的第一条；列表空了就清空选择。 */
export function removeConversation(
	state: ConversationListState,
	id: string,
): ConversationListState {
	const conversations = state.conversations.filter((item) => item.id !== id);
	if (state.activeId !== id) return { ...state, conversations };
	return {
		...state,
		conversations,
		activeId: conversations[0]?.id ?? null,
	};
}

export function activeConversation(
	state: ConversationListState,
): AssistantConversationView | null {
	if (state.activeId === null) return null;
	return state.conversations.find((item) => item.id === state.activeId) ?? null;
}

export function matchFor(
	state: ConversationListState,
	conversationId: string,
): AssistantConversationMatch | null {
	return state.matches[conversationId] ?? null;
}

function indexMatches(
	view: AssistantConversationListView,
): Readonly<Record<string, AssistantConversationMatch>> {
	const matches: Record<string, AssistantConversationMatch> = {};
	if (view.matches === undefined) return matches;
	for (let index = 0; index < view.conversations.length; index += 1) {
		const conversation = view.conversations[index];
		const match = view.matches[index];
		if (conversation !== undefined && match !== undefined) {
			matches[conversation.id] = match;
		}
	}
	return matches;
}

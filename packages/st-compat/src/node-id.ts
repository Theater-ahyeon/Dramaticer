import type { StChatMessage } from "./chat-jsonl.js";

/** 当前显示的 swipe 下标；swipe_id 在解析阶段已校验，null 表示没有 swipe。 */
export function currentSwipeIndex(message: StChatMessage): number {
	return message.swipeId ?? 0;
}

export function messageNodeId(
	idPrefix: string,
	message: StChatMessage,
): string {
	return swipeNodeId(idPrefix, message.index, currentSwipeIndex(message));
}

export function swipeNodeId(
	idPrefix: string,
	messageIndex: number,
	swipeIndex: number,
): string {
	return `${idPrefix}:m${messageIndex}:s${swipeIndex}`;
}

/** 从楼层 id 里取出消息序号；只接受本仓库生成的 `前缀:m<序号>:s<下标>` 形式。 */
export function parseMessageIndex(idPrefix: string, nodeId: string): number {
	const prefix = `${idPrefix}:m`;
	if (!nodeId.startsWith(prefix)) {
		throw new Error(`楼层 id ${nodeId} 不属于故事 ${idPrefix}`);
	}
	const rest = nodeId.slice(prefix.length);
	const separator = rest.indexOf(":s");
	if (separator <= 0) {
		throw new Error(`楼层 id ${nodeId} 缺少 swipe 下标`);
	}
	const index = rest.slice(0, separator);
	if (!/^\d+$/.test(index)) {
		throw new Error(`楼层 id ${nodeId} 的消息序号不是整数`);
	}
	return Number(index);
}

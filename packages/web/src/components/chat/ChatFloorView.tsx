import { parseBlocks } from "@dramaticer/core/blocks";
import { useMemo } from "react";
import type { ChatFloor } from "../../chat/path-state";
import { BlockContent } from "./BlockContent";

export interface ChatFloorViewProps {
	readonly node: ChatFloor;
	readonly canRegenerate: boolean;
	readonly onRegenerate: (nodeId: string) => void;
	readonly onChooseOption: (nodeId: string, text: string) => void;
	readonly registerRow: (nodeId: string, element: HTMLElement | null) => void;
}

/** 一个楼层：玩家楼层显示原文，助手楼层按块渲染。 */
export function ChatFloorView({
	node,
	canRegenerate,
	onRegenerate,
	onChooseOption,
	registerRow,
}: ChatFloorViewProps) {
	const items = useMemo(
		() => (node.role === "assistant" ? parseBlocks(node.raw) : null),
		[node.role, node.raw],
	);
	const setRow = useMemo(
		() => (element: HTMLElement | null) => registerRow(node.id, element),
		[node.id, registerRow],
	);
	const isUser = node.role === "user";
	return (
		<article
			className={`floor ${isUser ? "floor-user" : "floor-assistant"}`}
			data-node-id={node.id}
			ref={setRow}
		>
			<header className="floor-meta">
				<span className="floor-speaker">{isUser ? "你" : "剧情"}</span>
				<time dateTime={node.createdAt}>{formatFloorTime(node.createdAt)}</time>
				{canRegenerate ? (
					<button
						className="floor-action"
						type="button"
						onClick={() => onRegenerate(node.id)}
					>
						重新生成
					</button>
				) : null}
			</header>
			<div className="floor-body">
				{items === null ? (
					<span className="text-segment">{node.raw}</span>
				) : (
					<BlockContent
						items={items}
						nodeId={node.id}
						onChooseOption={onChooseOption}
					/>
				)}
			</div>
		</article>
	);
}

function formatFloorTime(createdAt: string): string {
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime())) return createdAt;
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${month}-${day} ${hour}:${minute}`;
}

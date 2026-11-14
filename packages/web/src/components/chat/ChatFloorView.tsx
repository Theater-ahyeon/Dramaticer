import type { RerollReason } from "@dramaticer/core";
import { parseBlocks } from "@dramaticer/core/blocks";
import { toDisplayedBlocks } from "@dramaticer/protocol";
import { useMemo } from "react";
import { formatFloorTime } from "../../chat/format";
import type { ChatFloor } from "../../chat/path-state";
import { BlockContent } from "./BlockContent";
import { FloorImages } from "./FloorImages";
import { FloorRunTimeline } from "./FloorRunTimeline";
import { RerollReasonPicker } from "./RerollReasonPicker";

export interface ChatFloorViewProps {
	readonly node: ChatFloor;
	readonly canRegenerate: boolean;
	readonly retryingImageId: string | null;
	/** 这一楼正在选重 roll 的原因；只有最新助手楼层会打开。 */
	readonly rerollOpen: boolean;
	readonly onRegenerate: (nodeId: string) => void;
	readonly onPickRerollReason: (nodeId: string, reason: RerollReason) => void;
	readonly onCancelReroll: () => void;
	readonly onChooseOption: (nodeId: string, text: string) => void;
	readonly onRetryImage: (nodeId: string, imageId: string) => void;
	readonly registerRow: (nodeId: string, element: HTMLElement | null) => void;
}

/** 一个楼层：玩家楼层显示原文，助手楼层按块渲染。 */
export function ChatFloorView({
	node,
	canRegenerate,
	retryingImageId,
	rerollOpen,
	onRegenerate,
	onPickRerollReason,
	onCancelReroll,
	onChooseOption,
	onRetryImage,
	registerRow,
}: ChatFloorViewProps) {
	const items = useMemo(
		() =>
			node.role === "assistant"
				? toDisplayedBlocks(parseBlocks(node.raw))
				: null,
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
			{rerollOpen ? (
				<RerollReasonPicker
					busy={!canRegenerate}
					onPick={(reason) => onPickRerollReason(node.id, reason)}
					onCancel={onCancelReroll}
				/>
			) : null}
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
			<FloorImages
				images={node.images}
				retryingImageId={retryingImageId}
				onRetry={(imageId) => onRetryImage(node.id, imageId)}
			/>
			{isUser ? null : <FloorRunTimeline nodeId={node.id} />}
		</article>
	);
}

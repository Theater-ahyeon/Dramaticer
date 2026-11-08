import type { TurnDraft } from "../../chat/stream-state";
import { BlockContent } from "./BlockContent";

/** 流式生成的草稿楼层；选项在拿到楼层 id 之前只显示不可点。 */
export function StreamingBubble({ draft }: { readonly draft: TurnDraft }) {
	return (
		<article
			className="floor floor-assistant floor-streaming"
			aria-live="polite"
		>
			<header className="floor-meta">
				<span className="floor-speaker">剧情</span>
				<span className="muted">
					{draft.completed === null ? "生成中" : "已生成"}
				</span>
			</header>
			{draft.thinking.length > 0 ? (
				<details className="block block-thinking">
					<summary>思考</summary>
					<div className="block-body">{draft.thinking}</div>
				</details>
			) : null}
			<div className="floor-body">
				{draft.blocks.length > 0 ? (
					<BlockContent
						items={draft.blocks}
						nodeId={null}
						onChooseOption={ignoreChoice}
					/>
				) : (
					<span className="text-segment">{draft.text}</span>
				)}
				{draft.errorMessage === null ? (
					<span className="stream-cursor" aria-hidden="true" />
				) : (
					<p className="stream-error">{draft.errorMessage}</p>
				)}
			</div>
		</article>
	);
}

function ignoreChoice(): void {}

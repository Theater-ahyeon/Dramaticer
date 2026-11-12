import { type TurnDraft, describeProgress } from "../../chat/stream-state";
import { BlockContent } from "./BlockContent";

/** 流式生成的草稿楼层；选项在拿到楼层 id 之前只显示不可点。 */
export function StreamingBubble({ draft }: { readonly draft: TurnDraft }) {
	const progress = describeProgress(draft.progress);
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
			{progress !== null && draft.errorMessage === null ? (
				<output className="stream-progress">{progress}</output>
			) : null}
			{draft.liveDraft === null ? null : (
				<section className="draft-panel" aria-label="草稿">
					<header className="draft-meta">
						<span>草稿</span>
						<span className="muted">第 {draft.liveDraft.version} 版</span>
						<span className="draft-state">
							{draft.committed === null ? "未提交" : "已提交为正式楼层"}
						</span>
					</header>
					{draft.committed === null ? (
						<div className="draft-body">{draft.liveDraft.text}</div>
					) : null}
				</section>
			)}
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
				{draft.errorMessage === null && draft.committed === null ? (
					<span className="stream-cursor" aria-hidden="true" />
				) : null}
				{draft.errorMessage === null ? null : (
					<p className="stream-error">{draft.errorMessage}</p>
				)}
			</div>
		</article>
	);
}

function ignoreChoice(): void {}

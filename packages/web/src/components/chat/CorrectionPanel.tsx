import { useState } from "react";
import { isCorrectionReady } from "../../chat/scene-control";

export interface CorrectionPanelProps {
	/** 选中的原文；null 表示玩家还没选中任何一段。 */
	readonly quote: string | null;
	readonly busy: boolean;
	readonly error: unknown;
	readonly onSubmit: (instruction: string) => void;
	readonly onCancel: () => void;
}

/**
 * 就地纠正：显示选中的片段，玩家写下哪里不对。提交后只重写这一段，
 * 旧楼层保留为兄弟节点；纠正意见同时记成长期偏好。
 */
export function CorrectionPanel({
	quote,
	busy,
	error,
	onSubmit,
	onCancel,
}: CorrectionPanelProps) {
	const [instruction, setInstruction] = useState("");
	const ready =
		quote !== null && isCorrectionReady({ quote, instruction }) && !busy;
	return (
		<div className="correction-panel" aria-label="就地纠正">
			{quote === null ? (
				<p className="muted">先在正文里选中要改的那一段，再点「就地纠正」。</p>
			) : (
				<>
					<blockquote className="correction-quote">{quote}</blockquote>
					<textarea
						aria-label="这一段哪里不对"
						placeholder="写清楚要改成什么样，例如「这里让她直接把钥匙推过来」"
						rows={2}
						value={instruction}
						onChange={(event) => setInstruction(event.target.value)}
					/>
					{error === null || error === undefined ? null : (
						<p className="correction-error" role="alert">
							{error instanceof Error ? error.message : "纠正失败"}
						</p>
					)}
					<div className="correction-actions">
						<button type="button" onClick={onCancel} disabled={busy}>
							取消
						</button>
						<button
							type="button"
							className="correction-submit"
							disabled={!ready}
							onClick={() => onSubmit(instruction.trim())}
						>
							{busy ? "改写中……" : "只改这一段"}
						</button>
					</div>
				</>
			)}
		</div>
	);
}

import { useMemo } from "react";
import {
	type CandidateActionItem,
	groupCandidateActions,
} from "../../chat/candidate-actions";

export interface CandidateActionsProps {
	readonly actions: readonly CandidateActionItem[];
	readonly onPick: (text: string) => void;
	/**
	 * 固定一项「让故事自己走」：给了这个回调就显示在最后，
	 * 点了直接按当前推进档位发一轮，不走输入框。
	 */
	readonly onPush?: () => void;
}

/** 回合完成后显示本楼候选：点击只把原文填进输入框，不自动发送。 */
export function CandidateActions({
	actions,
	onPick,
	onPush,
}: CandidateActionsProps) {
	const groups = useMemo(() => groupCandidateActions(actions), [actions]);
	if (groups.actions.length === 0 && groups.sceneChanges.length === 0) {
		return onPush === undefined ? null : <SelfDrivingItem onPush={onPush} />;
	}
	return (
		<section className="candidate-actions" aria-label="候选行动">
			<header className="candidate-actions-head">
				<h3>候选行动</h3>
				<span className="muted">点一条填进输入框，不会自动发送</span>
			</header>
			<div className="candidate-action-buttons">
				{groups.actions.map((action) => (
					<button
						key={action.id}
						type="button"
						className="candidate-action"
						onClick={() => onPick(action.text)}
					>
						{action.text}
					</button>
				))}
				{groups.sceneChanges.map((action) => (
					<button
						key={action.id}
						type="button"
						className="candidate-action candidate-scene-change"
						onClick={() => onPick(action.text)}
					>
						<span className="candidate-kind">场景变化</span>
						{action.text}
					</button>
				))}
				{onPush === undefined ? null : (
					<button
						type="button"
						className="candidate-action candidate-self-driving"
						onClick={onPush}
					>
						<span className="candidate-kind">推进</span>
						让故事自己走
					</button>
				)}
			</div>
		</section>
	);
}

/** 没有候选时只显示固定项，避免面板整个消失。 */
function SelfDrivingItem({ onPush }: { readonly onPush: () => void }) {
	return (
		<section className="candidate-actions" aria-label="候选行动">
			<div className="candidate-action-buttons">
				<button
					type="button"
					className="candidate-action candidate-self-driving"
					onClick={onPush}
				>
					<span className="candidate-kind">推进</span>
					让故事自己走
				</button>
			</div>
		</section>
	);
}

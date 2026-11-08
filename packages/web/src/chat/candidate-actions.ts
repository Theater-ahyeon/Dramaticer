/** 候选行动只供读取：4 条行动在前、1 条场景变化在后，顺序按 `ordinal`。 */
export interface CandidateActionItem {
	readonly id: string;
	readonly ordinal: number;
	readonly kind: "action" | "scene_change";
	readonly text: string;
}

export interface CandidateActionGroups {
	readonly actions: readonly CandidateActionItem[];
	readonly sceneChanges: readonly CandidateActionItem[];
}

/** 候选由间隙里的后台任务写入，回合刚结束时可能还没出现。 */
export const ACTION_POLL_INTERVAL_MS = 2_000;
export const ACTION_POLL_ATTEMPTS = 15;

export function groupCandidateActions(
	actions: readonly CandidateActionItem[],
): CandidateActionGroups {
	const ordered = [...actions].sort(
		(left, right) => left.ordinal - right.ordinal,
	);
	return {
		actions: ordered.filter((action) => action.kind === "action"),
		sceneChanges: ordered.filter((action) => action.kind === "scene_change"),
	};
}

/** 还没读到候选且没到次数上限时继续轮询；有候选或到达上限就停下。 */
export function shouldPollActions(
	attempt: number,
	actions: readonly CandidateActionItem[],
): boolean {
	if (actions.length > 0) return false;
	return attempt + 1 < ACTION_POLL_ATTEMPTS;
}

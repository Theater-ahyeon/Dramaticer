/** 开场候选：选中之前不是楼层，也不进入上下文。 */
export interface OpeningCandidateItem {
	readonly id: string;
	readonly ordinal: number;
	readonly raw: string;
	readonly status: string;
	readonly createdAt: string;
}

/** 手动重新生成在后台执行，界面按固定间隔轮询待选候选。 */
export const OPENING_POLL_INTERVAL_MS = 2_000;
export const OPENING_POLL_ATTEMPTS = 15;

export type OpeningPollStatus = "waiting" | "arrived" | "timeout";

/** `baselineOrdinal` 是开始轮询前见过的最大编号，用来区分新一批候选。 */
export interface OpeningPollState {
	readonly baselineOrdinal: number;
	readonly attempts: number;
	readonly status: OpeningPollStatus;
}

export interface OpeningPollResult {
	readonly state: OpeningPollState;
	/** 大于基线编号的候选，按编号从大到小。 */
	readonly fresh: readonly OpeningCandidateItem[];
}

export function maxOpeningOrdinal(
	candidates: readonly OpeningCandidateItem[],
): number {
	return candidates.reduce(
		(maximum, candidate) => Math.max(maximum, candidate.ordinal),
		0,
	);
}

export function beginOpeningPoll(
	candidates: readonly OpeningCandidateItem[],
): OpeningPollState {
	return {
		baselineOrdinal: maxOpeningOrdinal(candidates),
		attempts: 0,
		status: "waiting",
	};
}

/** 一次轮询的结果：新一批出现就结束，否则累加次数并在上限处超时。 */
export function advanceOpeningPoll(
	state: OpeningPollState,
	candidates: readonly OpeningCandidateItem[],
): OpeningPollResult {
	const fresh = candidates
		.filter((candidate) => candidate.ordinal > state.baselineOrdinal)
		.sort((left, right) => right.ordinal - left.ordinal);
	if (fresh.length > 0) {
		return { state: { ...state, status: "arrived" }, fresh };
	}
	const attempts = state.attempts + 1;
	return {
		state: {
			...state,
			attempts,
			status: attempts >= OPENING_POLL_ATTEMPTS ? "timeout" : "waiting",
		},
		fresh: [],
	};
}

export function shouldPollOpenings(state: OpeningPollState): boolean {
	return state.status === "waiting";
}

/** 新一批排在最前，旧批排在后面继续可看。 */
export function orderOpeningCandidates(
	candidates: readonly OpeningCandidateItem[],
): readonly OpeningCandidateItem[] {
	return [...candidates].sort((left, right) => right.ordinal - left.ordinal);
}

/** 第一页加载到的候选不算“新一批”：只有手动重新生成之后才标出来。 */
export function isFreshOpeningCandidate(
	candidate: OpeningCandidateItem,
	baselineOrdinal: number,
): boolean {
	return baselineOrdinal > 0 && candidate.ordinal > baselineOrdinal;
}

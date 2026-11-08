import { describe, expect, it } from "vitest";
import {
	OPENING_POLL_ATTEMPTS,
	type OpeningCandidateItem,
	advanceOpeningPoll,
	beginOpeningPoll,
	isFreshOpeningCandidate,
	maxOpeningOrdinal,
	orderOpeningCandidates,
	shouldPollOpenings,
} from "../src/chat/opening-candidates";

function candidate(ordinal: number): OpeningCandidateItem {
	return {
		id: `opening-${ordinal}`,
		ordinal,
		raw: `开场候选 ${ordinal}`,
		status: "pending",
		createdAt: `2026-01-01T00:00:${String(ordinal % 60).padStart(2, "0")}.000Z`,
	};
}

describe("开场候选批次", () => {
	it("第一页的候选不标成新一批", () => {
		expect(isFreshOpeningCandidate(candidate(3), 0)).toBe(false);
		expect(isFreshOpeningCandidate(candidate(3), 3)).toBe(false);
		expect(isFreshOpeningCandidate(candidate(4), 3)).toBe(true);
	});

	it("重新生成前的基线取当前最大编号", () => {
		expect(maxOpeningOrdinal([])).toBe(0);
		expect(beginOpeningPoll([candidate(2), candidate(5)])).toEqual({
			baselineOrdinal: 5,
			attempts: 0,
			status: "waiting",
		});
	});

	it("旧批还在时继续轮询，新批出现后结束并给出新批", () => {
		const state = beginOpeningPoll([candidate(1), candidate(2), candidate(3)]);
		const unchanged = advanceOpeningPoll(state, [
			candidate(1),
			candidate(2),
			candidate(3),
		]);
		expect(unchanged.fresh).toEqual([]);
		expect(unchanged.state.status).toBe("waiting");
		expect(unchanged.state.attempts).toBe(1);

		const arrived = advanceOpeningPoll(unchanged.state, [
			candidate(1),
			candidate(2),
			candidate(3),
			candidate(4),
			candidate(5),
			candidate(6),
		]);
		expect(arrived.state.status).toBe("arrived");
		expect(arrived.fresh.map((item) => item.ordinal)).toEqual([6, 5, 4]);
		expect(shouldPollOpenings(arrived.state)).toBe(false);
	});

	it("空故事第一次读到候选就算新一批", () => {
		const result = advanceOpeningPoll(beginOpeningPoll([]), [
			candidate(1),
			candidate(2),
		]);
		expect(result.state.status).toBe("arrived");
		expect(result.fresh.map((item) => item.ordinal)).toEqual([2, 1]);
	});

	it("到达次数上限后停止轮询", () => {
		let state = beginOpeningPoll([candidate(1)]);
		for (let attempt = 0; attempt < OPENING_POLL_ATTEMPTS; attempt += 1) {
			state = advanceOpeningPoll(state, [candidate(1)]).state;
		}
		expect(state.status).toBe("timeout");
		expect(state.attempts).toBe(OPENING_POLL_ATTEMPTS);
		expect(shouldPollOpenings(state)).toBe(false);
	});

	it("新一批排在前，旧批继续可见", () => {
		expect(
			orderOpeningCandidates([candidate(1), candidate(4), candidate(2)]).map(
				(item) => item.ordinal,
			),
		).toEqual([4, 2, 1]);
	});
});

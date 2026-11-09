import { describe, expect, it } from "vitest";
import {
	FUSION_WEIGHT_CANDIDATES,
	type QuestionRanking,
	crossValidateFusionWeights,
	enumerateFusionWeightVectors,
	scoreQuestionRankings,
	selectFusionWeights,
} from "../src/evalset/fusion-weights.js";

function chunkRoutes(): QuestionRanking["routes"] {
	const chunks = ["c1", "c2", "c3", "c4", "c5"];
	return [
		{
			route: "bm25",
			items: chunks.map((nodeId) => ({ kind: "chunk" as const, nodeId })),
		},
		{
			route: "vector",
			items: chunks.map((nodeId) => ({ kind: "chunk" as const, nodeId })),
		},
		{
			route: "event",
			items: [{ kind: "event" as const, nodeId: "e1" }],
		},
	];
}

function ranking(story: string): QuestionRanking {
	return {
		questionId: `${story}-q1`,
		kind: "event",
		evidenceNodes: ["e1"],
		routes: chunkRoutes(),
	};
}

describe("融合权重", () => {
	it("枚举每一路 0.5、1、2 的全部组合", () => {
		const vectors = enumerateFusionWeightVectors();
		expect(vectors).toHaveLength(FUSION_WEIGHT_CANDIDATES.length ** 5);
		expect(vectors).toContainEqual({
			bm25: 1,
			vector: 1,
			entity: 1,
			event: 1,
			recent: 1,
		});
	});

	it("提高事件路权重后证据楼层进入前 5", () => {
		const question = ranking("s1");
		const defaults = scoreQuestionRankings([question], {});
		expect(defaults.hitAt5).toBe(0);
		const boosted = scoreQuestionRankings([question], { event: 2 });
		expect(boosted.hitAt5).toBe(1);
		const selected = selectFusionWeights([question]);
		expect(selected.weights.event).toBe(2);
		expect(selected.score.hitAt5).toBe(1);
	});

	it("留一对话交叉验证在三个对话上都选中同一组权重", () => {
		const stories = ["s1", "s2", "s3"].map((story) => ({
			story,
			rankings: [ranking(story)],
		}));
		const validation = crossValidateFusionWeights(stories);
		expect(validation).not.toBeNull();
		expect(validation?.folds).toHaveLength(3);
		for (const fold of validation?.folds ?? []) {
			expect(fold.selectedWeights.event).toBe(2);
			expect(fold.heldOutScore.hitAt5).toBe(1);
			expect(fold.defaultHeldOutScore.hitAt5).toBe(0);
		}
		expect(validation?.improved).toBe(true);
		expect(validation?.selectedWeights.event).toBe(2);
		expect(validation?.heldOutSelectedScore.hitAt5).toBe(3);
		expect(validation?.heldOutDefaultScore.hitAt5).toBe(0);
	});

	it("少于两个对话时不做交叉验证", () => {
		expect(
			crossValidateFusionWeights([{ story: "s1", rankings: [ranking("s1")] }]),
		).toBeNull();
	});
});

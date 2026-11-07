import { describe, expect, it } from "vitest";
import {
	buildChoiceMessages,
	parseChoice,
	picksAccepted,
	renderJudgeSection,
	summarizeJudge,
	wilsonInterval,
} from "./f0-judge-lib.mjs";

function pair(overrides = {}) {
	return {
		id: "对话 1:2",
		chatLabel: "对话 1",
		floor: 2,
		depthFloor: 3,
		acceptedNotLast: false,
		context: [{ role: "user", text: "开始" }],
		acceptedText: "被保留的回复",
		rejectedText: "被放弃的回复",
		...overrides,
	};
}

function judgement(pairId, order, choice, overrides = {}) {
	return {
		key: `${pairId}|${order}`,
		pair: pairId,
		order,
		ok: true,
		choice,
		confidence: 0.8,
		picksAccepted: picksAccepted(order, choice),
		...overrides,
	};
}

describe("buildChoiceMessages", () => {
	it("两种顺序交换回复位置，且不透露哪一份被保留", () => {
		const candidate = pair();
		const first = buildChoiceMessages(candidate, "rejected-first");
		expect(first.acceptedPosition).toBe("B");
		const firstUser = first.messages[1].content;
		expect(firstUser.indexOf("回复甲：\n被放弃的回复")).toBeLessThan(
			firstUser.indexOf("回复乙：\n被保留的回复"),
		);
		expect(firstUser).not.toContain("被玩家保留");
		expect(firstUser).not.toContain("被玩家放弃");

		const second = buildChoiceMessages(candidate, "accepted-first");
		expect(second.acceptedPosition).toBe("A");
		const secondUser = second.messages[1].content;
		expect(secondUser.indexOf("回复甲：\n被保留的回复")).toBeLessThan(
			secondUser.indexOf("回复乙：\n被放弃的回复"),
		);
	});

	it("未知顺序或缺少正文时直接抛错", () => {
		expect(() => buildChoiceMessages(pair(), "left-first")).toThrow(
			"未知的裁判顺序",
		);
		expect(() =>
			buildChoiceMessages(pair({ acceptedText: undefined }), "rejected-first"),
		).toThrow("缺少回复正文");
	});
});

describe("parseChoice", () => {
	it("接受纯 JSON 与代码围栏里的 JSON", () => {
		expect(parseChoice('{"choice": "A", "confidence": 0.6}')).toEqual({
			choice: "A",
			confidence: 0.6,
		});
		expect(
			parseChoice('```json\n{"choice": "B", "confidence": 1}\n```'),
		).toEqual({ choice: "B", confidence: 1 });
		expect(
			parseChoice('判断如下：{"choice": "B", "confidence": 0.5} 完毕'),
		).toEqual({ choice: "B", confidence: 0.5 });
	});

	it("拒绝小写选项、越界置信度与缺失字段", () => {
		expect(() => parseChoice('{"choice": "a", "confidence": 0.5}')).toThrow(
			"choice 不合法",
		);
		expect(() => parseChoice('{"choice": "A", "confidence": 1.5}')).toThrow(
			"confidence",
		);
		expect(() => parseChoice('{"choice": "A"}')).toThrow("confidence");
		expect(() => parseChoice("没有 JSON")).toThrow("找不到 JSON 对象");
	});
});

describe("picksAccepted", () => {
	it("按顺序把位置映射回被保留的回复", () => {
		expect(picksAccepted("rejected-first", "B")).toBe(true);
		expect(picksAccepted("rejected-first", "A")).toBe(false);
		expect(picksAccepted("accepted-first", "A")).toBe(true);
		expect(picksAccepted("accepted-first", "B")).toBe(false);
		expect(() => picksAccepted("accepted-first", "C")).toThrow("choice 不合法");
	});
});

describe("wilsonInterval", () => {
	it("给出 50/100 的 95% 区间", () => {
		const interval = wilsonInterval(50, 100);
		expect(interval.low).toBeCloseTo(0.4038, 4);
		expect(interval.high).toBeCloseTo(0.5962, 4);
	});

	it("没有判断时返回 null", () => {
		expect(wilsonInterval(0, 0)).toBeNull();
	});

	it("非法计数直接抛错", () => {
		expect(() => wilsonInterval(5, 3)).toThrow("successes");
		expect(() => wilsonInterval(0, -1)).toThrow("total");
	});
});

describe("summarizeJudge", () => {
	const pairs = [
		pair({ id: "对话 1:2", acceptedNotLast: false, depthFloor: 3 }),
		pair({ id: "对话 2:5", acceptedNotLast: true, depthFloor: 20 }),
		pair({ id: "对话 3:9", acceptedNotLast: false, depthFloor: 60 }),
		pair({ id: "对话 4:1", acceptedNotLast: true, depthFloor: 4 }),
	];
	const attribution = new Map([
		["对话 1:2", { alternativeOnly: true }],
		["对话 2:5", { alternativeOnly: false }],
		["对话 3:9", { alternativeOnly: false }],
		["对话 4:1", { alternativeOnly: true }],
	]);
	const results = [
		judgement("对话 1:2", "rejected-first", "B"),
		judgement("对话 1:2", "accepted-first", "A"),
		judgement("对话 2:5", "rejected-first", "A"),
		judgement("对话 2:5", "accepted-first", "A"),
		judgement("对话 3:9", "rejected-first", "A"),
		judgement("对话 3:9", "accepted-first", "B", { ok: false }),
		judgement("对话 4:1", "rejected-first", "B"),
		judgement("对话 4:1", "accepted-first", "B"),
	];

	it("统计合并一致率、位置偏差与换序一致率", () => {
		const summary = summarizeJudge(pairs, results, attribution);
		expect(summary.pairs).toBe(4);
		expect(summary.judgements.judgements).toBe(7);
		expect(summary.judgements.accepted).toBe(4);
		expect(summary.judgements.agreement).toBeCloseTo(4 / 7, 6);
		expect(summary.judgements.positionA).toBe(4);
		expect(summary.judgements.positionDeviation).toBeCloseTo(4 / 7 - 0.5, 6);
		expect(summary.consistency.pairs).toBe(3);
		expect(summary.consistency.consistent).toBe(1);
		expect(summary.thresholds.agreementPassed).toBe(false);
		expect(summary.thresholds.positionPassed).toBe(true);
		expect(summary.thresholds.passed).toBe(false);
	});

	it("按顺序、分层与偏差标记分组", () => {
		const summary = summarizeJudge(pairs, results, attribution);
		const byLabel = new Map(summary.groups.map((entry) => [entry.label, entry]));
		expect(byLabel.get("全部样本").judgements).toBe(7);
		expect(byLabel.get("1–10 楼").judgements).toBe(4);
		expect(byLabel.get("11–50 楼").judgements).toBe(2);
		expect(byLabel.get("51 楼以上").judgements).toBe(1);
		expect(byLabel.get("被接受的是最后一条 swipe").judgements).toBe(3);
		expect(byLabel.get("被接受的不是最后一条").judgements).toBe(4);
		expect(byLabel.get("归因为另一种可行写法").judgements).toBe(4);
		expect(byLabel.get("归因不是另一种可行写法").judgements).toBe(3);
		const rejectedFirst = summary.perOrder.find(
			(entry) => entry.order === "rejected-first",
		);
		expect(rejectedFirst.judgements).toBe(4);
		expect(rejectedFirst.accepted).toBe(2);
	});

	it("同一配对同一顺序只取最后一行", () => {
		const summary = summarizeJudge(
			[pair({ id: "对话 1:2" })],
			[
				judgement("对话 1:2", "rejected-first", "A"),
				judgement("对话 1:2", "rejected-first", "B"),
			],
			attribution,
		);
		expect(summary.judgements.judgements).toBe(1);
		expect(summary.judgements.accepted).toBe(1);
	});

	it("缺少判断的配对不计入分组", () => {
		const summary = summarizeJudge(
			pairs,
			results.filter((entry) => entry.pair === "对话 1:2"),
			attribution,
		);
		const byLabel = new Map(summary.groups.map((entry) => [entry.label, entry]));
		expect(byLabel.get("11–50 楼")).toBeUndefined();
		expect(byLabel.get("全部样本").judgedPairs).toBe(1);
	});
});

describe("renderJudgeSection", () => {
	const meta = {
		generatedAt: "2026-11-07T00:00:00.000Z",
		modelId: "opendesign/deepseek-v4.1-flash",
		availablePairs: 285,
		sampleStats: [
			{ label: "1–10 楼", target: 70, available: 160, picked: 70 },
			{ label: "11–50 楼", target: 60, available: 60, picked: 60 },
			{ label: "51 楼以上", target: 70, available: 65, picked: 65 },
		],
		runStats: { calls: 390, requests: 380, cacheHits: 10, retries: 2 },
		usage: { promptTokens: 1, completionTokens: 2, reasoningTokens: 3 },
		failedJudgements: 2,
	};

	it("未达到门槛时写明偏好改用玩家选择数据", () => {
		const summary = summarizeJudge([pair()], [], new Map());
		summary.judgements = {
			...summary.judgements,
			judgements: 2,
			accepted: 1,
			agreement: 0.5,
			agreementInterval: wilsonInterval(1, 2),
			positionA: 1,
			positionAShare: 0.5,
			positionAInterval: wilsonInterval(1, 2),
			positionDeviation: 0,
		};
		summary.thresholds = {
			agreement: 0.65,
			positionBias: 0.1,
			agreementPassed: false,
			positionPassed: true,
			passed: false,
		};
		const section = renderJudgeSection({ summary, meta });
		expect(section).toContain("一致率未达到门槛");
		expect(section).toContain("偏好判断改用玩家的选择数据");
		expect(section).toContain("这是同模型自评");
		expect(section).toContain("opendesign/deepseek-v4.1-flash");
	});

	it("达到门槛时写明裁判可以用于偏好判断", () => {
		const summary = summarizeJudge(
			[pair()],
			[
				judgement("对话 1:2", "rejected-first", "B"),
				judgement("对话 1:2", "accepted-first", "A"),
			],
			new Map(),
		);
		const section = renderJudgeSection({ summary, meta });
		expect(section).toContain("可以用于偏好判断");
		expect(section).toContain("这是同模型自评");
	});
});

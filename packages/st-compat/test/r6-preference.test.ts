import { createHash as hash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type LlmClient,
	type LlmResult,
	StoryStore as StoryStoreClass,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import type {
	PairwiseOrder,
	PairwiseTask,
	PreferenceComparisonRecord,
} from "../src/evalset/pairwise.js";
import {
	R6_PREFERENCE_FORMAT,
	formatR6PreferenceReport,
	loadR6PreferencePairs,
	planR6PreferenceSamples,
	preferencePairOutcome,
	r6PreferenceGateInput,
	runR6Preference,
	summarizeR6Preference,
} from "../src/evalset/r6-preference.js";
import type { PreferencePair } from "../src/preferences/export.js";

const STORY = "r6-preference-test";
const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 200,
		});
	}
});

function makeDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "r6-preference-"));
	createdDirs.push(dir);
	return dir;
}

function doneRecord(input: {
	readonly sampleId: string;
	readonly order: PairwiseOrder;
	readonly winner: "A" | "B" | "tie";
	readonly kind?: PairwiseTask;
}): PreferenceComparisonRecord {
	return {
		sampleId: input.sampleId,
		storyId: STORY,
		kind: input.kind ?? "reroll",
		earlierSwipe: false,
		order: input.order,
		attempts: 1,
		usage: null,
		model: "fake-judge",
		createdAt: "2026-01-01T00:00:00.000Z",
		status: "done",
		winner: input.winner,
		reason: "测试判定",
		error: null,
	};
}

function failedRecord(input: {
	readonly sampleId: string;
	readonly order: PairwiseOrder;
}): PreferenceComparisonRecord {
	return {
		sampleId: input.sampleId,
		storyId: STORY,
		kind: "reroll",
		earlierSwipe: false,
		order: input.order,
		attempts: 3,
		usage: null,
		model: "fake-judge",
		createdAt: "2026-01-01T00:00:00.000Z",
		status: "failed",
		winner: null,
		reason: null,
		error: "裁判连续三次没有输出合法 JSON",
	};
}

function sample(sampleId: string, kind: PairwiseTask = "reroll") {
	return { sampleId, storyId: STORY, kind };
}

describe("r6-preference", () => {
	it("两种顺序的结论换算成一致、不一致、平与换序不一致", () => {
		const samples = [sample("s1"), sample("s2"), sample("s3"), sample("s4")];
		const records = [
			doneRecord({ sampleId: "s1", order: "accepted-first", winner: "A" }),
			doneRecord({ sampleId: "s1", order: "abandoned-first", winner: "B" }),
			doneRecord({ sampleId: "s2", order: "accepted-first", winner: "B" }),
			doneRecord({ sampleId: "s2", order: "abandoned-first", winner: "A" }),
			doneRecord({ sampleId: "s3", order: "accepted-first", winner: "tie" }),
			doneRecord({ sampleId: "s3", order: "abandoned-first", winner: "tie" }),
			doneRecord({ sampleId: "s4", order: "accepted-first", winner: "A" }),
			doneRecord({ sampleId: "s4", order: "abandoned-first", winner: "A" }),
		];
		const summary = summarizeR6Preference({
			samples,
			records,
			judgeModel: "fake-judge",
		});
		expect(summary.plannedPairs).toBe(4);
		expect(summary.completedPairs).toBe(4);
		expect(summary.accepted).toBe(1);
		expect(summary.abandoned).toBe(1);
		expect(summary.ties).toBe(1);
		expect(summary.inconsistent).toBe(1);
		expect(summary.failures).toBe(0);
		expect(summary.consistency).toBe(0.25);
		expect(summary.wilson?.rate).toBe(0.25);
		expect(summary.insufficient).toBe(true);
		expect(summary.insufficientReason).toContain("未证实");
		expect(r6PreferenceGateInput(summary)).toEqual({
			accepted: 1,
			abandoned: 1,
			ties: 1,
			inconsistent: 1,
			failures: 0,
		});
		expect(preferencePairOutcome("tie", "accepted")).toBe("inconsistent");
		expect(preferencePairOutcome(null, "accepted")).toBeNull();

		const markdown = formatR6PreferenceReport({
			format: R6_PREFERENCE_FORMAT,
			gateVersion: "v1",
			generatedAt: "2026-01-01T00:00:00.000Z",
			pairsSources: [],
			samples: [],
			records: [],
			summary,
		});
		expect(markdown).toContain("R6 偏好一致率（G6）");
		expect(markdown).toContain("一致 1、不一致 1、平 1、换序不一致 1");
		expect(markdown).toContain("25.0%");
		expect(markdown).toContain("未证实");
		expect(markdown).not.toContain("s1");
	});

	it("完成配对少于 30 对时返回未证实，一致率仍然给出", () => {
		const samples = [sample("s1"), sample("s2")];
		const records = [
			doneRecord({ sampleId: "s1", order: "accepted-first", winner: "A" }),
			doneRecord({ sampleId: "s1", order: "abandoned-first", winner: "B" }),
			doneRecord({ sampleId: "s2", order: "accepted-first", winner: "A" }),
			doneRecord({ sampleId: "s2", order: "abandoned-first", winner: "B" }),
		];
		const summary = summarizeR6Preference({
			samples,
			records,
			judgeModel: "fake-judge",
		});
		expect(summary.completedPairs).toBe(2);
		expect(summary.consistency).toBe(1);
		expect(summary.wilson?.lower).toBeLessThan(1);
		expect(summary.insufficient).toBe(true);
		expect(summary.insufficientReason).toContain("30");
		expect(r6PreferenceGateInput(summary)).toMatchObject({
			accepted: 2,
			failures: 0,
		});
	});

	it("判定失败与缺少顺序的样本计入失败，不进入一致率分母", () => {
		const samples = [sample("s1"), sample("s2")];
		const records = [
			doneRecord({ sampleId: "s1", order: "accepted-first", winner: "A" }),
			failedRecord({ sampleId: "s1", order: "abandoned-first" }),
			doneRecord({ sampleId: "s2", order: "accepted-first", winner: "A" }),
			doneRecord({ sampleId: "s2", order: "abandoned-first", winner: "B" }),
		];
		const summary = summarizeR6Preference({
			samples,
			records,
			judgeModel: "fake-judge",
		});
		expect(summary.completedPairs).toBe(1);
		expect(summary.failures).toBe(1);
		expect(summary.consistency).toBe(1);
		expect(summary.judgementsCompleted).toBe(3);
		expect(summary.judgementsFailed).toBe(1);
		expect(summary.judgeFailureShare).toBe(0.25);
		const markdown = formatR6PreferenceReport({
			format: R6_PREFERENCE_FORMAT,
			gateVersion: "v1",
			generatedAt: "2026-01-01T00:00:00.000Z",
			pairsSources: [],
			samples: [],
			records: [],
			summary,
		});
		expect(markdown).toContain("判定失败 1/4");
		expect(markdown).toContain("失败 1");
	});

	it("记录不属于当前样本时直接失败", () => {
		expect(() =>
			summarizeR6Preference({
				samples: [sample("s1")],
				records: [
					doneRecord({ sampleId: "s2", order: "accepted-first", winner: "A" }),
				],
				judgeModel: "fake-judge",
			}),
		).toThrow(/不属于当前样本/);
	});

	it("回复对缺失、目录为空、楼层不存在时直接失败", () => {
		const dir = makeDir();
		expect(() => loadR6PreferencePairs(path.join(dir, "missing"))).toThrow(
			/不存在/,
		);
		const empty = path.join(dir, "empty");
		mkdirSync(empty);
		expect(() => loadR6PreferencePairs(empty)).toThrow(/没有 .pairs.jsonl/);

		const { dbPath, pairsDir } = buildSourceDb(dir);
		const store = StoryStoreClass.open(dbPath);
		try {
			const pairs = loadR6PreferencePairs(pairsDir);
			expect(() =>
				planR6PreferenceSamples(store, [
					{
						...pairs[0],
						accepted: { nodeId: "missing-node", text: "接受版本" },
					} as PreferencePair,
				]),
			).toThrow(/引用的楼层不存在/);
		} finally {
			store.close();
		}
		expect(() => loadR6PreferencePairs(pairsDir, "other-story")).toThrow(
			/没有故事 other-story 的回复对/,
		);
	});

	it("按两种顺序跑完并写入记录，续跑不再调用裁判", async () => {
		const dir = makeDir();
		const { dbPath, pairsDir } = buildSourceDb(dir);
		const before = hash("sha256").update(readFileSync(dbPath)).digest("hex");
		const judge = fakeJudge();
		const runDir = path.join(dir, "run");
		const first = await runR6Preference({
			sourceDbPath: dbPath,
			pairsPath: pairsDir,
			dir: runDir,
			judge: { client: judge.client, model: "fake-judge" },
			now: () => new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(first.format).toBe(R6_PREFERENCE_FORMAT);
		expect(first.gateVersion).toBe("v1");
		expect(first.summary.plannedPairs).toBe(1);
		expect(first.summary.completedPairs).toBe(1);
		expect(first.summary.accepted).toBe(1);
		expect(first.summary.consistency).toBe(1);
		expect(first.summary.insufficient).toBe(true);
		expect(judge.stats.calls).toBe(2);
		const recordsText = readFileSync(
			path.join(runDir, "records.jsonl"),
			"utf8",
		);
		expect(recordsText.trim().split("\n")).toHaveLength(2);

		const failing = fakeJudge({ fail: true });
		const second = await runR6Preference({
			sourceDbPath: dbPath,
			pairsPath: pairsDir,
			dir: runDir,
			judge: { client: failing.client, model: "fake-judge" },
			now: () => new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(failing.stats.calls).toBe(0);
		expect(second.records).toEqual(first.records);
		expect(second.summary).toEqual(first.summary);
		const after = hash("sha256").update(readFileSync(dbPath)).digest("hex");
		expect(after).toBe(before);
	});
});

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function makeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function joined(request: LlmRequest): string {
	return request.messages.map((message) => message.content).join("\n");
}

function fakeJudge(options: { readonly fail?: boolean } = {}): {
	readonly client: LlmClient;
	readonly stats: { calls: number };
} {
	const stats = { calls: 0 };
	return {
		stats,
		client: {
			async complete(request) {
				stats.calls += 1;
				if (options.fail === true) throw new Error("裁判不可用");
				const content = request.messages
					.map((message) => message.content)
					.join("\n");
				const firstLabel = content.indexOf("回复甲：");
				const secondLabel = content.indexOf("回复乙：");
				const first =
					firstLabel === -1
						? ""
						: content.slice(
								firstLabel,
								secondLabel === -1 ? undefined : secondLabel,
							);
				const second = secondLabel === -1 ? "" : content.slice(secondLabel);
				const winner = first.includes("接受版本")
					? "A"
					: second.includes("接受版本")
						? "B"
						: "tie";
				return makeResult(JSON.stringify({ winner, reason: "测试判定" }));
			},
		},
	};
}

function buildSourceDb(dir: string): {
	readonly dbPath: string;
	readonly pairsDir: string;
} {
	const dbPath = path.join(dir, "source.db");
	const store = StoryStoreClass.open(dbPath);
	let acceptedId: string;
	let abandonedId: string;
	let userNodeId: string;
	try {
		store.createStory({ id: STORY, title: "R6 Preference" });
		const user = store.appendNode({
			storyId: STORY,
			parentId: null,
			role: "user",
			raw: "我走进客栈，四下张望。",
		});
		userNodeId = user.id;
		const abandoned = store.appendNode({
			storyId: STORY,
			parentId: user.id,
			role: "assistant",
			raw: "放弃版本：剑客继续喝茶，没有抬头。",
		});
		const accepted = store.appendNode({
			storyId: STORY,
			parentId: user.id,
			role: "assistant",
			raw: "接受版本：剑客站起身，手指按在刀柄上。",
		});
		acceptedId = accepted.id;
		abandonedId = abandoned.id;
		store.setHead(STORY, accepted.id);
	} finally {
		store.close();
	}
	const pair: PreferencePair = {
		storyId: STORY,
		kind: "reroll",
		sourceEventId: "event-1",
		anchorNodeId: userNodeId,
		createdAt: "2026-01-01T00:00:02.000Z",
		accepted: {
			nodeId: acceptedId,
			text: "接受版本：剑客站起身，手指按在刀柄上。",
		},
		abandoned: {
			nodeId: abandonedId,
			text: "放弃版本：剑客继续喝茶，没有抬头。",
		},
	};
	const pairsDir = path.join(dir, "pairs");
	mkdirSync(pairsDir, { recursive: true });
	writeFileSync(
		path.join(pairsDir, `${STORY}.pairs.jsonl`),
		`${JSON.stringify(pair)}\n`,
		"utf8",
	);
	return { dbPath, pairsDir };
}

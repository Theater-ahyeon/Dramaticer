import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmResult,
	type LlmStreamingClient,
	type StoryStore,
	StoryStore as StoryStoreClass,
	type TimelineNode,
	type TurnTrace,
	createDefaultContextTemplate,
	createEventStream,
} from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import { parseCharacterCardFile } from "../src/character-card.js";
import {
	measureBeatCosine,
	measureBlockRepetition,
	noteMatchesReply,
	selectBranchPoints,
	summarize,
} from "../src/evalset/director-eval.js";
import {
	type ReplayGenerator,
	createChatReplayGenerator,
	directorMechanismFromTrace,
	runDirectorReplay,
} from "../src/evalset/director-replay.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/", import.meta.url));

function node(
	id: string,
	role: TimelineNode["role"],
	raw: string,
	parentId: string | null = null,
): TimelineNode {
	return {
		id,
		storyId: "s1",
		parentId,
		role,
		raw,
		createdAt: "2026-11-07T00:00:00.000Z",
	};
}

function emptyTrace(nodeId: string): TurnTrace {
	return {
		storyId: "s1",
		nodeId,
		parentNodeId: null,
		templateId: "test",
		createdAt: "2026-11-07T00:00:00.000Z",
		context: { budgetTokens: 1000, totalTokens: 0, entries: [] },
		llm: {
			model: "fake",
			channel: "fake",
			stopReason: "stop",
			finishReason: "stop",
			truncations: [],
			usage: {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				reasoningTokens: 0,
				cachedTokens: 0,
			},
			attempts: 1,
			rounds: 1,
			cached: false,
		},
		tools: { rounds: 0, calls: [] },
		structured: {
			mode: "text-tags",
			acceptedStateUpdates: 0,
			acceptedNotes: 0,
			issues: [],
		},
		timing: { firstTokenMs: 1, durationMs: 1 },
	};
}

function appendPair(
	store: StoryStore,
	storyId: string,
	userText: string,
	reply: string,
): { userNodeId: string; assistantNodeId: string } {
	const head = store.getHead(storyId);
	const user = store.appendNode({
		storyId,
		parentId: head?.id ?? null,
		role: "user",
		raw: userText,
	});
	const assistant = store.appendNode({
		storyId,
		parentId: user.id,
		role: "assistant",
		raw: reply,
	});
	return { userNodeId: user.id, assistantNodeId: assistant.id };
}

describe("selectBranchPoints", () => {
	it("按固定间隔取已确认助手楼层，并收集后续真实用户消息", () => {
		const path = [
			node("a0", "assistant", "开场"),
			node("u1", "user", "一"),
			node("a2", "assistant", "回复一"),
			node("u3", "user", "二"),
			node("a4", "assistant", "回复二"),
			node("u5", "user", "三"),
			node("a6", "assistant", "回复三"),
			node("u7", "user", "四"),
		];
		const points = selectBranchPoints(path, {
			interval: 2,
			rounds: 2,
			maxBranchPointsPerStory: 1,
		});
		expect(points).toEqual([
			{ nodeId: "a2", floor: 3, userTexts: ["二", "三"] },
		]);
	});

	it("后面用户消息不足时跳过该分支点", () => {
		const path = [
			node("a0", "assistant", "开场"),
			node("u1", "user", "一"),
			node("a2", "assistant", "回复一"),
			node("u3", "user", "二"),
		];
		const points = selectBranchPoints(path, {
			interval: 2,
			rounds: 2,
			maxBranchPointsPerStory: 3,
		});
		expect(points).toEqual([]);
	});
});

describe("runDirectorReplay", () => {
	it("顺序调用生成器，校验楼层归属并保留每轮结果", async () => {
		const store = StoryStoreClass.open(":memory:");
		store.createStory({ id: "s1", title: "回放" });
		store.appendNode({
			id: "n-greeting",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "雨夜。",
		});
		const generated: string[] = [];
		const after: string[] = [];
		const generate: ReplayGenerator = async (input) => {
			generated.push(input.userText);
			const pair = appendPair(
				input.store,
				input.storyId,
				input.userText,
				`回复：${input.userText}`,
			);
			return {
				...pair,
				notes: [],
				trace: emptyTrace(pair.assistantNodeId),
			};
		};
		const outcome = await runDirectorReplay({
			store,
			storyId: "s1",
			userTexts: ["走进雨里。", "抬头看天。"],
			generate,
			afterTurn: (turn) => {
				after.push(turn.reply);
			},
		});
		expect(generated).toEqual(["走进雨里。", "抬头看天。"]);
		expect(outcome.turns).toHaveLength(2);
		expect(outcome.turns[0]?.round).toBe(1);
		expect(outcome.turns[1]?.reply).toBe("回复：抬头看天。");
		expect(after).toEqual(["回复：走进雨里。", "回复：抬头看天。"]);
		expect(store.getPathToHead("s1").map((item) => item.role)).toEqual([
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
		]);
	});

	it("生成器把助手楼层挂到别的用户楼层时抛错", async () => {
		const store = StoryStoreClass.open(":memory:");
		store.createStory({ id: "s1", title: "回放" });
		store.appendNode({
			id: "n-greeting",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "雨夜。",
		});
		const generate: ReplayGenerator = async (input) => {
			const user = input.store.appendNode({
				storyId: input.storyId,
				parentId: input.store.getHead(input.storyId)?.id ?? null,
				role: "user",
				raw: input.userText,
			});
			const assistant = input.store.appendNode({
				storyId: input.storyId,
				parentId: "n-greeting",
				role: "assistant",
				raw: "错位的回复",
			});
			return {
				userNodeId: user.id,
				assistantNodeId: assistant.id,
				notes: [],
				trace: emptyTrace(assistant.id),
			};
		};
		await expect(
			runDirectorReplay({
				store,
				storyId: "s1",
				userTexts: ["走。"],
				generate,
			}),
		).rejects.toThrow("父节点不是用户楼层");
	});
});

describe("director eval metrics", () => {
	it("相邻块 Jaccard 对相同正文给 1，对不同正文给 0", () => {
		const same = measureBlockRepetition(["同样的句子。", "同样的句子。"]);
		expect(same.blockCount).toBe(2);
		expect(same.values).toHaveLength(1);
		expect(same.summary.mean).toBe(1);
		const different = measureBlockRepetition(["甲甲甲甲。", "乙乙乙乙。"]);
		expect(different.summary.mean).toBe(0);
	});

	it("节拍余弦按块向量平均计算，缺少向量的楼层被跳过", () => {
		const store = StoryStoreClass.open(":memory:", {
			embeddingDimensions: 2,
		});
		store.createStory({ id: "s1", title: "回放" });
		const first = store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "第一段。",
		});
		const second = store.appendNode({
			storyId: "s1",
			parentId: first.id,
			role: "assistant",
			raw: "第二段。",
		});
		const third = store.appendNode({
			storyId: "s1",
			parentId: second.id,
			role: "assistant",
			raw: "第三段。",
		});
		insertVectors(store, first.id, [1, 0]);
		insertVectors(store, second.id, [0, 1]);
		const measurement = measureBeatCosine(store, [
			first.id,
			second.id,
			third.id,
		]);
		expect(measurement.missingVectorFloors).toBe(1);
		expect(measurement.values).toHaveLength(1);
		expect(measurement.summary.mean).toBeCloseTo(0, 10);
	});

	it("线索兑现按笔记正文的连续字符匹配", () => {
		const reply = "他沿着石阶走进古井旁，取出了青铜匕首。";
		expect(noteMatchesReply("青铜匕首藏在古井里", reply)).toBe(true);
		expect(noteMatchesReply("王城的密道", reply)).toBe(false);
		expect(noteMatchesReply("井", reply)).toBe(false);
	});

	it("空样本的汇总全为 0", () => {
		expect(summarize([])).toEqual({
			count: 0,
			mean: 0,
			median: 0,
			p90: 0,
			p95: 0,
			p99: 0,
			max: 0,
		});
	});
});

function insertVectors(
	store: StoryStore,
	nodeId: string,
	vector: readonly number[],
): void {
	const chunks = store.listChunksMissingVectors(nodeId);
	expect(chunks.length).toBeGreaterThan(0);
	store.insertChunkVectors(
		chunks.map((chunk) => ({ chunkId: chunk.chunkId, embedding: vector })),
	);
}

describe("createChatReplayGenerator 与导演开关", () => {
	it("开启时写入决策并注入导演消息，关闭时两者都没有", async () => {
		const card = await parseCharacterCardFile(
			path.join(fixturesPath, "chat-card.json"),
		);
		const onStore = seedDirectorStory();
		const onClient = fakeClient("他沿着石阶走进雨里。");
		const onGenerator = createChatReplayGenerator({
			card,
			client: onClient,
			template: template(),
			structuredOutput: "text-tags",
			budgetTokens: 8_000,
			directorConfig: {
				...DEFAULT_DIRECTOR_CONFIG,
				clueAgeWarning: 0,
			},
			model: "fake",
		});
		const onOutcome = await runDirectorReplay({
			store: onStore,
			storyId: "s1",
			userTexts: ["我走向古井。"],
			generate: onGenerator,
		});
		const onTurn = onOutcome.turns[0];
		expect(onTurn?.directorSelected).toBe("clue");
		const onDecision = onStore.getDirectorDecision(onTurn?.userNodeId ?? "");
		expect(onDecision).not.toBeNull();
		expect(
			onDecision?.mechanisms.find((record) => record.name === "clue")
				?.triggered,
		).toBe(true);
		expect(directorMechanismFromTrace(onTurn?.trace as TurnTrace)).toBe("clue");

		const offStore = seedDirectorStory();
		const offClient = fakeClient("他沿着石阶走进雨里。");
		const offGenerator = createChatReplayGenerator({
			card,
			client: offClient,
			template: template(),
			structuredOutput: "text-tags",
			budgetTokens: 8_000,
			directorConfig: {
				...DEFAULT_DIRECTOR_CONFIG,
				enabled: false,
				clueAgeWarning: 0,
			},
			model: "fake",
		});
		const offOutcome = await runDirectorReplay({
			store: offStore,
			storyId: "s1",
			userTexts: ["我走向古井。"],
			generate: offGenerator,
		});
		const offTurn = offOutcome.turns[0];
		expect(offTurn?.directorSelected).toBeNull();
		expect(offStore.getDirectorDecision(offTurn?.userNodeId ?? "")).toBeNull();
	});
});

function seedDirectorStory(): StoryStore {
	const store = StoryStoreClass.open(":memory:");
	store.createStory({ id: "s1", title: "回放" });
	store.appendNode({
		id: "n-greeting",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "雨夜，古井旁。",
	});
	store.insertPlotNotes([
		{
			storyId: "s1",
			sourceNodeId: "n-greeting",
			text: "青铜匕首藏在古井里",
		},
	]);
	return store;
}

function template() {
	return createDefaultContextTemplate({ structuredOutput: "text-tags" });
}

function fakeClient(reply: string): LlmStreamingClient {
	const result: LlmResult = {
		text: reply,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: {
			promptTokens: 5,
			completionTokens: 6,
			totalTokens: 11,
			reasoningTokens: 0,
			cachedTokens: 0,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: { text: reply, reasoning: "" },
	};
	return {
		async complete() {
			return result;
		},
		stream() {
			return createEventStream(async (emit) => {
				for (const char of reply) {
					emit({ type: "text_delta", delta: char });
				}
				return result;
			});
		},
	};
}

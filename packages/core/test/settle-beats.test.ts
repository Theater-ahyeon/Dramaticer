import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type DirectorPlan,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createSettleHandler,
	explainNode,
	renderExplainReport,
	replaceDirectorPlan,
	resolveCurrentBeat,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

const PLAN: DirectorPlan = {
	arcs: [
		{
			id: "arc-1",
			title: "开学",
			throughLine: "凛必须说出真相",
			difficulty: 0.4,
			redLines: [],
			sequences: [
				{
					id: "seq-1",
					title: "相遇",
					beats: [
						{
							id: "beat-1",
							goal: "确认来意",
							entrySigns: ["凛堵在门口"],
							fitPoints: ["凛盯着你"],
						},
						{
							id: "beat-2",
							goal: "让凛松口",
							entrySigns: ["凛移开视线"],
							fitPoints: ["你提到旧事"],
						},
					],
				},
			],
		},
	],
};

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

/** 假客户端：记录请求，按脚本返回文本；脚本用完后再调用直接失败。 */
function createFakeClient(replies: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmClient = {
		async complete(request) {
			requests.push(request);
			const reply = replies[requests.length - 1];
			if (reply === undefined) {
				throw new Error("假客户端没有更多回复");
			}
			return llmResult(reply);
		},
	};
	return { client, requests };
}

/** 开场助手楼、两轮对阵；head 停在 a2。 */
function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "落拍测试" });
	store.appendNode({
		id: "a0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a0",
		role: "user",
		raw: "我走进教室。",
	});
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "凛堵在门口。",
	});
	store.appendNode({
		id: "u2",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我问她为什么。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u2",
		role: "assistant",
		raw: "凛移开视线，说出了来意。",
	});
}

function jobFor(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: "settle",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: new Date(FIXED_NOW).toISOString(),
		startedAt: new Date(FIXED_NOW).toISOString(),
		finishedAt: null,
	};
}

describe("结算落拍检测", () => {
	it("模型报告完成的楼层写入拍状态，并在下一轮解析出下一拍", async () => {
		const { store } = openTempStore();
		seedStory(store);
		replaceDirectorPlan(store, "s1", PLAN);
		const { client, requests } = createFakeClient([
			JSON.stringify([
				{ nodeId: "a1", diffs: [], beatCompleted: false },
				{ nodeId: "a2", diffs: [], beatCompleted: true },
			]),
		]);

		await createSettleHandler()({ store, client, job: jobFor("a2") });

		expect(requests).toHaveLength(1);
		const system = requests[0]?.messages[0]?.content ?? "";
		const user = requests[0]?.messages[1]?.content ?? "";
		expect(system).toContain("beatCompleted");
		expect(user).toContain("当前拍：beat-1（目标：确认来意）");
		expect(store.getDirectorBeatState("a1")).toMatchObject({
			beatId: "beat-1",
			completed: false,
		});
		expect(store.getDirectorBeatState("a2")).toMatchObject({
			beatId: "beat-1",
			completed: true,
		});
		expect(resolveCurrentBeat(store, "s1", "a2")?.beat.id).toBe("beat-2");
	}, 30000);

	it("缺少 beatCompleted 字段时按未完成处理，不推进", async () => {
		const { store } = openTempStore();
		seedStory(store);
		replaceDirectorPlan(store, "s1", PLAN);
		const { client } = createFakeClient([
			JSON.stringify([{ nodeId: "a2", diffs: [] }]),
		]);

		await createSettleHandler()({ store, client, job: jobFor("a2") });

		expect(store.getDirectorBeatState("a2")).toMatchObject({
			beatId: "beat-1",
			completed: false,
		});
		expect(resolveCurrentBeat(store, "s1", "a2")?.beat.id).toBe("beat-1");
	}, 30000);

	it("beatCompleted 类型非法时整楼层拒绝并记入修复，不写拍状态", async () => {
		const { store } = openTempStore();
		seedStory(store);
		replaceDirectorPlan(store, "s1", PLAN);
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["clue", "c1", "status"],
							op: "set",
							value: "open",
							confidence: 0.8,
						},
					],
					beatCompleted: "yes",
				},
			]),
		]);

		await createSettleHandler()({ store, client, job: jobFor("a2") });

		expect(store.getStateDiffs("a2")).toEqual([]);
		expect(store.getDirectorBeatState("a2")).toBeNull();
		const settlement = store.getLedgerSettlement("a2");
		expect(settlement).toMatchObject({ source: "settler", addedCount: 0 });
		expect(
			settlement?.repairs.some((repair) =>
				repair.reason.includes("beatCompleted 必须是布尔值"),
			),
		).toBe(true);
	}, 30000);

	it("没有计划时不写拍状态，提示词也不提 beatCompleted", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client, requests } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["clue", "c1", "status"],
							op: "set",
							value: "open",
							confidence: 0.8,
						},
					],
				},
			]),
		]);

		await createSettleHandler()({ store, client, job: jobFor("a2") });

		const system = requests[0]?.messages[0]?.content ?? "";
		const user = requests[0]?.messages[1]?.content ?? "";
		expect(system).not.toContain("beatCompleted");
		expect(user).not.toContain("当前拍");
		expect(store.getDirectorBeatState("a2")).toBeNull();
		expect(store.getStateDiffs("a2")).toHaveLength(1);
	}, 30000);

	it("另一分支的完成记录不参与当前路径", async () => {
		const { store } = openTempStore();
		seedStory(store);
		replaceDirectorPlan(store, "s1", PLAN);
		const first = createFakeClient([
			JSON.stringify([
				{ nodeId: "a1", diffs: [], beatCompleted: false },
				{ nodeId: "a2", diffs: [], beatCompleted: true },
			]),
		]);
		await createSettleHandler()({
			store,
			client: first.client,
			job: jobFor("a2"),
		});
		expect(resolveCurrentBeat(store, "s1", "a2")?.beat.id).toBe("beat-2");

		const branch = store.swipeNode("a2", "凛没有回答。");
		expect(store.getHead("s1")?.id).toBe(branch.id);
		const second = createFakeClient([
			JSON.stringify([{ nodeId: branch.id, diffs: [] }]),
		]);
		await createSettleHandler()({
			store,
			client: second.client,
			job: jobFor(branch.id),
		});

		expect(store.getDirectorBeatState(branch.id)).toMatchObject({
			beatId: "beat-1",
			completed: false,
		});
		expect(resolveCurrentBeat(store, "s1", branch.id)?.beat.id).toBe("beat-1");
		expect(resolveCurrentBeat(store, "s1", "a2")?.beat.id).toBe("beat-2");
	}, 30000);

	it("explain 读回当前拍与完成楼层", async () => {
		const { store } = openTempStore();
		seedStory(store);
		replaceDirectorPlan(store, "s1", PLAN);
		const { client } = createFakeClient([
			JSON.stringify([
				{ nodeId: "a1", diffs: [], beatCompleted: false },
				{ nodeId: "a2", diffs: [], beatCompleted: true },
			]),
		]);
		await createSettleHandler()({ store, client, job: jobFor("a2") });

		const report = explainNode(store, "a2");
		expect(report.beats.current?.beat.id).toBe("beat-2");
		expect(report.beats.exhausted).toBe(false);
		const record = report.beats.records.find((item) => item.nodeId === "a2");
		expect(record).toMatchObject({
			beatId: "beat-1",
			completed: true,
			advanced: true,
		});
		const text = renderExplainReport(report);
		expect(text).toContain("当前拍与落拍记录");
		expect(text).toContain("当前拍：beat-2");
		expect(text).toContain("楼层 a2，节拍 beat-1，已完成，已前进到下一拍");
	}, 30000);
});

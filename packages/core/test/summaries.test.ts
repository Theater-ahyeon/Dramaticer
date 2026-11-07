import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	type Summary,
	createSummaryHandler,
	parseSummaryText,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_TIME = "2026-11-07T12:00:00.000Z";

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "system" | "user" | "assistant",
): void {
	store.appendNode({
		id,
		storyId: "s1",
		parentId,
		role,
		raw: `[[${id}]]`,
	});
}

/** 建一条 a1,u1,a2,u2,... 交替的路径；每个助手楼层都有子节点，因此都是已确认楼层。 */
function buildFloors(
	store: StoryStore,
	count: number,
): { readonly assistants: string[] } {
	const assistants: string[] = [];
	let parent: string | null = null;
	for (let index = 1; index <= count; index += 1) {
		const assistant = `a${index}`;
		append(store, assistant, parent, "assistant");
		assistants.push(assistant);
		const user = `u${index}`;
		append(store, user, assistant, "user");
		parent = user;
	}
	return { assistants };
}

function fakeResult(text: string): LlmResult {
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

function scriptedClient(texts: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				const text = texts[requests.length];
				if (text === undefined) {
					throw new Error(`模型调用次数超过脚本：第 ${requests.length + 1} 次`);
				}
				requests.push(request);
				return fakeResult(text);
			},
		},
	};
}

function jobAt(nodeId: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind: "summary",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: FIXED_TIME,
		startedAt: FIXED_TIME,
		finishedAt: null,
	};
}

function userContent(request: LlmRequest | undefined): string {
	const message = request?.messages.find((item) => item.role === "user");
	if (!message) throw new Error("请求里没有 user 消息");
	return message.content;
}

function chaptersOf(store: StoryStore, headNodeId: string): Summary[] {
	return store
		.getValidSummaries("s1", headNodeId)
		.filter((summary) => summary.level === "chapter");
}

function mainlinesOf(store: StoryStore, headNodeId: string): Summary[] {
	return store
		.getValidSummaries("s1", headNodeId)
		.filter((summary) => summary.level === "mainline");
}

describe("摘要存储", () => {
	it("写入后按路径有效，token 数由估算器计算，正文去掉首尾空白", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant");
		append(store, "n2", "n1", "user");
		append(store, "n3", "n2", "assistant");
		append(store, "n4", "n3", "user");

		const summary = store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n1",
			endNodeId: "n3",
			text: "  甲乙丙丁  ",
		});

		expect(summary.text).toBe("甲乙丙丁");
		expect(summary.tokenCount).toBe(3);
		expect(summary.createdAt.length).toBeGreaterThan(0);
		expect(store.getValidSummaries("s1", "n4")).toEqual([summary]);
		expect(store.isSummaryValid(summary, "n4")).toBe(true);

		const mainline = store.insertSummary({
			storyId: "s1",
			level: "mainline",
			startNodeId: "n1",
			endNodeId: "n3",
			text: "主线",
		});
		expect(
			store
				.getValidSummaries("s1", "n4")
				.map((item) => [item.level, item.text]),
		).toEqual([
			["chapter", "甲乙丙丁"],
			["mainline", "主线"],
		]);
		expect(mainline.level).toBe("mainline");
		expect(() =>
			store.insertSummary({
				storyId: "s1",
				level: "mainline",
				startNodeId: "n1",
				endNodeId: "n3",
				text: "重复的主线",
			}),
		).toThrow(/UNIQUE/);
	});

	it("拒绝非法区间、空正文、非法级别与重复区间", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.createStory({ id: "s2", title: "另一个故事" });
		append(store, "n1", null, "assistant");
		append(store, "n2", "n1", "user");
		append(store, "n3", "n2", "assistant");
		store.appendNode({
			id: "m1",
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "别的故事",
		});

		expect(() =>
			store.insertSummary({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n3",
				endNodeId: "n1",
				text: "反向",
			}),
		).toThrow("起点必须是终点的祖先");
		expect(() =>
			store.insertSummary({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n3",
				endNodeId: "n3",
				text: "同一楼",
			}),
		).toThrow("起点必须在终点之前");
		expect(() =>
			store.insertSummary({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n1",
				endNodeId: "n3",
				text: "   ",
			}),
		).toThrow("不能是空字符串");
		expect(() =>
			store.insertSummary({
				storyId: "s1",
				level: "scene" as "chapter",
				startNodeId: "n1",
				endNodeId: "n3",
				text: "级别错误",
			}),
		).toThrow("摘要级别不合法");
		expect(() =>
			store.insertSummary({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n1",
				endNodeId: "m1",
				text: "跨故事",
			}),
		).toThrow("属于另一个故事");

		const summary = store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n1",
			endNodeId: "n3",
			text: "唯一",
		});
		expect(() =>
			store.insertSummary({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n1",
				endNodeId: "n3",
				text: "重复",
			}),
		).toThrow(/UNIQUE/);
		expect(store.getValidSummaries("s1", "n3")).toEqual([summary]);
	});

	it("切到其他分支后，覆盖旧分支楼层的摘要失效", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant");
		append(store, "n2", "n1", "user");
		append(store, "n3", "n2", "assistant");
		append(store, "n4", "n3", "user");
		const oldBranch = store.insertSummary({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n1",
			endNodeId: "n3",
			text: "旧分支",
		});
		const common = store.insertSummary({
			storyId: "s1",
			level: "mainline",
			startNodeId: "n1",
			endNodeId: "n2",
			text: "公共前缀",
		});

		const swiped = store.swipeNode("n3", "[[n3b]]");

		expect(store.getValidSummaries("s1", swiped.id)).toEqual([common]);
		expect(store.isSummaryValid(oldBranch, swiped.id)).toBe(false);
		expect(
			store.getValidSummaries("s1", "n4").map((item) => item.text),
		).toEqual(["旧分支", "公共前缀"]);
	});

	it("统计路径上已确认的助手楼层", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		buildFloors(store, 3);
		expect(store.countConfirmedAssistantNodesOnPath("a1")).toBe(1);
		expect(store.countConfirmedAssistantNodesOnPath("a3")).toBe(3);
		expect(() => store.countConfirmedAssistantNodesOnPath("missing")).toThrow(
			"楼层节点不存在",
		);
	});
});

describe("摘要输出解析", () => {
	it("去掉首尾空白后必须非空", () => {
		expect(parseSummaryText("  正文  ")).toBe("正文");
		expect(() => parseSummaryText("   ")).toThrow("不能是空字符串");
	});
});

describe("章节摘要任务", () => {
	it("按窗口生成章节摘要，范围从上一章节终点之后开始", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { assistants } = buildFloors(store, 4);
		const handler = createSummaryHandler({ chapterSize: 2, mainlineSize: 100 });
		const { client, requests } = scriptedClient(["第一章", "第二章"]);

		await handler({ store, client, job: jobAt(assistants[1] as string) });
		expect(
			chaptersOf(store, "u4").map((item) => [
				item.startNodeId,
				item.endNodeId,
				item.text,
			]),
		).toEqual([["a1", "a2", "第一章"]]);

		await handler({ store, client, job: jobAt(assistants[3] as string) });
		const chapters = chaptersOf(store, "u4");
		expect(
			chapters.map((item) => [item.startNodeId, item.endNodeId, item.text]),
		).toEqual([
			["a1", "a2", "第一章"],
			["u2", "a4", "第二章"],
		]);
		expect(requests).toHaveLength(2);
		expect(userContent(requests[0])).toContain("[[a1]]");
		expect(userContent(requests[0])).not.toContain("[[a3]]");
		expect(userContent(requests[1])).not.toContain("[[a1]]");
		expect(userContent(requests[1])).not.toContain("[[u1]]");
		expect(userContent(requests[1])).toContain("[[u2]]");
		expect(userContent(requests[1])).toContain("[[a4]]");

		await handler({ store, client, job: jobAt(assistants[3] as string) });
		expect(requests).toHaveLength(2);
		expect(chaptersOf(store, "u4")).toHaveLength(2);
	});

	it("窗口参数变化时覆盖范围随之变化", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { assistants } = buildFloors(store, 3);
		const handler = createSummaryHandler({ chapterSize: 3, mainlineSize: 100 });
		const { client, requests } = scriptedClient(["三章合一"]);

		await handler({ store, client, job: jobAt(assistants[2] as string) });

		expect(requests).toHaveLength(1);
		expect(
			chaptersOf(store, "u3").map((item) => [item.startNodeId, item.endNodeId]),
		).toEqual([["a1", "a3"]]);
		expect(userContent(requests[0])).toContain("[[u1]]");
		expect(userContent(requests[0])).toContain("[[u2]]");
		expect(userContent(requests[0])).toContain("[[a3]]");
	});
});

describe("主线摘要任务", () => {
	it("每 5 条章节摘要的计数触发主线，重跑不重复", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { assistants } = buildFloors(store, 4);
		const handler = createSummaryHandler({ chapterSize: 2, mainlineSize: 2 });
		const { client, requests } = scriptedClient(["第一章", "第二章", "主线"]);

		await handler({ store, client, job: jobAt(assistants[1] as string) });
		expect(mainlinesOf(store, "u4")).toHaveLength(0);

		await handler({ store, client, job: jobAt(assistants[3] as string) });
		const mainlines = mainlinesOf(store, "u4");
		expect(
			mainlines.map((item) => [item.startNodeId, item.endNodeId, item.text]),
		).toEqual([["a1", "a4", "主线"]]);
		expect(requests).toHaveLength(3);
		expect(userContent(requests[2])).toContain("第一章");
		expect(userContent(requests[2])).toContain("第二章");

		await handler({ store, client, job: jobAt(assistants[3] as string) });
		expect(requests).toHaveLength(3);
		expect(chaptersOf(store, "u4")).toHaveLength(2);
		expect(mainlinesOf(store, "u4")).toHaveLength(1);
	});
});

describe("摘要任务的边界", () => {
	it("不足窗口、已有摘要或空输出时不写入", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { assistants } = buildFloors(store, 1);
		const handler = createSummaryHandler({ chapterSize: 2, mainlineSize: 1 });
		const { client, requests } = scriptedClient([]);

		await handler({ store, client, job: jobAt(assistants[0] as string) });
		expect(requests).toHaveLength(0);
		expect(chaptersOf(store, "u1")).toHaveLength(0);

		const empty = createSummaryHandler({ chapterSize: 2, mainlineSize: 1 });
		const tooFew = scriptedClient([]);
		await expect(
			empty({ store, client: tooFew.client, job: jobAt("a1") }),
		).resolves.toBeUndefined();

		const failing = scriptedClient(["   "]);
		const { store: other } = openTempStore();
		other.createStory({ id: "s1", title: "测试" });
		const { assistants: others } = buildFloors(other, 2);
		await expect(
			createSummaryHandler({ chapterSize: 2, mainlineSize: 100 })({
				store: other,
				client: failing.client,
				job: jobAt(others[1] as string),
			}),
		).rejects.toThrow("不能是空字符串");
		expect(chaptersOf(other, "u2")).toHaveLength(0);
	});

	it("窗口参数非法时直接抛错", () => {
		expect(() => createSummaryHandler({ chapterSize: 1 })).toThrow(
			"章节摘要窗口",
		);
		expect(() => createSummaryHandler({ mainlineSize: 0 })).toThrow(
			"主线摘要窗口",
		);
	});
});

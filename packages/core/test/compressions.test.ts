import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	COMPRESSION_SECTION_KEYS,
	type CompressionSectionKey,
	type CompressionSections,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	assertCompressionSections,
	createCompressionHandler,
	createDefaultBackgroundJobRegistry,
	formatCompressionSections,
	parseCompressionSections,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_TIME = "2026-11-12T12:00:00.000Z";

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

function sections(
	overrides: Partial<Record<CompressionSectionKey, string>> = {},
): CompressionSections {
	const base = {} as Record<CompressionSectionKey, string>;
	for (const key of COMPRESSION_SECTION_KEYS) {
		base[key] = `${key}正文`;
	}
	return { ...base, ...overrides };
}

function sectionsJson(
	overrides: Partial<Record<CompressionSectionKey, string>> = {},
): string {
	return JSON.stringify(sections(overrides));
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
		kind: "compression",
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

describe("八段压缩解析", () => {
	it("按固定顺序重建八段，去掉首尾空白并允许代码块包裹", () => {
		const parsed = parseCompressionSections(
			`\`\`\`json\n${JSON.stringify({
				...sections(),
				剧情脉络: "  开端  ",
			})}\n\`\`\``,
		);
		expect(Object.keys(parsed)).toEqual([...COMPRESSION_SECTION_KEYS]);
		expect(parsed.剧情脉络).toBe("开端");
	});

	it("缺键、未知键、非字符串与空正文都指出字段", () => {
		const missing = sections() as Record<string, string>;
		missing.用户意志 = undefined;
		expect(() => parseCompressionSections(JSON.stringify(missing))).toThrow(
			/用户意志/,
		);

		expect(() =>
			parseCompressionSections(
				JSON.stringify({ ...sections(), 额外字段: "多余" }),
			),
		).toThrow(/额外字段/);

		expect(() =>
			parseCompressionSections(JSON.stringify({ ...sections(), 关系网: 42 })),
		).toThrow(/关系网/);

		expect(() =>
			parseCompressionSections(
				JSON.stringify({ ...sections(), 物品与资源: "   " }),
			),
		).toThrow(/物品与资源/);

		expect(() => assertCompressionSections([], "压缩的 sections")).toThrow(
			"压缩的 sections必须是对象",
		);
	});

	it("渲染顺序固定", () => {
		const rendered = formatCompressionSections(sections());
		expect(rendered.startsWith("【剧情脉络】\n剧情脉络正文")).toBe(true);
		expect(rendered.endsWith("【用户意志】\n用户意志正文")).toBe(true);
	});
});

describe("八段压缩存储", () => {
	it("写入后按路径有效，八段顺序固定，token 数按渲染正文计算", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant");
		append(store, "n2", "n1", "user");
		append(store, "n3", "n2", "assistant");
		append(store, "n4", "n3", "user");

		const compression = store.insertChapterCompression({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n1",
			endNodeId: "n3",
			sections: sections({ 剧情脉络: "  开端  " }),
		});

		expect(compression.sections.剧情脉络).toBe("开端");
		expect(Object.keys(compression.sections)).toEqual([
			...COMPRESSION_SECTION_KEYS,
		]);
		expect(compression.tokenCount).toBeGreaterThan(0);
		expect(store.getValidCompressions("s1", "n4")).toEqual([compression]);
		expect(store.isCompressionValid(compression, "n4")).toBe(true);

		const mainline = store.insertChapterCompression({
			storyId: "s1",
			level: "mainline",
			startNodeId: "n1",
			endNodeId: "n3",
			sections: sections(),
		});
		expect(
			store.getValidCompressions("s1", "n4").map((item) => item.level),
		).toEqual(["chapter", "mainline"]);
		expect(mainline.level).toBe("mainline");
		expect(() =>
			store.insertChapterCompression({
				storyId: "s1",
				level: "mainline",
				startNodeId: "n1",
				endNodeId: "n3",
				sections: sections(),
			}),
		).toThrow(/UNIQUE/);
	});

	it("拒绝非法区间、非法级别、跨故事与缺段", () => {
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
			store.insertChapterCompression({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n3",
				endNodeId: "n1",
				sections: sections(),
			}),
		).toThrow("起点必须是终点的祖先");
		expect(() =>
			store.insertChapterCompression({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n3",
				endNodeId: "n3",
				sections: sections(),
			}),
		).toThrow("起点必须在终点之前");
		expect(() =>
			store.insertChapterCompression({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n1",
				endNodeId: "m1",
				sections: sections(),
			}),
		).toThrow("属于另一个故事");
		expect(() =>
			store.insertChapterCompression({
				storyId: "s1",
				level: "scene" as "chapter",
				startNodeId: "n1",
				endNodeId: "n3",
				sections: sections(),
			}),
		).toThrow("压缩级别不合法");

		const broken = sections() as Record<string, string>;
		broken.当前情况 = undefined;
		expect(() =>
			store.insertChapterCompression({
				storyId: "s1",
				level: "chapter",
				startNodeId: "n1",
				endNodeId: "n3",
				sections: broken as CompressionSections,
			}),
		).toThrow(/当前情况/);
	});

	it("切到其他分支后，覆盖旧分支楼层的压缩失效", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant");
		append(store, "n2", "n1", "user");
		append(store, "n3", "n2", "assistant");
		append(store, "n4", "n3", "user");
		const oldBranch = store.insertChapterCompression({
			storyId: "s1",
			level: "chapter",
			startNodeId: "n1",
			endNodeId: "n3",
			sections: sections(),
		});
		const common = store.insertChapterCompression({
			storyId: "s1",
			level: "mainline",
			startNodeId: "n1",
			endNodeId: "n2",
			sections: sections(),
		});

		const swiped = store.swipeNode("n3", "[[n3b]]");

		expect(store.getValidCompressions("s1", swiped.id)).toEqual([common]);
		expect(store.isCompressionValid(oldBranch, swiped.id)).toBe(false);
		expect(
			store.getValidCompressions("s1", "n4").map((item) => item.level),
		).toEqual(["chapter", "mainline"]);
	});
});

describe("章节压缩任务", () => {
	it("按窗口生成章节压缩，输入包含窗口原文与上一份压缩", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { assistants } = buildFloors(store, 4);
		const handler = createCompressionHandler({
			chapterSize: 2,
			mainlineSize: 100,
		});
		const { client, requests } = scriptedClient([
			sectionsJson({ 剧情脉络: "第一章事件" }),
			sectionsJson({ 剧情脉络: "第二章事件" }),
		]);

		await handler({ store, client, job: jobAt(assistants[1] as string) });
		const first = store.getValidCompressions("s1", "u4");
		expect(
			first.map((item) => [
				item.level,
				item.startNodeId,
				item.endNodeId,
				item.sections.剧情脉络,
			]),
		).toEqual([["chapter", "a1", "a2", "第一章事件"]]);
		expect(userContent(requests[0])).toContain("[[a1]]");
		expect(userContent(requests[0])).toContain("[[a2]]");
		expect(userContent(requests[0])).not.toContain("[[a3]]");
		expect(userContent(requests[0])).toContain("这是第一份章节压缩");

		await handler({ store, client, job: jobAt(assistants[3] as string) });
		const chapters = store
			.getValidCompressions("s1", "u4")
			.filter((item) => item.level === "chapter");
		expect(
			chapters.map((item) => [
				item.startNodeId,
				item.endNodeId,
				item.sections.剧情脉络,
			]),
		).toEqual([
			["a1", "a2", "第一章事件"],
			["u2", "a4", "第二章事件"],
		]);
		expect(requests).toHaveLength(2);
		expect(userContent(requests[1])).toContain("第一章事件");
		expect(userContent(requests[1])).not.toContain("[[a1]]");
		expect(userContent(requests[1])).toContain("[[u2]]");
		expect(userContent(requests[1])).toContain("[[a4]]");

		await handler({ store, client, job: jobAt(assistants[3] as string) });
		expect(requests).toHaveLength(2);
		expect(store.getValidCompressions("s1", "u4")).toHaveLength(2);
	});

	it("空窗口不调用模型", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { assistants } = buildFloors(store, 2);
		store.insertChapterCompression({
			storyId: "s1",
			level: "chapter",
			startNodeId: "a1",
			endNodeId: "a2",
			sections: sections(),
		});
		const handler = createCompressionHandler({
			chapterSize: 2,
			mainlineSize: 100,
		});
		const { client, requests } = scriptedClient([]);

		await handler({ store, client, job: jobAt(assistants[1] as string) });

		expect(requests).toHaveLength(0);
		expect(store.getValidCompressions("s1", "u2")).toHaveLength(1);

		await handler({ store, client, job: jobAt("u2") });
		expect(requests).toHaveLength(0);
		expect(store.getValidCompressions("s1", "u2")).toHaveLength(1);
	});

	it("模型输出缺段时整条拒绝并指出字段", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { assistants } = buildFloors(store, 2);
		const handler = createCompressionHandler({
			chapterSize: 2,
			mainlineSize: 100,
		});
		const broken = sections() as Record<string, string>;
		broken.伏笔与约定 = undefined;
		const { client } = scriptedClient([JSON.stringify(broken)]);

		await expect(
			handler({ store, client, job: jobAt(assistants[1] as string) }),
		).rejects.toThrow(/伏笔与约定/);
		expect(store.getValidCompressions("s1", "u2")).toHaveLength(0);
	});
});

describe("主线压缩任务", () => {
	it("每 5 条章节压缩生成一条主线压缩，重跑不重复", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const { assistants } = buildFloors(store, 4);
		const handler = createCompressionHandler({
			chapterSize: 2,
			mainlineSize: 2,
		});
		const { client, requests } = scriptedClient([
			sectionsJson({ 剧情脉络: "第一章事件" }),
			sectionsJson({ 剧情脉络: "第二章事件" }),
			sectionsJson({ 剧情脉络: "主线事件" }),
		]);

		await handler({ store, client, job: jobAt(assistants[1] as string) });
		expect(
			store
				.getValidCompressions("s1", "u4")
				.filter((item) => item.level === "mainline"),
		).toHaveLength(0);

		await handler({ store, client, job: jobAt(assistants[3] as string) });
		const mainlines = store
			.getValidCompressions("s1", "u4")
			.filter((item) => item.level === "mainline");
		expect(
			mainlines.map((item) => [
				item.startNodeId,
				item.endNodeId,
				item.sections.剧情脉络,
			]),
		).toEqual([["a1", "a4", "主线事件"]]);
		expect(requests).toHaveLength(3);
		expect(userContent(requests[2])).toContain("第一章事件");
		expect(userContent(requests[2])).toContain("第二章事件");

		await handler({ store, client, job: jobAt(assistants[3] as string) });
		expect(requests).toHaveLength(3);
		expect(store.getValidCompressions("s1", "u4")).toHaveLength(3);
	});
});

describe("压缩任务注册", () => {
	it("默认注册表包含 deferred 档的 compression 任务", () => {
		const registry = createDefaultBackgroundJobRegistry();
		expect(registry.get("compression")?.tier).toBe("deferred");
	});
});

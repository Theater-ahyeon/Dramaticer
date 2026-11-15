import { describe, expect, it } from "vitest";
import {
	type BlueprintEntry,
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintVolume,
	type ContextSlotRequest,
	type DirectorLine,
	type DirectorLineState,
	type StoryStore,
	type WritingBlueprintSummary,
	assembleContext,
	createBlueprintSlotProvider,
	formatWritingBlueprintSummary,
	milestonePromiseLine,
	readWritingBlueprintSummary,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const PREMISE: BlueprintPremise = {
	id: "premise",
	kind: "premise",
	source: "player",
	locked: false,
	coreQuestion: "卫宫能不能在仪式开始前找到妹妹",
	tone: "阴冷",
	endings: ["救回妹妹", "妹妹成为代价"],
	redLines: ["不写虐待儿童"],
};

const VOLUME_ONE: BlueprintVolume = {
	id: "vol1",
	kind: "volume",
	source: "player",
	locked: false,
	title: "第一卷 钟楼",
	coreQuestion: "谁在钟楼里等她",
	startState: "卫宫刚进城",
	endState: "卫宫知道钟楼下埋着什么",
};

const VOLUME_TWO: BlueprintVolume = {
	id: "vol2",
	kind: "volume",
	source: "player",
	locked: false,
	title: "第二卷 地窖",
	coreQuestion: "地窖里的东西是谁放的",
	startState: "卫宫知道钟楼下埋着什么",
	endState: "卫宫打开地窖",
};

function milestone(
	id: string,
	overrides: Partial<BlueprintMilestone> = {},
): BlueprintMilestone {
	return {
		id,
		kind: "milestone",
		source: "player",
		locked: false,
		volumeId: "vol1",
		want: `${id} 的方向`,
		prerequisites: [],
		after: [],
		hardness: "soft",
		...overrides,
	};
}

function state(line: DirectorLine): DirectorLineState {
	return { line, openedDepth: 1, lastTouchedDepth: 1 };
}

function requireSummary(
	summary: WritingBlueprintSummary | null,
): WritingBlueprintSummary {
	if (summary === null) throw new Error("缺少蓝图摘要");
	return summary;
}

function request(
	storyId: string,
	nodeId: string | null,
	slot: ContextSlotRequest["slot"],
): ContextSlotRequest {
	return { slot, storyId, nodeId, switches: {}, state: undefined };
}

describe("写作上下文的蓝图摘要", () => {
	it("给出当前卷的核心问题、最近里程碑的方向与还没有埋的线", () => {
		const entry = milestone("m1", {
			want: "找到钟楼的钥匙",
			prerequisites: ["拿到管家写的信", "认识楼下的守卫"],
		});
		const planted = milestonePromiseLine(entry, 0);
		const entries: BlueprintEntry[] = [PREMISE, VOLUME_ONE, entry];
		const summary = readWritingBlueprintSummary(
			entries,
			[state(planted)],
			[planted.id],
		);
		expect(summary?.volume).toEqual({
			id: "vol1",
			title: "第一卷 钟楼",
			coreQuestion: "谁在钟楼里等她",
		});
		expect(summary?.milestone).toEqual({
			id: "m1",
			want: "找到钟楼的钥匙",
		});
		expect(summary?.seeds).toEqual(["认识楼下的守卫"]);

		const formatted = formatWritingBlueprintSummary(requireSummary(summary));
		expect(formatted?.text).toBe(
			"蓝图摘要：\n当前卷：第一卷 钟楼（核心问题：谁在钟楼里等她）\n最近的里程碑：找到钟楼的钥匙\n本章该埋的线：\n- 认识楼下的守卫",
		);
		expect(formatted?.source).toBe("blueprint:卷 vol1，里程碑 m1，待埋 1 条");
	});

	it("前提条件都关闭后不再给里程碑方向，卷取最后一个规划的卷", () => {
		const first = milestone("m1", { prerequisites: ["拿到管家写的信"] });
		const second = milestone("m2", {
			volumeId: "vol2",
			prerequisites: ["打开地窖"],
			after: ["m1"],
		});
		const entries: BlueprintEntry[] = [
			PREMISE,
			VOLUME_ONE,
			VOLUME_TWO,
			first,
			second,
		];
		const planned = requireSummary(
			readWritingBlueprintSummary(entries, [], []),
		);
		expect(planned.milestone?.id).toBe("m1");
		expect(planned.volume?.id).toBe("vol1");

		const closed = requireSummary(
			readWritingBlueprintSummary(
				entries,
				[],
				[milestonePromiseLine(first, 0).id, milestonePromiseLine(second, 0).id],
			),
		);
		expect(closed.milestone).toBeNull();
		expect(closed.seeds).toEqual([]);
		expect(closed.volume?.id).toBe("vol2");
		expect(formatWritingBlueprintSummary(closed)?.text).toBe(
			"蓝图摘要：\n当前卷：第二卷 地窖（核心问题：地窖里的东西是谁放的）",
		);
	});

	it("没有蓝图时返回 null", () => {
		expect(readWritingBlueprintSummary([], [], [])).toBeNull();
	});

	it("只有总纲这类没有可写内容的蓝图不产生空段", () => {
		const summary = readWritingBlueprintSummary([PREMISE], [], []);
		expect(summary).not.toBeNull();
		expect(formatWritingBlueprintSummary(summary ?? null)).toBeNull();
	});

	it("来源描述不包含其他蓝图条目", () => {
		const entry = milestone("m1", { prerequisites: ["拿到管家写的信"] });
		const summary = requireSummary(
			readWritingBlueprintSummary(
				[PREMISE, VOLUME_ONE, VOLUME_TWO, entry, milestone("m2")],
				[],
				[],
			),
		);
		const formatted = formatWritingBlueprintSummary(summary);
		expect(formatted?.source).not.toContain(PREMISE.redLines[0] as string);
		expect(formatted?.source).not.toContain(PREMISE.endings[1] as string);
		expect(formatted?.source).not.toContain("m2 的方向");
		expect(formatted?.text).not.toContain(PREMISE.redLines[0] as string);
		expect(formatted?.text).not.toContain("m2 的方向");
	});

	it("槽位注入摘要，Trace 里只有一行来源", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const entry = milestone("m1", {
			want: "找到钟楼的钥匙",
			prerequisites: ["拿到管家写的信"],
		});
		store.saveStoryBlueprint({
			nodeId: "n2",
			storyId: "s1",
			source: "player",
			diffs: [PREMISE, VOLUME_ONE, entry].map((item) => ({
				action: "set" as const,
				entry: item,
			})),
		});

		const provider = createBlueprintSlotProvider(store);
		const content = await provider.provide(request("s1", "n2", "blueprint"));
		expect(content?.messages).toEqual([
			{
				role: "system",
				content:
					"蓝图摘要：\n当前卷：第一卷 钟楼（核心问题：谁在钟楼里等她）\n最近的里程碑：找到钟楼的钥匙\n本章该埋的线：\n- 拿到管家写的信",
			},
		]);
		expect(content?.source).toBe("blueprint:卷 vol1，里程碑 m1，待埋 1 条");

		const assembled = await assembleContext({
			template: {
				id: "blueprint-only",
				segments: [
					{
						id: "blueprint",
						kind: "slot",
						slot: "blueprint",
						priority: 50,
					},
				],
			},
			budgetTokens: 1_000,
			storyId: "s1",
			nodeId: "n2",
			providers: { blueprint: provider },
		});
		const traceEntry = assembled.trace.entries[0];
		expect(traceEntry?.status).toBe("included");
		expect(traceEntry?.source).toBe(content?.source);
		expect(JSON.stringify(assembled.trace)).not.toContain(PREMISE.coreQuestion);
		expect(JSON.stringify(assembled.trace)).not.toContain("不写虐待儿童");
	});

	it("没有蓝图时槽位缺失且不占预算", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const assembled = await assembleContext({
			template: {
				id: "blueprint-only",
				segments: [
					{
						id: "blueprint",
						kind: "slot",
						slot: "blueprint",
						priority: 50,
					},
				],
			},
			budgetTokens: 1_000,
			storyId: "s1",
			nodeId: "n2",
			providers: { blueprint: createBlueprintSlotProvider(store) },
		});
		expect(assembled.messages).toEqual([]);
		expect(assembled.trace.entries[0]).toMatchObject({
			segmentId: "blueprint",
			status: "missing-slot",
			tokens: 0,
		});
	});
});

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
	store.appendNode({
		id: "n1",
		storyId: "s1",
		parentId: "n0",
		role: "user",
		raw: "我走进钟楼。",
	});
	store.appendNode({
		id: "n2",
		storyId: "s1",
		parentId: "n1",
		role: "assistant",
		raw: "钟楼里只有灰尘。",
	});
}

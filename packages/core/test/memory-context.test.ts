import { describe, expect, it } from "vitest";
import {
	type ContextTrace,
	type StoryStore,
	type TurnTrace,
	assembleContext,
	createLoreSlotProvider,
	createMemorySlotProvider,
	createProfileSlotProvider,
	createStateSlotProvider,
	readContextBreakdown,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "system" | "user" | "assistant",
	raw: string,
): void {
	store.appendNode({ id, storyId: "s1", parentId, role, raw });
}

function traceFor(
	nodeId: string,
	parentNodeId: string | null,
	context: ContextTrace,
): TurnTrace {
	return {
		storyId: "s1",
		nodeId,
		parentNodeId,
		templateId: "test",
		turnMode: "fast",
		profile: "native",
		createdAt: "2026-11-19T00:00:00.000Z",
		context,
		llm: {
			model: "fake-model",
			channel: "fake-channel",
			stopReason: "stop",
			finishReason: "stop",
			truncations: [],
			usage: {
				promptTokens: 1,
				completionTokens: 2,
				totalTokens: 3,
				reasoningTokens: 0,
				cachedTokens: 0,
			},
			attempts: 1,
			rounds: 1,
			cached: false,
		},
		tools: {
			transport: "native",
			rounds: 0,
			maxRounds: 3,
			capped: false,
			calls: [],
			rejected: [],
		},
		structured: {
			mode: "text-tags",
			acceptedStateUpdates: 0,
			acceptedNotes: 0,
			issues: [],
		},
		timing: { firstTokenMs: 100, durationMs: 500 },
		deep: null,
		run: null,
	};
}

/** 22 楼的路径让记忆槽位进入检索，而不是整段原文都放得下。 */
function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "上下文来源" });
	append(store, "n1", null, "assistant", "开场。");
	for (let index = 2; index <= 21; index += 1) {
		append(
			store,
			`n${index}`,
			`n${index - 1}`,
			index % 2 === 0 ? "user" : "assistant",
			index === 5 ? "她站在门口。" : `第 ${index} 楼。`,
		);
	}
	append(store, "u22", "n21", "user", "旧校舍还在吗？");

	store.insertMemoryEvents([
		{
			id: "e1",
			storyId: "s1",
			sourceNodeId: "n5",
			ordinal: 0,
			participants: ["凛"],
			knowers: [],
			importance: 0.9,
			text: "凛在旧校舍门口等人",
			source: "extract",
		},
	]);
	store.appendStateDiff({
		storyId: "s1",
		nodeId: "n5",
		path: ["character", "凛", "location"],
		op: "set",
		value: "旧校舍",
		source: "settler",
	});
	const entity = store.upsertEntity({
		id: "entity-rin",
		storyId: "s1",
		kind: "character",
		name: "凛",
		description: "总在校舍门口等人。",
		source: "card",
	});
	store.insertLoreEntries([
		{
			id: "lore1",
			storyId: "s1",
			name: "旧校舍",
			content: "十年前封起来的木质校舍。",
			constant: true,
			source: "card",
		},
	]);
	store.saveSceneArchive({
		storyId: "s1",
		endNodeId: "n19",
		startNodeId: "n17",
		floorCount: 3,
		boundary: "scene-ends",
		summary: "凛在旧校舍门口等到天黑。",
		present: ["凛"],
		profiles: [
			{
				who: "凛",
				want: "等到那个人",
				hide: null,
				speech: null,
				unresolved: null,
			},
		],
		informed: [],
		stateChanges: [],
		cluesOpened: [],
		cluesClosed: [],
	});
	expect(entity.id).toBe("entity-rin");
}

async function seedTrace(store: StoryStore): Promise<void> {
	const assembled = await assembleContext({
		template: {
			id: "test",
			segments: [
				{ kind: "slot", id: "state", slot: "state", priority: 100 },
				{ kind: "slot", id: "memory", slot: "memory", priority: 90 },
				{ kind: "slot", id: "lore", slot: "lore", priority: 80 },
				{ kind: "slot", id: "profile", slot: "profile", priority: 70 },
			],
		},
		budgetTokens: 100_000,
		storyId: "s1",
		nodeId: "u22",
		providers: {
			state: createStateSlotProvider(store),
			memory: createMemorySlotProvider(store),
			lore: createLoreSlotProvider(store),
			profile: createProfileSlotProvider(store),
		},
	});
	store.saveTurnTrace(traceFor("u22", "n21", assembled.trace));
}

describe("本轮上下文的构成", () => {
	it("每一类给出 token 数，类别之和等于总用量", async () => {
		const { store } = openTempStore();
		seedStory(store);
		await seedTrace(store);

		const breakdown = readContextBreakdown(store, "u22");
		expect(breakdown).not.toBeNull();
		if (breakdown === null) throw new Error("缺少上下文构成");

		const total = breakdown.categories.reduce(
			(sum, category) => sum + category.tokens,
			0,
		);
		expect(total).toBe(breakdown.totalTokens);
		for (const category of breakdown.categories) {
			expect(category.tokens).toBeGreaterThan(0);
		}
	});

	it("每一条内容都能定位到设定、记录、百科页或状态项", async () => {
		const { store } = openTempStore();
		seedStory(store);
		await seedTrace(store);

		const breakdown = readContextBreakdown(store, "u22");
		if (breakdown === null) throw new Error("缺少上下文构成");
		const byId = new Map(
			breakdown.categories.map((category) => [category.id, category]),
		);

		const stateItem = byId
			.get("state")
			?.items.find((item) => item.source.kind === "state");
		expect(stateItem?.source).toEqual({
			kind: "state",
			target: JSON.stringify(["character", "凛", "location"]),
			label: "凛 · location",
		});

		const recordItem = byId
			.get("record")
			?.items.find((item) => item.source.kind === "record");
		expect(recordItem?.source).toMatchObject({
			kind: "record",
			ids: ["e1"],
			nodeId: "n5",
			floorNo: 5,
		});

		const loreItem = byId
			.get("lore")
			?.items.find((item) => item.source.kind === "lore");
		expect(loreItem?.source).toEqual({
			kind: "lore",
			id: "lore1",
			name: "旧校舍",
		});

		const wikiItem = byId
			.get("wiki")
			?.items.find((item) => item.source.kind === "wiki");
		expect(wikiItem?.source).toEqual({
			kind: "wiki",
			id: "entity-rin",
			name: "凛",
		});

		for (const category of breakdown.categories) {
			for (const item of category.items) {
				expect(item.label.length).toBeGreaterThan(0);
				expect(item.tokens).toBeGreaterThanOrEqual(0);
				expect(item.source.kind.length).toBeGreaterThan(0);
			}
		}
	});

	it("旧 Trace 没有逐条来源时按片段给出可读的来源", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "旧 Trace" });
		append(store, "a1", null, "assistant", "开场。");
		store.saveTurnTrace(
			traceFor("a1", null, {
				budgetTokens: 100,
				totalTokens: 4,
				entries: [
					{
						segmentId: "state",
						kind: "slot",
						slot: "state",
						source: "state:3 条 diff",
						priority: 100,
						tokens: 4,
						status: "included",
					},
				],
			}),
		);

		const breakdown = readContextBreakdown(store, "a1");
		const item = breakdown?.categories[0]?.items[0];
		expect(item?.label).toBe("state · state:3 条 diff");
		expect(item?.source).toEqual({ kind: "segment", segmentId: "state" });
	});
});

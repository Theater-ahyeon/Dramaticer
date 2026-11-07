import { describe, expect, it } from "vitest";
import {
	type ContextCondition,
	DEFAULT_DIRECTOR_CONFIG,
	EVENT_POOL_PRIORITY,
	type StoryStore,
	evaluateDirector,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
}

/** 在 s1 上建一条从 n0 开始的链，偶数楼层是助手，奇数楼层是用户。 */
function buildChain(store: StoryStore, length: number): string[] {
	const ids: string[] = [];
	for (let index = 0; index < length; index += 1) {
		const id = `n${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId: index === 0 ? null : `n${index - 1}`,
			role: index % 2 === 0 ? "assistant" : "user",
			raw: `楼层 ${index}`,
		});
		ids.push(id);
	}
	return ids;
}

function addEvent(
	store: StoryStore,
	sourceId: string,
	overrides: {
		readonly text?: string;
		readonly preconditions?: ContextCondition | null;
		readonly cooldown?: number;
		readonly enabled?: boolean;
	} = {},
): void {
	store.upsertEventPool([
		{
			storyId: "s1",
			sourceId,
			text: overrides.text ?? `事件 ${sourceId}`,
			preconditions: overrides.preconditions ?? null,
			cooldown: overrides.cooldown ?? 0,
			enabled: overrides.enabled ?? true,
		},
	]);
}

const locationCondition = {
	kind: "state",
	path: ["场景", "地点"],
	op: "equals",
	value: "山门",
};

function config(overrides: Partial<typeof DEFAULT_DIRECTOR_CONFIG> = {}) {
	return { ...DEFAULT_DIRECTOR_CONFIG, ...overrides };
}

describe("事件池机制", () => {
	it("最近楼层有状态 diff 或新建笔记时不判定停滞", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 7);
		addEvent(store, "e1");
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n4",
				path: ["场景", "地点"],
				op: "set",
				value: "山门",
				source: "test",
			},
		]);
		store.insertPlotNotes([
			{ id: "note1", storyId: "s1", sourceNodeId: "n0", text: "井底的人影" },
		]);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[6] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion).toBeNull();
		const decision = store.getDirectorDecision(chain[6] as string);
		expect(decision?.mechanisms).toEqual([
			expect.objectContaining({ name: "clue", triggered: false }),
			expect.objectContaining({ name: "event_pool", triggered: false }),
		]);
		const signals = decision?.signals.eventPool as {
			readonly stallFloors: number;
			readonly selectedSourceId: string | null;
			readonly checkedFloors: readonly {
				readonly nodeId: string;
				readonly stateDiffs: number;
				readonly plotNotes: number;
			}[];
		};
		expect(signals.stallFloors).toBe(3);
		expect(signals.selectedSourceId).toBeNull();
		expect(signals.checkedFloors).toEqual([
			{ nodeId: "n0", stateDiffs: 0, plotNotes: 1 },
			{ nodeId: "n2", stateDiffs: 0, plotNotes: 0 },
			{ nodeId: "n4", stateDiffs: 1, plotNotes: 0 },
		]);
	});

	it("停滞后选择条件成立、冷却结束的事件，指令直接使用事件正文", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 7);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n1",
				path: ["场景", "地点"],
				op: "set",
				value: "山门",
				source: "test",
			},
		]);
		addEvent(store, "e1", {
			text: "山洪冲垮石桥",
			preconditions: locationCondition,
		});
		addEvent(store, "e2");

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[6] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion).toMatchObject({
			mechanism: "event_pool",
			priority: EVENT_POOL_PRIORITY,
			directive: "山洪冲垮石桥",
		});
		const eventSignals = suggestion?.signals.eventPool as {
			readonly selectedSourceId: string;
			readonly candidates: readonly { readonly sourceId: string }[];
		};
		expect(eventSignals.selectedSourceId).toBe("e1");
		expect(eventSignals.candidates.map((item) => item.sourceId)).toEqual([
			"e1",
			"e2",
		]);

		const decision = store.getDirectorDecision(chain[6] as string);
		expect(decision?.directive).toBe("山洪冲垮石桥");
		const stored = decision?.signals.eventPool as {
			readonly selectedSourceId: string;
		};
		expect(stored.selectedSourceId).toBe("e1");
	});

	it("条件不成立、已停用与仍在冷却的事件被跳过", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 7);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n1",
				path: ["场景", "地点"],
				op: "set",
				value: "云端",
				source: "test",
			},
		]);
		addEvent(store, "e1", { preconditions: locationCondition });
		addEvent(store, "e2", { enabled: false });
		addEvent(store, "e3", { cooldown: 5 });
		addEvent(store, "e4");
		store.saveDirectorDecision({
			nodeId: "n2",
			storyId: "s1",
			directive: null,
			mechanisms: [
				{ name: "event_pool", triggered: true, reason: "之前选过 e3" },
			],
			signals: { eventPool: { selectedSourceId: "e3" } },
		});

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[6] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion?.directive).toBe("事件 e4");
		const signals = store.getDirectorDecision(chain[6] as string)?.signals
			.eventPool as {
			readonly selectedSourceId: string;
			readonly skipped: readonly {
				readonly sourceId: string;
				readonly reason: string;
			}[];
		};
		expect(signals.selectedSourceId).toBe("e4");
		expect(signals.skipped).toEqual([
			{ sourceId: "e1", reason: "条件不成立" },
			{ sourceId: "e2", reason: "已停用" },
			{ sourceId: "e3", reason: "仍在冷却" },
		]);
	});

	it("surprise 为 0 时永不触发，为 1 时停滞即触发", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 7);
		addEvent(store, "e1");

		const silent = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[6] as string,
			config: config({ surprise: 0 }),
		});
		expect(silent).toBeNull();
		const silentSignals = store.getDirectorDecision(chain[6] as string)?.signals
			.eventPool as { readonly selectedSourceId: string | null };
		expect(silentSignals.selectedSourceId).toBeNull();

		const loud = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[6] as string,
			config: config({ surprise: 1 }),
		});
		expect(loud?.mechanism).toBe("event_pool");
	});

	it("同一路径重复评估选择同一条，冷却跨楼层生效", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 8);
		addEvent(store, "e1", { cooldown: 2 });
		addEvent(store, "e2");

		const first = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[6] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		const second = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[6] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(first?.directive).toBe("事件 e1");
		expect(second?.directive).toBe("事件 e1");

		const next = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[7] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(next?.directive).toBe("事件 e2");
	});

	it("另一分支的决策不参与冷却", () => {
		const { store } = openTempStore();
		seed(store);
		const chain = buildChain(store, 7);
		addEvent(store, "e1", { cooldown: 5 });
		store.appendNode({
			id: "branch",
			storyId: "s1",
			parentId: "n2",
			role: "assistant",
			raw: "另一条分支",
		});
		store.saveDirectorDecision({
			nodeId: "branch",
			storyId: "s1",
			directive: null,
			mechanisms: [
				{ name: "event_pool", triggered: true, reason: "分支选过 e1" },
			],
			signals: { eventPool: { selectedSourceId: "e1" } },
		});

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId: chain[6] as string,
			config: DEFAULT_DIRECTOR_CONFIG,
		});
		expect(suggestion?.directive).toBe("事件 e1");
	});

	it("已确认助手楼层不足或事件池为空时跳过", () => {
		const { store } = openTempStore();
		seed(store);
		const shortChain = buildChain(store, 3);
		addEvent(store, "e1");

		expect(
			evaluateDirector({
				store,
				storyId: "s1",
				nodeId: shortChain[2] as string,
				config: DEFAULT_DIRECTOR_CONFIG,
			}),
		).toBeNull();
		const shortSignals = store.getDirectorDecision(shortChain[2] as string)
			?.signals.eventPool as {
			readonly confirmedAssistantFloors: number;
			readonly selectedSourceId: string | null;
		};
		expect(shortSignals.confirmedAssistantFloors).toBe(1);
		expect(shortSignals.selectedSourceId).toBeNull();

		const { store: emptyStore } = openTempStore();
		seed(emptyStore);
		const chain = buildChain(emptyStore, 7);
		expect(
			evaluateDirector({
				store: emptyStore,
				storyId: "s1",
				nodeId: chain[6] as string,
				config: DEFAULT_DIRECTOR_CONFIG,
			}),
		).toBeNull();
		const emptySignals = emptyStore.getDirectorDecision(chain[6] as string)
			?.signals.eventPool as { readonly poolSize: number };
		expect(emptySignals.poolSize).toBe(0);
	});
});

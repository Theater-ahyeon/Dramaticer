import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	PACING_PRIORITY,
	type StoryStore,
	createPacingMechanism,
	evaluateDirector,
	isJsonObject,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function config(
	overrides: Partial<typeof DEFAULT_DIRECTOR_CONFIG> = {},
): typeof DEFAULT_DIRECTOR_CONFIG {
	return { ...DEFAULT_DIRECTOR_CONFIG, ...overrides };
}

/** 在 s1 上建一条交替角色的链，返回按顺序排列的楼层 id。 */
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

function setTension(store: StoryStore, nodeId: string, value: number): void {
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId,
			path: ["张力"],
			op: "set",
			value,
			source: "test",
		},
	]);
}

function evaluateAt(
	store: StoryStore,
	nodeId: string,
	overrides: Partial<typeof DEFAULT_DIRECTOR_CONFIG> = {},
) {
	return evaluateDirector({
		store,
		storyId: "s1",
		nodeId,
		config: config(overrides),
		mechanisms: [createPacingMechanism()],
	});
}

function pacingSignals(
	store: StoryStore,
	nodeId: string,
): Record<string, unknown> {
	const value = store.getDirectorDecision(nodeId)?.signals.pacing;
	if (!isJsonObject(value)) throw new Error("决策记录里没有节奏信号");
	return value;
}

describe("节奏状态机", () => {
	it("没有历史时从 setup 开始，阶段与张力写入决策记录", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "节奏" });
		const chain = buildChain(store, 1);
		setTension(store, "n0", 0.5);

		const suggestion = evaluateAt(store, chain[0] as string, {
			tensionPath: ["张力"],
			minSetupFloors: 2,
		});

		expect(suggestion).toBeNull();
		const signals = pacingSignals(store, "n0");
		expect(signals).toMatchObject({
			phase: "setup",
			previousPhase: "setup",
			changed: false,
			phaseStartNodeId: "n0",
			floorsInPhase: 0,
			tension: 0.5,
			tensionSource: "state",
		});
	});

	it("张力达到阈值并攒够楼层后依次经历升级、高潮、喘息、铺垫", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "转移" });
		const chain = buildChain(store, 20);
		for (const nodeId of chain) setTension(store, nodeId, 0.8);

		const setup = evaluateAt(store, "n0", {
			tensionPath: ["张力"],
			minSetupFloors: 2,
		});
		expect(setup).toBeNull();

		expect(evaluateAt(store, "n1", { tensionPath: ["张力"] })).toBeNull();
		const escalate = evaluateAt(store, "n2", { tensionPath: ["张力"] });
		expect(escalate?.mechanism).toBe("pacing");
		expect(escalate?.priority).toBe(PACING_PRIORITY);
		expect(escalate?.directive).toContain("升级");
		expect(pacingSignals(store, "n2")).toMatchObject({
			phase: "escalate",
			previousPhase: "setup",
			changed: true,
			phaseStartNodeId: "n2",
			floorsInPhase: 0,
		});

		expect(evaluateAt(store, "n3", { tensionPath: ["张力"] })).toBeNull();
		const climax = evaluateAt(store, "n4", { tensionPath: ["张力"] });
		expect(climax?.directive).toContain("高潮");
		expect(pacingSignals(store, "n4")).toMatchObject({
			phase: "climax",
			previousPhase: "escalate",
			changed: true,
		});

		for (let index = 5; index <= 10; index += 1) {
			expect(
				evaluateAt(store, `n${index}`, { tensionPath: ["张力"] }),
			).toBeNull();
		}
		const breathe = evaluateAt(store, "n11", { tensionPath: ["张力"] });
		expect(breathe?.directive).toContain("喘息");
		expect(pacingSignals(store, "n11")).toMatchObject({
			phase: "breathe",
			previousPhase: "climax",
			changed: true,
		});

		for (let index = 12; index <= 16; index += 1) {
			expect(
				evaluateAt(store, `n${index}`, { tensionPath: ["张力"] }),
			).toBeNull();
		}
		const back = evaluateAt(store, "n17", { tensionPath: ["张力"] });
		expect(back?.directive).toContain("铺垫");
		expect(pacingSignals(store, "n17")).toMatchObject({
			phase: "setup",
			previousPhase: "breathe",
			changed: true,
		});
	});

	it("pace 越大，进入升级所需的楼层数越少", () => {
		const fast = openTempStore();
		fast.store.createStory({ id: "s1", title: "快" });
		buildChain(fast.store, 3);
		for (const nodeId of ["n0", "n1", "n2"]) {
			setTension(fast.store, nodeId, 0.5);
		}
		expect(
			evaluateAt(fast.store, "n0", {
				tensionPath: ["张力"],
				pace: 2,
			}),
		).toBeNull();
		const fastSuggestion = evaluateAt(fast.store, "n1", {
			tensionPath: ["张力"],
			pace: 2,
		});
		expect(fastSuggestion?.directive).toContain("升级");

		const slow = openTempStore();
		slow.store.createStory({ id: "s1", title: "慢" });
		buildChain(slow.store, 6);
		for (let index = 0; index < 6; index += 1) {
			setTension(slow.store, `n${index}`, 0.5);
		}
		for (let index = 0; index < 4; index += 1) {
			expect(
				evaluateAt(slow.store, `n${index}`, {
					tensionPath: ["张力"],
					pace: 0.5,
				}),
			).toBeNull();
		}
		const slowSuggestion = evaluateAt(slow.store, "n4", {
			tensionPath: ["张力"],
			pace: 0.5,
		});
		expect(slowSuggestion?.directive).toContain("升级");
	});

	it("另一分支的阶段记录不参与当前分支", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "分支" });
		const chain = buildChain(store, 5);
		for (const nodeId of chain) setTension(store, nodeId, 0.8);
		const fast = {
			tensionPath: ["张力"],
			minSetupFloors: 1,
			minEscalateFloors: 1,
		};

		evaluateAt(store, "n0", fast);
		evaluateAt(store, "n1", fast);
		evaluateAt(store, "n2", fast);
		expect(pacingSignals(store, "n2").phase).toBe("climax");

		store.appendNode({
			id: "b1",
			storyId: "s1",
			parentId: "n0",
			role: "assistant",
			raw: "分支楼层",
		});
		store.appendNode({
			id: "b2",
			storyId: "s1",
			parentId: "b1",
			role: "user",
			raw: "分支用户",
		});
		setTension(store, "b1", 0.1);
		setTension(store, "b2", 0.1);

		evaluateAt(store, "b1", fast);
		const branch = evaluateAt(store, "b2", fast);

		expect(branch).toBeNull();
		expect(pacingSignals(store, "b2")).toMatchObject({
			phase: "setup",
			phaseStartNodeId: "n0",
		});
	});

	it("取不到状态值时按最近 3 个已确认助手楼层推导张力", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "推导" });
		buildChain(store, 6);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "n0",
				path: ["甲"],
				op: "set",
				value: 1,
				source: "test",
			},
			{
				storyId: "s1",
				nodeId: "n0",
				path: ["乙"],
				op: "set",
				value: 2,
				source: "test",
			},
			{
				storyId: "s1",
				nodeId: "n2",
				path: ["丙"],
				op: "set",
				value: 3,
				source: "test",
			},
		]);
		store.insertPlotNotes([
			{ id: "p1", storyId: "s1", sourceNodeId: "n2", text: "新线索" },
		]);
		store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n0",
				ordinal: 0,
				text: "旧事件",
				participants: [],
				knowers: [],
				importance: 0.2,
			},
			{
				storyId: "s1",
				sourceNodeId: "n4",
				ordinal: 0,
				text: "新事件",
				participants: [],
				knowers: [],
				importance: 0.8,
			},
		]);

		evaluateAt(store, "n5", { tensionPath: ["不存在"] });

		const signals = pacingSignals(store, "n5");
		expect(signals.tensionSource).toBe("derived");
		expect(signals.tension).toBeCloseTo(0.54, 10);
		expect(signals.components).toMatchObject({
			floorIds: ["n0", "n2", "n4"],
			stateDiffs: 3,
			stateDiffScore: 0.5,
			plotNotes: 1,
			plotNoteScore: 1 / 3,
			eventImportance: 0.8,
			eventScore: 0.8,
		});
	});

	it("状态值越界与非法配置直接抛错", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "非法" });
		buildChain(store, 2);
		setTension(store, "n1", 1.5);

		expect(() => evaluateAt(store, "n1", { tensionPath: ["张力"] })).toThrow(
			"tensionPath",
		);
		expect(() => evaluateAt(store, "n0", { tensionPath: [] })).toThrow(
			"tensionPath",
		);
		expect(() => evaluateAt(store, "n0", { pace: 0 })).toThrow("pace");
		expect(() =>
			evaluateAt(store, "n0", {
				tensionStateWeight: 0,
				tensionNoteWeight: 0,
				tensionEventWeight: 0,
			}),
		).toThrow("权重");
		expect(() => evaluateAt(store, "n0", { tensionEscalate: 0.8 })).toThrow(
			"tensionEscalate",
		);
		expect(() => evaluateAt(store, "n0", { climaxFloors: 0 })).toThrow(
			"climaxFloors",
		);
	});
});

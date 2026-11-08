import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	DIRECTOR_SUFFIX_NOTE,
	type JsonObject,
	OPENING_PRIORITY,
	type StoryStore,
	createDirectorSlotProvider,
	evaluateDirector,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const PACK: JsonObject = {
	place: "教室",
	time: "清晨",
	participants: [{ name: "凛", wants: "确认你的来意" }],
	conflict: "凛堵在门口，不让你进教室",
	directions: ["直接说明来意", "假装走错教室", "转身就走"],
};

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "开局" });
	store.updateStorySettings("s1", { cardName: "凛" });
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "凛",
		description: "图书委员",
		source: "test",
	});
}

function savePack(store: StoryStore): void {
	store.saveOpeningPack({
		storyId: "s1",
		payload: PACK,
		inputHash: "hash",
		sourceNodeId: null,
	});
}

/** 建一条 user 与 assistant 交替、以玩家楼层结尾的路径，返回最后的玩家楼层 id。 */
function buildOpeningPath(store: StoryStore, assistantFloors: number): string {
	let parentId: string | null = null;
	for (let index = 0; index < assistantFloors; index += 1) {
		const userId = `u${index}`;
		store.appendNode({
			id: userId,
			storyId: "s1",
			parentId,
			role: "user",
			raw: `玩家 ${index}`,
		});
		store.appendNode({
			id: `a${index}`,
			storyId: "s1",
			parentId: userId,
			role: "assistant",
			raw: `回复 ${index}`,
		});
		parentId = `a${index}`;
	}
	const finalUser = `u${assistantFloors}`;
	store.appendNode({
		id: finalUser,
		storyId: "s1",
		parentId,
		role: "user",
		raw: "最后一句",
	});
	return finalUser;
}

describe("开场导演", () => {
	it("前 10 楼按开局包给出本楼目标、人物行动与冲突", () => {
		const { store } = openTempStore();
		seed(store);
		savePack(store);
		const nodeId = buildOpeningPath(store, 0);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion?.mechanism).toBe("opening");
		expect(suggestion?.priority).toBe(OPENING_PRIORITY);
		const directive = suggestion?.directive ?? "";
		expect(directive).toContain("场景在教室，时间是清晨");
		expect(directive).toContain("让冲突「凛堵在门口，不让你进教室」往前推进");
		expect(directive).toContain("凛会为「确认你的来意」采取行动");

		const decision = store.getDirectorDecision(nodeId);
		expect(decision?.directive).toBe(directive);
		expect(decision?.signals.opening).toEqual({
			floorDepth: 0,
			openingFloors: 10,
			intensity: "natural",
			usedFields: ["place", "time", "participants", "conflict"],
		});
	});

	it("第 11 楼恢复常规机制，不再给开局建议", () => {
		const { store } = openTempStore();
		seed(store);
		savePack(store);
		const nodeId = buildOpeningPath(
			store,
			DEFAULT_DIRECTOR_CONFIG.openingFloors,
		);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: DEFAULT_DIRECTOR_CONFIG,
		});

		expect(suggestion).toBeNull();
		const decision = store.getDirectorDecision(nodeId);
		const opening = decision?.mechanisms.find(
			(item) => item.name === "opening",
		);
		expect(opening).toMatchObject({ triggered: false });
		expect(opening?.reason).toContain("不小于开场阈值 10");
		expect(decision?.signals.opening).toMatchObject({ floorDepth: 10 });
	});

	it("没有开局包时不触发，其余机制照旧生效", () => {
		const { store } = openTempStore();
		seed(store);
		const nodeId = buildOpeningPath(store, 13);
		store.insertPlotNotes([
			{ id: "clue1", storyId: "s1", sourceNodeId: "a0", text: "井底的人影" },
		]);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: { ...DEFAULT_DIRECTOR_CONFIG, openingFloors: 20 },
		});

		expect(suggestion?.mechanism).toBe("clue");
		const decision = store.getDirectorDecision(nodeId);
		const opening = decision?.mechanisms.find(
			(item) => item.name === "opening",
		);
		expect(opening).toMatchObject({
			triggered: false,
			reason: "故事还没有开局包",
		});
	});

	it("导演槽位把开局建议作为 suffix 返回，并带固定尾注", async () => {
		const { store } = openTempStore();
		seed(store);
		savePack(store);
		const nodeId = buildOpeningPath(store, 3);

		const provider = createDirectorSlotProvider(store);
		const content = await provider.provide({
			slot: "director",
			storyId: "s1",
			nodeId,
			switches: {},
			state: undefined,
		});

		expect(content?.source).toBe("director:opening");
		expect(content?.messages).toHaveLength(0);
		const text = content?.suffix as string;
		expect(text.startsWith("【导演】")).toBe(true);
		expect(text).toContain("凛堵在门口，不让你进教室");
		expect(store.getDirectorDecision(nodeId)?.directive).toBe(
			text.slice("【导演】".length, -DIRECTOR_SUFFIX_NOTE.length - 1),
		);
	});

	it("只铺垫强度不列人物行动；尽快引爆强度带上三条方向", () => {
		const { store } = openTempStore();
		seed(store);
		savePack(store);
		const nodeId = buildOpeningPath(store, 2);

		const setup = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: { ...DEFAULT_DIRECTOR_CONFIG, openingIntensity: "setup" },
		});
		expect(setup?.directive).toContain("本楼目标");
		expect(setup?.directive).not.toContain("在场人物");
		expect(setup?.signals).toEqual({
			opening: {
				floorDepth: 2,
				openingFloors: 10,
				intensity: "setup",
				usedFields: ["place", "time", "conflict"],
			},
		});

		const detonate = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: { ...DEFAULT_DIRECTOR_CONFIG, openingIntensity: "detonate" },
		});
		expect(detonate?.directive).toContain("在场人物");
		expect(detonate?.directive).toContain("假装走错教室");
		expect(detonate?.signals).toEqual({
			opening: {
				floorDepth: 2,
				openingFloors: 10,
				intensity: "detonate",
				usedFields: ["place", "time", "participants", "conflict", "directions"],
			},
		});
	});

	it("openingFloors 为 0 时关闭开场导演", () => {
		const { store } = openTempStore();
		seed(store);
		savePack(store);
		const nodeId = buildOpeningPath(store, 0);

		const suggestion = evaluateDirector({
			store,
			storyId: "s1",
			nodeId,
			config: { ...DEFAULT_DIRECTOR_CONFIG, openingFloors: 0 },
		});

		expect(suggestion).toBeNull();
		const opening = store
			.getDirectorDecision(nodeId)
			?.mechanisms.find((item) => item.name === "opening");
		expect(opening).toMatchObject({
			triggered: false,
			reason: "当前路径已有 0 个助手楼层，不小于开场阈值 0",
		});
	});

	it("非法的开场配置抛错并指出字段", () => {
		const { store } = openTempStore();
		seed(store);
		const nodeId = buildOpeningPath(store, 0);

		expect(() =>
			evaluateDirector({
				store,
				storyId: "s1",
				nodeId,
				config: { ...DEFAULT_DIRECTOR_CONFIG, openingFloors: -1 },
			}),
		).toThrow("openingFloors");
		expect(() =>
			evaluateDirector({
				store,
				storyId: "s1",
				nodeId,
				config: {
					...DEFAULT_DIRECTOR_CONFIG,
					openingIntensity: "hype" as never,
				},
			}),
		).toThrow("openingIntensity");
	});
});

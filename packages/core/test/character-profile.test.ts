import { describe, expect, it } from "vitest";
import {
	type NewSceneArchive,
	type StoryStore,
	assembleContext,
	createDefaultContextTemplate,
	createProfileSlotProvider,
	readCharacterProfiles,
	readSceneKnowledge,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "assistant" | "user",
	raw: string,
): void {
	store.appendNode({ id, storyId: "s1", parentId, role, raw });
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "档案" });
	append(store, "a1", null, "assistant", "凛、老师和门卫站在教室门口。");
	append(store, "u1", "a1", "user", "我走进去。");
	append(store, "a2", "u1", "assistant", "凛把信收起来，老师看着她。");
	append(store, "u2", "a2", "user", "我问信在哪里。");
	append(store, "a3", "u2", "assistant", "老师把凛的事转述给商人，商人点头。");
	append(store, "u3", "a3", "user", "商人看了我一眼。");
	append(store, "a4", "u3", "assistant", "老师把商人的话告诉凛，凛离开。");
}

function archive(
	store: StoryStore,
	input: Omit<NewSceneArchive, "storyId">,
): void {
	store.saveSceneArchive({ ...input, storyId: "s1" });
}

function seedArchives(store: StoryStore): void {
	archive(store, {
		endNodeId: "a2",
		startNodeId: "a1",
		floorCount: 2,
		boundary: "scene-ends",
		summary: "凛在教室收起信，老师看见了。",
		present: ["凛", "老师"],
		profiles: [
			{
				who: "凛",
				want: "拿回那封信",
				hide: "她其实已经烧了信",
				speech: "「把书还我。」",
				unresolved: "信最后在谁手里",
			},
		],
		informed: [],
		stateChanges: [],
		cluesOpened: ["信"],
		cluesClosed: [],
	});
	archive(store, {
		endNodeId: "a3",
		startNodeId: "a3",
		floorCount: 1,
		boundary: "scene-ends",
		summary: "老师把凛烧信的事转述给商人。",
		present: ["老师", "商人", "门卫"],
		profiles: [
			{
				who: "老师",
				want: "查清信的下落",
				hide: null,
				speech: null,
				unresolved: null,
			},
		],
		informed: [{ who: "商人", factId: "a2", via: "relayed" }],
		stateChanges: [],
		cluesOpened: [],
		cluesClosed: [],
	});
	archive(store, {
		endNodeId: "a4",
		startNodeId: "a4",
		floorCount: 1,
		boundary: "max-floors",
		summary: "老师把商人的话当面告诉凛。",
		present: ["凛", "老师"],
		profiles: [
			{
				who: "凛",
				want: "离开这里",
				hide: null,
				speech: null,
				unresolved: null,
			},
		],
		informed: [{ who: "凛", factId: "a3", via: "told" }],
		stateChanges: [],
		cluesOpened: [],
		cluesClosed: [],
	});
}

describe("人物档案", () => {
	it("按路径累加，每条带出处场次，上次出场取最后一场", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedArchives(store);
		const profiles = readCharacterProfiles(store, "a4");
		const rin = profiles.find((profile) => profile.who === "凛");
		expect(rin?.notes.map((note) => note.field)).toEqual([
			"want",
			"hide",
			"speech",
			"unresolved",
			"want",
		]);
		expect(rin?.notes[0]).toEqual({
			field: "want",
			text: "拿回那封信",
			sceneEndNodeId: "a2",
			sceneStartNodeId: "a1",
		});
		expect(rin?.notes[4]?.sceneEndNodeId).toBe("a4");
		expect(rin?.lastScene).toEqual({ endNodeId: "a4", startNodeId: "a4" });
		const gatekeeper = profiles.find((profile) => profile.who === "门卫");
		expect(gatekeeper?.notes).toEqual([]);
		expect(gatekeeper?.lastScene?.endNodeId).toBe("a3");
	});

	it("分支切换后只累加当前分支上的场次", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedArchives(store);
		append(store, "b3", "u2", "assistant", "凛在另一条分支里沉默。");
		archive(store, {
			endNodeId: "b3",
			startNodeId: "b3",
			floorCount: 1,
			boundary: "max-floors",
			summary: "凛在另一条分支里沉默。",
			present: ["凛"],
			profiles: [
				{
					who: "凛",
					want: null,
					hide: "她还在等老师开口",
					speech: null,
					unresolved: null,
				},
			],
			informed: [],
			stateChanges: [],
			cluesOpened: [],
			cluesClosed: [],
		});
		const rin = readCharacterProfiles(store, "b3").find(
			(profile) => profile.who === "凛",
		);
		expect(rin?.notes).toHaveLength(5);
		expect(rin?.notes.at(-1)?.text).toBe("她还在等老师开口");
		expect(rin?.notes.some((note) => note.sceneEndNodeId === "a4")).toBe(false);
		const scenes = readSceneKnowledge(store, "b3");
		expect(scenes.facts.map((fact) => fact.endNodeId)).toEqual(["a2", "b3"]);
	});

	it("在那一场里就算知情，没到场且没被告知的列为不知情", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedArchives(store);
		const knowledge = readSceneKnowledge(store, "a4");
		const first = knowledge.facts.find((fact) => fact.endNodeId === "a2");
		expect(first?.present).toEqual(["凛", "老师"]);
		const second = knowledge.facts.find((fact) => fact.endNodeId === "a3");
		expect(second?.present).toEqual(["老师", "商人", "门卫"]);
		expect(second?.uninformed).toEqual([]);
	});

	it("之后被当面告知也算知情", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedArchives(store);
		const third = readSceneKnowledge(store, "a4").facts.find(
			(fact) => fact.endNodeId === "a3",
		);
		expect(third?.uninformed).not.toContain("凛");
	});

	it("之后听人转述也算知情", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedArchives(store);
		const first = readSceneKnowledge(store, "a4").facts.find(
			(fact) => fact.endNodeId === "a2",
		);
		expect(first?.uninformed).not.toContain("商人");
		expect(first?.uninformed).toContain("门卫");
	});

	it("旧的 knowledge 事实参与推导", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedArchives(store);
		const before = readSceneKnowledge(store, "a4").facts.find(
			(fact) => fact.endNodeId === "a2",
		);
		expect(before?.uninformed).toContain("门卫");
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a4",
				path: ["knowledge", "门卫", "传闻"],
				op: "set",
				value: { factId: "a2", text: "门卫听说了信的事" },
				source: "settler",
			},
		]);
		const after = readSceneKnowledge(store, "a4").facts.find(
			(fact) => fact.endNodeId === "a2",
		);
		expect(after?.uninformed).not.toContain("门卫");
	});

	it("没有归档时不注入，有归档时档案与知情标注进入上下文 Trace", async () => {
		const empty = openTempStore();
		seedStory(empty.store);
		expect(
			createProfileSlotProvider(empty.store).provide({
				slot: "profile",
				storyId: "s1",
				nodeId: "a4",
				switches: {},
				state: undefined,
			}),
		).toBeNull();

		const { store } = openTempStore();
		seedStory(store);
		seedArchives(store);
		const provider = createProfileSlotProvider(store);
		const content = await provider.provide({
			slot: "profile",
			storyId: "s1",
			nodeId: "a4",
			switches: {},
			state: undefined,
		});
		expect(content?.messages[0]?.content).toContain("人物档案：");
		expect(content?.messages[0]?.content).toContain(
			"想要：离开这里（场次 a4）",
		);
		expect(content?.messages[0]?.content).toContain("上次出场：场次 a4");
		expect(content?.messages[0]?.content).toContain("门卫不在场、不知情");
		expect(content?.source).toBe("profile:2 人，知情标注 2 场");

		const assembled = await assembleContext({
			template: createDefaultContextTemplate({
				structuredOutput: "text-tags",
			}),
			budgetTokens: 100_000,
			storyId: "s1",
			nodeId: "a4",
			providers: { profile: provider },
		});
		const entry = assembled.trace.entries.find(
			(segment) => segment.segmentId === "profile",
		);
		expect(entry?.status).toBe("included");
		expect(entry?.source).toBe(content?.source);
	});

	it("档案与知情记录只能指向在场的角色和更早的已归档场次", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedArchives(store);
		expect(() =>
			archive(store, {
				endNodeId: "a4",
				startNodeId: "a4",
				floorCount: 1,
				boundary: "max-floors",
				summary: "覆盖同一场。",
				present: ["凛"],
				profiles: [
					{
						who: "商人",
						want: "知道真相",
						hide: null,
						speech: null,
						unresolved: null,
					},
				],
				informed: [],
				stateChanges: [],
				cluesOpened: [],
				cluesClosed: [],
			}),
		).toThrow("不在这场");
		expect(() =>
			archive(store, {
				endNodeId: "a4",
				startNodeId: "a4",
				floorCount: 1,
				boundary: "max-floors",
				summary: "覆盖同一场。",
				present: ["凛"],
				profiles: [],
				informed: [{ who: "凛", factId: "a4", via: "told" }],
				stateChanges: [],
				cluesOpened: [],
				cluesClosed: [],
			}),
		).toThrow("更早的楼层");
	});
});

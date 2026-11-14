import { describe, expect, it } from "vitest";
import {
	type StoryStore,
	createReunionSlotProvider,
	formatReunionMention,
	readReunionCandidates,
	selectReunionMentions,
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
	store.createStory({ id: "s1", title: "重逢" });
	append(store, "a1", null, "assistant", "凛把信收进口袋，老师站在门口。");
	append(store, "u1", "a1", "user", "我点头。");
	append(store, "a2", "u1", "assistant", "我把教室的灯关掉。");
	append(store, "u2", "a2", "user", "我走出门。");
	append(store, "a3", "u2", "assistant", "商人合上账本。");
	append(store, "u3", "a3", "user", "我问他。");
	append(store, "a4", "u3", "assistant", "夜色沉下来。");
	append(store, "u4", "a4", "user", "我打听凛的下落。");
}

function seedArchives(store: StoryStore): void {
	store.saveSceneArchive({
		storyId: "s1",
		endNodeId: "a2",
		startNodeId: "a1",
		floorCount: 2,
		boundary: "scene-ends",
		summary: "凛收起信，老师看见了。",
		present: ["凛", "老师"],
		profiles: [
			{
				who: "凛",
				want: "拿回那封信",
				hide: null,
				speech: "「把书还我。」",
				unresolved: "信最后在谁手里",
			},
		],
		informed: [],
		stateChanges: [
			{
				path: ["scene", "places", "旧教室", "description"],
				change: "教室被清空",
			},
			{ path: ["item", "旧信", "holder"], change: "信到了凛手里" },
		],
		cluesOpened: [],
		cluesClosed: [],
	});
	store.saveSceneArchive({
		storyId: "s1",
		endNodeId: "a4",
		startNodeId: "a3",
		floorCount: 2,
		boundary: "max-floors",
		summary: "商人和我谈完离开。",
		present: ["商人"],
		profiles: [],
		informed: [],
		stateChanges: [],
		cluesOpened: [],
		cluesClosed: [],
	});
}

function writeLedger(store: StoryStore): void {
	const diffs = [
		{
			path: ["scene", "places", "旧教室", "description"],
			value: "教室的窗玻璃碎了",
		},
		{ path: ["item", "旧信", "holder"], value: "凛" },
		{ path: ["item", "旧信", "location"], value: "书包夹层" },
	] as const;
	store.appendStateDiffs(
		diffs.map((diff) => ({
			storyId: "s1",
			nodeId: "a1",
			path: [...diff.path],
			op: "set" as const,
			value: diff.value,
			source: "model" as const,
		})),
	);
}

function seedEntities(store: StoryStore): void {
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "凛",
		source: "card",
		aliases: ["小凛"],
	});
	store.upsertEntity({
		storyId: "s1",
		kind: "location",
		name: "旧教室",
		source: "card",
		aliases: ["老教室"],
	});
	store.upsertEntity({
		storyId: "s1",
		kind: "item",
		name: "旧信",
		source: "card",
		aliases: ["那封信"],
	});
}

function seed(): StoryStore {
	const { store } = openTempStore();
	seedStory(store);
	seedArchives(store);
	writeLedger(store);
	seedEntities(store);
	return store;
}

function request(nodeId = "u4") {
	return {
		slot: "reunion" as const,
		storyId: "s1",
		nodeId,
		switches: {},
		state: undefined,
	};
}

describe("重逢注入", () => {
	it("候选带上次出场的场次、未了结的事与台账里的现况", () => {
		const store = seed();
		const candidates = readReunionCandidates(store, "s1", "u4");
		const rin = candidates.find((candidate) => candidate.name === "凛");
		expect(rin?.kind).toBe("character");
		expect(rin?.lastScene).toEqual({
			endNodeId: "a2",
			startNodeId: "a1",
			summary: "凛收起信，老师看见了。",
		});
		expect(rin?.unresolved).toEqual([
			{ text: "信最后在谁手里", sceneEndNodeId: "a2" },
		]);
		const place = candidates.find((candidate) => candidate.name === "旧教室");
		expect(place?.kind).toBe("place");
		expect(place?.change).toBe("教室被清空");
		expect(place?.description).toBe("教室的窗玻璃碎了");
		const item = candidates.find((candidate) => candidate.name === "旧信");
		expect(item?.kind).toBe("item");
		expect(item?.description).toBe("持有人 凛；位置 书包夹层");
	});

	it("久未出场的人物被提到时命中，内容含上次场次与未了结", () => {
		const store = seed();
		const mentions = selectReunionMentions({
			store,
			storyId: "s1",
			nodeId: "u4",
			triggerText: "我打听凛的下落。",
			recentFloors: 2,
		});
		expect(mentions).toHaveLength(1);
		const first = mentions[0];
		expect(first?.candidate.name).toBe("凛");
		expect(first?.matched).toBe("凛");
		if (first === undefined) throw new Error("没有命中");
		const text = formatReunionMention(first);
		expect(text).toContain("上次出场：场次 a2（起于 a1）");
		expect(text).toContain("未了结：信最后在谁手里（场次 a2）");
	});

	it("地点重访与物品被拿出各算一次命中，别名可触发", () => {
		const store = seed();
		const mentions = selectReunionMentions({
			store,
			storyId: "s1",
			nodeId: "u4",
			triggerText: "我走回老教室，掏出那封信。",
			recentFloors: 2,
		});
		const names = mentions.map((mention) => mention.candidate.name);
		expect(names).toEqual(["旧教室", "旧信"]);
		expect(mentions.map((mention) => mention.matched)).toEqual([
			"老教室",
			"那封信",
		]);
		const place = mentions[0];
		const item = mentions[1];
		if (place === undefined || item === undefined) {
			throw new Error("没有同时命中地点与物品");
		}
		expect(formatReunionMention(place)).toContain("最近变化：教室被清空");
		expect(formatReunionMention(item)).toContain("持有人 凛");
	});

	it("最近窗口里出现过或没有任何提及时不注入", () => {
		const store = seed();
		const recent = selectReunionMentions({
			store,
			storyId: "s1",
			nodeId: "u4",
			triggerText: "我打听凛的下落。",
		});
		expect(recent).toEqual([]);
		const silent = selectReunionMentions({
			store,
			storyId: "s1",
			nodeId: "u4",
			triggerText: "我看看窗外。",
			recentFloors: 2,
		});
		expect(silent).toEqual([]);
		append(store, "u5", "a4", "user", "我看看窗外。");
		const provider = createReunionSlotProvider(store, { recentFloors: 2 });
		expect(provider.provide(request("u5"))).toBeNull();
	});

	it("槽位返回一条 system 消息，来源带种类计数", () => {
		const store = seed();
		append(store, "u5", "a4", "user", "我走回老教室。");
		const provider = createReunionSlotProvider(store, { recentFloors: 2 });
		const content = provider.provide(request("u5"));
		expect(content?.messages).toHaveLength(1);
		expect(content?.messages[0]?.role).toBe("system");
		expect(content?.messages[0]?.content).toContain("重逢档案：");
		expect(content?.source).toBe("reunion:地点 1");
	});

	it("场记显示人物还在场时不注入", () => {
		const store = seed();
		store.saveSceneLog({
			nodeId: "a4",
			storyId: "s1",
			beat: "夜",
			present: ["凛"],
			sceneEnds: false,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		const mentions = selectReunionMentions({
			store,
			storyId: "s1",
			nodeId: "u4",
			triggerText: "我打听凛的下落。",
			recentFloors: 2,
		});
		expect(mentions).toEqual([]);
	});

	it("导演安排登场时按导演建议触发", () => {
		const store = seed();
		store.saveDirectorLines({
			nodeId: "a1",
			storyId: "s1",
			diffs: [
				{
					action: "set",
					line: {
						id: "信",
						kind: "promise",
						who: "凛",
						want: "拿回属于她的东西",
						obstacle: "时间不多了",
						countdown: 1,
						preparations: [],
					},
				},
			],
		});
		const provider = createReunionSlotProvider(store, {
			recentFloors: 2,
			directorOrganization: "lines",
			directorPush: "jump",
		});
		append(store, "u5", "a4", "user", "继续。");
		const content = provider.provide(request("u5"));
		expect(content?.messages[0]?.content).toContain("凛（人物）");
		expect(content?.source).toBe("reunion:人物 1");
	});
});

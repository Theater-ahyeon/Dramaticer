import { describe, expect, it } from "vitest";
import {
	DEFAULT_SERIAL_RECAP_SCENES,
	DEFAULT_SERIAL_STALE_HOURS,
	type StoryStore,
	readSerialView,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "assistant" | "user",
	createdAt: string,
): void {
	store.appendNode({
		id,
		storyId: "s1",
		parentId,
		role,
		raw: `${id} 的正文`,
		createdAt,
	});
}

function saveLog(
	store: StoryStore,
	nodeId: string,
	present: readonly string[],
	sceneEnds: boolean,
): void {
	store.saveSceneLog({
		nodeId,
		storyId: "s1",
		beat: "试探",
		present,
		sceneEnds,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
}

/**
 * 三场：a1–a2 已归档（凛、悠在教室），a3–a4 已归档（凛在天台），
 * a5 是还没结束的一楼。章末清点落在 a4。
 */
function seedSerial(store: StoryStore): void {
	store.createStory({ id: "s1", title: "连载测试" });
	append(store, "a1", null, "assistant", "2026-11-13T00:00:00.000Z");
	append(store, "u1", "a1", "user", "2026-11-13T00:05:00.000Z");
	append(store, "a2", "u1", "assistant", "2026-11-13T00:10:00.000Z");
	append(store, "u2", "a2", "user", "2026-11-13T00:15:00.000Z");
	append(store, "a3", "u2", "assistant", "2026-11-13T00:20:00.000Z");
	append(store, "u3", "a3", "user", "2026-11-13T00:25:00.000Z");
	append(store, "a4", "u3", "assistant", "2026-11-13T00:30:00.000Z");
	append(store, "u4", "a4", "user", "2026-11-13T00:35:00.000Z");
	append(store, "a5", "u4", "assistant", "2026-11-14T10:00:00.000Z");
	saveLog(store, "a2", ["凛", "悠"], true);
	saveLog(store, "a4", ["凛"], true);
	saveLog(store, "a5", ["凛", "你"], false);
	store.saveSceneArchive({
		endNodeId: "a2",
		storyId: "s1",
		startNodeId: "a1",
		floorCount: 2,
		boundary: "scene-ends",
		summary: "凛在教室试探你，悠在旁边看着。",
		present: ["凛", "悠"],
		profiles: [
			{
				who: "凛",
				want: "看清你的来意",
				hide: null,
				speech: "别装了。",
				unresolved: "那封信还没有交出去",
			},
		],
		informed: [],
		stateChanges: [{ path: ["scene", "current", "place"], change: "留在教室" }],
		cluesOpened: [],
		cluesClosed: [],
	});
	store.saveSceneArchive({
		endNodeId: "a4",
		storyId: "s1",
		startNodeId: "a3",
		floorCount: 2,
		boundary: "scene-ends",
		summary: "凛把你带上天台，要你自己选。",
		present: ["凛"],
		profiles: [
			{
				who: "凛",
				want: "让你自己选",
				hide: "她也怕选错",
				speech: null,
				unresolved: null,
			},
		],
		informed: [],
		stateChanges: [
			{ path: ["scene", "current", "place"], change: "从天台看着你" },
		],
		cluesOpened: [],
		cluesClosed: [],
	});
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["scene", "current", "place"],
			op: "set",
			value: "教室",
			source: "settler",
		},
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["time", "current"],
			op: "set",
			value: "第一天傍晚",
			source: "settler",
		},
		{
			storyId: "s1",
			nodeId: "a3",
			path: ["time", "current"],
			op: "set",
			value: "第二天清晨",
			source: "player",
		},
		{
			storyId: "s1",
			nodeId: "a4",
			path: ["scene", "current", "place"],
			op: "set",
			value: "天台",
			source: "settler",
		},
		{
			storyId: "s1",
			nodeId: "a3",
			path: ["relation", "凛", "你", "type"],
			op: "set",
			value: "同班同学",
			source: "settler",
		},
		{
			storyId: "s1",
			nodeId: "a3",
			path: ["relation", "凛", "你", "stage"],
			op: "set",
			value: "试探",
			source: "settler",
		},
		{
			storyId: "s1",
			nodeId: "a3",
			path: ["character", "凛", "tier"],
			op: "set",
			value: "lead",
			source: "settler",
		},
		{
			storyId: "s1",
			nodeId: "a3",
			path: ["character", "凛", "status"],
			op: "set",
			value: "平静",
			source: "settler",
		},
	]);
	store.saveDirectorLines({
		nodeId: "a3",
		storyId: "s1",
		diffs: [
			{
				action: "set",
				line: {
					id: "l1",
					kind: "main",
					who: "凛",
					want: "让玩家说出真相",
					obstacle: "玩家还在躲",
					countdown: null,
					preparations: [],
				},
			},
			{
				action: "set",
				line: {
					id: "l2",
					kind: "relationship",
					who: "凛",
					want: "建立信任",
					obstacle: "两人都在试探",
					countdown: null,
					preparations: [],
				},
			},
		],
	});
	store.saveDirectorChapterReview({
		nodeId: "a4",
		storyId: "s1",
		payload: { promises: [], focus: ["l1", "l2"] },
	});
}

describe("连载视图", () => {
	it("章节目录、前情提要、人物关系页与时间线读同一份派生", () => {
		const { store } = openTempStore();
		seedSerial(store);
		const view = readSerialView(store, "s1", {
			now: new Date("2026-11-14T11:00:00.000Z"),
		});
		expect(view.storyId).toBe("s1");
		expect(view.nodeId).toBe("a5");
		expect(view.chapters).toEqual([
			{
				ordinal: 1,
				startNodeId: "a1",
				endNodeId: "a4",
				floorCount: 4,
				sceneOrdinals: [1, 2],
				focusLineIds: ["l1", "l2"],
			},
			{
				ordinal: 2,
				startNodeId: "a5",
				endNodeId: null,
				floorCount: 1,
				sceneOrdinals: [3],
				focusLineIds: [],
			},
		]);
		expect(view.recap).toEqual({
			stale: false,
			staleHours: DEFAULT_SERIAL_STALE_HOURS,
			lastPlayedAt: "2026-11-14T10:00:00.000Z",
			scenes: [
				{
					endNodeId: "a2",
					startNodeId: "a1",
					summary: "凛在教室试探你，悠在旁边看着。",
					present: ["凛", "悠"],
					place: "教室",
					storyTime: "第一天傍晚",
				},
				{
					endNodeId: "a4",
					startNodeId: "a3",
					summary: "凛把你带上天台，要你自己选。",
					present: ["凛"],
					place: "天台",
					storyTime: "第二天清晨",
				},
			],
		});
		expect(view.recap.scenes).toHaveLength(DEFAULT_SERIAL_RECAP_SCENES - 1);
		const lin = view.cast.find((character) => character.who === "凛");
		expect(lin).toEqual({
			who: "凛",
			present: true,
			tier: "lead",
			status: "平静",
			location: null,
			lastScene: { endNodeId: "a4", startNodeId: "a3" },
			notes: [
				{
					field: "want",
					label: "想要",
					text: "看清你的来意",
					sceneEndNodeId: "a2",
					sceneStartNodeId: "a1",
				},
				{
					field: "speech",
					label: "说话样本",
					text: "别装了。",
					sceneEndNodeId: "a2",
					sceneStartNodeId: "a1",
				},
				{
					field: "unresolved",
					label: "未了结",
					text: "那封信还没有交出去",
					sceneEndNodeId: "a2",
					sceneStartNodeId: "a1",
				},
				{
					field: "want",
					label: "想要",
					text: "让你自己选",
					sceneEndNodeId: "a4",
					sceneStartNodeId: "a3",
				},
				{
					field: "hide",
					label: "瞒着",
					text: "她也怕选错",
					sceneEndNodeId: "a4",
					sceneStartNodeId: "a3",
				},
			],
			relations: [
				{
					from: "凛",
					to: "你",
					type: "同班同学",
					stage: "试探",
					affectionInner: null,
					affectionOuter: null,
				},
			],
			uninformedScenes: [],
		});
		const you = view.cast.find((character) => character.who === "你");
		expect(you?.present).toBe(true);
		expect(you?.uninformedScenes).toEqual([]);
		const yu = view.cast.find((character) => character.who === "悠");
		expect(yu?.notes).toEqual([]);
		expect(yu?.uninformedScenes).toEqual([
			{
				endNodeId: "a4",
				startNodeId: "a3",
				summary: "凛把你带上天台，要你自己选。",
			},
		]);
		expect(view.timeline).toEqual([
			{
				kind: "scene",
				nodeId: "a2",
				ordinal: 3,
				storyTime: "第一天傍晚",
				place: "教室",
				summary: "凛在教室试探你，悠在旁边看着。",
			},
			{
				kind: "time",
				nodeId: "a3",
				ordinal: 5,
				storyTime: "第二天清晨",
				place: null,
				summary: null,
			},
			{
				kind: "scene",
				nodeId: "a4",
				ordinal: 7,
				storyTime: "第二天清晨",
				place: "天台",
				summary: "凛把你带上天台，要你自己选。",
			},
			{
				kind: "scene",
				nodeId: "a5",
				ordinal: 9,
				storyTime: "第二天清晨",
				place: "天台",
				summary: null,
			},
		]);
	});

	it("隔得够久时前情提要标记为需要展开", () => {
		const { store } = openTempStore();
		seedSerial(store);
		const fresh = readSerialView(store, "s1", {
			now: new Date("2026-11-14T21:59:59.000Z"),
		});
		expect(fresh.recap.stale).toBe(false);
		const stale = readSerialView(store, "s1", {
			now: new Date("2026-11-14T22:00:00.000Z"),
		});
		expect(stale.recap.stale).toBe(true);
	});

	it("前情提要的场次数与阈值可以配置", () => {
		const { store } = openTempStore();
		seedSerial(store);
		const view = readSerialView(store, "s1", {
			now: new Date("2026-11-14T11:00:00.000Z"),
			recapScenes: 1,
			staleHours: 2,
		});
		expect(view.recap.scenes.map((scene) => scene.endNodeId)).toEqual(["a4"]);
		expect(view.recap.stale).toBe(false);
		expect(view.recap.staleHours).toBe(2);
	});

	it("分支切换后只保留当前路径的场次与档案", () => {
		const { store } = openTempStore();
		seedSerial(store);
		store.appendNode({
			id: "b1",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "另一条分支。",
		});
		saveLog(store, "b1", ["悠"], true);
		store.saveSceneArchive({
			endNodeId: "b1",
			storyId: "s1",
			startNodeId: "b1",
			floorCount: 1,
			boundary: "scene-ends",
			summary: "另一条分支上的事。",
			present: ["悠"],
			profiles: [],
			informed: [],
			stateChanges: [],
			cluesOpened: [],
			cluesClosed: [],
		});
		store.setHead("s1", "b1");
		const view = readSerialView(store, "s1", {
			now: new Date("2026-11-13T01:00:00.000Z"),
		});
		expect(view.chapters).toEqual([
			{
				ordinal: 1,
				startNodeId: "a1",
				endNodeId: null,
				floorCount: 2,
				sceneOrdinals: [1],
				focusLineIds: [],
			},
		]);
		expect(view.recap.scenes.map((scene) => scene.endNodeId)).toEqual(["b1"]);
		expect(view.cast.map((character) => character.who)).toEqual(["悠"]);
	});

	it("没有楼层的故事返回空视图", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空故事" });
		expect(readSerialView(store, "s1")).toEqual({
			storyId: "s1",
			nodeId: null,
			chapters: [],
			cast: [],
			timeline: [],
			recap: {
				stale: false,
				staleHours: DEFAULT_SERIAL_STALE_HOURS,
				lastPlayedAt: null,
				scenes: [],
			},
		});
	});

	it("故事不存在或楼层不属于这个故事时直接失败", () => {
		const { store } = openTempStore();
		seedSerial(store);
		expect(() => readSerialView(store, "missing")).toThrow("故事不存在");
		expect(() => readSerialView(store, "s1", { nodeId: "nope" })).toThrow(
			"楼层节点不存在",
		);
	});
});

import { describe, expect, it } from "vitest";
import {
	type BlueprintEntry,
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintVolume,
	type DirectorLine,
	type StoryStore,
	applyDirectionEdit,
	readDirectionView,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const PREMISE: BlueprintPremise = {
	id: "premise",
	kind: "premise",
	source: "player",
	locked: true,
	coreQuestion: "这座灯塔为谁而亮？",
	tone: "潮湿、克制",
	endings: [],
	redLines: ["第三卷之前，阿蘅不能出事"],
	tension: "medium",
};

const VOLUME: BlueprintVolume = {
	id: "vol-1",
	kind: "volume",
	source: "player",
	locked: false,
	title: "卷一 · 雾起",
	coreQuestion: "那箱货里到底是什么",
	startState: "你刚到雾港",
	endState: "第一箱货被截下",
};

const MILESTONE: BlueprintMilestone = {
	id: "m-1",
	kind: "milestone",
	source: "player",
	locked: false,
	volumeId: "vol-1",
	want: "在七号码头截下贺九的第一箱货",
	prerequisites: ["拿到值更簿"],
	after: [],
	hardness: "hard",
};

function line(overrides: Partial<DirectorLine> = {}): DirectorLine {
	return {
		id: "line-1",
		kind: "main",
		who: "贺九",
		want: "把货送上船",
		obstacle: "码头被盯上了",
		countdown: null,
		preparations: [],
		...overrides,
	};
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "走向测试" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "雾港的灯在雨里亮了三次。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我走向码头。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "贺九把手按在货箱上。",
	});
	store.saveStoryBlueprintBaseline("s1", [PREMISE, VOLUME, MILESTONE]);
	store.saveDirectorLines({
		nodeId: "a1",
		storyId: "s1",
		diffs: [
			{ action: "set", line: line() },
			{
				action: "set",
				line: line({
					id: "rel-1",
					kind: "relationship",
					who: "阿蘅",
					want: "把值更簿交给你",
					obstacle: "她还没拿定主意",
				}),
			},
		],
	});
	store.insertPlotNotes([
		{
			id: "note-old",
			storyId: "s1",
			sourceNodeId: "a1",
			text: "值更簿缺的那一页",
			createdAt: "2026-01-01T00:00:00.000Z",
		},
	]);
	store.saveDirectorLines({
		nodeId: "a2",
		storyId: "s1",
		diffs: [
			{
				action: "set",
				line: line({
					id: "prom-1",
					kind: "promise",
					who: "贺九",
					want: "那箱货里有一盏灯",
					obstacle: "箱子的锁没开",
				}),
			},
		],
	});
	store.insertPlotNotes([
		{
			id: "note-new",
			storyId: "s1",
			sourceNodeId: "a2",
			text: "码头尽头多了一艘没有名字的船",
			createdAt: "2026-01-02T00:00:00.000Z",
		},
	]);
	store.saveSceneLog({
		nodeId: "a2",
		storyId: "s1",
		beat: "对峙",
		present: ["贺九"],
		sceneEnds: false,
		sceneCard: {
			present: [{ who: "贺九", want: "让你先开价" }],
			change: "贺九把货箱的钥匙推到你面前",
		},
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
}

function entries(store: StoryStore): BlueprintEntry[] {
	return store.readBlueprintEntries("a2");
}

describe("剧情走向两栏", () => {
	it("旧故事只有原来的记录时也能读出完整两栏", () => {
		const { store } = openTempStore();
		seed(store);
		const view = readDirectionView(store, "s1");
		expect(view.nodeId).toBe("a2");
		expect(view.tension).toBe("medium");
		expect(view.wants.map((item) => item.id)).toEqual([
			"premise:question",
			"premise:tone",
			"premise:red-lines",
			"volume:vol-1",
			"milestone:m-1",
			"line:line-1",
			"scene",
		]);
		expect(view.wants.find((item) => item.id === "premise:tone")?.text).toBe(
			"潮湿、克制",
		);
		expect(view.wants.find((item) => item.id === "milestone:m-1")?.detail).toBe(
			"要先埋：拿到值更簿",
		);
		expect(view.wants.find((item) => item.id === "line:line-1")?.text).toBe(
			"贺九想要把货送上船",
		);
		expect(view.wants.find((item) => item.id === "scene")?.text).toBe(
			"贺九把货箱的钥匙推到你面前",
		);
		// 越老越靠前：a1 上的关系线与旧笔记排在 a2 之前。
		expect(view.opens.map((item) => item.id)).toEqual([
			"line:rel-1",
			"note:note-old",
			"line:prom-1",
			"note:note-new",
		]);
		expect(view.opens.find((item) => item.id === "note:note-old")?.label).toBe(
			"场记",
		);
	});

	it("编辑自动锁定，锁定后后台写不进来", () => {
		const { store } = openTempStore();
		seed(store);
		applyDirectionEdit(store, "s1", {
			op: "edit-want",
			id: "milestone:m-1",
			text: "在七号码头截下贺九的第二箱货",
		});
		const edited = readDirectionView(store, "s1").wants.find(
			(item) => item.id === "milestone:m-1",
		);
		expect(edited?.text).toBe("在七号码头截下贺九的第二箱货");
		expect(edited?.locked).toBe(true);
		const stored = entries(store).find((item) => item.id === "m-1");
		expect(stored?.source).toBe("player");
		expect(stored?.locked).toBe(true);

		applyDirectionEdit(store, "s1", {
			op: "lock-want",
			id: "line:line-1",
			locked: true,
		});
		expect(
			readDirectionView(store, "s1").wants.find(
				(item) => item.id === "line:line-1",
			)?.locked,
		).toBe(true);
		expect(() =>
			store.saveDirectorLines({
				nodeId: "a2",
				storyId: "s1",
				diffs: [{ action: "set", line: line({ want: "后台改的内容" }) }],
			}),
		).toThrow("已被玩家锁定");
	});

	it("场记笔记可以改写与收下，收下后不再出现", () => {
		const { store } = openTempStore();
		seed(store);
		applyDirectionEdit(store, "s1", {
			op: "edit-open",
			id: "note:note-old",
			text: "值更簿缺的那一页还没有补上",
		});
		const edited = readDirectionView(store, "s1").opens.find(
			(item) => item.id === "note:note-old",
		);
		expect(edited?.text).toBe("值更簿缺的那一页还没有补上");
		expect(edited?.source).toBe("player");

		applyDirectionEdit(store, "s1", {
			op: "close-open",
			id: "note:note-old",
		});
		expect(
			readDirectionView(store, "s1").opens.some(
				(item) => item.id === "note:note-old",
			),
		).toBe(false);
		// 原来的剧情笔记记录不动，只是玩家把它收下了。
		expect(store.getOpenPlotNotes("s1").map((note) => note.id)).toContain(
			"note-old",
		);
	});

	it("删除一卷会连同它下面的关键事件一起删掉", () => {
		const { store } = openTempStore();
		seed(store);
		applyDirectionEdit(store, "s1", { op: "delete-want", id: "volume:vol-1" });
		expect(entries(store).map((entry) => entry.id)).toEqual(["premise"]);
		expect(
			readDirectionView(store, "s1").wants.filter(
				(item) =>
					item.id.startsWith("volume:") || item.id.startsWith("milestone:"),
			),
		).toEqual([]);
	});

	it("新增方向写进主线方向并自动锁定", () => {
		const { store } = openTempStore();
		seed(store);
		const result = applyDirectionEdit(store, "s1", {
			op: "add-want",
			text: "我想要一场雨夜里的背叛",
		});
		const added = result.view.wants.filter((item) => item.kind === "line");
		expect(added).toHaveLength(2);
		const mine = added.find((item) => item.text === "我想要一场雨夜里的背叛");
		expect(mine?.source).toBe("player");
		expect(mine?.locked).toBe(true);
	});

	it("修改只沿当前分支生效", () => {
		const { store } = openTempStore();
		seed(store);
		store.appendNode({
			id: "b1",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw: "我转身离开码头。",
			moveHead: false,
		});
		applyDirectionEdit(store, "s1", {
			op: "edit-want",
			id: "milestone:m-1",
			text: "另一条分支上的目标",
		});
		applyDirectionEdit(store, "s1", {
			op: "edit-open",
			id: "note:note-old",
			text: "另一条分支上的笔记",
		});
		const other = readDirectionView(store, "s1", "b1");
		expect(other.wants.find((item) => item.id === "milestone:m-1")?.text).toBe(
			"在七号码头截下贺九的第一箱货",
		);
		expect(other.opens.find((item) => item.id === "note:note-old")?.text).toBe(
			"值更簿缺的那一页",
		);
		// b1 不在 a2 上：a2 的伏笔与笔记不参与这条分支。
		expect(other.opens.map((item) => item.id)).toEqual([
			"line:rel-1",
			"note:note-old",
		]);
	});

	it("本场目标也能改与锁定", () => {
		const { store } = openTempStore();
		seed(store);
		applyDirectionEdit(store, "s1", {
			op: "edit-want",
			id: "scene",
			text: "贺九让你先挑一箱货",
		});
		const edited = readDirectionView(store, "s1").wants.find(
			(item) => item.id === "scene",
		);
		expect(edited?.text).toBe("贺九让你先挑一箱货");
		expect(edited?.locked).toBe(true);

		applyDirectionEdit(store, "s1", {
			op: "lock-want",
			id: "scene",
			locked: false,
		});
		expect(
			readDirectionView(store, "s1").wants.find((item) => item.id === "scene")
				?.locked,
		).toBe(false);
	});

	it("章末已经收掉的伏笔不再算没收的线", () => {
		const { store } = openTempStore();
		seed(store);
		store.saveDirectorChapterReview({
			nodeId: "a2",
			storyId: "s1",
			payload: {
				promises: [{ lineId: "prom-1", disposition: "retire" }],
				focus: ["rel-1", "line-1"],
			},
		});
		expect(
			readDirectionView(store, "s1").opens.some(
				(item) => item.id === "line:prom-1",
			),
		).toBe(false);
	});

	it("剧透设置隐藏 AI 补的关键事件", () => {
		const { store } = openTempStore();
		seed(store);
		store.saveStoryBlueprint({
			nodeId: "a2",
			storyId: "s1",
			source: "ai",
			diffs: [
				{
					action: "set",
					entry: {
						id: "m-ai",
						kind: "milestone",
						source: "ai",
						locked: false,
						volumeId: "vol-1",
						want: "AI 补的事件",
						prerequisites: [],
						after: [],
						hardness: "soft",
					},
				},
			],
		});
		store.updateStorySettings("s1", { blueprintSpoilers: "hide" });
		const view = readDirectionView(store, "s1");
		expect(view.wants.some((item) => item.id === "milestone:m-ai")).toBe(false);
		expect(view.hidden?.total).toBe(1);
	});
});

import { describe, expect, it } from "vitest";
import { type StoryStore, exportSerialBook } from "../src/index.js";
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

function saveLog(store: StoryStore, nodeId: string, sceneEnds: boolean): void {
	store.saveSceneLog({
		nodeId,
		storyId: "s1",
		beat: "试探",
		present: ["凛"],
		sceneEnds,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
}

function saveLines(store: StoryStore, nodeId: string): void {
	store.saveDirectorLines({
		nodeId,
		storyId: "s1",
		diffs: [
			{
				action: "set",
				line: {
					id: "l1",
					kind: "main",
					who: "凛",
					want: "挡住你",
					obstacle: "你在往前走",
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
					want: "试探你",
					obstacle: "两人都在看对方",
					countdown: null,
					preparations: [],
				},
			},
		],
	});
}

/**
 * 两章：a1–a2 已归档并收在章末清点，a3 之后是还没收尾的一章；
 * 第二场没有归档，导出时只有正文。
 */
function seedBook(store: StoryStore): void {
	store.createStory({ id: "s1", title: "连载成书" });
	append(store, "a1", null, "assistant", "山门外的风很冷。");
	append(store, "u1", "a1", "user", "我推开山门。");
	append(store, "a2", "u1", "assistant", "门内传来脚步声。");
	append(store, "u2", "a2", "user", "我走进院子。");
	append(store, "a3", "u2", "assistant", "院子里没有人。");
	append(store, "u3", "a3", "user", "我喊了一声。");
	append(store, "a4", "u3", "assistant", "有人从廊下走出来。");
	saveLog(store, "a2", true);
	saveLog(store, "a3", true);
	saveLog(store, "a4", false);
	saveLines(store, "a1");
	store.saveSceneArchive({
		endNodeId: "a2",
		storyId: "s1",
		startNodeId: "a1",
		floorCount: 2,
		boundary: "scene-ends",
		summary: "凛在门口挡住你。",
		present: ["凛"],
		profiles: [],
		informed: [],
		stateChanges: [],
		cluesOpened: [],
		cluesClosed: [],
	});
	store.saveDirectorChapterReview({
		nodeId: "a2",
		storyId: "s1",
		payload: { promises: [], focus: ["l1", "l2"] },
	});
}

describe("导出成书", () => {
	it("按章节目录拼章标题、场次摘要与楼层原文", () => {
		const { store } = openTempStore();
		seedBook(store);
		const book = exportSerialBook(store, "s1");
		expect(book.nodeId).toBe("a4");
		expect(book.fileName).toBe("连载成书.md");
		expect(book.markdown).toBe(
			`${[
				"# 连载成书",
				"## 第 1 章",
				"> 凛在门口挡住你。",
				"山门外的风很冷。",
				"我推开山门。",
				"门内传来脚步声。",
				"## 第 2 章",
				"我走进院子。",
				"院子里没有人。",
				"我喊了一声。",
				"有人从廊下走出来。",
			].join("\n\n")}\n`,
		);
	});

	it("同一路径两次导出逐字节一致", () => {
		const { store } = openTempStore();
		seedBook(store);
		expect(exportSerialBook(store, "s1").markdown).toBe(
			exportSerialBook(store, "s1").markdown,
		);
	});

	it("没有章末清点时仍在写的一章带章标题", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "未分章" });
		append(store, "a1", null, "assistant", "开场。");
		append(store, "u1", "a1", "user", "我往前走。");
		const book = exportSerialBook(store, "s1");
		expect(book.markdown).toBe(
			`${["# 未分章", "## 第 1 章", "开场。", "我往前走。"].join("\n\n")}\n`,
		);
	});

	it("还没有助手楼层时只导出已有的玩家楼层，不带章标题", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "只有输入" });
		append(store, "u1", null, "user", "我推门进去。");
		const book = exportSerialBook(store, "s1");
		expect(book.nodeId).toBe("u1");
		expect(book.markdown).toBe(
			`${["# 只有输入", "我推门进去。"].join("\n\n")}\n`,
		);
	});

	it("章末之后的玩家楼层仍属于这一章", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "收尾" });
		append(store, "a1", null, "assistant", "开场。");
		append(store, "u1", "a1", "user", "我说完就走。");
		append(store, "a2", "u1", "assistant", "门关上了。");
		append(store, "u2", "a2", "user", "我关上门。");
		saveLog(store, "a2", true);
		saveLines(store, "a1");
		store.saveDirectorChapterReview({
			nodeId: "a2",
			storyId: "s1",
			payload: { promises: [], focus: ["l1", "l2"] },
		});
		const book = exportSerialBook(store, "s1");
		expect(book.markdown).toBe(
			`${[
				"# 收尾",
				"## 第 1 章",
				"开场。",
				"我说完就走。",
				"门关上了。",
				"我关上门。",
			].join("\n\n")}\n`,
		);
	});

	it("导出另一条分支时只含那条分支的楼层", () => {
		const { store } = openTempStore();
		seedBook(store);
		append(store, "b1", "u1", "assistant", "你转身离开。");
		const book = exportSerialBook(store, "s1", { nodeId: "b1" });
		expect(book.markdown).toBe(
			`${[
				"# 连载成书",
				"## 第 1 章",
				"山门外的风很冷。",
				"我推开山门。",
				"你转身离开。",
			].join("\n\n")}\n`,
		);
	});

	it("没有楼层的故事只导出标题，文件名去掉不能出现的字符", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "空/故事" });
		const book = exportSerialBook(store, "s1");
		expect(book.nodeId).toBeNull();
		expect(book.fileName).toBe("空_故事.md");
		expect(book.markdown).toBe("# 空/故事\n");
	});

	it("故事或楼层不存在时直接失败", () => {
		const { store } = openTempStore();
		seedBook(store);
		expect(() => exportSerialBook(store, "missing")).toThrow("故事不存在");
		expect(() => exportSerialBook(store, "s1", { nodeId: "nope" })).toThrow(
			"楼层节点不存在",
		);
	});
});

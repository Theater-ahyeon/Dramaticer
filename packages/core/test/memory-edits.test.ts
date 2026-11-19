import { describe, expect, it } from "vitest";
import {
	type StoryStore,
	compileWikiPage,
	compileWikiPages,
	editState,
	editWikiStatement,
	guardBackgroundWrite,
	readEditHistory,
	readEffectiveEdits,
	readMemoryPrefs,
	readMemorySecrets,
	readMemoryState,
	readMemoryTimeline,
	rollbackPlayerEdit,
	stateTargetOf,
	writeMemoryPref,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "system" | "user" | "assistant",
	raw: string,
): void {
	store.appendNode({
		id,
		storyId: "s1",
		parentId,
		role,
		raw,
	});
}

function setState(
	store: StoryStore,
	nodeId: string,
	path: readonly string[],
	value: unknown,
): void {
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId,
			path,
			op: "set",
			value,
			source: "settler",
		},
	]);
}

function addEntity(store: StoryStore, name: string): void {
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name,
		source: "card",
	});
}

const LOCATION = ["character", "凛", "location"] as const;
const LOCATION_TARGET = stateTargetOf(LOCATION);
const LOCATION_STATEMENT = `state:${LOCATION_TARGET}`;

describe("玩家直接修改记忆", () => {
	it("状态修改与后台写入走同一套校验，失败时原值不变", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant", "凛站在教室门口。");

		expect(() =>
			editState(store, "s1", "n1", ["character", "凛", "mood"], "紧张"),
		).toThrow("未知 character 字段");
		expect(() =>
			editState(
				store,
				"s1",
				"n1",
				["relation", "凛", "卫宫", "affectionInner"],
				"火热",
			),
		).toThrow("affectionInner");
		expect(readMemoryState(store, "s1", "n1")).toEqual([]);
		expect(store.listMemoryRejections("s1")).toEqual([]);

		const edit = editState(store, "s1", "n1", LOCATION, "教室");
		expect(edit).toMatchObject({ locked: true, source: "player" });
		const [item] = readMemoryState(store, "s1", "n1");
		expect(item).toMatchObject({
			target: LOCATION_TARGET,
			value: "教室",
			locked: true,
			source: "player",
		});
		expect(item?.history.at(-1)).toMatchObject({
			value: "教室",
			source: "player",
		});
	});

	it("锁定后同一分支的后台写入被拒并记录，另一条分支不受影响", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "a1", null, "assistant", "山门外的风很冷。");
		append(store, "u1", "a1", "user", "向左。");
		append(store, "a2", "u1", "assistant", "左边是钟楼。");
		append(store, "u2", "a1", "user", "向右。");
		append(store, "a3", "u2", "assistant", "右边是教室。");
		store.setHead("s1", "a2");
		setState(store, "a1", LOCATION, "教室");

		editState(store, "s1", null, LOCATION, "钟楼");
		const dropped = store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a2",
				path: LOCATION,
				op: "set",
				value: "操场",
				source: "settler",
			},
		]);
		expect(dropped).toEqual([]);
		expect(readMemoryState(store, "s1", "a2")[0]?.value).toBe("钟楼");

		const rejections = store.listMemoryRejections("s1");
		expect(rejections).toHaveLength(1);
		expect(rejections[0]).toMatchObject({ kind: "state", nodeId: "a2" });
		expect(rejections[0]?.reason).toContain("被玩家锁定");
		expect(rejections[0]?.text).toContain("操场");

		const other = readMemoryState(store, "s1", "a3")[0];
		expect(other?.value).toBe("教室");
		expect(other?.locked).toBe(false);
		expect(
			readEditHistory(store, "s1", "a3", "state", LOCATION_TARGET),
		).toEqual([]);

		expect(
			store.appendStateDiffs([
				{
					storyId: "s1",
					nodeId: "a3",
					path: LOCATION,
					op: "set",
					value: "操场",
					source: "settler",
				},
			]),
		).toHaveLength(1);
		expect(readMemoryState(store, "s1", "a3")[0]?.value).toBe("操场");
		expect(readMemoryState(store, "s1", "a2")[0]?.value).toBe("钟楼");
		expect(
			readEditHistory(store, "s1", "a2", "state", LOCATION_TARGET).map(
				(edit) => edit.source,
			),
		).toEqual(["player"]);
	});

	it("回滚恢复到选定的那一版并保持锁定", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant", "凛在教室。");
		append(store, "n2", "n1", "assistant", "凛走到操场。");
		store.setHead("s1", "n2");
		setState(store, "n1", LOCATION, "教室");
		const first = editState(store, "s1", null, LOCATION, "操场");
		editState(store, "s1", null, LOCATION, "钟楼");
		expect(
			readMemoryState(store, "s1", "n2")[0]?.history.map(
				(version) => version.value,
			),
		).toEqual(["教室", "操场", "钟楼"]);

		const rolledBack = rollbackPlayerEdit(store, "s1", null, first.id);
		expect(rolledBack).toMatchObject({
			target: LOCATION_TARGET,
			value: "操场",
			locked: true,
			source: "player",
		});
		expect(rolledBack.note).toContain(`#${first.id}`);
		expect(readMemoryState(store, "s1", "n2")[0]?.value).toBe("操场");
		expect(
			readEditHistory(store, "s1", "n2", "state", LOCATION_TARGET).map(
				(edit) => edit.value,
			),
		).toEqual(["操场", "钟楼", "操场"]);
	});

	it("回滚只接受当前分支上的修改，被拒绝的写入不能回滚", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "a1", null, "assistant", "山门外的风很冷。");
		append(store, "u1", "a1", "user", "向左。");
		append(store, "a2", "u1", "assistant", "左边是钟楼。");
		append(store, "u2", "a1", "user", "向右。");
		append(store, "a3", "u2", "assistant", "右边是教室。");
		const left = editState(store, "s1", "a2", LOCATION, "钟楼");
		expect(() => rollbackPlayerEdit(store, "s1", "a3", left.id)).toThrow(
			"不在这条分支",
		);

		store.createStory({ id: "s2", title: "另一个故事" });
		store.appendNode({
			id: "m1",
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "另一边的开场。",
		});
		const other = editState(store, "s2", "m1", LOCATION, "别处");
		expect(() => rollbackPlayerEdit(store, "s1", "a3", other.id)).toThrow(
			"修改记录不存在",
		);

		const target = "page|statement";
		store.savePlayerEdit({
			storyId: "s1",
			nodeId: "a2",
			kind: "wiki",
			target,
			value: { text: "玩家写的句子" },
			locked: true,
		});
		expect(
			guardBackgroundWrite(
				store,
				"s1",
				"a2",
				"wiki",
				target,
				{ text: "后台想改的句子" },
				"重新整理",
			),
		).toBe(false);
		const rejected = readEditHistory(store, "s1", "a2", "wiki", target).at(-1);
		expect(rejected?.source).toBe("rejected");
		expect(rejected?.id).toBeDefined();
		expect(() =>
			rollbackPlayerEdit(store, "s1", "a2", rejected?.id ?? 0),
		).toThrow("被拒绝");
	});

	it("秘密、百科语句、时间线摘要都能就地修改并锁定", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		addEntity(store, "凛");
		append(store, "n1", null, "assistant", "凛把钥匙藏进钟楼。");
		append(store, "n2", "n1", "assistant", "卫宫也来了。");
		setState(store, "n1", LOCATION, "教室");
		const [secret] = store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 0,
				text: "凛把钥匙藏进钟楼",
				participants: ["凛"],
				knowers: ["凛"],
				importance: 0.8,
			},
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 1,
				text: "卫宫在码头值夜",
				participants: ["卫宫"],
				knowers: [],
				importance: 0.2,
			},
		]);
		if (secret === undefined) throw new Error("秘密没有写入");
		store.saveSceneArchive({
			storyId: "s1",
			endNodeId: "n2",
			startNodeId: "n1",
			floorCount: 2,
			boundary: "scene-ends",
			summary: "他们找到了钥匙。",
			present: [],
			profiles: [],
			informed: [],
			stateChanges: [],
			cluesOpened: [],
			cluesClosed: [],
		});

		const [page] = compileWikiPages(store, "s1", "n2");
		if (page === undefined) throw new Error("没有汇编出百科页面");
		editWikiStatement(store, "s1", {
			pageId: page.id,
			statementId: LOCATION_STATEMENT,
			text: "凛在钟楼",
		});
		const editedPage = compileWikiPage(store, "s1", page.id, "n2");
		const statement = editedPage?.sections
			.flatMap((section) => section.statements)
			.find((item) => item.id === LOCATION_STATEMENT);
		expect(statement).toMatchObject({
			text: "凛在钟楼",
			source: "player",
			locked: true,
		});

		store.savePlayerEdit({
			storyId: "s1",
			nodeId: "n2",
			kind: "secret",
			target: secret.id,
			value: {
				text: "钥匙在钟楼的横梁上",
				knowers: ["凛", "卫宫"],
				unaware: [],
			},
			locked: true,
		});
		expect(readMemorySecrets(store, "s1", "n2")[0]).toMatchObject({
			id: secret.id,
			text: "钥匙在钟楼的横梁上",
			knowers: ["凛", "卫宫"],
			unaware: [],
			locked: true,
			edited: true,
		});

		store.savePlayerEdit({
			storyId: "s1",
			nodeId: "n2",
			kind: "summary",
			target: "n2",
			value: { text: "他们在钟楼碰头。" },
			locked: true,
		});
		expect(readMemoryTimeline(store, "s1", "n2")[0]).toMatchObject({
			id: "n2",
			summary: "他们在钟楼碰头。",
			locked: true,
		});
	});

	it("偏好改完即锁定，停用后回滚到旧的文本会重新生效", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		append(store, "n1", null, "assistant", "凛站在教室里。");

		writeMemoryPref(store, "s1", { text: "不要替我回答" });
		const [pref] = readMemoryPrefs(store, "s1", "n1");
		if (pref === undefined) throw new Error("偏好没有写入");
		expect(pref).toMatchObject({ text: "不要替我回答", disabled: false });

		writeMemoryPref(store, "s1", { id: pref.id, text: "不要替我说话" });
		const edited = readEditHistory(store, "s1", "n1", "pref", pref.id).at(-1);
		expect(edited).toMatchObject({ locked: true, source: "player" });
		if (edited === undefined) throw new Error("偏好修改没有记录");

		writeMemoryPref(store, "s1", { id: pref.id, disabled: true });
		expect(
			readMemoryPrefs(store, "s1", "n1").find((item) => item.id === pref.id),
		).toMatchObject({ disabled: true });

		const rolledBack = rollbackPlayerEdit(store, "s1", "n1", edited.id);
		expect(rolledBack).toMatchObject({
			kind: "pref",
			target: pref.id,
			locked: true,
		});
		expect(
			readMemoryPrefs(store, "s1", "n1").find((item) => item.id === pref.id),
		).toMatchObject({ text: "不要替我说话", disabled: false });
		expect(
			readEffectiveEdits(store, "s1", "n1", "pref").get(pref.id)?.locked,
		).toBe(true);
	});
});

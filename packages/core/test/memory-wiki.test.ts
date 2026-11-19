import { describe, expect, it } from "vitest";
import {
	type StoryStore,
	type WikiStatement,
	appendReflectionRecord,
	compileWikiPage,
	compileWikiPages,
	editWikiStatement,
	readMemoryRecords,
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
	store.appendStateDiff({
		storyId: "s1",
		nodeId,
		path,
		op: "set",
		value,
		source: "settler",
	});
}

function removeState(
	store: StoryStore,
	nodeId: string,
	path: readonly string[],
): void {
	store.appendStateDiff({
		storyId: "s1",
		nodeId,
		path,
		op: "delete",
		source: "settler",
	});
}

function addEntity(store: StoryStore, name: string): void {
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name,
		source: "card",
	});
}

function statementById(
	statements: readonly WikiStatement[],
	id: string,
): WikiStatement {
	const found = statements.find((statement) => statement.id === id);
	if (found === undefined) throw new Error(`没有找到语句：${id}`);
	return found;
}

function statementsOf(page: {
	sections: readonly { statements: readonly WikiStatement[] }[];
}): WikiStatement[] {
	return page.sections.flatMap((section) => [...section.statements]);
}

const LOCATION = ["character", "凛", "location"] as const;
const LOCATION_ID = `state:${JSON.stringify(LOCATION)}`;

describe("百科页面由记录汇编", () => {
	it("每句话都能追到记录与楼层", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		addEntity(store, "凛");
		append(store, "n1", null, "assistant", "凛搬进了旧校舍。");
		append(store, "n2", "n1", "assistant", "凛把钥匙藏了起来。");
		setState(store, "n1", LOCATION, "旧校舍");
		const events = store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: "n1",
				ordinal: 0,
				text: "凛搬进了旧校舍",
				participants: ["凛"],
				knowers: [],
				importance: 0.6,
			},
			{
				storyId: "s1",
				sourceNodeId: "n2",
				ordinal: 0,
				text: "凛把钥匙藏了起来",
				participants: ["凛"],
				knowers: [],
				importance: 0.4,
			},
		]);

		const [page] = compileWikiPages(store, "s1", "n2");
		if (page === undefined) throw new Error("没有汇编出页面");
		const records = new Map(
			readMemoryRecords(store, "s1", "n2").map((record) => [record.id, record]),
		);
		const statements = statementsOf(page);
		expect(statements.length).toBeGreaterThanOrEqual(3);
		for (const statement of statements) {
			expect(statement.recordId).not.toBeNull();
			const record = records.get(statement.recordId ?? "");
			expect(record).toBeDefined();
			expect(statement.nodeId).toBe(record?.nodeId);
			expect(statement.floorNo).toBe(record?.floorNo);
		}
		expect(statements.map((statement) => statement.recordId)).toEqual(
			expect.arrayContaining(events.map((event) => event.id)),
		);
	});

	it("旧说法留在演变里并标出有效范围，值不再成立时也不删掉", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		addEntity(store, "凛");
		append(store, "n1", null, "assistant", "凛在教室。");
		append(store, "n2", "n1", "assistant", "凛走到操场。");
		append(store, "n3", "n2", "assistant", "凛又回了教室。");
		append(store, "n4", "n3", "assistant", "记录里不再有凛的位置。");
		setState(store, "n1", LOCATION, "教室");
		setState(store, "n3", LOCATION, "操场");

		const [page] = compileWikiPages(store, "s1", "n3");
		if (page === undefined) throw new Error("没有汇编出页面");
		const now = page.sections.find((section) => section.title === "现在");
		const past = page.sections.find((section) => section.title === "演变");
		expect(statementById(now?.statements ?? [], LOCATION_ID).text).toBe(
			"location：操场",
		);
		expect(
			statementById(now?.statements ?? [], LOCATION_ID).validFromFloor,
		).toBe(3);
		const old = statementById(past?.statements ?? [], `${LOCATION_ID}@0`);
		expect(old.text).toBe("location：教室");
		expect(old.old).toBe(true);
		expect(old.validFromFloor).toBe(1);
		expect(old.validUntilFloor).toBe(3);

		removeState(store, "n4", LOCATION);
		const [afterDelete] = compileWikiPages(store, "s1", "n4");
		if (afterDelete === undefined) throw new Error("删除值之后没有页面");
		expect(
			afterDelete.sections.some((section) => section.title === "现在"),
		).toBe(false);
		const survived = statementById(
			afterDelete.sections.find((section) => section.title === "演变")
				?.statements ?? [],
			`${LOCATION_ID}@1`,
		);
		expect(survived.text).toBe("location：操场");
		expect(survived.old).toBe(true);
		expect(survived.validUntilFloor).toBe(4);
	});

	it("重新汇编任何一页都不改变玩家锁定的语句", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		addEntity(store, "凛");
		append(store, "n1", null, "assistant", "凛在教室。");
		setState(store, "n1", LOCATION, "教室");
		const [page] = compileWikiPages(store, "s1", "n1");
		if (page === undefined) throw new Error("没有汇编出页面");

		editWikiStatement(store, "s1", {
			pageId: page.id,
			statementId: LOCATION_ID,
			locked: true,
		});

		append(store, "n2", "n1", "assistant", "凛走到操场。");
		setState(store, "n2", LOCATION, "操场");
		const recompiled = compileWikiPage(store, "s1", page.id, "n2");
		if (recompiled === null) throw new Error("没有重新汇编出页面");
		const locked = statementById(statementsOf(recompiled), LOCATION_ID);
		expect(locked.text).toBe("location：教室");
		expect(locked.locked).toBe(true);

		append(store, "n3", "n2", "assistant", "记录里不再有凛的位置。");
		removeState(store, "n3", LOCATION);
		const afterDelete = compileWikiPage(store, "s1", page.id, "n3");
		if (afterDelete === null) throw new Error("删除值之后没有页面");
		const survived = statementById(statementsOf(afterDelete), LOCATION_ID);
		expect(survived.text).toBe("location：教室");
		expect(survived.locked).toBe(true);
		expect(survived.old).toBe(false);
	});

	it("遍历得到的每一页都能单独重新汇编", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		addEntity(store, "凛");
		addEntity(store, "卫宫");
		append(store, "n1", null, "assistant", "凛和卫宫在教室里。");
		setState(store, "n1", LOCATION, "教室");
		setState(store, "n1", ["character", "卫宫", "injury"], "擦伤");
		const pages = compileWikiPages(store, "s1", "n1");
		expect(pages).toHaveLength(2);
		for (const page of pages) {
			expect(compileWikiPage(store, "s1", page.id, "n1")).toEqual(page);
		}
		expect(compileWikiPage(store, "s1", "missing", "n1")).toBeNull();
	});

	it("章末反思作为带出处的句子进入页面", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		addEntity(store, "凛");
		append(store, "n1", null, "assistant", "凛第一次叫了他的名字。");
		append(store, "n2", "n1", "assistant", "凛离开时回头看了一眼。");
		appendReflectionRecord(store, "s1", "n2", "凛对他的态度从警惕变成了信任。");

		const [page] = compileWikiPages(store, "s1", "n2");
		if (page === undefined) throw new Error("没有汇编出页面");
		const reflection = page.sections.find(
			(section) => section.title === "反思",
		);
		expect(reflection?.statements).toHaveLength(1);
		const statement = reflection?.statements[0];
		expect(statement?.text).toBe("凛对他的态度从警惕变成了信任。");
		expect(statement?.floorNo).toBe(2);
		expect(statement?.quote).toBeNull();
		const records = readMemoryRecords(store, "s1", "n2");
		expect(
			records.find((record) => record.id === statement?.recordId)?.kind,
		).toBe("reflection");
	});
});

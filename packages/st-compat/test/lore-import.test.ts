import { StoryStore } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	importCharacterBookLore,
	importWorldInfoLore,
	parseWorldInfoJson,
	worldInfoFromCharacterBook,
} from "../src/index.js";

function openStore(): StoryStore {
	const store = StoryStore.open(":memory:");
	store.createStory({ id: "s1", title: "测试故事" });
	return store;
}

const worldJson = JSON.stringify({
	entries: {
		"0": {
			uid: 0,
			key: ["青云宗", "青云"],
			comment: "青云宗",
			content: "以剑立派的宗门",
			constant: true,
			order: 10,
		},
		"1": {
			uid: 1,
			key: ["剑冢"],
			comment: "",
			content: "埋剑之地",
		},
		"2": {
			uid: 2,
			key: ["停用"],
			comment: "停用条目",
			content: "不应导入",
			disable: true,
		},
		"3": {
			uid: 3,
			key: ["空正文"],
			comment: "空正文",
			content: "   ",
		},
	},
});

describe("世界书条目导入", () => {
	it("写入 lore 条目并关联实体，保留常驻状态与主关键词", () => {
		const store = openStore();
		const result = importWorldInfoLore(
			store,
			"s1",
			parseWorldInfoJson(worldJson),
			{ worldName: "青云世界" },
		);

		expect(result.inserted).toBe(2);
		expect(result.existing).toBe(0);
		expect(result.skipped).toBe(2);
		expect(result.entities.created).toBe(4);
		const entries = store.listLoreEntries("s1");
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			name: "青云宗",
			constant: true,
			keywords: ["青云宗", "青云"],
			source: "world-info:青云世界:0",
		});
		expect(entries[0]?.entityId).not.toBeNull();
		expect(entries[1]).toMatchObject({
			name: "剑冢",
			constant: false,
			keywords: ["剑冢"],
		});
		expect(store.getEntity(entries[0]?.entityId as string)).toMatchObject({
			kind: "lore",
			name: "青云宗",
		});
	});

	it("重复导入同一世界书不产生重复行", () => {
		const store = openStore();
		const world = parseWorldInfoJson(worldJson);
		importWorldInfoLore(store, "s1", world, { worldName: "青云世界" });
		const again = importWorldInfoLore(store, "s1", world, {
			worldName: "青云世界",
		});
		expect(again.inserted).toBe(0);
		expect(again.existing).toBe(2);
		expect(store.listLoreEntries("s1")).toHaveLength(2);
	});
});

describe("角色卡内嵌世界书", () => {
	it("把数组条目转换成世界书视图并导入 lore 条目", () => {
		const book = {
			entries: [
				{
					id: 7,
					keys: ["山门", "石门"],
					secondary_keys: [],
					comment: "山门",
					content: "山门由山神看守。",
					constant: true,
					enabled: true,
					insertion_order: 3,
				},
				{
					id: 8,
					name: "井底",
					keys: ["井底"],
					content: "井底有回声。",
					enabled: false,
				},
			],
		};
		const world = worldInfoFromCharacterBook(book, "山神");
		expect(world.name).toBe("山神");
		expect(world.entries).toHaveLength(2);
		expect(world.entries[0]).toMatchObject({
			sourceKey: "7",
			keys: ["山门", "石门"],
			comment: "山门",
			content: "山门由山神看守。",
			constant: true,
			disabled: false,
			insertionOrder: 3,
		});
		expect(world.entries[1]).toMatchObject({
			comment: "井底",
			disabled: true,
		});

		const store = openStore();
		const result = importCharacterBookLore(store, "s1", book, "山神");
		expect(result.inserted).toBe(1);
		expect(result.skipped).toBe(1);
		const entries = store.listLoreEntries("s1");
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			name: "山门",
			constant: true,
			keywords: ["山门", "石门"],
			source: "character-book:山神:7",
		});
	});

	it("跳过只有标点分隔符的名称和空正文条目，同时保留完整导入审计", () => {
		const book = {
			entries: [
				{
					id: 1,
					keys: [],
					comment: "↓↓↓↓↓↓↓↓↓↓",
					content: "分隔说明",
					enabled: true,
				},
				{
					id: 2,
					keys: ["占位"],
					comment: "占位条目",
					content: "",
					enabled: true,
				},
			],
		};
		const store = openStore();
		const result = importCharacterBookLore(store, "s1", book, "测试卡");
		expect(result.inserted).toBe(0);
		expect(result.skipped).toBe(2);
		expect(store.listImportAuditEntries("s1")).toHaveLength(2);
	});
});

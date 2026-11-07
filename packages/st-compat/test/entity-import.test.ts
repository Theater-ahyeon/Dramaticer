import { StoryStore as CoreStore, type Entity } from "@dramaticer/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
	importCharacterCardEntity,
	importWorldInfoEntities,
	parseCharacterCardJson,
	parseWorldInfoJson,
} from "../src/index.js";

const cardJson = JSON.stringify({
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "云裳",
		description: "青云宗剑修",
		nickname: "阿裳",
		extensions: {},
	},
});

const unnamedCardJson = JSON.stringify({
	spec: "chara_card_v2",
	data: { name: "", extensions: {} },
});

const worldJson = JSON.stringify({
	entries: {
		"0": {
			uid: 0,
			key: ["青云宗", "青云"],
			keysecondary: ["宗门"],
			comment: "青云宗",
			content: "以剑立派的宗门",
		},
		"1": {
			uid: 1,
			key: ["剑冢"],
			comment: "",
			content: "埋剑之地",
		},
		"2": {
			uid: 2,
			key: [],
			comment: "",
			content: "没有名字的条目",
		},
		"3": {
			uid: 3,
			key: ["……", "  "],
			comment: "标点关键词",
			content: "关键词里只有标点",
		},
	},
});

let store: CoreStore;

beforeEach(() => {
	store = CoreStore.open(":memory:");
	store.createStory({ id: "s1", title: "测试故事" });
});

function entityNamed(name: string): Entity {
	const entity = store.findEntityByName("s1", name);
	if (!entity) throw new Error(`找不到实体：${name}`);
	return entity;
}

describe("角色卡实体导入", () => {
	it("卡名成为 character 实体，昵称成为别名", () => {
		const card = parseCharacterCardJson(cardJson);
		const result = importCharacterCardEntity(store, "s1", card);
		expect(result).toEqual({ created: 1, merged: 0, aliases: 1, skipped: 0 });

		const entity = entityNamed("云裳");
		expect(entity.kind).toBe("character");
		expect(entity.description).toBe("青云宗剑修");
		expect(entity.source).toBe("character-card");
		expect(entity.aliases).toEqual(["云裳", "阿裳"]);
	});

	it("重复导入只合并，不新增实体或别名", () => {
		const card = parseCharacterCardJson(cardJson);
		importCharacterCardEntity(store, "s1", card);
		const again = importCharacterCardEntity(store, "s1", card);
		expect(again).toEqual({ created: 0, merged: 1, aliases: 0, skipped: 0 });
		expect(store.listEntities("s1")).toHaveLength(1);
	});

	it("缺少名称的卡直接抛错", () => {
		const card = parseCharacterCardJson(unnamedCardJson);
		expect(() => importCharacterCardEntity(store, "s1", card)).toThrow(
			"角色卡缺少名称",
		);
	});
});

describe("世界书实体导入", () => {
	it("注释或首个主关键词成为 lore 名称，主关键词成为别名", () => {
		const world = parseWorldInfoJson(worldJson);
		const result = importWorldInfoEntities(store, "s1", world);
		expect(result).toEqual({ created: 3, merged: 0, aliases: 1, skipped: 1 });

		const sect = entityNamed("青云宗");
		expect(sect.kind).toBe("lore");
		expect(sect.aliases).toEqual(["青云宗", "青云"]);

		expect(entityNamed("剑冢").description).toBe("埋剑之地");
		expect(entityNamed("标点关键词").aliases).toEqual(["标点关键词"]);
	});

	it("重复导入与世界书里的同名条目合并", () => {
		const world = parseWorldInfoJson(worldJson);
		importWorldInfoEntities(store, "s1", world);
		const again = importWorldInfoEntities(store, "s1", world);
		expect(again).toEqual({ created: 0, merged: 3, aliases: 0, skipped: 1 });
		expect(store.listEntities("s1")).toHaveLength(3);
	});

	it("角色卡与世界书里的同名条目合并，别名汇总到同一个实体", () => {
		importCharacterCardEntity(store, "s1", parseCharacterCardJson(cardJson));
		const world = parseWorldInfoJson(
			JSON.stringify({
				entries: {
					"0": {
						key: ["师尊"],
						comment: "云裳",
						content: "云裳的师门身份",
					},
				},
			}),
		);
		const result = importWorldInfoEntities(store, "s1", world);
		expect(result).toEqual({ created: 0, merged: 1, aliases: 1, skipped: 0 });

		const entities = store.listEntities("s1");
		expect(entities).toHaveLength(1);
		expect(entities[0]?.kind).toBe("character");
		expect(entities[0]?.aliases).toEqual(["云裳", "阿裳", "师尊"]);
	});

	it("来源标记可以覆盖", () => {
		const world = parseWorldInfoJson(worldJson);
		importWorldInfoEntities(store, "s1", world, { source: "导入测试" });
		expect(entityNamed("青云宗").source).toBe("导入测试");
	});
});

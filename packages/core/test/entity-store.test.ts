import { describe, expect, it } from "vitest";
import {
	type Entity,
	type StoryStore,
	normalizeEntityName,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function seedStories(store: StoryStore): void {
	store.createStory({ id: "s1", title: "第一个故事" });
	store.createStory({ id: "s2", title: "第二个故事" });
}

function names(entities: readonly Entity[]): string[] {
	return entities.map(
		(entity) => `${entity.storyId}:${entity.kind}:${entity.name}`,
	);
}

describe("实体名称规范化", () => {
	it("全角、大小写、空白与标点归一化到同一个键", () => {
		expect(normalizeEntityName("Ａｌｉｃｅ")).toBe("alice");
		expect(normalizeEntityName(" Alice ")).toBe("alice");
		expect(normalizeEntityName("A·lice")).toBe("alice");
		expect(normalizeEntityName("云 裳")).toBe("云裳");
		expect(normalizeEntityName("……")).toBe("");
		expect(() => normalizeEntityName(1 as unknown as string)).toThrow(
			"实体名称必须是字符串",
		);
	});
});

describe("实体存储", () => {
	it("新实体把名称登记为别名，并保留显式别名", () => {
		const { store } = openTempStore();
		seedStories(store);

		const entity = store.upsertEntity({
			id: "e1",
			storyId: "s1",
			kind: "character",
			name: "云裳",
			description: "剑修",
			source: "manual",
			aliases: ["阿裳", "Yunshang"],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(entity).toEqual({
			id: "e1",
			storyId: "s1",
			kind: "character",
			name: "云裳",
			description: "剑修",
			source: "manual",
			createdAt: "2026-01-01T00:00:00.000Z",
			aliases: ["云裳", "阿裳", "Yunshang"],
		});
		expect(store.getEntity("e1")).toEqual(entity);
		expect(store.findEntityByName("s1", " 云 裳 ")).toEqual(entity);
		expect(store.findEntityByName("s2", "云裳")).toBeNull();
	});

	it("同名实体合并：重复导入只补别名，不新建实体", () => {
		const { store } = openTempStore();
		seedStories(store);
		const first = store.upsertEntity({
			id: "e1",
			storyId: "s1",
			kind: "lore",
			name: "青云宗",
			source: "world-info",
			aliases: ["青云"],
		});

		const merged = store.upsertEntity({
			storyId: "s1",
			kind: "lore",
			name: "青云 宗",
			description: "另一个来源的描述",
			source: "world-info",
			aliases: ["青云", "青雲宗"],
		});
		expect(merged.id).toBe(first.id);
		expect(merged.name).toBe("青云宗");
		expect(merged.description).toBe("");
		expect(merged.aliases).toEqual(["青云宗", "青云", "青雲宗"]);
		expect(store.listEntities("s1")).toHaveLength(1);
	});

	it("别名按规范化去重，全角与大小写写法不新增行", () => {
		const { store } = openTempStore();
		seedStories(store);
		const created = store.upsertEntity({
			storyId: "s1",
			kind: "item",
			name: "剑",
			source: "manual",
			aliases: ["Sword", "ｓｗｏｒｄ", "宝剑"],
		});
		const updated = store.addEntityAlias(created.id, "宝剑");
		expect(updated.aliases).toEqual(["剑", "Sword", "宝剑"]);
	});

	it("同一别名可以命中多个实体，返回全部并按创建顺序排列", () => {
		const { store } = openTempStore();
		seedStories(store);
		store.upsertEntity({
			id: "e1",
			storyId: "s1",
			kind: "character",
			name: "云裳",
			source: "character-card",
			aliases: ["Yunshang"],
		});
		store.upsertEntity({
			id: "e2",
			storyId: "s1",
			kind: "lore",
			name: "剑谱残页",
			source: "world-info",
			aliases: ["云裳"],
		});

		expect(names(store.resolveEntities("云 裳", { storyId: "s1" }))).toEqual([
			"s1:character:云裳",
			"s1:lore:剑谱残页",
		]);
		expect(names(store.resolveEntities("ＹＵＮＳＨＡＮＧ"))).toEqual([
			"s1:character:云裳",
		]);
	});

	it("按故事过滤，跨故事解析返回全部命中", () => {
		const { store } = openTempStore();
		seedStories(store);
		store.upsertEntity({
			storyId: "s1",
			kind: "location",
			name: "藏经阁",
			source: "manual",
			aliases: ["书楼"],
		});
		store.upsertEntity({
			storyId: "s2",
			kind: "location",
			name: "藏书楼",
			source: "manual",
			aliases: ["书楼"],
		});

		expect(names(store.resolveEntities("书楼"))).toEqual([
			"s1:location:藏经阁",
			"s2:location:藏书楼",
		]);
		expect(names(store.resolveEntities("书楼", { storyId: "s2" }))).toEqual([
			"s2:location:藏书楼",
		]);
		expect(store.listEntities("s1", { kind: "location" })).toHaveLength(1);
		expect(store.listEntities("s1", { kind: "lore" })).toEqual([]);
	});

	it("非法输入直接抛错", () => {
		const { store } = openTempStore();
		seedStories(store);
		const base = {
			storyId: "s1",
			kind: "character",
			name: "云裳",
			source: "manual",
		} as const;

		expect(() =>
			store.upsertEntity({ ...base, kind: "宠物" as never }),
		).toThrow("实体类型不合法");
		expect(() => store.upsertEntity({ ...base, name: "……" })).toThrow(
			"实体名称去掉标点与空白后为空",
		);
		expect(() => store.upsertEntity({ ...base, name: "" })).toThrow(
			"实体名称 必须是非空字符串",
		);
		expect(() => store.upsertEntity({ ...base, storyId: "missing" })).toThrow(
			"故事不存在",
		);
		expect(() => store.upsertEntity({ ...base, aliases: [""] })).toThrow(
			"实体别名 必须是非空字符串",
		);
		expect(() => store.resolveEntities("……")).toThrow(
			"实体别名去掉标点与空白后为空",
		);
		expect(() => store.resolveEntities("云裳", { storyId: "missing" })).toThrow(
			"故事不存在",
		);
		expect(() => store.addEntityAlias("missing", "阿裳")).toThrow("实体不存在");
		expect(store.resolveEntities("不存在")).toEqual([]);
	});
});

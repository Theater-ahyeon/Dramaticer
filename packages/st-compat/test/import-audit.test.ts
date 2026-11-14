import { readFileSync } from "node:fs";
import { StoryStore } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	importCharacterBookLore,
	importWorldInfoLore,
	parseWorldInfoJson,
} from "../src/index.js";

const fixtureText = readFileSync(
	new URL("./fixtures/worldbook-audit.json", import.meta.url),
	"utf8",
);

function openStore(): StoryStore {
	const store = StoryStore.open(":memory:");
	store.createStory({ id: "s1", title: "山门" });
	return store;
}

describe("导入审计", () => {
	it("导入世界书时为全部条目写审计行，停用条目也在", () => {
		const store = openStore();
		const result = importWorldInfoLore(
			store,
			"s1",
			parseWorldInfoJson(fixtureText),
			{ worldName: "青云世界" },
		);

		expect(result.skipped).toBe(1);
		const audit = store.listImportAuditEntries("s1");
		expect(audit.map((entry) => entry.source)).toEqual([
			"world-info:青云世界:0",
			"world-info:青云世界:1",
			"world-info:青云世界:2",
			"world-info:青云世界:3",
			"world-info:青云世界:4",
		]);
		expect(audit.map((entry) => entry.kind)).toEqual([
			"common",
			"rule",
			"plugin-residue",
			"state",
			"entity",
		]);
		expect(audit[0]).toMatchObject({
			title: "世界背景",
			constant: true,
			kindSource: "rule",
			content: "灵潮退去三百年后，修行者依靠旧时代的遗物行走世间。",
		});
		expect(audit[2]).toMatchObject({
			title: "前情提要",
			constant: false,
			kind: "plugin-residue",
		});
		expect(audit[3]?.constant).toBe(true);
		const loreSources = store
			.listLoreEntries("s1")
			.map((entry) => entry.source);
		expect(loreSources).toEqual(
			audit
				.map((entry) => entry.source)
				.filter((source) => source !== "world-info:青云世界:2"),
		);
	});

	it("重复导入保留玩家改过的类型", () => {
		const store = openStore();
		const world = parseWorldInfoJson(fixtureText);
		importWorldInfoLore(store, "s1", world, { worldName: "青云世界" });
		store.setImportAuditEntryKind(
			"s1",
			"world-info:青云世界:0",
			"writing",
			"player",
		);

		importWorldInfoLore(store, "s1", world, { worldName: "青云世界" });
		const audit = store.listImportAuditEntries("s1");
		expect(audit).toHaveLength(5);
		expect(audit[0]).toMatchObject({
			kind: "writing",
			kindSource: "player",
			rulePrimary: "common",
		});
	});

	it("角色卡内嵌世界书的审计来源与 lore 条目一致", () => {
		const store = openStore();
		importCharacterBookLore(
			store,
			"s1",
			{
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
						keys: ["旧账"],
						secondary_keys: [],
						comment: "前情提要",
						content: "前情提要：上一轮玩家攻破了山门。",
						constant: false,
						enabled: false,
					},
				],
			},
			"山神",
		);

		const audit = store.listImportAuditEntries("s1");
		expect(audit.map((entry) => entry.source)).toEqual([
			"character-book:山神:7",
			"character-book:山神:8",
		]);
		expect(audit[1]).toMatchObject({
			kind: "plugin-residue",
			constant: false,
		});
		expect(store.listLoreEntries("s1").map((entry) => entry.source)).toEqual([
			"character-book:山神:7",
		]);
	});
});

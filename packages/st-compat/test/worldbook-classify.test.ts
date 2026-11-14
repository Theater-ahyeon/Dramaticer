import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type ClassifiedWorldbookEntry,
	type StWorldInfoEntry,
	type WORLDBOOK_ENTRY_KINDS,
	classifyWorldbookEntries,
	parseWorldInfoJson,
} from "../src/index.js";

const fixtureText = readFileSync(
	new URL("./fixtures/worldbook-classify.json", import.meta.url),
	"utf8",
);

function matchesOf(
	entry: ClassifiedWorldbookEntry,
	kind: (typeof WORLDBOOK_ENTRY_KINDS)[number],
): readonly string[] {
	return entry.matches.find((match) => match.kind === kind)?.rules ?? [];
}

function entryAt(
	entries: readonly ClassifiedWorldbookEntry[],
	sourceKey: string,
): ClassifiedWorldbookEntry {
	const entry = entries.find((candidate) => candidate.sourceKey === sourceKey);
	if (entry === undefined) throw new Error(`缺少条目 ${sourceKey}`);
	return entry;
}

function entryFromJson(entry: Record<string, unknown>): StWorldInfoEntry {
	const world = parseWorldInfoJson(JSON.stringify({ entries: { "0": entry } }));
	const [parsed] = world.entries;
	if (parsed === undefined) throw new Error("fixture 没有条目");
	return parsed;
}

describe("世界书条目分型", () => {
	it("fixture 覆盖十类，未知条目单独计数", () => {
		const result = classifyWorldbookEntries(
			parseWorldInfoJson(fixtureText).entries,
		);
		expect(result.counts).toEqual({
			common: 1,
			entity: 3,
			rule: 2,
			state: 1,
			conditional: 2,
			event: 1,
			writing: 1,
			presentation: 1,
			options: 1,
			"plugin-residue": 1,
			unknown: 1,
		});
		expect(result.entries).toHaveLength(13);
	});

	it("每条给出类型与规则依据", () => {
		const entries = classifyWorldbookEntries(
			parseWorldInfoJson(fixtureText).entries,
		).entries;
		expect(matchesOf(entryAt(entries, "0"), "common")).toEqual([
			"title:common",
		]);
		expect(matchesOf(entryAt(entries, "3"), "rule")).toEqual([
			"title:rule",
			"content:check",
			"content:resource",
			"content:formula",
		]);
		expect(matchesOf(entryAt(entries, "4"), "state")).toEqual([
			"title:state",
			"content:mvu",
		]);
		expect(matchesOf(entryAt(entries, "5"), "conditional")).toEqual([
			"title:conditional",
			"content:ejs-conditional",
		]);
		expect(matchesOf(entryAt(entries, "10"), "plugin-residue")).toEqual([
			"title:plugin-residue",
			"content:table",
		]);
		expect(matchesOf(entryAt(entries, "12"), "unknown")).toEqual(["no-rule"]);
	});

	it("混合条目不拆分类型，也不改动原文", () => {
		const world = parseWorldInfoJson(fixtureText);
		const mixed = world.entries.find((entry) => entry.sourceKey === "11");
		if (mixed === undefined) throw new Error("fixture 缺少混合条目");
		Object.freeze(mixed);
		Object.freeze(mixed.keys);
		Object.freeze(mixed.raw);
		const original = mixed.content;
		const classified = entryAt(
			classifyWorldbookEntries(world.entries).entries,
			"11",
		);
		expect(classified.mixed).toBe(true);
		expect(classified.matches.map((match) => match.kind)).toEqual([
			"entity",
			"rule",
			"conditional",
		]);
		expect(mixed.content).toBe(original);
		expect(Object.keys(classified)).toEqual([
			"sourceKey",
			"title",
			"matches",
			"primaryKind",
			"mixed",
		]);
	});

	it("单纯的名字归实体档案", () => {
		const entries = [
			entryFromJson({ comment: "青云宗", content: "青云宗" }),
			entryFromJson({ comment: "落霞城", content: "" }),
			entryFromJson({ comment: "人名清单", content: "苏瑾\n陆沉\n白鹿" }),
		];
		const result = classifyWorldbookEntries(entries);
		const rules = result.entries.map((entry) => matchesOf(entry, "entity"));
		expect(rules).toEqual([
			["content:name-only"],
			["content:empty"],
			["content:name-list"],
		]);
		expect(result.counts.entity).toBe(3);
		expect(result.counts.unknown).toBe(0);
	});

	it("没有命中规则的条目保留为 unknown", () => {
		const entries = [
			entryFromJson({
				comment: "附录乙",
				content: "作者没有留下可以归类的说明。",
			}),
		];
		const result = classifyWorldbookEntries(entries);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]?.primaryKind).toBe("unknown");
		expect(result.counts.unknown).toBe(1);
	});

	it("重复调用结果相同", () => {
		const first = classifyWorldbookEntries(
			parseWorldInfoJson(fixtureText).entries,
		);
		const second = classifyWorldbookEntries(
			parseWorldInfoJson(fixtureText).entries,
		);
		expect(second).toEqual(first);
	});
});

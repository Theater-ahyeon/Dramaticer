import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "../src/index.js";
import { parseWorldInfoFile, parseWorldInfoJson } from "../src/index.js";

const fullEntry: JsonObject = {
	uid: 3,
	key: ["师尊", "Master"],
	keysecondary: ["宗门"],
	comment: "人物概览",
	content: "条目正文",
	constant: false,
	selective: true,
	selectiveLogic: 2,
	order: 120,
	position: 4,
	depth: 2,
	probability: 80,
	useProbability: true,
	disable: false,
	excludeRecursion: true,
	preventRecursion: true,
	delayUntilRecursion: 2,
	group: "主要人物",
	groupOverride: false,
	groupWeight: 100,
	scanDepth: 4,
	caseSensitive: false,
	matchWholeWords: true,
	useGroupScoring: false,
	automationId: "auto-1",
	role: 1,
	sticky: 3,
	cooldown: 60,
	delay: 30,
	displayIndex: 7,
	vectorized: true,
	ignoreBudget: true,
	outletName: "outlet",
	triggers: ["门派", 2],
	extensions: { depth: 2, probability: 80 },
	未知字段: { 任意: [1, "x"] },
};

const minimalEntry: JsonObject = {
	content: "只有正文",
	key: [],
};

const world: JsonObject = {
	entries: { "0": fullEntry, "1": minimalEntry },
	originalData: {
		name: "内嵌世界书",
		entries: [{ keys: ["甲"], content: "内嵌正文", enabled: true }],
	},
};

describe("parseWorldInfoJson", () => {
	it("解析条目的主要字段", () => {
		const parsed = parseWorldInfoJson(JSON.stringify(world));
		expect(parsed.entries).toHaveLength(2);
		const [entry, minimal] = parsed.entries;
		expect(entry?.sourceKey).toBe("0");
		expect(entry?.uid).toBe(3);
		expect(entry?.keys).toEqual(["师尊", "Master"]);
		expect(entry?.secondaryKeys).toEqual(["宗门"]);
		expect(entry?.comment).toBe("人物概览");
		expect(entry?.content).toBe("条目正文");
		expect(entry?.constant).toBe(false);
		expect(entry?.selective).toBe(true);
		expect(entry?.selectiveLogic).toBe(2);
		expect(entry?.insertionOrder).toBe(120);
		expect(entry?.position).toBe(4);
		expect(entry?.depth).toBe(2);
		expect(entry?.probability).toBe(80);
		expect(entry?.useProbability).toBe(true);
		expect(entry?.disabled).toBe(false);
		expect(entry?.excludeRecursion).toBe(true);
		expect(entry?.preventRecursion).toBe(true);
		expect(entry?.delayUntilRecursion).toBe(2);
		expect(entry?.group).toBe("主要人物");
		expect(entry?.groupOverride).toBe(false);
		expect(entry?.groupWeight).toBe(100);
		expect(entry?.scanDepth).toBe(4);
		expect(entry?.caseSensitive).toBe(false);
		expect(entry?.matchWholeWords).toBe(true);
		expect(entry?.useGroupScoring).toBe(false);
		expect(entry?.automationId).toBe("auto-1");
		expect(entry?.role).toBe(1);
		expect(entry?.sticky).toBe(3);
		expect(entry?.cooldown).toBe(60);
		expect(entry?.delay).toBe(30);
		expect(entry?.displayIndex).toBe(7);
		expect(entry?.vectorized).toBe(true);
		expect(entry?.ignoreBudget).toBe(true);
		expect(entry?.outletName).toBe("outlet");
		expect(entry?.triggers).toEqual(["门派", 2]);
		expect(entry?.extensions).toEqual({ depth: 2, probability: 80 });
		expect(minimal?.keys).toEqual([]);
		expect(minimal?.constant).toBe(false);
		expect(minimal?.selective).toBe(false);
		expect(minimal?.disabled).toBe(false);
		expect(minimal?.position).toBeNull();
		expect(minimal?.depth).toBeNull();
		expect(minimal?.probability).toBeNull();
		expect(minimal?.extensions).toBeNull();
	});

	it("世界书名字来自文件，文本解析时为 null", () => {
		const parsed = parseWorldInfoJson(JSON.stringify(world));
		expect(parsed.name).toBeNull();
		expect(parsed.originalData).not.toBeNull();
	});

	it("条目、originalData 和 raw 共用原始对象", () => {
		const parsed = parseWorldInfoJson(JSON.stringify(world));
		const rawEntries = parsed.raw.entries as JsonObject;
		const entry = parsed.entries[0];
		expect(entry?.raw).toBe(rawEntries["0"]);
		expect(parsed.originalData).toBe(parsed.raw.originalData);
	});

	it("解析之后再序列化，结构不变", () => {
		const parsed = parseWorldInfoJson(JSON.stringify(world));
		expect(JSON.parse(JSON.stringify(parsed.raw))).toEqual(world);
	});

	it("解析带 BOM 的文件", () => {
		const parsed = parseWorldInfoJson(`\uFEFF${JSON.stringify(world)}`);
		expect(parsed.entries).toHaveLength(2);
	});

	it("非法 JSON、缺少 entries、条目不是对象、字段类型错误都会报错", () => {
		expect(() => parseWorldInfoJson("{草稿")).toThrow(/不是合法 JSON/);
		expect(() => parseWorldInfoJson("[]")).toThrow(/必须是 JSON 对象/);
		expect(() => parseWorldInfoJson("{}")).toThrow(/"entries"/);
		expect(() => parseWorldInfoJson(JSON.stringify({ entries: [] }))).toThrow(
			/"entries"/,
		);
		expect(() =>
			parseWorldInfoJson(JSON.stringify({ entries: { "0": "文本" } })),
		).toThrow(/条目 "0" 不是 JSON 对象/);
		expect(() =>
			parseWorldInfoJson(
				JSON.stringify({ entries: { "0": { key: ["甲", 2] } } }),
			),
		).toThrow(/"key\[1\]"/);
		expect(() =>
			parseWorldInfoJson(JSON.stringify({ entries: { "0": { depth: "2" } } })),
		).toThrow(/"depth"/);
		expect(() =>
			parseWorldInfoJson(
				JSON.stringify({ entries: { "0": { delayUntilRecursion: "x" } } }),
			),
		).toThrow(/"delayUntilRecursion"/);
		expect(() =>
			parseWorldInfoJson(
				JSON.stringify({ entries: { "0": { triggers: {} } } }),
			),
		).toThrow(/"triggers"/);
		expect(() =>
			parseWorldInfoJson(
				JSON.stringify({ entries: { "0": {} }, originalData: [] }),
			),
		).toThrow(/"originalData"/);
	});
});

describe("parseWorldInfoFile", () => {
	it("从文件解析并取文件名作为世界书名字", async () => {
		const dir = await mkdtemp(
			join(dirname(fileURLToPath(import.meta.url)), ".tmp-world-"),
		);
		try {
			const path = join(dir, "测试世界.json");
			await writeFile(path, JSON.stringify(world));
			const parsed = await parseWorldInfoFile(path);
			expect(parsed.name).toBe("测试世界");
			expect(parsed.entries).toHaveLength(2);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("读取失败会报告路径", async () => {
		const dir = await mkdtemp(
			join(dirname(fileURLToPath(import.meta.url)), ".tmp-world-"),
		);
		try {
			const path = join(dir, "损坏.json");
			await writeFile(path, "{");
			await expect(parseWorldInfoFile(path)).rejects.toThrow(
				/解析世界书失败.*损坏\.json/,
			);
			await expect(
				parseWorldInfoFile(join(dir, "不存在.json")),
			).rejects.toThrow(/解析世界书失败.*不存在\.json/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

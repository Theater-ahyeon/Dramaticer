import { describe, expect, it } from "vitest";
import {
	LEDGER_NAMESPACES,
	type StoryStore,
	type StoryTime,
	listLedgerEntities,
	mvuLedgerPath,
	readLedger,
	readLedgerFacts,
	validateLedgerDiff,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

interface RawDiff {
	readonly path: readonly string[];
	readonly op: "set" | "delete";
	readonly value?: unknown;
	readonly storyTime?: StoryTime | null;
	readonly source?: "model" | "settler" | "player" | "import";
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试故事" });
	store.appendNode({
		id: "n-root",
		storyId: "s1",
		parentId: null,
		role: "system",
		raw: "开场",
	});
}

function write(store: StoryStore, nodeId: string, diffs: readonly RawDiff[]) {
	store.appendStateDiffs(
		diffs.map((diff) => ({
			storyId: "s1",
			nodeId,
			path: diff.path,
			op: diff.op,
			value: diff.value,
			source: diff.source ?? "model",
			storyTime: diff.storyTime,
		})),
	);
}

const validDiffs: readonly RawDiff[] = [
	{ path: ["character", "卫宫", "tier"], op: "set", value: "lead" },
	{ path: ["character", "卫宫", "identity"], op: "set", value: "御主" },
	{ path: ["character", "卫宫", "location"], op: "set", value: "学院" },
	{ path: ["relation", "卫宫", "凛", "type"], op: "set", value: "同盟" },
	{
		path: ["relation", "卫宫", "凛", "affectionInner"],
		op: "set",
		value: "亲近",
	},
	{
		path: ["relation", "卫宫", "凛", "affectionOuter"],
		op: "set",
		value: "平常",
	},
	{ path: ["relation", "卫宫", "凛", "inertia"], op: "set", value: 0.6 },
	{ path: ["item", "徽章", "holder"], op: "set", value: "卫宫" },
	{
		path: ["item", "徽章", "log", "battle-1"],
		op: "set",
		value: { text: "击退敌人", nodeId: "n-root", at: "2026-11-07" },
	},
	{ path: ["scene", "places", "学院", "parent"], op: "set", value: null },
	{ path: ["scene", "places", "学院", "name"], op: "set", value: "时钟塔" },
	{ path: ["scene", "current", "place"], op: "set", value: "学院" },
	{
		path: ["scene", "current", "participants"],
		op: "set",
		value: ["卫宫", "凛"],
	},
	{ path: ["time", "current"], op: "set", value: "第三天黄昏" },
	{ path: ["clue", "徽章", "text"], op: "set", value: "查明徽章来历" },
	{ path: ["clue", "徽章", "status"], op: "set", value: "progress" },
	{
		path: ["knowledge", "凛", "卫宫是御主"],
		op: "set",
		value: "知道卫宫是御主",
	},
	{
		path: ["userWill", "w1"],
		op: "set",
		value: {
			kind: "preference",
			text: "不要突然死人",
			sourceNodeId: "n-root",
			createdAt: "2026-11-07",
		},
	},
	{ path: ["mvu", "stat_data", "hp"], op: "set", value: 100 },
	{ path: ["mvu", "stat_data", "mood"], op: "set", value: "平静" },
	{ path: ["mvu", "stat_data", "mood"], op: "delete" },
];

describe("validateLedgerDiff", () => {
	it("九个命名空间各有一条通过校验的 diff", () => {
		const covered = new Set(validDiffs.map((diff) => diff.path[0]));
		expect([...covered].sort()).toEqual([...LEDGER_NAMESPACES].sort());
		for (const diff of validDiffs) {
			expect(() => validateLedgerDiff(diff), diff.path.join(".")).not.toThrow();
		}
	});

	it("九类事实都能带 storyTime 与 source", () => {
		for (const diff of validDiffs) {
			expect(() =>
				validateLedgerDiff({
					...diff,
					storyTime: { start: "第一天", end: null },
					source: "settler",
				}),
			).not.toThrow();
		}
	});

	it("来源与故事时间非法时指出位置", () => {
		expect(() =>
			validateLedgerDiff({
				path: ["time", "current"],
				op: "set",
				value: "黄昏",
				source: "chat" as never,
			}),
		).toThrow(
			/台账路径 "time"\."current" 无效：source 只能是 model、settler、player、import，收到 "chat"/,
		);
		expect(() =>
			validateLedgerDiff({
				path: ["time", "current"],
				op: "set",
				value: "黄昏",
				storyTime: { start: 3, end: null } as never,
			}),
		).toThrow(
			/台账路径 "time"\."current" 无效：storyTime\.start 必须是非空字符串或 null/,
		);
		expect(() =>
			validateLedgerDiff({
				path: ["time", "current"],
				op: "set",
				value: "黄昏",
				storyTime: { start: "黄昏", end: null, extra: 1 } as never,
			}),
		).toThrow(/storyTime\.extra 是未知字段/);
	});

	it("非法命名空间、路径段与值都指出位置", () => {
		const cases: readonly [string, RawDiff, RegExp][] = [
			[
				"未知命名空间",
				{ path: ["mood", "current"], op: "set", value: "平静" },
				/台账路径 "mood"\."current" 无效：未知台账命名空间 "mood"/,
			],
			[
				"空路径段",
				{ path: ["character", "", "tier"], op: "set", value: "lead" },
				/第 2 个路径段必须是非空字符串/,
			],
			[
				"人物层级非法",
				{ path: ["character", "卫宫", "tier"], op: "set", value: "boss" },
				/台账路径 "character"\."卫宫"\."tier" 无效：tier 只能是 lead、minor/,
			],
			[
				"关系惯性越界",
				{
					path: ["relation", "卫宫", "凛", "inertia"],
					op: "set",
					value: 1.5,
				},
				/inertia 必须是 0 到 1 之间的数字/,
			],
			[
				"好感不是五档之一",
				{
					path: ["relation", "卫宫", "凛", "affectionInner"],
					op: "set",
					value: "喜欢",
				},
				/affectionInner 只能是 敌对、冷淡、平常、亲近、倾心/,
			],
			[
				"线索状态非法",
				{
					path: ["clue", "徽章", "status"],
					op: "set",
					value: "done",
				},
				/status 只能是 open、progress、fulfilled/,
			],
			[
				"用户意志缺少字段",
				{
					path: ["userWill", "w1"],
					op: "set",
					value: { kind: "preference", text: "不要拖戏" },
				},
				/sourceNodeId 必须是非空字符串/,
			],
			[
				"物品日志有未知字段",
				{
					path: ["item", "徽章", "log", "battle-1"],
					op: "set",
					value: { text: "击退", nodeId: "n-root", at: "2026-11-07", x: 1 },
				},
				/未知字段/,
			],
			[
				"不是 JSON 值",
				{ path: ["mvu", "x"], op: "set", value: () => 1 },
				/不是 JSON 值/,
			],
			[
				"实体路径只能删除",
				{ path: ["character", "卫宫"], op: "set", value: {} },
				/只能删除，字段必须逐项写入/,
			],
			[
				"场景路径多一段",
				{
					path: ["scene", "current", "participants", "x"],
					op: "set",
					value: [],
				},
				/scene\.current 的路径必须是 scene\.current\.<字段>/,
			],
			[
				"mvu 缺少变量路径",
				{ path: ["mvu"], op: "set", value: {} },
				/至少包含一个变量路径段/,
			],
		];
		for (const [name, diff, message] of cases) {
			expect(() => validateLedgerDiff(diff), name).toThrow(message);
		}
	});
});

describe("台账读取", () => {
	it("按前缀读取快照子树，并列出人物、关系与未兑现线索", () => {
		const { store } = openTempStore();
		seed(store);
		write(store, "n-root", validDiffs);

		expect(readLedger(store, "n-root", ["character", "卫宫", "tier"])).toBe(
			"lead",
		);
		expect(readLedger(store, "n-root", ["scene", "current"])).toEqual({
			place: "学院",
			participants: ["卫宫", "凛"],
		});
		expect(readLedger(store, "n-root", ["mvu", "stat_data"])).toEqual({
			hp: 100,
		});
		expect(
			readLedger(store, "n-root", ["character", "不存在"]),
		).toBeUndefined();
		expect(readLedger(store, "n-root")).toMatchObject({
			character: { 卫宫: { tier: "lead" } },
			time: { current: "第三天黄昏" },
		});

		expect(listLedgerEntities(store, "n-root")).toEqual({
			characters: [
				{
					id: "卫宫",
					tier: "lead",
					identity: "御主",
					location: "学院",
				},
			],
			relations: [
				{
					from: "卫宫",
					to: "凛",
					type: "同盟",
					affectionInner: "亲近",
					affectionOuter: "平常",
					inertia: 0.6,
				},
			],
			openClues: [
				{
					id: "徽章",
					text: "查明徽章来历",
					status: "progress",
				},
			],
		});
	});

	it("读回仍然成立的事实及其 storyTime 与 source", () => {
		const { store } = openTempStore();
		seed(store);
		write(store, "n-root", [
			{
				path: ["time", "current"],
				op: "set",
				value: "第三天黄昏",
				storyTime: { start: "第三天黄昏", end: null },
				source: "model",
			},
			{
				path: ["mvu", "stat_data", "hp"],
				op: "set",
				value: 100,
				storyTime: { start: "第一天", end: "第二天" },
				source: "import",
			},
			{
				path: ["clue", "徽章", "status"],
				op: "set",
				value: "open",
				source: "settler",
			},
			{
				path: ["clue", "徽章", "status"],
				op: "delete",
				source: "player",
			},
		]);

		expect(readLedgerFacts(store, "n-root")).toEqual([
			{
				path: ["time", "current"],
				value: "第三天黄昏",
				storyTime: { start: "第三天黄昏", end: null },
				source: "model",
			},
			{
				path: ["mvu", "stat_data", "hp"],
				value: 100,
				storyTime: { start: "第一天", end: "第二天" },
				source: "import",
			},
		]);
		expect(readLedgerFacts(store, "n-root", ["mvu"])).toHaveLength(1);
		expect(readLedgerFacts(store, "n-root", ["character"])).toEqual([]);
		// 值视图保持不变：被删除的字段不出现，父对象保留。
		expect(readLedger(store, "n-root", ["clue"])).toEqual({ 徽章: {} });
	});

	it("分支切换后读到各自的状态，已兑现的线索不出现在未兑现列表", () => {
		const { store } = openTempStore();
		seed(store);
		write(store, "n-root", [
			{ path: ["character", "卫宫", "location"], op: "set", value: "初始" },
			{ path: ["clue", "徽章", "text"], op: "set", value: "查明徽章来历" },
		]);
		store.appendNode({
			id: "n-a",
			storyId: "s1",
			parentId: "n-root",
			role: "assistant",
			raw: "分支甲",
		});
		store.appendNode({
			id: "n-b",
			storyId: "s1",
			parentId: "n-root",
			role: "assistant",
			raw: "分支乙",
		});
		write(store, "n-a", [
			{ path: ["character", "卫宫", "location"], op: "set", value: "学院" },
			{ path: ["clue", "徽章", "status"], op: "set", value: "open" },
		]);
		write(store, "n-b", [
			{ path: ["character", "卫宫", "location"], op: "set", value: "港口" },
			{ path: ["clue", "徽章", "status"], op: "set", value: "fulfilled" },
		]);

		expect(readLedger(store, "n-a", ["character", "卫宫"])).toEqual({
			location: "学院",
		});
		expect(readLedger(store, "n-b", ["character", "卫宫"])).toEqual({
			location: "港口",
		});
		expect(readLedger(store, "n-root", ["character", "卫宫"])).toEqual({
			location: "初始",
		});
		expect(listLedgerEntities(store, "n-a").openClues).toEqual([
			{ id: "徽章", text: "查明徽章来历", status: "open" },
		]);
		expect(listLedgerEntities(store, "n-b").openClues).toEqual([]);
	});

	it("前缀与楼层校验失败时抛错", () => {
		const { store } = openTempStore();
		seed(store);
		expect(() => readLedger(store, "n-root", [])).toThrow(
			"台账前缀必须是非空数组",
		);
		expect(() => readLedger(store, "n-root", ["character", ""])).toThrow(
			"第 2 个路径段",
		);
		expect(() => readLedger(store, "n-root", ["mood"])).toThrow(
			"未知台账命名空间",
		);
		expect(() => readLedger(store, "n-missing")).toThrow(
			"楼层节点不存在：n-missing",
		);
	});
});

describe("mvuLedgerPath", () => {
	it("给原始变量路径加上 mvu 前缀", () => {
		expect(mvuLedgerPath(["stat_data", "hp"])).toEqual([
			"mvu",
			"stat_data",
			"hp",
		]);
		expect(() => mvuLedgerPath([])).toThrow("MVU 变量路径必须是非空数组");
	});
});

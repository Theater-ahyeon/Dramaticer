import type { LedgerFact, MemoryEvent, StateDiff } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	EVENT_PAGE_SIZE,
	appendEventPage,
	buildNamespaceSlices,
	describeEventMeta,
	describeLedgerValue,
	formatConfidence,
	formatLedgerPath,
	formatLedgerSource,
	formatNodeRef,
	formatStoryTime,
	formatSummaryLevel,
	hasHighlightedDescendant,
	hasMoreEventPage,
	highlightPaths,
	isPathHighlighted,
	nextEventRequest,
	pathKey,
} from "../src/chat/ledger-view";

const CREATED_AT = "2026-11-08T10:00:00.000Z";

function diff(
	id: number,
	path: readonly string[],
	overrides: Partial<StateDiff> = {},
): StateDiff {
	return {
		id,
		storyId: "story-1",
		nodeId: "node-1",
		ordinal: id,
		path,
		op: "set",
		value: `值 ${id}`,
		reason: null,
		source: "settler",
		storyTime: null,
		confidence: 0.75,
		createdAt: CREATED_AT,
		...overrides,
	};
}

function fact(
	path: readonly string[],
	overrides: Partial<LedgerFact> = {},
): LedgerFact {
	return {
		path,
		value: `事实 ${path.join(".")}`,
		storyTime: null,
		source: "model",
		nodeId: "node-7",
		...overrides,
	};
}

function event(id: string): MemoryEvent {
	return {
		id,
		storyId: "story-1",
		sourceNodeId: "node-1",
		ordinal: 0,
		storyTime: "第三日清晨",
		location: "旧宅",
		participants: ["林秋", "管家"],
		importance: 4,
		knowers: ["林秋"],
		text: `事件 ${id}`,
		source: "events",
		createdAt: CREATED_AT,
	};
}

describe("台账命名空间切分", () => {
	it("按固定顺序返回已知命名空间，并把快照、事实与本楼写入分行", () => {
		const slices = buildNamespaceSlices(
			{
				relation: { a: { from: "a", to: "b" } },
				character: { hero: { name: "林秋" } },
				mvu: { 好感: 3 },
			},
			[fact(["character", "hero", "name"]), fact(["mvu", "好感"])],
			[diff(1, ["relation", "a", "stage"]), diff(2, ["mvu", "好感"])],
		);
		expect(slices.map((slice) => slice.namespace)).toEqual([
			"character",
			"relation",
			"item",
			"scene",
			"time",
			"clue",
			"knowledge",
			"userWill",
			"mvu",
		]);
		const character = slices[0];
		expect(character?.label).toBe("人物");
		expect(character?.state).toEqual({ hero: { name: "林秋" } });
		expect(character?.facts).toHaveLength(1);
		expect(character?.diffs).toHaveLength(0);
		const relation = slices[1];
		expect(relation?.diffs.map((entry) => entry.id)).toEqual([1]);
		const mvu = slices.find((slice) => slice.namespace === "mvu");
		expect(mvu?.label).toBe("MVU");
		expect(mvu?.facts).toHaveLength(1);
		expect(mvu?.diffs).toHaveLength(1);
	});

	it("快照不是对象时所有分区都没有状态，但事实与写入仍按命名空间出现", () => {
		const slices = buildNamespaceSlices(
			null,
			[fact(["item", "剑"])],
			[diff(1, ["item", "剑"])],
		);
		const item = slices.find((slice) => slice.namespace === "item");
		expect(item?.state).toBeUndefined();
		expect(item?.facts).toHaveLength(1);
		expect(item?.diffs).toHaveLength(1);
		expect(
			slices.find((slice) => slice.namespace === "character")?.facts,
		).toEqual([]);
	});

	it("未知命名空间按名称排序追加，重复出现只占一个分区", () => {
		const slices = buildNamespaceSlices(
			{ zeta: { value: 1 } },
			[fact(["alpha", "x"]), fact(["zeta", "value"])],
			[diff(1, ["alpha", "x"]), diff(2, ["alpha", "y"])],
		);
		const extras = slices.slice(8).map((slice) => slice.namespace);
		expect(extras).toEqual(["alpha", "zeta"]);
	});
});

describe("本楼 diff 高亮", () => {
	it("只匹配完整路径，不把父路径标成写入", () => {
		const highlighted = highlightPaths([
			diff(1, ["character", "hero", "status"]),
		]);
		expect(
			isPathHighlighted(highlighted, ["character", "hero", "status"]),
		).toBe(true);
		expect(isPathHighlighted(highlighted, ["character", "hero"])).toBe(false);
		expect(
			isPathHighlighted(highlighted, ["character", "hero", "outfit"]),
		).toBe(false);
	});

	it("删除写入也参与高亮，路径键区分同名不同段", () => {
		const highlighted = highlightPaths([
			diff(1, ["item", "a/b"], { op: "delete", value: null }),
		]);
		expect(isPathHighlighted(highlighted, ["item", "a/b"])).toBe(true);
		expect(isPathHighlighted(highlighted, ["item", "a", "b"])).toBe(false);
		expect(pathKey(["item", "a/b"])).toBe('["item","a/b"]');
	});

	it("子树是否包含本楼写入按完整路径段判断", () => {
		const highlighted = highlightPaths([
			diff(1, ["character", "hero", "status"]),
		]);
		expect(hasHighlightedDescendant(highlighted, ["character", "hero"])).toBe(
			true,
		);
		expect(hasHighlightedDescendant(highlighted, ["character"])).toBe(true);
		expect(
			hasHighlightedDescendant(highlighted, ["character", "hero", "status"]),
		).toBe(false);
		expect(hasHighlightedDescendant(highlighted, ["character", "riv"])).toBe(
			false,
		);
	});
});

describe("值的格式化与展开", () => {
	it("短字符串直接显示，长字符串折叠出摘要并保留完整内容", () => {
		expect(describeLedgerValue("短文本")).toEqual({
			inline: "短文本",
			full: "短文本",
			expandable: false,
		});
		const long = "剑".repeat(150);
		const described = describeLedgerValue(long);
		expect(described.expandable).toBe(true);
		expect(described.inline).toHaveLength(121);
		expect(described.full).toBe(long);
	});

	it("对象与数组给单行摘要和多行完整值", () => {
		const value = { outer: { inner: ["a", "b"] } };
		const described = describeLedgerValue(value);
		expect(described.inline).toBe(JSON.stringify(value));
		expect(described.full).toBe(JSON.stringify(value, null, 2));
		expect(described.expandable).toBe(false);
	});

	it("空值与数字布尔各有明确显示", () => {
		expect(describeLedgerValue(null).inline).toBe("（空）");
		expect(describeLedgerValue(undefined).inline).toBe("（未记录）");
		expect(describeLedgerValue(3).inline).toBe("3");
		expect(describeLedgerValue(false).inline).toBe("false");
	});
});

describe("元数据格式化", () => {
	it("故事时间覆盖起点、终点与缺省", () => {
		expect(formatStoryTime(null)).toBe("未记录");
		expect(formatStoryTime({ start: null, end: null })).toBe("未记录");
		expect(formatStoryTime({ start: "第一日", end: null })).toBe("第一日 起");
		expect(formatStoryTime({ start: null, end: "第三日" })).toBe("截至 第三日");
		expect(formatStoryTime({ start: "第一日", end: "第三日" })).toBe(
			"第一日 至 第三日",
		);
	});

	it("来源、置信度、楼层引用与摘要层级都有中文标签", () => {
		expect(formatLedgerSource("model")).toBe("正文模型");
		expect(formatLedgerSource("settler")).toBe("结算器");
		expect(formatLedgerSource("player")).toBe("玩家");
		expect(formatLedgerSource("import")).toBe("导入");
		expect(formatLedgerSource("custom")).toBe("custom");
		expect(formatConfidence(null)).toBe("正文写入");
		expect(formatConfidence(0.8)).toBe("0.80");
		expect(formatNodeRef("short")).toBe("short");
		expect(formatNodeRef("abcdefghijklmnop")).toBe("abcdefghij…");
		expect(formatSummaryLevel("chapter")).toBe("章节摘要");
		expect(formatSummaryLevel("mainline")).toBe("主线摘要");
		expect(formatLedgerPath(["character", "hero", "status"])).toBe(
			"character / hero / status",
		);
	});

	it("事件元数据列出全部字段，缺失值写未记录", () => {
		const meta = describeEventMeta(event("e1"));
		expect(meta).toEqual([
			{ label: "故事时间", value: "第三日清晨" },
			{ label: "地点", value: "旧宅" },
			{ label: "参与者", value: "林秋、管家" },
			{ label: "重要度", value: "4" },
			{ label: "知情者", value: "林秋" },
			{ label: "来源楼层", value: "node-1" },
		]);
		const empty = describeEventMeta({
			...event("e2"),
			storyTime: null,
			location: null,
			participants: [],
			knowers: [],
			sourceNodeId: "abcdefghijklmnop",
		});
		expect(empty.map((item) => item.value)).toEqual([
			"未记录",
			"未记录",
			"无",
			"4",
			"无",
			"abcdefghij…",
		]);
	});
});

describe("事件分页", () => {
	it("下一页从已收到的条数开始", () => {
		expect(nextEventRequest(0)).toEqual({ limit: EVENT_PAGE_SIZE, offset: 0 });
		expect(nextEventRequest(45)).toEqual({
			limit: EVENT_PAGE_SIZE,
			offset: 45,
		});
		expect(() => nextEventRequest(-1)).toThrow("不小于 0 的整数");
	});

	it("满页时认为可能还有下一页，空页与不满页到底", () => {
		expect(hasMoreEventPage(EVENT_PAGE_SIZE, EVENT_PAGE_SIZE)).toBe(true);
		expect(hasMoreEventPage(0, EVENT_PAGE_SIZE)).toBe(false);
		expect(hasMoreEventPage(4, EVENT_PAGE_SIZE)).toBe(false);
	});

	it("翻页按 id 去重并保留先到的顺序", () => {
		const first = [event("a"), event("b")];
		const merged = appendEventPage(first, [
			event("b"),
			event("c"),
			event("a"),
			event("d"),
		]);
		expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
		expect(first.map((entry) => entry.id)).toEqual(["a", "b"]);
	});
});

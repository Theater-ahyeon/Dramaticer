import { describe, expect, it } from "vitest";
import { type StateDiff, applyStateDiffs } from "../src/index.js";

let ordinal = 0;

function diff(
	path: readonly string[],
	op: "set" | "delete",
	value?: unknown,
): StateDiff {
	const stored: StateDiff = {
		id: ordinal,
		storyId: "s1",
		nodeId: "n1",
		ordinal,
		path,
		op,
		value: op === "set" ? value : null,
		reason: null,
		source: "test",
		createdAt: "2026-11-07T00:00:00.000Z",
	};
	ordinal += 1;
	return stored;
}

describe("applyStateDiffs", () => {
	it("按路径写入嵌套状态并覆盖已有值", () => {
		const state = applyStateDiffs([
			diff(["角色", "卫宫", "好感度"], "set", 10),
			diff(["角色", "卫宫", "好感度"], "set", 12),
			diff(["场景", "地点"], "set", "山门"),
			diff(["场景", "标签"], "set", ["夜", "雨"]),
		]);
		expect(state).toEqual({
			角色: { 卫宫: { 好感度: 12 } },
			场景: { 地点: "山门", 标签: ["夜", "雨"] },
		});
	});

	it("删除路径，删除不存在的路径没有影响", () => {
		const state = applyStateDiffs([
			diff(["角色", "卫宫", "好感度"], "set", 10),
			diff(["角色", "卫宫", "好感度"], "delete"),
			diff(["不存在的", "路径"], "delete"),
		]);
		expect(state).toEqual({ 角色: { 卫宫: {} } });
	});

	it("中间值是标量时被对象替换", () => {
		const state = applyStateDiffs([
			diff(["场景"], "set", "酒馆"),
			diff(["场景", "地点"], "set", "山门"),
		]);
		expect(state).toEqual({ 场景: { 地点: "山门" } });
	});

	it("__proto__ 路径段不会修改原型链", () => {
		const state = applyStateDiffs([
			diff(["__proto__", "polluted"], "set", true),
		]);
		expect(Object.hasOwn(state, "__proto__")).toBe(true);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(JSON.stringify(state)).toBe('{"__proto__":{"polluted":true}}');
	});

	it("非法路径抛错", () => {
		expect(() => applyStateDiffs([diff([], "set", 1)])).toThrow("path");
	});
});

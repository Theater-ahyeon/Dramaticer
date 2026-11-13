import { describe, expect, it } from "vitest";
import {
	StEjsJsonError,
	StEjsVariableError,
	applyStEjsJsonPatch,
	createStEjsRuntime,
	parseStEjsJson,
} from "../src/st-ejs/index.js";

describe("EJS JSON 函数", () => {
	it("parseJSON 先按严格 JSON，再接受宽松写法", async () => {
		const ejs = createStEjsRuntime();
		const strict = await ejs.render(
			"<%- JSON.stringify(parseJSON('{\"a\":1}')) %>",
		);
		expect(strict).toBe('{"a":1}');
		expect(parseStEjsJson("{'a': 1, 'b': [1, 2,]}")).toEqual({
			a: 1,
			b: [1, 2],
		});
		expect(() => parseStEjsJson("不是 JSON")).toThrow(StEjsJsonError);
		expect(() => parseStEjsJson("")).toThrow(StEjsJsonError);
	});

	it("jsonPatch 支持 add、remove、replace、move、copy 与 test", () => {
		const target = { a: 1, list: [1, 2], nested: { x: "旧" } };
		const result = applyStEjsJsonPatch(target, [
			{ op: "replace", path: "/a", value: 2 },
			{ op: "add", path: "/list/-", value: 3 },
			{ op: "remove", path: "/list/0" },
			{ op: "copy", from: "/a", path: "/copied" },
			{ op: "move", from: "/nested/x", path: "/nested/y" },
			{ op: "test", path: "/a", value: 2 },
			{ op: "add", path: "/nested/z", value: null },
		]);
		expect(result).toEqual({
			a: 2,
			list: [2, 3],
			nested: { y: "旧", z: null },
			copied: 2,
		});
		expect(target).toEqual({ a: 1, list: [1, 2], nested: { x: "旧" } });
	});

	it("jsonPatch 的非法操作指出条目位置", () => {
		expect(() =>
			applyStEjsJsonPatch({}, [{ op: "replace", path: "/missing", value: 1 }]),
		).toThrow(/第 1 条（replace）失败/);
		expect(() =>
			applyStEjsJsonPatch({ a: 1 }, [{ op: "test", path: "/a", value: 2 }]),
		).toThrow(StEjsJsonError);
		expect(() =>
			applyStEjsJsonPatch({ a: 1 }, [{ op: "unknown", path: "/a" }]),
		).toThrow(/不认识的操作/);
		expect(() =>
			applyStEjsJsonPatch({ a: 1 }, [{ op: "add", path: "a", value: 1 }]),
		).toThrow(StEjsJsonError);
		expect(() =>
			applyStEjsJsonPatch({}, [{ op: "add", path: "/__proto__/x", value: 1 }]),
		).toThrow(StEjsJsonError);
	});

	it("patchVariables 只把变化写回顶层键并保留写入记录", () => {
		const ejs = createStEjsRuntime({
			variables: {
				messages: [{ id: 0, role: "user", variables: { hp: 10, name: "甲" } }],
			},
			messages: [{ id: 0, role: "user", content: "开始" }],
		});
		const result = ejs.patchVariables([
			{ op: "replace", path: "/hp", value: 8 },
			{ op: "add", path: "/tags", value: ["受伤"] },
			{ op: "remove", path: "/name" },
		]);
		expect(result).toEqual({ hp: 8, tags: ["受伤"] });
		expect(
			ejs.getWrites().map((write) => [write.key, write.operation]),
		).toEqual([
			["hp", "set"],
			["name", "delete"],
			["tags", "set"],
		]);
	});

	it("patchVariables 可以写到指定作用域", () => {
		const ejs = createStEjsRuntime();
		ejs.patchVariables([{ op: "add", path: "/round", value: 2 }], {
			scope: "global",
		});
		expect(ejs.variables.read("round", { scope: "global" })).toBe(2);
		expect(ejs.variables.read("round", { scope: "message" })).toBeUndefined();
	});

	it("setVariableSchema 校验补丁结果与 setvar", async () => {
		const ejs = createStEjsRuntime();
		const previous = ejs.setVariableSchema({
			type: "object",
			required: ["hp"],
			properties: {
				hp: { type: "number", enum: [1, 2, 3] },
				name: { type: "string" },
			},
		});
		expect(previous).toBeNull();
		expect(() =>
			ejs.patchVariables([{ op: "add", path: "/hp", value: 9 }]),
		).toThrow(StEjsVariableError);
		expect(() =>
			ejs.patchVariables([{ op: "add", path: "/name", value: 1 }]),
		).toThrow(StEjsVariableError);
		ejs.patchVariables([
			{ op: "add", path: "/hp", value: 2 },
			{ op: "add", path: "/name", value: "甲" },
		]);
		await expect(ejs.render("<% setvar('hp', 4) %>")).rejects.toThrow(
			/不在允许的取值里/,
		);
		await expect(ejs.render("<% setvar('hp', 'x') %>")).rejects.toThrow(
			/不在允许的取值里/,
		);
	});

	it("非法变量结构在注册时直接拒绝", () => {
		const ejs = createStEjsRuntime();
		expect(() => ejs.setVariableSchema({ type: "money" })).toThrow(
			StEjsVariableError,
		);
		expect(() =>
			ejs.setVariableSchema({ type: "object", properties: { a: 1 } }),
		).toThrow(StEjsVariableError);
	});
});

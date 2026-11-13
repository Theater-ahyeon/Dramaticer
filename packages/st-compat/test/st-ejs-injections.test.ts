import { describe, expect, it } from "vitest";
import {
	StEjsInjectionError,
	createStEjsRuntime,
	parseStEjsInitialVariables,
	parseStEjsInjections,
} from "../src/st-ejs/index.js";

describe("EJS 内容注入", () => {
	it("GENERATE 的 BEFORE 与 AFTER 各自收走后续文本", () => {
		const parsed = parseStEjsInjections(
			"开头\n[GENERATE:BEFORE]\n生成前注入\n[GENERATE:AFTER]\n生成后注入",
		);
		expect(parsed.text).toBe("开头");
		expect(parsed.injections).toEqual([
			{
				target: "generate",
				position: "before",
				depth: null,
				regex: null,
				order: 100,
				role: null,
				content: "生成前注入",
				directive: "[GENERATE:BEFORE]",
			},
			{
				target: "generate",
				position: "after",
				depth: null,
				regex: null,
				order: 100,
				role: null,
				content: "生成后注入",
				directive: "[GENERATE:AFTER]",
			},
		]);
	});

	it("带下标的注入记录楼层下标", () => {
		const parsed = parseStEjsInjections(
			"[GENERATE:2:BEFORE]\n深度二\n[GENERATE:0:AFTER]\n最新楼",
		);
		expect(parsed.text).toBe("");
		expect(
			parsed.injections.map((entry) => [entry.depth, entry.position]),
		).toEqual([
			[2, "before"],
			[0, "after"],
		]);
	});

	it("REGEX 标记记录正则文本", () => {
		const parsed = parseStEjsInjections(
			"[GENERATE:REGEX:/<status>(.*?)<\\/status>/gs]\n$1",
		);
		expect(parsed.injections).toEqual([
			{
				target: "generate",
				position: "after",
				depth: null,
				regex: "/<status>(.*?)<\\/status>/gs",
				order: 100,
				role: null,
				content: "$1",
				directive: "[GENERATE:REGEX:/<status>(.*?)<\\/status>/gs]",
			},
		]);
	});

	it("RENDER 的全部形式", () => {
		const parsed = parseStEjsInjections(
			"[RENDER:BEFORE]\n甲\n[RENDER:3:AFTER]\n乙\n[RENDER:REGEX:foo]\n丙",
		);
		expect(parsed.text).toBe("");
		expect(
			parsed.injections.map((entry) => [
				entry.target,
				entry.position,
				entry.depth,
				entry.regex,
				entry.content,
			]),
		).toEqual([
			["render", "before", null, null, "甲"],
			["render", "after", 3, null, "乙"],
			["render", "after", null, "foo", "丙"],
		]);
	});

	it("@INJECT 的 pos、order 与 role", () => {
		const parsed = parseStEjsInjections(
			"输出\n@INJECT pos=before order=10 role=user\n注入内容",
		);
		expect(parsed.text).toBe("输出");
		expect(parsed.injections).toEqual([
			{
				target: "generate",
				position: "before",
				depth: null,
				regex: null,
				order: 10,
				role: "user",
				content: "注入内容",
				directive: "@INJECT pos=before order=10 role=user",
			},
		]);
	});

	it("@INJECT 的 target 与 regex 位置", () => {
		const byTarget = parseStEjsInjections("@INJECT target=chat\n聊天注入");
		expect(byTarget.injections[0]).toMatchObject({
			target: "chat",
			position: "after",
			content: "聊天注入",
		});
		const byRegex = parseStEjsInjections('@INJECT regex="/x+/g"\n$&');
		expect(byRegex.injections[0]).toMatchObject({
			target: "generate",
			regex: "/x+/g",
			content: "$&",
		});
	});

	it("不是独占一行的标记按普通文本保留", () => {
		const text = "前缀 [GENERATE:BEFORE] 后缀\n@INJECTED";
		const parsed = parseStEjsInjections(text);
		expect(parsed.text).toBe(text);
		expect(parsed.injections).toEqual([]);
	});

	it("@INJECT 的非法参数直接抛错", () => {
		expect(() => parseStEjsInjections("@INJECT")).toThrow(StEjsInjectionError);
		expect(() => parseStEjsInjections("@INJECT foo=1")).toThrow("不认识");
		expect(() => parseStEjsInjections("@INJECT pos=middle")).toThrow(
			"before 或 after",
		);
		expect(() => parseStEjsInjections("@INJECT pos=before role=tool")).toThrow(
			"role",
		);
		expect(() => parseStEjsInjections("@INJECT target=x order=abc")).toThrow(
			"order",
		);
		expect(() => parseStEjsInjections('@INJECT target="未闭合')).toThrow(
			"引号未闭合",
		);
		expect(() => parseStEjsInjections("@INJECT pos=before pos=after")).toThrow(
			"重复",
		);
	});

	it("[InitialVariables] 先按 JSON 解析", () => {
		const parsed = parseStEjsInitialVariables(
			'[InitialVariables]\n{"hp": 3, "tags": ["a"]}',
		);
		expect(parsed).toEqual({
			variables: { hp: 3, tags: ["a"] },
			format: "json",
		});
	});

	it("[InitialVariables] 的 JSON 失败后按 YAML 解析", () => {
		const parsed = parseStEjsInitialVariables(
			"[InitialVariables]\nhp: 3\ntags:\n  - a\n  - b",
		);
		expect(parsed).toEqual({
			variables: { hp: 3, tags: ["a", "b"] },
			format: "yaml",
		});
	});

	it("初始变量的非对象与非法文本被拒绝", () => {
		expect(() =>
			parseStEjsInitialVariables("[InitialVariables]\n[1, 2]"),
		).toThrow("必须是对象");
		expect(() => parseStEjsInitialVariables("[InitialVariables]\n{{")).toThrow(
			StEjsInjectionError,
		);
	});

	it("初始变量写进 initial 作用域且优先级最低", () => {
		const ejs = createStEjsRuntime({
			variables: { initial: { hp: 1 }, global: { hp: 2 } },
		});
		const parsed = ejs.defineInitialVariables(
			'[InitialVariables]\n{"hp": 3, "mp": 5}',
		);
		expect(parsed.format).toBe("json");
		expect(ejs.variables.read("hp")).toBe(2);
		expect(ejs.variables.read("mp")).toBe(5);
		expect(ejs.variables.read("hp", { scope: "initial" })).toBe(3);
	});
});

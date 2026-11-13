import { describe, expect, it } from "vitest";
import {
	ST_EJS_DECORATOR_NAMES,
	StEjsDecoratorError,
	createStEjsRuntime,
	evaluateStEjsDecoratorCondition,
	hasStEjsDecorator,
	parseStEjsDecorators,
	readStEjsDecoratorArgument,
} from "../src/st-ejs/index.js";

describe("EJS 装饰器", () => {
	it("识别全部装饰器并去掉装饰器行", () => {
		const lines = ST_EJS_DECORATOR_NAMES.map((name) =>
			name === "if" ? "@@if variables.hp > 0" : `@@${name}`,
		);
		const parsed = parseStEjsDecorators([...lines, "正文第一行"].join("\n"));
		expect(parsed.decorators.map((decorator) => decorator.name)).toEqual([
			...ST_EJS_DECORATOR_NAMES,
		]);
		expect(parsed.content).toBe("正文第一行");
		expect(parsed.discarded).toEqual([]);
		expect(parsed.decorators[0]?.line).toBe(1);
		expect(parsed.decorators.at(-1)?.line).toBe(lines.length);
	});

	it("未知装饰器行被丢弃并记录", () => {
		const parsed = parseStEjsDecorators(
			"@@activate\n@@unknown something\n@@BOLD\n正文",
		);
		expect(parsed.decorators.map((decorator) => decorator.name)).toEqual([
			"activate",
		]);
		expect(parsed.discarded).toEqual(["@@unknown something", "@@BOLD"]);
		expect(parsed.content).toBe("正文");
	});

	it("@@@ 开头的行是普通内容，按原文保留", () => {
		const parsed = parseStEjsDecorators("@@activate\n@@@activate\n正文");
		expect(parsed.decorators.map((decorator) => decorator.name)).toEqual([
			"activate",
		]);
		expect(parsed.content).toBe("@@@activate\n正文");
	});

	it("只解析内容最前面的连续装饰器行", () => {
		const text = "正文\n@@if true";
		const parsed = parseStEjsDecorators(text);
		expect(parsed.decorators).toEqual([]);
		expect(parsed.content).toBe(text);
	});

	it("@@if 的参数保留原始表达式", () => {
		const parsed = parseStEjsDecorators(
			"@@if (function(){ return variables.hp > 0; })()\n正文",
		);
		expect(parsed.decorators).toEqual([
			{
				name: "if",
				argument: "(function(){ return variables.hp > 0; })()",
				raw: "@@if (function(){ return variables.hp > 0; })()",
				line: 1,
			},
		]);
		expect(hasStEjsDecorator(parsed.decorators, "if")).toBe(true);
		expect(readStEjsDecoratorArgument(parsed.decorators, "if")).toBe(
			"(function(){ return variables.hp > 0; })()",
		);
		expect(readStEjsDecoratorArgument(parsed.decorators, "activate")).toBe(
			null,
		);
	});

	it("@@if 缺少表达式直接抛错", () => {
		expect(() => parseStEjsDecorators("@@if\n正文")).toThrow(
			StEjsDecoratorError,
		);
		expect(() => parseStEjsDecorators("@@if\n正文")).toThrow("缺少表达式");
	});

	it("@@if 的表达式用模板局部变量求值", () => {
		const ejs = createStEjsRuntime({
			variables: { local: { hp: 3, flag: false } },
		});
		expect(ejs.evaluateCondition("variables.hp > 2")).toBe(true);
		expect(ejs.evaluateCondition("variables.flag")).toBe(false);
		expect(
			ejs.evaluateCondition("(function(){ return getvar('hp') === 3; })()"),
		).toBe(true);
		expect(ejs.evaluateCondition("typeof setvar === 'function'")).toBe(true);
	});

	it("@@if 表达式报错带表达式原文", () => {
		expect(() => evaluateStEjsDecoratorCondition("variables.")).toThrow(
			StEjsDecoratorError,
		);
		try {
			evaluateStEjsDecoratorCondition("variables.");
		} catch (error) {
			expect(error).toBeInstanceOf(StEjsDecoratorError);
			expect((error as StEjsDecoratorError).expression).toBe("variables.");
			expect((error as StEjsDecoratorError).message).toContain("求值失败");
		}
	});
});

import { describe, expect, it } from "vitest";
import { StEjsRegexError, createStEjsRuntime } from "../src/st-ejs/index.js";

describe("EJS 激活正则", () => {
	it("默认在消息渲染阶段一次性生效", () => {
		const ejs = createStEjsRuntime();
		ejs.activateRegex("/foo/g", "bar");
		expect(ejs.applyRegex("foo foo", { kind: "message" })).toBe("bar bar");
		expect(ejs.applyRegex("foo", { kind: "message" })).toBe("foo");
		expect(ejs.getActivatedRegexes()[0]?.active).toBe(false);
	});

	it("sticky 的脚本继续生效", () => {
		const ejs = createStEjsRuntime();
		ejs.activateRegex("/foo/g", "bar", { sticky: true });
		expect(ejs.applyRegex("foo", { kind: "message" })).toBe("bar");
		expect(ejs.applyRegex("foo", { kind: "message" })).toBe("bar");
		expect(ejs.getActivatedRegexes()[0]?.active).toBe(true);
	});

	it("basic 同时作用于生成与消息，generate 与 message 各自限定", () => {
		const basic = createStEjsRuntime();
		basic.activateRegex("/a/g", "b", { basic: true, sticky: true });
		expect(basic.applyRegex("a", { kind: "generate" })).toBe("b");
		expect(basic.applyRegex("a", { kind: "message" })).toBe("b");

		const generate = createStEjsRuntime();
		generate.activateRegex("/a/g", "b", { generate: true });
		expect(generate.applyRegex("a", { kind: "generate" })).toBe("b");
		expect(generate.applyRegex("a", { kind: "message" })).toBe("a");

		const message = createStEjsRuntime();
		message.activateRegex("/a/g", "b", { message: true });
		expect(message.applyRegex("a", { kind: "generate" })).toBe("a");
		expect(message.applyRegex("a", { kind: "message" })).toBe("b");
	});

	it("html 限定只作用于 HTML 输出", () => {
		const ejs = createStEjsRuntime();
		ejs.activateRegex("/a/g", "b", { html: true, sticky: true });
		expect(ejs.applyRegex("a", { kind: "message" })).toBe("a");
		expect(ejs.applyRegex("a", { kind: "message", html: true })).toBe("b");

		const plain = createStEjsRuntime();
		plain.activateRegex("/a/g", "b", { sticky: true });
		expect(plain.applyRegex("a", { kind: "message" })).toBe("b");
		expect(plain.applyRegex("a", { kind: "message", html: true })).toBe("b");
	});

	it("before 只作用于预处理阶段", () => {
		const ejs = createStEjsRuntime();
		ejs.activateRegex("/a/g", "b", { before: true, sticky: true });
		expect(ejs.applyRegex("a", { kind: "message", stage: "before" })).toBe("b");
		expect(ejs.applyRegex("a", { kind: "message", stage: "after" })).toBe("a");
	});

	it("minDepth 与 maxDepth 限定楼层深度", () => {
		const ejs = createStEjsRuntime();
		ejs.activateRegex("/a/g", "b", {
			minDepth: 1,
			maxDepth: 2,
			sticky: true,
		});
		expect(ejs.applyRegex("a", { kind: "message", depth: 0 })).toBe("a");
		expect(ejs.applyRegex("a", { kind: "message", depth: 1 })).toBe("b");
		expect(ejs.applyRegex("a", { kind: "message", depth: 2 })).toBe("b");
		expect(ejs.applyRegex("a", { kind: "message", depth: 3 })).toBe("a");
		expect(ejs.applyRegex("a", { kind: "message" })).toBe("a");
	});

	it("order 决定执行顺序，同序按注册顺序", () => {
		const ejs = createStEjsRuntime();
		ejs.activateRegex("/a/g", "b", { order: 10, sticky: true });
		ejs.activateRegex("/b/g", "c", { order: 20, sticky: true });
		expect(ejs.applyRegex("a", { kind: "message" })).toBe("c");

		const reversed = createStEjsRuntime();
		reversed.activateRegex("/a/g", "b", { order: 20, sticky: true });
		reversed.activateRegex("/b/g", "c", { order: 10, sticky: true });
		expect(reversed.applyRegex("a", { kind: "message" })).toBe("b");
	});

	it("替换函数拿到 this.getvar 与当前匹配", () => {
		const ejs = createStEjsRuntime({
			variables: { local: { name: "甲", hp: 3 } },
		});
		ejs.activateRegex(/{{(\w+)}}/g, function (match: unknown, key: unknown) {
			this.setvar("matched", String(match));
			return `${String(this.getvar(String(key)))}:${this.offset}`;
		});
		const output = ejs.applyRegex("你好{{name}}，{{hp}}", { kind: "message" });
		expect(output).toBe("你好甲:2，3:11");
		expect(ejs.variables.read("matched")).toBe("{{hp}}");
		expect(ejs.getWrites().some((write) => write.key === "matched")).toBe(true);
	});

	it("模板里可以注册正则，生成阶段不自动执行", async () => {
		const ejs = createStEjsRuntime();
		const rendered = await ejs.render("<% activateRegex('/甲/g', '乙') %>正文");
		expect(rendered).toBe("正文");
		expect(ejs.getActivatedRegexes()).toHaveLength(1);
		expect(ejs.applyRegex("甲", { kind: "message" })).toBe("乙");
	});

	it("字符串 pattern 支持正则字面量与标志", () => {
		const ejs = createStEjsRuntime();
		ejs.activateRegex("/a/g", "b", { sticky: true });
		expect(ejs.applyRegex("A a", { kind: "message" })).toBe("A b");

		const insensitive = createStEjsRuntime();
		insensitive.activateRegex("/a/gi", "b", { sticky: true });
		expect(insensitive.applyRegex("A a", { kind: "message" })).toBe("b b");
	});

	it("非法参数直接抛错", () => {
		const ejs = createStEjsRuntime();
		expect(() => ejs.activateRegex("", "b")).toThrow(StEjsRegexError);
		expect(() => ejs.activateRegex("/a/", 1 as unknown as string)).toThrow(
			"字符串或函数",
		);
		expect(() =>
			ejs.activateRegex("/a/", "b", { minDepth: 2, maxDepth: 1 }),
		).toThrow("minDepth");
		expect(() => ejs.activateRegex("/a/", "b", { minDepth: -1 })).toThrow(
			"非负整数",
		);
		expect(() =>
			ejs.activateRegex("/a/", "b", {
				basic: "yes" as unknown as boolean,
			}),
		).toThrow("布尔值");
		expect(() => ejs.activateRegex("/a/", "b", { order: Number.NaN })).toThrow(
			"order",
		);
	});
});

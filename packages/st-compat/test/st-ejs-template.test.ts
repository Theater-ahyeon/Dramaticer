import { describe, expect, it } from "vitest";
import { StEjsTemplateError, createStEjsRuntime } from "../src/st-ejs/index.js";

function runtime() {
	return createStEjsRuntime({
		messages: [
			{ id: 0, role: "user", content: "第一楼" },
			{ id: 1, role: "assistant", content: "第二楼" },
			{ id: 2, role: "assistant", content: "第三楼" },
		],
	});
}

describe("EJS 模板渲染", () => {
	it("执行表达式与语句块，print 的输出落在调用位置", async () => {
		const ejs = runtime();
		const output = await ejs.render("A<%- 1 + 1 %>B<% print('c', 'd') %>E");
		expect(output).toBe("A2BcdE");
	});

	it("生成阶段的 <%= 与 <%- 一样直接输出，消息渲染可以套格式化", async () => {
		const plain = createStEjsRuntime({});
		expect(await plain.render("<%= '<b>' %>")).toBe("<b>");

		const formatted = createStEjsRuntime({
			formatEscaped: (value) => `[${value}]`,
		});
		expect(await formatted.render("<%= '<b>' %>")).toBe("[<b>]");
		expect(await formatted.render("<%- '<b>' %>")).toBe("<b>");
	});

	it("支持空白控制标记", async () => {
		const ejs = runtime();
		const output = await ejs.render("A   <%_ if(true){ %>B<% } _%>\nC");
		expect(output).toBe("ABC");
	});

	it("<#escape-ejs> 里的标签按原文输出", async () => {
		const ejs = runtime();
		const output = await ejs.render("<#escape-ejs><%= 1 + 1 %></#escape-ejs>");
		expect(output).toBe("<%= 1 + 1 %>");
	});

	it("消息渲染时还原 HTML 转义的标签", async () => {
		const ejs = runtime();
		expect(await ejs.render("&lt;%= 2 %&gt;")).toBe("&lt;%= 2 %&gt;");
		expect(await ejs.render("&lt;%= 2 %&gt;", { unescapeHtmlTags: true })).toBe(
			"2",
		);
	});

	it("await 可用于异步表达式", async () => {
		const ejs = runtime();
		expect(await ejs.render("<%- await Promise.resolve('x') %>")).toBe("x");
	});

	it("模板错误带上来源与位置", async () => {
		const ejs = runtime();
		await expect(
			ejs.render("<% if ( %>", { source: "世界书/测试条目" }),
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof StEjsTemplateError &&
				error.source === "世界书/测试条目" &&
				error.message.includes("世界书/测试条目"),
		);
	});

	it("define 的变量与函数跨渲染保留，函数里的 this 能读写变量", async () => {
		const ejs = createStEjsRuntime({
			variables: { local: { hp: 5 } },
		});
		await ejs.render(
			"<% define('double', function (x) { return x * 2; }); " +
				"define('readHp', function () { return this.getvar('hp'); }); %>",
		);
		expect(await ejs.render("<%- double(3) %>")).toBe("6");
		expect(await ejs.render("<%- readHp() %>")).toBe("5");
	});

	it("evalTemplate 用同一个运行时递归渲染", async () => {
		const ejs = createStEjsRuntime({
			variables: {
				local: {
					name: "阿岚",
					tpl: "你好，<%- getvar('name') %>",
					plain: "<%- v %>",
				},
			},
		});
		const output = await ejs.render("<%- await evalTemplate(getvar('tpl')) %>");
		expect(output).toBe("你好，阿岚");
		expect(
			await ejs.render(
				"<%- await evalTemplate(getvar('plain'), { v: 'x' }) %>",
			),
		).toBe("x");
	});

	it("prompt 注入按顺序拼接，同一 uid 覆盖，支持后处理", async () => {
		const ejs = runtime();
		const output = await ejs.render(
			"<% injectPrompt('k', 'A', 100, 0, 'u1'); " +
				"injectPrompt('k', 'B', 50); " +
				"injectPrompt('k', 'C', 100, 0, 'u1'); %>" +
				"<%- getPromptsInjected('k') %>|<%- hasPromptsInjected('k') %>|" +
				"<%- getPromptsInjected('k', [{ search: 'B', replace: 'X' }]) %>",
		);
		expect(output).toBe("B\nC|true|X\nC");
	});

	it("读取对话楼层支持负下标、角色筛选与区间", async () => {
		const ejs = runtime();
		expect(await ejs.render("<%- getChatMessage(-1) %>")).toBe("第三楼");
		expect(await ejs.render("<%- getChatMessage(0, 'assistant') %>")).toBe("");
		expect(await ejs.render("<%- getChatMessages(2).join('|') %>")).toBe(
			"第二楼|第三楼",
		);
		expect(
			await ejs.render("<%- getChatMessages(1, 'assistant').join('|') %>"),
		).toBe("第三楼");
		expect(await ejs.render("<%- getChatMessages(0, 1).join('|') %>")).toBe(
			"第一楼|第二楼",
		);
		expect(await ejs.render("<%- getChatMessages(-2, -1).join('|') %>")).toBe(
			"第二楼|第三楼",
		);
	});

	it("在楼层里查找内容", async () => {
		const ejs = runtime();
		expect(await ejs.render("<%- matchChatMessages('第三楼') %>")).toBe("true");
		expect(await ejs.render("<%- matchChatMessages('第一楼') %>")).toBe(
			"false",
		);
		expect(
			await ejs.render("<%- matchChatMessages('第一楼', { start: 0 }) %>"),
		).toBe("true");
		expect(
			await ejs.render("<%- matchChatMessages('X', { start: 0 }) %>"),
		).toBe("false");
		expect(
			await ejs.render(
				"<%- matchChatMessages(/第.楼/, { start: 0, role: 'user' }) %>",
			),
		).toBe("true");
	});
});

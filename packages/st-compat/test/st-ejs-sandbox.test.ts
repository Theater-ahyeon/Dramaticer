import { afterEach, describe, expect, it } from "vitest";
import {
	type StEjsRuntime,
	type StEjsSandbox,
	StEjsSandboxTimeoutError,
	StEjsTemplateError,
	createStEjsRuntime,
	createStEjsSandbox,
} from "../src/st-ejs/index.js";
import { parseWorldInfoJson } from "../src/world-info.js";

const sandboxes: StEjsSandbox[] = [];

function sandboxed(
	runtime: StEjsRuntime,
	options: {
		budgetMs?: number;
		allowedFunctions?: readonly string[];
	} = {},
): StEjsSandbox {
	const sandbox = createStEjsSandbox({ runtime, ...options });
	runtime.setExecutor(sandbox);
	sandboxes.push(sandbox);
	return sandbox;
}

afterEach(async () => {
	await Promise.all(
		sandboxes.splice(0).map(async (sandbox) => sandbox.dispose()),
	);
});

describe("EJS 沙箱", () => {
	it("变量函数经远程调用执行，写入回到主线程的变量存储", async () => {
		const runtime = createStEjsRuntime({
			variables: { initial: { hp: 3 } },
		});
		sandboxed(runtime);
		expect(await runtime.render('<%= getvar("hp") %>')).toBe("3");
		expect(
			await runtime.render(
				'<% setvar("hp", getvar("hp") + 1) %><%= getvar("hp") %>',
			),
		).toBe("4");
		expect(runtime.variables.writes).toHaveLength(1);
		expect(runtime.variables.read("hp")).toBe(4);
	});

	it("print、define 与 evalTemplate 在沙箱里可用", async () => {
		const runtime = createStEjsRuntime();
		sandboxed(runtime);
		expect(await runtime.render('<% print("A", "B") %>')).toBe("AB");
		expect(
			await runtime.render(
				'<% define("double", (value) => value * 2) %><%- await evalTemplate("<" + "%= double(4) " + "%" + ">") %>',
			),
		).toBe("8");
	});

	it("格式化函数经远程调用取结果", async () => {
		const runtime = createStEjsRuntime({
			formatEscaped: (value) => `[${value}]`,
		});
		sandboxed(runtime);
		expect(await runtime.render("<%= '<b>' %>")).toBe("[<b>]");
		expect(await runtime.render("<%- '<b>' %>")).toBe("<b>");
	});

	it("模板拿不到 process、require、fetch、Buffer 与动态 import", async () => {
		const runtime = createStEjsRuntime();
		sandboxed(runtime);
		expect(
			await runtime.render(
				"<%= typeof process %>|<%= typeof require %>|<%= typeof fetch %>|<%= typeof Buffer %>",
			),
		).toBe("undefined|undefined|undefined|undefined");
		expect(
			await runtime.render(
				'<%= ({}).constructor.constructor("return typeof process")() %>',
			),
		).toBe("undefined");
		await expect(runtime.render('<%- require("node:fs") %>')).rejects.toThrow(
			StEjsTemplateError,
		);
		await expect(
			runtime.render('<% const fs = await import("node:fs"); %>'),
		).rejects.toThrow(/dynamic import callback/);
		await expect(
			runtime.render('<% const net = await import("node:net"); %>'),
		).rejects.toThrow(/dynamic import callback/);
	});

	it("允许清单外的函数不可见", async () => {
		const runtime = createStEjsRuntime({ variables: { initial: { hp: 1 } } });
		sandboxed(runtime, { allowedFunctions: ["getvar"] });
		expect(await runtime.render('<%= getvar("hp") %>')).toBe("1");
		await expect(runtime.render('<% setvar("hp", 2) %>')).rejects.toThrow(
			/setvar/,
		);
	});

	it("超时终止 worker，下一次执行重新启动", async () => {
		const runtime = createStEjsRuntime();
		const sandbox = sandboxed(runtime, { budgetMs: 300 });
		const startedAt = performance.now();
		const result = await sandbox.run({
			template: "<% while (true) {} %>",
			source: "死循环",
			escape: "string",
		});
		expect(performance.now() - startedAt).toBeLessThan(5_000);
		expect(result.output).toBeNull();
		expect(result.trace.outcome).toBe("timeout");
		expect(result.trace.source).toBe("死循环");
		expect(result.trace.reason).toContain("300");
		expect(result.trace.durationMs).toBeGreaterThanOrEqual(0);
		expect(await runtime.render("<%= 1 + 1 %>")).toBe("2");
	});

	it("超时经运行时抛出带来源的错误", async () => {
		const runtime = createStEjsRuntime();
		sandboxed(runtime, { budgetMs: 200 });
		await expect(
			runtime.render("<% while (true) {} %>", { source: "卡住" }),
		).rejects.toThrow(StEjsSandboxTimeoutError);
	});

	it("世界书条目里的模板在沙箱里渲染", async () => {
		const worldJson = JSON.stringify({
			entries: {
				"0": {
					uid: 0,
					key: ["alpha"],
					comment: "alpha",
					content: '<% setvar("seen", getvar("seen") + 1) %>甲',
				},
			},
		});
		const runtime = createStEjsRuntime({
			variables: { initial: { seen: 0 } },
			worldInfo: {
				worlds: [parseWorldInfoJson(worldJson)],
				currentWorld: "world-1",
				messages: ["这是第一楼"],
			},
		});
		sandboxed(runtime);
		expect(await runtime.render("<%- await getwi('alpha') %>")).toBe("甲");
		expect(runtime.variables.read("seen")).toBe(1);
	});

	it("执行记录列出调用过的函数与耗时", async () => {
		const runtime = createStEjsRuntime({ variables: { initial: { hp: 2 } } });
		const sandbox = sandboxed(runtime);
		const result = await sandbox.run({
			template: '<%= getvar("hp") %><%= getvar("hp") %>',
			source: "记录",
			escape: "string",
		});
		expect(result.output).toBe("22");
		expect(result.trace.outcome).toBe("ok");
		expect(result.trace.functions).toEqual(["getvar"]);
		expect(result.trace.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("沙箱之间互不影响，模板错误带来源", async () => {
		const first = createStEjsRuntime();
		sandboxed(first);
		expect(await first.render("<%= 2 * 3 %>")).toBe("6");
		await expect(
			first.render("<% throw new Error('失败') %>", { source: "预设条目" }),
		).rejects.toThrow(/预设条目/);
	});
});

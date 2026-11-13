import {
	type ContextSlotProviders,
	assembleContext,
	createDefaultContextTemplate,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	type StEjsRuntime,
	type StEjsSandbox,
	StEjsTemplateError,
	type StEjsTemplateTraceEntry,
	type StEjsTurnBudget,
	createStEjsRuntime,
	createStEjsSandbox,
} from "../src/st-ejs/index.js";
import { parseWorldInfoJson } from "../src/world-info.js";

const sandboxes: StEjsSandbox[] = [];

function sandboxed(runtime: StEjsRuntime, budgetMs = 5_000): StEjsSandbox {
	const sandbox = createStEjsSandbox({ runtime, budgetMs });
	runtime.setExecutor(sandbox);
	sandboxes.push(sandbox);
	return sandbox;
}

function recordingBudget(remainingMs: number): {
	budget: StEjsTurnBudget;
	entries: StEjsTemplateTraceEntry[];
} {
	const entries: StEjsTemplateTraceEntry[] = [];
	return {
		entries,
		budget: {
			remainingMs: () => remainingMs,
			recordTemplate: (entry) => {
				entries.push(entry);
			},
		},
	};
}

afterEach(async () => {
	await Promise.all(
		sandboxes.splice(0).map(async (sandbox) => sandbox.dispose()),
	);
});

describe("回合内时间预算", () => {
	it("正常执行记录来源、耗时与调用的函数", async () => {
		const runtime = createStEjsRuntime({ variables: { initial: { hp: 2 } } });
		sandboxed(runtime);
		const { budget, entries } = recordingBudget(1_000);

		expect(
			await runtime.render('<%= getvar("hp") %>', {
				source: "世界书 卡:开场",
				budget,
			}),
		).toBe("2");

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			source: "世界书 卡:开场",
			outcome: "ok",
			reason: null,
		});
		expect(entries[0]?.functions).toEqual(["getvar"]);
		expect(entries[0]?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("超时的模板按空内容处理，记录跳过原因，沙箱继续可用", async () => {
		const runtime = createStEjsRuntime();
		sandboxed(runtime);
		const { budget, entries } = recordingBudget(200);

		expect(
			await runtime.render("<% while (true) {} %>", {
				source: "世界书 卡:循环",
				budget,
			}),
		).toBe("");

		expect(entries).toHaveLength(1);
		expect(entries[0]?.outcome).toBe("timeout");
		expect(entries[0]?.source).toBe("世界书 卡:循环");
		expect(entries[0]?.reason).toContain("200");
		expect(await runtime.render("<%= 1 + 1 %>")).toBe("2");
	});

	it("剩余时间覆盖沙箱的默认预算", async () => {
		const runtime = createStEjsRuntime();
		sandboxed(runtime, 30_000);
		const { budget, entries } = recordingBudget(150);
		const startedAt = performance.now();

		expect(
			await runtime.render("<% while (true) {} %>", {
				source: "短预算",
				budget,
			}),
		).toBe("");
		expect(performance.now() - startedAt).toBeLessThan(5_000);
		expect(entries[0]?.durationMs).toBeLessThan(5_000);
	});

	it("预算用完的模板不启动执行，记录 0 毫秒超时", async () => {
		const runtime = createStEjsRuntime();
		sandboxed(runtime);
		const { budget, entries } = recordingBudget(0);

		expect(
			await runtime.render("<%= 1 + 1 %>", { source: "迟到", budget }),
		).toBe("");
		expect(entries).toEqual([
			{
				source: "迟到",
				durationMs: 0,
				outcome: "timeout",
				reason: "回合时间预算已用完",
				functions: [],
			},
		]);
	});

	it("预算模式下的变量写入回到主线程的变量存储", async () => {
		const runtime = createStEjsRuntime({ variables: { initial: { hp: 1 } } });
		sandboxed(runtime);
		const { budget, entries } = recordingBudget(1_000);

		expect(
			await runtime.render('<% setvar("hp", 5) %>甲', {
				source: "写入",
				budget,
			}),
		).toBe("甲");
		expect(runtime.variables.read("hp")).toBe(5);
		expect(entries[0]?.functions).toEqual(["setvar"]);
	});

	it("嵌套的世界书渲染沿用同一个预算，各自记录", async () => {
		const worldJson = JSON.stringify({
			entries: {
				"0": {
					uid: 0,
					key: ["alpha"],
					comment: "alpha",
					content: '<% setvar("seen", 1) %>甲',
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
		const { budget, entries } = recordingBudget(2_000);

		expect(
			await runtime.render("<%- await getwi('alpha') %>", {
				source: "外层",
				budget,
			}),
		).toBe("甲");
		expect(entries.map((entry) => entry.source).sort()).toEqual([
			"世界书 world-1:alpha",
			"外层",
		]);
		expect(entries.every((entry) => entry.outcome === "ok")).toBe(true);
	});

	it("没有沙箱执行器时传预算直接报错", async () => {
		const runtime = createStEjsRuntime();
		const { budget } = recordingBudget(1_000);
		await expect(
			runtime.render("<%= 1 %>", { source: "无沙箱", budget }),
		).rejects.toThrow(StEjsTemplateError);
		await expect(
			runtime.render("<%= 1 %>", { source: "无沙箱", budget }),
		).rejects.toThrow("回合时间预算需要沙箱执行器");
	});

	it("槽位钩子超时跳过模板后回合继续，记录写进 Trace", async () => {
		const runtime = createStEjsRuntime();
		sandboxed(runtime);
		const providers: ContextSlotProviders = {
			character: {
				plugin: "st-ejs",
				async provide(request) {
					const text = await runtime.render("<% while (true) {} %>", {
						source: "世界书 卡:循环",
						budget: request.budget,
					});
					return {
						messages: [{ role: "system" as const, content: `角色设定${text}` }],
						source: "st-ejs:character",
					};
				},
			},
		};

		const assembled = await assembleContext({
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			budgetTokens: 4_000,
			storyId: "s1",
			providers,
			hookBudgetMs: 300,
		});

		const hook = assembled.hooks?.[0];
		expect(hook?.plugin).toBe("st-ejs");
		expect(hook?.outcome).toBe("ok");
		expect(hook?.templates).toHaveLength(1);
		expect(hook?.templates?.[0].outcome).toBe("timeout");
		expect(hook?.templates?.[0].source).toBe("世界书 卡:循环");
		expect(assembled.messages.length).toBeGreaterThan(0);
	});
});

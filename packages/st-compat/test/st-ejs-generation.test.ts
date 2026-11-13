import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	StoryStore,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import {
	type StEjsContentPipeline,
	createStEjsContentPipeline,
} from "../src/st-content/ejs-pipeline.js";
import {
	StEjsGenerationLimitError,
	type StEjsGenerationRunnerInput,
	StEjsGenerationScheduler,
	type StEjsGenerationSink,
	StEjsTemplateError,
	createStEjsBackgroundGenerationRunner,
	createStEjsRuntime,
	createStEjsSandbox,
} from "../src/st-ejs/index.js";

const CARD = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: { name: "测试角色", description: "角色描述" },
	}),
);

function sinkFor(
	scheduler: StEjsGenerationScheduler,
	input: {
		readonly storyId?: string;
		readonly cardId?: string;
		readonly nodeId?: string | null;
	} = {},
): StEjsGenerationSink {
	return {
		submit: (content) =>
			scheduler.submit({
				storyId: input.storyId ?? "s-gen",
				cardId: input.cardId ?? "card-1",
				nodeId: input.nodeId ?? "n-user",
				...content,
			}),
		read: (id) => scheduler.getGenerated(id),
	};
}

function openStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-st-ejs-generation-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	return store;
}

function pipelineFor(
	store: StoryStore,
	storyId: string,
	scheduler: StEjsGenerationScheduler,
): StEjsContentPipeline {
	const pipeline = createStEjsContentPipeline({
		store,
		storyId,
		card: CARD,
		preset: null,
		generation: scheduler,
		cardId: "card-1",
	});
	onTestFinished(() => pipeline.dispose());
	return pipeline;
}

function fakeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		finishReason: "stop",
		stopReason: "stop",
		model: "fake",
		channel: "fake",
		usage: {
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			reasoningTokens: 0,
			cachedTokens: null,
		},
		raw: {},
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

describe("EJS 模板发起的生成", () => {
	it("模板只登记请求并返回 id，渲染不等待后台执行", async () => {
		const calls: StEjsGenerationRunnerInput[] = [];
		const scheduler = new StEjsGenerationScheduler({
			run: async (input) => {
				calls.push(input);
				return "后台结果";
			},
		});
		const runtime = createStEjsRuntime({
			generation: sinkFor(scheduler),
		});
		const id = await runtime.render(
			"<% const id = generate('写摘要', { system: '系统提示', maxTokens: 32 }) %><%= id %>",
		);
		expect(id).toBe("st-ejs-gen-1");
		expect(calls).toHaveLength(0);
		expect(scheduler.get(id)).toMatchObject({
			id,
			storyId: "s-gen",
			cardId: "card-1",
			nodeId: "n-user",
			prompt: "写摘要",
			systemPrompt: "系统提示",
			maxTokens: 32,
			status: "pending",
		});
		expect(scheduler.getCounts("card-1")).toMatchObject({
			pending: 1,
			total: 1,
		});
	});

	it("drain 用后台执行函数生成，下一次渲染能读到结果", async () => {
		const calls: StEjsGenerationRunnerInput[] = [];
		const scheduler = new StEjsGenerationScheduler({
			run: async (input) => {
				calls.push(input);
				return "生成结果";
			},
		});
		const runtime = createStEjsRuntime({
			generation: sinkFor(scheduler),
		});
		const id = await runtime.render("<% print(generate('写摘要')) %>");
		expect(await runtime.render(`<%= getGenerated('${id}') %>`)).toBe("");

		const drain = await scheduler.drain();
		expect(calls).toEqual([{ prompt: "写摘要" }]);
		expect(drain.runs[0]).toMatchObject({ status: "done", text: "生成结果" });
		expect(await runtime.render(`<%= getGenerated('${id}') %>`)).toBe(
			"生成结果",
		);
	});

	it("同一张卡按未完成条数限流，其他卡不受影响", async () => {
		const scheduler = new StEjsGenerationScheduler({
			run: async () => "结果",
			maxPendingPerCard: 2,
		});
		const sink = sinkFor(scheduler);
		sink.submit({ prompt: "一" });
		sink.submit({ prompt: "二" });
		expect(() => sink.submit({ prompt: "三" })).toThrow(
			StEjsGenerationLimitError,
		);
		sinkFor(scheduler, { cardId: "card-2" }).submit({ prompt: "别的卡" });
		expect(scheduler.getCounts("card-1")).toMatchObject({
			pending: 2,
			total: 2,
		});
		expect(scheduler.getCounts("card-2")).toMatchObject({
			pending: 1,
			total: 1,
		});

		const drain = await scheduler.drain({ cardId: "card-1" });
		expect(drain.runs).toHaveLength(2);
		expect(scheduler.getCounts("card-1")).toMatchObject({
			done: 2,
			pending: 0,
		});
		expect(scheduler.getCounts("card-2")).toMatchObject({ pending: 1 });
	});

	it("单条失败记录错误，后续请求照常执行", async () => {
		const scheduler = new StEjsGenerationScheduler({
			run: async (input) => {
				if (input.prompt === "坏请求") throw new Error("后台拒答");
				return "好结果";
			},
		});
		const sink = sinkFor(scheduler);
		const bad = sink.submit({ prompt: "坏请求" });
		const good = sink.submit({ prompt: "好请求" });
		const drain = await scheduler.drain();
		expect(drain.runs.map((run) => run.status)).toEqual(["failed", "done"]);
		expect(scheduler.get(bad)).toMatchObject({
			status: "failed",
			error: "后台拒答",
			text: null,
		});
		expect(scheduler.getGenerated(bad)).toBe("");
		expect(scheduler.getGenerated(good)).toBe("好结果");
		expect(scheduler.getCounts()).toMatchObject({
			done: 1,
			failed: 1,
			total: 2,
		});
	});

	it("没有接入生成队列时直接报错", async () => {
		const runtime = createStEjsRuntime();
		await expect(runtime.render("<% generate('写摘要') %>")).rejects.toThrow(
			StEjsTemplateError,
		);
		await expect(runtime.render("<% generate('写摘要') %>")).rejects.toThrow(
			/生成队列/,
		);
		await expect(runtime.render("<%= getGenerated('x') %>")).rejects.toThrow(
			/生成队列/,
		);
	});

	it("prompt 与选项非法时拒绝登记", async () => {
		const scheduler = new StEjsGenerationScheduler({
			run: async () => "结果",
		});
		const runtime = createStEjsRuntime({
			generation: sinkFor(scheduler),
		});
		await expect(runtime.render("<% generate('') %>")).rejects.toThrow(
			StEjsTemplateError,
		);
		await expect(
			runtime.render("<% generate('写摘要', { unknown: 1 }) %>"),
		).rejects.toThrow(/不支持 unknown/);
		await expect(
			runtime.render("<% generate('写摘要', { maxTokens: 0 }) %>"),
		).rejects.toThrow(/正整数/);
		expect(scheduler.getCounts()).toMatchObject({ total: 0 });
	});

	it("沙箱里的模板也能登记生成", async () => {
		const scheduler = new StEjsGenerationScheduler({
			run: async () => "沙箱结果",
		});
		const runtime = createStEjsRuntime({
			generation: sinkFor(scheduler),
		});
		const sandbox = createStEjsSandbox({ runtime });
		runtime.setExecutor(sandbox);
		onTestFinished(async () => sandbox.dispose());
		const id = await runtime.render("<% print(generate('写摘要')) %>");
		expect(id).toBe("st-ejs-gen-1");
		await scheduler.drain();
		expect(await runtime.render(`<%= getGenerated('${id}') %>`)).toBe(
			"沙箱结果",
		);
	});

	it("后台执行函数使用后台客户端并把选项原样发送", async () => {
		const requests: LlmRequest[] = [];
		const client: LlmClient = {
			complete: async (request) => {
				requests.push(request);
				return fakeResult("模型回答");
			},
		};
		const runner = createStEjsBackgroundGenerationRunner({
			client,
			model: "background",
		});
		expect(
			await runner({
				prompt: "写一段摘要",
				systemPrompt: "你是摘要器",
				maxTokens: 64,
			}),
		).toBe("模型回答");
		expect(requests[0]).toMatchObject({
			model: "background",
			maxTokens: 64,
			messages: [
				{ role: "system", content: "你是摘要器" },
				{ role: "user", content: "写一段摘要" },
			],
		});
		expect(await runner({ prompt: "只有问题" })).toBe("模型回答");
		expect(requests[1]?.messages).toEqual([
			{ role: "user", content: "只有问题" },
		]);
	});

	it("流水线把生成请求绑定到当前故事、卡与楼层", async () => {
		const store = openStore();
		store.createStory({ id: "s-gen", title: "生成测试" });
		const user = store.appendNode({
			id: "n-user",
			storyId: "s-gen",
			parentId: null,
			role: "user",
			raw: "开始。",
		});
		const scheduler = new StEjsGenerationScheduler({
			run: async () => "流水线结果",
		});
		const pipeline = pipelineFor(store, "s-gen", scheduler);
		const rendered = await pipeline.renderTemplate(
			{
				id: "test-template",
				segments: [
					{
						id: "st-main",
						kind: "static",
						text: "<% print(generate('总结这一段')) %>",
					},
				],
			},
			{ nodeId: user.id },
		);
		const segment = rendered.segments[0];
		const id = segment?.kind === "static" ? segment.text : "";
		expect(scheduler.get(id)).toMatchObject({
			storyId: "s-gen",
			cardId: "card-1",
			nodeId: user.id,
			prompt: "总结这一段",
		});
		await scheduler.drain();
		const second = await pipeline.renderTemplate(
			{
				id: "test-template",
				segments: [
					{
						id: "st-main",
						kind: "static",
						text: `<%= getGenerated('${id}') %>`,
					},
				],
			},
			{ nodeId: user.id },
		);
		expect(second.segments[0]).toMatchObject({ text: "流水线结果" });
	});
});

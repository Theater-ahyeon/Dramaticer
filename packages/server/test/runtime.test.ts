import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	type LlmChannelsConfig,
	type LlmModelConfig,
	type LlmStreamingClient,
	StoryStore,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { StoryRuntimeManager } from "../src/runtime.js";

const unusedClient: LlmStreamingClient = {
	stream() {
		throw new Error("测试不发起模型请求");
	},
	async complete() {
		throw new Error("测试不发起模型请求");
	},
};

function tempStore(): StoryStore {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-runtime-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	const store = StoryStore.open(join(dir, "story.db"));
	onTestFinished(() => store.close());
	store.createStory({ id: "s1", title: "测试故事" });
	return store;
}

function model(alias: string, id: string, maxTokens = 1_024): LlmModelConfig {
	return {
		alias,
		id,
		contextWindow: 8_192,
		maxTokens,
		reasoning: true,
		channels: ["gateway"],
		tools: null,
		probe: null,
	};
}

function configWith(
	models: readonly LlmModelConfig[],
	roles: ReadonlyMap<
		"writer" | "settler" | "planner" | "judge",
		string
	> = new Map(),
): LlmChannelsConfig {
	return {
		channels: new Map([
			[
				"gateway",
				{
					id: "gateway",
					api: "openai-completions",
					baseUrl: "http://127.0.0.1:9",
					apiKey: "",
					requestsPerMinute: 0,
					maxRetries: 0,
					retryBaseDelayMs: 0,
					timeoutMs: 1_000,
				},
			],
		]),
		models: new Map(models.map((item) => [item.alias, item])),
		roles,
		embeddings: new Map(),
	};
}

async function aliasesFor(config: LlmChannelsConfig): Promise<string[]> {
	const store = tempStore();
	const aliases: string[] = [];
	const manager = new StoryRuntimeManager({
		store,
		loadConfig: async () => config,
		createClient: (_config, alias) => {
			aliases.push(alias);
			return unusedClient;
		},
	});
	const runtime = await manager.get("s1");
	expect(runtime.chatClient).toBe(unusedClient);
	return aliases;
}

describe("StoryRuntimeManager 按角色创建客户端", () => {
	it("正文用 writer、后台任务用 settler 配置的模型", async () => {
		const aliases = await aliasesFor(
			configWith(
				[
					model("main", "opendesign/deepseek-v4.1-flash"),
					model("background", "agy-gemini-3.8-flash-medium"),
					model("rp", "agy-gemini-3.8-flash-medium"),
					model("judge", "codex/gpt-6.1-terra"),
				],
				new Map([
					["writer", "rp"],
					["settler", "background"],
					["planner", "judge"],
					["judge", "judge"],
				]),
			),
		);
		expect(aliases).toEqual(["rp", "background"]);
	});

	it("没有配置角色时正文回落到 main、后台回落到 background", async () => {
		const aliases = await aliasesFor(
			configWith([
				model("main", "opendesign/deepseek-v4.1-flash"),
				model("background", "agy-gemini-3.8-flash-medium"),
			]),
		);
		expect(aliases).toEqual(["main", "background"]);
	});

	it("没有 background 也没有 settler 时后台客户端为空", async () => {
		const store = tempStore();
		const aliases: string[] = [];
		const manager = new StoryRuntimeManager({
			store,
			loadConfig: async () =>
				configWith([model("main", "opendesign/deepseek-v4.1-flash")]),
			createClient: (_config, alias) => {
				aliases.push(alias);
				return unusedClient;
			},
		});
		const runtime = await manager.get("s1");
		expect(runtime.backgroundClient).toBeNull();
		expect(aliases).toEqual(["main"]);
	});
});

describe("StoryRuntimeManager 计算输出上限", () => {
	async function maxTokensFor(
		config: LlmChannelsConfig,
		saved?: number,
	): Promise<number> {
		const store = tempStore();
		if (saved !== undefined) {
			store.updateStorySettings("s1", { maxTokens: saved });
		}
		const manager = new StoryRuntimeManager({
			store,
			loadConfig: async () => config,
			createClient: () => unusedClient,
		});
		return (await manager.get("s1")).maxTokens;
	}

	it("没有保存设置时取 4096 与 writer 声明上限的较小值", async () => {
		expect(
			await maxTokensFor(
				configWith([model("main", "opendesign/deepseek-v4.1-flash", 8_192)]),
			),
		).toBe(4_096);
		expect(
			await maxTokensFor(
				configWith([model("main", "opendesign/deepseek-v4.1-flash", 2_048)]),
			),
		).toBe(2_048);
	});

	it("保存过设置时沿用设置值", async () => {
		expect(
			await maxTokensFor(
				configWith([model("main", "opendesign/deepseek-v4.1-flash", 8_192)]),
				1_500,
			),
		).toBe(1_500);
	});
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { runImagesCli } from "../src/images/cli.js";
import {
	type LlmChannelsConfig,
	type LlmClient,
	type LlmResult,
	StoryStore,
} from "../src/index.js";

const IMAGES_YAML = `providers:
  comfy:
    api: comfyui
    baseUrl: http://127.0.0.1:8188
    apiKey: ""
`;

function channelsConfig(): LlmChannelsConfig {
	const channel = {
		id: "background",
		api: "openai-completions" as const,
		baseUrl: "http://localhost:1234",
		apiKey: "",
		requestsPerMinute: 0,
		maxRetries: 0,
		retryBaseDelayMs: 0,
		timeoutMs: 1_000,
	};
	return {
		channels: new Map([["background", channel]]),
		models: new Map([
			[
				"background",
				{
					alias: "background",
					id: "fake-model",
					channels: ["background"],
					contextWindow: 8_192,
					maxTokens: 1_024,
					reasoning: true,
					enabled: true,
					tools: null,
					probe: null,
				},
			],
		]),
		roles: new Map(),
		embeddings: new Map(),
	};
}

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function seedProfileStory(dbPath: string): void {
	const store = StoryStore.open(dbPath);
	try {
		store.createStory({ id: "s1", title: "视觉档案" });
		store.updateStorySettings("s1", {
			cardName: "凛",
			characterPrompt: "凛是图书委员，黑长直，常穿深蓝校服。",
		});
	} finally {
		store.close();
	}
}

function workflowRaw(secondSampler = false): unknown {
	const raw: Record<string, unknown> = {
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: 1,
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: 512, height: 768 },
		},
		"6": { class_type: "CLIPTextEncode", inputs: { text: "一只猫" } },
		"7": { class_type: "CLIPTextEncode", inputs: { text: "低质量" } },
	};
	if (secondSampler) {
		raw["8"] = {
			class_type: "KSampler",
			inputs: {
				seed: 2,
				positive: ["9", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		};
		raw["9"] = { class_type: "CLIPTextEncode", inputs: { text: "一只狗" } };
	}
	return raw;
}

function setup(): {
	dbPath: string;
	imagesPath: string;
	file: string;
	logs: string[];
} {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-images-cli-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	const dbPath = join(dir, "story.db");
	const store = StoryStore.open(dbPath);
	store.close();
	const imagesPath = join(dir, "images.yaml");
	writeFileSync(imagesPath, IMAGES_YAML);
	const file = join(dir, "workflow.json");
	writeFileSync(file, JSON.stringify(workflowRaw()));
	return { dbPath, imagesPath, file, logs: [] };
}

function deps(setupResult: {
	dbPath: string;
	imagesPath: string;
	logs: string[];
}) {
	return {
		log: (message: string) => setupResult.logs.push(message),
		loadEnv: () => {},
	};
}

describe("runImagesCli", () => {
	it("导入时打印识别结果，并能列出、查看与删除", async () => {
		const context = setup();
		const imported = await runImagesCli(
			[
				"images",
				"workflow",
				"import",
				"--file",
				context.file,
				"--name",
				"默认",
				"--db",
				context.dbPath,
				"--images",
				context.imagesPath,
			],
			deps(context),
		);
		expect(imported.action).toBe("import");
		expect(imported.workflows[0]?.slots.positive).toEqual({
			nodeId: "6",
			input: "text",
		});
		expect(context.logs.join("\n")).toContain("插槽识别结果");
		const id = imported.workflows[0]?.id;
		expect(id).toBeDefined();

		const listed = await runImagesCli(
			["images", "workflow", "list", "--db", context.dbPath],
			deps(context),
		);
		expect(listed.workflows).toHaveLength(1);

		const shown = await runImagesCli(
			["images", "workflow", "show", id as string, "--db", context.dbPath],
			deps(context),
		);
		expect(shown.workflows[0]?.name).toBe("默认");

		const deleted = await runImagesCli(
			["images", "workflow", "delete", id as string, "--db", context.dbPath],
			deps(context),
		);
		expect(deleted.workflows[0]?.id).toBe(id);
		const after = await runImagesCli(
			["images", "workflow", "list", "--db", context.dbPath],
			deps(context),
		);
		expect(after.workflows).toHaveLength(0);
	});

	it("多采样器没有唯一候选时拒绝，显式插槽后可以导入", async () => {
		const context = setup();
		writeFileSync(context.file, JSON.stringify(workflowRaw(true)));
		await expect(
			runImagesCli(
				[
					"images",
					"workflow",
					"import",
					"--file",
					context.file,
					"--name",
					"多采样器",
					"--db",
					context.dbPath,
					"--images",
					context.imagesPath,
				],
				deps(context),
			),
		).rejects.toThrow(/slots 无法自动解析/);
		const slots = JSON.stringify({
			positive: { nodeId: "6", input: "text" },
			negative: { nodeId: "7", input: "text" },
			seed: { nodeId: "3", input: "seed" },
			width: { nodeId: "5", input: "width" },
			height: { nodeId: "5", input: "height" },
		});
		const imported = await runImagesCli(
			[
				"images",
				"workflow",
				"import",
				"--file",
				context.file,
				"--name",
				"多采样器",
				"--db",
				context.dbPath,
				"--images",
				context.imagesPath,
				"--slots",
				slots,
			],
			deps(context),
		);
		expect(imported.workflows).toHaveLength(1);
	});

	it("非法 --slots 与缺失的 images.yaml 都拒绝", async () => {
		const context = setup();
		await expect(
			runImagesCli(
				[
					"images",
					"workflow",
					"import",
					"--file",
					context.file,
					"--name",
					"坏插槽",
					"--db",
					context.dbPath,
					"--images",
					context.imagesPath,
					"--slots",
					"{",
				],
				deps(context),
			),
		).rejects.toThrow(/--slots 必须是合法 JSON/);
		await expect(
			runImagesCli(
				[
					"images",
					"workflow",
					"import",
					"--file",
					context.file,
					"--name",
					"没有 provider",
					"--db",
					context.dbPath,
					"--images",
					`${context.imagesPath}.missing`,
				],
				deps(context),
			),
		).rejects.toThrow(/没有配置图像 provider/);
	});

	it("profiles 列出档案，--generate 与后台任务共用处理器", async () => {
		const context = setup();
		seedProfileStory(context.dbPath);
		let calls = 0;
		const client: LlmClient = {
			async complete() {
				calls += 1;
				return llmResult(
					JSON.stringify({
						profiles: [
							{
								character: "凛",
								base: ["黑长直", "红瞳"],
								defaultOutfit: "深蓝校服",
							},
						],
					}),
				);
			},
		};
		const profileDeps = {
			...deps(context),
			loadChannelsConfig: async () => channelsConfig(),
			createClient: () => client,
		};

		const empty = await runImagesCli(
			["images", "profiles", "--story", "s1", "--db", context.dbPath],
			profileDeps,
		);
		expect(empty.profiles).toEqual([]);
		expect(context.logs.join("\n")).toContain("还没有视觉档案");
		expect(calls).toBe(0);

		context.logs.length = 0;
		const generated = await runImagesCli(
			[
				"images",
				"profiles",
				"--story",
				"s1",
				"--db",
				context.dbPath,
				"--generate",
				"--json",
			],
			profileDeps,
		);
		expect(calls).toBe(1);
		expect(generated.profiles).toHaveLength(1);
		expect(generated.profiles[0]?.source).toBe("model");
		expect(generated.profiles[0]?.profile.base).toEqual(["黑长直", "红瞳"]);
		const logged = JSON.parse(context.logs[0] ?? "[]") as unknown[];
		expect(logged).toHaveLength(1);
	});
});

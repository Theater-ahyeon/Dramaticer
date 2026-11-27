import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type CharacterOutfit,
	type CharacterVisualProfile,
	ILLUSTRATE_JOB_KIND,
	IMAGE_ORGANIZER_JOB_KIND,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createBackgroundJobRegistry,
	createIllustrateHandler,
	createImageOrganizerHandler,
	drainBackgroundJobs,
	expandImageOrganizerResult,
	illustrateNeedsRun,
	imageOrganizerNeedsRun,
	requestImageOrganization,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function resultOf(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function scriptedClient(text: string | (() => string)): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				return resultOf(typeof text === "function" ? text() : text);
			},
		},
	};
}

function workflow(store: StoryStore): string {
	return store.saveImageWorkflow({
		name: "basic",
		provider: "comfy",
		payload: {
			"3": {
				class_type: "KSampler",
				inputs: { seed: 1, positive: ["6", 0], negative: ["7", 0] },
			},
			"6": { class_type: "CLIPTextEncode", inputs: { text: "a" } },
			"7": { class_type: "CLIPTextEncode", inputs: { text: "b" } },
		} as never,
		slots: {
			positive: { nodeId: "6", input: "text" },
			negative: { nodeId: "7", input: "text" },
			seed: { nodeId: "3", input: "seed" },
			width: null,
			height: null,
		},
	}).id;
}

function profile(): CharacterVisualProfile {
	return {
		character: "林雪",
		base: ["black hair"],
		defaultOutfit: "守夜服",
		outfitPath: null,
		negative: ["bad hands"],
		seed: null,
		backends: {},
		locked: true,
		slots: {
			face: {
				front: { clothed: ["face front"], bare: [] },
				back: { clothed: [], bare: [] },
			},
			upper: {
				front: { clothed: ["upper front"], bare: [] },
				back: { clothed: [], bare: [] },
			},
			full: {
				front: { clothed: ["full front"], bare: [] },
				back: { clothed: [], bare: [] },
			},
		},
	};
}

function outfit(): CharacterOutfit {
	return {
		id: "outfit-1",
		storyId: "s1",
		character: "林雪",
		name: "守夜服",
		upperVisible: ["black coat"],
		upperHidden: ["coat collar"],
		fullVisible: ["long skirt"],
		fullHidden: ["hem"],
		isDefault: true,
		locked: true,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

const MODEL_OUTPUT = JSON.stringify({
	images: [
		{
			insertAfterParagraph: 2,
			title: "雨夜门厅",
			scene: "林雪站在门厅，雨从门缝灌进来。",
			composition: "wide shot；cinematic lighting",
			characters: [
				{
					name: "林雪",
					angle: "front",
					body: "upper",
					exposure: "clothed",
					outfitName: "守夜服",
					action: "holding a lamp；warm light",
					negative: "bad hands, extra arms",
					center: { x: 0.5, y: 0.4 },
				},
			],
			negativePrompt: "blurry",
		},
	],
});

function seedStory(store: StoryStore): {
	readonly workflowId: string;
	readonly previous: string;
	readonly target: string;
} {
	store.createStory({ id: "s1", title: "画面整理" });
	const workflowId = workflow(store);
	const root = store.appendNode({
		id: "n0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "旧楼里只有一盏灯。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: root.id,
		role: "user",
		raw: "我推门走进门厅。",
	});
	const target = store.appendNode({
		id: "n2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "第一段，雨声更近了。\n\n第二段，林雪抬起头。\n\n第三段，灯影摇了一下。",
	});
	const oldImage = store.insertNodeImage({
		storyId: "s1",
		nodeId: root.id,
		request: { scene: "旧图" },
		workflowId,
		seed: 1,
	});
	store.startNodeImage(oldImage.id, {
		prompt: "old prompt",
		negativePrompt: "",
	});
	store.finishNodeImage(oldImage.id, {
		fileName: "s1/old.png",
		mediaType: "image/png",
		width: 8,
		height: 8,
	});
	store.saveCharacterVisualProfiles({
		storyId: "s1",
		profiles: [profile()],
		source: "player",
	});
	store.replaceCharacterOutfits({ storyId: "s1", outfits: [outfit()] });
	store.replaceTagLibraryEntries({
		storyId: "s1",
		entries: [
			{
				id: "tag-const",
				category: "composition",
				name: "常驻构图",
				content: "wide shot, centered",
				constant: true,
			},
			{
				id: "tag-rain",
				category: "action",
				name: "雨",
				content: "rain streaks",
				keywords: ["雨"],
			},
		],
	});
	store.setStoryValue("s1", "writing.entries", [
		{
			id: "w1",
			name: "画风",
			content: "soft light, muted colors",
			role: "system",
			placement: "after-history",
			depth: 0,
			order: 0,
			enabled: true,
			scope: "image_organizer",
		},
	]);
	const entity = store.upsertEntity({
		storyId: "s1",
		name: "林雪",
		kind: "character",
		source: "card",
	});
	store.appendNotebookVersion({
		storyId: "s1",
		entityId: entity.id,
		nodeId: target.id,
		base: "旧宅的守夜人。",
		now: "守着门厅的灯。",
		past: [],
		locked: [],
		source: "compile",
		note: null,
	});
	store.saveSceneLog({
		nodeId: target.id,
		storyId: "s1",
		beat: "对峙",
		present: ["林雪"],
		sceneEnds: true,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
	store.updateStorySettings("s1", {
		imageConfig: {
			mode: "auto",
			workflowId,
			maxPerFloor: 2,
			minFloorsBetween: 0,
			trigger: "manual",
			recentPromptHistory: 3,
			replacementRules: [
				{ pattern: "门厅", replacement: "大厅", isRegex: false, enabled: true },
				{
					pattern: "\\bcinematic\\b",
					replacement: "filmic",
					isRegex: true,
					enabled: true,
				},
			],
		},
	});
	return { workflowId, previous: "u1", target: target.id };
}

function pngBytes(): Uint8Array {
	return Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	);
}

function organizerRegistry(
	handler = createImageOrganizerHandler({ seed: () => 7 }),
) {
	return createBackgroundJobRegistry({
		[IMAGE_ORGANIZER_JOB_KIND]: {
			handler,
			enqueue: "story",
			tier: "gap",
			needsRun: imageOrganizerNeedsRun,
		},
	});
}

describe("画面整理", () => {
	it("整理输入齐全，展开后清洗去重、应用替换并写入插图记录", async () => {
		const { store } = openTempStore();
		const { target } = seedStory(store);
		const { client, requests } = scriptedClient(MODEL_OUTPUT);
		requestImageOrganization(store, "s1", target);
		await drainBackgroundJobs({
			store,
			registry: organizerRegistry(),
			client,
			storyId: "s1",
			sessionEnded: true,
		});
		expect(requests).toHaveLength(1);
		const user = requests[0]?.messages.at(-1)?.content;
		expect(typeof user).toBe("string");
		const content = user as string;
		expect(content).toContain("[1] 第一段");
		expect(content).toContain("[2] 第二段");
		expect(content).toContain("[3] 第三段");
		expect(content).toContain("我推门走进门厅。");
		expect(content).toContain("守着门厅的灯。");
		expect(content).toContain("世界索引：");
		expect(content).toContain("wide shot, centered");
		expect(content).toContain("rain streaks");
		expect(content).toContain("soft light, muted colors");
		expect(content).toContain("林雪：默认 守夜服；服装：守夜服");
		expect(content).toContain("old prompt");

		const images = store.listNodeImages(target);
		expect(images).toHaveLength(1);
		const image = images[0];
		expect(image?.title).toBe("雨夜门厅");
		expect(image?.insertAfterParagraph).toBe(2);
		expect(image?.organizerResult?.images).toHaveLength(1);
		expect(image?.organizerResult?.expanded).toHaveLength(1);
		expect(image?.prompt).toContain("林雪站在大厅");
		expect(image?.prompt).toContain("wide shot");
		expect(image?.prompt).toContain("filmic lighting");
		expect(image?.prompt?.toLowerCase()).not.toContain("cinematic");
		expect(image?.prompt).not.toContain("门厅");
		expect(image?.prompt).toContain("upper front");
		expect(image?.prompt).toContain("black coat");
		expect(image?.prompt).toContain("hem");
		expect(image?.prompt).toContain("holding a lamp");
		expect(image?.prompt).toContain("warm light");
		expect(image?.negativePrompt).toContain("blurry");
		expect(image?.negativePrompt).toContain("extra arms");
		expect(
			image?.negativePrompt?.split(", ").filter((tag) => tag === "bad hands"),
		).toHaveLength(1);
		const character = image?.organizerResult?.expanded[0]?.characters[0];
		expect(character).toMatchObject({
			name: "林雪",
			center: { x: 0.5, y: 0.4 },
			outfitId: "outfit-1",
		});
		expect(character?.prompt).toContain("warm light");
		expect(character?.negative).toContain("bad hands");

		// 锁定档案与服装不被整理过程改写。
		expect(store.listCharacterVisualProfiles("s1")[0]?.profile).toEqual(
			profile(),
		);
		expect(store.listCharacterOutfits("s1")[0]).toEqual(outfit());
	});
});

describe("画面整理的触发频率", () => {
	function triggerStory(store: StoryStore): {
		readonly workflowId: string;
		readonly ids: readonly string[];
	} {
		store.createStory({ id: "s1", title: "触发" });
		const workflowId = workflow(store);
		let parentId: string | null = null;
		const ids: string[] = [];
		for (const [index, role] of [
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
		].entries()) {
			const node = store.appendNode({
				id: `n${index}`,
				storyId: "s1",
				parentId,
				role: role as "assistant" | "user",
				raw: `楼层 ${index}。`,
			});
			parentId = node.id;
			if (role === "assistant") ids.push(node.id);
		}
		store.saveSceneLog({
			nodeId: "n2",
			storyId: "s1",
			beat: "停",
			present: ["林雪"],
			sceneEnds: false,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		store.saveSceneLog({
			nodeId: "n4",
			storyId: "s1",
			beat: "散",
			present: ["林雪"],
			sceneEnds: true,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		return { workflowId, ids };
	}

	function setConfig(
		store: StoryStore,
		workflowId: string,
		trigger: "scene_end" | "floor" | "manual",
		mode: "auto" | "manual" = "auto",
	): void {
		store.updateStorySettings("s1", {
			imageConfig: {
				mode,
				workflowId,
				maxPerFloor: 1,
				minFloorsBetween: 0,
				trigger,
				recentPromptHistory: 0,
				replacementRules: [],
			},
		});
	}

	const output = JSON.stringify({
		images: [
			{
				insertAfterParagraph: 0,
				title: "触发",
				scene: "门开了。",
				composition: "",
				characters: [],
				negativePrompt: null,
			},
		],
	});

	async function drainOnce(
		store: StoryStore,
		client: LlmClient,
	): Promise<void> {
		await drainBackgroundJobs({
			store,
			registry: organizerRegistry(),
			client,
			storyId: "s1",
			sessionEnded: true,
		});
	}

	it("floor 每个未整理过的助手楼层都触发", async () => {
		const { store } = openTempStore();
		const { workflowId, ids } = triggerStory(store);
		setConfig(store, workflowId, "floor");
		const { client } = scriptedClient(output);
		expect(imageOrganizerNeedsRun(store, "s1")).toBe(true);
		for (let round = 0; round < 3; round += 1) await drainOnce(store, client);
		for (const id of ids) {
			expect(store.listNodeImages(id)).toHaveLength(1);
		}
		expect(imageOrganizerNeedsRun(store, "s1")).toBe(false);
	});

	it("scene_end 只在场末触发", async () => {
		const { store } = openTempStore();
		const { workflowId, ids } = triggerStory(store);
		setConfig(store, workflowId, "scene_end");
		const { client } = scriptedClient(output);
		await drainOnce(store, client);
		expect(store.listNodeImages(ids[0] as string)).toHaveLength(0);
		expect(store.listNodeImages(ids[1] as string)).toHaveLength(0);
		expect(store.listNodeImages(ids[2] as string)).toHaveLength(1);
	});

	it("manual 不自动触发，玩家请求后才整理", async () => {
		const { store } = openTempStore();
		const { workflowId, ids } = triggerStory(store);
		setConfig(store, workflowId, "manual");
		const { client } = scriptedClient(output);
		expect(imageOrganizerNeedsRun(store, "s1")).toBe(false);
		await drainOnce(store, client);
		expect(store.listNodeImages(ids[0] as string)).toHaveLength(0);
		requestImageOrganization(store, "s1", ids[0] as string);
		expect(imageOrganizerNeedsRun(store, "s1")).toBe(true);
		await drainOnce(store, client);
		expect(store.listNodeImages(ids[0] as string)).toHaveLength(1);
	});

	it("模式为手动时即使触发频率是每楼也不自动整理", async () => {
		const { store } = openTempStore();
		const { workflowId } = triggerStory(store);
		setConfig(store, workflowId, "floor", "manual");
		const { client } = scriptedClient(output);
		expect(imageOrganizerNeedsRun(store, "s1")).toBe(false);
		await drainOnce(store, client);
		expect(store.listStoryNodeImages("s1")).toHaveLength(0);
	});
});

describe("画面整理的失败隔离与出图复用", () => {
	it("整理抛错或输出非法 JSON 只让后台任务失败，正文照常可读", async () => {
		const { store } = openTempStore();
		const { target } = seedStory(store);
		const raw = store.getNode(target)?.raw;
		requestImageOrganization(store, "s1", target);
		const { client } = scriptedClient("not json");
		for (let round = 0; round < 3; round += 1) {
			await drainBackgroundJobs({
				store,
				registry: organizerRegistry(),
				client,
				storyId: "s1",
				sessionEnded: true,
			});
		}
		expect(store.getNode(target)?.raw).toBe(raw);
		expect(store.getHead("s1")?.id).toBe(target);
		expect(store.listNodeImages(target)).toHaveLength(0);
		const jobs = store.listBackgroundJobs({
			storyId: "s1",
			kinds: [IMAGE_ORGANIZER_JOB_KIND],
		});
		expect(jobs.some((job) => job.status === "failed")).toBe(true);
	});

	it("出图失败后重试直接复用整理好的提示词，不再调用整理模型", async () => {
		const { store, path } = openTempStore();
		const { target } = seedStory(store);
		const { client, requests } = scriptedClient(MODEL_OUTPUT);
		requestImageOrganization(store, "s1", target);
		let generateCalls = 0;
		const generatedPrompts: string[] = [];
		const registry = createBackgroundJobRegistry({
			[IMAGE_ORGANIZER_JOB_KIND]: {
				handler: createImageOrganizerHandler({ seed: () => 7 }),
				enqueue: "story",
				tier: "gap",
				needsRun: imageOrganizerNeedsRun,
			},
			[ILLUSTRATE_JOB_KIND]: {
				handler: createIllustrateHandler({
					config: {
						providers: new Map([
							[
								"comfy",
								{
									id: "comfy",
									api: "comfyui",
									baseUrl: "http://127.0.0.1:8188",
									apiKey: "",
									timeoutMs: 1_000,
									pollIntervalMs: 1,
								},
							],
						]),
					},
					mediaDir: join(path, "..", "images"),
					createClient: () => ({
						async generate(input) {
							generateCalls += 1;
							generatedPrompts.push(input.prompt);
							if (generateCalls <= 3) throw new Error("图像后端失败");
							return {
								promptId: "p",
								fileName: "a.png",
								mediaType: "image/png",
								bytes: pngBytes(),
							};
						},
					}),
				}),
				enqueue: "story",
				tier: "gap",
				needsRun: illustrateNeedsRun,
			},
		});
		const drain = () =>
			drainBackgroundJobs({
				store,
				registry,
				client,
				storyId: "s1",
				sessionEnded: true,
			});
		await drain();
		const image = store.listNodeImages(target)[0];
		expect(image).toBeDefined();
		const compiled = image?.prompt;
		for (let round = 0; round < 3; round += 1) await drain();
		expect(store.getNodeImage(image?.id as string)?.status).toBe("failed");
		expect(requests).toHaveLength(1);
		store.retryNodeImage(image?.id as string);
		await drain();
		expect(store.getNodeImage(image?.id as string)?.status).toBe("done");
		expect(requests).toHaveLength(1);
		expect(generateCalls).toBe(4);
		expect(new Set(generatedPrompts)).toEqual(new Set([compiled]));
	});
});

describe("提示词后处理", () => {
	it("人物级提示词与总提示词共用同一条管线", () => {
		const result = expandImageOrganizerResult({
			images: [
				{
					insertAfterParagraph: 0,
					title: "测试",
					scene: "甲，乙；丙",
					composition: "wide shot（远景）",
					characters: [],
					negativePrompt: "低质量，模糊",
				},
			],
			profiles: [],
			outfits: [],
			state: {},
			rules: [],
		});
		expect(result.expanded[0]?.prompt).toBe("甲, 乙, 丙, wide shot(远景)");
		expect(result.expanded[0]?.negativePrompt).toContain("低质量, 模糊");
	});
});

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ILLUSTRATE_JOB_KIND,
	type ImageOrganizerResult,
	type LlmClient,
	type StoryStore,
	createBackgroundJobRegistry,
	createIllustrateHandler,
	drainBackgroundJobs,
	enqueueIllustrateBackgroundJob,
	illustrateNeedsRun,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

const SLOTS = {
	positive: { nodeId: "6", input: "text" },
	negative: { nodeId: "7", input: "text" },
	seed: { nodeId: "3", input: "seed" },
	width: null,
	height: null,
};

function workflow(store: StoryStore, name: string): string {
	return store.saveImageWorkflow({
		name,
		provider: "comfy",
		payload: {
			"3": {
				class_type: "KSampler",
				inputs: { seed: 1, positive: ["6", 0], negative: ["7", 0] },
			},
			"6": { class_type: "CLIPTextEncode", inputs: { text: "a" } },
			"7": { class_type: "CLIPTextEncode", inputs: { text: "b" } },
		} as never,
		slots: SLOTS,
	}).id;
}

function organizerResult(): ImageOrganizerResult {
	return {
		images: [
			{
				insertAfterParagraph: 1,
				title: "门厅的灯",
				scene: "林雪站在门厅。",
				composition: "wide shot",
				characters: [
					{
						name: "林雪",
						angle: "front",
						body: "upper",
						exposure: "clothed",
						outfitName: null,
						action: null,
						negative: "bad hands",
						center: { x: 0.5, y: 0.5 },
					},
				],
				negativePrompt: "blurry",
			},
		],
		expanded: [
			{
				insertAfterParagraph: 1,
				title: "门厅的灯",
				prompt: "old prompt, upper front",
				negativePrompt: "old negative",
				characters: [
					{
						name: "林雪",
						prompt: "lin xue, upper front",
						negative: "bad hands",
						center: { x: 0.5, y: 0.5 },
						outfitId: null,
					},
				],
			},
		],
	};
}

const CLIENT: LlmClient = {
	async complete() {
		throw new Error("重绘测试不需要文本模型");
	},
};

function seedImage(store: StoryStore, workflowId: string) {
	store.createStory({ id: "s1", title: "重绘" });
	store.appendNode({
		id: "n1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "第一段。\n\n第二段。\n\n第三段。",
	});
	const image = store.insertNodeImage({
		storyId: "s1",
		nodeId: "n1",
		request: { scene: "门厅" },
		workflowId,
		seed: 7,
		prompt: "old prompt, upper front",
		negativePrompt: "old negative",
		insertAfterParagraph: 1,
		title: "门厅的灯",
		organizerResult: organizerResult(),
	});
	store.startNodeImage(image.id, {
		prompt: "old prompt, upper front",
		negativePrompt: "old negative",
	});
	store.finishNodeImage(image.id, {
		fileName: "s1/old.png",
		mediaType: "image/png",
		width: 8,
		height: 8,
	});
	return image.id;
}

describe("插图重绘与删除", () => {
	it("换 seed 重绘重置状态与图片元数据，保留提示词和段落位置", () => {
		const { store } = openTempStore();
		const workflowId = workflow(store, "默认");
		const id = seedImage(store, workflowId);
		const before = store.getNodeImage(id);
		const redrawn = store.redrawNodeImage(id, { mode: "new_seed" });
		expect(redrawn.seed).not.toBe(7);
		expect(redrawn).toMatchObject({
			status: "pending",
			attempts: 0,
			error: null,
			fileName: null,
			mediaType: null,
			width: null,
			height: null,
			prompt: "old prompt, upper front",
			negativePrompt: "old negative",
			insertAfterParagraph: 1,
			title: "门厅的灯",
			promptEdited: false,
		});
		expect(redrawn.organizerResult).toEqual(before?.organizerResult);
		expect(store.getNode("n1")?.raw).toBe("第一段。\n\n第二段。\n\n第三段。");
	});

	it("改提示词后重绘保留整理结果但标记玩家改过，换模板保留提示词", () => {
		const { store } = openTempStore();
		const workflowId = workflow(store, "默认");
		const otherId = workflow(store, "第二个模板");
		const id = seedImage(store, workflowId);
		const edited = store.redrawNodeImage(id, {
			mode: "edit_prompt",
			prompt: "  玩家改过的提示词  ",
			negativePrompt: " 新的负面 ",
		});
		expect(edited.prompt).toBe("玩家改过的提示词");
		expect(edited.negativePrompt).toBe("新的负面");
		expect(edited.promptEdited).toBe(true);
		expect(edited.seed).toBe(7);
		expect(edited.organizerResult).not.toBeNull();
		const switched = store.redrawNodeImage(id, {
			mode: "switch_workflow",
			workflowId: otherId,
		});
		expect(switched.workflowId).toBe(otherId);
		expect(switched.prompt).toBe("玩家改过的提示词");
		expect(switched.negativePrompt).toBe("新的负面");
		expect(switched.promptEdited).toBe(true);
		expect(switched.seed).toBe(7);
		expect(switched.organizerResult).not.toBeNull();
		expect(store.getNode("n1")?.raw).toBe("第一段。\n\n第二段。\n\n第三段。");
	});

	it("删掉中间的插图后新插图不撞序号，楼层原文保持不变", () => {
		const { store } = openTempStore();
		const workflowId = workflow(store, "默认");
		const first = seedImage(store, workflowId);
		const second = store.insertNodeImage({
			storyId: "s1",
			nodeId: "n1",
			request: { scene: "第二张" },
			workflowId,
			seed: 8,
		});
		const third = store.insertNodeImage({
			storyId: "s1",
			nodeId: "n1",
			request: { scene: "第三张" },
			workflowId,
			seed: 9,
		});
		expect([first, second.id, third.id]).toHaveLength(3);
		expect(second.ordinal).toBe(1);
		const removed = store.deleteNodeImage(second.id);
		expect(removed.id).toBe(second.id);
		expect(store.getNodeImage(second.id)).toBeNull();
		const fourth = store.insertNodeImage({
			storyId: "s1",
			nodeId: "n1",
			request: { scene: "第四张" },
			workflowId,
			seed: 10,
		});
		expect(fourth.ordinal).toBe(3);
		expect(store.listNodeImages("n1").map((image) => image.ordinal)).toEqual([
			0, 2, 3,
		]);
		expect(store.getNode("n1")?.raw).toBe("第一段。\n\n第二段。\n\n第三段。");
	});

	it("改过提示词后出图以玩家文本为准，不再传旧整理结果里的人物", async () => {
		const { store, path } = openTempStore();
		const workflowId = workflow(store, "默认");
		const otherId = workflow(store, "第二个模板");
		const id = seedImage(store, workflowId);
		const calls: {
			readonly prompt: string;
			readonly seed: number;
			readonly workflowId: string;
			readonly characters: readonly { readonly prompt: string }[];
		}[] = [];
		const registry = createBackgroundJobRegistry({
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
							calls.push({
								prompt: input.prompt,
								seed: input.seed,
								workflowId: input.template.id,
								characters: input.characters,
							});
							return {
								promptId: "p",
								fileName: "a.png",
								mediaType: "image/png",
								bytes: PNG,
							};
						},
					}),
				}),
				enqueue: "story",
				tier: "gap",
				needsRun: illustrateNeedsRun,
			},
		});
		const drain = async () => {
			enqueueIllustrateBackgroundJob(store, "s1");
			await drainBackgroundJobs({
				store,
				registry,
				client: CLIENT,
				storyId: "s1",
				sessionEnded: true,
			});
		};
		store.redrawNodeImage(id, { mode: "new_seed" });
		await drain();
		expect(calls[0]?.characters).toHaveLength(1);

		store.redrawNodeImage(id, {
			mode: "edit_prompt",
			prompt: "玩家改过的提示词",
			negativePrompt: "玩家负面",
		});
		await drain();
		expect(calls[1]).toMatchObject({
			prompt: "玩家改过的提示词",
			characters: [],
		});

		const editedSeed = store.getNodeImage(id)?.seed as number;
		store.redrawNodeImage(id, { mode: "new_seed" });
		await drain();
		expect(calls[2]?.prompt).toBe("玩家改过的提示词");
		expect(calls[2]?.seed).not.toBe(editedSeed);

		store.redrawNodeImage(id, {
			mode: "switch_workflow",
			workflowId: otherId,
		});
		await drain();
		expect(calls[3]).toMatchObject({
			prompt: "玩家改过的提示词",
			workflowId: otherId,
			characters: [],
		});
	});
});

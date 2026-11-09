import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
	ApiErrorResponse,
	ImageProvidersView,
	ImageWorkflowDetectionView,
	ImageWorkflowsView,
	StoryVisualProfilesView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

const ENV = { COMFY_KEY: "comfy-secret-value" };

const IMAGES_YAML = `providers:
  comfy:
    api: comfyui
    baseUrl: http://127.0.0.1:8188
    apiKey: \${COMFY_KEY}
`;

const TWO_PROVIDERS_YAML = `${IMAGES_YAML}  second:
    api: comfyui
    baseUrl: http://127.0.0.1:8189
    apiKey: ""
`;

function workflow(positive = "一只猫"): unknown {
	return {
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
		"6": { class_type: "CLIPTextEncode", inputs: { text: positive } },
		"7": { class_type: "CLIPTextEncode", inputs: { text: "低质量" } },
	};
}

const SLOTS = {
	positive: { nodeId: "6", input: "text" },
	negative: { nodeId: "7", input: "text" },
	seed: { nodeId: "3", input: "seed" },
	width: { nodeId: "5", input: "width" },
	height: { nodeId: "5", input: "height" },
};

interface TestServer {
	readonly running: RunningServer;
	readonly dir: string;
	readonly dbPath: string;
}

async function startImagesServer(
	options: { readonly yaml?: string; readonly missing?: boolean } = {},
): Promise<TestServer> {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-images-server-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	const imagesPath = join(dir, "images.yaml");
	if (options.missing !== true) {
		writeFileSync(imagesPath, options.yaml ?? IMAGES_YAML);
	}
	const dbPath = join(dir, "story.db");
	const running = await startServer({
		dbPath,
		webRoot: join(dir, "web"),
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
		images: { path: imagesPath, env: ENV },
	});
	onTestFinished(() => running.close());
	return { running, dir, dbPath };
}

async function request(
	origin: string,
	path: string,
	method = "GET",
	body?: unknown,
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function errorOf(response: Response): Promise<ApiErrorResponse["error"]> {
	const body = (await response.json()) as ApiErrorResponse;
	return body.error;
}

describe("生图接口", () => {
	it("provider 列表只返回 id、地址与状态，不包含密钥", async () => {
		const { running } = await startImagesServer();
		const response = await request(running.origin, "/api/images/providers");
		expect(response.status).toBe(200);
		const view = (await response.json()) as ImageProvidersView;
		expect(view.providers).toEqual([
			{
				id: "comfy",
				api: "comfyui",
				baseUrl: "http://127.0.0.1:8188",
				configured: true,
				timeoutMs: 300_000,
				pollIntervalMs: 1_000,
			},
		]);
		expect(JSON.stringify(view)).not.toContain("comfy-secret-value");
	});

	it("detect 只返回候选不写库，import 保存后可列出", async () => {
		const { running } = await startImagesServer();
		const detect = await request(
			running.origin,
			"/api/images/workflows/detect",
			"POST",
			{ workflow: workflow() },
		);
		expect(detect.status).toBe(200);
		const detection = (await detect.json()) as ImageWorkflowDetectionView;
		expect(detection.slots).toMatchObject({
			positive: { nodeId: "6", input: "text" },
			seed: { nodeId: "3", input: "seed" },
		});
		const empty = await request(running.origin, "/api/images/workflows");
		expect(((await empty.json()) as ImageWorkflowsView).workflows).toEqual([]);

		const imported = await request(
			running.origin,
			"/api/images/workflows/import",
			"POST",
			{ name: "默认", workflow: workflow(), slots: SLOTS },
		);
		expect(imported.status).toBe(200);
		const saved = (await imported.json()) as { id: string; name: string };
		expect(saved.name).toBe("默认");
		const list = await request(running.origin, "/api/images/workflows");
		const view = (await list.json()) as ImageWorkflowsView;
		expect(view.workflows).toHaveLength(1);
		expect(view.workflows[0]?.id).toBe(saved.id);

		const again = await request(
			running.origin,
			"/api/images/workflows/import",
			"POST",
			{ name: "默认", workflow: workflow("一只狗"), slots: SLOTS },
		);
		expect(again.status).toBe(200);
		const updated = (await again.json()) as {
			id: string;
			payload: { "6": { inputs: { text: string } } };
		};
		expect(updated.id).toBe(saved.id);
		expect(updated.payload["6"].inputs.text).toBe("一只狗");
		const after = (await (
			await request(running.origin, "/api/images/workflows")
		).json()) as ImageWorkflowsView;
		expect(after.workflows).toHaveLength(1);
	});

	it("import 缺少插槽、插槽不合法或 workflow 不合法时返回 400 与字段路径", async () => {
		const { running } = await startImagesServer();
		const missing = await request(
			running.origin,
			"/api/images/workflows/import",
			"POST",
			{ name: "x", workflow: workflow() },
		);
		expect(missing.status).toBe(400);
		expect((await errorOf(missing)).details?.path).toBe("slots");

		const badSlot = await request(
			running.origin,
			"/api/images/workflows/import",
			"POST",
			{
				name: "x",
				workflow: workflow(),
				slots: { ...SLOTS, positive: { nodeId: "99", input: "text" } },
			},
		);
		expect(badSlot.status).toBe(400);
		expect((await errorOf(badSlot)).details?.path).toBe("slots");

		const badWorkflow = await request(
			running.origin,
			"/api/images/workflows/import",
			"POST",
			{ name: "x", workflow: { "3": { inputs: {} } }, slots: SLOTS },
		);
		expect(badWorkflow.status).toBe(400);
		expect((await errorOf(badWorkflow)).details?.path).toBe("workflow");
	});

	it("删除未被引用的 workflow，被图片记录引用时返回 409", async () => {
		const { running, dbPath } = await startImagesServer();
		const imported = await request(
			running.origin,
			"/api/images/workflows/import",
			"POST",
			{ name: "默认", workflow: workflow(), slots: SLOTS },
		);
		const saved = (await imported.json()) as { id: string };
		const deleted = await request(
			running.origin,
			`/api/images/workflows/${saved.id}`,
			"DELETE",
		);
		expect(deleted.status).toBe(204);

		const referenced = await request(
			running.origin,
			"/api/images/workflows/import",
			"POST",
			{ name: "被引用", workflow: workflow(), slots: SLOTS },
		);
		const referencedBody = (await referenced.json()) as { id: string };
		const refId = referencedBody.id;
		running.store.createStory({ id: "s1", title: "测试" });
		running.store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "正文",
		});
		const db = new DatabaseSync(dbPath);
		onTestFinished(() => db.close());
		const now = new Date().toISOString();
		db.prepare(
			`INSERT INTO node_images
				(id, story_id, node_id, ordinal, status, request, workflow_id, created_at, updated_at)
			VALUES (?, ?, ?, 0, 'pending', '{}', ?, ?, ?)`,
		).run("img-1", "s1", "n1", refId, now, now);
		const conflict = await request(
			running.origin,
			`/api/images/workflows/${refId}`,
			"DELETE",
		);
		expect(conflict.status).toBe(409);
		expect((await errorOf(conflict)).message).toContain("引用");
	});

	it("多个 provider 时 import 拒绝并要求指定 provider", async () => {
		const { running } = await startImagesServer({
			yaml: TWO_PROVIDERS_YAML,
		});
		const response = await request(
			running.origin,
			"/api/images/workflows/import",
			"POST",
			{ name: "默认", workflow: workflow(), slots: SLOTS },
		);
		expect(response.status).toBe(400);
		expect((await errorOf(response)).details?.path).toBe("provider");
	});

	it("images.yaml 缺失时 provider 列表为空", async () => {
		const { running } = await startImagesServer({ missing: true });
		const response = await request(running.origin, "/api/images/providers");
		expect(response.status).toBe(200);
		expect(((await response.json()) as ImageProvidersView).providers).toEqual(
			[],
		);
	});

	it("手动登记插图：off 返回 409，manual 与 auto 可用，retry 只接受 failed", async () => {
		const { running } = await startImagesServer();
		const savedWorkflow = running.store.saveImageWorkflow({
			name: "默认",
			provider: "comfy",
			payload: workflow() as never,
			slots: SLOTS,
		});
		running.store.createStory({ id: "s1", title: "测试" });
		running.store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "正文",
		});

		const off = await request(running.origin, "/api/nodes/n1/images", "POST", {
			scene: "雨夜",
		});
		expect(off.status).toBe(409);

		const saveSettings = (mode: "manual" | "auto") =>
			request(running.origin, "/api/stories/s1/settings", "PUT", {
				imageConfig: {
					mode,
					workflowId: savedWorkflow.id,
					maxPerFloor: 2,
					minFloorsBetween: 0,
				},
			});
		expect((await saveSettings("manual")).status).toBe(200);

		const invalid = await request(
			running.origin,
			"/api/nodes/n1/images",
			"POST",
			{ scene: "雨夜", extra: true },
		);
		expect(invalid.status).toBe(400);
		expect((await errorOf(invalid)).details?.path).toBe("request");

		const manual = await request(
			running.origin,
			"/api/nodes/n1/images",
			"POST",
			{ scene: "雨夜的站台", characters: ["凛"], shot: "wide" },
		);
		expect(manual.status).toBe(201);
		const first = (await manual.json()) as {
			id: string;
			status: string;
			ordinal: number;
			request: { scene: string };
		};
		expect(first).toMatchObject({
			status: "pending",
			ordinal: 0,
			request: { scene: "雨夜的站台" },
		});
		expect(running.store.listNodeImages("n1")).toHaveLength(1);
		const jobs = running.store.listBackgroundJobs({
			storyId: "s1",
			kinds: ["illustrate"],
		});
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.status).toBe("pending");

		expect((await saveSettings("auto")).status).toBe(200);
		const auto = await request(running.origin, "/api/nodes/n1/images", "POST", {
			scene: "第二张",
		});
		expect(auto.status).toBe(201);

		const pendingRetry = await request(
			running.origin,
			`/api/images/${first.id}/retry`,
			"POST",
		);
		expect(pendingRetry.status).toBe(409);

		running.store.startNodeImage(first.id, {
			prompt: "p",
			negativePrompt: "n",
		});
		running.store.failNodeImage(first.id, {
			error: "后端失败",
			maxAttempts: 1,
		});
		const retried = await request(
			running.origin,
			`/api/images/${first.id}/retry`,
			"POST",
		);
		expect(retried.status).toBe(200);
		expect(await retried.json()).toMatchObject({
			id: first.id,
			status: "pending",
			attempts: 0,
			error: null,
		});

		const missing = await request(
			running.origin,
			"/api/images/missing/retry",
			"POST",
		);
		expect(missing.status).toBe(404);
	});

	it("visual-profiles 返回档案、来源与更新时间，缺失故事 404", async () => {
		const { running } = await startImagesServer();
		running.store.createStory({ id: "s1", title: "测试" });
		const timestamp = "2026-11-09T00:00:00.000Z";
		running.store.saveCharacterVisualProfiles({
			storyId: "s1",
			source: "model",
			createdAt: timestamp,
			updatedAt: timestamp,
			profiles: [
				{
					character: "凛",
					base: ["黑长直"],
					defaultOutfit: "深蓝校服",
					outfitPath: ["character", "凛", "outfit"],
					negative: ["眼镜"],
					seed: 42,
					backends: {},
				},
			],
		});

		const response = await request(
			running.origin,
			"/api/stories/s1/visual-profiles",
		);
		expect(response.status).toBe(200);
		const view = (await response.json()) as StoryVisualProfilesView;
		expect(view).toEqual({
			storyId: "s1",
			profiles: [
				{
					storyId: "s1",
					character: "凛",
					profile: {
						character: "凛",
						base: ["黑长直"],
						defaultOutfit: "深蓝校服",
						outfitPath: ["character", "凛", "outfit"],
						negative: ["眼镜"],
						seed: 42,
						backends: {},
					},
					source: "model",
					createdAt: timestamp,
					updatedAt: timestamp,
				},
			],
		});

		const missing = await request(
			running.origin,
			"/api/stories/missing/visual-profiles",
		);
		expect(missing.status).toBe(404);
	});
});

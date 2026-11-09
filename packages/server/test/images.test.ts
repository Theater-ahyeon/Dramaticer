import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
	ApiErrorResponse,
	ImageProvidersView,
	ImageWorkflowDetectionView,
	ImageWorkflowsView,
	NodeImagesView,
	StoryPath,
	StoryVisualProfileGenerateResult,
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
	options: {
		readonly yaml?: string;
		readonly missing?: boolean;
		readonly password?: string;
	} = {},
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
		password: options.password ?? null,
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

function insertImageRow(
	dbPath: string,
	row: {
		readonly id: string;
		readonly nodeId: string;
		readonly workflowId: string;
		readonly ordinal: number;
		readonly status: string;
		readonly fileName?: string;
		readonly mediaType?: string;
		readonly width?: number;
		readonly height?: number;
		readonly error?: string;
	},
): void {
	const db = new DatabaseSync(dbPath);
	try {
		const now = "2026-11-09T00:00:00.000Z";
		db.prepare(
			`INSERT INTO node_images
				(id, story_id, node_id, ordinal, status, request, workflow_id,
				 file_name, media_type, width, height, error, created_at, updated_at)
			VALUES (?, 's1', ?, ?, ?, '{"scene":"测试"}', ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			row.id,
			row.nodeId,
			row.ordinal,
			row.status,
			row.workflowId,
			row.fileName ?? null,
			row.mediaType ?? null,
			row.width ?? null,
			row.height ?? null,
			row.error ?? null,
			now,
			now,
		);
	} finally {
		db.close();
	}
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

	it("visual-profiles/generate 只入队，已有档案也允许重新生成", async () => {
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
					outfitPath: null,
					negative: [],
					seed: null,
					backends: {},
				},
			],
		});

		const response = await request(
			running.origin,
			"/api/stories/s1/visual-profiles/generate",
			"POST",
		);
		expect(response.status).toBe(202);
		const view = (await response.json()) as StoryVisualProfileGenerateResult;
		expect(view.storyId).toBe("s1");
		expect(view.kind).toBe("visual_profile");
		const jobs = running.store.listBackgroundJobs({
			storyId: "s1",
			kinds: ["visual_profile"],
		});
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.id).toBe(view.jobId);
		expect(jobs[0]?.status).toBe("pending");
		expect(running.store.listCharacterVisualProfiles("s1")).toHaveLength(1);

		const missing = await request(
			running.origin,
			"/api/stories/missing/visual-profiles/generate",
			"POST",
		);
		expect(missing.status).toBe(404);
	});

	it("path 与节点图片接口返回按 ordinal 排序的图片，url 只在 done 时出现", async () => {
		const { running, dbPath } = await startImagesServer();
		running.store.createStory({ id: "s1", title: "测试" });
		running.store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "第一楼",
		});
		running.store.appendNode({
			id: "n2",
			storyId: "s1",
			parentId: "n1",
			role: "assistant",
			raw: "第二楼",
		});
		const savedWorkflow = running.store.saveImageWorkflow({
			name: "默认",
			provider: "comfy",
			payload: workflow() as never,
			slots: SLOTS,
		});
		insertImageRow(dbPath, {
			id: "img-later",
			nodeId: "n1",
			workflowId: savedWorkflow.id,
			ordinal: 1,
			status: "pending",
		});
		insertImageRow(dbPath, {
			id: "img-first",
			nodeId: "n1",
			workflowId: savedWorkflow.id,
			ordinal: 0,
			status: "done",
			fileName: "s1/img-first.png",
			mediaType: "image/png",
			width: 512,
			height: 768,
		});

		const pathResponse = await request(running.origin, "/api/stories/s1/path");
		expect(pathResponse.status).toBe(200);
		const path = (await pathResponse.json()) as StoryPath;
		expect(path.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
		expect(path.nodes[0]?.raw).toBe("第一楼");
		expect(path.nodes[0]?.images).toEqual([
			{
				id: "img-first",
				nodeId: "n1",
				ordinal: 0,
				status: "done",
				url: "/api/images/img-first/file",
				width: 512,
				height: 768,
				error: null,
			},
			{
				id: "img-later",
				nodeId: "n1",
				ordinal: 1,
				status: "pending",
				url: null,
				width: null,
				height: null,
				error: null,
			},
		]);
		expect(path.nodes[1]?.images).toEqual([]);

		const nodeResponse = await request(running.origin, "/api/nodes/n1/images");
		expect(nodeResponse.status).toBe(200);
		expect((await nodeResponse.json()) as NodeImagesView).toEqual({
			nodeId: "n1",
			images: path.nodes[0]?.images,
		});
	});

	it("媒体接口只返回 done 行，未完成、越界文件名与缺失文件都是 404", async () => {
		const { running, dir, dbPath } = await startImagesServer();
		running.store.createStory({ id: "s1", title: "测试" });
		running.store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "正文",
		});
		const mediaDir = join(dir, "images");
		mkdirSync(join(mediaDir, "s1"), { recursive: true });
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
		writeFileSync(join(mediaDir, "s1", "img-done.png"), bytes);
		const savedWorkflow = running.store.saveImageWorkflow({
			name: "默认",
			provider: "comfy",
			payload: workflow() as never,
			slots: SLOTS,
		});
		insertImageRow(dbPath, {
			id: "img-done",
			nodeId: "n1",
			workflowId: savedWorkflow.id,
			ordinal: 0,
			status: "done",
			fileName: "s1/img-done.png",
			mediaType: "image/png",
		});
		insertImageRow(dbPath, {
			id: "img-pending",
			nodeId: "n1",
			workflowId: savedWorkflow.id,
			ordinal: 1,
			status: "pending",
			fileName: "s1/img-done.png",
			mediaType: "image/png",
		});
		insertImageRow(dbPath, {
			id: "img-failed",
			nodeId: "n1",
			workflowId: savedWorkflow.id,
			ordinal: 2,
			status: "failed",
			fileName: "s1/img-done.png",
			mediaType: "image/png",
			error: "后端失败",
		});
		insertImageRow(dbPath, {
			id: "img-missing-file",
			nodeId: "n1",
			workflowId: savedWorkflow.id,
			ordinal: 3,
			status: "done",
			fileName: "s1/nope.png",
			mediaType: "image/png",
		});
		writeFileSync(join(dir, "secret.png"), bytes);
		insertImageRow(dbPath, {
			id: "img-outside",
			nodeId: "n1",
			workflowId: savedWorkflow.id,
			ordinal: 4,
			status: "done",
			fileName: "../secret.png",
			mediaType: "image/png",
		});

		const done = await request(running.origin, "/api/images/img-done/file");
		expect(done.status).toBe(200);
		expect(done.headers.get("content-type")).toBe("image/png");
		expect(Buffer.from(await done.arrayBuffer())).toEqual(bytes);

		for (const imageId of [
			"img-pending",
			"img-failed",
			"img-missing-file",
			"img-outside",
			"missing",
		]) {
			const response = await request(
				running.origin,
				`/api/images/${imageId}/file`,
			);
			expect(response.status).toBe(404);
			const body = (await response.json()) as ApiErrorResponse;
			expect(body.error.message).toBe("图片文件不存在");
			expect(JSON.stringify(body)).not.toContain(dir);
		}
	});

	it("媒体接口需要登录", async () => {
		const { running, dir, dbPath } = await startImagesServer({
			password: "secret",
		});
		running.store.createStory({ id: "s1", title: "测试" });
		running.store.appendNode({
			id: "n1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "正文",
		});
		const mediaDir = join(dir, "images");
		mkdirSync(join(mediaDir, "s1"), { recursive: true });
		writeFileSync(join(mediaDir, "s1", "img.png"), Buffer.from([1]));
		const savedWorkflow = running.store.saveImageWorkflow({
			name: "默认",
			provider: "comfy",
			payload: workflow() as never,
			slots: SLOTS,
		});
		insertImageRow(dbPath, {
			id: "img",
			nodeId: "n1",
			workflowId: savedWorkflow.id,
			ordinal: 0,
			status: "done",
			fileName: "s1/img.png",
			mediaType: "image/png",
		});

		const response = await request(running.origin, "/api/images/img/file");
		expect(response.status).toBe(401);
	});
});

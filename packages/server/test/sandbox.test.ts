import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	DECLARATIVE_PLUGIN_FORMAT,
	DECLARATIVE_PLUGIN_FORMAT_VERSION,
} from "@dramaticer/core";
import type {
	ApiErrorResponse,
	SandboxRejectionsView,
	StoryPath,
	StoryRenderView,
	StorySandboxView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-sandbox-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startTestServer(): Promise<RunningServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return running;
}

async function request(
	origin: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	});
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "POST", body: JSON.stringify(body) });
}

async function errorBody(response: Response): Promise<ApiErrorResponse> {
	return (await response.json()) as ApiErrorResponse;
}

function floorRendererPlugin(overrides: Record<string, unknown> = {}) {
	return {
		format: DECLARATIVE_PLUGIN_FORMAT,
		formatVersion: DECLARATIVE_PLUGIN_FORMAT_VERSION,
		name: "test.card-ui",
		version: "1.0.0",
		kind: "floor-renderer",
		payload: {
			id: "test-status",
			name: "测试状态栏",
			blockTypes: ["状态栏"],
			permissions: ["sendMessage"],
			template: '<div class="probe">{{content}}</div>',
			script: 'fetch("https://example.com/lib.js").catch(function () {});',
			...overrides,
		},
	};
}

function stCard(): string {
	return JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "星轨",
			description: "状态栏与助手脚本。",
			first_mes: "<stat>气力：3</stat>\n雨停了。",
			extensions: {
				regex_scripts: [
					{
						id: "status",
						scriptName: "状态栏",
						findRegex: "/<stat>([\\s\\S]*?)<\\/stat>/g",
						replaceString:
							'<div class="statusbar" id="status"><span id="energy">$1</span><button id="rest" type="button" onclick="rest()">休息</button></div>',
						trimStrings: [],
						placement: [2],
						disabled: false,
						markdownOnly: false,
						promptOnly: false,
						runOnEdit: false,
					},
				],
				tavern_helper: {
					scripts: [
						{
							id: "s1",
							name: "状态脚本",
							content:
								"// https://example.com/status.js\nwindow.rest = function () { eventEmit('status:rest'); };",
							enabled: true,
							type: "script",
							info: "",
							button: {},
							data: {},
						},
					],
				},
			},
		},
	});
}

function cardWithRenderer(plugin: Record<string, unknown>): string {
	return JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "卡片前端",
			description: "带状态栏的卡。",
			first_mes: "<状态栏>气力：3</状态栏>\n门外的雨停了。",
			extensions: { dramaticer: { plugins: [plugin] } },
		},
	});
}

async function importedStory(
	origin: string,
	stamp: string,
	plugin: Record<string, unknown> = floorRendererPlugin(),
): Promise<{ storyId: string; nodeId: string }> {
	const storyId = `sandbox-${stamp}`;
	const created = await post(origin, "/api/stories", {
		id: storyId,
		title: "沙箱",
	});
	expect(created.status).toBe(201);
	const imported = await post(origin, `/api/stories/${storyId}/import`, {
		card: { format: "json", data: cardWithRenderer(plugin) },
	});
	expect(imported.status).toBe(200);
	const path = (await (
		await request(origin, `/api/stories/${storyId}/path`)
	).json()) as StoryPath;
	const node = path.nodes.find((item) => item.role === "assistant");
	if (node === undefined) throw new Error("导入后没有开场楼层");
	return { storyId, nodeId: node.id };
}

describe("楼层渲染接口", () => {
	it("导入卡后识别脚本域名；渲染只派生显示内容，原文不变", async () => {
		const running = await startTestServer();
		const { storyId, nodeId } = await importedStory(running.origin, "render");

		const sandbox = (await (
			await request(running.origin, `/api/stories/${storyId}/sandbox`)
		).json()) as StorySandboxView;
		expect(sandbox.allowedDomains).toEqual([]);
		expect(sandbox.detectedDomains).toEqual(["example.com"]);
		expect(sandbox.renderers).toEqual([
			{
				id: "test-status",
				plugin: "test.card-ui",
				name: "测试状态栏",
				permissions: ["sendMessage"],
				enabled: true,
			},
		]);

		const before = (await (
			await request(running.origin, `/api/stories/${storyId}/path`)
		).json()) as StoryPath;
		const raw = before.nodes.find((item) => item.id === nodeId)?.raw;
		expect(raw).toBe("<状态栏>气力：3</状态栏>\n门外的雨停了。");

		const rendered = (await (
			await post(running.origin, `/api/stories/${storyId}/render`, {
				nodeIds: [nodeId],
			})
		).json()) as StoryRenderView;
		expect(rendered.floors[0]?.renderer).toBe("test-status");
		expect(rendered.floors[0]?.html).toContain("气力：3");
		expect(rendered.floors[0]?.html).toContain("&lt;状态栏&gt;");
		expect(rendered.floors[0]?.permissions).toEqual(["sendMessage"]);

		const after = (await (
			await request(running.origin, `/api/stories/${storyId}/path`)
		).json()) as StoryPath;
		expect(after.nodes.find((item) => item.id === nodeId)?.raw).toBe(raw);
	});

	it("玩家逐个允许域名，允许名单刷新后仍在故事上", async () => {
		const running = await startTestServer();
		const { storyId } = await importedStory(running.origin, "domains");

		const allowed = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/domains`,
			{ domain: "example.com", allowed: true },
		);
		expect(allowed.status).toBe(200);
		const view = (await allowed.json()) as StorySandboxView;
		expect(view.allowedDomains).toEqual(["example.com"]);

		const again = (await (
			await request(running.origin, `/api/stories/${storyId}/sandbox`)
		).json()) as StorySandboxView;
		expect(again.allowedDomains).toEqual(["example.com"]);

		const removed = (await (
			await post(running.origin, `/api/stories/${storyId}/sandbox/domains`, {
				domain: "example.com",
				allowed: false,
			})
		).json()) as StorySandboxView;
		expect(removed.allowedDomains).toEqual([]);

		const invalid = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/domains`,
			{ domain: "https://example.com/x", allowed: true },
		);
		expect(invalid.status).toBe(400);
		expect((await errorBody(invalid)).error.message).toContain("只能是主机名");
	});

	it("交互桥的拒绝记录可以追加并按最近在前读取", async () => {
		const running = await startTestServer();
		const { storyId, nodeId } = await importedStory(
			running.origin,
			"rejections",
		);

		const recorded = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/rejections`,
			{
				nodeId,
				renderer: "test-status",
				kind: "bridge",
				target: "writeState",
				reason: "渲染器没有声明 writeState 权限",
			},
		);
		expect(recorded.status).toBe(201);
		await post(running.origin, `/api/stories/${storyId}/sandbox/rejections`, {
			nodeId,
			renderer: "test-status",
			kind: "network",
			target: "https://example.com/lib.js",
			reason: "沙箱默认禁止联网",
		});

		const view = (await (
			await request(
				running.origin,
				`/api/stories/${storyId}/sandbox/rejections`,
			)
		).json()) as SandboxRejectionsView;
		expect(view.rejections.map((item) => item.kind)).toEqual([
			"network",
			"bridge",
		]);
		expect(view.rejections[1]?.target).toBe("writeState");
	});

	it("写状态要声明权限并经台账校验；越权与非法写入都记入检视器", async () => {
		const running = await startTestServer();
		const { storyId, nodeId } = await importedStory(running.origin, "writes");

		const denied = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/state`,
			{
				renderer: "test-status",
				nodeId,
				write: { path: ["mvu", "counter"], op: "set", value: 1 },
			},
		);
		expect(denied.status).toBe(403);
		expect((await errorBody(denied)).error.message).toContain(
			"没有声明 writeState 权限",
		);

		const installed = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/renderers`,
			{
				plugin: floorRendererPlugin({
					id: "test-writer",
					name: "会写状态",
					permissions: ["writeState"],
					script: null,
				}),
			},
		);
		expect(installed.status).toBe(200);

		const written = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/state`,
			{
				renderer: "test-writer",
				nodeId,
				write: { path: ["mvu", "counter"], op: "set", value: 3 },
			},
		);
		expect(written.status).toBe(200);
		const query = new URLSearchParams({
			nodeId,
			path: JSON.stringify(["mvu", "counter"]),
		});
		const state = (await (
			await request(
				running.origin,
				`/api/stories/${storyId}/sandbox/state?${query.toString()}`,
			)
		).json()) as { value: unknown };
		expect(state.value).toBe(3);

		const invalid = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/state`,
			{
				renderer: "test-writer",
				nodeId,
				write: { path: ["没有这个命名空间", "x"], op: "set", value: 1 },
			},
		);
		expect(invalid.status).toBe(400);
		const rejections = (await (
			await request(
				running.origin,
				`/api/stories/${storyId}/sandbox/rejections`,
			)
		).json()) as SandboxRejectionsView;
		expect(
			rejections.rejections.map((item) => item.reason).join(" | "),
		).toMatch(/没有声明 writeState 权限/);
		expect(
			rejections.rejections.map((item) => item.reason).join(" | "),
		).toMatch(/未知台账命名空间/);
	});

	it("酒馆卡的美化正则与助手脚本进沙箱；关掉后回到原文", async () => {
		const running = await startTestServer();
		const storyId = "sandbox-st-card";
		expect(
			(
				await post(running.origin, "/api/stories", {
					id: storyId,
					title: "酒馆卡",
				})
			).status,
		).toBe(201);
		const imported = await post(
			running.origin,
			`/api/stories/${storyId}/import`,
			{
				card: { format: "json", data: stCard() },
			},
		);
		expect(imported.status).toBe(200);
		const path = (await (
			await request(running.origin, `/api/stories/${storyId}/path`)
		).json()) as StoryPath;
		const nodeId = path.nodes.find((item) => item.role === "assistant")?.id;
		if (nodeId === undefined) throw new Error("导入后没有开场楼层");

		const sandbox = (await (
			await request(running.origin, `/api/stories/${storyId}/sandbox`)
		).json()) as StorySandboxView;
		expect(sandbox.renderers.map((item) => [item.id, item.enabled])).toEqual([
			["st-content-regex", true],
			["st-helper-host", true],
		]);
		expect(sandbox.detectedDomains).toContain("example.com");

		const rendered = (await (
			await post(running.origin, `/api/stories/${storyId}/render`, {
				nodeIds: [nodeId],
			})
		).json()) as StoryRenderView;
		expect(rendered.floors[0]?.renderer).toBe("st-helper-host");
		expect(rendered.floors[0]?.html).toContain('class="statusbar"');
		expect(rendered.floors[0]?.html).toContain("气力：3");
		expect(rendered.floors[0]?.script).toContain("window.rest");
		expect(rendered.floors[0]?.permissions).toContain("writeState");
		const raw = (await (
			await request(running.origin, `/api/stories/${storyId}/path`)
		).json()) as StoryPath;
		expect(raw.nodes.find((item) => item.id === nodeId)?.raw).toContain(
			"<stat>气力：3</stat>",
		);

		const written = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/state`,
			{
				renderer: "st-helper-host",
				nodeId,
				write: { path: ["mvu", "energy"], op: "set", value: 4 },
			},
		);
		expect(written.status).toBe(200);

		// 只关美化正则：助手脚本继续运行，但标签按原文显示。
		await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/renderers/st-content-regex`,
			{ enabled: false },
		);
		const withoutRegex = (await (
			await post(running.origin, `/api/stories/${storyId}/render`, {
				nodeIds: [nodeId],
			})
		).json()) as StoryRenderView;
		expect(withoutRegex.floors[0]?.renderer).toBe("st-helper-host");
		expect(withoutRegex.floors[0]?.html).toContain("&lt;stat&gt;");
		expect(withoutRegex.floors[0]?.html).not.toContain('class="statusbar"');

		// 两个都关：不再认领，正文由前端按原文显示。
		await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/renderers/st-helper-host`,
			{ enabled: false },
		);
		const closed = (await (
			await post(running.origin, `/api/stories/${storyId}/render`, {
				nodeIds: [nodeId],
			})
		).json()) as StoryRenderView;
		expect(closed.floors[0]?.renderer).toBeNull();
		expect(closed.floors[0]?.html).toBeNull();
		const denied = await post(
			running.origin,
			`/api/stories/${storyId}/sandbox/state`,
			{
				renderer: "st-helper-host",
				nodeId,
				write: { path: ["mvu", "energy"], op: "set", value: 5 },
			},
		);
		expect(denied.status).toBe(403);
	});

	it("没有渲染器认领的楼层返回空结果，正文照常显示", async () => {
		const running = await startTestServer();
		const { storyId, nodeId } = await importedStory(running.origin, "native", {
			...floorRendererPlugin(),
			payload: {
				...floorRendererPlugin().payload,
				blockTypes: ["不存在"],
			},
		});
		const rendered = (await (
			await post(running.origin, `/api/stories/${storyId}/render`, {
				nodeIds: [nodeId],
			})
		).json()) as StoryRenderView;
		expect(rendered.floors[0]?.renderer).toBeNull();
		expect(rendered.floors[0]?.html).toBeNull();
	});
});

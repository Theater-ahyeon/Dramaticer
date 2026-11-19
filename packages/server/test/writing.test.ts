import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApiErrorResponse } from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-writing-"));
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

const presetJson = JSON.stringify({
	name: "清风预设",
	prompts: [
		{
			identifier: "person",
			name: "人称",
			content: "用第一人称叙述。",
			marker: false,
			enabled: true,
		},
		{
			identifier: "length",
			name: "字数要求",
			content: "每楼 1200 字左右。",
			marker: false,
			enabled: true,
		},
		{
			identifier: "scenery",
			name: "景物描写",
			content: "多写眼前的景物。",
			marker: false,
			enabled: true,
		},
		{
			identifier: "tone",
			name: "语气",
			content: "语气温和。",
			marker: false,
			enabled: true,
		},
	],
	prompt_order: [
		{
			character_id: 100001,
			order: [
				{ identifier: "person", enabled: true },
				{ identifier: "length", enabled: true },
				{ identifier: "scenery", enabled: true },
				{ identifier: "tone", enabled: true },
			],
		},
	],
});

interface WritingResponse {
	readonly dials: Record<string, string | boolean>;
	readonly recommended: Record<string, string | boolean> | null;
	readonly overrides: Record<string, string | boolean>;
	readonly preset: {
		readonly name: string;
		readonly total: number;
		readonly mapped: number;
		readonly packCount: number;
	} | null;
}

async function writing(origin: string): Promise<WritingResponse> {
	const response = await request(origin, "/api/stories/story-1/writing");
	expect(response.status).toBe(200);
	return (await response.json()) as WritingResponse;
}

describe("写作选项接口", () => {
	it("导入预设后列出对应了多少条、文风包多少条", async () => {
		const running = await startTestServer();
		await request(running.origin, "/api/stories", {
			method: "POST",
			body: JSON.stringify({ id: "story-1", title: "山门" }),
		});
		const before = await writing(running.origin);
		expect(before.preset).toBe(null);
		expect(before.dials.person).toBe("second");

		const imported = await request(
			running.origin,
			"/api/stories/story-1/writing/preset",
			{ method: "POST", body: JSON.stringify({ preset: presetJson }) },
		);
		expect(imported.status).toBe(200);
		const view = (await imported.json()) as WritingResponse;
		expect(view.preset).toEqual({
			name: "清风预设",
			total: 4,
			mapped: 2,
			packCount: 2,
		});
		expect(view.dials).toMatchObject({
			person: "first",
			length: "long",
			stylePack: true,
		});
		expect(await writing(running.origin)).toEqual(view);
	});

	it("文风包可以整体开关，关掉后导入结果仍在", async () => {
		const running = await startTestServer();
		await request(running.origin, "/api/stories", {
			method: "POST",
			body: JSON.stringify({ id: "story-1", title: "山门" }),
		});
		await request(running.origin, "/api/stories/story-1/writing/preset", {
			method: "POST",
			body: JSON.stringify({ preset: presetJson }),
		});

		const off = await request(running.origin, "/api/stories/story-1/writing", {
			method: "PUT",
			body: JSON.stringify({ stylePack: false }),
		});
		expect(off.status).toBe(200);
		const view = (await off.json()) as WritingResponse;
		expect(view.dials.stylePack).toBe(false);
		expect(view.preset).toMatchObject({ mapped: 2, packCount: 2 });

		const on = await request(running.origin, "/api/stories/story-1/writing", {
			method: "PUT",
			body: JSON.stringify({ stylePack: true }),
		});
		expect(((await on.json()) as WritingResponse).dials.stylePack).toBe(true);
	});

	it("清掉玩家的调整后回到默认值，导入结果不被删掉", async () => {
		const running = await startTestServer();
		await request(running.origin, "/api/stories", {
			method: "POST",
			body: JSON.stringify({ id: "story-1", title: "山门" }),
		});
		await request(running.origin, "/api/stories/story-1/writing/preset", {
			method: "POST",
			body: JSON.stringify({ preset: presetJson }),
		});
		const reset = await request(
			running.origin,
			"/api/stories/story-1/writing",
			{ method: "DELETE" },
		);
		expect(reset.status).toBe(200);
		const view = (await reset.json()) as WritingResponse;
		expect(view.overrides).toEqual({});
		expect(view.dials.person).toBe("second");
		expect(view.preset).toMatchObject({ mapped: 2 });
	});

	it("预设不是合法 JSON 时返回带字段路径的 400", async () => {
		const running = await startTestServer();
		await request(running.origin, "/api/stories", {
			method: "POST",
			body: JSON.stringify({ id: "story-1", title: "山门" }),
		});
		const response = await request(
			running.origin,
			"/api/stories/story-1/writing/preset",
			{ method: "POST", body: JSON.stringify({ preset: "不是 JSON" }) },
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as ApiErrorResponse;
		expect(body.error.details).toEqual({ path: "preset" });
	});
});

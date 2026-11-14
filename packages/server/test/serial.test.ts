import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ApiErrorResponse,
	StoryBookExport,
	StorySerialView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-serial-"));
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

function seedStory(running: RunningServer): void {
	const store = running.store;
	store.createStory({ id: "s1", title: "连载接口" });
	store.createStory({ id: "s2", title: "另一个故事" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门外的风很冷。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我推开山门。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "门后传来脚步声。",
		createdAt: "2026-11-14T10:00:00.000Z",
	});
	store.appendNode({
		id: "b1",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "你转身离开。",
	});
	store.appendNode({
		id: "x1",
		storyId: "s2",
		parentId: null,
		role: "assistant",
		raw: "别处的开场。",
	});
	for (const [nodeId, present] of [
		["a2", ["凛"]],
		["b1", ["悠"]],
	] as const) {
		store.saveSceneLog({
			nodeId,
			storyId: "s1",
			beat: "试探",
			present,
			sceneEnds: true,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
	}
	store.saveSceneArchive({
		endNodeId: "a2",
		storyId: "s1",
		startNodeId: "a1",
		floorCount: 2,
		boundary: "scene-ends",
		summary: "凛在门口等你。",
		present: ["凛"],
		profiles: [],
		informed: [],
		stateChanges: [{ path: ["scene", "current", "place"], change: "山门" }],
		cluesOpened: [],
		cluesClosed: [],
	});
	store.saveSceneArchive({
		endNodeId: "b1",
		storyId: "s1",
		startNodeId: "a1",
		floorCount: 1,
		boundary: "scene-ends",
		summary: "你转身离开了山门。",
		present: ["悠"],
		profiles: [],
		informed: [],
		stateChanges: [],
		cluesOpened: [],
		cluesClosed: [],
	});
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: "a2",
			path: ["scene", "current", "place"],
			op: "set",
			value: "山门",
			source: "settler",
		},
	]);
	store.setHead("s1", "a2");
}

async function getJson<T>(url: string): Promise<{ status: number; body: T }> {
	const response = await fetch(url);
	return { status: response.status, body: (await response.json()) as T };
}

describe("连载视图接口", () => {
	it("默认返回 head 上的派生视图", async () => {
		const running = await startTestServer();
		seedStory(running);
		const { status, body } = await getJson<StorySerialView>(
			`${running.origin}/api/stories/s1/serial`,
		);
		expect(status).toBe(200);
		expect(body.nodeId).toBe("a2");
		expect(body.chapters).toEqual([
			{
				ordinal: 1,
				startNodeId: "a1",
				endNodeId: null,
				floorCount: 2,
				sceneOrdinals: [1],
				focusLineIds: [],
			},
		]);
		expect(body.recap.scenes).toEqual([
			{
				endNodeId: "a2",
				startNodeId: "a1",
				summary: "凛在门口等你。",
				present: ["凛"],
				place: "山门",
				storyTime: null,
			},
		]);
		expect(body.timeline[0]?.nodeId).toBe("a2");
		expect(body.cast.map((character) => character.who)).toEqual(["凛"]);
	});

	it("指定同一故事的另一条分支时数据跟着切换", async () => {
		const running = await startTestServer();
		seedStory(running);
		const { status, body } = await getJson<StorySerialView>(
			`${running.origin}/api/stories/s1/serial?nodeId=b1`,
		);
		expect(status).toBe(200);
		expect(body.nodeId).toBe("b1");
		expect(body.recap.scenes.map((scene) => scene.endNodeId)).toEqual(["b1"]);
		expect(body.recap.scenes[0]?.place).toBeNull();
		expect(body.cast.map((character) => character.who)).toEqual(["悠"]);
	});

	it("不存在的故事、楼层与跨故事楼层按不存在处理", async () => {
		const running = await startTestServer();
		seedStory(running);
		const missingStory = await getJson<ApiErrorResponse>(
			`${running.origin}/api/stories/nope/serial`,
		);
		expect(missingStory.status).toBe(404);
		const missingNode = await getJson<ApiErrorResponse>(
			`${running.origin}/api/stories/s1/serial?nodeId=nope`,
		);
		expect(missingNode.status).toBe(404);
		const crossStory = await getJson<ApiErrorResponse>(
			`${running.origin}/api/stories/s1/serial?nodeId=x1`,
		);
		expect(crossStory.status).toBe(404);
	});
});

describe("导出成书接口", () => {
	it("按章节目录导出当前路径的 Markdown", async () => {
		const running = await startTestServer();
		seedStory(running);
		const { status, body } = await getJson<StoryBookExport>(
			`${running.origin}/api/stories/s1/serial/export`,
		);
		expect(status).toBe(200);
		expect(body.nodeId).toBe("a2");
		expect(body.fileName).toBe("连载接口.md");
		expect(body.markdown).toBe(
			`${[
				"# 连载接口",
				"## 第 1 章",
				"> 凛在门口等你。",
				"山门外的风很冷。",
				"我推开山门。",
				"门后传来脚步声。",
			].join("\n\n")}\n`,
		);
	});

	it("指定楼层时只导出那条分支的原文", async () => {
		const running = await startTestServer();
		seedStory(running);
		const { status, body } = await getJson<StoryBookExport>(
			`${running.origin}/api/stories/s1/serial/export?nodeId=b1`,
		);
		expect(status).toBe(200);
		expect(body.nodeId).toBe("b1");
		expect(body.markdown).toBe(
			`${[
				"# 连载接口",
				"## 第 1 章",
				"> 你转身离开了山门。",
				"山门外的风很冷。",
				"我推开山门。",
				"你转身离开。",
			].join("\n\n")}\n`,
		);
	});

	it("不存在的故事、跨故事楼层与空楼层参数按错误处理", async () => {
		const running = await startTestServer();
		seedStory(running);
		const missingStory = await getJson<ApiErrorResponse>(
			`${running.origin}/api/stories/nope/serial/export`,
		);
		expect(missingStory.status).toBe(404);
		const crossStory = await getJson<ApiErrorResponse>(
			`${running.origin}/api/stories/s1/serial/export?nodeId=x1`,
		);
		expect(crossStory.status).toBe(404);
		const emptyNode = await getJson<ApiErrorResponse>(
			`${running.origin}/api/stories/s1/serial/export?nodeId=`,
		);
		expect(emptyNode.status).toBe(400);
	});
});

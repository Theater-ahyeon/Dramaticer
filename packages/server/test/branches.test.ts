import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ApiErrorResponse,
	NodeActionResult,
	NodeChoiceResult,
	StoryPath,
	StoryTree,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-branches-"));
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

function post(url: string, body?: unknown): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function errorBody(response: Response): Promise<ApiErrorResponse> {
	return (await response.json()) as ApiErrorResponse;
}

interface Seeded {
	readonly rootId: string;
	readonly userId: string;
	readonly replyId: string;
}

function seedStory(running: RunningServer): Seeded {
	running.store.createStory({ id: "s1", title: "分支测试" });
	const root = running.store.appendNode({
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门外的风很冷。",
	});
	const user = running.store.appendNode({
		storyId: "s1",
		parentId: root.id,
		role: "user",
		raw: "我推开山门。",
	});
	const reply = running.store.appendNode({
		storyId: "s1",
		parentId: user.id,
		role: "assistant",
		raw: "门后传来脚步声。",
	});
	return { rootId: root.id, userId: user.id, replyId: reply.id };
}

describe("分支接口", () => {
	it("树与路径接口返回楼层结构与当前 head", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);

		const treeResponse = await fetch(`${running.origin}/api/stories/s1/tree`);
		expect(treeResponse.status).toBe(200);
		const tree = (await treeResponse.json()) as StoryTree;
		expect(tree.storyId).toBe("s1");
		expect(tree.headNodeId).toBe(seeded.replyId);
		expect(tree.roots).toEqual([seeded.rootId]);
		expect(tree.nodes).toHaveLength(3);
		const root = tree.nodes.find((node) => node.id === seeded.rootId);
		expect(root?.parentId).toBeNull();
		expect(root?.preview).toBe("山门外的风很冷。");
		expect(root?.childIds).toEqual([seeded.userId]);
		const user = tree.nodes.find((node) => node.id === seeded.userId);
		expect(user?.childIds).toEqual([seeded.replyId]);

		const pathResponse = await fetch(
			`${running.origin}/api/stories/s1/path?nodeId=${seeded.userId}`,
		);
		expect(pathResponse.status).toBe(200);
		const path = (await pathResponse.json()) as StoryPath;
		expect(path.headNodeId).toBe(seeded.replyId);
		expect(path.nodes.map((node) => node.id)).toEqual([
			seeded.rootId,
			seeded.userId,
		]);
		expect(path.nodes[1]?.raw).toBe("我推开山门。");

		const headPath = (await (
			await fetch(`${running.origin}/api/stories/s1/path`)
		).json()) as StoryPath;
		expect(headPath.nodes.map((node) => node.id)).toEqual([
			seeded.rootId,
			seeded.userId,
			seeded.replyId,
		]);
	});

	it("跨故事节点与不存在的节点都返回 404", async () => {
		const running = await startTestServer();
		seedStory(running);
		running.store.createStory({ id: "s2", title: "另一个故事" });
		const foreign = running.store.appendNode({
			storyId: "s2",
			parentId: null,
			role: "assistant",
			raw: "别的故事",
		});

		const foreignPath = await fetch(
			`${running.origin}/api/stories/s1/path?nodeId=${foreign.id}`,
		);
		expect(foreignPath.status).toBe(404);
		expect((await errorBody(foreignPath)).error.code).toBe("not_found");

		const foreignHead = await post(`${running.origin}/api/stories/s1/head`, {
			nodeId: foreign.id,
		});
		expect(foreignHead.status).toBe(404);

		const missing = await fetch(`${running.origin}/api/nodes/n-missing/ledger`);
		expect(missing.status).toBe(404);
	});

	it("swipe 与 edit 生成兄弟楼层且旧楼层不变", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);

		const swipeResponse = await post(
			`${running.origin}/api/nodes/${seeded.replyId}/swipe`,
			{ text: "门后空无一人。" },
		);
		expect(swipeResponse.status).toBe(201);
		const swiped = (await swipeResponse.json()) as NodeActionResult;
		expect(swiped.node.id).not.toBe(seeded.replyId);
		expect(swiped.node.parentId).toBe(seeded.userId);
		expect(swiped.node.raw).toBe("门后空无一人。");
		expect(swiped.path.headNodeId).toBe(swiped.node.id);
		expect(running.store.getNode(seeded.replyId)?.raw).toBe("门后传来脚步声。");
		expect(
			running.store.listPreferenceEvents("s1", { kind: "swipe" }),
		).toHaveLength(1);

		const editResponse = await post(
			`${running.origin}/api/nodes/${seeded.userId}/edit`,
			{ text: "我轻轻推开门。" },
		);
		expect(editResponse.status).toBe(201);
		const edited = (await editResponse.json()) as NodeActionResult;
		expect(edited.node.parentId).toBe(seeded.rootId);
		expect(edited.node.role).toBe("user");
		expect(edited.node.raw).toBe("我轻轻推开门。");
		expect(running.store.getNode(seeded.userId)?.raw).toBe("我推开山门。");
		expect(
			running.store.listPreferenceEvents("s1", { kind: "edit" }),
		).toHaveLength(1);
		expect(running.store.getHead("s1")?.id).toBe(edited.node.id);
	});

	it("选项选择写入锚定楼层的偏好记录", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);
		const reply = running.store.appendNode({
			storyId: "s1",
			parentId: seeded.userId,
			role: "assistant",
			raw: "门后传来脚步声。\n<选项>推门\n后退</选项>",
		});

		const response = await post(
			`${running.origin}/api/nodes/${reply.id}/choice`,
			{ text: "推门" },
		);
		expect(response.status).toBe(201);
		const result = (await response.json()) as NodeChoiceResult;
		expect(result.event.kind).toBe("choice");
		expect(result.event.storyId).toBe("s1");
		expect(result.event.nodeId).toBe(reply.id);
		expect(result.event.payload).toEqual({ choiceText: "推门" });
		expect(
			running.store.listPreferenceEvents("s1", { kind: "choice" }),
		).toHaveLength(1);

		const empty = await post(`${running.origin}/api/nodes/${reply.id}/choice`, {
			text: "  ",
		});
		expect(empty.status).toBe(400);
		expect((await errorBody(empty)).error.details).toEqual({ path: "text" });

		const unknown = await post(`${running.origin}/api/nodes/n-missing/choice`, {
			text: "推门",
		});
		expect(unknown.status).toBe(404);
		expect(
			running.store.listPreferenceEvents("s1", { kind: "choice" }),
		).toHaveLength(1);
	});

	it("切换 head 后路径按新分支返回", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);
		const alternative = running.store.appendNode({
			storyId: "s1",
			parentId: seeded.userId,
			role: "assistant",
			raw: "另一条分支",
		});

		const response = await post(`${running.origin}/api/stories/s1/head`, {
			nodeId: seeded.replyId,
		});
		expect(response.status).toBe(200);
		const path = (await response.json()) as StoryPath;
		expect(path.headNodeId).toBe(seeded.replyId);
		expect(path.nodes.map((node) => node.id)).toEqual([
			seeded.rootId,
			seeded.userId,
			seeded.replyId,
		]);
		expect(running.store.getNode(alternative.id)?.raw).toBe("另一条分支");
	});
});

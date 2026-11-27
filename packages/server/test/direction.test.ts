import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

async function startTestServer(): Promise<RunningServer> {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-direction-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
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

async function getJson<T>(origin: string, path: string): Promise<T> {
	const response = await fetch(`${origin}${path}`);
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}

async function post(
	origin: string,
	path: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

interface View {
	readonly wants: readonly {
		readonly id: string;
		readonly text: string;
		readonly locked: boolean;
	}[];
	readonly opens: readonly {
		readonly id: string;
		readonly text: string;
		readonly locked: boolean;
	}[];
	readonly tension: string;
}

function seed(running: RunningServer): void {
	const store = running.store;
	store.createStory({ id: "s1", title: "走向接口" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "门厅里只剩一盏灯。",
	});
	store.saveStoryBlueprintBaseline("s1", [
		{
			id: "premise",
			kind: "premise",
			source: "player",
			locked: false,
			coreQuestion: "门外的人是谁",
			tone: "安静",
			endings: [],
			redLines: [],
			tension: "loose",
		},
	]);
	store.saveDirectorLines({
		nodeId: "a1",
		storyId: "s1",
		diffs: [
			{
				action: "set",
				line: {
					id: "rel-1",
					kind: "relationship",
					who: "林雪",
					want: "确认门外是谁",
					obstacle: "门一直没有开",
					countdown: null,
					preparations: [],
				},
			},
		],
	});
	store.insertPlotNotes([
		{
			id: "note-1",
			storyId: "s1",
			sourceNodeId: "a1",
			text: "门后传来第二个人脚步",
		},
	]);
}

describe("剧情走向的接口", () => {
	it("读出两栏，编辑、锁定与收线都写回原存储", async () => {
		const running = await startTestServer();
		seed(running);

		const first = await getJson<View>(
			running.origin,
			"/api/stories/s1/direction",
		);
		expect(first.wants.map((item) => item.id)).toEqual([
			"premise:question",
			"premise:tone",
			"premise:red-lines",
		]);
		expect(first.opens.map((item) => item.id)).toEqual([
			"line:rel-1",
			"note:note-1",
		]);

		const edited = await post(
			running.origin,
			"/api/stories/s1/direction/edit",
			{ op: "edit-want", id: "premise:question", text: "门外的人想要什么" },
		);
		expect(edited.status).toBe(200);
		const afterEdit = (await edited.json()) as { view: View };
		expect(afterEdit.view.wants[0]?.locked).toBe(true);
		expect(afterEdit.view.wants[0]?.text).toBe("门外的人想要什么");

		const tension = await post(
			running.origin,
			"/api/stories/s1/direction/edit",
			{ op: "set-tension", tension: "tight" },
		);
		expect(tension.status).toBe(200);

		const locked = await post(
			running.origin,
			"/api/stories/s1/direction/edit",
			{ op: "lock-open", id: "line:rel-1", locked: true },
		);
		expect(locked.status).toBe(200);
		const afterLock = await getJson<View>(
			running.origin,
			"/api/stories/s1/direction",
		);
		expect(afterLock.tension).toBe("tight");
		expect(
			afterLock.opens.find((item) => item.id === "line:rel-1")?.locked,
		).toBe(true);

		const closed = await post(
			running.origin,
			"/api/stories/s1/direction/edit",
			{ op: "close-open", id: "note:note-1" },
		);
		expect(closed.status).toBe(200);
		const afterClose = await getJson<View>(
			running.origin,
			"/api/stories/s1/direction",
		);
		expect(afterClose.opens.map((item) => item.id)).toEqual(["line:rel-1"]);
	});

	it("不认识的命令返回 400 并指出字段", async () => {
		const running = await startTestServer();
		seed(running);
		const response = await post(
			running.origin,
			"/api/stories/s1/direction/edit",
			{ op: "rename", id: "premise:question" },
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: { message: string } };
		expect(body.error.message).toContain("走向修改.op 只能是");
	});

	it("故事没有楼层时读出卡里的默认蓝图，写入被拒绝", async () => {
		const running = await startTestServer();
		running.store.createStory({ id: "empty", title: "空白" });
		running.store.saveStoryBlueprintBaseline("empty", [
			{
				id: "premise",
				kind: "premise",
				source: "player",
				locked: false,
				coreQuestion: "还没有开场的核心问题",
				tone: "",
				endings: [],
				redLines: [],
				tension: "loose",
			},
		]);
		const view = await getJson<View>(
			running.origin,
			"/api/stories/empty/direction",
		);
		expect(view.wants.map((item) => item.id)).toEqual([
			"premise:question",
			"premise:tone",
			"premise:red-lines",
		]);
		const response = await post(
			running.origin,
			"/api/stories/empty/direction/edit",
			{ op: "add-want", text: "一场大雨" },
		);
		expect(response.status).toBe(400);
	});
});

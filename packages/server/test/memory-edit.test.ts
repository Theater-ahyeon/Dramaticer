import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApiErrorResponse } from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

interface TestServer {
	readonly running: RunningServer;
	readonly dir: string;
}

interface StateItem {
	readonly target: string;
	readonly path: readonly string[];
	readonly item: string;
	readonly value: unknown;
	readonly source: string;
	readonly locked: boolean;
	readonly history: readonly {
		readonly value: unknown;
		readonly source: string;
		readonly floorNo: number;
	}[];
}

interface WikiStatement {
	readonly id: string;
	readonly text: string;
	readonly source: "auto" | "player";
	readonly locked: boolean;
}

interface WikiPage {
	readonly id: string;
	readonly name: string;
	readonly lead: string;
	readonly leadLocked: boolean;
	readonly sections: readonly {
		readonly title: string;
		readonly statements: readonly WikiStatement[];
	}[];
}

interface MemoryView {
	readonly headNodeId: string | null;
	readonly pages: readonly WikiPage[];
	readonly state: readonly StateItem[];
	readonly secrets: readonly {
		readonly id: string;
		readonly text: string;
		readonly knowers: readonly string[];
		readonly unaware: readonly string[];
		readonly locked: boolean;
		readonly edited: boolean;
	}[];
	readonly timeline: readonly {
		readonly id: string;
		readonly summary: string;
		readonly locked: boolean;
	}[];
	readonly prefs: readonly {
		readonly id: string;
		readonly text: string;
		readonly disabled: boolean;
	}[];
	readonly rejections: readonly {
		readonly id: number;
		readonly kind: string;
		readonly text: string;
		readonly reason: string;
	}[];
}

interface HistoryView {
	readonly edits: readonly {
		readonly id: number;
		readonly kind: string;
		readonly target: string;
		readonly value: unknown;
		readonly locked: boolean;
		readonly source: string;
	}[];
	readonly versions: readonly {
		readonly value: unknown;
		readonly source: string;
	}[];
}

interface Seeded {
	readonly rootId: string;
	readonly leftId: string;
	readonly rightId: string;
}

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-memory-edit-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startTestServer(): Promise<TestServer> {
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
	return { running, dir };
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

async function getJson<T>(origin: string, path: string): Promise<T> {
	const response = await request(origin, path);
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}

async function errorBody(response: Response): Promise<ApiErrorResponse> {
	return (await response.json()) as ApiErrorResponse;
}

function memory(origin: string): Promise<MemoryView> {
	return getJson<MemoryView>(origin, "/api/stories/s1/memory");
}

/**
 * 两条分支：根 → 左（a2）与根 → 右（a3）。巨细都从根上的自动状态开始，
 * 分支上的修改只挂在各自的楼层。
 */
function seedStory(running: RunningServer): Seeded {
	running.store.createStory({ id: "s1", title: "记忆修改" });
	running.store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "凛",
		description: "青云宗剑修",
		source: "card",
	});
	const root = running.store.appendNode({
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门外的风很冷。",
	});
	const leftUser = running.store.appendNode({
		storyId: "s1",
		parentId: root.id,
		role: "user",
		raw: "向左。",
	});
	const left = running.store.appendNode({
		storyId: "s1",
		parentId: leftUser.id,
		role: "assistant",
		raw: "左边是钟楼。",
	});
	const rightUser = running.store.appendNode({
		storyId: "s1",
		parentId: root.id,
		role: "user",
		raw: "向右。",
	});
	const right = running.store.appendNode({
		storyId: "s1",
		parentId: rightUser.id,
		role: "assistant",
		raw: "右边是教室。",
	});
	running.store.setHead("s1", left.id);
	running.store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: root.id,
			path: ["character", "凛", "location"],
			op: "set",
			value: "教室",
			source: "settler",
		},
	]);
	return { rootId: root.id, leftId: left.id, rightId: right.id };
}

describe("记忆的玩家修改接口", () => {
	it("校验失败时返回原处可显示的原因，且不写入", async () => {
		const { running } = await startTestServer();
		seedStory(running);

		const badState = await post(
			running.origin,
			"/api/stories/s1/memory/state",
			{
				path: ["relation", "凛", "卫宫", "affectionInner"],
				value: "火热",
			},
		);
		expect(badState.status).toBe(400);
		const stateError = await errorBody(badState);
		expect(stateError.error.details).toMatchObject({ path: "state" });
		expect(stateError.error.message).toContain("affectionInner");

		const badWiki = await post(running.origin, "/api/stories/s1/memory/edit", {
			kind: "wiki",
			target: "page|statement",
			value: { text: "   " },
		});
		expect(badWiki.status).toBe(400);
		expect((await errorBody(badWiki)).error.message).toContain("内容不能为空");

		const badPref = await post(running.origin, "/api/stories/s1/memory/prefs", {
			id: "pref-1",
			text: "   ",
		});
		expect(badPref.status).toBe(400);
		expect((await errorBody(badPref)).error.message).toContain("偏好不能为空");

		const badSecret = await post(
			running.origin,
			"/api/stories/s1/memory/edit",
			{
				kind: "secret",
				target: "secret-1",
				value: { text: "钥匙在钟楼", knowers: "凛" },
			},
		);
		expect(badSecret.status).toBe(400);
		expect((await errorBody(badSecret)).error.message).toContain("knowers");

		const after = await memory(running.origin);
		expect(after.state.find((item) => item.item === "affectionInner")).toBe(
			undefined,
		);
		expect(after.state.some((item) => item.value === "火热")).toBe(false);
		expect(after.secrets).toEqual([]);

		const saved = await post(running.origin, "/api/stories/s1/memory/state", {
			path: ["character", "凛", "location"],
			value: "钟楼",
		});
		expect(saved.status).toBe(200);
		const item = (await memory(running.origin)).state.find(
			(candidate) => candidate.item === "location",
		);
		expect(item).toMatchObject({
			value: "钟楼",
			source: "player",
			locked: true,
		});
		expect(item?.history.at(-1)?.source).toBe("player");
	});

	it("锁定挡住后台写入并记录原因，两条分支各留各的修改", async () => {
		const { running } = await startTestServer();
		const seeded = seedStory(running);

		await post(running.origin, "/api/stories/s1/memory/state", {
			path: ["character", "凛", "location"],
			value: "钟楼",
		});
		const dropped = running.store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: seeded.leftId,
				path: ["character", "凛", "location"],
				op: "set",
				value: "操场",
				source: "settler",
			},
		]);
		expect(dropped).toEqual([]);
		const leftView = await memory(running.origin);
		expect(leftView.state.find((item) => item.item === "location")?.value).toBe(
			"钟楼",
		);
		expect(leftView.rejections[0]).toMatchObject({ kind: "state" });
		expect(leftView.rejections[0]?.text).toContain("操场");
		expect(leftView.rejections[0]?.reason).toContain("与玩家锁定的事实冲突");

		const page = leftView.pages.find((candidate) => candidate.name === "凛");
		if (page === undefined) throw new Error("没有凛的百科页面");
		const leadSaved = await post(
			running.origin,
			"/api/stories/s1/memory/edit",
			{
				kind: "wiki",
				target: `${page.id}|lead`,
				value: { text: "左边分支的简介" },
			},
		);
		expect(leadSaved.status).toBe(200);
		expect(
			(await memory(running.origin)).pages.find(
				(candidate) => candidate.id === page.id,
			)?.lead,
		).toBe("左边分支的简介");

		running.store.setHead("s1", seeded.rightId);
		const rightView = await memory(running.origin);
		expect(
			rightView.state.find((item) => item.item === "location"),
		).toMatchObject({ value: "教室", locked: false });
		expect(
			rightView.pages.find((candidate) => candidate.id === page.id)?.lead,
		).toBe("青云宗剑修");
		expect(rightView.rejections).toHaveLength(1);

		await post(running.origin, "/api/stories/s1/memory/state", {
			path: ["character", "凛", "location"],
			value: "操场",
		});
		expect(
			(await memory(running.origin)).state.find(
				(item) => item.item === "location",
			)?.value,
		).toBe("操场");

		running.store.setHead("s1", seeded.leftId);
		const backLeft = await memory(running.origin);
		expect(backLeft.state.find((item) => item.item === "location")?.value).toBe(
			"钟楼",
		);
		expect(
			backLeft.pages.find((candidate) => candidate.id === page.id)?.lead,
		).toBe("左边分支的简介");
	});

	it("状态历史与百科历史都能回到选定的那一版", async () => {
		const { running } = await startTestServer();
		seedStory(running);

		await post(running.origin, "/api/stories/s1/memory/state", {
			path: ["character", "凛", "location"],
			value: "操场",
		});
		await post(running.origin, "/api/stories/s1/memory/state", {
			path: ["character", "凛", "location"],
			value: "钟楼",
		});
		const before = await memory(running.origin);
		const location = before.state.find((item) => item.item === "location");
		if (location === undefined) throw new Error("状态没有写入");
		expect(location.history.map((version) => version.value)).toEqual([
			"教室",
			"操场",
			"钟楼",
		]);
		const stateHistory = await getJson<HistoryView>(
			running.origin,
			`/api/stories/s1/memory/history?kind=state&target=${encodeURIComponent(location.target)}`,
		);
		expect(stateHistory.versions.map((version) => version.value)).toEqual([
			"教室",
			"操场",
			"钟楼",
		]);

		const rolledState = await post(
			running.origin,
			"/api/stories/s1/memory/rollback",
			{ target: location.target, value: "教室" },
		);
		expect(rolledState.status).toBe(200);
		const stateItem = (await memory(running.origin)).state.find(
			(item) => item.target === location.target,
		);
		expect(stateItem).toMatchObject({ value: "教室", locked: true });

		const page = before.pages.find((candidate) => candidate.name === "凛");
		if (page === undefined) throw new Error("没有凛的百科页面");
		const target = `${page.id}|lead`;
		await post(running.origin, "/api/stories/s1/memory/edit", {
			kind: "wiki",
			target,
			value: { text: "第一版简介" },
		});
		await post(running.origin, "/api/stories/s1/memory/edit", {
			kind: "wiki",
			target,
			value: { text: "第二版简介" },
		});
		const wikiHistory = await getJson<HistoryView>(
			running.origin,
			`/api/stories/s1/memory/history?kind=wiki&target=${encodeURIComponent(target)}`,
		);
		expect(wikiHistory.edits).toHaveLength(2);
		const first = wikiHistory.edits[0];
		if (first === undefined) throw new Error("百科修改没有记录");
		const rolledWiki = await post(
			running.origin,
			"/api/stories/s1/memory/rollback",
			{ editId: first.id },
		);
		expect(rolledWiki.status).toBe(200);
		expect(
			(await memory(running.origin)).pages.find(
				(candidate) => candidate.id === page.id,
			)?.lead,
		).toBe("第一版简介");
	});

	it("秘密、时间线摘要与偏好都能直接改", async () => {
		const { running } = await startTestServer();
		const seeded = seedStory(running);
		running.store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: seeded.rootId,
				ordinal: 0,
				text: "凛把钥匙藏进钟楼",
				participants: ["凛"],
				knowers: ["凛"],
				importance: 0.8,
			},
			{
				storyId: "s1",
				sourceNodeId: seeded.rootId,
				ordinal: 1,
				text: "卫宫在码头值夜",
				participants: ["卫宫"],
				knowers: [],
				importance: 0.2,
			},
		]);
		running.store.saveSceneArchive({
			storyId: "s1",
			endNodeId: seeded.leftId,
			startNodeId: seeded.rootId,
			floorCount: 3,
			boundary: "scene-ends",
			summary: "他们找到了钥匙。",
			present: [],
			profiles: [],
			informed: [],
			stateChanges: [],
			cluesOpened: [],
			cluesClosed: [],
		});

		const view = await memory(running.origin);
		const page = view.pages.find((candidate) => candidate.name === "凛");
		if (page === undefined) throw new Error("没有凛的百科页面");
		const statement = page.sections
			.flatMap((section) => section.statements)
			.find((candidate) => candidate.id.startsWith("state:"));
		if (statement === undefined) throw new Error("百科页面没有状态语句");
		const statementTarget = `${page.id}|${statement.id}`;
		await post(running.origin, "/api/stories/s1/memory/edit", {
			kind: "wiki",
			target: statementTarget,
			value: { text: "凛在钟楼" },
		});
		const edited = (await memory(running.origin)).pages
			.find((candidate) => candidate.id === page.id)
			?.sections.flatMap((section) => section.statements)
			.find((candidate) => candidate.id === statement.id);
		expect(edited).toMatchObject({
			text: "凛在钟楼",
			source: "player",
			locked: true,
		});
		const reset = await post(running.origin, "/api/stories/s1/memory/edit", {
			kind: "wiki",
			target: statementTarget,
			reset: true,
		});
		expect(reset.status).toBe(200);
		const restored = (await memory(running.origin)).pages
			.find((candidate) => candidate.id === page.id)
			?.sections.flatMap((section) => section.statements)
			.find((candidate) => candidate.id === statement.id);
		expect(restored).toMatchObject({
			text: statement.text,
			source: "auto",
			locked: false,
		});

		const secret = view.secrets[0];
		if (secret === undefined) throw new Error("秘密没有投影出来");
		const savedSecret = await post(
			running.origin,
			"/api/stories/s1/memory/edit",
			{
				kind: "secret",
				target: secret.id,
				value: {
					text: "钥匙在钟楼的横梁上",
					knowers: ["凛", "卫宫"],
					unaware: [],
				},
			},
		);
		expect(savedSecret.status).toBe(200);
		expect((await memory(running.origin)).secrets[0]).toMatchObject({
			text: "钥匙在钟楼的横梁上",
			knowers: ["凛", "卫宫"],
			unaware: [],
			locked: true,
			edited: true,
		});

		const scene = view.timeline[0];
		if (scene === undefined) throw new Error("场次摘要没有投影出来");
		const savedScene = await post(
			running.origin,
			"/api/stories/s1/memory/edit",
			{
				kind: "summary",
				target: scene.id,
				value: { text: "他们在钟楼碰头。" },
			},
		);
		expect(savedScene.status).toBe(200);
		expect((await memory(running.origin)).timeline[0]).toMatchObject({
			summary: "他们在钟楼碰头。",
			locked: true,
		});

		await post(running.origin, "/api/stories/s1/memory/prefs", {
			text: "不要替我回答",
		});
		const pref = (await memory(running.origin)).prefs[0];
		if (pref === undefined) throw new Error("偏好没有写入");
		await post(running.origin, "/api/stories/s1/memory/prefs", {
			id: pref.id,
			text: "不要替我说话",
		});
		expect(
			(await memory(running.origin)).prefs.find(
				(candidate) => candidate.id === pref.id,
			)?.text,
		).toBe("不要替我说话");
		await post(running.origin, "/api/stories/s1/memory/prefs", {
			id: pref.id,
			disabled: true,
		});
		expect(
			(await memory(running.origin)).prefs.find(
				(candidate) => candidate.id === pref.id,
			)?.disabled,
		).toBe(true);
	});
});

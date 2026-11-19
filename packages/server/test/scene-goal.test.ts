import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

interface DockView {
	readonly sceneGoal: {
		readonly nodeId: string;
		readonly change: string;
		readonly source: "player" | "ai";
		readonly locked: boolean;
	} | null;
}

interface HistoryView {
	readonly edits: readonly { readonly id: number }[];
}

async function startTestServer(): Promise<RunningServer> {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-scene-goal-"));
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
): Promise<void> {
	const response = await fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	expect(response.status).toBe(200);
}

describe("本场目标的接口", () => {
	it("玩家改过的本场目标标明出处并锁定，可以回到之前的版本", async () => {
		const running = await startTestServer();
		running.store.createStory({ id: "s1", title: "场面卡测试" });
		running.store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。凛站在教室门口。",
		});
		running.store.saveSceneLog({
			nodeId: "a1",
			storyId: "s1",
			beat: "开场",
			present: ["凛"],
			sceneEnds: false,
			sceneCard: {
				present: [{ who: "凛", want: "拿回那封信" }],
				change: "凛离开教室，把信交出去",
			},
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});

		await post(running.origin, "/api/stories/s1/director/scene", {
			change: "凛把信留在桌上",
		});
		const first = await getJson<DockView>(
			running.origin,
			"/api/stories/s1/dock",
		);
		expect(first.sceneGoal).toMatchObject({
			nodeId: "a1",
			change: "凛把信留在桌上",
			source: "player",
			locked: true,
		});

		await post(running.origin, "/api/stories/s1/director/scene", {
			change: "凛烧掉那封信",
		});
		const history = await getJson<HistoryView>(
			running.origin,
			"/api/stories/s1/memory/history?kind=scene&target=a1",
		);
		const oldest = history.edits[0];
		expect(oldest).toBeDefined();

		await post(running.origin, "/api/stories/s1/memory/rollback", {
			editId: oldest?.id,
		});
		const restored = await getJson<DockView>(
			running.origin,
			"/api/stories/s1/dock",
		);
		expect(restored.sceneGoal?.change).toBe("凛把信留在桌上");
	});
});

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createDefaultBackgroundJobRegistry,
	createSceneArchiveHandler,
	createSceneArchiveNeedsRun,
	deriveSceneSegments,
	drainBackgroundJobs,
	readSceneSegments,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function llmResult(text: string): LlmResult {
	return {
		text,
		usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
		stopReason: "stop",
		finishReason: "stop",
		attempts: 1,
	};
}

function createFakeClient(replies: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmClient = {
		async complete(request) {
			requests.push(request);
			const reply = replies[requests.length - 1];
			if (reply === undefined) {
				throw new Error("假客户端没有更多回复");
			}
			return llmResult(reply);
		},
	};
	return { client, requests };
}

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "assistant" | "user",
	raw: string,
): void {
	store.appendNode({ id, storyId: "s1", parentId, role, raw });
}

function seedScene(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试" });
	append(store, "a1", null, "assistant", "凛站在教室门口。");
	append(store, "u1", "a1", "user", "我走过去。");
	append(store, "a2", "u1", "assistant", "凛把书合上，抬头看你。");
}

function storyJob(): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId: null,
		kind: "scene_archive",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: "2026-11-14T12:00:00.000Z",
		startedAt: "2026-11-14T12:00:00.000Z",
		finishedAt: null,
	};
}

function saveLog(store: StoryStore, nodeId: string, sceneEnds: boolean): void {
	store.saveSceneLog({
		nodeId,
		storyId: "s1",
		beat: "试探",
		present: ["凛"],
		sceneEnds,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
}

const ARCHIVE = JSON.stringify({
	summary: "凛在教室试探玩家，最后合上书。",
	present: ["凛"],
	stateChanges: [{ path: ["scene", "current", "place"], change: "留在教室" }],
	cluesOpened: [],
	cluesClosed: [],
});

describe("场次边界", () => {
	it("场记判定结束的楼层收尾这一场，下一条助手楼层开新场", () => {
		const nodes = [
			{ id: "a1", role: "assistant" as const },
			{ id: "u1", role: "user" as const },
			{ id: "a2", role: "assistant" as const },
			{ id: "u2", role: "user" as const },
			{ id: "a3", role: "assistant" as const },
		];
		const scenes = deriveSceneSegments(nodes, (id) => id === "a2", 12);
		expect(scenes).toEqual([
			{
				startNodeId: "a1",
				endNodeId: "a2",
				floorIds: ["a1", "a2"],
				boundary: "scene-ends",
			},
			{
				startNodeId: "a3",
				endNodeId: null,
				floorIds: ["a3"],
				boundary: null,
			},
		]);
	});

	it("没有场记判定时达到楼层数上限强制结束", () => {
		const nodes = Array.from({ length: 13 }, (_, index) => ({
			id: `a${index + 1}`,
			role: "assistant" as const,
		}));
		const scenes = deriveSceneSegments(nodes, () => false, 12);
		expect(scenes).toHaveLength(2);
		expect(scenes[0]).toEqual({
			startNodeId: "a1",
			endNodeId: "a12",
			floorIds: nodes.slice(0, 12).map((node) => node.id),
			boundary: "max-floors",
		});
		expect(scenes[1]).toEqual({
			startNodeId: "a13",
			endNodeId: null,
			floorIds: ["a13"],
			boundary: null,
		});
	});

	it("场记判定与楼层上限同时到达时按场记判定收尾", () => {
		const nodes = [
			{ id: "a1", role: "assistant" as const },
			{ id: "a2", role: "assistant" as const },
		];
		const [scene] = deriveSceneSegments(nodes, (id) => id === "a2", 2);
		expect(scene?.boundary).toBe("scene-ends");
		expect(scene?.endNodeId).toBe("a2");
	});

	it("分支切换后只按当前路径重新计算", () => {
		const { store } = openTempStore();
		seedScene(store);
		append(store, "a3", "u1", "assistant", "另一个分支。");
		saveLog(store, "a2", true);

		expect(readSceneSegments(store, "a2")).toEqual([
			{
				startNodeId: "a1",
				endNodeId: "a2",
				floorIds: ["a1", "a2"],
				boundary: "scene-ends",
			},
		]);
		expect(readSceneSegments(store, "a3")).toEqual([
			{
				startNodeId: "a1",
				endNodeId: null,
				floorIds: ["a1", "a3"],
				boundary: null,
			},
		]);
	});
});

describe("场次归档", () => {
	it("场次结束时一次调用写下归档，现场景次重跑覆盖同一行", async () => {
		const { store, path } = openTempStore();
		seedScene(store);
		saveLog(store, "a2", false);
		const { client, requests } = createFakeClient([
			ARCHIVE,
			JSON.stringify({ ...JSON.parse(ARCHIVE), summary: "改写后的摘要。" }),
		]);

		await createSceneArchiveHandler({ maxSceneFloors: 2 })({
			store,
			client,
			job: storyJob(),
		});

		expect(requests).toHaveLength(1);
		expect(requests[0]?.temperature).toBe(0);
		expect(requests[0]?.messages[0]?.content).toContain("summary");
		expect(requests[0]?.messages[1]?.content).toContain("这一场的原文");
		const archive = store.getSceneArchive("a2");
		expect(archive).toMatchObject({
			endNodeId: "a2",
			storyId: "s1",
			startNodeId: "a1",
			floorCount: 2,
			boundary: "max-floors",
			summary: "凛在教室试探玩家，最后合上书。",
			present: ["凛"],
			stateChanges: [
				{ path: ["scene", "current", "place"], change: "留在教室" },
			],
			cluesOpened: [],
			cluesClosed: [],
		});

		saveLog(store, "a2", true);
		await createSceneArchiveHandler({ maxSceneFloors: 2 })({
			store,
			client,
			job: storyJob(),
		});

		expect(store.getSceneArchive("a2")).toMatchObject({
			boundary: "scene-ends",
			summary: "改写后的摘要。",
		});
		const db = new Database(path, { readonly: true });
		const row = db
			.prepare("SELECT COUNT(*) AS count FROM scene_archives")
			.get() as { readonly count: number };
		db.close();
		expect(row.count).toBe(1);
	});

	it("线索必须是台账里的 id，标为收了的必须已兑现", async () => {
		const { store } = openTempStore();
		seedScene(store);
		saveLog(store, "a2", true);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a2",
				path: ["clue", "旧信", "status"],
				op: "set",
				value: "open",
				source: "model",
			},
		]);
		const unknownClue = JSON.stringify({
			...JSON.parse(ARCHIVE),
			cluesOpened: ["不存在"],
		});
		const unfulfilled = JSON.stringify({
			...JSON.parse(ARCHIVE),
			cluesOpened: ["旧信"],
			cluesClosed: ["旧信"],
		});
		const { client } = createFakeClient([unknownClue, unfulfilled]);

		await expect(
			createSceneArchiveHandler()({ store, client, job: storyJob() }),
		).rejects.toThrow(/不存在/);
		expect(store.getSceneArchive("a2")).toBeNull();

		await expect(
			createSceneArchiveHandler()({ store, client, job: storyJob() }),
		).rejects.toThrow(/没有兑现/);
		expect(store.getSceneArchive("a2")).toBeNull();
	});

	it("needsRun 只在有已结束且未归档的场次时为 true", async () => {
		const { store } = openTempStore();
		seedScene(store);
		const needsRun = createSceneArchiveNeedsRun();

		expect(needsRun(store, "s1")).toBe(false);
		saveLog(store, "a1", true);
		expect(needsRun(store, "s1")).toBe(true);
		const { client } = createFakeClient([ARCHIVE]);
		await createSceneArchiveHandler()({ store, client, job: storyJob() });
		expect(needsRun(store, "s1")).toBe(false);
		expect(store.getSceneArchive("a1")?.startNodeId).toBe("a1");
		expect(store.getSceneArchive("a1")?.floorCount).toBe(1);
	});

	it("场次结束前不建任务，结束后入队并归档一次", async () => {
		const { store } = openTempStore();
		seedScene(store);
		const registry = createDefaultBackgroundJobRegistry();
		const { client } = createFakeClient([ARCHIVE]);
		const options = {
			store,
			registry,
			client,
			storyId: "s1",
			kinds: ["scene_archive"],
			sessionEnded: true,
		};

		const before = await drainBackgroundJobs(options);
		expect(before.enqueued).toBe(0);
		expect(before.runs).toEqual([]);

		saveLog(store, "a2", true);
		const after = await drainBackgroundJobs(options);
		expect(after.runs).toHaveLength(1);
		expect(after.runs[0]?.nodeId).toBeNull();
		expect(after.runs[0]?.status).toBe("done");
		expect(store.getSceneArchive("a2")?.summary).toBe(
			"凛在教室试探玩家，最后合上书。",
		);

		const again = await drainBackgroundJobs(options);
		expect(again.runs).toEqual([]);
	});

	it("归档不新增楼层，也不修改原文", async () => {
		const { store } = openTempStore();
		seedScene(store);
		saveLog(store, "a2", true);
		const before = store.getPathToHead("s1").map((node) => ({
			id: node.id,
			raw: node.raw,
		}));
		const { client } = createFakeClient([ARCHIVE]);

		await createSceneArchiveHandler()({ store, client, job: storyJob() });

		expect(
			store.getPathToHead("s1").map((node) => ({
				id: node.id,
				raw: node.raw,
			})),
		).toEqual(before);
	});
});

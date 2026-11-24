import { describe, expect, it } from "vitest";
import {
	type LlmClient,
	type LlmResult,
	type StoryStore,
	createSceneArchiveHandler,
	editNotebookSection,
	ensureNotebookInit,
	listNotebookHistory,
	notebookInitNeedsRun,
	readNotebookPages,
	rollbackNotebook,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

// memory-v5/03：记事页三节、场末补丁编译、版本与锁定。

function result(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake",
		channel: null,
		usage: {
			promptTokens: 1,
			completionTokens: 1,
			totalTokens: 2,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function client(replies: string[]): LlmClient {
	return {
		async complete() {
			const reply = replies.shift();
			if (reply === undefined) throw new Error("没有更多回复");
			return result(reply);
		},
	};
}

function archive(now: string, past: string, base: string | null = null) {
	return JSON.stringify({
		summary: "凛在教室试探玩家。",
		present: ["凛"],
		profiles: [],
		informed: [],
		stateChanges: [],
		cluesOpened: [],
		cluesClosed: [],
		notebook: [{ who: "凛", now, past, base }],
	});
}

const job = {
	id: 1,
	storyId: "s1",
	nodeId: null,
	kind: "scene_archive",
	status: "running" as const,
	attempts: 1,
	lastError: null,
	createdAt: "2026-11-24T00:00:00.000Z",
	startedAt: null,
	finishedAt: null,
};

function append(
	store: StoryStore,
	id: string,
	parentId: string | null,
	role: "assistant" | "user",
	raw: string,
): void {
	store.appendNode({ id, storyId: "s1", parentId, role, raw });
}

function endScene(store: StoryStore, nodeId: string): void {
	store.saveSceneLog({
		nodeId,
		storyId: "s1",
		beat: "收尾",
		present: ["凛"],
		sceneEnds: true,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "教室" });
	store.upsertEntity({
		storyId: "s1",
		kind: "character",
		name: "凛",
		description: "图书委员，说话很冲。",
		source: "test",
		aliases: [],
	});
	append(store, "a1", null, "assistant", "凛站在教室门口。");
	append(store, "u1", "a1", "user", "我走过去。");
	append(store, "a2", "u1", "assistant", "凛把书合上。");
	endScene(store, "a2");
	append(store, "u2", "a2", "user", "我等着。");
}

describe("故事记事", () => {
	it("旧故事用已有记录建初版，每个实体一页", () => {
		const { store } = openTempStore();
		seed(store);
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a2",
				path: ["character", "凛", "location"],
				op: "set",
				value: "教室",
				source: "model",
			},
		]);
		expect(notebookInitNeedsRun(store, "s1")).toBe(true);
		expect(ensureNotebookInit(store, "s1")).toBe(1);
		expect(notebookInitNeedsRun(store, "s1")).toBe(false);
		const [page] = readNotebookPages(store, "s1", "u2");
		expect(page).toMatchObject({
			name: "凛",
			base: "图书委员，说话很冲。",
			now: "在教室。",
			source: "init",
		});
	});

	it("场末产生补丁：刷新现在、追加经历；版本可回看与回滚，旧版本不改", async () => {
		const { store } = openTempStore();
		seed(store);
		await createSceneArchiveHandler()({
			store,
			client: client([archive("凛还在等信的下落。", "在教室试探玩家")]),
			job,
		});
		const [page] = readNotebookPages(store, "s1", "u2");
		expect(page?.now).toBe("凛还在等信的下落。");
		expect(page?.past).toEqual([
			{ text: "在教室试探玩家", fromFloor: 1, toFloor: 3, nodeId: "a2" },
		]);
		expect(page?.base).toBe("图书委员，说话很冲。");
		const history = listNotebookHistory(
			store,
			"s1",
			page?.entityId ?? "",
			"u2",
		);
		expect(history.map((version) => version.source)).toEqual([
			"compile",
			"init",
		]);
		const initial = history[1];
		expect(initial?.now).toBe("");

		rollbackNotebook(store, "s1", initial?.id ?? 0, "u2");
		expect(readNotebookPages(store, "s1", "u2")[0]?.now).toBe("");
		// 回滚是新版本：编译出来的那一版原样还在。
		const after = listNotebookHistory(store, "s1", page?.entityId ?? "", "u2");
		expect(after.map((version) => version.source)).toEqual([
			"rollback",
			"compile",
			"init",
		]);
		expect(after[1]?.now).toBe("凛还在等信的下落。");
	});

	it("玩家改过的节锁定，场末整理跳过它", async () => {
		const { store } = openTempStore();
		seed(store);
		ensureNotebookInit(store, "s1", "a2");
		const entityId = readNotebookPages(store, "s1", "a2")[0]?.entityId ?? "";
		editNotebookSection(store, "s1", {
			entityId,
			section: "now",
			text: "凛决定不再追问。",
			nodeId: "a2",
		});
		await createSceneArchiveHandler()({
			store,
			client: client([archive("凛还在等信的下落。", "在教室试探玩家")]),
			job,
		});
		const [page] = readNotebookPages(store, "s1", "u2");
		expect(page?.now).toBe("凛决定不再追问。");
		expect(page?.locked).toContain("now");
		expect(page?.past.map((entry) => entry.text)).toEqual(["在教室试探玩家"]);
	});

	it("版本挂在产生它的楼层上，切到旧分支时取那条路径上最近的版本", async () => {
		const { store } = openTempStore();
		seed(store);
		ensureNotebookInit(store, "s1", "a1");
		await createSceneArchiveHandler()({
			store,
			client: client([archive("凛还在等信的下落。", "在教室试探玩家")]),
			job,
		});
		append(store, "a2b", "u1", "assistant", "另一条分支：凛走了。");
		expect(readNotebookPages(store, "s1", "u2")[0]?.now).toBe(
			"凛还在等信的下落。",
		);
		expect(readNotebookPages(store, "s1", "a2b")[0]?.now).toBe("");
		expect(readNotebookPages(store, "s1", "a2b")[0]?.past).toEqual([]);
	});

	it("同一场重编译按场末楼层替换那一条经历，不重复追加", async () => {
		const { store } = openTempStore();
		seed(store);
		const handler = createSceneArchiveHandler();
		await handler({
			store,
			client: client([archive("一", "第一次")]),
			job,
		});
		// 场次划分变化（这里用改场记模拟）后整场重新归档。
		store.saveSceneLog({
			nodeId: "a1",
			storyId: "s1",
			beat: "开场",
			present: ["凛"],
			sceneEnds: false,
			sceneCard: null,
			bits: [],
			conditions: [],
			states: [],
			quotes: { submitted: 0, verified: 0 },
			repairs: [],
		});
		endScene(store, "a2");
		store.saveSceneArchive({
			...(store.getSceneArchive("a2") as NonNullable<
				ReturnType<StoryStore["getSceneArchive"]>
			>),
			floorCount: 99,
		});
		await handler({
			store,
			client: client([archive("二", "第二次")]),
			job,
		});
		const [page] = readNotebookPages(store, "s1", "u2");
		expect(page?.past.map((entry) => entry.text)).toEqual(["第二次"]);
	});
});

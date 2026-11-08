import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ApiErrorResponse,
	FulfillClueResult,
	NodeCompressionsView,
	NodeDirectorView,
	NodeEventsView,
	NodeLedgerView,
	StoryCluesView,
	StoryEntitiesView,
	StoryLoreView,
	StoryOpeningPickResult,
	StoryOpeningsView,
	StoryProposalsView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-panels-"));
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

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function getJson<T>(origin: string, path: string): Promise<T> {
	const response = await fetch(`${origin}${path}`);
	expect(response.status).toBe(200);
	return (await response.json()) as T;
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
	running.store.createStory({ id: "s1", title: "面板测试" });
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
	running.store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: root.id,
			path: ["character", "云裳", "status"],
			op: "set",
			value: "平静",
			source: "settler",
		},
		{
			storyId: "s1",
			nodeId: user.id,
			path: ["clue", "断剑", "text"],
			op: "set",
			value: "山后埋着断剑",
			source: "settler",
		},
		{
			storyId: "s1",
			nodeId: user.id,
			path: ["clue", "断剑", "status"],
			op: "set",
			value: "open",
			source: "settler",
		},
	]);
	return { rootId: root.id, userId: user.id, replyId: reply.id };
}

describe("节点面板接口", () => {
	it("台账、事件、压缩与导演数据与 store 一致", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);

		const ledger = await getJson<NodeLedgerView>(
			running.origin,
			`/api/nodes/${seeded.userId}/ledger`,
		);
		expect(ledger.storyId).toBe("s1");
		expect(ledger.state).toEqual({
			character: { 云裳: { status: "平静" } },
			clue: { 断剑: { text: "山后埋着断剑", status: "open" } },
		});
		expect(ledger.facts).toHaveLength(3);
		expect(ledger.diffs).toHaveLength(2);
		expect(ledger.diffs[0]?.path).toEqual(["clue", "断剑", "text"]);

		running.store.insertMemoryEvents([
			{
				storyId: "s1",
				sourceNodeId: seeded.replyId,
				ordinal: 0,
				participants: ["云裳"],
				importance: 0.7,
				knowers: [],
				text: "门外有人靠近",
				source: "events",
			},
			{
				storyId: "s1",
				sourceNodeId: seeded.replyId,
				ordinal: 1,
				participants: ["云裳"],
				importance: 0.3,
				knowers: [],
				text: "风停了",
				source: "events",
			},
		]);
		const events = await getJson<NodeEventsView>(
			running.origin,
			`/api/nodes/${seeded.replyId}/events?limit=1&offset=1`,
		);
		expect(events.limit).toBe(1);
		expect(events.offset).toBe(1);
		expect(events.events.map((event) => event.text)).toEqual(["风停了"]);

		const badEvents = await fetch(
			`${running.origin}/api/nodes/${seeded.replyId}/events?limit=5000`,
		);
		expect(badEvents.status).toBe(400);

		running.store.insertSummary({
			id: "summary-1",
			storyId: "s1",
			level: "chapter",
			startNodeId: seeded.rootId,
			endNodeId: seeded.replyId,
			text: "两人在山门前相遇。",
		});
		const compressions = await getJson<NodeCompressionsView>(
			running.origin,
			`/api/nodes/${seeded.replyId}/compressions`,
		);
		expect(compressions.compressions.map((item) => item.id)).toEqual([
			"summary-1",
		]);

		running.store.saveDirectorDecision({
			nodeId: seeded.replyId,
			storyId: "s1",
			directive: "让脚步声逼近",
			mechanisms: [{ name: "pacing", triggered: true, reason: "铺垫够久" }],
			signals: {},
		});
		const director = await getJson<NodeDirectorView>(
			running.origin,
			`/api/nodes/${seeded.replyId}/director`,
		);
		expect(director.decision?.directive).toBe("让脚步声逼近");
		const noDecision = await getJson<NodeDirectorView>(
			running.origin,
			`/api/nodes/${seeded.rootId}/director`,
		);
		expect(noDecision.decision).toBeNull();

		const trace = await fetch(
			`${running.origin}/api/nodes/${seeded.replyId}/trace`,
		);
		expect(trace.status).toBe(404);
	});

	it("线索列表只含未兑现线索，兑现后消失且状态写入台账", async () => {
		const running = await startTestServer();
		seedStory(running);

		const before = await getJson<StoryCluesView>(
			running.origin,
			"/api/stories/s1/clues",
		);
		expect(before.headNodeId).toBe(running.store.getHead("s1")?.id);
		expect(before.clues.map((clue) => clue.id)).toEqual(["断剑"]);

		const fulfilled = await post(running.origin, "/api/clues/断剑/fulfill", {
			storyId: "s1",
		});
		expect(fulfilled.status).toBe(200);
		const result = (await fulfilled.json()) as FulfillClueResult;
		expect(result.diffs.map((diff) => diff.path)).toEqual([
			["clue", "断剑", "status"],
			["clue", "断剑", "updatedAt"],
		]);

		const after = await getJson<StoryCluesView>(
			running.origin,
			"/api/stories/s1/clues",
		);
		expect(after.clues).toEqual([]);
		const head = running.store.getHead("s1");
		expect(running.store.getStateSnapshot(head?.id ?? "").state).toMatchObject({
			clue: { 断剑: { status: "fulfilled" } },
		});

		const again = await post(running.origin, "/api/clues/断剑/fulfill", {
			storyId: "s1",
		});
		expect(again.status).toBe(409);
		expect((await errorBody(again)).error.code).toBe("conflict");

		const missing = await post(running.origin, "/api/clues/不存在/fulfill", {
			storyId: "s1",
		});
		expect(missing.status).toBe(404);
		expect((await errorBody(missing)).error.code).toBe("not_found");
	});

	it("实体、世界书与变更卡按故事列出", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);
		running.store.upsertEntity({
			storyId: "s1",
			kind: "character",
			name: "云裳",
			source: "card",
			aliases: ["阿裳"],
		});
		running.store.insertLoreEntries([
			{
				storyId: "s1",
				name: "剑冢",
				content: "山后埋着历代断剑。",
				constant: true,
				keywords: ["剑冢"],
				source: "card:entry:1",
			},
		]);
		running.store.insertLedgerChangeCard({
			id: "card-1",
			storyId: "s1",
			source: "player",
			sourceNodeId: seeded.userId,
			text: "把场景改成夜晚",
			diffs: [{ path: ["mvu", "time"], op: "set", value: "夜晚" }],
			before: [{ path: ["mvu", "time"], existed: false }],
			status: "pending",
		});

		const entities = await getJson<StoryEntitiesView>(
			running.origin,
			"/api/stories/s1/entities",
		);
		expect(entities.entities.map((entity) => entity.name)).toEqual(["云裳"]);
		expect(entities.entities[0]?.aliases).toEqual(["云裳", "阿裳"]);

		const lore = await getJson<StoryLoreView>(
			running.origin,
			"/api/stories/s1/lore",
		);
		expect(lore.entries.map((entry) => entry.name)).toEqual(["剑冢"]);

		const proposals = await getJson<StoryProposalsView>(
			running.origin,
			"/api/stories/s1/proposals",
		);
		expect(proposals.status).toBe("pending");
		expect(proposals.proposals.map((card) => card.id)).toEqual(["card-1"]);
		const all = await getJson<StoryProposalsView>(
			running.origin,
			"/api/stories/s1/proposals?status=all",
		);
		expect(all.proposals).toHaveLength(1);
		const badStatus = await fetch(
			`${running.origin}/api/stories/s1/proposals?status=nope`,
		);
		expect(badStatus.status).toBe(400);
	});

	it("开场候选可以列出、选中，跨故事选中返回 404", async () => {
		const running = await startTestServer();
		running.store.createStory({ id: "s1", title: "有楼层的故事" });
		running.store.appendNode({
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "已经有楼层。",
		});
		running.store.createStory({ id: "s2", title: "新故事" });
		const candidates = running.store.appendOpeningCandidates({
			storyId: "s2",
			raws: ["雨夜的第一幕。", "雪夜的第一幕。"],
		});

		const list = await getJson<StoryOpeningsView>(
			running.origin,
			"/api/stories/s2/openings",
		);
		expect(list.status).toBe("all");
		expect(list.candidates.map((candidate) => candidate.raw)).toEqual([
			"雨夜的第一幕。",
			"雪夜的第一幕。",
		]);
		const pending = await getJson<StoryOpeningsView>(
			running.origin,
			"/api/stories/s2/openings?status=pending",
		);
		expect(pending.candidates).toHaveLength(2);

		const crossStory = await post(
			running.origin,
			`/api/stories/s1/openings/${candidates[0]?.id ?? ""}/pick`,
			{},
		);
		expect(crossStory.status).toBe(404);

		const picked = await post(
			running.origin,
			`/api/stories/s2/openings/${candidates[0]?.id ?? ""}/pick`,
			{},
		);
		expect(picked.status).toBe(200);
		const result = (await picked.json()) as StoryOpeningPickResult;
		expect(result.candidate.status).toBe("chosen");
		expect(result.node.role).toBe("assistant");
		expect(result.node.parentId).toBeNull();
		expect(result.path.headNodeId).toBe(result.node.id);
		expect(running.store.getHead("s2")?.raw).toBe("雨夜的第一幕。");
		expect(
			running.store
				.listOpeningCandidates("s2")
				.filter((candidate) => candidate.status === "discarded"),
		).toHaveLength(1);
	});
});

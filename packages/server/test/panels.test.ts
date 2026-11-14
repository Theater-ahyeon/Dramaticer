import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DIRECTOR_CONFIG, StoryStore } from "@dramaticer/core";
import type {
	ApiErrorResponse,
	FulfillClueResult,
	NodeActionsView,
	NodeCompressionsView,
	NodeDirectorView,
	NodeEventsView,
	NodeLedgerView,
	NodeRunView,
	ProposalDecisionResult,
	StoryCluesView,
	StoryDirectorPlanView,
	StoryEntitiesView,
	StoryLoreView,
	StoryOpeningPickResult,
	StoryOpeningsView,
	StoryProposalCreateResult,
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
	it("启动时把遗留的运行标为中断并保留事件", async () => {
		const dir = tempDir();
		const dbPath = join(dir, "story.db");
		const store = StoryStore.open(dbPath);
		store.createStory({ id: "s1", title: "中断测试" });
		store.appendNode({
			id: "u1",
			storyId: "s1",
			parentId: null,
			role: "user",
			raw: "我推门。",
		});
		store.startTurnRun({
			runId: "run-stale",
			storyId: "s1",
			userNodeId: "u1",
			mode: "deep",
		});
		store.appendTurnRunEvent({
			runId: "run-stale",
			kind: "model.request",
			payload: { round: 1 },
		});
		store.close();

		const webRoot = join(dir, "web");
		mkdirSync(webRoot, { recursive: true });
		writeFileSync(
			join(webRoot, "index.html"),
			"<!doctype html><title>应用</title>",
		);
		const running = await startServer({
			dbPath,
			webRoot,
			host: "127.0.0.1",
			port: 0,
			password: null,
			log: () => {},
		});
		onTestFinished(() => running.close());

		const run = running.store.getTurnRun("run-stale");
		expect(run?.status).toBe("interrupted");
		expect(run?.finishedAt).not.toBeNull();
		expect(
			running.store.listTurnRunEvents("run-stale").map((event) => event.seq),
		).toEqual([1]);
	});

	it("运行记录返回摘要与按序号排列的事件，没有运行返回 404", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);
		running.store.startTurnRun({
			runId: "run-1",
			storyId: "s1",
			userNodeId: seeded.userId,
			mode: "deep",
			startedAt: "2026-11-12T00:00:00.000Z",
		});
		running.store.appendTurnRunEvent({
			runId: "run-1",
			kind: "model.request",
			payload: { round: 1, messages: 2 },
		});
		running.store.appendTurnRunEvent({
			runId: "run-1",
			kind: "model.response",
			payload: { round: 1, textLength: 7 },
		});
		running.store.finishTurnRun({
			runId: "run-1",
			status: "completed",
			nodeId: seeded.replyId,
			finishedAt: "2026-11-12T00:00:02.000Z",
		});

		const view = await getJson<NodeRunView>(
			running.origin,
			`/api/nodes/${seeded.replyId}/run`,
		);
		expect(view.nodeId).toBe(seeded.replyId);
		expect(view.run.runId).toBe("run-1");
		expect(view.run.status).toBe("completed");
		expect(view.events.map((event) => event.seq)).toEqual([1, 2]);
		expect(view.events.map((event) => event.kind)).toEqual([
			"model.request",
			"model.response",
		]);

		const missing = await fetch(
			`${running.origin}/api/nodes/${seeded.rootId}/run`,
		);
		expect(missing.status).toBe(404);
	});

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
		expect(director.mode).toBe("transparent");
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

	it("盲盒模式只返回机制触发状态，透明模式返回完整决策", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);
		const mechanisms = [
			{ name: "pacing", triggered: true, reason: "铺垫够久" },
		];
		running.store.saveDirectorDecision({
			nodeId: seeded.replyId,
			storyId: "s1",
			directive: "让脚步声逼近",
			mechanisms,
			signals: { pacing: { phase: "setup" } },
		});

		running.store.updateStorySettings("s1", {
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, mode: "blind" },
		});
		const blind = await getJson<NodeDirectorView>(
			running.origin,
			`/api/nodes/${seeded.replyId}/director`,
		);
		expect(blind.mode).toBe("blind");
		expect(blind.decision?.directive).toBeNull();
		expect(blind.decision?.mechanisms).toEqual(mechanisms);
		expect(blind.decision !== null && "signals" in blind.decision).toBe(false);

		running.store.updateStorySettings("s1", {
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, mode: "transparent" },
		});
		const transparent = await getJson<NodeDirectorView>(
			running.origin,
			`/api/nodes/${seeded.replyId}/director`,
		);
		expect(transparent.mode).toBe("transparent");
		expect(transparent.decision?.directive).toBe("让脚步声逼近");
		expect(transparent.decision?.signals).toEqual({
			pacing: { phase: "setup" },
		});
	});

	it("候选行动按楼层返回 4 条行动与 1 条场景变化", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);
		running.store.replaceDirectorCandidateActions({
			storyId: "s1",
			nodeId: seeded.replyId,
			actions: [
				{ kind: "action", text: "行动一" },
				{ kind: "action", text: "行动二" },
				{ kind: "action", text: "行动三" },
				{ kind: "action", text: "行动四" },
				{ kind: "scene_change", text: "场景变化" },
			],
		});
		const view = await getJson<NodeActionsView>(
			running.origin,
			`/api/nodes/${seeded.replyId}/actions`,
		);
		expect(view.nodeId).toBe(seeded.replyId);
		expect(view.actions.map((action) => action.kind)).toEqual([
			"action",
			"action",
			"action",
			"action",
			"scene_change",
		]);
		const empty = await getJson<NodeActionsView>(
			running.origin,
			`/api/nodes/${seeded.userId}/actions`,
		);
		expect(empty.actions).toEqual([]);
		const missing = await fetch(`${running.origin}/api/nodes/nope/actions`);
		expect(missing.status).toBe(404);
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

	it("变更卡可以批准、拒绝与回滚，重复操作 409，不存在 404", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);
		running.store.insertLedgerChangeCard({
			id: "card-1",
			storyId: "s1",
			source: "player",
			sourceNodeId: seeded.userId,
			text: "把时间改成夜晚",
			diffs: [{ path: ["mvu", "time"], op: "set", value: "夜晚" }],
			before: [{ path: ["mvu", "time"], existed: false }],
			status: "pending",
		});
		running.store.insertLedgerChangeCard({
			id: "card-2",
			storyId: "s1",
			source: "settler",
			sourceNodeId: seeded.userId,
			text: "把地点改成山顶",
			diffs: [
				{ path: ["scene", "current", "place"], op: "set", value: "山顶" },
			],
			before: [{ path: ["scene", "current", "place"], existed: false }],
			status: "pending",
		});

		const approved = await post(
			running.origin,
			"/api/proposals/card-1/approve",
			{},
		);
		expect(approved.status).toBe(200);
		const approvedBody = (await approved.json()) as ProposalDecisionResult;
		expect(approvedBody.card).toMatchObject({
			id: "card-1",
			status: "approved",
		});
		expect(approvedBody.ledger?.nodeId).toBe(seeded.replyId);
		expect(approvedBody.ledger?.state).toMatchObject({ mvu: { time: "夜晚" } });

		const again = await post(
			running.origin,
			"/api/proposals/card-1/approve",
			{},
		);
		expect(again.status).toBe(409);
		expect((await errorBody(again)).error.code).toBe("conflict");

		const missing = await post(
			running.origin,
			"/api/proposals/没有这张卡/approve",
			{},
		);
		expect(missing.status).toBe(404);
		expect((await errorBody(missing)).error.code).toBe("not_found");

		const rejected = await post(
			running.origin,
			"/api/proposals/card-2/reject",
			{},
		);
		expect(rejected.status).toBe(200);
		const rejectedBody = (await rejected.json()) as ProposalDecisionResult;
		expect(rejectedBody.card).toMatchObject({
			id: "card-2",
			status: "rejected",
		});
		expect(rejectedBody.ledger?.state).not.toHaveProperty("scene");

		const approvedRollback = await post(
			running.origin,
			"/api/proposals/card-1/rollback",
			{},
		);
		expect(approvedRollback.status).toBe(200);
		const rollbackBody =
			(await approvedRollback.json()) as ProposalDecisionResult;
		expect(rollbackBody.card).toMatchObject({
			id: "card-1",
			status: "rolled_back",
		});
		expect(rollbackBody.ledger?.state).not.toHaveProperty("mvu.time");

		const rollbackAgain = await post(
			running.origin,
			"/api/proposals/card-1/rollback",
			{},
		);
		expect(rollbackAgain.status).toBe(409);

		const decisions = running.store.listPreferenceEvents("s1", {
			kind: "card_decision",
		});
		expect(decisions.map((event) => event.payload)).toEqual([
			{ cardId: "card-1", decision: "approved" },
			{ cardId: "card-2", decision: "rejected" },
		]);
	});

	it("玩家编辑台账生成待定卡，批准后事实来源为玩家并可回滚", async () => {
		const running = await startTestServer();
		const seeded = seedStory(running);

		const created = await post(running.origin, "/api/stories/s1/proposals", {
			text: "云裳现在很警觉",
			diffs: [
				{ path: ["character", "云裳", "status"], op: "set", value: "警觉" },
			],
		});
		expect(created.status).toBe(201);
		const createdBody = (await created.json()) as StoryProposalCreateResult;
		expect(createdBody.card).toMatchObject({
			source: "player",
			sourceNodeId: seeded.replyId,
			text: "云裳现在很警觉",
			status: "pending",
		});
		expect(createdBody.card.before).toEqual([
			{
				path: ["character", "云裳", "status"],
				existed: true,
				value: "平静",
			},
		]);
		expect(createdBody.ledger?.state).toMatchObject({
			character: { 云裳: { status: "平静" } },
		});

		const pending = await getJson<StoryProposalsView>(
			running.origin,
			"/api/stories/s1/proposals",
		);
		expect(pending.proposals.map((card) => card.id)).toEqual([
			createdBody.card.id,
		]);

		const approvePath = `/api/proposals/${encodeURIComponent(createdBody.card.id)}/approve`;
		const approved = await post(running.origin, approvePath, {});
		expect(approved.status).toBe(200);
		const approvedBody = (await approved.json()) as ProposalDecisionResult;
		expect(approvedBody.card.status).toBe("approved");
		expect(approvedBody.ledger?.state).toMatchObject({
			character: { 云裳: { status: "警觉" } },
		});
		const facts = running.store
			.getStateDiffs(seeded.replyId)
			.filter((diff) => diff.path.join(".") === "character.云裳.status");
		expect(
			facts.map((fact) => ({
				op: fact.op,
				value: fact.value,
				source: fact.source,
			})),
		).toEqual([{ op: "set", value: "警觉", source: "player" }]);

		const rolledBack = await post(
			running.origin,
			`/api/proposals/${encodeURIComponent(createdBody.card.id)}/rollback`,
			{},
		);
		expect(rolledBack.status).toBe(200);
		const rolledBackBody = (await rolledBack.json()) as ProposalDecisionResult;
		expect(rolledBackBody.card.status).toBe("rolled_back");
		expect(rolledBackBody.ledger?.state).toMatchObject({
			character: { 云裳: { status: "平静" } },
		});
	});

	it("玩家编辑的非法路径、缺失说明与未知故事按 400、404 拒绝", async () => {
		const running = await startTestServer();
		seedStory(running);

		const badPath = await post(running.origin, "/api/stories/s1/proposals", {
			text: "乱写",
			diffs: [{ path: ["nope", "x"], op: "set", value: 1 }],
		});
		expect(badPath.status).toBe(400);
		const badPathBody = await errorBody(badPath);
		expect(badPathBody.error.details).toEqual({ path: "diffs" });
		expect(badPathBody.error.message).toContain("nope");

		const missingText = await post(
			running.origin,
			"/api/stories/s1/proposals",
			{ diffs: [] },
		);
		expect(missingText.status).toBe(400);
		expect((await errorBody(missingText)).error.details).toEqual({
			path: "text",
		});

		const emptyDiffs = await post(running.origin, "/api/stories/s1/proposals", {
			text: "没有修改",
			diffs: [],
		});
		expect(emptyDiffs.status).toBe(400);
		expect((await errorBody(emptyDiffs)).error.details).toEqual({
			path: "diffs",
		});

		const missingStory = await post(
			running.origin,
			"/api/stories/nope/proposals",
			{
				text: "乱写",
				diffs: [{ path: ["item", "断剑"], op: "delete" }],
			},
		);
		expect(missingStory.status).toBe(404);
		expect(running.store.listLedgerChangeCards("s1")).toEqual([]);
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

	it("导演计划可以读取与整份替换，非法计划指出路径", async () => {
		const running = await startTestServer();
		running.store.createStory({ id: "s1", title: "计划故事" });
		const plan = {
			arcs: [
				{
					id: "arc-1",
					title: "开学",
					throughLine: "凛必须说出真相",
					difficulty: 0.4,
					redLines: ["不能伤害凛"],
					sequences: [
						{
							id: "seq-1",
							title: "相遇",
							beats: [
								{
									id: "beat-1",
									goal: "确认来意",
									entrySigns: ["凛堵在门口"],
									fitPoints: ["凛盯着你"],
								},
							],
						},
					],
				},
			],
		};

		const empty = await getJson<StoryDirectorPlanView>(
			running.origin,
			"/api/stories/s1/director/plan",
		);
		expect(empty.plan).toEqual({ arcs: [] });

		const put = await fetch(`${running.origin}/api/stories/s1/director/plan`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ plan }),
		});
		expect(put.status).toBe(200);
		const saved = (await put.json()) as StoryDirectorPlanView;
		expect(saved.storyId).toBe("s1");
		expect(saved.plan).toEqual(plan);
		expect(
			running.store
				.listDirectorPlanEntries("s1")
				.arcs.every((arc) => arc.source === "player"),
		).toBe(true);

		const reread = await getJson<StoryDirectorPlanView>(
			running.origin,
			"/api/stories/s1/director/plan",
		);
		expect(reread.plan).toEqual(plan);

		const bad = await fetch(`${running.origin}/api/stories/s1/director/plan`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				plan: {
					arcs: [{ ...plan.arcs[0], difficulty: 2 }],
				},
			}),
		});
		expect(bad.status).toBe(400);
		const badBody = await errorBody(bad);
		expect(badBody.error.details).toEqual({
			path: "plan.arcs[0].difficulty",
		});

		const unknownStory = await fetch(
			`${running.origin}/api/stories/nope/director/plan`,
		);
		expect(unknownStory.status).toBe(404);

		const missingPlan = await fetch(
			`${running.origin}/api/stories/s1/director/plan`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(missingPlan.status).toBe(400);
	});
});

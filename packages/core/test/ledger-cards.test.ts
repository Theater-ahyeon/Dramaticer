import { describe, expect, it } from "vitest";
import {
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	MEMORY_REVISION_JOB_KIND,
	SETTLE_JOB_KIND,
	type StoryStore,
	approveLedgerChangeCard,
	createBackgroundJobRegistry,
	createMemoryRevisionHandler,
	createPlayerLedgerChangeCard,
	createSettleHandler,
	drainBackgroundJobs,
	readLedger,
	rejectLedgerChangeCard,
	rollbackLedgerChangeCard,
	runLedgerCli,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const FIXED_NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const FIXED_AT = new Date(FIXED_NOW).toISOString();

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
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

/** 假客户端：记录请求，按脚本返回文本；脚本用完后再调用直接失败。 */
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

/** 开场助手楼、玩家修改要求与助手回复；head 停在 a2。 */
function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。凛站在教室门口。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "把凛的所在地改成屋顶。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "凛抬头看着天。",
	});
}

function jobFor(nodeId: string, kind: string): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId,
		kind,
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: FIXED_AT,
		startedAt: FIXED_AT,
		finishedAt: null,
	};
}

const REVISION_REPLY = JSON.stringify([
	{
		text: "把凛的所在地改成屋顶",
		sourceQuote: "把凛的所在地改成屋顶",
		diffs: [
			{ path: ["character", "凛", "location"], op: "set", value: "屋顶" },
		],
	},
]);

async function runRevision(
	store: StoryStore,
	client: LlmClient,
	nodeId = "a2",
): Promise<void> {
	await createMemoryRevisionHandler()({
		store,
		client,
		job: jobFor(nodeId, MEMORY_REVISION_JOB_KIND),
	});
}

describe("memory_revision", () => {
	it("明确的修改要求生成一张待定卡，批准前台账不变", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([REVISION_REPLY]);

		await runRevision(store, client);

		const cards = store.listLedgerChangeCards("s1");
		expect(cards).toHaveLength(1);
		const card = cards[0];
		expect(card).toMatchObject({
			source: "player",
			sourceNodeId: "u1",
			text: "把凛的所在地改成屋顶",
			status: "pending",
			rejectionReason: null,
			decidedAt: null,
		});
		expect(card?.diffs).toEqual([
			{ path: ["character", "凛", "location"], op: "set", value: "屋顶" },
		]);
		expect(card?.before).toEqual([
			{ path: ["character", "凛", "location"], existed: false },
		]);
		expect(store.getStateSnapshot("a2").state).toEqual({});
	});

	it("批准后写成 player 事实并记入用户意志", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([REVISION_REPLY]);
		await runRevision(store, client);
		const cardId = store.listLedgerChangeCards("s1")[0]?.id as string;

		const approved = await approveLedgerChangeCard(store, cardId, {
			decidedAt: FIXED_AT,
		});

		expect(approved).toMatchObject({ status: "approved", decidedAt: FIXED_AT });
		const diffs = store.getStateDiffs("a2");
		expect(
			diffs.map((diff) => ({
				path: diff.path,
				op: diff.op,
				value: diff.value,
				source: diff.source,
			})),
		).toEqual([
			{
				path: ["character", "凛", "location"],
				op: "set",
				value: "屋顶",
				source: "player",
			},
			{
				path: ["userWill", expect.stringMatching(/^will-/)],
				op: "set",
				value: {
					kind: "correction",
					text: "把凛的所在地改成屋顶",
					sourceNodeId: "u1",
					createdAt: FIXED_AT,
				},
				source: "player",
			},
		]);
		const wills = readLedger(store, "a2", ["userWill"]);
		expect(Object.values(wills as Record<string, unknown>)).toHaveLength(1);

		const before = diffs.length;
		await expect(approveLedgerChangeCard(store, cardId)).rejects.toThrow(
			/只有待定卡可以批准/,
		);
		expect(store.getStateDiffs("a2")).toHaveLength(before);
	});

	it("拒绝只改状态，不写台账", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([REVISION_REPLY]);
		await runRevision(store, client);
		const cardId = store.listLedgerChangeCards("s1")[0]?.id as string;

		const rejected = await rejectLedgerChangeCard(store, cardId, {
			decidedAt: FIXED_AT,
		});

		expect(rejected).toMatchObject({ status: "rejected", decidedAt: FIXED_AT });
		expect(store.getStateDiffs("a2")).toEqual([]);
		expect(store.getStateSnapshot("a2").state).toEqual({});
	});

	it("回滚后快照回到批准前的值", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a2",
			path: ["character", "凛", "location"],
			op: "set",
			value: "教室",
			source: "model",
		});
		const { client } = createFakeClient([REVISION_REPLY]);
		await runRevision(store, client);
		const card = store.listLedgerChangeCards("s1")[0];
		expect(card?.before).toEqual([
			{ path: ["character", "凛", "location"], existed: true, value: "教室" },
		]);
		const cardId = card?.id as string;

		await approveLedgerChangeCard(store, cardId, { decidedAt: FIXED_AT });
		expect(readLedger(store, "a2", ["character", "凛", "location"])).toBe(
			"屋顶",
		);

		const rolledBack = await rollbackLedgerChangeCard(store, cardId, {
			decidedAt: FIXED_AT,
		});
		expect(rolledBack).toMatchObject({
			status: "rolled_back",
			decidedAt: FIXED_AT,
		});
		expect(readLedger(store, "a2", ["character", "凛", "location"])).toBe(
			"教室",
		);
		const last = store.getStateDiffs("a2").at(-1);
		expect(last).toMatchObject({
			path: ["character", "凛", "location"],
			op: "set",
			value: "教室",
			source: "player",
		});
		await expect(rollbackLedgerChangeCard(store, cardId)).rejects.toThrow(
			/只有已批准的卡片可以回滚/,
		);
	});

	it("一条非法修改让整卡被拒绝并记录原因", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify([
				{
					text: "把凛的所在地改成屋顶，并关掉线索",
					sourceQuote: "把凛的所在地改成屋顶",
					diffs: [
						{
							path: ["character", "凛", "location"],
							op: "set",
							value: "屋顶",
						},
						{ path: ["clue", "c1", "status"], op: "set", value: "closed" },
					],
				},
			]),
		]);

		await runRevision(store, client);

		const cards = store.listLedgerChangeCards("s1");
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({ status: "rejected", diffs: [] });
		expect(cards[0]?.rejectionReason).toContain("clue");
		expect(cards[0]?.rejectionReason).toContain("status");
		expect(store.getStateDiffs("a2")).toEqual([]);
		expect(store.listLedgerChangeCards("s1", { status: "pending" })).toEqual(
			[],
		);
	});

	it("引文不在玩家消息里时整次拒绝", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([
			JSON.stringify([
				{
					text: "把凛的所在地改成屋顶",
					sourceQuote: "凛抬头看着天",
					diffs: [
						{
							path: ["character", "凛", "location"],
							op: "set",
							value: "屋顶",
						},
					],
				},
			]),
		]);

		await expect(runRevision(store, client)).rejects.toThrow(
			/sourceQuote 不在本次窗口的玩家消息里/,
		);
		expect(store.listLedgerChangeCards("s1")).toEqual([]);
	});

	it("重复执行同一份草案不新增卡片", async () => {
		const { store } = openTempStore();
		seedStory(store);
		const { client } = createFakeClient([REVISION_REPLY, REVISION_REPLY]);

		await runRevision(store, client);
		await runRevision(store, client);

		expect(store.listLedgerChangeCards("s1")).toHaveLength(1);
	});

	it("窗口里没有玩家消息时不调用模型", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		const { client } = createFakeClient([]);

		await runRevision(store, client, "a1");

		expect(store.listLedgerChangeCards("s1")).toEqual([]);
	});
});

describe("结算冲突转成待审变更卡", () => {
	it("冲突生成待定卡，批准后才覆盖台账", async () => {
		const { store } = openTempStore();
		seedStory(store);
		store.appendStateDiff({
			storyId: "s1",
			nodeId: "a1",
			path: ["character", "凛", "location"],
			op: "set",
			value: "教室",
			source: "model",
		});
		const { client } = createFakeClient([
			JSON.stringify([
				{
					nodeId: "a2",
					diffs: [
						{
							path: ["character", "凛", "location"],
							op: "set",
							value: "屋顶",
							confidence: 0.5,
						},
					],
					conflicts: [
						{
							path: ["character", "凛", "location"],
							reason: "最近一楼明确写她还在教室",
						},
					],
				},
			]),
		]);

		await drainBackgroundJobs({
			store,
			registry: createBackgroundJobRegistry({
				[SETTLE_JOB_KIND]: {
					handler: createSettleHandler(),
					enqueue: "settled",
				},
			}),
			client,
			storyId: "s1",
			kinds: [SETTLE_JOB_KIND],
			now: () => FIXED_NOW,
		});

		const cards = store.listLedgerChangeCards("s1");
		expect(cards).toHaveLength(1);
		const card = cards[0];
		expect(card).toMatchObject({
			source: "settler",
			sourceNodeId: "a2",
			status: "pending",
		});
		expect(card?.text).toContain("最近一楼明确写她还在教室");
		expect(card?.diffs).toEqual([
			{ path: ["character", "凛", "location"], op: "set", value: "屋顶" },
		]);
		expect(card?.before).toEqual([
			{ path: ["character", "凛", "location"], existed: true, value: "教室" },
		]);
		expect(readLedger(store, "a2", ["character", "凛", "location"])).toBe(
			"教室",
		);

		await approveLedgerChangeCard(store, card?.id as string, {
			decidedAt: FIXED_AT,
		});

		expect(readLedger(store, "a2", ["character", "凛", "location"])).toBe(
			"屋顶",
		);
	});
});

describe("玩家直接编辑台账", () => {
	const LOCATION = ["character", "凛", "location"] as const;

	function seedLedger(store: StoryStore): void {
		store.appendStateDiffs([
			{
				storyId: "s1",
				nodeId: "a2",
				path: LOCATION,
				op: "set",
				value: "教室",
				source: "settler",
			},
		]);
	}

	it("改值生成来源为玩家的待定卡，批准前台账不变", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedLedger(store);

		const card = createPlayerLedgerChangeCard(
			store,
			"s1",
			{
				text: "凛的所在地改成屋顶",
				diffs: [{ path: LOCATION, op: "set", value: "屋顶" }],
			},
			{ createdAt: FIXED_AT },
		);

		expect(card).toMatchObject({
			source: "player",
			sourceNodeId: "a2",
			text: "凛的所在地改成屋顶",
			status: "pending",
			rejectionReason: null,
			decidedAt: null,
			createdAt: FIXED_AT,
		});
		expect(card.before).toEqual([
			{ path: LOCATION, existed: true, value: "教室" },
		]);
		expect(readLedger(store, "a2", LOCATION)).toBe("教室");
	});

	it("删除已有路径，批准后路径消失且事实来源为玩家", async () => {
		const { store } = openTempStore();
		seedStory(store);
		seedLedger(store);
		const card = createPlayerLedgerChangeCard(store, "s1", {
			text: "凛的所在地不再记录",
			diffs: [{ path: LOCATION, op: "delete" }],
		});

		await approveLedgerChangeCard(store, card.id, { decidedAt: FIXED_AT });

		expect(readLedger(store, "a2", LOCATION)).toBeUndefined();
		const diffs = store.getStateDiffs("a2");
		expect(
			diffs
				.filter((diff) => diff.path.join(".") === LOCATION.join("."))
				.map((diff) => ({ op: diff.op, source: diff.source })),
		).toEqual([
			{ op: "set", source: "settler" },
			{ op: "delete", source: "player" },
		]);
	});

	it("拒绝只改状态，不写台账", async () => {
		const { store } = openTempStore();
		seedStory(store);
		seedLedger(store);
		const card = createPlayerLedgerChangeCard(store, "s1", {
			text: "凛的所在地改成屋顶",
			diffs: [{ path: LOCATION, op: "set", value: "屋顶" }],
		});

		const rejected = await rejectLedgerChangeCard(store, card.id, {
			decidedAt: FIXED_AT,
		});

		expect(rejected).toMatchObject({
			status: "rejected",
			decidedAt: FIXED_AT,
		});
		expect(readLedger(store, "a2", LOCATION)).toBe("教室");
		expect(store.getStateDiffs("a2")).toHaveLength(1);
	});

	it("回滚恢复批准前的原值", async () => {
		const { store } = openTempStore();
		seedStory(store);
		seedLedger(store);
		const card = createPlayerLedgerChangeCard(store, "s1", {
			text: "凛的所在地改成屋顶",
			diffs: [{ path: LOCATION, op: "set", value: "屋顶" }],
		});
		await approveLedgerChangeCard(store, card.id, { decidedAt: FIXED_AT });

		const rolledBack = await rollbackLedgerChangeCard(store, card.id, {
			decidedAt: FIXED_AT,
		});

		expect(rolledBack).toMatchObject({ status: "rolled_back" });
		expect(readLedger(store, "a2", LOCATION)).toBe("教室");
	});

	it("非法路径与不存在的删除在写入前拒绝", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedLedger(store);

		expect(() =>
			createPlayerLedgerChangeCard(store, "s1", {
				text: "乱写",
				diffs: [{ path: ["nope", "x"], op: "set", value: 1 }],
			}),
		).toThrow(/nope/);
		expect(() =>
			createPlayerLedgerChangeCard(store, "s1", {
				text: "删掉不存在的条目",
				diffs: [{ path: ["item", "灯"], op: "delete" }],
			}),
		).toThrow(/diffs\[0\]\.path/);
		expect(store.listLedgerChangeCards("s1")).toEqual([]);
	});

	it("同一份编辑重复提交复用同一张卡", () => {
		const { store } = openTempStore();
		seedStory(store);
		seedLedger(store);
		const edit = {
			text: "凛的所在地改成屋顶",
			diffs: [{ path: LOCATION, op: "set", value: "屋顶" }] as const,
		};

		const first = createPlayerLedgerChangeCard(store, "s1", edit);
		const second = createPlayerLedgerChangeCard(store, "s1", edit);

		expect(second.id).toBe(first.id);
		expect(store.listLedgerChangeCards("s1")).toHaveLength(1);
	});
});

describe("ledger 命令行", () => {
	it("列出待定卡并按 id 批准", async () => {
		const { store, path } = openTempStore();
		seedStory(store);
		store.insertLedgerChangeCard({
			id: "card-cli",
			storyId: "s1",
			source: "player",
			sourceNodeId: "u1",
			text: "把凛的所在地改成屋顶",
			diffs: [
				{ path: ["character", "凛", "location"], op: "set", value: "屋顶" },
			],
			before: [{ path: ["character", "凛", "location"], existed: false }],
			status: "pending",
		});
		const lines: string[] = [];

		const listed = await runLedgerCli(["ledger", "cards", "s1", "--db", path], {
			log: (message) => lines.push(message),
		});
		expect(listed.cards.map((card) => card.id)).toEqual(["card-cli"]);
		expect(lines.join("\n")).toContain("card-cli");

		const approved = await runLedgerCli(
			["ledger", "--approve", "card-cli", "--db", path],
			{ log: (message) => lines.push(message), decidedAt: FIXED_AT },
		);
		expect(approved.cards[0]).toMatchObject({
			status: "approved",
			decidedAt: FIXED_AT,
		});
		expect(readLedger(store, "a2", ["character", "凛", "location"])).toBe(
			"屋顶",
		);
	});
});

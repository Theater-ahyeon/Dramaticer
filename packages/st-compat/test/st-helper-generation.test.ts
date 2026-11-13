import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginDisplayState, StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import {
	StEjsGenerationLimitError,
	type StEjsGenerationRunnerInput,
	StEjsGenerationScheduler,
} from "../src/st-ejs/index.js";
import {
	type StHelperHostSession,
	createStHelperHostSession,
} from "../src/st-helper-host/index.js";

const CARD = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: { name: "测试角色", description: "" },
	}),
);

interface Harness {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly session: StHelperHostSession;
	readonly queue: NonNullable<StHelperHostSession["generation"]>;
}

function openSession(scheduler: StEjsGenerationScheduler): Harness {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-st-helper-generation-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	const storyId = "s-helper-generation";
	store.createStory({ id: storyId, title: "脚本生成测试" });
	const opening = store.appendNode({
		id: "n-open",
		storyId,
		parentId: null,
		role: "assistant",
		raw: "开场白",
	});
	store.appendNode({
		id: "n-user",
		storyId,
		parentId: opening.id,
		role: "user",
		raw: "玩家行动",
	});
	const session = createStHelperHostSession({
		store,
		storyId,
		card: CARD,
		displayState: new PluginDisplayState(),
		generation: scheduler,
	});
	onTestFinished(() => session.dispose());
	const queue = session.generation;
	if (queue === null) throw new Error("宿主会话没有生成队列");
	return { store, storyId, session, queue };
}

describe("脚本发起的生成", () => {
	it("按卡限流，拒绝的请求记入 Trace；drain 之后可以继续登记", async () => {
		const scheduler = new StEjsGenerationScheduler({
			run: async () => "后台正文",
			maxPendingPerCard: 1,
		});
		const { session, queue, store, storyId } = openSession(scheduler);
		const before = store.getPathToHead(storyId).map((node) => node.raw);
		const first = await session.api.triggerSlash("/gen 第一条");
		expect(first).toBe("st-ejs-gen-1");
		await expect(session.api.triggerSlash("/gen 第二条")).rejects.toThrow(
			StEjsGenerationLimitError,
		);
		expect(queue.getCounts()).toMatchObject({
			submitted: 1,
			pending: 1,
			rejected: 1,
		});
		expect(queue.trace.at(-1)).toMatchObject({
			kind: "generation",
			command: "gen",
			outcome: "rejected",
		});
		expect(queue.trace.at(-1)?.reason).toContain("已经有 1 条");
		expect(store.getPathToHead(storyId).map((node) => node.raw)).toEqual(
			before,
		);

		await queue.drain();
		expect(queue.getCounts()).toMatchObject({ completed: 1, pending: 0 });
		expect(queue.trace.at(-1)).toMatchObject({
			requestId: first,
			outcome: "completed",
			reason: null,
		});
		expect(await session.api.triggerSlash("/gen 第三条")).toBe("st-ejs-gen-2");
	});

	it("Trace 与计数只统计脚本请求，模板请求留在调度器上", async () => {
		const calls: StEjsGenerationRunnerInput[] = [];
		const scheduler = new StEjsGenerationScheduler({
			run: async (input) => {
				calls.push(input);
				return "后台正文";
			},
		});
		const { session, queue, storyId } = openSession(scheduler);
		const templateId = scheduler.submit({
			storyId,
			cardId: CARD.name,
			nodeId: null,
			prompt: "模板请求",
		});
		const scriptId = await session.api.triggerSlash("/gen 脚本请求");
		expect(queue.getCounts()).toMatchObject({ submitted: 1, pending: 1 });
		expect(scheduler.getCounts(CARD.name)).toMatchObject({
			pending: 2,
			total: 2,
		});
		expect(queue.get(templateId)).toBeNull();

		const drain = await queue.drain();
		expect(drain.runs.map((run) => run.id)).toEqual([scriptId]);
		expect(calls).toEqual([{ prompt: "脚本请求" }]);
		expect(scheduler.get(templateId)?.status).toBe("pending");
		expect(queue.getCounts()).toMatchObject({ completed: 1, pending: 0 });
	});

	it("失败单独记录，读取返回空串", async () => {
		const scheduler = new StEjsGenerationScheduler({
			run: async (input) => {
				if (input.prompt === "坏请求") throw new Error("后台拒答");
				return "好结果";
			},
		});
		const { session, queue } = openSession(scheduler);
		const id = await session.api.triggerSlash("/gen 坏请求");
		await queue.drain();
		expect(queue.get(id)).toMatchObject({
			status: "failed",
			error: "后台拒答",
			text: null,
		});
		expect(queue.getCounts()).toMatchObject({ failed: 1, completed: 0 });
		expect(queue.trace.at(-1)).toMatchObject({
			requestId: id,
			command: "gen",
			outcome: "failed",
			reason: "后台拒答",
		});
		expect(await session.api.triggerSlash(`/genresult ${id}`)).toBe("");
	});

	it("未知请求 id 直接失败", async () => {
		const scheduler = new StEjsGenerationScheduler({
			run: async () => "后台正文",
		});
		const { session } = openSession(scheduler);
		await expect(
			session.api.triggerSlash("/genresult st-ejs-gen-99"),
		).rejects.toThrow("未知的脚本生成请求");
	});

	it("drain 按入队顺序执行，期间新登记的请求留到下一次", async () => {
		const order: string[] = [];
		const scheduler = new StEjsGenerationScheduler({
			run: async (input) => {
				order.push(input.prompt);
				return input.prompt;
			},
		});
		const { session, queue } = openSession(scheduler);
		await session.api.triggerSlash("/gen 一");
		const firstDrain = queue.drain();
		await session.api.triggerSlash("/gen 二");
		await firstDrain;
		expect(order).toEqual(["一"]);
		await queue.drain();
		expect(order).toEqual(["一", "二"]);
	});
});

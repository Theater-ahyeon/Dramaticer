import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginDisplayState, StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
	type StCharacterCard,
	parseCharacterCardJson,
} from "../src/character-card.js";
import {
	type StEjsGenerationRunnerInput,
	StEjsGenerationScheduler,
} from "../src/st-ejs/index.js";
import {
	ST_HELPER_SANDBOX_FULL_PERMISSION,
	type StHelperHostSession,
	StHelperSandboxHost,
	type StHelperSandboxHostMessage,
	createStHelperHostSession,
} from "../src/st-helper-host/index.js";

function card(): StCharacterCard {
	return parseCharacterCardJson(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: { name: "测试角色", description: "", extensions: {} },
		}),
	);
}

interface Harness {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly displayState: PluginDisplayState;
	readonly session: StHelperHostSession;
}

function openHarness(
	options: {
		readonly generation?: StEjsGenerationScheduler;
	} = {},
): Harness {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-st-helper-slash-")),
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
	const storyId = "s-slash";
	store.createStory({ id: storyId, title: "STscript 测试" });
	const opening = store.appendNode({
		id: "n-open",
		storyId,
		parentId: null,
		role: "assistant",
		raw: "开场白",
	});
	const user = store.appendNode({
		id: "n-user",
		storyId,
		parentId: opening.id,
		role: "user",
		raw: "玩家行动",
	});
	store.appendNode({
		id: "n-assistant",
		storyId,
		parentId: user.id,
		role: "assistant",
		raw: "角色回应",
	});
	const displayState = new PluginDisplayState();
	const session = createStHelperHostSession({
		store,
		storyId,
		card: card(),
		displayState,
		userName: "玩家",
		characterName: "测试角色",
		...(options.generation === undefined
			? {}
			: { generation: options.generation }),
	});
	onTestFinished(() => session.dispose());
	return { store, storyId, displayState, session };
}

function lastRaw(harness: Harness): string {
	const path = harness.store.getPathToHead(harness.storyId);
	return path.at(-1)?.raw ?? "";
}

function siblingsOf(harness: Harness, parentId: string) {
	return harness.store
		.listStoryNodes(harness.storyId)
		.filter((node) => node.parentId === parentId);
}

describe("STscript 变量命令", () => {
	it("读写、增删与数值增减落在 chat 作用域", async () => {
		const { session } = openHarness();
		const api = session.api;
		expect(await api.triggerSlash("/setvar key=score 10")).toBe("10");
		expect(api.getVariable("score", { type: "chat" })).toBe("10");
		expect(await api.triggerSlash("/getvar score")).toBe("10");
		expect(await api.triggerSlash("/getvar key=score")).toBe("10");
		expect(await api.triggerSlash("/addvar key=score 5")).toBe("15");
		expect(await api.triggerSlash("/incvar score")).toBe("16");
		expect(await api.triggerSlash("/decvar score")).toBe("15");
		expect(await api.triggerSlash("/flushvar score")).toBe("");
		expect(api.getVariable("score", { type: "chat" })).toBeUndefined();
		expect(await api.triggerSlash("/getvar score")).toBe("");
	});

	it("global 命令与 chat 作用域互不影响，别名可用", async () => {
		const { session } = openHarness();
		const api = session.api;
		expect(await api.triggerSlash("/setglobalvar key=flag on")).toBe("on");
		expect(await api.triggerSlash("/getglobalvar flag")).toBe("on");
		expect(api.getVariable("flag", { type: "global" })).toBe("on");
		expect(api.getVariable("flag", { type: "chat" })).toBeUndefined();
		expect(await api.triggerSlash("/setchatvar key=hp 3")).toBe("3");
		expect(await api.triggerSlash("/getchatvar hp")).toBe("3");
		expect(await api.triggerSlash("/addglobalvar key=count 2")).toBe("2");
		expect(await api.triggerSlash("/decglobalvar count")).toBe("1");
		expect(await api.triggerSlash("/incglobalvar flag")).toBe("on1");
		expect(await api.triggerSlash("/flushglobalvar flag")).toBe("");
		expect(api.getVariable("flag", { type: "global" })).toBeUndefined();
	});
});

describe("STscript 管道与引号", () => {
	it("管道把上一个命令的结果作为下一个命令的参数", async () => {
		const { session } = openHarness();
		const api = session.api;
		expect(await api.triggerSlash("/setvar key=x 1 | /addvar key=x 2")).toBe(
			"3",
		);
		expect(await api.triggerSlash("/pass hello | /echo")).toBe("hello");
		expect(await api.triggerSlash("/getvar x | /pass")).toBe("3");
	});

	it("引号保留空格与管道符，反斜杠转义", async () => {
		const { session } = openHarness();
		const api = session.api;
		expect(await api.triggerSlash('/echo "a | b"')).toBe("a | b");
		expect(await api.triggerSlash('/pass "  hello   world  "')).toBe(
			"  hello   world  ",
		);
		expect(await api.triggerSlash("/pass a\\|b")).toBe("a|b");
		await expect(api.triggerSlash('/echo "没有闭合')).rejects.toThrow(
			"引号没有闭合",
		);
	});
});

describe("STscript 消息命令", () => {
	it("读取消息范围、名字与角色过滤", async () => {
		const { session } = openHarness();
		const api = session.api;
		expect(await api.triggerSlash("/messages 0")).toBe("测试角色: 开场白");
		expect(await api.triggerSlash("/messages names=off 0")).toBe("开场白");
		expect(await api.triggerSlash("/messages 0-1")).toBe(
			"测试角色: 开场白\n玩家: 玩家行动",
		);
		expect(await api.triggerSlash("/messages role=user 0-2")).toBe(
			"玩家: 玩家行动",
		);
	});

	it("addswipe 新建同父楼层并在 switch=on 时切到新 swipe", async () => {
		const harness = openHarness();
		const { session, store, storyId } = harness;
		const api = session.api;
		const original = lastRaw(harness);
		expect(await api.triggerSlash("/addswipe 新版本")).toBe("1");
		expect(lastRaw(harness)).toBe(original);
		expect(siblingsOf(harness, "n-user").map((node) => node.raw)).toEqual([
			"角色回应",
			"新版本",
		]);
		expect(store.getNode("n-assistant")?.raw).toBe("角色回应");
		expect(await api.triggerSlash("/addswipe switch=on 另一版")).toBe("2");
		expect(store.getPathToHead(storyId).at(-1)?.raw).toBe("另一版");
	});

	it("swipe 在兄弟楼层之间循环切换", async () => {
		const { session, store, storyId } = openHarness();
		const api = session.api;
		await api.triggerSlash("/addswipe 新版本");
		await api.triggerSlash("/addswipe switch=on 另一版");
		expect(await api.triggerSlash("/swipe direction=right")).toBe("");
		expect(store.getPathToHead(storyId).at(-1)?.raw).toBe("角色回应");
		expect(await api.triggerSlash("/swipe direction=left")).toBe("");
		expect(store.getPathToHead(storyId).at(-1)?.raw).toBe("另一版");
		expect(await api.triggerSlash("/swipe")).toBe("");
		expect(store.getPathToHead(storyId).at(-1)?.raw).toBe("角色回应");
	});

	it("hide 与 unhide 只改插件显示状态", async () => {
		const { session, displayState, store, storyId } = openHarness();
		const api = session.api;
		const before = store.getPathToHead(storyId).map((node) => node.raw);
		expect(await api.triggerSlash("/hide 1")).toBe("");
		expect(
			displayState.get("n-user", "st-helper-host")?.metadata.is_hidden,
		).toBe(true);
		expect(await api.triggerSlash("/messages 1")).toBe("");
		expect(await api.triggerSlash("/messages hidden=on 1")).toBe(
			"玩家: 玩家行动",
		);
		expect(await api.triggerSlash("/unhide 1")).toBe("");
		expect(
			displayState.get("n-user", "st-helper-host")?.metadata.is_hidden,
		).toBe(false);
		expect(store.getPathToHead(storyId).map((node) => node.raw)).toEqual(
			before,
		);
	});
});

describe("STscript 安静生成", () => {
	it("gen 与 genraw 只登记后台请求，drain 之后用 genresult 读取正文", async () => {
		const calls: StEjsGenerationRunnerInput[] = [];
		const scheduler = new StEjsGenerationScheduler({
			run: async (input) => {
				calls.push(input);
				return `结果:${input.prompt}`;
			},
		});
		const { session } = openHarness({ generation: scheduler });
		const queue = session.generation;
		if (queue === null) throw new Error("缺少脚本生成队列");
		const api = session.api;
		const rawId = await api.triggerSlash(
			"/genraw system=指令 length=64 请回答",
		);
		expect(rawId).toBe("st-ejs-gen-1");
		expect(calls).toHaveLength(0);
		expect(queue.get(rawId)).toMatchObject({
			prompt: "请回答",
			systemPrompt: "指令",
			maxTokens: 64,
			status: "pending",
		});
		expect(await api.triggerSlash(`/genresult ${rawId}`)).toBe("");
		expect(queue.getCounts()).toMatchObject({ submitted: 1, pending: 1 });

		const drain = await queue.drain();
		expect(drain.runs).toEqual([
			expect.objectContaining({
				id: rawId,
				status: "done",
				text: "结果:请回答",
			}),
		]);
		expect(calls).toEqual([
			{ prompt: "请回答", systemPrompt: "指令", maxTokens: 64 },
		]);
		expect(await api.triggerSlash(`/genresult ${rawId}`)).toBe("结果:请回答");

		const second = await api.triggerSlash("/gen 继续");
		expect(second).toBe("st-ejs-gen-2");
		expect(queue.get(second)).toMatchObject({ prompt: "继续" });
		expect(queue.get(second)?.systemPrompt).toBeUndefined();
		expect(queue.get(second)?.maxTokens).toBeUndefined();
		expect(await api.triggerSlash("/gen 再继续 | /genresult")).toBe("");
	});

	it("没有执行者时失败并指出命令名", async () => {
		const { session } = openHarness();
		await expect(session.api.triggerSlash("/gen 内容")).rejects.toThrow(
			/命令 gen 需要宿主接入安静生成/,
		);
		await expect(
			session.api.triggerSlash("/genresult st-ejs-gen-1"),
		).rejects.toThrow(/命令 genresult 需要宿主接入安静生成队列/);
	});
});

describe("STscript 错误", () => {
	it("未知命令、未知参数与非法方向直接失败并指出位置", async () => {
		const { session } = openHarness();
		const api = session.api;
		await expect(api.triggerSlash("/roll 1d20")).rejects.toThrow(
			"STscript 命令 roll 未实现",
		);
		await expect(api.triggerSlash("/messages foo=1 0")).rejects.toThrow(
			"STscript 命令 messages 不支持参数 foo",
		);
		await expect(api.triggerSlash("/swipe direction=up")).rejects.toThrow(
			"direction 非法",
		);
		await expect(api.triggerSlash("/setvar key=x")).rejects.toThrow(
			"需要变量值",
		);
		await expect(api.triggerSlash("echo hi")).rejects.toThrow("必须以 / 开头");
	});
});

describe("沙箱里的 triggerSlash", () => {
	it("异步结果与失败都经 postMessage 回到 iframe", async () => {
		const harness = openHarness();
		const sent: StHelperSandboxHostMessage[] = [];
		const host = new StHelperSandboxHost({
			api: harness.session.api,
			permission: ST_HELPER_SANDBOX_FULL_PERMISSION,
			send: (message) => sent.push(message),
			terminate: () => {},
		});
		onTestFinished(() => host.dispose());
		const execution = host.startScript({ id: "slash", content: "" });

		host.handleMessage({
			type: "st-helper:call",
			execution,
			id: 1,
			name: "triggerSlash",
			args: ["/pass 值"],
		});
		await vi.waitFor(() => {
			expect(sent.at(-1)).toEqual({
				type: "st-helper:result",
				id: 1,
				ok: true,
				value: "值",
			});
		});

		host.handleMessage({
			type: "st-helper:call",
			execution,
			id: 2,
			name: "triggerSlash",
			args: ["/nope x"],
		});
		await vi.waitFor(() => {
			expect(sent.at(-1)).toMatchObject({
				type: "st-helper:result",
				id: 2,
				ok: false,
			});
		});
		expect(host.trace.at(-1)).toMatchObject({
			kind: "execution",
			function: "triggerSlash",
			outcome: "failed",
		});
		expect(host.trace.at(-1)?.reason).toContain("命令 nope 未实现");
	});
});

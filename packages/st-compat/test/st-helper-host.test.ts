import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginDisplayState, StoryStore, readLedger } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type StCharacterCard,
	parseCharacterCardJson,
} from "../src/character-card.js";
import { createStEjsMvuVariableBackend } from "../src/st-content/ejs-pipeline.js";
import { StEjsVariableStore } from "../src/st-ejs/variables.js";
import {
	ST_HELPER_IMPLEMENTED_FUNCTIONS,
	createStHelperHostSession,
	discoverStHelperScripts,
} from "../src/st-helper-host/index.js";

function cardWithScripts(scripts: unknown): StCharacterCard {
	return parseCharacterCardJson(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name: "测试角色",
				description: "",
				extensions: { tavern_helper: { scripts } },
			},
		}),
	);
}

function scriptFixture(overrides: Record<string, unknown> = {}): unknown {
	return {
		id: "script-1",
		name: "状态栏",
		content: "console.log('status')",
		enabled: true,
		type: "script",
		info: "示例脚本",
		button: { enabled: true, buttons: [] },
		data: { owner: "card" },
		...overrides,
	};
}

function openStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-st-helper-host-")),
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
	return store;
}

function seedStory(store: StoryStore): {
	readonly storyId: string;
	readonly openingId: string;
	readonly userId: string;
	readonly assistantId: string;
} {
	const storyId = "s-helper";
	store.createStory({ id: storyId, title: "助手测试" });
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
	const assistant = store.appendNode({
		id: "n-assistant",
		storyId,
		parentId: user.id,
		role: "assistant",
		raw: "角色回应",
	});
	return {
		storyId,
		openingId: opening.id,
		userId: user.id,
		assistantId: assistant.id,
	};
}

function openHost(
	store: StoryStore,
	storyId: string,
	options: {
		readonly card?: StCharacterCard;
		readonly variables?: StEjsVariableStore;
	} = {},
) {
	const displayState = new PluginDisplayState();
	const session = createStHelperHostSession({
		store,
		storyId,
		card: options.card ?? cardWithScripts([]),
		displayState,
		userName: "玩家",
		characterName: "测试角色",
		...(options.variables === undefined
			? {}
			: { variables: options.variables }),
	});
	onTestFinished(() => session.dispose());
	return { session, displayState };
}

describe("酒馆助手脚本库", () => {
	it("读取启用与禁用的卡内脚本并保留元数据", () => {
		const card = cardWithScripts([
			scriptFixture(),
			scriptFixture({ id: "script-2", name: "禁用", enabled: false }),
		]);
		const scripts = discoverStHelperScripts(card);
		expect(scripts).toHaveLength(2);
		expect(scripts[0]).toEqual({
			id: "script-1",
			name: "状态栏",
			content: "console.log('status')",
			enabled: true,
			type: "script",
			info: "示例脚本",
			button: { enabled: true, buttons: [] },
			data: { owner: "card" },
			source: "card",
		});
		expect(scripts[1]?.enabled).toBe(false);
	});

	it("没有扩展时返回空列表", () => {
		const card = parseCharacterCardJson(
			JSON.stringify({
				spec: "chara_card_v2",
				spec_version: "2.0",
				data: { name: "无脚本", description: "" },
			}),
		);
		expect(discoverStHelperScripts(card)).toEqual([]);
	});

	it("重复 id、结构错误与非法字段直接抛错并指出位置", () => {
		expect(() =>
			discoverStHelperScripts(
				cardWithScripts([scriptFixture(), scriptFixture()]),
			),
		).toThrow(/script-1/);
		expect(() => discoverStHelperScripts(cardWithScripts("bad"))).toThrow(
			/tavern_helper\.scripts/,
		);
		expect(() =>
			discoverStHelperScripts(cardWithScripts([scriptFixture({ content: 1 })])),
		).toThrow(/scripts\[0\]\.content/);
		expect(() =>
			discoverStHelperScripts(
				cardWithScripts([scriptFixture({ enabled: "yes" })]),
			),
		).toThrow(/scripts\[0\]\.enabled/);
		expect(() =>
			discoverStHelperScripts(cardWithScripts([scriptFixture({ id: "" })])),
		).toThrow(/scripts\[0\]\.id/);
	});
});

describe("宿主变量 API", () => {
	it("七个变量函数按作用域读写，查询条件与默认作用域与上游一致", () => {
		const store = openStore();
		const { storyId } = seedStory(store);
		const variables = new StEjsVariableStore({
			global: { g: 1 },
			local: { c: 1 },
			initial: { hp: 10 },
			messages: [
				{ id: 0, role: "assistant", variables: { mp: 1 } },
				{ id: 1, role: "user", variables: { turn: 2 } },
			],
		});
		const { session } = openHost(store, storyId, { variables });
		const api = session.api;

		expect(api.getVariables({ type: "global" })).toEqual({ g: 1 });
		expect(api.getVariable("g", { type: "global" })).toBe(1);
		expect(api.getVariables()).toEqual({ turn: 2 });
		expect(api.getVariables({ type: "message", message_id: 0 })).toEqual({
			mp: 1,
		});
		expect(api.getVariables({ type: "message", message_id: 1 })).toEqual({
			turn: 2,
		});

		api.replaceVariables({ g: 2 }, { type: "global" });
		expect(api.getVariables({ type: "global" })).toEqual({ g: 2 });

		api.insertOrAssignVariables({ deep: { a: 1 } }, { type: "global" });
		api.insertOrAssignVariables({ deep: { b: 2 } }, { type: "global" });
		expect(api.getVariables({ type: "global" })).toEqual({
			g: 2,
			deep: { a: 1, b: 2 },
		});

		const updated = api.updateVariablesWith(
			(current) => ({ ...current, count: Number(current.count ?? 0) + 1 }),
			{ type: "global" },
		);
		expect(updated).toEqual({ g: 2, deep: { a: 1, b: 2 }, count: 1 });
		expect(api.getVariable("count", { type: "global" })).toBe(1);

		api.insertOrAssignVariable("deep.a", 3, { type: "global" });
		expect(api.getVariable("deep.a", { type: "global" })).toBe(3);
		api.deleteVariable("deep.a", { type: "global" });
		expect(api.getVariable("deep.a", { type: "global" })).toBeUndefined();

		expect(api.getVariables({ type: "chat" })).toEqual({ c: 1 });
		api.insertOrAssignVariable("c", 2, { type: "chat" });
		expect(api.getVariable("c", { type: "chat" })).toBe(2);

		api.replaceVariables({ theme: "dark" }, { type: "preset" });
		expect(api.getVariables({ type: "preset" })).toEqual({ theme: "dark" });
		api.insertOrAssignVariables({ layout: "wide" }, { type: "script" });
		expect(api.getVariables({ type: "script" })).toEqual({ layout: "wide" });
		expect(api.getVariables({ type: "global" })).not.toHaveProperty("theme");
	});

	it("非法类型、非法 message_id、非对象更新与危险路径直接抛错", () => {
		const store = openStore();
		const { storyId } = seedStory(store);
		const { session } = openHost(store, storyId);
		const api = session.api;

		expect(() => api.getVariables({ type: "unknown" as "global" })).toThrow(
			/type/,
		);
		expect(() =>
			api.getVariables({ type: "message", message_id: 1.5 }),
		).toThrow(/message_id/);
		expect(() =>
			api.updateVariablesWith(() => undefined as never, { type: "global" }),
		).toThrow(/对象/);
		expect(() =>
			api.insertOrAssignVariable("__proto__.polluted", 1, { type: "global" }),
		).toThrow(/__proto__/);
	});
});

describe("宿主事件 API", () => {
	it("on、once、emit、remove、clear 与事件常量", () => {
		const store = openStore();
		const { storyId } = seedStory(store);
		const { session } = openHost(store, storyId);
		const api = session.api;

		expect(api.tavern_events.MESSAGE_RECEIVED).toBe("message_received");
		expect(api.tavern_events.GENERATION_ENDED).toBe("generation_ended");

		const seen: unknown[][] = [];
		const handle = api.eventOn("message_received", (...args) => {
			seen.push(args);
		});
		api.eventEmit("message_received", 1, "正文");
		api.eventEmit("message_received", 2);
		expect(seen).toEqual([[1, "正文"], [2]]);
		handle.stop();
		api.eventEmit("message_received", 3);
		expect(seen).toHaveLength(2);

		let once = 0;
		api.eventOnce("generation_started", () => {
			once += 1;
		});
		api.eventEmit("generation_started");
		api.eventEmit("generation_started");
		expect(once).toBe(1);

		let removed = 0;
		const listener = () => {
			removed += 1;
		};
		api.eventOn("custom", listener);
		api.eventRemoveListener("custom", listener);
		api.eventEmit("custom");
		expect(removed).toBe(0);

		api.eventOn("custom", listener);
		api.eventClearEvent("custom");
		api.eventEmit("custom");
		expect(removed).toBe(0);

		api.eventOn("a", listener);
		api.eventOn("b", listener);
		api.eventClearAll();
		api.eventEmit("a");
		api.eventEmit("b");
		expect(removed).toBe(0);
	});

	it("非法事件名与非法监听器直接抛错", () => {
		const store = openStore();
		const { storyId } = seedStory(store);
		const { session } = openHost(store, storyId);
		const api = session.api;
		expect(() => api.eventOn("", () => undefined)).toThrow(/事件名/);
		expect(() =>
			api.eventOn("x", "not a function" as unknown as () => void),
		).toThrow(/监听器/);
	});
});

describe("宿主消息 API", () => {
	it("按范围、角色与显示状态读取当前路径", () => {
		const store = openStore();
		const { storyId, openingId } = seedStory(store);
		const { session, displayState } = openHost(store, storyId);
		const api = session.api;

		expect(api.getLastMessageId()).toBe(2);
		expect(api.getCurrentMessageId()).toBe(2);
		const all = api.getChatMessages("0-latest");
		expect(all.map((message) => message.message)).toEqual([
			"开场白",
			"玩家行动",
			"角色回应",
		]);
		expect(all[0]).toMatchObject({
			message_id: 0,
			name: "测试角色",
			role: "assistant",
			is_hidden: false,
			swipe_id: 0,
		});
		expect(api.getChatMessages(2).map((message) => message.message)).toEqual([
			"玩家行动",
			"角色回应",
		]);
		expect(
			api.getChatMessages("0-1").map((message) => message.message),
		).toEqual(["开场白", "玩家行动"]);
		expect(
			api
				.getChatMessages("0-latest", { role: "user" })
				.map((message) => message.role),
		).toEqual(["user"]);
		expect(api.getChatMessage(1).message).toBe("玩家行动");
		expect(api.getChatMessages(0)).toEqual([]);

		displayState.set({
			nodeId: openingId,
			plugin: "st-helper-host",
			kind: "metadata",
			values: { is_hidden: true },
		});
		expect(
			api.getChatMessages("0-latest", { hide_state: "hidden" }),
		).toHaveLength(1);
		expect(
			api.getChatMessages("0-latest", { hide_state: "unhidden" }),
		).toHaveLength(2);
	});

	it("改正文生成兄弟楼层，原文不变；只改显示不新建楼层；swipe_id 切换 head", () => {
		const store = openStore();
		const { storyId, userId } = seedStory(store);
		const { session, displayState } = openHost(store, storyId);
		const api = session.api;
		const original = store.getNode(userId);
		expect(original?.raw).toBe("玩家行动");

		api.setChatMessages([{ message_id: 1, message: "新的玩家行动" }]);
		expect(store.getNode(userId)?.raw).toBe("玩家行动");
		expect(store.listStoryNodes(storyId)).toHaveLength(4);
		const rewritten = store.listStoryNodes(storyId).at(-1);
		expect(rewritten?.parentId).toBe("n-open");
		expect(rewritten?.role).toBe("user");
		expect(rewritten?.raw).toBe("新的玩家行动");
		expect(
			api.getChatMessages("0-latest").map((message) => message.message),
		).toEqual(["开场白", "新的玩家行动"]);
		const userMessage = api.getChatMessage(1, { include_swipes: true });
		expect(userMessage.swipes).toEqual(["玩家行动", "新的玩家行动"]);
		expect(userMessage.swipe_id).toBe(1);

		api.setChatMessages([{ message_id: 1, swipe_id: 0 }]);
		expect(
			api.getChatMessages("0-latest").map((message) => message.message),
		).toEqual(["开场白", "玩家行动"]);

		const before = store.listStoryNodes(storyId).length;
		api.setChatMessages([{ message_id: 0, is_hidden: true }]);
		expect(store.listStoryNodes(storyId)).toHaveLength(before);
		expect(store.getNode("n-open")?.raw).toBe("开场白");
		expect(
			displayState.get("n-open", "st-helper-host")?.metadata.is_hidden,
		).toBe(true);
		expect(api.getChatMessage(0).is_hidden).toBe(true);
	});

	it("相同正文不生成新楼层，未知消息与非法更新直接抛错", () => {
		const store = openStore();
		const { storyId } = seedStory(store);
		const { session } = openHost(store, storyId);
		const api = session.api;
		const before = store.listStoryNodes(storyId).length;
		api.setChatMessages([{ message_id: 2, message: "角色回应" }]);
		expect(store.listStoryNodes(storyId)).toHaveLength(before);
		expect(() =>
			api.setChatMessages([{ message_id: 9, message: "x" }]),
		).toThrow(/9/);
		expect(() => api.setChatMessages([{ message_id: 1, message: "" }])).toThrow(
			/新正文/,
		);
	});
});

describe("宿主台账写入", () => {
	it("character 作用域经 EJS 台账后端写成 mvu 事实", () => {
		const store = openStore();
		const { storyId, assistantId } = seedStory(store);
		const backend = createStEjsMvuVariableBackend({
			store,
			storyId,
			nodeId: assistantId,
			initial: {},
		});
		const variables = new StEjsVariableStore({}, { backend });
		const { session } = openHost(store, storyId, { variables });
		session.api.insertOrAssignVariable("hp", 7, { type: "character" });
		expect(readLedger(store, assistantId, ["mvu"])).toEqual({ hp: 7 });
		expect(() =>
			session.api.insertOrAssignVariable("__proto__", 1, {
				type: "character",
			}),
		).toThrow(/__proto__/);
	});
});

describe("API 覆盖清单", () => {
	it("会话对象实现清单里的全部函数", () => {
		const store = openStore();
		const { storyId } = seedStory(store);
		const { session } = openHost(store, storyId);
		const api = session.api as unknown as Record<string, unknown>;
		for (const name of ST_HELPER_IMPLEMENTED_FUNCTIONS) {
			expect(typeof api[name], name).toBe("function");
		}
	});
});

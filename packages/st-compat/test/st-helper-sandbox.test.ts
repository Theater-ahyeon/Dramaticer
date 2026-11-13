import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginDisplayState, StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type StCharacterCard,
	parseCharacterCardJson,
} from "../src/character-card.js";
import {
	ST_HELPER_SANDBOX_FULL_PERMISSION,
	type StHelperHostSession,
	StHelperSandboxHost,
	type StHelperSandboxHostMessage,
	type StHelperSandboxPermission,
	createStHelperHostSession,
	parseStHelperSandboxPermission,
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

function openStore(): { readonly store: StoryStore; readonly storyId: string } {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-st-helper-sandbox-")),
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
	const storyId = "s-sandbox";
	store.createStory({ id: storyId, title: "沙箱测试" });
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
	return { store, storyId };
}

interface Harness {
	readonly host: StHelperSandboxHost;
	readonly sent: StHelperSandboxHostMessage[];
	readonly terminated: {
		readonly execution: string;
		readonly reason: string;
	}[];
	readonly session: StHelperHostSession;
}

function openHarness(
	permission: StHelperSandboxPermission,
	options: {
		readonly now?: () => number;
		readonly scriptTimeoutMs?: number;
	} = {},
): Harness {
	const { store, storyId } = openStore();
	const session = createStHelperHostSession({
		store,
		storyId,
		card: card(),
		displayState: new PluginDisplayState(),
		userName: "玩家",
		characterName: "测试角色",
	});
	onTestFinished(() => session.dispose());
	const sent: StHelperSandboxHostMessage[] = [];
	const terminated: { execution: string; reason: string }[] = [];
	const host = new StHelperSandboxHost({
		api: session.api,
		permission,
		send: (message) => sent.push(message),
		terminate: (execution, reason) => terminated.push({ execution, reason }),
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.scriptTimeoutMs === undefined
			? {}
			: { scriptTimeoutMs: options.scriptTimeoutMs }),
	});
	onTestFinished(() => host.dispose());
	return { host, sent, terminated, session };
}

function calls(
	host: StHelperSandboxHost,
	execution: string,
	name: string,
	args: unknown[],
): void {
	host.handleMessage({
		type: "st-helper:call",
		execution,
		id: 1,
		name,
		args,
	});
}

describe("沙箱权限声明", () => {
	it("全量声明覆盖已实现函数", () => {
		const parsed = parseStHelperSandboxPermission({
			kind: "st-helper",
			apis: ST_HELPER_SANDBOX_FULL_PERMISSION.apis,
		});
		expect(parsed.apis).toEqual(ST_HELPER_SANDBOX_FULL_PERMISSION.apis);
	});

	it("拒绝未知函数、重复函数与错误类型", () => {
		expect(() =>
			parseStHelperSandboxPermission({
				kind: "st-helper",
				apis: ["getVariables", "notAHostFunction"],
			}),
		).toThrow("permission.apis[1] 不是已实现的宿主 API");
		expect(() =>
			parseStHelperSandboxPermission({
				kind: "st-helper",
				apis: ["getVariables", "getVariables"],
			}),
		).toThrow("permission.apis[1] 重复");
		expect(() =>
			parseStHelperSandboxPermission({ kind: "st-helper", apis: "all" }),
		).toThrow("permission.apis 必须是数组");
		expect(() =>
			parseStHelperSandboxPermission({
				kind: "st-helper",
				apis: ["updateVariablesWith"],
			}),
		).toThrow("必须同时声明 getVariables");
		expect(() =>
			parseStHelperSandboxPermission({
				kind: "st-helper",
				apis: ["eventOnce"],
			}),
		).toThrow("必须同时声明 eventOn");
	});
});

describe("沙箱宿主调用", () => {
	it("执行消息只带声明过的 API，未声明的调用被拒绝并记录", () => {
		const harness = openHarness({
			kind: "st-helper",
			apis: ["getVariables", "getChatMessage"],
		});
		const execution = harness.host.startScript({
			id: "script-1",
			content: "console.log('hi')",
		});
		const run = harness.sent[0];
		expect(run?.type).toBe("st-helper:run");
		if (run?.type === "st-helper:run") {
			expect(run.functions).toEqual(["getVariables", "getChatMessage"]);
			expect(run.events.MESSAGE_SENT).toBe("message_sent");
		}

		calls(harness.host, execution, "getChatMessage", [1]);
		const allowed = harness.sent[1];
		expect(allowed).toMatchObject({ type: "st-helper:result", ok: true });
		if (allowed?.type === "st-helper:result") {
			expect(allowed.value).toMatchObject({
				message_id: 1,
				message: "玩家行动",
			});
		}

		calls(harness.host, execution, "setChatMessages", [
			{ message_id: 1, message: "改写" },
		]);
		const denied = harness.sent[2];
		expect(denied).toMatchObject({
			type: "st-helper:result",
			ok: false,
		});
		if (denied?.type === "st-helper:result") {
			expect(denied.error).toContain("没有声明调用 setChatMessages 的权限");
		}
		expect(harness.sent).toHaveLength(3);
		expect(harness.host.trace).toContainEqual(
			expect.objectContaining({
				kind: "permission",
				function: "setChatMessages",
				outcome: "denied",
			}),
		);
	});

	it("事件监听跨 iframe 转发，一次性监听只回调一次", () => {
		const harness = openHarness({
			kind: "st-helper",
			apis: ["eventOn", "eventOnce", "eventEmit", "eventRemoveListener"],
		});
		const execution = harness.host.startScript({ id: "script-2", content: "" });

		calls(harness.host, execution, "eventOn", ["custom", 7, { once: false }]);
		calls(harness.host, execution, "eventOnce", ["custom", 8]);
		calls(harness.host, execution, "eventEmit", ["custom", "值"]);

		const events = harness.sent.filter(
			(message) => message.type === "st-helper:event",
		);
		expect(events).toEqual([
			{ type: "st-helper:event", token: 7, args: ["值"], once: false },
			{ type: "st-helper:event", token: 8, args: ["值"], once: true },
		]);

		calls(harness.host, execution, "eventEmit", ["custom", 2]);
		const later = harness.sent.filter(
			(message) => message.type === "st-helper:event",
		);
		expect(later).toHaveLength(3);
		expect(later[2]).toMatchObject({ token: 7 });

		calls(harness.host, execution, "eventRemoveListener", ["custom", 7]);
		calls(harness.host, execution, "eventEmit", ["custom", 3]);
		expect(
			harness.sent.filter((message) => message.type === "st-helper:event"),
		).toHaveLength(3);
	});

	it("清空事件时通知 iframe 丢掉本地监听器", () => {
		const harness = openHarness({
			kind: "st-helper",
			apis: ["eventOn", "eventClearEvent", "eventClearAll"],
		});
		const execution = harness.host.startScript({ id: "script-3", content: "" });
		calls(harness.host, execution, "eventOn", ["a", 1, { once: false }]);
		calls(harness.host, execution, "eventClearEvent", ["a"]);
		expect(
			harness.sent.filter((message) => message.type === "st-helper:clear"),
		).toEqual([{ type: "st-helper:clear", event: "a" }]);
		calls(harness.host, execution, "eventClearAll", []);
		expect(
			harness.sent.filter((message) => message.type === "st-helper:clear"),
		).toEqual([
			{ type: "st-helper:clear", event: "a" },
			{ type: "st-helper:clear", event: null },
		]);
	});

	it("非法消息与已结束执行的调用写进协议记录", () => {
		const harness = openHarness(ST_HELPER_SANDBOX_FULL_PERMISSION);
		harness.host.handleMessage({
			type: "st-helper:call",
			execution: "missing",
			id: -1,
			name: "getVariables",
			args: [],
		});
		expect(harness.host.trace.at(-1)).toMatchObject({
			kind: "protocol",
			outcome: "rejected",
		});
		harness.host.handleMessage({
			type: "st-helper:done",
			execution: "missing",
			ok: true,
		});
		expect(harness.host.trace.at(-1)).toMatchObject({
			kind: "protocol",
			outcome: "rejected",
		});
	});
});

describe("沙箱执行超时", () => {
	it("超时终止后宿主可以继续执行下一次脚本", () => {
		let clock = 1_000;
		const harness = openHarness(ST_HELPER_SANDBOX_FULL_PERMISSION, {
			now: () => clock,
			scriptTimeoutMs: 5_000,
		});
		const first = harness.host.startScript({
			id: "loop",
			content: "while (true) {}",
		});
		calls(harness.host, first, "eventOn", ["custom", 3, { once: false }]);

		clock += 5_000;
		expect(harness.host.sweepTimeouts()).toEqual([first]);
		harness.session.events.emit("custom", "迟到的事件");
		expect(
			harness.sent.filter((message) => message.type === "st-helper:event"),
		).toHaveLength(0);
		expect(harness.terminated).toEqual([
			expect.objectContaining({ execution: first }),
		]);
		expect(harness.host.trace.at(-1)).toMatchObject({
			kind: "timeout",
			execution: first,
			scriptId: "loop",
			outcome: "terminated",
		});
		expect(harness.host.trace.at(-1)?.reason).toContain("已终止");

		calls(harness.host, first, "getVariables", []);
		expect(harness.sent.at(-1)).toMatchObject({
			type: "st-helper:result",
			ok: false,
		});

		clock += 1;
		const second = harness.host.startScript({ id: "next", content: "" });
		calls(harness.host, second, "getVariables", []);
		expect(harness.sent.at(-1)).toMatchObject({
			type: "st-helper:result",
			ok: true,
		});
		harness.host.handleMessage({
			type: "st-helper:done",
			execution: second,
			ok: true,
		});
		expect(harness.host.trace.at(-1)).toMatchObject({
			kind: "execution",
			execution: second,
			scriptId: "next",
			outcome: "completed",
		});
	});
});

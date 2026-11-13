import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginDisplayState, StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type StCharacterCard,
	parseCharacterCardJson,
} from "../src/character-card.js";
import {
	ST_HELPER_HTML_PLUGIN_ID,
	ST_HELPER_SANDBOX_FULL_PERMISSION,
	type StHelperHostSession,
	StHelperSandboxHost,
	type StHelperSandboxRenderOutcome,
	createStHelperHostSession,
	extractStHelperHtmlFragments,
	readStHelperHtmlPage,
} from "../src/st-helper-host/index.js";

const STATUS_BAR_HTML = '<div id="bar">生命 10</div>';
const OPENING_HTML =
	'<style>#title { color: red; }</style><div id="title">开场</div><script>await getVariable("hp");</script>';

function card(): StCharacterCard {
	return parseCharacterCardJson(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name: "测试角色",
				description: "",
				first_mes: OPENING_HTML,
				extensions: {
					tavern_helper: {
						scripts: [
							{
								id: "script-1",
								name: "状态栏刷新",
								content: "await insertOrAssignVariable('hp', 10)",
								enabled: true,
								type: "script",
							},
							{
								id: "script-2",
								name: "禁用脚本",
								content: "throw new Error('不应执行')",
								enabled: false,
								type: "script",
							},
							{
								id: "button-1",
								name: "按钮",
								content: "throw new Error('不是脚本')",
								enabled: true,
								type: "button",
							},
						],
					},
				},
			},
		}),
	);
}

interface Harness {
	readonly store: StoryStore;
	readonly displayState: PluginDisplayState;
	readonly barId: string;
	readonly openingId: string;
	readonly requests: Array<{
		readonly page: string;
		readonly nodeId: string;
		readonly html: string;
		readonly scripts: readonly string[];
	}>;
	readonly session: StHelperHostSession;
}

function openHarness(
	options: { readonly maxAutoRefreshes?: number } = {},
): Harness {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-st-helper-html-")),
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
	const storyId = "s-html";
	store.createStory({ id: storyId, title: "HTML 测试" });
	const opening = store.appendNode({
		id: "n-open",
		storyId,
		parentId: null,
		role: "assistant",
		raw: OPENING_HTML,
	});
	store.appendNode({
		id: "n-user",
		storyId,
		parentId: opening.id,
		role: "user",
		raw: "玩家行动",
	});
	const bar = store.appendNode({
		id: "n-bar",
		storyId,
		parentId: "n-user",
		role: "assistant",
		raw: `身体状态如下。\n\n\`\`\`html\n${STATUS_BAR_HTML}\n\`\`\``,
	});
	const displayState = new PluginDisplayState();
	const requests: Harness["requests"] = [];
	let counter = 0;
	const session = createStHelperHostSession({
		store,
		storyId,
		card: card(),
		displayState,
		html: {
			start: (request) => {
				requests.push({ ...request, scripts: [...request.scripts] });
				return `render-${++counter}`;
			},
			...(options.maxAutoRefreshes === undefined
				? {}
				: { maxAutoRefreshes: options.maxAutoRefreshes }),
		},
	});
	onTestFinished(() => session.dispose());
	return {
		store,
		displayState,
		barId: bar.id,
		openingId: opening.id,
		requests,
		session,
	};
}

describe("HTML 片段提取", () => {
	it("认识 html 围栏、完整文档与整段正文", () => {
		expect(
			extractStHelperHtmlFragments("说明\n```HTML\n<div>a</div>\n```"),
		).toEqual([{ kind: "fenced", html: "<div>a</div>" }]);
		expect(
			extractStHelperHtmlFragments(
				"<!doctype html>\n<html><body><div>b</div></body></html>\n之后",
			),
		).toEqual([
			{
				kind: "document",
				html: "<html><body><div>b</div></body></html>",
			},
		]);
		expect(extractStHelperHtmlFragments("  <div>c</div>  ")).toEqual([
			{ kind: "message", html: "<div>c</div>" },
		]);
	});

	it("普通正文与其他围栏不算 HTML", () => {
		expect(extractStHelperHtmlFragments("今天天气不错。")).toEqual([]);
		expect(
			extractStHelperHtmlFragments("代码\n```js\nconsole.log(1)\n```"),
		).toEqual([]);
		expect(extractStHelperHtmlFragments("<微笑> 你来了")).toEqual([]);
	});
});

describe("状态栏渲染", () => {
	it("提取楼层 HTML、带上启用脚本，快照只写显示状态", () => {
		const harness = openHarness();
		const renderer = harness.session.html;
		expect(renderer).not.toBeNull();
		if (renderer === null) return;
		const rawBefore = harness.store.getNode(harness.barId)?.raw;

		const renderId = renderer.renderStatusBar(harness.barId);
		expect(renderId).toBe("render-1");
		expect(harness.requests).toEqual([
			{
				page: "statusBar",
				nodeId: harness.barId,
				html: STATUS_BAR_HTML,
				scripts: ["await insertOrAssignVariable('hp', 10)"],
			},
		]);
		expect(
			readStHelperHtmlPage(harness.displayState, harness.barId, "statusBar"),
		).toBeNull();

		renderer.complete("render-1", '<div id="bar">生命 8</div>');
		expect(
			readStHelperHtmlPage(harness.displayState, harness.barId, "statusBar"),
		).toBe('<div id="bar">生命 8</div>');
		expect(
			harness.displayState.get(harness.barId, ST_HELPER_HTML_PLUGIN_ID),
		).toEqual({
			display: { statusBar: '<div id="bar">生命 8</div>' },
			metadata: {},
		});
		expect(harness.store.getNode(harness.barId)?.raw).toBe(rawBefore);
		expect(harness.store.getStateDiffs(harness.barId)).toEqual([]);
		expect(renderer.trace.at(-1)).toMatchObject({
			kind: "render",
			page: "statusBar",
			renderId: "render-1",
			outcome: "completed",
		});
	});

	it("没有 HTML 载体时不发起渲染", () => {
		const harness = openHarness();
		const renderer = harness.session.html;
		if (renderer === null) throw new Error("缺少渲染器");
		expect(renderer.renderStatusBar("n-user")).toBeNull();
		expect(harness.requests).toHaveLength(0);
	});

	it("变量写入后重新渲染状态栏，进行中的写入合并成一次", () => {
		const harness = openHarness();
		const renderer = harness.session.html;
		if (renderer === null) throw new Error("缺少渲染器");

		expect(renderer.renderStatusBar(harness.barId)).toBe("render-1");
		renderer.complete("render-1", "<div>一次</div>");

		harness.session.api.insertOrAssignVariable("hp", 9);
		expect(harness.requests).toHaveLength(2);
		expect(harness.requests[1]?.page).toBe("statusBar");

		harness.session.api.insertOrAssignVariable("hp", 8);
		harness.session.api.insertOrAssignVariable("hp", 7);
		expect(harness.requests).toHaveLength(2);

		renderer.complete("render-2", "<div>二次</div>");
		expect(harness.requests).toHaveLength(3);
		expect(
			readStHelperHtmlPage(harness.displayState, harness.barId, "statusBar"),
		).toBe("<div>二次</div>");

		renderer.complete("render-3", "<div>三次</div>");
		expect(harness.requests).toHaveLength(3);
	});

	it("自动刷新超过上限后停止并记录", () => {
		const harness = openHarness({ maxAutoRefreshes: 1 });
		const renderer = harness.session.html;
		if (renderer === null) throw new Error("缺少渲染器");
		renderer.renderStatusBar(harness.barId);
		renderer.complete("render-1", "<div>一次</div>");
		harness.session.api.insertOrAssignVariable("hp", 2);
		renderer.complete("render-2", "<div>二次</div>");
		harness.session.api.insertOrAssignVariable("hp", 3);
		expect(harness.requests).toHaveLength(2);
		expect(renderer.trace.at(-1)).toMatchObject({
			kind: "render",
			outcome: "rejected",
		});
		expect(renderer.trace.at(-1)?.reason).toContain("自动刷新超过 1 次");
	});
});

describe("开场页渲染", () => {
	it("用角色卡开场白开始渲染，快照进显示状态且原文不变", () => {
		const harness = openHarness();
		const renderer = harness.session.html;
		if (renderer === null) throw new Error("缺少渲染器");
		const rawBefore = harness.store.getNode(harness.openingId)?.raw;

		const renderId = renderer.renderOpeningPage(harness.openingId);
		expect(renderId).toBe("render-1");
		expect(harness.requests[0]).toMatchObject({
			page: "openingPage",
			nodeId: harness.openingId,
			html: OPENING_HTML,
		});
		renderer.complete("render-1", '<div id="title">开场</div>');
		expect(
			readStHelperHtmlPage(
				harness.displayState,
				harness.openingId,
				"openingPage",
			),
		).toBe('<div id="title">开场</div>');
		expect(
			readStHelperHtmlPage(
				harness.displayState,
				harness.openingId,
				"statusBar",
			),
		).toBeNull();
		expect(harness.store.getNode(harness.openingId)?.raw).toBe(rawBefore);
		expect(harness.store.getStateDiffs(harness.openingId)).toEqual([]);
	});

	it("未知渲染 id、空快照与不存在的楼层直接失败", () => {
		const harness = openHarness();
		const renderer = harness.session.html;
		if (renderer === null) throw new Error("缺少渲染器");
		expect(() => renderer.complete("missing", "<div></div>")).toThrow(
			"未知的渲染请求",
		);
		renderer.renderStatusBar(harness.barId);
		expect(() => renderer.complete("render-1", "")).toThrow("渲染结果不能为空");
		expect(() => renderer.renderStatusBar("n-missing")).toThrow(
			"渲染的目标楼层不存在",
		);
	});
});

describe("沙箱渲染协议", () => {
	it("渲染消息带 HTML 与脚本，快照回调按渲染 id 对齐", () => {
		const harness = openHarness();
		const sent: unknown[] = [];
		const outcomes: StHelperSandboxRenderOutcome[] = [];
		const terminated: string[] = [];
		const host = new StHelperSandboxHost({
			api: harness.session.api,
			permission: ST_HELPER_SANDBOX_FULL_PERMISSION,
			send: (message) => sent.push(message),
			terminate: (execution) => terminated.push(execution),
			onRender: (outcome) => outcomes.push(outcome),
		});
		onTestFinished(() => host.dispose());

		const render = host.startRender({
			label: "statusBar:n-bar",
			html: STATUS_BAR_HTML,
			scripts: ["await getVariable('hp')"],
		});
		expect(sent).toEqual([
			{
				type: "st-helper:render",
				render,
				label: "statusBar:n-bar",
				html: STATUS_BAR_HTML,
				scripts: ["await getVariable('hp')"],
			},
		]);
		host.handleMessage({
			type: "st-helper:rendered",
			render,
			ok: true,
			html: '<div id="bar">生命 9</div>',
		});
		expect(outcomes).toEqual([
			{
				render,
				label: "statusBar:n-bar",
				ok: true,
				html: '<div id="bar">生命 9</div>',
				error: null,
				durationMs: expect.any(Number),
			},
		]);
		expect(host.trace.at(-1)).toMatchObject({
			kind: "render",
			execution: render,
			outcome: "completed",
		});
		host.handleMessage({
			type: "st-helper:rendered",
			render,
			ok: true,
			html: "<div>迟到</div>",
		});
		expect(host.trace.at(-1)).toMatchObject({
			kind: "protocol",
			outcome: "rejected",
		});
		expect(terminated).toEqual([]);
	});

	it("渲染超时终止 iframe 并回调失败", () => {
		const harness = openHarness();
		let clock = 1_000;
		const outcomes: StHelperSandboxRenderOutcome[] = [];
		const terminated: string[] = [];
		const host = new StHelperSandboxHost({
			api: harness.session.api,
			permission: ST_HELPER_SANDBOX_FULL_PERMISSION,
			send: () => {},
			terminate: (execution, reason) =>
				terminated.push(`${execution}:${reason}`),
			onRender: (outcome) => outcomes.push(outcome),
			now: () => clock,
			scriptTimeoutMs: 1_000,
		});
		onTestFinished(() => host.dispose());
		const render = host.startRender({
			label: "openingPage:n-open",
			html: OPENING_HTML,
		});
		clock += 1_000;
		expect(host.sweepTimeouts()).toEqual([render]);
		expect(terminated[0]).toContain(
			"渲染 openingPage:n-open 执行超过 1000 毫秒",
		);
		expect(outcomes[0]).toMatchObject({
			render,
			ok: false,
			html: null,
			error: expect.stringContaining("已终止"),
		});
	});
});

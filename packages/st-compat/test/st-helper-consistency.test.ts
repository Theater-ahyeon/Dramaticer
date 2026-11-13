import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginDisplayState, StoryStore, readLedger } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	type StCharacterCard,
	parseCharacterCardJson,
} from "../src/character-card.js";
import { createStEjsMvuVariableBackend } from "../src/st-content/ejs-pipeline.js";
import { StEjsGenerationScheduler } from "../src/st-ejs/generation.js";
import { StEjsVariableStore } from "../src/st-ejs/variables.js";
import {
	ST_HELPER_IMPLEMENTED_FUNCTIONS,
	ST_HELPER_SANDBOX_FULL_PERMISSION,
	type StHelperHostSession,
	StHelperHtmlRenderer,
	type StHelperRenderRequest,
	StHelperSandboxHost,
	type StHelperSandboxHostMessage,
	type StHelperSandboxPermission,
	createStHelperHostSession,
	readStHelperHtmlPage,
	summarizeStHelperCoverage,
} from "../src/st-helper-host/index.js";

const STORY_ID = "s-helper-consistency";

const CARD = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "测试角色",
			description: "",
			first_mes: "开场白",
			extensions: {},
		},
	}),
);

function cardWithScripts(scripts: readonly unknown[]): StCharacterCard {
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

function defaultVariables(): StEjsVariableStore {
	return new StEjsVariableStore({
		global: { g: 1 },
		local: { c: 1 },
		initial: { hp: 10 },
		messages: [
			{ id: 0, role: "assistant", variables: { mp: 1 } },
			{ id: 1, role: "user", variables: { turn: 2 } },
		],
	});
}

interface HostContext {
	readonly dir: string;
	readonly store: StoryStore;
	readonly storyId: string;
	readonly displayState: PluginDisplayState;
	readonly session: StHelperHostSession;
	readonly nodeIds: {
		readonly opening: string;
		readonly user: string;
		readonly assistant: string;
	};
}

interface HostOptions {
	readonly card?: StCharacterCard;
	readonly variables?: StEjsVariableStore;
	readonly ledgerNodeId?: string;
	readonly generation?: StEjsGenerationScheduler;
}

function openContext(options: HostOptions = {}): HostContext {
	const dir = mkdtempSync(
		join(import.meta.dirname, ".tmp-st-helper-consistency-"),
	);
	const store = StoryStore.open(join(dir, "story.db"));
	store.createStory({ id: STORY_ID, title: "一致性用例" });
	const opening = store.appendNode({
		id: "n-open",
		storyId: STORY_ID,
		parentId: null,
		role: "assistant",
		raw: "开场白",
	});
	const user = store.appendNode({
		id: "n-user",
		storyId: STORY_ID,
		parentId: opening.id,
		role: "user",
		raw: "玩家行动",
	});
	const assistant = store.appendNode({
		id: "n-assistant",
		storyId: STORY_ID,
		parentId: user.id,
		role: "assistant",
		raw: "角色回应",
	});
	const displayState = new PluginDisplayState();
	const variables =
		options.ledgerNodeId === undefined
			? (options.variables ?? defaultVariables())
			: new StEjsVariableStore(
					{},
					{
						backend: createStEjsMvuVariableBackend({
							store,
							storyId: STORY_ID,
							nodeId: options.ledgerNodeId,
							initial: {},
						}),
					},
				);
	const session = createStHelperHostSession({
		store,
		storyId: STORY_ID,
		card: options.card ?? CARD,
		displayState,
		variables,
		userName: "玩家",
		characterName: "测试角色",
		...(options.generation === undefined
			? {}
			: { generation: options.generation }),
	});
	return {
		dir,
		store,
		storyId: STORY_ID,
		displayState,
		session,
		nodeIds: { opening: opening.id, user: user.id, assistant: assistant.id },
	};
}

function closeContext(context: HostContext): void {
	context.session.dispose();
	context.store.close();
	rmSync(context.dir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 50,
	});
}

interface ConsistencyCase {
	readonly name: string;
	readonly source:
		| "变量"
		| "事件"
		| "消息"
		| "STscript"
		| "沙箱"
		| "状态栏"
		| "脚本库";
	/** 上游公开类型定义记录的行为；实现按该行为独立编写。 */
	readonly doc: string;
	/** 本行验证的已实现函数。 */
	readonly covers: readonly string[];
	readonly open?: () => HostContext;
	readonly run: (context: HostContext) => string | Promise<string>;
	readonly expected: string;
}

const CASES: readonly ConsistencyCase[] = [
	{
		name: "getVariables 缺省读取最新消息楼层的变量",
		source: "变量",
		doc: "酒馆助手 `getVariables(option)`：`message` 作用域缺省读最新楼层",
		covers: ["getVariables"],
		run: ({ session }) => String(session.api.getVariables().turn),
		expected: "2",
	},
	{
		name: "getVariables 按 message_id 读取指定楼层",
		source: "变量",
		doc: "酒馆助手 `getVariables(option)`：`message_id` 指定楼层",
		covers: ["getVariables"],
		run: ({ session }) =>
			String(session.api.getVariables({ type: "message", message_id: 0 }).mp),
		expected: "1",
	},
	{
		name: "replaceVariables 整表替换作用域",
		source: "变量",
		doc: "酒馆助手 `replaceVariables(variables, option)`：完全替换变量表",
		covers: ["replaceVariables"],
		run: ({ session }) => {
			session.api.replaceVariables({ g: 2 }, { type: "global" });
			return String(session.api.getVariables({ type: "global" }).g);
		},
		expected: "2",
	},
	{
		name: "insertOrAssignVariables 递归合并对象",
		source: "变量",
		doc: "酒馆助手 `insertOrAssignVariables`：已存在的对象按键合并",
		covers: ["insertOrAssignVariables"],
		run: ({ session }) => {
			session.api.insertOrAssignVariables(
				{ deep: { a: 1 } },
				{ type: "global" },
			);
			session.api.insertOrAssignVariables(
				{ deep: { b: 2 } },
				{ type: "global" },
			);
			return JSON.stringify(session.api.getVariables({ type: "global" }).deep);
		},
		expected: '{"a":1,"b":2}',
	},
	{
		name: "updateVariablesWith 返回更新后的变量表",
		source: "变量",
		doc: "酒馆助手 `updateVariablesWith`：用返回值替换变量表并返回新表",
		covers: ["updateVariablesWith"],
		run: ({ session }) => {
			const updated = session.api.updateVariablesWith(
				(current) => ({ count: Number(current.count ?? 0) + 1 }),
				{ type: "script" },
			);
			return String(updated.count);
		},
		expected: "1",
	},
	{
		name: "deleteVariable 删除路径后读到 undefined",
		source: "变量",
		doc: "酒馆助手 `deleteVariable(path, option)`：按路径删除变量",
		covers: ["deleteVariable"],
		run: ({ session }) => {
			session.api.deleteVariable("g", { type: "global" });
			return String(session.api.getVariables({ type: "global" }).g);
		},
		expected: "undefined",
	},
	{
		name: "getVariable 读取嵌套路径（扩展名）",
		source: "变量",
		doc: "按路径读取变量；4.8.10 的公开类型定义未声明，保留自更早版本",
		covers: ["getVariable"],
		run: ({ session }) => {
			session.api.insertOrAssignVariables(
				{ deep: { a: 3 } },
				{ type: "global" },
			);
			return String(session.api.getVariable("deep.a", { type: "global" }));
		},
		expected: "3",
	},
	{
		name: "insertOrAssignVariable 写入嵌套路径（扩展名）",
		source: "变量",
		doc: "按路径写入变量；4.8.10 的公开类型定义未声明，保留自更早版本",
		covers: ["insertOrAssignVariable"],
		run: ({ session }) => {
			session.api.insertOrAssignVariable("deep.a", 3, { type: "global" });
			return String(session.api.getVariable("deep.a", { type: "global" }));
		},
		expected: "3",
	},
	{
		name: "character 作用域经结算器写成 mvu 事实",
		source: "变量",
		doc: "酒馆助手 `insertOrAssignVariable(..., { type: 'character' })`；本实现落台账 mvu 并经过结算器（I12）",
		covers: ["insertOrAssignVariable"],
		open: () => openContext({ ledgerNodeId: "n-assistant" }),
		run: ({ session, store, nodeIds }) => {
			session.api.insertOrAssignVariable("hp", 7, { type: "character" });
			return JSON.stringify(readLedger(store, nodeIds.assistant, ["mvu"]));
		},
		expected: '{"hp":7}',
	},
	{
		name: "eventOn 返回的句柄 stop 后不再收到事件",
		source: "事件",
		doc: "酒馆助手 `eventOn`：返回可停止的句柄",
		covers: ["eventOn"],
		run: ({ session }) => {
			let count = 0;
			const handle = session.api.eventOn("message_received", () => {
				count += 1;
			});
			session.api.eventEmit("message_received");
			handle.stop();
			session.api.eventEmit("message_received");
			return String(count);
		},
		expected: "1",
	},
	{
		name: "eventOnce 只触发一次",
		source: "事件",
		doc: "酒馆助手 `eventOnce`：监听器触发一次后移除",
		covers: ["eventOnce"],
		run: ({ session }) => {
			let count = 0;
			session.api.eventOnce("generation_started", () => {
				count += 1;
			});
			session.api.eventEmit("generation_started");
			session.api.eventEmit("generation_started");
			return String(count);
		},
		expected: "1",
	},
	{
		name: "eventEmit 把参数原样传给监听器",
		source: "事件",
		doc: "酒馆助手 `eventEmit(type, ...args)`：参数原样转发",
		covers: ["eventEmit"],
		run: ({ session }) => {
			const seen: unknown[] = [];
			session.api.eventOn("custom", (...args) => {
				seen.push(...args);
			});
			session.api.eventEmit("custom", 1, "正文");
			return seen.join("|");
		},
		expected: "1|正文",
	},
	{
		name: "eventRemoveListener 只移除指定监听器",
		source: "事件",
		doc: "酒馆助手 `eventRemoveListener(type, listener)`：按引用移除",
		covers: ["eventRemoveListener"],
		run: ({ session }) => {
			let first = 0;
			let second = 0;
			const listener = () => {
				first += 1;
			};
			session.api.eventOn("custom", listener);
			session.api.eventOn("custom", () => {
				second += 1;
			});
			session.api.eventRemoveListener("custom", listener);
			session.api.eventEmit("custom");
			return `${first}/${second}`;
		},
		expected: "0/1",
	},
	{
		name: "eventClearEvent 清空单个事件",
		source: "事件",
		doc: "酒馆助手 `eventClearEvent(type)`：移除该事件的全部监听器",
		covers: ["eventClearEvent"],
		run: ({ session }) => {
			let count = 0;
			session.api.eventOn("a", () => {
				count += 1;
			});
			session.api.eventOn("b", () => {
				count += 1;
			});
			session.api.eventClearEvent("a");
			session.api.eventEmit("a");
			session.api.eventEmit("b");
			return String(count);
		},
		expected: "1",
	},
	{
		name: "eventClearAll 清空全部事件",
		source: "事件",
		doc: "酒馆助手 `eventClearAll()`：移除全部监听器",
		covers: ["eventClearAll"],
		run: ({ session }) => {
			let count = 0;
			session.api.eventOn("a", () => {
				count += 1;
			});
			session.api.eventOn("b", () => {
				count += 1;
			});
			session.api.eventClearAll();
			session.api.eventEmit("a");
			session.api.eventEmit("b");
			return String(count);
		},
		expected: "0",
	},
	{
		name: "tavern_events 常量与上游一致",
		source: "事件",
		doc: "酒馆助手 `tavern_events`：事件名常量的取值",
		covers: [],
		run: ({ session }) =>
			`${session.api.tavern_events.MESSAGE_RECEIVED}/${session.api.tavern_events.GENERATION_ENDED}`,
		expected: "message_received/generation_ended",
	},
	{
		name: "getChatMessages 支持范围、角色与隐藏过滤",
		source: "消息",
		doc: "酒馆助手 `getChatMessages(range, option)`：范围、`role` 与 `hide_state`",
		covers: ["getChatMessages"],
		run: ({ session }) => {
			const all = session.api.getChatMessages("0-latest");
			const users = session.api.getChatMessages("0-latest", {
				role: "user",
			});
			return `${all.length}/${users.map((message) => message.message).join("|")}`;
		},
		expected: "3/玩家行动",
	},
	{
		name: "getChatMessage 读取单条消息（扩展名）",
		source: "消息",
		doc: "读取单条消息；4.8.10 的公开类型定义未声明，保留自更早版本",
		covers: ["getChatMessage"],
		run: ({ session }) => session.api.getChatMessage(1).message,
		expected: "玩家行动",
	},
	{
		name: "getLastMessageId 与 getCurrentMessageId 指向当前 head",
		source: "消息",
		doc: "酒馆助手 `getLastMessageId`/`getCurrentMessageId`：当前路径的末尾楼层",
		covers: ["getLastMessageId", "getCurrentMessageId"],
		run: ({ session }) =>
			`${session.api.getLastMessageId()}/${session.api.getCurrentMessageId()}`,
		expected: "2/2",
	},
	{
		name: "setChatMessages 改正文生成兄弟楼层，原楼层原文不变",
		source: "消息",
		doc: "酒馆助手 `setChatMessages`：修改消息；本实现追加新 swipe，原文逐字节不变（I4）",
		covers: ["setChatMessages"],
		run: ({ session, store, nodeIds }) => {
			session.api.setChatMessages([{ message_id: 1, message: "新的玩家行动" }]);
			return `${store.getNode(nodeIds.user)?.raw}/${session.api.getChatMessage(1).message}`;
		},
		expected: "玩家行动/新的玩家行动",
	},
	{
		name: "setChatMessages 只改 is_hidden 时写显示状态",
		source: "消息",
		doc: "酒馆助手 `setChatMessages` 的 `is_hidden`；本实现只写插件显示状态，不新建楼层",
		covers: ["setChatMessages"],
		run: ({ session, store, storyId }) => {
			const before = store.listStoryNodes(storyId).length;
			session.api.setChatMessages([{ message_id: 0, is_hidden: true }]);
			const after = store.listStoryNodes(storyId).length;
			return `${before === after}/${session.api.getChatMessage(0).is_hidden}`;
		},
		expected: "true/true",
	},
	{
		name: "setChatMessages 的 swipe_id 切换 head",
		source: "消息",
		doc: "酒馆助手 `setChatMessages` 的 `swipe_id`：切到已有的兄弟楼层",
		covers: ["setChatMessages"],
		run: ({ session }) => {
			session.api.setChatMessages([{ message_id: 1, message: "新的玩家行动" }]);
			session.api.setChatMessages([{ message_id: 1, swipe_id: 0 }]);
			return session.api.getChatMessages("latest")[0]?.message ?? "";
		},
		expected: "玩家行动",
	},
	{
		name: "triggerSlash 的变量命令走 chat 作用域",
		source: "STscript",
		doc: "酒馆助手 `triggerSlash`：变量命令默认 chat 作用域，管道把结果传给下一段",
		covers: ["triggerSlash"],
		run: async ({ session }) =>
			session.api.triggerSlash("/setvar key=hp 3 | /getvar key=hp"),
		expected: "3",
	},
	{
		name: "triggerSlash 对未知命令失败并指出命令名",
		source: "STscript",
		doc: "酒馆助手 `triggerSlash`：未实现的命令直接失败",
		covers: ["triggerSlash"],
		run: async ({ session }) => {
			try {
				await session.api.triggerSlash("/go somewhere");
				return "没有失败";
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		},
		expected: "STscript 命令 go 未实现",
	},
	{
		name: "triggerSlash 的 /gen 只登记后台请求，drain 之后读到正文",
		source: "STscript",
		doc: "酒馆助手 `/gen` 的脚本路径；本实现按 I6、I11 改成登记后台请求",
		covers: ["triggerSlash"],
		open: () =>
			openContext({
				generation: new StEjsGenerationScheduler({
					run: async () => "后台正文",
				}),
			}),
		run: async ({ session }) => {
			const id = await session.api.triggerSlash("/gen 写一段");
			const before = await session.api.triggerSlash(`/genresult ${id}`);
			await session.generation?.drain();
			const after = await session.api.triggerSlash(`/genresult ${id}`);
			return `${before.length}/${after}`;
		},
		expected: "0/后台正文",
	},
	{
		name: "triggerSlash 的 /messages 读取楼层",
		source: "STscript",
		doc: "酒馆助手 `messages` 命令：范围与 `names` 参数",
		covers: ["triggerSlash"],
		run: async ({ session }) =>
			session.api.triggerSlash("/messages 0-1 names=off"),
		expected: "开场白\n玩家行动",
	},
	{
		name: "沙箱的调用结果通过消息返回，脚本侧只能 await",
		source: "沙箱",
		doc: "ADR-0120：iframe 与宿主只通过 postMessage 来往，API 调用是异步的",
		covers: [],
		run: ({ session }) => {
			const sent: StHelperSandboxHostMessage[] = [];
			const host = new StHelperSandboxHost({
				api: session.api,
				permission: ST_HELPER_SANDBOX_FULL_PERMISSION,
				send: (message) => sent.push(message),
				terminate: () => undefined,
			});
			const execution = host.startScript({
				id: "script-1",
				content: "await getVariable('g', { type: 'global' })",
			});
			host.handleMessage({
				type: "st-helper:call",
				execution,
				id: 1,
				name: "getVariable",
				args: ["g", { type: "global" }],
			});
			const result = sent.at(-1);
			host.dispose();
			if (result === undefined || result.type !== "st-helper:result") {
				throw new Error("沙箱没有回传结果");
			}
			return `${result.type}/${result.ok}/${String(result.value)}`;
		},
		expected: "st-helper:result/true/1",
	},
	{
		name: "沙箱拒绝未声明的调用并记录",
		source: "沙箱",
		doc: "ADR-0120、I18：权限声明之外的调用直接拒绝",
		covers: [],
		run: ({ session }) => {
			const sent: StHelperSandboxHostMessage[] = [];
			const permission: StHelperSandboxPermission = {
				kind: "st-helper",
				apis: ["getVariables"],
			};
			const host = new StHelperSandboxHost({
				api: session.api,
				permission,
				send: (message) => sent.push(message),
				terminate: () => undefined,
			});
			const execution = host.startScript({ id: "script-1", content: "" });
			host.handleMessage({
				type: "st-helper:call",
				execution,
				id: 1,
				name: "triggerSlash",
				args: ["/pass x"],
			});
			const result = sent.at(-1);
			const denied = host.trace.at(-1);
			host.dispose();
			if (result === undefined || result.type !== "st-helper:result") {
				throw new Error("沙箱没有回传结果");
			}
			return `${denied?.outcome}/${result.ok}/${result.error?.includes("没有声明")}`;
		},
		expected: "denied/false/true",
	},
	{
		name: "沙箱超时终止后仍能启动下一次执行",
		source: "沙箱",
		doc: "ADR-0120：超时由宿主计时，终止后调用方重建 iframe",
		covers: [],
		run: ({ session }) => {
			let now = 0;
			const terminated: string[] = [];
			const host = new StHelperSandboxHost({
				api: session.api,
				permission: ST_HELPER_SANDBOX_FULL_PERMISSION,
				send: () => undefined,
				terminate: (execution) => terminated.push(execution),
				now: () => now,
				scriptTimeoutMs: 100,
			});
			host.startScript({ id: "slow", content: "while (true) {}" });
			now = 200;
			const swept = host.sweepTimeouts();
			const next = host.startScript({ id: "next", content: "" });
			host.dispose();
			return `${swept.length}/${terminated.length}/${next}`;
		},
		expected: "1/1/exec-2",
	},
	{
		name: "状态栏快照只进显示状态，原楼层原文不变",
		source: "状态栏",
		doc: "ADR-0123：渲染结果写插件显示状态；原文与台账不写（I4、I8）",
		covers: [],
		run: ({ store, storyId, nodeIds, displayState }) => {
			const raw = "```html\n<div>状态</div>\n```";
			store.appendNode({
				id: "n-html",
				storyId,
				parentId: nodeIds.assistant,
				role: "assistant",
				raw,
			});
			const requests: StHelperRenderRequest[] = [];
			const renderer = new StHelperHtmlRenderer({
				store,
				displayState,
				start: (request) => {
					requests.push(request);
					return `render-${requests.length}`;
				},
			});
			const renderId = renderer.renderStatusBar("n-html");
			if (renderId === null) throw new Error("没有提取到状态栏");
			renderer.complete(renderId, "<div>状态 1</div>");
			const page = readStHelperHtmlPage(displayState, "n-html", "statusBar");
			return `${page}/${store.getNode("n-html")?.raw === raw}`;
		},
		expected: "<div>状态 1</div>/true",
	},
	{
		name: "脚本库保留禁用脚本",
		source: "脚本库",
		doc: "ADR-0119：`extensions.tavern_helper.scripts` 的禁用条目照常返回",
		covers: [],
		open: () =>
			openContext({
				card: cardWithScripts([
					{
						id: "enabled",
						name: "启用",
						content: "// 启用脚本",
						enabled: true,
						type: "script",
					},
					{
						id: "disabled",
						name: "禁用",
						content: "// 禁用脚本",
						enabled: false,
						type: "script",
					},
				]),
			}),
		run: ({ session }) =>
			`${session.scripts.length}/${session.scripts[1]?.enabled}`,
		expected: "2/false",
	},
];

async function execute(testCase: ConsistencyCase): Promise<string> {
	const context = testCase.open?.() ?? openContext();
	try {
		return await testCase.run(context);
	} finally {
		closeContext(context);
	}
}

describe("酒馆助手一致性用例", () => {
	it("每一行都与上游文档记录的语义一致", async () => {
		for (const testCase of CASES) {
			expect(await execute(testCase), testCase.name).toBe(testCase.expected);
		}
	});

	it("覆盖清单里的每个函数都至少有一条用例", () => {
		const covered = new Set(CASES.flatMap((testCase) => testCase.covers));
		for (const name of ST_HELPER_IMPLEMENTED_FUNCTIONS) {
			expect(covered.has(name), name).toBe(true);
		}
	});

	it("覆盖率按上游 4.8.10 的公开类型定义统计", () => {
		const summary = summarizeStHelperCoverage();
		expect(summary).toMatchObject({
			upstreamFunctions: 140,
			implementedUpstream: 16,
			scopeFunctions: 19,
			implementedInScope: 16,
			extended: 3,
			missingInScope: ["insertVariables", "generate", "generateRaw"],
		});
		expect(summary.coverage).toBeCloseTo(16 / 140, 10);
		expect(summary.scopeCoverage).toBeCloseTo(16 / 19, 10);
	});
});

import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type ContextSlotProvider,
	type ContextTemplate,
	StoryStore,
	WRITING_CONTRACT_SEGMENT_ID,
	readLedger,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import { parsePresetJson } from "../src/preset.js";
import {
	type StEjsContentPipeline,
	createStEjsContentPipeline,
} from "../src/st-content/ejs-pipeline.js";
import {
	StEjsGenerationScheduler,
	createStEjsRuntime,
	parseStEjsInjections,
} from "../src/st-ejs/index.js";
import { parseWorldInfoJson } from "../src/world-info.js";

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	}
});

const CARD = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "测试角色",
			description: "角色描述",
			personality: "冷静",
			scenario: "雨夜",
			first_mes: "你好",
			mes_example: "<START>",
			creator_notes: "作者注释",
			system_prompt: "系统提示",
			post_history_instructions: "历史之后",
			creator: "作者",
			character_version: "1.2",
			tags: ["测试", "角色"],
			alternate_greetings: ["另一个开场"],
			group_only_greetings: [],
		},
	}),
);

const PRESET = parsePresetJson(
	JSON.stringify({
		name: "预设甲",
		temperature: 0.7,
		openai_max_tokens: 256,
		prompts: [
			{
				identifier: "main",
				name: "主提示",
				content: "预设内容",
				role: "system",
			},
		],
		prompt_order: [
			{
				character_id: 100001,
				order: [{ identifier: "main", enabled: true }],
			},
		],
		extensions: { regex_scripts: [] },
	}),
);

const WORLD = {
	...parseWorldInfoJson(
		JSON.stringify({
			entries: {
				"0": {
					uid: 0,
					key: ["alpha"],
					comment: "alpha",
					content: '<% print("beta-trigger") %>',
				},
				"1": {
					uid: 1,
					key: ["beta-trigger"],
					comment: "beta",
					content: "乙",
				},
				"2": {
					uid: 2,
					key: [],
					comment: "delta",
					content: "丁",
					constant: true,
				},
			},
		}),
	),
	name: "测试世界",
};

const QUICK_REPLIES = [
	{
		name: "默认",
		replies: [{ id: "1", label: "打招呼", message: "你好" }],
	},
];

interface ConsistencyCase {
	readonly name: string;
	readonly source: "世界书" | "预设" | "卡片" | "对话片段";
	/** 上游文档记录的行为；实现按该行为独立编写。 */
	readonly doc: string;
	readonly run: () => Promise<string> | string;
	readonly expected: string;
}

function worldRuntime() {
	return createStEjsRuntime({
		worldInfo: {
			worlds: [WORLD],
			currentWorld: "测试世界",
			messages: ["提到 alpha 的一楼"],
		},
	});
}

function dataRuntime() {
	return createStEjsRuntime({
		data: {
			character: CARD,
			presets: { 预设甲: PRESET },
			activePreset: "预设甲",
			quickReplies: QUICK_REPLIES,
		},
	});
}

function chatRuntime() {
	return createStEjsRuntime({
		messages: [
			{ id: 0, role: "user", content: "第一楼" },
			{ id: 1, role: "assistant", content: "第二楼" },
			{ id: 2, role: "assistant", content: "第三楼" },
		],
	});
}

const CASES: readonly ConsistencyCase[] = [
	{
		name: "getwi 省略世界书名读取当前世界书",
		source: "世界书",
		doc: "ST-Prompt-Template `getwi`：省略世界书名时用当前世界书",
		run: () => worldRuntime().render("<%- await getwi('alpha') %>"),
		expected: "beta-trigger",
	},
	{
		name: "getwi 的 recursive 把条目正文触发的条目一起返回",
		source: "世界书",
		doc: "ST-Prompt-Template `getwi`：`recursive` 递归激活",
		run: () => worldRuntime().getWorldInfo("alpha", { recursive: true }),
		expected: "beta-trigger\n乙",
	},
	{
		name: "关键词激活按楼层正文与常驻条目标记",
		source: "世界书",
		doc: "ST-Prompt-Template 激活数据：关键词命中与 `constant` 都算激活",
		run: () =>
			worldRuntime()
				.getWorldInfoActivatedData()
				.map((entry) => entry.comment)
				.join("|"),
		expected: "alpha|delta",
	},
	{
		name: "getchar 读取角色卡字段",
		source: "卡片",
		doc: "ST-Prompt-Template `getchar`：读取角色卡字段",
		run: () => dataRuntime().render("<%- getchar('description') %>"),
		expected: "角色描述",
	},
	{
		name: "getCharData 读取开场白",
		source: "卡片",
		doc: "ST-Prompt-Template `getCharData`：读取角色卡字段，开场白映射为 `firstMessage`",
		run: () => dataRuntime().render("<%- getCharData('firstMessage') %>"),
		expected: "你好",
	},
	{
		name: "getCharData 不带参数返回整张卡",
		source: "卡片",
		doc: "ST-Prompt-Template `getCharData`：省略字段返回整张卡",
		run: () => {
			const all = dataRuntime().getCharData() as { readonly name: string };
			return all.name;
		},
		expected: "测试角色",
	},
	{
		name: "getpreset 读取当前预设",
		source: "预设",
		doc: "ST-Prompt-Template `getpreset`：省略名称时用当前预设",
		run: () => dataRuntime().render("<%- getpreset().name %>"),
		expected: "预设甲",
	},
	{
		name: "getqr 按标签读取快捷回复",
		source: "预设",
		doc: "ST-Prompt-Template `getqr`：按标签查找快捷回复",
		run: () => dataRuntime().render("<%- getqr('打招呼') %>"),
		expected: "你好",
	},
	{
		name: "getChatMessage 支持负下标",
		source: "对话片段",
		doc: "ST-Prompt-Template `getChatMessage`：负下标从最新一楼开始",
		run: () => chatRuntime().render("<%- getChatMessage(-1) %>"),
		expected: "第三楼",
	},
	{
		name: "getChatMessages 支持角色筛选",
		source: "对话片段",
		doc: "ST-Prompt-Template `getChatMessages`：按角色筛选楼层",
		run: () =>
			chatRuntime().render("<%- getChatMessages(1, 'assistant').join('|') %>"),
		expected: "第三楼",
	},
	{
		name: "matchChatMessages 在楼层里查找内容",
		source: "对话片段",
		doc: "ST-Prompt-Template `matchChatMessages`：在楼层范围内匹配文本",
		run: () => chatRuntime().render("<%- matchChatMessages('第三楼') %>"),
		expected: "true",
	},
	{
		name: "setvar 与 getvar 在同一运行时内可见",
		source: "对话片段",
		doc: "ST-Prompt-Template 变量函数：写入与读取使用同一合并视图",
		run: () => {
			const ejs = chatRuntime();
			return ejs.render("<% setvar('hp', 3); %><%- getvar('hp') %>");
		},
		expected: "3",
	},
	{
		name: "generate 只登记请求，drain 之后才能读到正文",
		source: "预设",
		doc: "本实现按 I6、I11 改为登记请求；结果在间隙执行后读取",
		run: async () => {
			const scheduler = new StEjsGenerationScheduler({
				run: async () => "后台正文",
			});
			const ejs = createStEjsRuntime({
				generation: {
					submit: (content) =>
						scheduler.submit({
							storyId: "s",
							cardId: "c",
							nodeId: null,
							...content,
						}),
					read: (id) => scheduler.getGenerated(id),
				},
			});
			const id = await ejs.render("<%- generate('写一段') %>");
			const before = await ejs.render(`<%- getGenerated('${id}') %>`);
			await scheduler.drain();
			const after = await ejs.render(`<%- getGenerated('${id}') %>`);
			return `${before.length}/${after}`;
		},
		expected: "0/后台正文",
	},
	{
		name: "[GENERATE:BEFORE] 把后续文本收成生成前注入",
		source: "世界书",
		doc: "ST-Prompt-Template 内容注入：`[GENERATE:BEFORE]` 之后的内容作为生成前注入",
		run: () => {
			const parsed = parseStEjsInjections(
				"开头\n[GENERATE:BEFORE]\n生成前注入\n[GENERATE:AFTER]\n生成后注入",
			);
			return `${parsed.text}/${parsed.injections.map((entry) => entry.directive).join("+")}`;
		},
		expected: "开头/[GENERATE:BEFORE]+[GENERATE:AFTER]",
	},
	{
		name: "@@if 用模板局部变量求值",
		source: "世界书",
		doc: "ST-Prompt-Template 装饰器：`@@if` 的表达式按模板变量求值",
		run: () => {
			const ejs = createStEjsRuntime({
				variables: { local: { hp: 3 } },
			});
			return `${ejs.evaluateCondition("variables.hp > 2")}/${ejs.evaluateCondition("variables.hp > 5")}`;
		},
		expected: "true/false",
	},
	{
		name: "activateRegex 的替换函数拿到运行时变量",
		source: "预设",
		doc: "ST-Prompt-Template 激活正则：替换函数绑定运行时上下文",
		run: () => {
			const ejs = createStEjsRuntime({
				variables: { local: { name: "甲" } },
			});
			ejs.activateRegex(/{{(\w+)}}/g, function (match: unknown, key: unknown) {
				return String(this.getvar(String(key)));
			});
			return ejs.applyRegex("你好{{name}}", { kind: "message" });
		},
		expected: "你好甲",
	},
];

describe("st-ejs 一致性用例表", () => {
	for (const item of CASES) {
		it(`${item.source}：${item.name}（${item.doc}）`, async () => {
			expect(await item.run()).toBe(item.expected);
		});
	}
});

function openStore(): StoryStore {
	const dir = mkdtempSync(
		join(import.meta.dirname, ".tmp-st-ejs-consistency-"),
	);
	createdDirs.push(dir);
	return StoryStore.open(join(dir, "story.db"));
}

function seedStory(
	store: StoryStore,
	options: { readonly hp?: number } = {},
): { readonly storyId: string; readonly nodeId: string } {
	const storyId = "ejs-consistency";
	store.createStory({ id: storyId, title: "EJS 一致性" });
	const opening = store.appendNode({
		id: "n-open",
		storyId,
		parentId: null,
		role: "assistant",
		raw: "开场 <%= '不应该被渲染' %>",
	});
	if (options.hp !== undefined) {
		store.appendStateDiffs([
			{
				storyId,
				nodeId: opening.id,
				path: ["mvu", "stat_data", "hp"],
				op: "set",
				value: options.hp,
				source: "settler",
			},
		]);
	}
	const user = store.appendNode({
		id: "n-user",
		storyId,
		parentId: opening.id,
		role: "user",
		raw: "行动 <%= '也不渲染' %>",
	});
	return { storyId, nodeId: user.id };
}

function template(segments: ContextTemplate["segments"]): ContextTemplate {
	return { id: "ejs-consistency-template", segments };
}

function slotRequest(slot: "history" | "lore" | "state", nodeId: string) {
	return {
		slot,
		storyId: "ejs-consistency",
		nodeId,
		switches: {},
		state: null,
	} as const;
}

describe("st-ejs 内容来源范围", () => {
	it("预设静态段渲染，写作契约与 harness 槽位逐字节不变", async () => {
		const store = openStore();
		const { storyId, nodeId } = seedStory(store);
		const pipeline: StEjsContentPipeline = createStEjsContentPipeline({
			store,
			storyId,
			card: CARD,
			preset: PRESET,
			worlds: [WORLD],
		});
		try {
			const history: ContextSlotProvider = {
				async provide() {
					return {
						messages: [{ role: "assistant", content: "历史 <%= '正文' %>" }],
						source: "history",
					};
				},
			};
			const state: ContextSlotProvider = {
				async provide() {
					return {
						messages: [{ role: "system", content: "状态 <% 原样 %>" }],
						source: "state",
					};
				},
			};
			const lore: ContextSlotProvider = {
				async provide() {
					return {
						messages: [{ role: "system", content: "世界书 <%= '槽位' %>" }],
						source: "lore",
					};
				},
			};
			const wrapped = pipeline.wrapProviders({ history, lore, state });
			expect(wrapped.state).toBe(state);
			expect(
				(await wrapped.state.provide(slotRequest("state", nodeId)))?.messages[0]
					?.content,
			).toBe("状态 <% 原样 %>");
			expect(
				(await wrapped.history.provide(slotRequest("history", nodeId)))
					?.messages[0]?.content,
			).toBe("历史 正文");
			expect(
				(await wrapped.lore.provide(slotRequest("lore", nodeId)))?.messages[0]
					?.content,
			).toBe("世界书 槽位");

			const rendered = await pipeline.renderTemplate(
				template([
					{
						id: "st-main",
						kind: "static",
						text: "角色：<%= getchar('name') %>",
					},
					{ id: "history-slot", kind: "slot", slot: "history" },
					{
						id: WRITING_CONTRACT_SEGMENT_ID,
						kind: "static",
						text: "契约字面量 <% 不渲染 %>",
					},
				]),
				{ nodeId },
			);
			expect(rendered.segments[0]).toMatchObject({
				id: "st-main",
				text: "角色：测试角色",
			});
			expect(rendered.segments[2]).toEqual({
				id: WRITING_CONTRACT_SEGMENT_ID,
				kind: "static",
				text: "契约字面量 <% 不渲染 %>",
			});
		} finally {
			await pipeline.dispose();
			store.close();
		}
	});

	it("变量写经结算器落成 mvu 事实，原楼层原文不变", async () => {
		const store = openStore();
		const { storyId, nodeId } = seedStory(store, { hp: 3 });
		const pipeline = createStEjsContentPipeline({
			store,
			storyId,
			card: CARD,
			preset: PRESET,
		});
		try {
			const rendered = await pipeline.renderTemplate(
				template([
					{
						id: "st-main",
						kind: "static",
						text: "<% setvar('stat_data.hp', getvar('stat_data.hp') + 2); %><%= getvar('stat_data.hp') %>",
					},
				]),
				{ nodeId },
			);
			expect(rendered.segments[0]).toMatchObject({ text: "5" });
			expect(readLedger(store, nodeId, ["mvu"])).toEqual({
				stat_data: { hp: 5 },
			});
			expect(store.getNode(nodeId)?.raw).toBe("行动 <%= '也不渲染' %>");
			expect(store.getNode("n-open")?.raw).toBe("开场 <%= '不应该被渲染' %>");
		} finally {
			await pipeline.dispose();
			store.close();
		}
	});
});

import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type ContextSlotProvider,
	type ContextTemplate,
	StoryStore,
	readLedger,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import {
	type StEjsContentPipeline,
	createStEjsContentPipeline,
	createStEjsTurnBudget,
} from "../src/st-content/ejs-pipeline.js";
import { parseWorldInfoJson } from "../src/world-info.js";

const CARD = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "测试角色",
			description: "角色描述正文",
		},
	}),
);

function openStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-st-ejs-pipeline-")),
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

function seedStory(
	store: StoryStore,
	options: { readonly hp?: number } = {},
): { readonly storyId: string; readonly nodeId: string } {
	const storyId = "s-ejs";
	store.createStory({ id: storyId, title: "EJS 测试" });
	const opening = store.appendNode({
		id: "n-open",
		storyId,
		parentId: null,
		role: "assistant",
		raw: "开场。",
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
		raw: "行动。",
	});
	return { storyId, nodeId: user.id };
}

function pipelineFor(
	store: StoryStore,
	storyId: string,
	options: {
		readonly worlds?: readonly ReturnType<typeof parseWorldInfoJson>[];
	} = {},
): StEjsContentPipeline {
	const pipeline = createStEjsContentPipeline({
		store,
		storyId,
		card: CARD,
		preset: null,
		...(options.worlds === undefined ? {} : { worlds: options.worlds }),
	});
	onTestFinished(() => pipeline.dispose());
	return pipeline;
}

function template(segments: ContextTemplate["segments"]): ContextTemplate {
	return { id: "test-template", segments };
}

function request(slot: "history" | "state", nodeId: string) {
	return {
		slot,
		storyId: "s-ejs",
		nodeId,
		switches: {},
		state: null,
	} as const;
}

describe("EJS 内容流水线", () => {
	it("只渲染 ST 静态段、历史与世界书，写作契约与 harness 槽位逐字节不变", async () => {
		const store = openStore();
		const { storyId, nodeId } = seedStory(store);
		const world = parseWorldInfoJson(
			JSON.stringify({
				entries: {
					"1": {
						uid: 1,
						key: ["测试"],
						keysecondary: [],
						content: "世界书正文 <%= '渲染' %>",
						constant: true,
						disable: false,
						position: 0,
					},
				},
			}),
		);
		const pipeline = pipelineFor(store, storyId, {
			worlds: [{ ...world, name: "测试世界" }],
		});
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
		expect(wrapped.memory).toBeUndefined();

		const renderedHistory = await wrapped.history?.provide(
			request("history", nodeId),
		);
		expect(renderedHistory?.messages[0]?.content).toBe("历史 正文");
		const renderedLore = await wrapped.lore?.provide(
			request("history", nodeId),
		);
		expect(renderedLore?.messages[0]?.content).toBe("世界书 槽位");
		const renderedState = await wrapped.state?.provide(
			request("state", nodeId),
		);
		expect(renderedState?.messages[0]?.content).toBe("状态 <% 原样 %>");

		const rendered = await pipeline.renderTemplate(
			template([
				{
					id: "st-main",
					kind: "static",
					text: "角色：<%= '预设' %>",
				},
				{ id: "history-slot", kind: "slot", slot: "history" },
				{ id: "protocol", kind: "static", text: "契约字面量 <% 不渲染 %>" },
			]),
			{ nodeId },
		);
		expect(rendered.segments[0]).toMatchObject({
			id: "st-main",
			text: "角色：预设",
		});
		expect(rendered.segments[2]).toEqual({
			id: "protocol",
			kind: "static",
			text: "契约字面量 <% 不渲染 %>",
		});
	});

	it("变量读台账快照，写经结算器落成 mvu 事实", async () => {
		const store = openStore();
		const { storyId, nodeId } = seedStory(store, { hp: 3 });
		const pipeline = pipelineFor(store, storyId);
		const rendered = await pipeline.renderTemplate(
			template([
				{
					id: "st-main",
					kind: "static",
					text: "<% setvar('stat_data.hp', getvar('stat_data.hp') + 2); %><%= getvar('stat_data.hp') %>",
				},
				{ id: "protocol", kind: "static", text: "契约" },
			]),
			{ nodeId },
		);
		expect(rendered.segments[0]).toMatchObject({ text: "5" });
		expect(readLedger(store, nodeId, ["mvu"])).toEqual({
			stat_data: { hp: 5 },
		});
	});

	it("global 与消息级变量留在插件存储，不写台账", async () => {
		const store = openStore();
		const { storyId, nodeId } = seedStory(store, { hp: 3 });
		const pipeline = pipelineFor(store, storyId);
		await pipeline.renderTemplate(
			template([
				{
					id: "st-main",
					kind: "static",
					text: "<% setGlobalVar('称呼', '队长'); setMessageVar('临时', '本轮'); %><%= getvar('称呼') %>",
				},
				{ id: "protocol", kind: "static", text: "契约" },
			]),
			{ nodeId },
		);
		expect(readLedger(store, nodeId, ["mvu"])).toEqual({
			stat_data: { hp: 3 },
		});
		const next = await pipeline.renderTemplate(
			template([
				{
					id: "st-main",
					kind: "static",
					text: "<%= getvar('称呼') %>/<%= getvar('临时') %>",
				},
				{ id: "protocol", kind: "static", text: "契约" },
			]),
			{ nodeId },
		);
		expect(next.segments[0]).toMatchObject({ text: "队长/本轮" });
	});

	it("结算器拒绝非法变量路径时直接抛错", async () => {
		const store = openStore();
		const { storyId, nodeId } = seedStory(store, { hp: 3 });
		const pipeline = pipelineFor(store, storyId);
		await expect(
			pipeline.renderTemplate(
				template([
					{
						id: "st-main",
						kind: "static",
						text: "<% setvar('', 1); %>",
					},
					{ id: "protocol", kind: "static", text: "契约" },
				]),
				{ nodeId },
			),
		).rejects.toThrow("变量写入被结算器拒绝");
		expect(readLedger(store, nodeId, ["mvu"])).toEqual({
			stat_data: { hp: 3 },
		});
	});

	it("超时的模板按空内容处理并记入回合预算", async () => {
		const store = openStore();
		const { storyId, nodeId } = seedStory(store);
		const pipeline = pipelineFor(store, storyId);
		const { budget, entries } = createStEjsTurnBudget(200);
		const rendered = await pipeline.renderTemplate(
			template([
				{ id: "st-main", kind: "static", text: "<% while (true) {} %>" },
				{ id: "protocol", kind: "static", text: "契约" },
			]),
			{ nodeId, budget },
		);
		expect(rendered.segments[0]).toMatchObject({ text: "" });
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ outcome: "timeout" });
	});
});

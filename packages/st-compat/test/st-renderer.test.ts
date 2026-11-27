import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import {
	ST_CONTENT_RENDERER_ID,
	ST_HELPER_RENDERER_ID,
	createStCardFloorRenderer,
	importStCardUi,
	readStCardUiConfig,
	setStRendererEnabled,
	stRendererSummaries,
} from "../src/st-renderer/index.js";

function openStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-st-renderer-")),
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

const RAW = "<stat>气力：3</stat>\n雨停了。";

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "星轨",
		description: "状态栏与助手脚本。",
		first_mes: RAW,
		extensions: {
			regex_scripts: [
				{
					id: "status",
					scriptName: "状态栏",
					findRegex: "/<stat>([\\s\\S]*?)<\\/stat>/g",
					replaceString:
						'<div class="statusbar" id="status"><span id="energy">$1</span><button id="rest" type="button" onclick="rest()">休息</button></div>',
					trimStrings: [],
					placement: [2],
					disabled: false,
					markdownOnly: false,
					promptOnly: false,
					runOnEdit: false,
				},
			],
			tavern_helper: {
				scripts: [
					{
						id: "s1",
						name: "状态脚本",
						content:
							"// 从 https://example.com/status.js 抄来的用法\nwindow.rest = function () { eventEmit('status:rest'); };",
						enabled: true,
						type: "script",
						info: "",
						button: {},
						data: {},
					},
				],
			},
		},
	},
};

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "渲染" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: RAW,
	});
}

describe("酒馆卡片渲染插件", () => {
	it("把显示层正则与助手脚本转成渲染器，原文不动", () => {
		const store = openStore();
		seed(store);
		const card = parseCharacterCardJson(JSON.stringify(CARD));
		const result = importStCardUi(store, "s1", card);
		expect(result.config?.regexes.map((item) => item.id)).toEqual(["status"]);
		expect(result.config?.scripts.map((item) => item.id)).toEqual(["s1"]);
		expect(result.domains).toEqual(["example.com"]);
		expect(stRendererSummaries(readStCardUiConfig(store, "s1"))).toEqual([
			{
				id: ST_CONTENT_RENDERER_ID,
				plugin: ST_CONTENT_RENDERER_ID,
				name: "酒馆美化正则",
				permissions: [
					"sendMessage",
					"fillInput",
					"readState",
					"writeState",
					"openImage",
				],
				enabled: true,
			},
			{
				id: ST_HELPER_RENDERER_ID,
				plugin: ST_HELPER_RENDERER_ID,
				name: "酒馆助手脚本",
				permissions: [
					"sendMessage",
					"fillInput",
					"readState",
					"writeState",
					"openImage",
				],
				enabled: true,
			},
		]);

		const renderer = createStCardFloorRenderer(readStCardUiConfig(store, "s1"));
		if (renderer === null) throw new Error("应该生成渲染器");
		expect(renderer.id).toBe(ST_HELPER_RENDERER_ID);
		const content = renderer.render({
			nodeId: "a1",
			raw: RAW,
			blocks: [],
			state: { mvu: { energy: 3 } },
		});
		if (content === null) throw new Error("应该渲染出内容");
		expect(content.html).toContain('class="statusbar"');
		expect(content.html).toContain("气力：3");
		expect(content.script).toContain("window.dramaticerBridge");
		expect(content.script).toContain("getVariables");
		expect(content.script).toContain("window.rest");
		expect(store.getNode("a1")?.raw).toBe(RAW);
	});

	it("关掉美化正则后不再替换，关掉两个插件后不再认领", () => {
		const store = openStore();
		seed(store);
		importStCardUi(store, "s1", parseCharacterCardJson(JSON.stringify(CARD)));

		setStRendererEnabled(store, "s1", ST_CONTENT_RENDERER_ID, false);
		const regexOff = createStCardFloorRenderer(readStCardUiConfig(store, "s1"));
		if (regexOff === null) throw new Error("助手脚本还在，应该继续渲染");
		expect(regexOff.id).toBe(ST_HELPER_RENDERER_ID);
		const content = regexOff.render({
			nodeId: "a1",
			raw: RAW,
			blocks: [],
			state: undefined,
		});
		expect(content?.html).toContain("&lt;stat&gt;");
		expect(content?.html).not.toContain('class="statusbar"');

		setStRendererEnabled(store, "s1", ST_HELPER_RENDERER_ID, false);
		expect(createStCardFloorRenderer(readStCardUiConfig(store, "s1"))).toBe(
			null,
		);
		expect(stRendererSummaries(readStCardUiConfig(store, "s1"))).toEqual([
			expect.objectContaining({ id: ST_CONTENT_RENDERER_ID, enabled: false }),
			expect.objectContaining({ id: ST_HELPER_RENDERER_ID, enabled: false }),
		]);
	});

	it("没有正则也没有脚本时清掉旧配置", () => {
		const store = openStore();
		seed(store);
		importStCardUi(store, "s1", parseCharacterCardJson(JSON.stringify(CARD)));
		const plain = parseCharacterCardJson(
			JSON.stringify({
				spec: "chara_card_v2",
				spec_version: "2.0",
				data: { name: "普通卡", first_mes: "普通开场。" },
			}),
		);
		expect(importStCardUi(store, "s1", plain).config).toBeNull();
		expect(readStCardUiConfig(store, "s1")).toBeNull();
	});
});

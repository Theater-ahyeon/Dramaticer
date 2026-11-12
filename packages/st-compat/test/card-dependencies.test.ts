import { StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { importCardContent, parseCharacterCardJson } from "../src/index.js";

function openStore(): StoryStore {
	const store = StoryStore.open(":memory:");
	store.createStory({ id: "story-1", title: "测试故事" });
	onTestFinished(() => store.close());
	return store;
}

function parseCard(extension: unknown) {
	return parseCharacterCardJson(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name: "云裳",
				description: "青云宗剑修",
				extensions: { dramaticer: extension },
			},
		}),
	);
}

describe("卡片导入的依赖报告", () => {
	it("缺少必需依赖时逐条写入导入报告", () => {
		const store = openStore();
		const imported = importCardContent(store, "story-1", {
			card: parseCard({
				requires: {
					plugins: [{ name: "xianxia.core", versionRange: "^1.2.0" }],
				},
			}),
		});
		expect(imported.dependencies.satisfied).toBe(false);
		expect(imported.dependencies.issues).toEqual([
			expect.objectContaining({
				kind: "plugin",
				level: "required",
				name: "xianxia.core",
				status: "missing",
			}),
		]);
		expect(store.getStory("story-1")).not.toBeNull();
	});

	it("卡随附的声明式插件算作可用，能满足同名的版本要求", () => {
		const store = openStore();
		const imported = importCardContent(store, "story-1", {
			card: parseCard({
				plugins: [
					{
						format: "dramaticer.plugin",
						formatVersion: 1,
						name: "xianxia.core",
						version: "1.3.0",
						kind: "skill",
						payload: {
							name: "剑意",
							description: "剑修的基础技巧",
							content: "出剑之前先稳住呼吸。",
						},
					},
				],
				requires: {
					plugins: [{ name: "xianxia.core", versionRange: "^1.2.0" }],
				},
			}),
		});
		expect(imported.dependencies).toEqual({ satisfied: true, issues: [] });
	});

	it("本机清单满足全部必需与推荐依赖时不提示", () => {
		const store = openStore();
		const imported = importCardContent(store, "story-1", {
			card: parseCard({
				requires: { plugins: [{ name: "xianxia.core" }] },
				recommends: { playpacks: [{ name: "xianxia.pack" }] },
			}),
			availableDependencies: {
				plugins: [{ name: "xianxia.core", version: "1.0.0" }],
				playpacks: [{ name: "xianxia.pack", version: "2.1.0" }],
			},
		});
		expect(imported.dependencies).toEqual({ satisfied: true, issues: [] });
	});

	it("缺少推荐依赖时报告提示但仍算必需依赖满足", () => {
		const store = openStore();
		const imported = importCardContent(store, "story-1", {
			card: parseCard({
				recommends: { playpacks: [{ name: "xianxia.pack" }] },
			}),
		});
		expect(imported.dependencies.satisfied).toBe(true);
		expect(imported.dependencies.issues).toEqual([
			expect.objectContaining({
				kind: "playpack",
				level: "recommended",
				name: "xianxia.pack",
			}),
		]);
	});
});

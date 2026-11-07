import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	DEFAULT_CONTEXT_TEMPLATE_ID,
	DEFAULT_DIRECTOR_CONFIG,
	DEFAULT_HISTORY_BLOCK_POLICY,
	type StorySettingsUpdate,
	StoryStore,
	createDefaultContextTemplate,
} from "../src/index.js";

function tempDbPath(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-settings-"));
	return join(dir, "story.db");
}

function openStory(): {
	store: StoryStore;
	close: () => void;
	path: string;
	createdAt: string;
} {
	const path = tempDbPath();
	const store = StoryStore.open(path);
	let open = true;
	const close = () => {
		if (!open) return;
		store.close();
		open = false;
	};
	onTestFinished(() => {
		close();
		rmSync(join(path, ".."), { recursive: true, force: true, maxRetries: 5 });
	});
	const story = store.createStory({ id: "s1", title: "山门" });
	return { store, close, path, createdAt: story.createdAt };
}

describe("故事设置", () => {
	it("没有保存过设置时返回默认值，且不写入数据库", () => {
		const { store, close, path, createdAt } = openStory();
		const settings = store.getStorySettings("s1");
		expect(settings).toEqual({
			storyId: "s1",
			cardName: null,
			characterPrompt: null,
			persona: null,
			templateId: null,
			model: null,
			budgetTokens: 12_000,
			structuredOutput: "text-tags",
			temperature: 0.8,
			maxTokens: 4_096,
			reasoning: "low",
			viewpoint: null,
			directorConfig: DEFAULT_DIRECTOR_CONFIG,
			historyBlockPolicy: DEFAULT_HISTORY_BLOCK_POLICY,
			gapPassEnabled: false,
			updatedAt: createdAt,
		});
		close();
		const reopened = StoryStore.open(path);
		expect(reopened.getStorySettings("s1").updatedAt).toBe(createdAt);
		reopened.close();
	});

	it("更新后重新打开数据库仍然保留，未出现的字段保持原值", () => {
		const { store, close, path } = openStory();
		store.updateStorySettings("s1", {
			cardName: "山神",
			characterPrompt: "你扮演山神。",
			persona: "讲述者",
			templateId: DEFAULT_CONTEXT_TEMPLATE_ID,
			model: "main",
			budgetTokens: 9_000,
			structuredOutput: "function-call",
			temperature: 0.3,
			maxTokens: 512,
			reasoning: "high",
			viewpoint: "山神",
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, enabled: false },
			historyBlockPolicy: {
				mode: "full",
				overrides: { 选项: { kind: "drop" } },
			},
			gapPassEnabled: true,
		});
		store.updateStorySettings("s1", { temperature: 0.1 });
		close();

		const reopened = StoryStore.open(path);
		try {
			const settings = reopened.getStorySettings("s1");
			expect(settings).toMatchObject({
				cardName: "山神",
				characterPrompt: "你扮演山神。",
				persona: "讲述者",
				templateId: DEFAULT_CONTEXT_TEMPLATE_ID,
				model: "main",
				budgetTokens: 9_000,
				structuredOutput: "function-call",
				temperature: 0.1,
				maxTokens: 512,
				reasoning: "high",
				viewpoint: "山神",
				directorConfig: { enabled: false },
				historyBlockPolicy: {
					mode: "full",
					overrides: { 选项: { kind: "drop" } },
				},
				gapPassEnabled: true,
			});
		} finally {
			reopened.close();
		}
	});

	it("非法枚举、数值范围、模板引用与字段名都抛错", () => {
		const { store } = openStory();
		const cases: readonly [StorySettingsUpdate, string][] = [
			[{ structuredOutput: "json" as never }, "structuredOutput"],
			[{ reasoning: "huge" as never }, "reasoning"],
			[{ budgetTokens: -1 }, "budgetTokens"],
			[{ maxTokens: 0 }, "maxTokens"],
			[{ temperature: 2.5 }, "temperature"],
			[{ temperature: Number.NaN }, "temperature"],
			[{ characterPrompt: "   " }, "characterPrompt"],
			[
				{ directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, climaxFloors: 0 } },
				"climaxFloors",
			],
			[
				{
					directorConfig: {
						...DEFAULT_DIRECTOR_CONFIG,
						unknown: 1,
					} as never,
				},
				"未知字段",
			],
			[{ historyBlockPolicy: { mode: "huge" } as never }, "historyBlockPolicy"],
			[{ gapPassEnabled: "yes" as never }, "gapPassEnabled"],
			[
				{
					historyBlockPolicy: {
						mode: "default",
						overrides: { 选项: { kind: "compress" } },
					},
				},
				"compress",
			],
			[{ templateId: "missing" }, "上下文模板不存在"],
			[{ unknown: true } as never, "未知字段"],
		];
		for (const [update, message] of cases) {
			expect(() => store.updateStorySettings("s1", update)).toThrow(message);
		}
		expect(() => store.getStorySettings("missing")).toThrow("故事不存在");
	});
});

describe("上下文模板", () => {
	it("创建、列出、更新与删除模板", () => {
		const { store } = openStory();
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
		});
		const created = store.createContextTemplate({ name: "叙述", template });
		expect(created.template).toEqual(template);
		expect(store.listContextTemplates().map((record) => record.id)).toEqual([
			created.id,
		]);
		expect(() =>
			store.createContextTemplate({ name: "叙述", template }),
		).toThrow("名称已存在");

		const updated = store.updateContextTemplate(created.id, { name: "第二版" });
		expect(updated.name).toBe("第二版");
		expect(updated.template).toEqual(template);
		expect(() => store.updateContextTemplate(created.id, {})).toThrow(
			"至少要包含",
		);

		store.deleteContextTemplate(created.id);
		expect(store.getContextTemplate(created.id)).toBeNull();
		expect(() => store.deleteContextTemplate(created.id)).toThrow("模板不存在");
	});

	it("空模板、非法槽位与空名称都抛错", () => {
		const { store } = openStory();
		expect(() =>
			store.createContextTemplate({
				name: "空",
				template: { id: "empty", segments: [] },
			}),
		).toThrow("至少需要一个片段");
		expect(() =>
			store.createContextTemplate({
				name: "坏槽位",
				template: {
					id: "bad",
					segments: [{ id: "x", kind: "slot", slot: "nope" as never }],
				},
			}),
		).toThrow("槽位不合法");
		expect(() =>
			store.createContextTemplate({
				name: "  ",
				template: createDefaultContextTemplate({
					structuredOutput: "text-tags",
				}),
			}),
		).toThrow("上下文模板名称必须是非空字符串");
	});

	it("内置默认模板可以直接引用，被引用的自定义模板不能删除", () => {
		const { store } = openStory();
		expect(
			store.updateStorySettings("s1", {
				templateId: DEFAULT_CONTEXT_TEMPLATE_ID,
			}).templateId,
		).toBe(DEFAULT_CONTEXT_TEMPLATE_ID);

		const created = store.createContextTemplate({
			name: "自定义",
			template: createDefaultContextTemplate({
				structuredOutput: "function-call",
			}),
		});
		store.updateStorySettings("s1", { templateId: created.id });
		expect(() => store.deleteContextTemplate(created.id)).toThrow(
			"仍被故事 s1 引用",
		);
		store.updateStorySettings("s1", { templateId: null });
		store.deleteContextTemplate(created.id);
		expect(store.listContextTemplates()).toEqual([]);
	});
});

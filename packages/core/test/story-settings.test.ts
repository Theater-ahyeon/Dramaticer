import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	DEFAULT_CONTEXT_TEMPLATE_ID,
	DEFAULT_DIRECTOR_CONFIG,
	DEFAULT_HISTORY_BLOCK_POLICY,
	DEFAULT_IMAGE_CONFIG,
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
			turnMode: "fast",
			maxReadRounds: 3,
			deepMaxToolCalls: 40,
			deepTimeoutMs: 600_000,
			deepContextTokenLimit: 48_000,
			deepRecentToolSteps: 4,
			viewpoint: null,
			directorConfig: DEFAULT_DIRECTOR_CONFIG,
			historyBlockPolicy: DEFAULT_HISTORY_BLOCK_POLICY,
			gapPassEnabled: false,
			gapPlanSeconds: 212,
			imageConfig: DEFAULT_IMAGE_CONFIG,
			pluginOverrides: { config: {}, switches: {} },
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
			turnMode: "deep",
			maxReadRounds: 5,
			deepMaxToolCalls: 60,
			deepTimeoutMs: 900_000,
			deepContextTokenLimit: 64_000,
			deepRecentToolSteps: 6,
			viewpoint: "山神",
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, mode: "off" },
			historyBlockPolicy: {
				mode: "full",
				overrides: { 选项: { kind: "drop" } },
			},
			gapPassEnabled: true,
			gapPlanSeconds: 90,
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
				turnMode: "deep",
				maxReadRounds: 5,
				deepMaxToolCalls: 60,
				deepTimeoutMs: 900_000,
				deepContextTokenLimit: 64_000,
				deepRecentToolSteps: 6,
				viewpoint: "山神",
				directorConfig: { mode: "off" },
				historyBlockPolicy: {
					mode: "full",
					overrides: { 选项: { kind: "drop" } },
				},
				gapPassEnabled: true,
				gapPlanSeconds: 90,
			});
		} finally {
			reopened.close();
		}
	});

	it("旧版本保存的导演配置缺少新增字段时按默认值读取", () => {
		const { store, close, path } = openStory();
		store.updateStorySettings("s1", {
			directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, pace: 2 },
		});
		close();

		const db = new Database(path);
		try {
			const row = db
				.prepare(
					"SELECT director_config FROM story_settings WHERE story_id = 's1'",
				)
				.pluck()
				.get() as string;
			const legacy = Object.fromEntries(
				Object.entries(JSON.parse(row) as Record<string, unknown>).filter(
					([key]) =>
						key !== "openingFloors" &&
						key !== "openingIntensity" &&
						key !== "intensity",
				),
			);
			db.prepare(
				"UPDATE story_settings SET director_config = ? WHERE story_id = 's1'",
			).run(JSON.stringify(legacy));
		} finally {
			db.close();
		}

		const reopened = StoryStore.open(path);
		try {
			expect(reopened.getStorySettings("s1").directorConfig).toMatchObject({
				pace: 2,
				openingFloors: 10,
				openingIntensity: "natural",
				intensity: "natural",
			});
		} finally {
			reopened.close();
		}
	});

	it("旧导演配置的 enabled 读取时换成 mode，再次保存只写 mode", () => {
		for (const [enabled, expected] of [
			[false, "off"],
			[true, "transparent"],
		] as const) {
			const { store, close, path } = openStory();
			store.updateStorySettings("s1", {
				directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, mode: "transparent" },
			});
			close();

			const db = new Database(path);
			try {
				const row = db
					.prepare(
						"SELECT director_config FROM story_settings WHERE story_id = 's1'",
					)
					.pluck()
					.get() as string;
				const legacy = Object.fromEntries(
					Object.entries(JSON.parse(row) as Record<string, unknown>).filter(
						([key]) => key !== "mode",
					),
				);
				db.prepare(
					"UPDATE story_settings SET director_config = ? WHERE story_id = 's1'",
				).run(JSON.stringify({ ...legacy, enabled }));
			} finally {
				db.close();
			}

			const reopened = StoryStore.open(path);
			try {
				expect(reopened.getStorySettings("s1").directorConfig.mode).toBe(
					expected,
				);
				reopened.updateStorySettings("s1", { temperature: 0.5 });
			} finally {
				reopened.close();
			}

			const verify = new Database(path);
			try {
				const saved = JSON.parse(
					verify
						.prepare(
							"SELECT director_config FROM story_settings WHERE story_id = 's1'",
						)
						.pluck()
						.get() as string,
				) as Record<string, unknown>;
				expect(saved.mode).toBe(expected);
				expect(saved.enabled).toBeUndefined();
			} finally {
				verify.close();
			}
		}
	});

	it("非法枚举、数值范围、模板引用与字段名都抛错", () => {
		const { store } = openStory();
		const cases: readonly [StorySettingsUpdate, string][] = [
			[{ structuredOutput: "json" as never }, "structuredOutput"],
			[{ reasoning: "huge" as never }, "reasoning"],
			[{ turnMode: "turbo" as never }, "turnMode"],
			[{ maxReadRounds: -1 }, "maxReadRounds"],
			[{ maxReadRounds: 1.5 }, "maxReadRounds"],
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
				{ directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, openingFloors: -1 } },
				"openingFloors",
			],
			[
				{
					directorConfig: {
						...DEFAULT_DIRECTOR_CONFIG,
						openingIntensity: "hype" as never,
					},
				},
				"openingIntensity",
			],
			[
				{
					directorConfig: {
						...DEFAULT_DIRECTOR_CONFIG,
						intensity: "hype" as never,
					},
				},
				"intensity",
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
			[
				{
					directorConfig: {
						...DEFAULT_DIRECTOR_CONFIG,
						mode: "maybe" as never,
					},
				},
				"mode",
			],
			[{ historyBlockPolicy: { mode: "huge" } as never }, "historyBlockPolicy"],
			[{ gapPassEnabled: "yes" as never }, "gapPassEnabled"],
			[{ gapPlanSeconds: -1 }, "gapPlanSeconds"],
			[{ gapPlanSeconds: 1.5 }, "gapPlanSeconds"],
			[{ deepMaxToolCalls: 0 }, "deepMaxToolCalls"],
			[{ deepMaxToolCalls: 201 }, "deepMaxToolCalls"],
			[{ deepMaxToolCalls: 1.5 }, "deepMaxToolCalls"],
			[{ deepTimeoutMs: 59_999 }, "deepTimeoutMs"],
			[{ deepTimeoutMs: 3_600_001 }, "deepTimeoutMs"],
			[{ deepContextTokenLimit: 0 }, "deepContextTokenLimit"],
			[{ deepRecentToolSteps: 0 }, "deepRecentToolSteps"],
			[{ deepRecentToolSteps: 21 }, "deepRecentToolSteps"],
			[
				{
					imageConfig: {
						...DEFAULT_IMAGE_CONFIG,
						mode: "always" as never,
					},
				},
				"imageConfig.mode",
			],
			[
				{
					imageConfig: {
						...DEFAULT_IMAGE_CONFIG,
						maxPerFloor: 5,
					},
				},
				"imageConfig.maxPerFloor",
			],
			[
				{
					imageConfig: {
						...DEFAULT_IMAGE_CONFIG,
						minFloorsBetween: -1,
					},
				},
				"imageConfig.minFloorsBetween",
			],
			[
				{
					imageConfig: {
						...DEFAULT_IMAGE_CONFIG,
						unknown: true,
					} as never,
				},
				"未知字段",
			],
			[
				{
					historyBlockPolicy: {
						mode: "default",
						overrides: { 选项: { kind: "compress" } },
					},
				},
				"compress",
			],
			[
				{
					pluginOverrides: {
						config: { "slot.memory": { limit: 5 } },
						switches: { "slot.memory": "off" },
					},
				} as never,
				"pluginOverrides.switches.slot.memory 必须是布尔值",
			],
			[
				{ pluginOverrides: { plugins: [] } } as never,
				"pluginOverrides.plugins 是未知字段",
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

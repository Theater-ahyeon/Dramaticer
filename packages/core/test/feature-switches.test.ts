import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	FEATURE_CAPABILITIES,
	FEATURE_SWITCHES,
	FEATURE_SWITCH_GROUPS,
	FEATURE_TIERS,
	type FeatureCapabilities,
	type FeatureSwitchId,
	NO_FEATURE_CAPABILITIES,
	StoryStore,
	assertFeatureSwitchOverrides,
	assertFeatureTier,
	buildStoryFeatureView,
	readFeatureTierDefaults,
	readStoryFeatureCapabilities,
	readStoryFeatureState,
	resolveFeatureState,
} from "../src/index.js";

const ALL_CAPABILITIES: FeatureCapabilities = {
	entities: true,
	rules: true,
	state: true,
	writing: true,
	presentation: true,
	importedContent: true,
};

function openStore(): StoryStore {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-features-"));
	const store = StoryStore.open(join(dir, "story.db"));
	onTestFinished(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return store;
}

describe("功能开关目录", () => {
	it("档位映射到三组完整默认值", () => {
		expect(readFeatureTierDefaults("lite")).toEqual({
			scribe: false,
			archive: false,
			reunion: false,
			search: false,
			director: "push",
			knows: false,
			prepare: false,
			review: false,
			promiseLimit: 3,
			rules: false,
			status: true,
			choices: false,
			draw: "off",
			bgm: false,
			think: "off",
			tools: false,
			style: true,
			raw: false,
		});
		expect(readFeatureTierDefaults("standard")).toEqual({
			scribe: true,
			archive: true,
			reunion: true,
			search: false,
			director: "push",
			knows: true,
			prepare: false,
			review: true,
			promiseLimit: 5,
			rules: true,
			status: true,
			choices: true,
			draw: "off",
			bgm: false,
			think: "low",
			tools: false,
			style: true,
			raw: false,
		});
		expect(readFeatureTierDefaults("immersive")).toEqual({
			scribe: true,
			archive: true,
			reunion: true,
			search: true,
			director: "push",
			knows: true,
			prepare: true,
			review: true,
			promiseLimit: 8,
			rules: true,
			status: true,
			choices: true,
			draw: "chapter",
			bgm: true,
			think: "high",
			tools: true,
			style: true,
			raw: false,
		});
	});

	it("目录里的取值与种类一致，分组覆盖全部开关", () => {
		const ids = new Set<string>();
		for (const definition of FEATURE_SWITCHES) {
			expect(ids.has(definition.id)).toBe(false);
			ids.add(definition.id);
			expect(definition.description.length).toBeGreaterThan(0);
			expect(definition.label.length).toBeGreaterThan(0);
			expect(FEATURE_SWITCH_GROUPS).toContain(definition.group);
			if (definition.kind === "choice") {
				expect(definition.choices.length).toBeGreaterThan(1);
				const values = definition.choices.map((choice) => choice.value);
				expect(new Set(values).size).toBe(values.length);
			} else {
				expect(definition.choices).toEqual([]);
			}
			if (definition.kind === "number") {
				expect(definition.minimum).not.toBeNull();
				expect(definition.maximum).not.toBeNull();
			}
			for (const tier of FEATURE_TIERS) {
				const value = definition.tierValues[tier];
				if (definition.kind === "toggle") {
					expect(typeof value).toBe("boolean");
				} else if (definition.kind === "number") {
					expect(Number.isInteger(value)).toBe(true);
					expect(value).toBeGreaterThanOrEqual(definition.minimum ?? 0);
					expect(value).toBeLessThanOrEqual(definition.maximum ?? 0);
				} else {
					expect(definition.choices.map((c) => c.value)).toContain(value);
				}
			}
			if (definition.kind === "choice") {
				expect(definition.choices.map((c) => c.value)).toContain(
					definition.disabledValue,
				);
			}
		}
		for (const group of FEATURE_SWITCH_GROUPS) {
			expect(
				FEATURE_SWITCHES.some((definition) => definition.group === group),
			).toBe(true);
		}
	});

	it("能力覆盖表中的每一项都在开关目录里有来源", () => {
		for (const capability of FEATURE_CAPABILITIES) {
			const definitions = FEATURE_SWITCHES.filter(
				(definition) => definition.capability === capability,
			);
			expect(definitions.length).toBeGreaterThan(0);
		}
	});
});

describe("功能开关解析", () => {
	it("能力缺失的开关不显示并取关闭值，通用开关照常按覆盖取值", () => {
		const state = resolveFeatureState({
			tier: "immersive",
			overrides: { raw: true, director: "always", draw: "model" },
			capabilities: NO_FEATURE_CAPABILITIES,
		});
		expect(state.visible).toEqual([
			"scribe",
			"prepare",
			"review",
			"director",
			"promiseLimit",
			"choices",
			"draw",
			"think",
			"tools",
		]);
		expect(state.values.director).toBe("always");
		expect(state.values.draw).toBe("model");
		expect(state.values.think).toBe("high");
		expect(state.values.promiseLimit).toBe(8);
		expect(state.values.scribe).toBe(true);
		expect(state.values.prepare).toBe(true);
		expect(state.values.raw).toBe(false);
		expect(state.values.rules).toBe(false);
		expect(state.values.status).toBe(false);
		expect(state.values.bgm).toBe(false);
		expect(state.values.style).toBe(false);
		expect(state.values.archive).toBe(false);
		expect(state.values.reunion).toBe(false);
		expect(state.values.search).toBe(false);
		expect(state.values.knows).toBe(false);
	});

	it("故事覆盖替换档位默认值，单轮覆盖再盖一层且不留下痕迹", () => {
		const input = {
			tier: "standard" as const,
			overrides: { scribe: false, director: "push" as const },
			capabilities: ALL_CAPABILITIES,
		};
		const base = resolveFeatureState(input);
		expect(base.values.scribe).toBe(false);
		expect(base.values.director).toBe("push");
		expect(base.values.think).toBe("low");

		const once = resolveFeatureState({
			...input,
			turnOverrides: { director: "always", think: "high", draw: "model" },
		});
		expect(once.values.director).toBe("always");
		expect(once.values.think).toBe("high");
		expect(once.values.draw).toBe("model");

		const again = resolveFeatureState(input);
		expect(again).toEqual(base);
	});

	it("未知开关与非法取值抛错并指出字段", () => {
		expect(() =>
			assertFeatureSwitchOverrides({ nope: true }, "功能开关覆盖"),
		).toThrow("功能开关覆盖.nope 不是已知的功能开关");
		expect(() =>
			assertFeatureSwitchOverrides({ scribe: "on" }, "功能开关覆盖"),
		).toThrow("功能开关覆盖.scribe 必须是布尔值");
		expect(() =>
			assertFeatureSwitchOverrides({ director: "sometimes" }, "功能开关覆盖"),
		).toThrow("功能开关覆盖.director 必须是 off、push、always 之一");
		expect(() =>
			assertFeatureSwitchOverrides({ promiseLimit: 2.5 }, "功能开关覆盖"),
		).toThrow("功能开关覆盖.promiseLimit 必须是 1 到 20 之间的整数");
		expect(() =>
			assertFeatureSwitchOverrides({ promiseLimit: 21 }, "功能开关覆盖"),
		).toThrow("功能开关覆盖.promiseLimit 必须是 1 到 20 之间的整数");
		expect(() => assertFeatureTier("huge", "开关档位")).toThrow(
			"开关档位必须是 lite、standard、immersive 之一",
		);
	});

	it("缺省能力与覆盖时按档位取值", () => {
		const state = resolveFeatureState({
			tier: "lite",
			capabilities: ALL_CAPABILITIES,
		});
		expect(state.values).toEqual(readFeatureTierDefaults("lite"));
		expect(state.visible).toHaveLength(FEATURE_SWITCHES.length);
	});
});

describe("卡片能力判断", () => {
	it("没有导入内容、实体与规则的卡只有通用开关", () => {
		const store = openStore();
		store.createStory({ id: "s1", title: "空卡" });
		const capabilities = readStoryFeatureCapabilities(store, "s1");
		expect(capabilities).toEqual(NO_FEATURE_CAPABILITIES);
		const view = buildStoryFeatureView(
			"s1",
			"standard",
			resolveFeatureState({
				tier: "standard",
				capabilities,
				overrides: store.getStorySettings("s1").featureSwitches,
			}),
		);
		const ids = view.groups.flatMap((group) =>
			group.switches.map((item) => item.id),
		);
		expect(ids).toEqual([
			"scribe",
			"prepare",
			"review",
			"director",
			"promiseLimit",
			"choices",
			"draw",
			"think",
			"tools",
		]);
	});

	it("导入分型、实体、规则与世界书决定哪些开关出现", () => {
		const store = openStore();
		store.createStory({ id: "s1", title: "有设定" });
		store.saveImportAuditEntries("s1", [
			{
				source: "world-info:旧世:0",
				title: "常态",
				content: "山门常年有雾。",
				matches: [{ kind: "common", rules: [] }],
				rulePrimary: "common",
				constant: true,
			},
			{
				source: "world-info:旧世:1",
				title: "属性",
				content: "体力上限 10。",
				matches: [{ kind: "state", rules: ["json:state"] }],
				rulePrimary: "state",
				constant: false,
			},
			{
				source: "world-info:旧世:2",
				title: "文风",
				content: "第二人称，短句。",
				matches: [{ kind: "writing", rules: ["title:writing"] }],
				rulePrimary: "writing",
				constant: true,
			},
			{
				source: "world-info:旧世:3",
				title: "插图",
				content: "剑冢：断剑插满山坡。",
				matches: [{ kind: "presentation", rules: ["title:assets"] }],
				rulePrimary: "presentation",
				constant: false,
			},
		]);
		store.insertLoreEntries([
			{
				storyId: "s1",
				name: "山门",
				content: "山门常年有雾。",
				source: "world-info:旧世:0",
			},
		]);
		store.upsertEntity({
			storyId: "s1",
			kind: "character",
			name: "云裳",
			source: "card",
		});
		store.replaceStoryRules({
			storyId: "s1",
			rules: [
				{
					id: "sword",
					label: "剑术检定",
					target: "剑术",
					difficulty: 12,
					resource: null,
				},
			],
		});

		const capabilities = readStoryFeatureCapabilities(store, "s1");
		expect(capabilities).toEqual({
			entities: true,
			rules: true,
			state: true,
			writing: true,
			presentation: true,
			importedContent: true,
		});
	});

	it("故事设置里的开关按档位与覆盖读出", () => {
		const store = openStore();
		store.createStory({ id: "s1", title: "山门" });
		store.updateStorySettings("s1", {
			featureTier: "lite",
			featureSwitches: { think: "high" },
		});
		const state = readStoryFeatureState(store, "s1");
		expect(state.values.think).toBe("high");
		expect(state.values.scribe).toBe(false);

		const temporary = readStoryFeatureState(store, "s1", { scribe: true });
		expect(temporary.values.scribe).toBe(true);
		expect(readStoryFeatureState(store, "s1").values.scribe).toBe(false);
		expect(store.getStorySettings("s1").featureSwitches).toEqual({
			think: "high",
		});
	});

	it("开关视图按分组顺序给出说明与选项", () => {
		const store = openStore();
		store.createStory({ id: "s1", title: "山门" });
		const save = store.updateStorySettings("s1", {
			featureTier: "standard",
		});
		const view = buildStoryFeatureView(
			"s1",
			save.featureTier,
			resolveFeatureState({
				tier: save.featureTier,
				capabilities: ALL_CAPABILITIES,
			}),
		);
		expect(view.groups.map((group) => group.group)).toEqual([
			"memory",
			"director",
			"presentation",
			"compat",
		]);
		const director = view.groups
			.flatMap((group) => group.switches)
			.find((item) => item.id === "director");
		expect(director).toMatchObject({
			kind: "choice",
			value: "push",
			label: "导演",
			description: "你按推进时，从剧情线里挑一个具体的下一步",
		});
		expect(director?.choices.map((choice) => choice.label)).toEqual([
			"关",
			"仅推进时",
			"始终",
		]);
	});
});

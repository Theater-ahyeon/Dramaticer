import type { DirectorConfig, StorySettings } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api";
import {
	buildSettingsDraft,
	describeHistoryPolicy,
	describeSettingsPath,
	parseSettingsDraft,
	settingsErrorsFromFailure,
} from "../src/chat/settings-form";

const DIRECTOR: DirectorConfig = {
	mode: "transparent",
	clueAgeWarning: 12,
	maxOpenClues: 5,
	maxOpenPromises: 5,
	stallFloors: 3,
	surprise: 1,
	similarityThreshold: 0.73,
	similarityWindow: 20,
	similarityStep: 10,
	similarityRiseWindows: 5,
	similarityRiseDelta: 0.02,
	similarityRiseMinimum: 0.03,
	sceneRepeatThreshold: 7,
	tensionEscalate: 0.33,
	tensionClimax: 0.67,
	tensionStateWeight: 0.4,
	tensionNoteWeight: 0.3,
	tensionEventWeight: 0.3,
	tensionStateDiffsPerFloor: 2,
	tensionNotesPerFloor: 1,
	pace: 1,
	minSetupFloors: 2,
	minEscalateFloors: 2,
	climaxFloors: 7,
	breatheFloors: 6,
	openingFloors: 10,
	openingIntensity: "natural",
	intensity: "natural",
};

function settingsFixture(
	overrides: Partial<StorySettings> = {},
): StorySettings {
	return {
		storyId: "story-1",
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
		directorConfig: DIRECTOR,
		directorOrganization: "mechanisms",
		historyBlockPolicy: { mode: "default", overrides: {} },
		contextLayout: "volatility",
		sceneLogEnabled: false,
		gapPassEnabled: false,
		gapPlanSeconds: 212,
		imageConfig: {
			mode: "off",
			workflowId: "",
			maxPerFloor: 1,
			minFloorsBetween: 3,
		},
		pluginOverrides: { config: {}, switches: {} },
		worldModel: "ledger",
		importMode: "upgrade",
		updatedAt: "2026-11-08T10:00:00.000Z",
		...overrides,
	};
}

describe("故事设置表单", () => {
	it("往返转换保留全部字段", () => {
		const settings = settingsFixture({
			cardName: "云裳",
			characterPrompt: "你是云裳。",
			persona: "旅人",
			templateId: "template-1",
			model: "main",
			structuredOutput: "function-call",
			reasoning: "high",
			viewpoint: "云裳",
			gapPassEnabled: true,
			directorConfig: {
				...DIRECTOR,
				mode: "blind",
				scenePath: ["场景", "地点"],
				tensionPath: ["张力"],
				openingFloors: 0,
			},
			historyBlockPolicy: {
				mode: "full",
				overrides: {
					选项: { kind: "drop" },
					状态栏: { kind: "keep-depth", depth: 2 },
				},
			},
		});
		const { update, errors } = parseSettingsDraft(buildSettingsDraft(settings));
		expect(errors).toEqual([]);
		expect(update).toEqual({
			cardName: "云裳",
			characterPrompt: "你是云裳。",
			persona: "旅人",
			model: "main",
			templateId: "template-1",
			budgetTokens: 12_000,
			structuredOutput: "function-call",
			temperature: 0.8,
			maxTokens: 4_096,
			reasoning: "high",
			turnMode: "fast",
			maxReadRounds: 3,
			deepMaxToolCalls: 40,
			deepTimeoutMs: 600_000,
			deepContextTokenLimit: 48_000,
			deepRecentToolSteps: 4,
			viewpoint: "云裳",
			gapPassEnabled: true,
			gapPlanSeconds: 212,
			imageConfig: settings.imageConfig,
			directorConfig: settings.directorConfig,
			historyBlockPolicy: {
				mode: "full",
				overrides: {
					选项: { kind: "drop" },
					状态栏: { kind: "keep-depth", depth: 2 },
				},
			},
		});
	});

	it("空文本变成 null，空的模板 id 变成 null", () => {
		const draft = buildSettingsDraft(settingsFixture({ templateId: null }));
		const { update } = parseSettingsDraft({
			...draft,
			cardName: "",
			model: "   ",
		});
		expect(update.cardName).toBeNull();
		expect(update.model).toBeNull();
		expect(update.templateId).toBeNull();
	});

	it("越界数值与非法路径逐字段报错", () => {
		const draft = buildSettingsDraft(settingsFixture());
		const { errors } = parseSettingsDraft({
			...draft,
			budgetTokens: "abc",
			temperature: "3",
			maxTokens: "0",
			maxReadRounds: "-1",
			deep: {
				deepMaxToolCalls: "500",
				deepTimeoutMs: "1000",
				deepContextTokenLimit: "0",
				deepRecentToolSteps: "21",
			},
			gapPlanSeconds: "1.5",
			director: {
				...draft.director,
				numbers: {
					...draft.director.numbers,
					surprise: "2",
					similarityWindow: "1",
					pace: "0",
				},
				scenePath: "场景..地点",
			},
		});
		expect(errors.map((error) => error.path)).toEqual([
			"budgetTokens",
			"temperature",
			"maxTokens",
			"maxReadRounds",
			"deepMaxToolCalls",
			"deepTimeoutMs",
			"deepContextTokenLimit",
			"deepRecentToolSteps",
			"gapPlanSeconds",
			"directorConfig.surprise",
			"directorConfig.similarityWindow",
			"directorConfig.pace",
			"directorConfig.scenePath",
		]);
		expect(errors[0]?.message).toContain("上下文预算 token");
		expect(errors[4]?.message).toContain("1 到 200");
		expect(errors[9]?.message).toContain("0 到 1");
	});

	it("张力阈值与权重之和的跨字段检查", () => {
		const draft = buildSettingsDraft(settingsFixture());
		const { errors } = parseSettingsDraft({
			...draft,
			director: {
				...draft.director,
				numbers: {
					...draft.director.numbers,
					tensionEscalate: "0.8",
					tensionStateWeight: "0",
					tensionNoteWeight: "0",
					tensionEventWeight: "0",
				},
			},
		});
		expect(errors.map((error) => error.path)).toEqual([
			"directorConfig.tensionEscalate",
			"directorConfig.tensionStateWeight",
		]);
	});

	it("历史块覆盖的块名、重复与深度", () => {
		const draft = buildSettingsDraft(settingsFixture());
		const { errors, update } = parseSettingsDraft({
			...draft,
			history: {
				mode: "default",
				overrides: [
					{ name: "", strategy: "keep", depth: "" },
					{ name: "选项", strategy: "drop", depth: "" },
					{ name: "选项", strategy: "keep", depth: "" },
					{ name: "状态栏", strategy: "keep-depth", depth: "0" },
				],
			},
		});
		expect(errors.map((error) => error.path)).toEqual([
			"historyBlockPolicy.overrides[0]",
			"historyBlockPolicy.overrides[2]",
			"historyBlockPolicy.overrides[3]",
		]);
		expect(update.historyBlockPolicy).toEqual({
			mode: "default",
			overrides: { 选项: { kind: "drop" } },
		});
	});

	it("服务端错误路径映射到表单名字", () => {
		expect(describeSettingsPath("directorConfig.surprise")).toBe(
			"导演配置·事件池意外频率",
		);
		expect(describeSettingsPath("historyBlockPolicy")).toBe("历史块策略");
		expect(describeSettingsPath("temperature")).toBe("温度");
		expect(describeSettingsPath("unknownField")).toBe("unknownField");

		const failure = settingsErrorsFromFailure(
			new ApiError(400, {
				code: "bad_request",
				message: "故事设置的 temperature 必须是 0 到 2 之间的数字",
				details: { path: "temperature" },
			}),
		);
		expect(failure).toEqual([
			{
				path: "temperature",
				message: "故事设置的 temperature 必须是 0 到 2 之间的数字",
			},
		]);
		expect(settingsErrorsFromFailure(new Error("断线"))).toEqual([
			{ path: "", message: "断线" },
		]);
	});

	it("历史策略摘要按覆盖顺序列出", () => {
		expect(
			describeHistoryPolicy({
				mode: "full",
				overrides: [
					{ name: "选项", strategy: "drop", depth: "" },
					{ name: "状态栏", strategy: "keep-depth", depth: "2" },
					{ name: " ", strategy: "keep", depth: "" },
				],
			}),
		).toEqual(["更早楼层：保留完整原文", "选项：删除", "状态栏：保留到深度 2"]);
	});
});

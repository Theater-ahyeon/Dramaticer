import { describe, expect, it } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import { parsePresetJson } from "../src/preset.js";
import {
	buildStContentCompatReport,
	classifyStPresetEntry,
	renderStContentCompatReport,
	summarizeStContentCompatReport,
} from "../src/st-content/compat-report.js";
import { mapStPreset } from "../src/st-content/preset-mapping.js";

const BODIES = [
	"主提示正文",
	"总结正文",
	"规划正文",
	"未知 marker 正文",
	"工具角色正文",
	"深度正文",
	"重复名称正文",
	"关闭副本正文",
	"内嵌世界书正文",
];

function prompt(
	identifier: string,
	name: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		identifier,
		name,
		content: "",
		role: "system",
		enabled: true,
		marker: false,
		...overrides,
	};
}

function buildPreset() {
	return parsePresetJson(
		JSON.stringify({
			name: "报告测试预设",
			prompts: [
				prompt("main", "主提示", { content: "主提示正文 {{char}}" }),
				prompt("charDescription", "角色描述", { marker: true }),
				prompt("chatHistory", "历史", { marker: true }),
				prompt("worldInfoBefore", "世界书", { marker: true }),
				prompt("summaryNote", "总结前文", { content: "总结正文" }),
				prompt("planner", "剧情规划", { content: "规划正文" }),
				prompt("unknownMarker", "未知标记", {
					marker: true,
					content: "未知 marker 正文",
				}),
				prompt("badRole", "错误角色", {
					content: "工具角色正文",
					role: "tool",
				}),
				prompt("badDepth", "缺少深度", {
					content: "深度正文",
					injection_position: 1,
				}),
				prompt("enabledDup", "重复名称", { content: "重复名称正文" }),
				prompt("disabledDup", "重复名称", {
					content: "关闭副本正文",
					enabled: false,
				}),
			],
			prompt_order: [
				{
					character_id: 100001,
					order: [
						"main",
						"charDescription",
						"chatHistory",
						"worldInfoBefore",
						"summaryNote",
						"planner",
						"unknownMarker",
						"badRole",
						"badDepth",
						"enabledDup",
						"disabledDup",
						"main",
					].map((identifier) => ({
						identifier,
						enabled: identifier !== "disabledDup",
					})),
				},
			],
		}),
	);
}

function buildCard() {
	return parseCharacterCardJson(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name: "兼容测试卡",
				description: "角色描述正文",
				personality: "性格正文",
				scenario: "场景正文",
				first_mes: "开场正文",
				mes_example: "",
				system_prompt: "",
				post_history_instructions: "",
				extensions: { custom_extension: true },
				unknown_extra: 1,
				character_book: {
					entries: [
						{
							id: 1,
							keys: ["矿镇"],
							content: "内嵌世界书正文",
							enabled: true,
						},
						{
							id: 2,
							keys: ["山门"],
							content: "关闭的世界书正文",
							enabled: false,
						},
					],
				},
			},
		}),
	);
}

describe("st-content 兼容报告", () => {
	it("汇总启用条目规模、未知 marker 与字段、无法映射的深度与角色、重复条目与分类", () => {
		const preset = buildPreset();
		const card = buildCard();
		const mapping = mapStPreset({
			preset,
			card,
			structuredOutput: "text-tags",
		});
		const report = buildStContentCompatReport({ preset, card, mapping });

		expect(report.presetName).toBe("报告测试预设");
		expect(report.cardName).toBe("兼容测试卡");
		expect(report.enabledEntries).toBe(11);
		expect(report.disabledEntries).toBe(1);
		expect(report.promptTokens).toBeGreaterThan(0);
		expect(report.unmappedTokens).toBeGreaterThan(0);
		expect(report.tokensByKind.injection).toBe(0);
		expect(report.tokensByKind.unmapped).toBe(report.unmappedTokens);

		expect(report.unknownMarkers).toEqual(["unknownMarker"]);
		expect(report.unknownFields).toContain("unknown_extra");
		expect(report.extensionKeys).toEqual(["custom_extension"]);

		const byIdentifier = new Map(
			report.unmappable.map((item) => [item.identifier, item]),
		);
		expect(byIdentifier.get("badRole")).toEqual({
			identifier: "badRole",
			reason: "role",
			detail: "tool",
		});
		expect(byIdentifier.get("badDepth")).toEqual({
			identifier: "badDepth",
			reason: "injection-depth",
			detail: "null",
		});
		expect(byIdentifier.has("unknownMarker")).toBe(false);

		expect(report.duplicates).toEqual([
			{
				field: "identifier",
				value: "main",
				count: 2,
				identifiers: ["main", "main"],
			},
			{
				field: "name",
				value: "主提示",
				count: 2,
				identifiers: ["main", "main"],
			},
		]);

		expect(report.summaryEntries.map((entry) => entry.identifier)).toEqual([
			"summaryNote",
		]);
		expect(report.planningEntries.map((entry) => entry.identifier)).toEqual([
			"planner",
		]);
		expect(report.worldInfo).toEqual({
			entries: 2,
			enabled: 1,
			disabled: 1,
			enabledTokens: expect.any(Number),
		});
		expect(report.worldInfo?.enabledTokens).toBeGreaterThan(0);
	});

	it("渲染的报告与摘要都不含提示词正文", () => {
		const preset = buildPreset();
		const card = buildCard();
		const mapping = mapStPreset({
			preset,
			card,
			structuredOutput: "text-tags",
		});
		const report = buildStContentCompatReport({ preset, card, mapping });
		const markdown = renderStContentCompatReport(report);
		const summary = summarizeStContentCompatReport(report);

		expect(markdown).toContain("## 未识别的 marker");
		expect(markdown).toContain("## 无法映射的深度与角色");
		expect(markdown).toContain("## 重复条目");
		expect(markdown).toContain("总结类");
		expect(markdown).toContain("规划类");
		expect(markdown).toContain("启用条目");
		expect(summary).toContain("st-content");
		expect(summary).toContain("未知 marker 1 个");
		for (const body of [...BODIES, "关闭的世界书正文"]) {
			expect(markdown).not.toContain(body);
			expect(summary).not.toContain(body);
			expect(JSON.stringify(report)).not.toContain(body);
		}
	});

	it("按标识与名称识别总结类与规划类条目", () => {
		expect(classifyStPresetEntry("summary", "条目")).toBe("summary");
		expect(classifyStPresetEntry("chat_summary", "条目")).toBe("summary");
		expect(classifyStPresetEntry("note", "总结前文")).toBe("summary");
		expect(classifyStPresetEntry("planner", "条目")).toBe("planning");
		expect(classifyStPresetEntry("outline_note", "条目")).toBe("planning");
		expect(classifyStPresetEntry("note", "剧情规划")).toBe("planning");
		expect(classifyStPresetEntry("explain", "说明")).toBeNull();
		expect(classifyStPresetEntry("main", "主提示")).toBeNull();
	});
});

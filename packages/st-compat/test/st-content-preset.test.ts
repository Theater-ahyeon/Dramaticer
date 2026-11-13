import type { ContextSlotProvider } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import type { JsonObject } from "../src/index.js";
import { parsePresetJson } from "../src/preset.js";
import { readStAuthorNote } from "../src/st-content/author-note.js";
import { readStPersona } from "../src/st-content/persona.js";
import {
	createStHistoryProvider,
	injectStDepthMessages,
	mapStPreset,
} from "../src/st-content/preset-mapping.js";

const card = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "测试角色",
			description: "角色描述正文",
			personality: "性格正文",
			scenario: "场景正文",
			mes_example: "示例正文",
			system_prompt: "卡片系统提示",
			post_history_instructions: "卡片历史后指令",
		},
	}),
);

function prompt(identifier: string, overrides: JsonObject = {}): JsonObject {
	return {
		identifier,
		name: identifier,
		content: "",
		role: "system",
		system_prompt: true,
		marker: false,
		enabled: true,
		injection_position: 0,
		...overrides,
	};
}

function enabledOrder(identifiers: readonly string[]): JsonObject {
	return {
		character_id: 100001,
		order: identifiers.map((identifier) => ({ identifier, enabled: true })),
	};
}

function preset(raw: JsonObject) {
	return parsePresetJson(JSON.stringify(raw));
}

function persona(position: number, role = 0) {
	const parsed = readStPersona({
		user_avatar: "me.png",
		power_user: {
			personas: { "me.png": "玩家" },
			persona_descriptions: {
				"me.png": { description: "人设正文", position, role },
			},
		},
	});
	if (parsed === null) throw new Error("测试人设缺失");
	return parsed;
}

describe("预设与 prompt 顺序", () => {
	it("按 prompt_order 输出模板段落，写作契约保持在最后", () => {
		const parsed = preset({
			scenario_format: "[场景]{{scenario}}",
			personality_format: "[性格]{{personality}}",
			prompts: [
				prompt("main"),
				prompt("charDescription", { marker: true }),
				prompt("charPersonality", { marker: true }),
				prompt("chatHistory", { marker: true }),
				prompt("afterHistory", { content: "历史之后的条目", role: "user" }),
				prompt("scenario", { marker: true }),
				prompt("worldInfoBefore", { marker: true }),
				prompt("personaDescription", { marker: true }),
				prompt("tail", { content: "结尾条目", role: "model" }),
			],
			prompt_order: [
				enabledOrder([
					"main",
					"charDescription",
					"charPersonality",
					"chatHistory",
					"afterHistory",
					"scenario",
					"worldInfoBefore",
					"personaDescription",
					"tail",
				]),
			],
		});

		const mapping = mapStPreset({
			preset: parsed,
			card,
			structuredOutput: "text-tags",
			persona: persona(0),
		});

		expect(
			mapping.template.segments.map((segment) => [
				segment.id,
				segment.kind,
				segment.kind === "static" ? (segment.role ?? "system") : null,
			]),
		).toEqual([
			["st:0:main", "static", "system"],
			["st:1:charDescription", "static", "system"],
			["st:2:charPersonality", "static", "system"],
			["st:3:chatHistory", "slot", null],
			["st:4:afterHistory", "static", "user"],
			["st:5:scenario", "static", "system"],
			["st:6:worldInfoBefore", "slot", null],
			["st:7:personaDescription", "static", "system"],
			["st:8:tail", "static", "assistant"],
			["protocol", "static", "system"],
		]);
		const staticText = mapping.template.segments.map((segment) =>
			segment.kind === "static" ? segment.text : "",
		);
		expect(staticText[0]).toBe("卡片系统提示");
		expect(staticText[1]).toBe("角色描述正文");
		expect(staticText[2]).toBe("[性格]性格正文");
		expect(staticText[5]).toBe("[场景]场景正文");
		expect(staticText[7]).toBe("人设正文");
		expect(staticText.at(-1)).toContain("写作契约");
		expect(
			mapping.entries.find((entry) => entry.identifier === "tail"),
		).toMatchObject({
			kind: "static",
			role: "assistant",
		});
		expect(mapping.issues).toEqual([]);
	});

	it("选择 100001 顺序组，没有时回退到 100000", () => {
		const parsed = preset({
			prompts: [
				prompt("first", { content: "第一组" }),
				prompt("second", { content: "第二组" }),
			],
			prompt_order: [
				{
					character_id: 100000,
					order: [{ identifier: "second", enabled: true }],
				},
				enabledOrder(["first"]),
			],
		});
		const mapping = mapStPreset({
			preset: parsed,
			card,
			structuredOutput: "text-tags",
		});
		expect(
			mapping.template.segments
				.filter((segment) => segment.kind === "static")
				.slice(0, -1)
				.map((segment) => segment.id),
		).toEqual(["st:0:first"]);
	});

	it("关闭、缺失与无法映射的条目逐条进入报告", () => {
		const parsed = preset({
			prompts: [
				prompt("off", { content: "关闭条目", enabled: false }),
				prompt("triggered", { injection_trigger: ["normal"] }),
				prompt("badRole", { content: "角色错误", role: "tool" }),
				prompt("noDepth", { content: "深度内容", injection_position: 1 }),
				prompt("chatHistory", { marker: true, injection_position: 1 }),
				prompt("worldInfoBefore", { marker: true }),
				prompt("worldInfoAfter", { marker: true }),
				prompt("unknownMarker", { marker: true }),
				prompt("empty", { content: "  " }),
			],
			prompt_order: [
				{
					character_id: 100001,
					order: [
						{ identifier: "off", enabled: false },
						...[
							"missing",
							"triggered",
							"badRole",
							"noDepth",
							"chatHistory",
							"worldInfoBefore",
							"worldInfoAfter",
							"unknownMarker",
							"empty",
						].map((identifier) => ({ identifier, enabled: true })),
					],
				},
			],
		});
		const mapping = mapStPreset({
			preset: parsed,
			card,
			structuredOutput: "text-tags",
		});
		const reasons = new Map(
			mapping.entries.map((entry) => [entry.identifier, entry.reason]),
		);
		expect(reasons.get("off")).toBe("disabled");
		expect(reasons.get("triggered")).toBe("injection-trigger");
		expect(reasons.get("badRole")).toBe("role");
		expect(reasons.get("noDepth")).toBe("injection-depth");
		expect(reasons.get("chatHistory")).toBe("marker-injection");
		expect(reasons.get("worldInfoAfter")).toBe("merged-lore");
		expect(reasons.get("unknownMarker")).toBe("unknown-marker");
		expect(reasons.get("empty")).toBe("empty");
		expect(mapping.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"missing-prompt",
				"injection-trigger",
				"role",
				"injection-depth",
				"marker-injection",
				"world-info-after",
				"unknown-marker",
			]),
		);
		expect(mapping.worldInfo).toEqual({ before: true, after: true });
		expect(
			mapping.template.segments.filter((segment) => segment.id !== "protocol"),
		).toEqual([
			{
				id: "st:5:worldInfoBefore",
				kind: "slot",
				slot: "lore",
				priority: 80,
			},
		]);
	});
});

describe("深度注入", () => {
	const parsed = preset({
		prompts: [
			prompt("main", { content: "主提示正文" }),
			prompt("chatHistory", { marker: true }),
			prompt("depthSystem", {
				content: "深零系统",
				injection_position: 1,
				injection_depth: 0,
				injection_order: 100,
			}),
			prompt("depthUser", {
				content: "深零用户",
				role: "user",
				injection_position: 1,
				injection_depth: 0,
				injection_order: 100,
			}),
			prompt("depthLow", {
				content: "深零低序",
				injection_position: 1,
				injection_depth: 0,
				injection_order: 50,
			}),
			prompt("depthTwo", {
				content: "深二助手",
				role: "assistant",
				injection_position: 1,
				injection_depth: 2,
				injection_order: 100,
			}),
		],
		prompt_order: [
			enabledOrder([
				"main",
				"chatHistory",
				"depthSystem",
				"depthUser",
				"depthLow",
				"depthTwo",
			]),
		],
	});
	const mapping = mapStPreset({
		preset: parsed,
		card,
		structuredOutput: "text-tags",
	});

	it("同一深度按顺序组升序，组内按 assistant、user、system 排列", () => {
		expect(
			injectStDepthMessages(
				[
					{ role: "system", content: "最早" },
					{ role: "user", content: "中间" },
					{ role: "assistant", content: "最新" },
				],
				mapping.injections,
			),
		).toEqual([
			{ role: "system", content: "最早" },
			{ role: "assistant", content: "深二助手" },
			{ role: "user", content: "中间" },
			{ role: "assistant", content: "最新" },
			{ role: "system", content: "深零低序" },
			{ role: "user", content: "深零用户" },
			{ role: "system", content: "深零系统" },
		]);
	});

	it("历史槽位包装器保留来源并叠加注入", async () => {
		const base: ContextSlotProvider = {
			packKey: "test-history",
			provide() {
				return {
					messages: [{ role: "system", content: "唯一消息" }],
					source: "测试历史",
				};
			},
		};
		const wrapped = createStHistoryProvider(base, mapping.injections);
		expect(wrapped.packKey).toContain("st-injections");
		const content = await wrapped.provide({
			slot: "history",
			storyId: "s",
			nodeId: null,
			switches: {},
			state: {},
		});
		expect(content?.source).toBe("测试历史");
		expect(content?.messages.map((message) => message.content)).toEqual([
			"深二助手",
			"唯一消息",
			"深零低序",
			"深零用户",
			"深零系统",
		]);
	});

	it("没有历史槽位时逐条报告注入无法应用", () => {
		const withoutHistory = preset({
			prompts: [
				prompt("injected", {
					content: "内容",
					injection_position: 1,
					injection_depth: 1,
				}),
			],
			prompt_order: [enabledOrder(["injected"])],
		});
		const result = mapStPreset({
			preset: withoutHistory,
			card,
			structuredOutput: "text-tags",
		});
		expect(result.issues).toContainEqual({
			code: "injection-without-history",
			detail: "injected:system:1",
		});
	});

	it("作者注释按扩展提示词与同深度预设条目拼接", () => {
		const withNote = mapStPreset({
			preset: parsed,
			card,
			structuredOutput: "text-tags",
			authorNote: readStAuthorNote({
				note_prompt: "作者注释正文",
				note_position: 1,
				note_depth: 0,
				note_role: 0,
			}),
		});
		expect(
			injectStDepthMessages(
				[{ role: "user", content: "最近一条" }],
				withNote.injections,
			).at(-1),
		).toEqual({
			role: "system",
			content: "深零系统\n作者注释正文",
		});
	});
});

describe("作者注释", () => {
	function noteReset(placement: number, interval = 1, depth = 2) {
		const note = readStAuthorNote({
			note_prompt: "注释正文",
			note_position: placement,
			note_interval: interval,
			note_depth: depth,
			note_role: 1,
		});
		if (note === null) throw new Error("测试作者注释缺失");
		return note;
	}

	const basePreset = preset({
		prompts: [
			prompt("main", { content: "主提示正文" }),
			prompt("chatHistory", { marker: true }),
			prompt("after", { content: "之后" }),
		],
		prompt_order: [enabledOrder(["main", "chatHistory", "after"])],
	});

	it("提示词内插在主提示之后，主提示之前插在主提示之前", () => {
		const inPrompt = mapStPreset({
			preset: basePreset,
			card,
			structuredOutput: "text-tags",
			authorNote: noteReset(0),
		});
		expect(inPrompt.authorNote).toEqual({
			placement: "in-prompt",
			injected: true,
		});
		const segments = inPrompt.template.segments;
		expect(segments[0]?.id).toBe("st:0:main");
		expect(segments[1]).toMatchObject({
			id: "st:author-note",
			kind: "static",
			text: "注释正文",
			role: "user",
		});

		const beforePrompt = mapStPreset({
			preset: basePreset,
			card,
			structuredOutput: "text-tags",
			authorNote: noteReset(2),
		});
		expect(beforePrompt.template.segments[0]).toMatchObject({
			id: "st:author-note",
			kind: "static",
		});
	});

	it("按玩家楼层数判定间隔，缺少楼层数时说明原因", () => {
		const notDue = mapStPreset({
			preset: basePreset,
			card,
			structuredOutput: "text-tags",
			authorNote: noteReset(1, 2),
			playerMessageCount: 3,
		});
		expect(notDue.authorNote).toEqual({
			placement: "in-chat",
			injected: false,
		});
		expect(notDue.issues.map((issue) => issue.code)).not.toContain(
			"author-note-interval",
		);

		const due = mapStPreset({
			preset: basePreset,
			card,
			structuredOutput: "text-tags",
			authorNote: noteReset(1, 2),
			playerMessageCount: 4,
		});
		expect(due.injections).toContainEqual({
			identifier: "author-note",
			role: "user",
			content: "注释正文",
			depth: 2,
			order: 100,
			source: "extension",
		});

		const unknownCount = mapStPreset({
			preset: basePreset,
			card,
			structuredOutput: "text-tags",
			authorNote: noteReset(1, 2),
		});
		expect(unknownCount.authorNote?.injected).toBe(false);
		expect(unknownCount.issues).toContainEqual({
			code: "author-note-interval",
			detail: "2:player-message-count-missing",
		});
	});

	it("没有主提示时提示词内与主提示前的位置无法应用", () => {
		const noMain = preset({
			prompts: [prompt("chatHistory", { marker: true })],
			prompt_order: [enabledOrder(["chatHistory"])],
		});
		const mapping = mapStPreset({
			preset: noMain,
			card,
			structuredOutput: "text-tags",
			authorNote: noteReset(0),
		});
		expect(mapping.authorNote?.injected).toBe(false);
		expect(mapping.issues).toContainEqual({
			code: "author-note-placement",
			detail: "in-prompt:main-missing",
		});
	});
});

describe("预填充、squash 与采样参数", () => {
	const parsed = preset({
		temperature: 0.65,
		top_p: 0.9,
		top_k: 40,
		frequency_penalty: 0.2,
		openai_max_tokens: 2048,
		openai_max_context: 8192,
		seed: -1,
		n: 1,
		reasoning_effort: "high",
		assistant_prefill: "好的",
		continue_prefill: true,
		continue_postfix: " ",
		squash_system_messages: true,
		prompts: [prompt("main", { content: "主提示正文" })],
		prompt_order: [enabledOrder(["main"])],
	});

	it("能映射的采样字段进入结果，其余逐条说明", () => {
		const mapping = mapStPreset({
			preset: parsed,
			card,
			structuredOutput: "text-tags",
		});
		expect(mapping.sampling).toEqual({
			temperature: 0.65,
			maxTokens: 2048,
			reasoning: "high",
			unsupported: [
				"top_p",
				"top_k",
				"frequency_penalty",
				"seed",
				"n",
				"openai_max_context",
			],
		});
		expect(mapping.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"sampling:top_p",
				"sampling:top_k",
				"sampling:frequency_penalty",
				"sampling:seed",
				"sampling:n",
				"sampling:openai_max_context",
			]),
		);
	});

	it("预填充、续写与 squash 保留原值并说明原生不支持", () => {
		const mapping = mapStPreset({
			preset: parsed,
			card,
			structuredOutput: "text-tags",
		});
		expect(mapping.prefill).toEqual({
			assistantPrefill: "好的",
			continuePrefill: true,
			continuePostfix: " ",
			squashedSystemMessages: true,
		});
		expect(mapping.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"assistant-prefill",
				"continue-prefill",
				"squash-system-messages",
			]),
		);
	});

	it("未知思考档位进入不支持列表", () => {
		const mapping = mapStPreset({
			preset: preset({
				reasoning_effort: "auto",
				prompts: [prompt("main", { content: "主提示正文" })],
				prompt_order: [enabledOrder(["main"])],
			}),
			card,
			structuredOutput: "text-tags",
		});
		expect(mapping.sampling.reasoning).toBeNull();
		expect(mapping.sampling.unsupported).toContain("reasoning_effort");
		expect(mapping.issues).toContainEqual({
			code: "sampling:reasoning_effort",
			detail: "auto",
		});
	});
});

describe("兼容报告不含正文", () => {
	it("条目、问题与格式报告只有标识、字符数与原因", () => {
		const mapping = mapStPreset({
			preset: preset({
				scenario_format: "[场景]{{scenario}}",
				prompts: [
					prompt("main", { content: "预设主提示正文" }),
					prompt("charDescription", { marker: true }),
					prompt("scenario", { marker: true }),
					prompt("injected", {
						content: "注入正文",
						injection_position: 1,
						injection_depth: 1,
					}),
				],
				prompt_order: [
					enabledOrder(["main", "charDescription", "scenario", "injected"]),
				],
			}),
			card,
			structuredOutput: "text-tags",
			authorNote: readStAuthorNote({
				note_prompt: "作者注释正文",
				note_position: 1,
			}),
		});
		const report = JSON.stringify({
			entries: mapping.entries,
			issues: mapping.issues,
			sampling: mapping.sampling,
			prefill: mapping.prefill,
			formats: mapping.formats,
		});
		expect(report).not.toContain("卡片系统提示");
		expect(report).not.toContain("角色描述正文");
		expect(report).not.toContain("注入正文");
		expect(report).not.toContain("作者注释正文");
	});
});

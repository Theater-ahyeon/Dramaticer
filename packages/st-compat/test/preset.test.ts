import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "../src/index.js";
import { parsePresetFile, parsePresetJson } from "../src/index.js";

const mainPrompt: JsonObject = {
	identifier: "main",
	name: "主任务",
	content: "你是一个讲述者。",
	role: "system",
	system_prompt: false,
	marker: false,
	enabled: false,
	forbid_overrides: true,
	injection_position: 1,
	injection_depth: 2,
	injection_order: 100,
	injection_trigger: ["开场"],
	attach_index: 1,
	attach_role: "user",
	attach_side: "end",
	extra: { 派生: true },
	未知: "保留",
};

const markerPrompt: JsonObject = {
	identifier: "worldInfoBefore",
	name: "世界书前",
	system_prompt: true,
	marker: true,
};

const regexScript: JsonObject = {
	id: "script-1",
	scriptName: "删除思考",
	findRegex: "/<thinking>([\\s\\S]*?)<\\/thinking>/g",
	replaceString: "",
	trimStrings: ["<thinking>"],
	placement: [2, 6],
	disabled: false,
	markdownOnly: false,
	promptOnly: true,
	runOnEdit: true,
	substituteRegex: 1,
	minDepth: 2,
	maxDepth: null,
};

const preset: JsonObject = {
	name: "测试预设",
	temperature: 0.9,
	top_p: 0.95,
	top_k: 40,
	top_a: 0,
	min_p: 0,
	frequency_penalty: 0.2,
	presence_penalty: 0.3,
	repetition_penalty: 1.05,
	openai_max_tokens: 8192,
	openai_max_context: 100000,
	seed: -1,
	n: 1,
	reasoning_effort: "medium",
	assistant_prefill: "思考已结束。",
	assistant_impersonation: "",
	prompts: [mainPrompt, markerPrompt],
	prompt_order: [
		{
			character_id: 100000,
			order: [
				{ identifier: "main", enabled: true, 备注: "顺序" },
				{ identifier: "worldInfoBefore", enabled: false },
			],
		},
		{ character_id: 100001, order: [] },
	],
	extensions: {
		regex_scripts: [regexScript],
		tavern_helper: { scripts: [] },
	},
	未知字段: { 值: [1, 2, 3] },
};

describe("parsePresetJson", () => {
	it("解析采样参数、预填充和名字", () => {
		const parsed = parsePresetJson(JSON.stringify(preset));
		expect(parsed.name).toBe("测试预设");
		expect(parsed.temperature).toBe(0.9);
		expect(parsed.topP).toBe(0.95);
		expect(parsed.topK).toBe(40);
		expect(parsed.topA).toBe(0);
		expect(parsed.minP).toBe(0);
		expect(parsed.frequencyPenalty).toBe(0.2);
		expect(parsed.presencePenalty).toBe(0.3);
		expect(parsed.repetitionPenalty).toBe(1.05);
		expect(parsed.maxTokens).toBe(8192);
		expect(parsed.contextSize).toBe(100000);
		expect(parsed.seed).toBe(-1);
		expect(parsed.n).toBe(1);
		expect(parsed.reasoningEffort).toBe("medium");
		expect(parsed.assistantPrefill).toBe("思考已结束。");
		expect(parsed.assistantImpersonation).toBe("");
	});

	it("解析 prompt 的注入和固定字段", () => {
		const parsed = parsePresetJson(JSON.stringify(preset));
		expect(parsed.prompts).toHaveLength(2);
		const [main, marker] = parsed.prompts;
		expect(main?.identifier).toBe("main");
		expect(main?.name).toBe("主任务");
		expect(main?.content).toBe("你是一个讲述者。");
		expect(main?.role).toBe("system");
		expect(main?.systemPrompt).toBe(false);
		expect(main?.marker).toBe(false);
		expect(main?.enabled).toBe(false);
		expect(main?.forbidOverrides).toBe(true);
		expect(main?.injectionPosition).toBe(1);
		expect(main?.injectionDepth).toBe(2);
		expect(main?.injectionOrder).toBe(100);
		expect(main?.injectionTrigger).toEqual(["开场"]);
		expect(main?.attachIndex).toBe(1);
		expect(main?.attachRole).toBe("user");
		expect(main?.attachSide).toBe("end");
		expect(main?.extra).toEqual({ 派生: true });
		expect(marker?.marker).toBe(true);
		expect(marker?.systemPrompt).toBe(true);
		expect(marker?.content).toBe("");
		expect(marker?.role).toBeNull();
		expect(marker?.enabled).toBe(true);
		expect(marker?.injectionDepth).toBeNull();
		expect(marker?.extra).toBeNull();
	});

	it("解析 prompt_order", () => {
		const parsed = parsePresetJson(JSON.stringify(preset));
		expect(parsed.promptOrder).toHaveLength(2);
		const [global, character] = parsed.promptOrder;
		expect(global?.characterId).toBe(100000);
		expect(global?.order).toEqual([
			{
				identifier: "main",
				enabled: true,
				raw: { identifier: "main", enabled: true, 备注: "顺序" },
			},
			{
				identifier: "worldInfoBefore",
				enabled: false,
				raw: { identifier: "worldInfoBefore", enabled: false },
			},
		]);
		expect(character?.characterId).toBe(100001);
		expect(character?.order).toEqual([]);
	});

	it("解析正则脚本", () => {
		const parsed = parsePresetJson(JSON.stringify(preset));
		expect(parsed.regexScripts).toHaveLength(1);
		expect(parsed.regexScripts[0]).toMatchObject({
			id: "script-1",
			scriptName: "删除思考",
			findRegex: "/<thinking>([\\s\\S]*?)<\\/thinking>/g",
			replaceString: "",
			trimStrings: ["<thinking>"],
			placement: [2, 6],
			disabled: false,
			markdownOnly: false,
			promptOnly: true,
			runOnEdit: true,
			substituteRegex: 1,
			minDepth: 2,
			maxDepth: null,
		});
	});

	it("不认识的字段留在 raw 里", () => {
		const parsed = parsePresetJson(JSON.stringify(preset));
		expect(parsed.raw.未知字段).toEqual({ 值: [1, 2, 3] });
		expect((parsed.prompts[0]?.raw as JsonObject).未知).toBe("保留");
	});

	it("扩展、prompt、prompt_order 和 raw 共用原始对象", () => {
		const parsed = parsePresetJson(JSON.stringify(preset));
		expect(parsed.extensions).toBe(parsed.raw.extensions);
		const rawPrompts = parsed.raw.prompts as JsonObject[];
		expect(parsed.prompts[0]?.raw).toBe(rawPrompts[0]);
		const rawOrder = (parsed.raw.prompt_order as JsonObject[])[0] as JsonObject;
		expect(parsed.promptOrder[0]?.raw).toBe(rawOrder);
		expect(parsed.regexScripts[0]?.raw).toBe(
			((parsed.raw.extensions as JsonObject).regex_scripts as JsonObject[])[0],
		);
	});

	it("解析之后再序列化，结构不变", () => {
		const parsed = parsePresetJson(JSON.stringify(preset));
		expect(JSON.parse(JSON.stringify(parsed.raw))).toEqual(preset);
	});

	it("字段缺失时给出空值", () => {
		const parsed = parsePresetJson("{}");
		expect(parsed.name).toBeNull();
		expect(parsed.temperature).toBeNull();
		expect(parsed.prompts).toEqual([]);
		expect(parsed.promptOrder).toEqual([]);
		expect(parsed.regexScripts).toEqual([]);
		expect(parsed.extensions).toEqual({});
	});

	it("额度配置是数字字符串时转成数字", () => {
		const parsed = parsePresetJson('{"openai_max_context":"666693"}');
		expect(parsed.contextSize).toBe(666693);
		expect(parsed.raw.openai_max_context).toBe("666693");
	});

	it("解析带 BOM 的文件", () => {
		const parsed = parsePresetJson(`\uFEFF${JSON.stringify(preset)}`);
		expect(parsed.prompts).toHaveLength(2);
	});

	it("非法 JSON 和字段类型错误都会报错", () => {
		expect(() => parsePresetJson("{草稿")).toThrow(/不是合法 JSON/);
		expect(() => parsePresetJson("[]")).toThrow(/必须是 JSON 对象/);
		expect(() => parsePresetJson('{"prompts":{}}')).toThrow(
			/"prompts" 不是数组/,
		);
		expect(() => parsePresetJson('{"prompts":[1]}')).toThrow(
			/"prompts\[0\]" 不是 JSON 对象/,
		);
		expect(() => parsePresetJson('{"prompts":[{"role":2}]}')).toThrow(/"role"/);
		expect(() =>
			parsePresetJson('{"prompts":[{"injection_trigger":{}}]}'),
		).toThrow(/"injection_trigger"/);
		expect(() => parsePresetJson('{"prompt_order":{}}')).toThrow(
			/"prompt_order" 不是数组/,
		);
		expect(() => parsePresetJson('{"prompt_order":[1]}')).toThrow(
			/"prompt_order\[0\]" 不是 JSON 对象/,
		);
		expect(() => parsePresetJson('{"prompt_order":[{"order":{}}]}')).toThrow(
			/"prompt_order\[0\]\.order" 不是数组/,
		);
		expect(() =>
			parsePresetJson('{"prompt_order":[{"order":[{"enabled":1}]}]}'),
		).toThrow(/"enabled"/);
		expect(() =>
			parsePresetJson('{"extensions":{"regex_scripts":{}}}'),
		).toThrow(/"extensions\.regex_scripts" 不是数组/);
		expect(() =>
			parsePresetJson('{"extensions":{"regex_scripts":[1]}}'),
		).toThrow(/"extensions\.regex_scripts\[0\]" 不是 JSON 对象/);
		expect(() =>
			parsePresetJson('{"extensions":{"regex_scripts":[{"placement":["2"]}]}}'),
		).toThrow(/"placement\[0\]"/);
		expect(() => parsePresetJson('{"temperature":"高"}')).toThrow(
			/"temperature"/,
		);
	});
});

describe("parsePresetFile", () => {
	it("从文件解析预设", async () => {
		const dir = await mkdtemp(
			join(dirname(fileURLToPath(import.meta.url)), ".tmp-preset-"),
		);
		try {
			const path = join(dir, "预设.json");
			await writeFile(path, JSON.stringify(preset));
			const parsed = await parsePresetFile(path);
			expect(parsed.name).toBe("测试预设");
			expect(parsed.regexScripts).toHaveLength(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("读取失败会报告路径", async () => {
		const dir = await mkdtemp(
			join(dirname(fileURLToPath(import.meta.url)), ".tmp-preset-"),
		);
		try {
			const path = join(dir, "损坏.json");
			await writeFile(path, "{");
			await expect(parsePresetFile(path)).rejects.toThrow(
				/解析预设失败.*损坏\.json/,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

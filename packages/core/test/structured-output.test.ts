import { describe, expect, it } from "vitest";
import {
	type LlmModelProbe,
	type LlmToolCall,
	PLOT_NOTE_SCHEMA,
	STATE_UPDATE_SCHEMA,
	STRUCTURED_OUTPUT_TOOLS,
	collectStructuredOutputFromText,
	collectStructuredOutputFromToolCalls,
	resolveStructuredOutputMode,
	validateStructuredPayload,
} from "../src/index.js";

function toolCall(
	name: string,
	args: Record<string, unknown>,
	id = `call-${name}`,
): LlmToolCall {
	return { id, name, arguments: args };
}

function probe(structuredOutput: "function-call" | "text-tags"): LlmModelProbe {
	return {
		probedAt: "2026-11-07T00:00:00.000Z",
		channel: "main",
		modelId: "test-model",
		streaming: "streaming",
		functionCalling:
			structuredOutput === "function-call" ? "supported" : "unsupported",
		thinking: "supported",
		prefill: "unsupported",
		usage: "supported",
		cacheStats: "supported",
		structuredOutput,
		notes: [],
	};
}

describe("validateStructuredPayload", () => {
	it("接受合法的 set，包括 null 值", () => {
		expect(
			validateStructuredPayload("state_update", {
				path: ["角色", "卫宫", "好感度"],
				op: "set",
				value: 42,
				reason: "共同经历",
			}),
		).toEqual({
			ok: true,
			payload: {
				name: "state_update",
				value: {
					path: ["角色", "卫宫", "好感度"],
					op: "set",
					value: 42,
					reason: "共同经历",
				},
			},
		});
		expect(
			validateStructuredPayload("state_update", {
				path: ["a"],
				op: "set",
				value: null,
			}),
		).toEqual({
			ok: true,
			payload: {
				name: "state_update",
				value: { path: ["a"], op: "set", value: null, reason: null },
			},
		});
	});

	it("接受不带 value 的 delete，并拒绝带 value 的 delete", () => {
		expect(
			validateStructuredPayload("state_update", {
				path: ["角色", "卫宫"],
				op: "delete",
			}),
		).toEqual({
			ok: true,
			payload: {
				name: "state_update",
				value: {
					path: ["角色", "卫宫"],
					op: "delete",
					value: null,
					reason: null,
				},
			},
		});
		const invalid = validateStructuredPayload("state_update", {
			path: ["a"],
			op: "delete",
			value: 1,
		});
		expect(invalid.ok).toBe(false);
		expect(invalid.ok ? "" : invalid.reason).toContain("不能带 value");
	});

	it("拒绝 set 缺少 value", () => {
		const result = validateStructuredPayload("state_update", {
			path: ["a"],
			op: "set",
		});
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.reason).toContain("必须有 value");
	});

	it("拒绝非法 path：缺失、空数组、非字符串元素、空元素", () => {
		const reasons = [
			{ path: undefined, op: "delete" },
			{ path: [], op: "delete" },
			{ path: ["a", 3], op: "delete" },
			{ path: ["a", "  "], op: "delete" },
		].map((payload) => {
			const result = validateStructuredPayload("state_update", payload);
			expect(result.ok).toBe(false);
			return result.ok ? "" : result.reason;
		});

		expect(reasons[0]).toContain("path 不能为空");
		expect(reasons[1]).toContain("path 不能为空");
		expect(reasons[2]).toContain("path[1] 必须是字符串");
		expect(reasons[3]).toContain("path[1] 不能为空");
	});

	it("去掉路径段两端的空白", () => {
		const result = validateStructuredPayload("state_update", {
			path: ["  角色  "],
			op: "delete",
		});
		expect(result).toMatchObject({
			ok: true,
			payload: { value: { path: ["角色"] } },
		});
	});

	it("拒绝会污染原型链的路径段", () => {
		for (const segment of ["__proto__", "constructor", "prototype"]) {
			const result = validateStructuredPayload("state_update", {
				path: [segment],
				op: "delete",
			});
			expect(result.ok).toBe(false);
			expect(result.ok ? "" : result.reason).toContain("保留名");
		}
	});

	it("拒绝未知字段与非法 op，并给出原因", () => {
		const unknown = validateStructuredPayload("state_update", {
			path: ["a"],
			op: "delete",
			extra: 1,
		});
		expect(unknown.ok ? "" : unknown.reason).toContain("未知字段 extra");

		const badOp = validateStructuredPayload("state_update", {
			path: ["a"],
			op: "add",
		});
		expect(badOp.ok ? "" : badOp.reason).toContain("op 必须是 set 或 delete");
	});

	it("把空字符串 reason 归一化为 null，拒绝其他类型", () => {
		expect(
			validateStructuredPayload("state_update", {
				path: ["a"],
				op: "delete",
				reason: "  ",
			}),
		).toMatchObject({ ok: true, payload: { value: { reason: null } } });

		const numeric = validateStructuredPayload("state_update", {
			path: ["a"],
			op: "delete",
			reason: 7,
		});
		expect(numeric.ok ? "" : numeric.reason).toContain(
			"reason 必须是字符串或 null",
		);
	});

	it("plot_note 要求非空 text，并拒绝未知字段", () => {
		expect(
			validateStructuredPayload("plot_note", { text: " 井底裂缝 " }),
		).toEqual({
			ok: true,
			payload: { name: "plot_note", value: { text: "井底裂缝" } },
		});

		const empty = validateStructuredPayload("plot_note", { text: "   " });
		expect(empty.ok ? "" : empty.reason).toContain("text 不能为空");

		const missing = validateStructuredPayload("plot_note", {});
		expect(missing.ok ? "" : missing.reason).toContain("text 必须是字符串");

		const extra = validateStructuredPayload("plot_note", {
			text: "x",
			source: "y",
		});
		expect(extra.ok ? "" : extra.reason).toContain("未知字段 source");
	});

	it("拒绝不是 JSON 对象的负载", () => {
		expect(validateStructuredPayload("state_update", [1, 2])).toEqual({
			ok: false,
			reason: "state_update 必须是 JSON 对象",
		});
		expect(validateStructuredPayload("plot_note", null)).toEqual({
			ok: false,
			reason: "plot_note 必须是 JSON 对象",
		});
	});
});

describe("结构化输出收集", () => {
	const update = {
		path: ["角色", "卫宫", "好感度"],
		op: "set",
		value: 42,
		reason: "共同经历",
	};
	const note = { text: "福伯在井底发现裂缝" };

	it("函数调用与文本标签两种模式产出同样的结构", () => {
		const fromCalls = collectStructuredOutputFromToolCalls([
			toolCall("state_update", update, "a"),
			toolCall("plot_note", note, "b"),
		]);
		const fromTags = collectStructuredOutputFromText(
			`正文。\n<state_update>${JSON.stringify(update)}</state_update>\n<plot_note>${JSON.stringify(note)}</plot_note>`,
		);

		expect(fromTags).toEqual({ ...fromCalls, mode: "text-tags" });
		expect(fromCalls).toEqual({
			mode: "function-call",
			stateUpdates: [
				{
					path: ["角色", "卫宫", "好感度"],
					op: "set",
					value: 42,
					reason: "共同经历",
				},
			],
			notes: [{ text: "福伯在井底发现裂缝" }],
			issues: [],
		});
	});

	it("函数调用模式忽略读取类工具与非法参数", () => {
		const result = collectStructuredOutputFromToolCalls([
			toolCall("memory_search", { query: "井底" }, "a"),
			toolCall("state_update", { path: [], op: "delete" }, "b"),
		]);
		expect(result.stateUpdates).toEqual([]);
		expect(result.notes).toEqual([]);
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]).toMatchObject({
			payload: "state_update",
			reason: expect.stringContaining("path 不能为空"),
		});
	});

	it("函数调用的参数不是对象时记录原因", () => {
		const result = collectStructuredOutputFromToolCalls([
			{
				id: "a",
				name: "plot_note",
				arguments: null as unknown as Record<string, unknown>,
			},
		]);
		expect(result.issues).toEqual([
			{
				payload: "plot_note",
				raw: null,
				reason: "plot_note 必须是 JSON 对象",
			},
		]);
	});

	it("文本标签模式只取已闭合的块，未闭合的块记为拒绝", () => {
		const result = collectStructuredOutputFromText(
			'正文。\n<state_update>{"path":["a"],"op":"delete"}',
		);
		expect(result.stateUpdates).toEqual([]);
		expect(result.issues).toEqual([
			{
				payload: "state_update",
				raw: '{"path":["a"],"op":"delete"}',
				reason: "state_update 块没有闭合",
			},
		]);
	});

	it("文本标签里的内容不是 JSON 时记录原因与原文", () => {
		const result = collectStructuredOutputFromText(
			"<plot_note>井底裂缝</plot_note>",
		);
		expect(result.notes).toEqual([]);
		expect(result.issues[0]?.payload).toBe("plot_note");
		expect(result.issues[0]?.raw).toBe("井底裂缝");
		expect(result.issues[0]?.reason).toContain("不是合法 JSON");
	});

	it("文本标签里的 JSON 通过校验后按块顺序收集", () => {
		const result = collectStructuredOutputFromText(
			[
				`<state_update>{"path":["时间"],"op":"set","value":"黄昏"}</state_update>`,
				`<plot_note>{"text":"裂缝在扩大"}</plot_note>`,
				`<state_update>{"path":["地点"],"op":"set","value":"井底"}</state_update>`,
			].join(""),
		);
		expect(result.stateUpdates.map((item) => item.path)).toEqual([
			["时间"],
			["地点"],
		]);
		expect(result.notes).toEqual([{ text: "裂缝在扩大" }]);
	});

	it("文本标签模式忽略其他块，并收集嵌套在其他块里的写入块", () => {
		const result = collectStructuredOutputFromText(
			[
				"<thinking>想一下</thinking>",
				"<选项>甲\n乙</选项>",
				'<旁白><plot_note>{"text":"远处有人"}</plot_note></旁白>',
			].join(""),
		);
		expect(result.notes).toEqual([{ text: "远处有人" }]);
		expect(result.issues).toEqual([]);
	});

	it("空块内容记为拒绝", () => {
		const result = collectStructuredOutputFromText(
			"<state_update>   </state_update>",
		);
		expect(result.issues[0]?.reason).toContain("块内容为空");
	});
});

describe("结构化输出的模式选择", () => {
	it("优先使用体检结果", () => {
		expect(resolveStructuredOutputMode(probe("function-call"))).toBe(
			"function-call",
		);
		expect(resolveStructuredOutputMode(probe("text-tags"))).toBe("text-tags");
	});

	it("没有体检结果时回退到文本标签", () => {
		expect(resolveStructuredOutputMode(null)).toBe("text-tags");
	});

	it("工具定义与校验器的字段约束一致", () => {
		expect(STRUCTURED_OUTPUT_TOOLS.map((tool) => tool.name)).toEqual([
			"state_update",
			"plot_note",
		]);
		expect(STATE_UPDATE_SCHEMA.required).toEqual(["path", "op"]);
		expect(PLOT_NOTE_SCHEMA.required).toEqual(["text"]);
		expect(STATE_UPDATE_SCHEMA.additionalProperties).toBe(false);
		expect(PLOT_NOTE_SCHEMA.additionalProperties).toBe(false);
	});
});

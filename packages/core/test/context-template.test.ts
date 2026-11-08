import { describe, expect, it } from "vitest";
import {
	assertContextCondition,
	assertContextTemplate,
	createBlockFormatSegment,
	createDefaultContextTemplate,
} from "../src/index.js";
import type { ContextCondition, ContextTemplate } from "../src/index.js";

function templateWith(condition: unknown): ContextTemplate {
	return {
		id: "with-condition",
		segments: [
			{
				id: "lore",
				kind: "slot",
				slot: "lore",
				when: condition as ContextCondition,
			},
			{ id: "protocol", kind: "static", text: "契约" },
		],
	};
}

describe("模板条件校验", () => {
	it("五种条件都能通过校验", () => {
		const conditions: readonly ContextCondition[] = [
			{ kind: "switch", name: "director" },
			{ kind: "state", path: ["角色", "卫宫", "好感度"], op: "exists" },
			{
				kind: "all",
				conditions: [
					{ kind: "switch", name: "memory", equals: false },
					{ kind: "state", path: ["场景"], op: "equals", value: "山门" },
				],
			},
			{ kind: "any", conditions: [] },
			{ kind: "not", condition: { kind: "switch", name: "secret" } },
		];
		for (const condition of conditions) {
			expect(() => assertContextCondition(condition)).not.toThrow();
			expect(() =>
				assertContextTemplate(templateWith(condition)),
			).not.toThrow();
		}
	});

	it("switch 名字为空、equals 非布尔时拒绝", () => {
		expect(() =>
			assertContextTemplate(templateWith({ kind: "switch", name: "" })),
		).toThrow("上下文片段 lore 的 when 的 switch.name 必须是非空字符串");
		expect(() =>
			assertContextTemplate(
				templateWith({ kind: "switch", name: "director", equals: "yes" }),
			),
		).toThrow("switch.equals 必须是布尔值");
	});

	it("state 路径与操作符非法时拒绝", () => {
		expect(() =>
			assertContextTemplate(
				templateWith({ kind: "state", path: [], op: "exists" }),
			),
		).toThrow("state.path 必须是非空的字符串数组");
		expect(() =>
			assertContextTemplate(
				templateWith({ kind: "state", path: ["场景", ""], op: "exists" }),
			),
		).toThrow("state.path 必须是非空的字符串数组");
		expect(() =>
			assertContextTemplate(
				templateWith({ kind: "state", path: ["场景"], op: "greater" }),
			),
		).toThrow("state.op 必须是 exists、equals 或 truthy");
	});

	it("all/any 的子条件逐个校验，并指出第几个", () => {
		expect(() =>
			assertContextTemplate(
				templateWith({
					kind: "all",
					conditions: [
						{ kind: "switch", name: "ok" },
						{ kind: "switch", name: " " },
					],
				}),
			),
		).toThrow("第 2 个子条件");
		expect(() =>
			assertContextTemplate(templateWith({ kind: "any", conditions: "nope" })),
		).toThrow("any.conditions 必须是数组");
		expect(() =>
			assertContextTemplate(
				templateWith({ kind: "not", condition: undefined }),
			),
		).toThrow("not 子条件 必须是对象");
	});

	it("未知条件类型被拒绝", () => {
		expect(() =>
			assertContextTemplate(templateWith({ kind: "weather" })),
		).toThrow("未知的条件类型");
	});
});

describe("block_format 段", () => {
	it("两种结构化输出各有自己的格式说明", () => {
		const tags = createBlockFormatSegment("text-tags");
		const calls = createBlockFormatSegment("function-call");
		expect(tags.id).toBe("block_format");
		expect(tags.kind).toBe("static");
		expect(tags.priority).toBe(95);
		expect(tags.text).toContain("<state_update>");
		expect(calls.text).toContain("state_update");
		expect(calls.text).not.toContain("<state_update>");
	});

	it("默认模板开启 block format 时该段位于 protocol 之前", () => {
		const template = createDefaultContextTemplate({
			structuredOutput: "text-tags",
			blockFormat: true,
		});
		expect(template.segments.at(-2)?.id).toBe("block_format");
		expect(template.segments.at(-1)?.id).toBe("protocol");
	});
});

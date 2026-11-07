import { describe, expect, it } from "vitest";
import {
	type ContextCondition,
	type ContextSlotContent,
	type ContextSlotProvider,
	type ContextTemplate,
	assembleContext,
	evaluateContextCondition,
} from "../src/index.js";

const lengthTokens = (text: string): number => text.length;

const baseTemplate: ContextTemplate = {
	id: "native",
	segments: [
		{ kind: "static", id: "protocol", text: "协议", priority: 100 },
		{ kind: "slot", id: "character", slot: "character", priority: 50 },
		{ kind: "slot", id: "history", slot: "history", priority: 1 },
	],
};

function slot(
	messages: readonly {
		role: "system" | "user" | "assistant";
		content: string;
	}[],
	source = "测试槽位",
): ContextSlotProvider {
	return { provide: () => ({ messages, source }) };
}

describe("assembleContext", () => {
	it("按模板顺序输出静态段与槽位消息，并在 Trace 里记录来源和 token 数", async () => {
		const result = await assembleContext({
			template: baseTemplate,
			budgetTokens: 1_000,
			storyId: "story-1",
			tokenEstimator: lengthTokens,
			providers: {
				character: slot(
					[{ role: "system", content: "角色卡" }],
					"角色卡：1 张",
				),
				history: slot(
					[
						{ role: "user", content: "你好" },
						{ role: "assistant", content: "晚上好" },
					],
					"最近 2 楼",
				),
			},
		});

		expect(result.messages).toEqual([
			{ role: "system", content: "协议" },
			{ role: "system", content: "角色卡" },
			{ role: "user", content: "你好" },
			{ role: "assistant", content: "晚上好" },
		]);
		expect(result.trace.totalTokens).toBe(2 + 3 + 2 + 3);
		expect(result.trace.entries).toEqual([
			{
				segmentId: "protocol",
				kind: "static",
				slot: null,
				source: "template:native/protocol",
				priority: 100,
				tokens: 2,
				status: "included",
			},
			{
				segmentId: "character",
				kind: "slot",
				slot: "character",
				source: "角色卡：1 张",
				priority: 50,
				tokens: 3,
				status: "included",
			},
			{
				segmentId: "history",
				kind: "slot",
				slot: "history",
				source: "最近 2 楼",
				priority: 1,
				tokens: 5,
				status: "included",
			},
		]);
		expect(result.segments.map((segment) => segment.segmentId)).toEqual([
			"protocol",
			"character",
			"history",
		]);
	});

	it("条件不满足时跳过片段，并且不调用槽位提供者", async () => {
		let called = 0;
		const template: ContextTemplate = {
			id: "conditional",
			segments: [
				{ kind: "static", id: "base", text: "基础" },
				{
					kind: "static",
					id: "director",
					text: "导演指令",
					when: { kind: "switch", name: "director" },
				},
				{
					kind: "slot",
					id: "memory",
					slot: "memory",
					when: { kind: "switch", name: "memory" },
				},
			],
		};
		const provider: ContextSlotProvider = {
			provide: () => {
				called += 1;
				return {
					messages: [{ role: "system", content: "记忆" }],
					source: "记忆",
				};
			},
		};

		const result = await assembleContext({
			template,
			budgetTokens: 100,
			storyId: "story-1",
			switches: { director: false, memory: false },
			providers: { memory: provider },
			tokenEstimator: lengthTokens,
		});

		expect(called).toBe(0);
		expect(result.messages).toEqual([{ role: "system", content: "基础" }]);
		expect(result.trace.entries.slice(1).map((entry) => entry.status)).toEqual([
			"condition-false",
			"condition-false",
		]);
		expect(result.trace.entries[1]?.tokens).toBe(0);
	});

	it("缺失槽位被记录为 missing-slot，其余片段照常组装", async () => {
		const result = await assembleContext({
			template: baseTemplate,
			budgetTokens: 100,
			storyId: "story-1",
			tokenEstimator: lengthTokens,
			providers: { character: slot([{ role: "system", content: "角色卡" }]) },
		});

		expect(result.messages).toEqual([
			{ role: "system", content: "协议" },
			{ role: "system", content: "角色卡" },
		]);
		const history = result.trace.entries.find(
			(entry) => entry.segmentId === "history",
		);
		expect(history).toMatchObject({
			status: "missing-slot",
			source: "slot:history",
			tokens: 0,
		});
	});

	it("提供者返回 null 或空消息都算缺失槽位", async () => {
		const template: ContextTemplate = {
			id: "empty",
			segments: [
				{ kind: "slot", id: "summary", slot: "summary" },
				{ kind: "slot", id: "memory", slot: "memory" },
			],
		};
		const result = await assembleContext({
			template,
			budgetTokens: 100,
			storyId: "story-1",
			providers: {
				summary: { provide: () => null },
				memory: { provide: () => ({ messages: [], source: "没有记忆" }) },
			},
			tokenEstimator: lengthTokens,
		});

		expect(result.messages).toEqual([]);
		expect(result.trace.entries.map((entry) => entry.status)).toEqual([
			"missing-slot",
			"missing-slot",
		]);
	});

	it("按优先级裁剪预算，并在输出里恢复模板顺序", async () => {
		const template: ContextTemplate = {
			id: "budget",
			segments: [
				{ kind: "static", id: "first", text: "甲".repeat(100), priority: 10 },
				{ kind: "static", id: "large", text: "乙".repeat(300), priority: 5 },
				{ kind: "static", id: "third", text: "丙".repeat(100), priority: 1 },
			],
		};
		const result = await assembleContext({
			template,
			budgetTokens: 250,
			storyId: "story-1",
			tokenEstimator: lengthTokens,
		});

		expect(result.segments.map((segment) => segment.segmentId)).toEqual([
			"first",
			"third",
		]);
		expect(result.messages.map((message) => message.content)).toEqual([
			"甲".repeat(100),
			"丙".repeat(100),
		]);
		expect(result.trace.totalTokens).toBe(200);
		expect(result.trace.entries.map((entry) => entry.status)).toEqual([
			"included",
			"budget-dropped",
			"included",
		]);
		expect(result.trace.entries[1]?.tokens).toBe(300);
	});

	it("预算正好等于片段 token 数时仍然保留", async () => {
		const template: ContextTemplate = {
			id: "exact",
			segments: [{ kind: "static", id: "only", text: "abcd" }],
		};
		const result = await assembleContext({
			template,
			budgetTokens: 4,
			storyId: "story-1",
			tokenEstimator: lengthTokens,
		});

		expect(result.trace.entries[0]?.status).toBe("included");
		expect(result.trace.totalTokens).toBe(4);
	});

	it("同优先级时先保留模板里靠前的片段", async () => {
		const template: ContextTemplate = {
			id: "ties",
			segments: [
				{ kind: "static", id: "a", text: "aa" },
				{ kind: "static", id: "b", text: "bb" },
			],
		};
		const result = await assembleContext({
			template,
			budgetTokens: 2,
			storyId: "story-1",
			tokenEstimator: lengthTokens,
		});

		expect(result.trace.entries.map((entry) => entry.status)).toEqual([
			"included",
			"budget-dropped",
		]);
	});

	it("把组装参数传给槽位提供者，并支持异步提供者", async () => {
		let received: unknown = null;
		const template: ContextTemplate = {
			id: "request",
			segments: [{ kind: "slot", id: "state", slot: "state" }],
		};
		const result = await assembleContext({
			template,
			budgetTokens: 100,
			storyId: "story-7",
			nodeId: "node-3",
			switches: { memory: true },
			state: { 角色: { 好感度: 5 } },
			tokenEstimator: lengthTokens,
			providers: {
				state: {
					provide: async (request) => {
						received = request;
						return {
							messages: [{ role: "system", content: "好感度 5" }],
							source: "状态快照",
						};
					},
				},
			},
		});

		expect(received).toEqual({
			slot: "state",
			storyId: "story-7",
			nodeId: "node-3",
			switches: { memory: true },
			state: { 角色: { 好感度: 5 } },
		});
		expect(result.messages).toEqual([{ role: "system", content: "好感度 5" }]);
	});

	it("空模板得到空上下文", async () => {
		const result = await assembleContext({
			template: { id: "empty", segments: [] },
			budgetTokens: 0,
			storyId: "story-1",
		});
		expect(result.messages).toEqual([]);
		expect(result.trace.totalTokens).toBe(0);
	});

	it("拒绝重复的片段 id、空静态文本与非法预算", async () => {
		await expect(
			assembleContext({
				template: {
					id: "dup",
					segments: [
						{ kind: "static", id: "same", text: "甲" },
						{ kind: "static", id: "same", text: "乙" },
					],
				},
				budgetTokens: 10,
				storyId: "story-1",
			}),
		).rejects.toThrow("片段 id 重复：same");
		await expect(
			assembleContext({
				template: {
					id: "blank",
					segments: [{ kind: "static", id: "blank", text: "" }],
				},
				budgetTokens: 10,
				storyId: "story-1",
			}),
		).rejects.toThrow("静态文本必须是非空字符串");
		await expect(
			assembleContext({
				template: { id: "budget", segments: [] },
				budgetTokens: -1,
				storyId: "story-1",
			}),
		).rejects.toThrow("token 预算必须是非负整数");
		await expect(
			assembleContext({
				template: { id: "budget", segments: [] },
				budgetTokens: 1.5,
				storyId: "story-1",
			}),
		).rejects.toThrow("token 预算必须是非负整数");
	});

	it("拒绝提供者返回的非法消息", async () => {
		const template: ContextTemplate = {
			id: "invalid",
			segments: [{ kind: "slot", id: "lore", slot: "lore" }],
		};
		const build = (content: unknown) => {
			// 故意构造提供者的错误输出，验证组装器的运行时校验
			const invalidContent = content as ContextSlotContent;
			return assembleContext({
				template,
				budgetTokens: 100,
				storyId: "story-1",
				tokenEstimator: lengthTokens,
				providers: {
					lore: {
						provide: () => invalidContent,
					},
				},
			});
		};

		await expect(
			build({ messages: [{ role: "tool", content: "x" }], source: "检索" }),
		).rejects.toThrow("不合法的消息角色：tool");
		await expect(
			build({ messages: [{ role: "system", content: "" }], source: "检索" }),
		).rejects.toThrow("消息内容必须是非空字符串");
		await expect(
			build({ messages: [{ role: "system", content: "x" }], source: "" }),
		).rejects.toThrow("来源描述必须是非空字符串");
	});
});

describe("evaluateContextCondition", () => {
	const facts = {
		switches: { director: true },
		state: {
			角色: { 卫宫: { 好感度: 20, 已见面: true } },
			场景: ["集市"],
			空值: null,
		},
	};

	it("开关未设置时按 false 处理", () => {
		expect(
			evaluateContextCondition({ kind: "switch", name: "director" }, facts),
		).toBe(true);
		expect(
			evaluateContextCondition({ kind: "switch", name: "unknown" }, facts),
		).toBe(false);
		expect(
			evaluateContextCondition(
				{ kind: "switch", name: "unknown", equals: false },
				facts,
			),
		).toBe(true);
	});

	it("状态条件支持 exists、equals 与 truthy", () => {
		expect(
			evaluateContextCondition(
				{ kind: "state", path: ["角色", "卫宫", "好感度"], op: "exists" },
				facts,
			),
		).toBe(true);
		expect(
			evaluateContextCondition(
				{ kind: "state", path: ["角色", "卫宫", "不存在"], op: "exists" },
				facts,
			),
		).toBe(false);
		expect(
			evaluateContextCondition(
				{ kind: "state", path: ["空值"], op: "exists" },
				facts,
			),
		).toBe(true);
		expect(
			evaluateContextCondition(
				{
					kind: "state",
					path: ["角色", "卫宫", "好感度"],
					op: "equals",
					value: 20,
				},
				facts,
			),
		).toBe(true);
		expect(
			evaluateContextCondition(
				{
					kind: "state",
					path: ["角色", "卫宫", "好感度"],
					op: "equals",
					value: 21,
				},
				facts,
			),
		).toBe(false);
		expect(
			evaluateContextCondition(
				{ kind: "state", path: ["场景", "0"], op: "equals", value: "集市" },
				facts,
			),
		).toBe(true);
		expect(
			evaluateContextCondition(
				{ kind: "state", path: ["角色", "卫宫", "已见面"], op: "truthy" },
				facts,
			),
		).toBe(true);
		expect(
			evaluateContextCondition(
				{ kind: "state", path: ["空值"], op: "truthy" },
				facts,
			),
		).toBe(false);
		expect(
			evaluateContextCondition(
				{ kind: "state", path: ["角色"], op: "truthy" },
				facts,
			),
		).toBe(true);
	});

	it("组合条件支持 all、any 与 not", () => {
		const loved: ContextCondition = {
			kind: "state",
			path: ["角色", "卫宫", "好感度"],
			op: "equals",
			value: 20,
		};
		expect(
			evaluateContextCondition(
				{
					kind: "all",
					conditions: [loved, { kind: "switch", name: "director" }],
				},
				facts,
			),
		).toBe(true);
		expect(
			evaluateContextCondition(
				{
					kind: "any",
					conditions: [loved, { kind: "switch", name: "missing" }],
				},
				facts,
			),
		).toBe(true);
		expect(
			evaluateContextCondition({ kind: "not", condition: loved }, facts),
		).toBe(false);
	});

	it("非法路径抛错", () => {
		expect(() =>
			evaluateContextCondition(
				{ kind: "state", path: [], op: "exists" },
				facts,
			),
		).toThrow("path 必须是非空字符串数组");
	});
});

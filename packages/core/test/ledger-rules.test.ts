import { describe, expect, it } from "vitest";
import {
	RULE_CHECK_DIE,
	type StoryStore,
	buildSettlementMessages,
	executeRuleCheck,
	parseDramaticerRuleDeclarations,
	prepareSettlement,
	ruleResultLedgerPath,
	validateLedgerDiff,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

function rule(overrides: Record<string, unknown> = {}) {
	return {
		id: "sword",
		label: "剑术检定",
		target: "剑术",
		difficulty: 12,
		...overrides,
	};
}

function parseOne(overrides: Record<string, unknown> = {}) {
	const [declaration] = parseDramaticerRuleDeclarations([rule(overrides)]);
	if (declaration === undefined) throw new Error("规则声明没有解析出来");
	return declaration;
}

function requireWindow(value: unknown) {
	if (value === null || value === undefined) throw new Error("没有结算窗口");
	return value as NonNullable<typeof value>;
}

function seedStory(store: StoryStore): void {
	store.createStory({ id: "s1", title: "测试" });
	store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "山门打开。",
	});
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "a1",
		role: "user",
		raw: "我拔剑。",
	});
	store.appendNode({
		id: "a2",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "剑光一闪。",
	});
}

describe("规则声明解析", () => {
	it("解析检定与资源扣减参数", () => {
		const rules = parseDramaticerRuleDeclarations([
			rule({
				resource: { path: ["stat_data", "真气"], cost: 3 },
			}),
		]);
		expect(rules).toEqual([
			{
				id: "sword",
				label: "剑术检定",
				target: "剑术",
				difficulty: 12,
				resource: { path: ["stat_data", "真气"], cost: 3 },
			},
		]);
		expect(parseDramaticerRuleDeclarations(undefined)).toEqual([]);
	});

	it("未知字段、重复 id 与越界参数都指出字段", () => {
		expect(() =>
			parseDramaticerRuleDeclarations([rule({ extra: true })]),
		).toThrow(/rules\[0\]\.extra 是未知字段/);
		expect(() => parseDramaticerRuleDeclarations([rule(), rule()])).toThrow(
			/rules\[1\]\.id 重复：sword/,
		);
		expect(() =>
			parseDramaticerRuleDeclarations([rule({ difficulty: 0 })]),
		).toThrow(/rules\[0\]\.difficulty 必须是 1 到 20 之间的整数/);
		expect(() =>
			parseDramaticerRuleDeclarations([rule({ target: "  " })]),
		).toThrow(/rules\[0\]\.target 不能是空字符串/);
		expect(() =>
			parseDramaticerRuleDeclarations([
				rule({ resource: { path: [], cost: 1 } }),
			]),
		).toThrow(/rules\[0\]\.resource\.path 必须是非空字符串数组/);
		expect(() =>
			parseDramaticerRuleDeclarations([
				rule({ resource: { path: ["hp"], cost: 0 } }),
			]),
		).toThrow(/rules\[0\]\.resource\.cost 必须是正整数/);
	});
});

describe("检定执行", () => {
	it("骰点达到难度算成功，结果与资源余量写成台账写入", () => {
		const declaration = parseOne({
			resource: { path: ["stat_data", "真气"], cost: 3 },
		});
		const outcome = executeRuleCheck(declaration, {
			snapshot: { mvu: { stat_data: { 真气: 10 } } },
			roll: 12,
		});
		expect(outcome.success).toBe(true);
		expect(outcome.resource).toEqual({
			path: ["stat_data", "真气"],
			cost: 3,
			before: 10,
			after: 7,
		});
		expect(outcome.writes).toEqual([
			{ path: ["mvu", "stat_data", "真气"], value: 7 },
			{
				path: ["rule", "sword", "result"],
				value: { roll: 12, difficulty: 12, success: true },
			},
		]);
	});

	it("骰点低于难度算失败，资源照常扣减", () => {
		const declaration = parseOne({
			resource: { path: ["真气"], cost: 2 },
		});
		const outcome = executeRuleCheck(declaration, {
			snapshot: { mvu: { 真气: 5 } },
			roll: 11,
		});
		expect(outcome.success).toBe(false);
		expect(outcome.resource?.after).toBe(3);
	});

	it("没有资源声明时只写结果", () => {
		const declaration = parseOne();
		const outcome = executeRuleCheck(declaration, {
			snapshot: {},
			roll: 20,
		});
		expect(outcome.resource).toBeNull();
		expect(outcome.writes).toEqual([
			{
				path: ["rule", "sword", "result"],
				value: { roll: 20, difficulty: 12, success: true },
			},
		]);
	});

	it("资源不足或当前值不是数字时直接失败并指出位置", () => {
		const declaration = parseOne({
			resource: { path: ["真气"], cost: 5 },
		});
		expect(() =>
			executeRuleCheck(declaration, {
				snapshot: { mvu: { 真气: 4 } },
				roll: 15,
			}),
		).toThrow(/资源 真气 不足：当前 4，需要 5/);
		expect(() =>
			executeRuleCheck(declaration, {
				snapshot: { mvu: { 真气: "多" } },
				roll: 15,
			}),
		).toThrow(/资源 真气 当前值不是数字/);
		expect(() =>
			executeRuleCheck(declaration, { snapshot: {}, roll: 15 }),
		).toThrow(/资源 真气 当前值不是数字/);
	});

	it("骰点越界时直接失败", () => {
		const declaration = parseOne();
		expect(() =>
			executeRuleCheck(declaration, { snapshot: {}, roll: 0 }),
		).toThrow(/roll 必须是 1 到 20 之间的整数/);
		expect(() =>
			executeRuleCheck(declaration, {
				snapshot: {},
				roll: RULE_CHECK_DIE + 1,
			}),
		).toThrow(/roll 必须是 1 到 20 之间的整数/);
		const outcome = executeRuleCheck(declaration, { snapshot: {} });
		expect(outcome.roll).toBeGreaterThanOrEqual(1);
		expect(outcome.roll).toBeLessThanOrEqual(RULE_CHECK_DIE);
	});
});

describe("规则结果的台账校验", () => {
	it("接受合法结果，拒绝错误路径、越界值与不一致的成功标记", () => {
		expect(() =>
			validateLedgerDiff({
				path: ruleResultLedgerPath("sword"),
				op: "set",
				value: { roll: 12, difficulty: 12, success: true },
			}),
		).not.toThrow();
		expect(() =>
			validateLedgerDiff({
				path: ["rule", "sword"],
				op: "set",
				value: { roll: 12, difficulty: 12, success: true },
			}),
		).toThrow(/rule 的路径必须是 rule\.<id>\.result/);
		expect(() =>
			validateLedgerDiff({
				path: ruleResultLedgerPath("sword"),
				op: "set",
				value: { roll: 21, difficulty: 12, success: true },
			}),
		).toThrow(/result\.roll 必须是 1 到 20 之间的整数/);
		expect(() =>
			validateLedgerDiff({
				path: ruleResultLedgerPath("sword"),
				op: "set",
				value: { roll: 3, difficulty: 12, success: true },
			}),
		).toThrow(/result\.success 与 roll 和 difficulty 不一致/);
	});
});

describe("规则声明存储", () => {
	it("整批替换并读回，重复导入不保留旧声明", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		const declaration = parseOne();
		expect(
			store.replaceStoryRules({ storyId: "s1", rules: [declaration] }),
		).toBe(1);
		expect(store.listStoryRules("s1")).toEqual([declaration]);
		store.replaceStoryRules({
			storyId: "s1",
			rules: [
				declaration,
				{ ...declaration, id: "bow", label: "弓术检定", target: "弓术" },
			],
		});
		expect(store.listStoryRules("s1").map((item) => item.id)).toEqual([
			"sword",
			"bow",
		]);
		store.replaceStoryRules({ storyId: "s1", rules: [] });
		expect(store.listStoryRules("s1")).toEqual([]);
	});

	it("非法声明在写入时指出字段", () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		expect(() =>
			store.replaceStoryRules({
				storyId: "s1",
				rules: [
					{
						id: "sword",
						label: "剑术检定",
						target: "剑术",
						difficulty: 0,
						resource: null,
					},
				],
			}),
		).toThrow(/difficulty 必须是 1 到 20 之间的整数/);
	});
});

describe("状态定义进入结算提示词", () => {
	it("卡定义的状态条目作为硬状态说明，长正文截断", () => {
		const { store } = openTempStore();
		seedStory(store);
		const long = "属性".repeat(500);
		store.saveImportAuditEntries("s1", [
			{
				source: "character-book:山神:0",
				title: "气血与真气",
				content: "气血初始 10，真气初始 5；每次施法扣 1 点真气。",
				matches: [{ kind: "state", rules: ["title:state"] }],
				rulePrimary: "state",
				constant: true,
			},
			{
				source: "character-book:山神:1",
				title: "冗长状态表",
				content: long,
				matches: [{ kind: "state", rules: ["title:state"] }],
				rulePrimary: "state",
				constant: true,
			},
			{
				source: "character-book:山神:2",
				title: "背景",
				content: "灵潮退去。",
				matches: [{ kind: "common", rules: ["title:world"] }],
				rulePrimary: "common",
				constant: true,
			},
		]);
		const window = requireWindow(prepareSettlement(store, "s1"));
		expect(window.stateDefinitions).toHaveLength(2);
		const system = buildSettlementMessages(window)[0]?.content ?? "";
		expect(system).toContain("卡定义的状态定义");
		expect(system).toContain("【气血与真气】气血初始 10");
		expect(system).toContain("…");
		expect(system).not.toContain(long);
		expect(system).not.toContain("灵潮退去");
	});

	it("没有状态定义时不加这一段", () => {
		const { store } = openTempStore();
		seedStory(store);
		const window = requireWindow(prepareSettlement(store, "s1"));
		expect(window.stateDefinitions).toEqual([]);
		expect(buildSettlementMessages(window)[0]?.content).not.toContain(
			"卡定义的状态定义",
		);
	});
});

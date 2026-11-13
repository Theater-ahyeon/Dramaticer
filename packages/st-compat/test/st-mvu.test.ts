import { describe, expect, it } from "vitest";
import {
	applyMvuPatch,
	buildMvuInitState,
	collectMvuInitVarRaw,
	isMvuValueWithDescription,
	mergeMvuInitVarRaw,
	parseMvuInitVarText,
	parseMvuSchema,
	parseMvuUpdate,
	validateMvuSchemaValue,
} from "../src/st-mvu/index.js";

function initvarState(value: unknown) {
	return buildMvuInitState(value);
}

describe("initvar", () => {
	it("只读取带 [initvar] 标记的条目，多个条目深度合并，数组整体替换", () => {
		const collected = collectMvuInitVarRaw([
			{
				name: "[initvar]变量初始化勿开",
				content: JSON.stringify({
					角色: { 好感度: 10, 物品: ["a", "b"] },
					世界: { 时间: "早晨" },
				}),
			},
			{
				name: "[InitVar] 第二份",
				content:
					"角色:\n  好感度: 20\n  衣物:\n    - 外套\n世界:\n  时间: 夜晚\n",
			},
			{
				name: "普通条目",
				content: "角色:\n  好感度: 99\n",
			},
		]);
		expect(collected.usedSources).toEqual([
			"[initvar]变量初始化勿开",
			"[InitVar] 第二份",
		]);
		expect(collected.issues).toEqual([]);
		expect(collected.raw).toEqual({
			角色: { 好感度: 20, 物品: ["a", "b"], 衣物: ["外套"] },
			世界: { 时间: "夜晚" },
		});
	});

	it("解析代码块与开场白 <initvar>，覆盖条目里的初始值", () => {
		const fenced = parseMvuInitVarText(
			"```yaml\n角色:\n  好感度: 1\n```",
			"initvar",
		);
		expect(fenced).toEqual({ 角色: { 好感度: 1 } });

		const base = collectMvuInitVarRaw([
			{
				name: "[initvar]",
				content: JSON.stringify({
					世界: { 时间: "早晨" },
					角色: { 好感度: 10 },
				}),
			},
		]).raw;
		const greeting = parseMvuInitVarText(
			"开场白正文\n<initvar>\n世界:\n  时间: 第三天 夜晚\n</initvar>\n后续正文",
			"greeting",
		);
		expect(mergeMvuInitVarRaw(base, greeting)).toEqual({
			世界: { 时间: "第三天 夜晚" },
			角色: { 好感度: 10 },
		});
	});
});

describe("$meta 与变量结构", () => {
	it("提取 $meta、数组标记与数组元信息，并生成可校验的结构", () => {
		const state = initvarState({
			$meta: {
				strictSet: true,
				strictTemplate: true,
				concatTemplateArray: false,
				extensible: false,
			},
			角色: {
				$meta: {
					extensible: true,
					required: ["名字"],
					template: { 性别: "未知" },
				},
				名字: "甲",
				属性: { $meta: { extensible: false }, 力量: 10 },
			},
			清单: ["$__META_EXTENSIBLE__$", "剑", "盾"],
			记忆: [{ $meta: { template: ["重要记忆"] }, $arrayMeta: true }],
		});
		expect(state.options).toEqual({
			strictSet: true,
			strictTemplate: true,
			concatTemplateArray: false,
		});
		expect(state.data).toEqual({
			角色: { 名字: "甲", 属性: { 力量: 10 } },
			清单: ["剑", "盾"],
			记忆: [],
		});
		const role = state.schema.properties.角色;
		if (role?.type !== "object") throw new Error("角色 不是对象结构");
		expect(role.extensible).toBe(true);
		expect(role.properties.名字?.required).toBe(true);
		expect(role.properties.属性?.extensible).toBe(false);
		expect(state.schema.properties.清单?.extensible).toBe(true);
		expect(state.schema.properties.记忆?.template).toEqual(["重要记忆"]);
	});

	it("recursiveExtensible 向子孙传递，显式关闭会截断", () => {
		const state = initvarState({
			甲: {
				$meta: { recursiveExtensible: true },
				乙: { 丙: 1 },
				丙: { $meta: { extensible: false }, 丁: 2 },
			},
		});
		const first = state.schema.properties.甲;
		if (first?.type !== "object") throw new Error("甲 不是对象结构");
		const second = first.properties.乙;
		if (second?.type !== "object") throw new Error("乙 不是对象结构");
		expect(first.extensible).toBe(true);
		expect(second.extensible).toBe(true);
		expect(first.properties.丙?.extensible).toBe(false);
	});

	it("可以从已保存的 schema 读回校验规则", () => {
		const schema = parseMvuSchema({
			type: "object",
			properties: {
				金币: { type: "number", required: true },
				名字: { type: "string", required: true },
			},
			extensible: false,
		});
		expect(validateMvuSchemaValue(schema, { 金币: 10, 名字: "甲" })).toEqual(
			[],
		);
		expect(
			validateMvuSchemaValue(schema, { 金币: 10, 名字: "甲", 额外: true }),
		).toEqual(["/额外 不在锁定的对象结构里"]);
		expect(validateMvuSchemaValue(schema, { 名字: "甲" })).toEqual([
			"/金币 是必填项",
		]);
		expect(validateMvuSchemaValue(schema, { 金币: "十", 名字: "甲" })).toEqual([
			"/金币 必须是 number",
		]);
	});
});

describe("JSONPatch 解析", () => {
	it("从 <UpdateVariable> 取出分析与操作", () => {
		const parsed = parseMvuUpdate(`前言
<UpdateVariable>
<Analysis>时间过去</Analysis>
<JSONPatch>
[
  { "op": "replace", "path": "/世界/时间", "value": "下午" },
  { "op": "delta", "path": "/角色/好感度", "value": 3 }
]
</JSONPatch>
</UpdateVariable>
后记`);
		expect(parsed.analysis).toBe("时间过去");
		expect(parsed.issues).toEqual([]);
		expect(parsed.operations).toEqual([
			{ op: "replace", path: "/世界/时间", value: "下午" },
			{ op: "delta", path: "/角色/好感度", value: 3 },
		]);
	});

	it("非法 JSON 整段拒绝，未知操作逐条拒绝", () => {
		const broken = parseMvuUpdate(
			'<UpdateVariable><JSONPatch>[{"op":"replace","path":"/a","value":1},]</JSONPatch></UpdateVariable>',
		);
		expect(broken.operations).toEqual([]);
		expect(broken.issues[0]).toContain("JSON");

		const mixed = parseMvuUpdate(
			'<UpdateVariable><JSONPatch>[{"op":"frobnicate","path":"/a"},{"op":"replace","path":"/a","value":1}]</JSONPatch></UpdateVariable>',
		);
		expect(mixed.operations).toEqual([{ op: "replace", path: "/a", value: 1 }]);
		expect(mixed.issues[0]).toContain("frobnicate");
	});
});

describe("[值, 说明] 与 strictSet", () => {
	it("replace 与 delta 只改值，保留说明；显式下标可以整体赋值", () => {
		const state = initvarState({
			生命: [20, "受到伤害时减少"],
			金币: [100, "货币"],
		});
		expect(isMvuValueWithDescription(state.data.生命)).toBe(true);
		const result = applyMvuPatch(state, [
			{ op: "replace", path: "/生命", value: 14 },
			{ op: "delta", path: "/金币", value: -50 },
			{ op: "replace", path: "/生命/0", value: 12 },
		]);
		expect(result.rejected).toEqual([]);
		expect(result.data).toEqual({
			生命: [12, "受到伤害时减少"],
			金币: [50, "货币"],
		});
	});

	it("strictSet 关闭隐式保留，replace 直接替换整个值", () => {
		const state = initvarState({
			$meta: { strictSet: true },
			生命: [20, "受到伤害时减少"],
		});
		const result = applyMvuPatch(state, [
			{ op: "replace", path: "/生命", value: 14 },
		]);
		expect(result.rejected).toEqual([]);
		expect(result.data).toEqual({ 生命: 14 });
	});

	it("对值为对象或数组的 [值, 说明] 做结构操作必须使用显式下标", () => {
		const state = initvarState({
			舰载机: [{ 补给中: { J35: 8 } }, "描述"],
		});
		const result = applyMvuPatch(state, [
			{ op: "insert", path: "/舰载机/补给中/J15", value: 2 },
			{ op: "replace", path: "/舰载机/0/补给中/J35", value: 9 },
		]);
		expect(result.rejected.map((item) => item.operation.path)).toEqual([
			"/舰载机/补给中/J15",
		]);
		expect(result.data).toEqual({
			舰载机: [{ 补给中: { J35: 9 } }, "描述"],
		});
	});
});

describe("变量结构约束", () => {
	it("锁定对象拒绝新增，required 键拒绝删除，锁定数组拒绝增删", () => {
		const state = initvarState({
			角色: {
				$meta: { extensible: true, required: ["名字"] },
				名字: "甲",
				属性: { $meta: { extensible: false }, 力量: 10 },
			},
			清单: ["$__META_EXTENSIBLE__$", "剑", "盾", "弓"],
			封闭: ["剑", "盾", "弓"],
		});
		const result = applyMvuPatch(state, [
			{ op: "insert", path: "/角色/年龄", value: 18 },
			{ op: "remove", path: "/角色/名字" },
			{ op: "insert", path: "/角色/属性/敏捷", value: 10 },
			{ op: "insert", path: "/清单/-", value: "钥匙" },
			{ op: "insert", path: "/封闭/-", value: "钥匙" },
			{ op: "remove", path: "/清单/0" },
		]);
		expect(result.applied).toBe(3);
		expect(result.rejected.map((item) => item.operation.path)).toEqual([
			"/角色/名字",
			"/角色/属性/敏捷",
			"/封闭/-",
		]);
		expect(result.data).toEqual({
			角色: { 名字: "甲", 属性: { 力量: 10 }, 年龄: 18 },
			清单: ["盾", "弓", "钥匙"],
			封闭: ["剑", "盾", "弓"],
		});
	});

	it("模板在新增对象键时合并，字面值按 strictTemplate 处理", () => {
		const base = initvarState({
			道具: { $meta: { extensible: true, template: ["默认道具"] } },
			用户: { $meta: { extensible: true, template: { 备注: "无" } } },
		});
		const result = applyMvuPatch(base, [
			{ op: "insert", path: "/道具/万用表", value: ["新道具"] },
			{ op: "insert", path: "/道具/手电", value: "abc" },
			{ op: "insert", path: "/用户/张三", value: {} },
		]);
		expect(result.rejected).toEqual([]);
		expect(result.data).toEqual({
			道具: {
				万用表: ["新道具", "默认道具"],
				手电: ["abc", "默认道具"],
			},
			用户: { 张三: { 备注: "无" } },
		});

		const strict = applyMvuPatch(
			initvarState({
				$meta: { strictTemplate: true },
				道具: { $meta: { extensible: true, template: ["默认道具"] } },
			}),
			[{ op: "insert", path: "/道具/手电", value: "abc" }],
		);
		expect(strict.data).toEqual({ 道具: { 手电: "abc" } });
	});

	it("按结构把数字字符串转成数字，不能转的拒绝", () => {
		const state = initvarState({ 金币: 100 });
		const result = applyMvuPatch(state, [
			{ op: "replace", path: "/金币", value: "120" },
		]);
		expect(result.data).toEqual({ 金币: 120 });

		const bad = applyMvuPatch(state, [
			{ op: "replace", path: "/金币", value: "很多" },
		]);
		expect(bad.data).toEqual({ 金币: 100 });
		expect(bad.rejected[0]?.reason).toContain("/金币");
	});
});

describe("路径与移动", () => {
	it("支持 JSON Pointer 转义与整项移动", () => {
		const state = initvarState({
			a: { $meta: { extensible: true }, "x/y": 1 },
			b: ["$__META_EXTENSIBLE__$"],
		});
		const result = applyMvuPatch(state, [
			{ op: "move", from: "/a/x~1y", path: "/b/-" },
		]);
		expect(result.rejected).toEqual([]);
		expect(result.data).toEqual({ a: {}, b: [1] });
	});

	it("不存在的路径与缺失的操作字段逐条拒绝", () => {
		const state = initvarState({ a: 1 });
		const result = applyMvuPatch(state, [
			{ op: "replace", path: "/missing", value: 2 },
			{ op: "delta", path: "/a" } as never,
			{ op: "move", from: "/a", path: "/b" },
		]);
		expect(result.data).toEqual({ a: 1 });
		expect(result.rejected).toHaveLength(3);
		expect(result.rejected[0]?.reason).toContain("/missing");
	});

	it("拒绝原型污染键", () => {
		const state = initvarState({ 角色: { $meta: { extensible: true } } });
		const result = applyMvuPatch(state, [
			{ op: "insert", path: "/角色/__proto__", value: { 污染: true } },
		]);
		expect(result.rejected).toHaveLength(1);
		expect(({} as Record<string, unknown>).污染).toBeUndefined();
	});
});

import { describe, expect, it } from "vitest";
import { createStEjsRuntime } from "../src/st-ejs/index.js";

function seedRuntime(preparation = false) {
	return createStEjsRuntime({
		preparation,
		variables: {
			initial: { base: 1, shared: "initial" },
			global: { a: 2, nested: { g: 1 }, shared: "global" },
			local: { a: 3, nested: { l: 2 }, shared: "local" },
			messages: [
				{
					id: 0,
					swipeId: 0,
					role: "user",
					variables: { older: true },
				},
				{
					id: 1,
					swipeId: 0,
					role: "assistant",
					variables: { a: 4, nested: { m: 3 }, shared: "message" },
				},
			],
		},
		messages: [
			{ id: 0, role: "user", content: "第一楼" },
			{ id: 1, role: "assistant", content: "第二楼" },
		],
	});
}

describe("EJS 变量作用域", () => {
	it("合并视图按 initial、global、local、message 的顺序覆盖并深合对象", async () => {
		const ejs = seedRuntime();
		const output = await ejs.render(
			"<%- JSON.stringify({ a: variables.a, base: variables.base, " +
				"shared: variables.shared, nested: variables.nested, older: variables.older }) %>",
		);
		expect(JSON.parse(output)).toEqual({
			a: 4,
			base: 1,
			shared: "message",
			nested: { g: 1, l: 2, m: 3 },
			older: true,
		});
	});

	it("getvar 可以指定作用域、缺省值与深拷贝", async () => {
		const ejs = seedRuntime();
		const output = await ejs.render(
			"<%- JSON.stringify({ " +
				"globalA: getvar('a', { scope: 'global' }), " +
				"localA: getvar('a', 'local'), " +
				"initialShared: getvar('shared', { scope: 'initial' }), " +
				"missing: getvar('missing'), " +
				"fallback: getvar('missing', { defaults: 'd' }), " +
				"whole: getvar(null, { scope: 'global' }) }) %>",
		);
		expect(JSON.parse(output)).toEqual({
			globalA: 2,
			localA: 3,
			initialShared: "initial",
			fallback: "d",
			whole: { a: 2, nested: { g: 1 }, shared: "global" },
		});

		const cloned = await ejs.render(
			"<% const copy = getvar('nested', { clone: true }); copy.m = 99; %>" +
				"<%- JSON.stringify(getvar('nested')) %>",
		);
		expect(JSON.parse(cloned)).toEqual({ g: 1, l: 2, m: 3 });
	});

	it("setvar 默认写消息变量并同步合并视图，results 决定返回值", async () => {
		const ejs = seedRuntime();
		const output = await ejs.render(
			"<% const oldValue = setvar('x', 5, { results: 'old' }); %>" +
				"<%- JSON.stringify({ oldValue, " +
				"fresh: setvar('x', 6, { results: 'old' }), " +
				"newValue: setvar('x', 7), " +
				"cache: getvar('x'), " +
				"fullcache: setvar('y', 8, { results: 'fullcache' }).y }) %>",
		);
		expect(JSON.parse(output)).toEqual({
			oldValue: undefined,
			fresh: 5,
			newValue: 7,
			cache: 7,
			fullcache: 8,
		});
		expect(ejs.getWrites()).toEqual([
			{
				scope: "message",
				messageId: 1,
				swipeId: 0,
				key: "x",
				operation: "set",
				value: 5,
			},
			{
				scope: "message",
				messageId: 1,
				swipeId: 0,
				key: "x",
				operation: "set",
				value: 6,
			},
			{
				scope: "message",
				messageId: 1,
				swipeId: 0,
				key: "x",
				operation: "set",
				value: 7,
			},
			{
				scope: "message",
				messageId: 1,
				swipeId: 0,
				key: "y",
				operation: "set",
				value: 8,
			},
		]);
	});

	it("flags 决定写入条件：nx/xx 看合并视图，nxs/xxs 看目标作用域", async () => {
		const ejs = seedRuntime();
		const output = await ejs.render(
			"<%- JSON.stringify({ " +
				"nxExisting: setvar('a', 10, 'nx'), " +
				"nxMissing: setvar('n1', 1, 'nx'), " +
				"xxExisting: setvar('b', 2, 'xx'), " +
				"xxPresent: setvar('n1', 3, 'xx'), " +
				"nxsGlobalOnly: setvar('older', 11, 'nxs'), " +
				"xxsGlobalOnly: setvar('older', 12, 'xxs') }) %>",
		);
		expect(JSON.parse(output)).toEqual({
			nxExisting: undefined,
			nxMissing: 1,
			xxPresent: 3,
			nxsGlobalOnly: 11,
			xxsGlobalOnly: 12,
		});
		expect(await ejs.render("<%- getvar('older') %>")).toBe("12");
	});

	it("merge 深合进已有对象", async () => {
		const ejs = seedRuntime();
		const output = await ejs.render(
			"<%- JSON.stringify(setvar('nested', { extra: 4 }, { merge: true })) %>",
		);
		expect(JSON.parse(output)).toEqual({ m: 3, extra: 4 });
		expect(
			JSON.parse(await ejs.render("<%- JSON.stringify(variables.nested) %>")),
		).toEqual({ g: 1, l: 2, m: 3, extra: 4 });
	});

	it("准备阶段默认不写变量，dryRun 放行", async () => {
		const ejs = seedRuntime(true);
		const output = await ejs.render(
			"<% const blocked = setvar('p', 1); " +
				"const allowed = setvar('p', 2, { dryRun: true }); %>" +
				"<%- JSON.stringify({ blocked, allowed, value: getvar('p') }) %>",
		);
		expect(JSON.parse(output)).toEqual({ allowed: 2, value: 2 });
		expect(ejs.getWrites()).toHaveLength(1);
	});

	it("key 为 null 时替换整棵树", async () => {
		const ejs = seedRuntime();
		const output = await ejs.render(
			"<% setvar(null, { only: 1 }); %>" +
				"<%- JSON.stringify({ whole: getvar(null), a: getvar('a') }) %>",
		);
		expect(JSON.parse(output)).toEqual({ whole: { only: 1 } });
	});

	it("incvar 与 decvar 使用缺省值并受 min/max 约束", async () => {
		const ejs = createStEjsRuntime({
			variables: { local: { hp: 5 } },
		});
		const output = await ejs.render(
			"<%- JSON.stringify({ " +
				"up: incvar('hp', 3), " +
				"down: decvar('hp', 2, { min: 7 }), " +
				"fresh: incvar('mana', 2, { defaults: 10 }), " +
				"capped: incvar('hp', 100, { max: 20 }) }) %>",
		);
		expect(JSON.parse(output)).toEqual({
			up: 8,
			down: 7,
			fresh: 12,
			capped: 20,
		});
	});

	it("delvar 删除对象键、数组元素、字符串字符与整条路径", async () => {
		const ejs = createStEjsRuntime({
			variables: {
				messages: [
					{
						id: 0,
						variables: { obj: { a: 1, b: 2 }, arr: [1, 2, 3], str: "abc" },
					},
				],
			},
		});
		const output = await ejs.render(
			"<% delvar('obj', 'a'); delvar('arr', 1); delvar('str', 0); " +
				"const kept = getvar('obj'); delvar('obj'); %>" +
				"<%- JSON.stringify({ obj: kept, arr: getvar('arr'), str: getvar('str'), gone: getvar('obj') }) %>",
		);
		expect(JSON.parse(output)).toEqual({
			obj: { b: 2 },
			arr: [1, 3],
			str: "bc",
		});
	});

	it("insvar 支持数组下标、追加、字符串与对象键", async () => {
		const ejs = createStEjsRuntime({
			variables: {
				messages: [
					{
						id: 0,
						variables: { arr: [1, 2], str: "ab", obj: {} },
					},
				],
			},
		});
		const output = await ejs.render(
			"<% insvar('arr', 9, 1); insvar('arr', 3); " +
				"insvar('str', 'X', 1); insvar('obj', 'v', 'k'); %>" +
				"<%- JSON.stringify({ arr: getvar('arr'), str: getvar('str'), obj: getvar('obj') }) %>",
		);
		expect(JSON.parse(output)).toEqual({
			arr: [1, 9, 2, 3],
			str: "aXb",
			obj: { k: "v" },
		});
	});

	it("作用域专用别名写入对应作用域", async () => {
		const ejs = createStEjsRuntime({});
		const output = await ejs.render(
			"<% setGlobalVar('g', 1); setLocalVar('l', 2); setMessageVar('m', 3); " +
				"incGlobalVar('g', 4); %>" +
				"<%- JSON.stringify({ g: getGlobalVar('g'), l: getLocalVar('l'), " +
				"m: getMessageVar('m'), cache: getvar('g') }) %>",
		);
		expect(JSON.parse(output)).toEqual({ g: 5, l: 2, m: 3, cache: 5 });
		expect(ejs.getWrites().map((write) => write.scope)).toEqual([
			"global",
			"local",
			"message",
			"global",
		]);
	});

	it("withMsg 选中指定楼层的消息变量", async () => {
		const ejs = seedRuntime();
		const output = await ejs.render(
			"<% const older = getvar('older', { scope: 'message', withMsg: { id: 0 } }); " +
				"const wrote = setvar('flag', 1, { withMsg: { id: 0 } }); %>" +
				"<%- JSON.stringify({ older, wrote, newest: getvar('flag') }) %>",
		);
		expect(JSON.parse(output)).toEqual({ older: true, wrote: 1, newest: 1 });
		expect(ejs.getWrites()[0]).toMatchObject({ messageId: 0, key: "flag" });
	});

	it("拒绝原型污染路径", async () => {
		const ejs = createStEjsRuntime({});
		await expect(
			ejs.render("<% setvar('__proto__.polluted', true); %>"),
		).rejects.toThrow(/不能使用路径/);
		const probe: Record<string, unknown> = {};
		expect(probe.polluted).toBeUndefined();
	});

	it("每次创建运行时互不影响", async () => {
		const first = createStEjsRuntime({});
		const second = createStEjsRuntime({});
		await first.render("<% setvar('x', 1); %>");
		expect(await first.render("<%- getvar('x') %>")).toBe("1");
		expect(await second.render("<%- String(getvar('x')) %>")).toBe("undefined");
	});
});

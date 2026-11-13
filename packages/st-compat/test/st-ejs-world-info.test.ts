import { describe, expect, it } from "vitest";
import {
	StEjsBudgetError,
	StEjsWorldInfoError,
	createStEjsRuntime,
} from "../src/st-ejs/index.js";
import { parseWorldInfoJson } from "../src/world-info.js";

const worldJson = JSON.stringify({
	entries: {
		"0": {
			uid: 0,
			key: ["alpha"],
			comment: "alpha",
			content: '<% print("beta-trigger") %>',
		},
		"1": {
			uid: 1,
			key: ["beta-trigger"],
			comment: "beta",
			content: "乙",
		},
		"2": {
			uid: 2,
			key: ["gamma"],
			comment: "gamma",
			content: "丙",
			disable: true,
		},
		"3": {
			uid: 3,
			key: [],
			comment: "delta",
			content: "丁",
			constant: true,
		},
		"4": {
			uid: 4,
			key: ["epsilon"],
			comment: "epsilon",
			content: "戊",
		},
	},
});

function runtime() {
	return createStEjsRuntime({
		worldInfo: {
			worlds: [parseWorldInfoJson(worldJson)],
			currentWorld: "world-1",
			messages: ["这是第一楼"],
		},
	});
}

describe("EJS 世界书函数", () => {
	it("省略世界书名时读取当前世界书，结果再次进入模板处理", async () => {
		const ejs = runtime();
		expect(await ejs.render("<%- await getwi('alpha') %>")).toBe(
			"beta-trigger",
		);
		expect(await ejs.render("<%- await getwi('world-1', 'beta') %>")).toBe(
			"乙",
		);
	});

	it("raw 选项跳过模板处理", async () => {
		const ejs = runtime();
		expect(await ejs.getWorldInfo("alpha", { raw: true })).toBe(
			'<% print("beta-trigger") %>',
		);
	});

	it("recursive 把条目正文触发的其他条目一起返回", async () => {
		const ejs = runtime();
		const text = await ejs.getWorldInfo("alpha", { recursive: true });
		expect(text).toBe("beta-trigger\n乙");
	});

	it("省略 currentWorld 时在所有世界书里查找", async () => {
		const ejs = createStEjsRuntime({
			worldInfo: { worlds: [parseWorldInfoJson(worldJson)] },
		});
		expect(await ejs.getWorldInfo("beta")).toBe("乙");
	});

	it("未知条目与世界书直接抛错", async () => {
		const ejs = runtime();
		await expect(ejs.getWorldInfo("missing")).rejects.toThrow(
			StEjsWorldInfoError,
		);
		await expect(ejs.getWorldInfo("other", "alpha")).rejects.toThrow(
			StEjsWorldInfoError,
		);
	});

	it("getWorldInfoData 与 getEnabledWorldInfoEntries 区分禁用条目", () => {
		const ejs = runtime();
		expect(ejs.getWorldInfoData("world-1")).toHaveLength(5);
		const enabled = ejs.getEnabledWorldInfoEntries("world-1");
		expect(enabled.map((entry) => entry.comment)).toEqual([
			"alpha",
			"beta",
			"delta",
			"epsilon",
		]);
		expect(enabled[0]?.world).toBe("world-1");
	});

	it("按楼层关键词激活并在激活数据里保留条目元数据", () => {
		const ejs = createStEjsRuntime({
			worldInfo: {
				worlds: [parseWorldInfoJson(worldJson)],
				currentWorld: "world-1",
				messages: ["提到 alpha 的一楼"],
			},
		});
		const activated = ejs.getWorldInfoActivatedData();
		expect(activated.map((entry) => entry.comment)).toEqual(["alpha", "delta"]);
		expect(activated[0]?.activatedBy).toBe("keyword");
		expect(activated[0]?.keys).toEqual(["alpha"]);
	});

	it("activateWorldInfo 与按关键词激活都可以补充激活条目", () => {
		const ejs = createStEjsRuntime({
			worldInfo: {
				worlds: [parseWorldInfoJson(worldJson)],
				currentWorld: "world-1",
			},
		});
		expect(ejs.activateWorldInfo("world-1", "beta")).toHaveLength(1);
		expect(ejs.activateWorldInfo("world-1", "gamma")).toHaveLength(0);
		expect(ejs.activateWorldInfoByKeywords("epsilon")).toHaveLength(1);
		expect(
			ejs.getWorldInfoActivatedData().map((entry) => entry.comment),
		).toEqual(["delta", "beta", "epsilon"]);
	});

	it("selectActivatedEntries 只保留已激活的候选", () => {
		const ejs = createStEjsRuntime({
			worldInfo: {
				worlds: [parseWorldInfoJson(worldJson)],
				currentWorld: "world-1",
				messages: ["alpha 与 delta"],
			},
		});
		const selected = ejs.selectActivatedEntries(["alpha", "epsilon"]);
		expect(selected.map((entry) => entry.comment)).toEqual(["alpha"]);
	});

	it("getwi 的输出计入 token 预算", async () => {
		const ejs = createStEjsRuntime({
			worldInfo: {
				worlds: [parseWorldInfoJson(worldJson)],
				currentWorld: "world-1",
			},
			estimateTokens: () => 10,
			tokenBudget: 15,
		});
		await ejs.getWorldInfo("alpha");
		await expect(ejs.getWorldInfo("beta")).rejects.toThrow(StEjsBudgetError);
		expect(ejs.getTokenTotal()).toBe(20);
		expect(ejs.getTokenUsage().map((entry) => entry.source)).toEqual([
			"世界书 world-1:alpha",
			"世界书 world-1:beta",
		]);
	});
});

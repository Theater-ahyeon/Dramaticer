import { describe, expect, it } from "vitest";
import {
	DECLARATIVE_PLUGIN_FORMAT,
	DECLARATIVE_PLUGIN_FORMAT_VERSION,
	parseDeclarativePlugin,
	parseDeclarativePlugins,
	parseDeclarativeRequirements,
	parseDramaticerCardExtension,
} from "../src/index.js";

const base = {
	format: DECLARATIVE_PLUGIN_FORMAT,
	formatVersion: DECLARATIVE_PLUGIN_FORMAT_VERSION,
	name: "test.plugin",
	version: "1.2.3",
};

function pluginWith(kind: string, payload: unknown): Record<string, unknown> {
	return { ...base, kind, payload };
}

describe("声明式插件外壳", () => {
	it("八种类型都有合法样例并通过解析", () => {
		const ledger = parseDeclarativePlugin(
			pluginWith("ledger-schema", {
				namespace: "character",
				fields: [
					{ path: ["境界"], type: "enum", values: ["炼气", "筑基"] },
					{ path: ["修为"], type: "integer", min: 0, max: 100 },
					{ path: ["称号"], type: "string", maxLength: 20 },
					{ path: ["已故"], type: "boolean" },
					{ path: ["法器"], type: "string-array" },
					{ path: ["好感"], type: "number", min: 0, max: 1 },
				],
			}),
		);
		expect(ledger.kind).toBe("ledger-schema");

		const plotBeat = parseDeclarativePlugin(
			pluginWith("plot-beat", {
				id: "beat-1",
				title: "山门试炼",
				text: "弟子在石阶前等待，风把铃铛吹响。",
				preconditions: { kind: "state", path: ["场景", "地点"], op: "exists" },
			}),
		);
		expect(plotBeat.kind).toBe("plot-beat");

		const template = parseDeclarativePlugin(
			pluginWith("context-template", {
				id: "plugin-template",
				segments: [
					{ id: "character", kind: "slot", slot: "character" },
					{
						id: "extra",
						kind: "static",
						text: "只用一句话描写。",
						priority: 5,
					},
				],
				deepTurn: { tools: ["state_get"], maxToolCalls: 10 },
			}),
		);
		expect(template.kind).toBe("context-template");

		const renderer = parseDeclarativePlugin(
			pluginWith("block-renderer", {
				block: "状态栏",
				display: { kind: "html", template: "<dl>{{content}}</dl>" },
				context: { kind: "keep-depth", depth: 2 },
			}),
		);
		expect(renderer.kind).toBe("block-renderer");

		const skill = parseDeclarativePlugin(
			pluginWith("skill", {
				name: "剑法",
				description: "判断剑招是否成立",
				content: "# 剑法\n\n只有出鞘后才能格挡。",
			}),
		);
		expect(skill.kind).toBe("skill");

		const floor = parseDeclarativePlugin(
			pluginWith("floor-renderer", {
				name: "状态栏",
				blockTypes: ["状态栏"],
				permissions: ["sendMessage"],
				template: "<div>{{content}}</div>",
			}),
		);
		if (floor.kind !== "floor-renderer") throw new Error("kind");
		expect(floor.payload.id).toBe("test.plugin");
		expect(floor.payload.patterns).toEqual([]);

		const director = parseDeclarativePlugin(
			pluginWith("director-config", {
				config: { mode: "blind", surprise: 0.5 },
			}),
		);
		expect(director.kind).toBe("director-config");

		const pool = parseDeclarativePlugin(
			pluginWith("event-pool", {
				events: [{ id: "e1", text: "夜里有狼群", cooldown: 2 }],
			}),
		);
		expect(pool.kind).toBe("event-pool");
	});

	it("外壳字段非法时指出路径", () => {
		expect(() =>
			parseDeclarativePlugin({ ...pluginWith("skill", {}), format: "other" }),
		).toThrow("declarativePlugin.format 必须是 dramaticer.plugin");
		expect(() =>
			parseDeclarativePlugin({ ...pluginWith("skill", {}), formatVersion: 2 }),
		).toThrow("declarativePlugin.formatVersion 只支持 1");
		expect(() =>
			parseDeclarativePlugin({ ...pluginWith("skill", {}), name: "Bad Name" }),
		).toThrow("declarativePlugin.name 只能包含小写字母");
		expect(() =>
			parseDeclarativePlugin({ ...pluginWith("skill", {}), version: "latest" }),
		).toThrow("declarativePlugin.version 必须是形如 1.2.3 的版本号");
		expect(() =>
			parseDeclarativePlugin({ ...pluginWith("unknown", {}) }),
		).toThrow("declarativePlugin.kind 必须是");
		expect(() =>
			parseDeclarativePlugin(pluginWith("skill", undefined)),
		).toThrow("declarativePlugin.payload 不是 JSON 值（undefined）");
		const { payload: _payload, ...withoutPayload } = pluginWith("skill", {});
		expect(() => parseDeclarativePlugin(withoutPayload)).toThrow(
			"declarativePlugin.payload 必须提供",
		);
		expect(() =>
			parseDeclarativePlugin({ ...pluginWith("skill", {}), extra: true }),
		).toThrow("declarativePlugin.extra 是未知字段");
	});

	it("只接受 JSON 数据，函数无法通过", () => {
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("skill", {
					name: "剑法",
					description: "说明",
					content: () => "inline",
				}),
			),
		).toThrow("declarativePlugin.payload.content 不是 JSON 值（function）");
	});

	it("插件组拒绝重名", () => {
		const one = pluginWith("skill", {
			name: "剑法",
			description: "说明",
			content: "正文",
		});
		expect(() =>
			parseDeclarativePlugins([
				one,
				{ ...one, name: base.name, version: "2.0.0" },
			]),
		).toThrow("declarativePlugins[1].name 重复：test.plugin");
	});
});

describe("台账 schema 负载", () => {
	it("命名空间、字段类型与约束严格校验", () => {
		const cases: Array<[unknown, string]> = [
			[{ namespace: "unknown", fields: [] }, "不是已知台账命名空间"],
			[{ namespace: "character", fields: [] }, "fields 必须是非空数组"],
			[
				{ namespace: "character", fields: [{ path: [], type: "string" }] },
				"path 必须是非空字符串数组",
			],
			[
				{
					namespace: "character",
					fields: [{ path: ["x"], type: "date" }],
				},
				"type 必须是",
			],
			[
				{ namespace: "character", fields: [{ path: ["x"], type: "enum" }] },
				"values 必须是非空数组",
			],
			[
				{
					namespace: "character",
					fields: [{ path: ["x"], type: "string", min: 0 }],
				},
				"字符串字段只允许 maxLength",
			],
			[
				{
					namespace: "character",
					fields: [{ path: ["x"], type: "boolean", maxLength: 2 }],
				},
				"布尔字段不接受额外约束",
			],
			[
				{
					namespace: "character",
					fields: [{ path: ["x"], type: "integer", min: 5, max: 1 }],
				},
				"min 不能大于 max",
			],
			[
				{
					namespace: "character",
					fields: [
						{ path: ["x"], type: "string" },
						{ path: ["x"], type: "integer" },
					],
				},
				"path 重复",
			],
			[
				{
					namespace: "character",
					fields: [{ path: ["x"], type: "enum", values: ["a", "a"] }],
				},
				"values 不能重复",
			],
		];
		for (const [payload, message] of cases) {
			expect(() =>
				parseDeclarativePlugin(pluginWith("ledger-schema", payload)),
			).toThrow(message);
		}
	});
});

describe("其余负载的严格校验", () => {
	it("剧情小品与技能拒绝空文本", () => {
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("plot-beat", { id: "b", title: "标题", text: " " }),
			),
		).toThrow("payload.text 不能是空字符串");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("skill", { name: "剑法", description: "说明", content: "" }),
			),
		).toThrow("payload.content 不能是空字符串");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("skill", {
					name: "剑法",
					description: "说明",
					content: "正文",
					run: "code",
				}),
			),
		).toThrow("payload.run 是未知字段");
	});

	it("模板沿用段落校验与写作契约位置", () => {
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("context-template", {
					id: "t",
					segments: [{ id: "x", kind: "mystery" }],
				}),
			),
		).toThrow("payload.segments[0].kind 必须是 static 或 slot");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("context-template", {
					id: "t",
					segments: [{ id: "x", kind: "slot", slot: "nope" }],
				}),
			),
		).toThrow("payload.segments[0].slot 不是合法槽位");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("context-template", {
					id: "t",
					segments: [
						{ id: "protocol", kind: "static", text: "契约" },
						{ id: "history", kind: "slot", slot: "history" },
					],
				}),
			),
		).toThrow("protocol 写作契约片段必须是最后一个片段");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("context-template", {
					id: "t",
					segments: [{ id: "history", kind: "slot", slot: "history" }],
					deepTurn: { tools: ["nope"] },
				}),
			),
		).toThrow("未知工具：nope");
	});

	it("块渲染器只接受显示与上下文策略", () => {
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("block-renderer", {
					block: "状态 栏",
					display: { kind: "hidden" },
					context: { kind: "keep" },
				}),
			),
		).toThrow("不能包含 '<'、'>'、'/' 或空白");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("block-renderer", {
					block: "状态栏",
					display: { kind: "script", source: "x" },
					context: { kind: "keep" },
				}),
			),
		).toThrow("payload.display.kind 必须是 html、native 或 hidden");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("block-renderer", {
					block: "状态栏",
					display: { kind: "hidden" },
					context: { kind: "keep-depth", depth: 0 },
				}),
			),
		).toThrow("payload.context.depth 必须是正整数");
	});

	it("导演配置未知字段与非法取值都拒绝", () => {
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("director-config", { config: { mood: "dark" } }),
			),
		).toThrow("payload.config.mood 是未知字段");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("director-config", { config: { surprise: 2 } }),
			),
		).toThrow("surprise 必须是 0 到 1 之间的数字");
	});

	it("事件池至少一条并沿用事件校验", () => {
		expect(() =>
			parseDeclarativePlugin(pluginWith("event-pool", { events: [] })),
		).toThrow("payload.events 必须是非空数组");
		expect(() =>
			parseDeclarativePlugin(
				pluginWith("event-pool", {
					events: [
						{ id: "e1", text: "事件" },
						{ id: "e1", text: "重复" },
					],
				}),
			),
		).toThrow("payload.events[1].id 重复：e1");
	});
});

describe("卡片打包", () => {
	it("解析随附插件、必需依赖与推荐依赖", () => {
		const extension = parseDramaticerCardExtension({
			plugins: [
				pluginWith("skill", {
					name: "剑法",
					description: "说明",
					content: "正文",
				}),
			],
			requires: {
				plugins: [{ name: "xianxia.core", versionRange: "^1.0.0" }],
				playpacks: [{ name: "xianxia" }],
			},
			recommends: { plugins: [{ name: "romance.core" }] },
		});
		expect(extension.plugins).toHaveLength(1);
		expect(extension.plugins[0]?.kind).toBe("skill");
		expect(extension.requires.plugins[0]).toEqual({
			name: "xianxia.core",
			versionRange: "^1.0.0",
		});
		expect(extension.requires.playpacks).toEqual([{ name: "xianxia" }]);
		expect(extension.recommends.plugins).toEqual([{ name: "romance.core" }]);
		expect(extension.recommends.playpacks).toEqual([]);
	});

	it("缺少打包字段时给出空依赖", () => {
		const extension = parseDramaticerCardExtension(undefined);
		expect(extension.plugins).toEqual([]);
		expect(extension.requires).toEqual({ plugins: [], playpacks: [] });
		expect(extension.recommends).toEqual({ plugins: [], playpacks: [] });
	});

	it("依赖声明严格校验并拒绝重名", () => {
		expect(() =>
			parseDeclarativeRequirements({ plugins: "x" }, "requires"),
		).toThrow("requires.plugins 必须是数组");
		expect(() =>
			parseDeclarativeRequirements({ extras: [] }, "requires"),
		).toThrow("requires.extras 是未知字段");
		expect(() =>
			parseDeclarativeRequirements(
				{ plugins: [{ name: "a" }, { name: "a" }] },
				"requires",
			),
		).toThrow("requires.plugins[1].name 重复：a");
		expect(() =>
			parseDeclarativeRequirements(
				{ plugins: [{ name: "a", versionRange: " " }] },
				"requires",
			),
		).toThrow("requires.plugins[0].versionRange 不能是空字符串");
		expect(() =>
			parseDramaticerCardExtension({
				plugins: [
					pluginWith("skill", {
						name: "a",
						description: "说明",
						content: "正文",
					}),
					pluginWith("skill", {
						name: "b",
						description: "说明",
						content: "正文",
					}),
				],
			}),
		).toThrow("extensions.dramaticer.plugins[1].name 重复：test.plugin");
	});
});

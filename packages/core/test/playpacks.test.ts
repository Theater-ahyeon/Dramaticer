import { describe, expect, it } from "vitest";
import {
	DECLARATIVE_PLUGIN_FORMAT,
	DECLARATIVE_PLUGIN_FORMAT_VERSION,
	PLAYPACK_FORMAT,
	PLAYPACK_FORMAT_VERSION,
	isPlaypackPluginEnabled,
	parsePlaypackManifest,
	parsePlaypackUserOverrides,
	parsePlaypacks,
	stackPlaypacks,
} from "../src/index.js";

function skillPlugin(name: string): Record<string, unknown> {
	return {
		format: DECLARATIVE_PLUGIN_FORMAT,
		formatVersion: DECLARATIVE_PLUGIN_FORMAT_VERSION,
		name,
		version: "1.0.0",
		kind: "skill",
		payload: { name: "剑法", description: "说明", content: "正文" },
	};
}

function playpack(
	name: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		format: PLAYPACK_FORMAT,
		formatVersion: PLAYPACK_FORMAT_VERSION,
		name,
		version: "1.0.0",
		...overrides,
	};
}

const KNOWN = ["slot.memory", "slot.summary", "slot.lore"];

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

describe("玩法包清单", () => {
	it("解析完整字段并给缺省值", () => {
		const manifest = parsePlaypackManifest(
			playpack("xianxia", {
				title: " 修仙跑团包 ",
				description: "境界与宗门",
				requirements: {
					playpacks: [{ name: "base" }],
					plugins: [{ name: "xianxia.core", versionRange: "^1.0.0" }],
				},
				plugins: [skillPlugin("xianxia.core")],
				config: { "slot.memory": { limit: 20 } },
				switches: { "slot.summary": false },
			}),
		);
		expect(manifest.name).toBe("xianxia");
		expect(manifest.title).toBe("修仙跑团包");
		expect(manifest.requirements.playpacks).toEqual([{ name: "base" }]);
		expect(manifest.requirements.plugins).toEqual([
			{ name: "xianxia.core", versionRange: "^1.0.0" },
		]);
		expect(manifest.plugins.map((plugin) => plugin.name)).toEqual([
			"xianxia.core",
		]);
		expect(manifest.config).toEqual({ "slot.memory": { limit: 20 } });
		expect(manifest.switches).toEqual({ "slot.summary": false });

		const empty = parsePlaypackManifest(playpack("plain"));
		expect(empty.requirements).toEqual({ plugins: [], playpacks: [] });
		expect(empty.plugins).toEqual([]);
		expect(empty.config).toEqual({});
		expect(empty.switches).toEqual({});
		expect(empty.title).toBeUndefined();
	});

	it("外壳字段与补丁严格校验", () => {
		expect(() =>
			parsePlaypackManifest(playpack("a", { format: "other" })),
		).toThrow("playpack.format 必须是 dramaticer.playpack");
		expect(() =>
			parsePlaypackManifest(playpack("a", { formatVersion: 2 })),
		).toThrow("playpack.formatVersion 只支持 1");
		expect(() => parsePlaypackManifest(playpack("A_Pack"))).toThrow(
			"playpack.name 只能包含小写字母、数字、点、下划线与连字符",
		);
		expect(() =>
			parsePlaypackManifest(playpack("a", { version: "1.0" })),
		).toThrow("playpack.version 必须是形如 1.2.3 的版本号");
		expect(() => parsePlaypackManifest(playpack("a", { extra: 1 }))).toThrow(
			"playpack.extra 是未知字段",
		);
		expect(() =>
			parsePlaypackManifest(
				playpack("a", { switches: { "slot.lore": "off" } }),
			),
		).toThrow("playpack.switches.slot.lore 必须是布尔值");
		expect(() =>
			parsePlaypackManifest(playpack("a", { config: { "slot.lore": 1 } })),
		).toThrow("playpack.config.slot.lore 必须是对象");
		expect(() =>
			parsePlaypackManifest(
				playpack("a", {
					plugins: [skillPlugin("same.name"), skillPlugin("same.name")],
				}),
			),
		).toThrow("playpack.plugins[1].name 重复：same.name");
	});

	it("一组玩法包拒绝同名与函数", () => {
		expect(() => parsePlaypacks([playpack("a"), playpack("a")])).toThrow(
			"playpacks[1].name 重复：a",
		);
		expect(() =>
			parsePlaypackManifest(playpack("a", { title: () => "x" })),
		).toThrow("playpack.title 不是 JSON 值");
		expect(parsePlaypacks(undefined)).toEqual([]);
	});

	it("用户覆盖只接受配置与开关", () => {
		expect(
			parsePlaypackUserOverrides({
				config: { "slot.memory": { limit: 5 } },
				switches: { "slot.lore": true },
			}),
		).toEqual({
			config: { "slot.memory": { limit: 5 } },
			switches: { "slot.lore": true },
		});
		expect(parsePlaypackUserOverrides(undefined)).toEqual({
			config: {},
			switches: {},
		});
		expect(() =>
			parsePlaypackUserOverrides({ plugins: [] }, "overrides"),
		).toThrow("overrides.plugins 是未知字段");
	});
});

describe("玩法包叠加", () => {
	function twoPacks(): Record<string, unknown>[] {
		return [
			playpack("base", {
				plugins: [skillPlugin("base.core")],
				config: {
					"slot.memory": { limit: 20, nested: { a: 1, b: 2 } },
				},
				switches: { "slot.summary": false },
			}),
			playpack("expansion", {
				requirements: {
					playpacks: [{ name: "base" }],
					plugins: [{ name: "base.core" }],
				},
				plugins: [skillPlugin("expansion.core")],
				config: {
					"slot.memory": { limit: 30, nested: { b: 3, c: 4 } },
					"slot.lore": { depth: 2 },
				},
				switches: { "slot.summary": true, "slot.lore": false },
			}),
		];
	}

	it("后加载的包覆盖配置与开关，插件按加载顺序收集", () => {
		const packs = parsePlaypacks(twoPacks());
		const resolved = stackPlaypacks(packs, { knownPluginNames: KNOWN });
		expect(resolved.playpacks).toEqual([
			{ name: "base", version: "1.0.0" },
			{ name: "expansion", version: "1.0.0" },
		]);
		expect(resolved.plugins.map((plugin) => plugin.name)).toEqual([
			"base.core",
			"expansion.core",
		]);
		expect(resolved.configs["slot.memory"]).toEqual({
			limit: 30,
			nested: { a: 1, b: 3, c: 4 },
		});
		expect(resolved.configs["slot.lore"]).toEqual({ depth: 2 });
		expect(resolved.switches).toEqual({
			"slot.summary": true,
			"slot.lore": false,
		});
	});

	it("用户覆盖在最上层，包文件保持原样", () => {
		const packs = deepFreeze(parsePlaypacks(twoPacks()));
		const before = JSON.stringify(packs);
		const overrides = parsePlaypackUserOverrides({
			config: { "slot.memory": { nested: { a: 9 } } },
			switches: { "slot.summary": false, "slot.lore": true },
		});
		const resolved = stackPlaypacks(packs, {
			overrides,
			knownPluginNames: KNOWN,
		});
		expect(resolved.configs["slot.memory"]).toEqual({
			limit: 30,
			nested: { a: 9, b: 3, c: 4 },
		});
		expect(resolved.switches).toEqual({
			"slot.summary": false,
			"slot.lore": true,
		});
		expect(JSON.stringify(packs)).toBe(before);
		expect(JSON.stringify(overrides)).toBe(
			JSON.stringify({
				config: { "slot.memory": { nested: { a: 9 } } },
				switches: { "slot.summary": false, "slot.lore": true },
			}),
		);

		const memoryConfig = resolved.configs["slot.memory"] as {
			nested: Record<string, unknown>;
		};
		memoryConfig.nested.a = 100;
		expect(
			(packs[0]?.config as Record<string, { nested: { a: number } }>)[
				"slot.memory"
			]?.nested.a,
		).toBe(1);
	});

	it("开关默认启用，显式关闭后才不启用", () => {
		const resolved = stackPlaypacks(parsePlaypacks(twoPacks()), {
			knownPluginNames: KNOWN,
		});
		expect(isPlaypackPluginEnabled(resolved, "base.core")).toBe(true);
		expect(isPlaypackPluginEnabled(resolved, "slot.lore")).toBe(false);
		expect(isPlaypackPluginEnabled(resolved, "slot.summary")).toBe(true);
	});

	it("跨包重名插件与重复玩法包被拒绝", () => {
		expect(() =>
			stackPlaypacks(
				parsePlaypacks([
					playpack("base", { plugins: [skillPlugin("dup.core")] }),
					playpack("other", { plugins: [skillPlugin("dup.core")] }),
				]),
			),
		).toThrow("玩法包 other 定义的插件 dup.core 已被更早的玩法包定义");

		const packs = parsePlaypacks([playpack("base")]);
		expect(() => stackPlaypacks([...packs, ...packs])).toThrow(
			"玩法包 base 在叠加里出现了两次",
		);
	});

	it("依赖必须由更早的层满足", () => {
		const [base, expansion] = parsePlaypacks(twoPacks());
		expect(() => stackPlaypacks([expansion as never])).toThrow(
			"玩法包 expansion 需要更早加载的玩法包 base",
		);
		expect(() =>
			stackPlaypacks([
				parsePlaypackManifest(
					playpack("needs-plugin", {
						requirements: { plugins: [{ name: "base.core" }] },
					}),
				),
			]),
		).toThrow("玩法包 needs-plugin 需要更早加载的插件 base.core");
		expect(() =>
			stackPlaypacks([
				parsePlaypackManifest(
					playpack("self-pack", {
						requirements: { plugins: [{ name: "base.core" }] },
					}),
				),
			]),
		).toThrow("更早加载的插件 base.core");
		expect(base?.name).toBe("base");
	});

	it("配置与开关引用未知插件时指出来源", () => {
		expect(() =>
			stackPlaypacks(
				parsePlaypacks([
					playpack("base", { config: { "slot.missing": { a: 1 } } }),
				]),
				{ knownPluginNames: KNOWN },
			),
		).toThrow("玩法包 base 的配置引用了未知插件：slot.missing");
		expect(() =>
			stackPlaypacks(
				parsePlaypacks([playpack("base", { switches: { ghost: true } })]),
			),
		).toThrow("玩法包 base 的开关引用了未知插件：ghost");
		expect(() =>
			stackPlaypacks(parsePlaypacks([playpack("base")]), {
				overrides: parsePlaypackUserOverrides({
					config: { ghost: {} },
				}),
			}),
		).toThrow("用户覆盖的配置引用了未知插件：ghost");
	});
});

import { describe, expect, it } from "vitest";
import {
	CODE_PLUGIN_FORMAT,
	CODE_PLUGIN_FORMAT_VERSION,
	type CodePluginPermission,
	describeCodePluginPermissions,
	diffCodePluginPermissions,
	isEngineCompatible,
	parseCodePluginManifest,
	parseCodePluginManifests,
} from "../src/index.js";

const base = {
	format: CODE_PLUGIN_FORMAT,
	formatVersion: CODE_PLUGIN_FORMAT_VERSION,
	name: "test.code",
	version: "1.0.0",
	tier: "code",
	engine: ">=0.1.0 <0.2.0",
	entry: "dist/index.js",
};

function manifestWith(extra: Record<string, unknown> = {}) {
	return { ...base, ...extra };
}

const permissions: Record<string, unknown>[] = [
	{ kind: "network", hosts: ["api.example.com", "*.example.org:8443"] },
	{ kind: "files", access: "read-write", paths: ["data", "cache/state.json"] },
	{ kind: "model", roles: ["settler", "planner"] },
	{ kind: "ledger-write", namespaces: ["character", "clue"] },
];

describe("代码插件清单", () => {
	it("解析全部字段并保留权限范围", () => {
		const manifest = parseCodePluginManifest(
			manifestWith({
				title: "对照表",
				description: "把对照表注入槽位",
				inject: ["story-store"],
				provide: ["lore-lookup"],
				configSchema: {
					type: "object",
					properties: { depth: { type: "integer" } },
				},
				permissions,
			}),
		);
		expect(manifest).toEqual({
			format: CODE_PLUGIN_FORMAT,
			formatVersion: CODE_PLUGIN_FORMAT_VERSION,
			name: "test.code",
			version: "1.0.0",
			tier: "code",
			engine: ">=0.1.0 <0.2.0",
			entry: "dist/index.js",
			title: "对照表",
			description: "把对照表注入槽位",
			inject: ["story-store"],
			provide: ["lore-lookup"],
			configSchema: {
				type: "object",
				properties: { depth: { type: "integer" } },
			},
			permissions,
		});
	});

	it("可选项缺省时是空服务清单与空权限清单", () => {
		const manifest = parseCodePluginManifest(manifestWith());
		expect(manifest.inject).toEqual([]);
		expect(manifest.provide).toEqual([]);
		expect(manifest.permissions).toEqual([]);
		expect("configSchema" in manifest).toBe(false);
		expect("title" in manifest).toBe(false);
	});

	it("外壳字段错误时指出字段路径", () => {
		expect(() =>
			parseCodePluginManifest(manifestWith({ extra: true })),
		).toThrow(/codePlugin\.extra 是未知字段/);
		expect(() =>
			parseCodePluginManifest(manifestWith({ format: "dramaticer.plugin" })),
		).toThrow(/codePlugin\.format/);
		expect(() =>
			parseCodePluginManifest(manifestWith({ formatVersion: 2 })),
		).toThrow(/codePlugin\.formatVersion/);
		expect(() =>
			parseCodePluginManifest(manifestWith({ tier: "declarative" })),
		).toThrow(/codePlugin\.tier 必须是 code/);
		expect(() =>
			parseCodePluginManifest(manifestWith({ name: "Test Code" })),
		).toThrow(/codePlugin\.name/);
		expect(() =>
			parseCodePluginManifest(manifestWith({ version: "1.0" })),
		).toThrow(/codePlugin\.version/);
		expect(() =>
			parseCodePluginManifest(manifestWith({ engine: "newest" })),
		).toThrow(/codePlugin\.engine 不是合法的版本范围/);
	});

	it("函数无法通过清单解析", () => {
		expect(() =>
			parseCodePluginManifest(
				manifestWith({ apply: () => undefined }) as unknown,
			),
		).toThrow(/不是 JSON 值/);
	});

	it("入口必须是插件目录内的 js 模块", () => {
		for (const entry of [
			"/dist/index.js",
			"C:/plugins/index.js",
			"dist\\index.js",
			"dist/../index.js",
			"dist//index.js",
			"dist/index",
			"",
		]) {
			expect(() => parseCodePluginManifest(manifestWith({ entry }))).toThrow(
				/codePlugin\.entry/,
			);
		}
		expect(
			parseCodePluginManifest(manifestWith({ entry: "entry.mjs" })).entry,
		).toBe("entry.mjs");
	});

	it("服务名重复、重叠或不合语法时拒绝", () => {
		expect(() =>
			parseCodePluginManifest(manifestWith({ inject: ["cache", "cache"] })),
		).toThrow(/codePlugin\.inject\[1\] 重复：cache/);
		expect(() =>
			parseCodePluginManifest(
				manifestWith({ inject: ["cache"], provide: ["cache"] }),
			),
		).toThrow(/inject 与 provide 不能同时包含 cache/);
		expect(() =>
			parseCodePluginManifest(manifestWith({ inject: ["StoryStore"] })),
		).toThrow(/codePlugin\.inject\[0\] 只能包含小写字母/);
	});

	it("一组清单内名字重复时整组拒绝", () => {
		expect(() =>
			parseCodePluginManifests([manifestWith(), manifestWith()]),
		).toThrow(/codePlugins\[1\]\.name 重复：test\.code/);
	});
});

describe("代码插件权限", () => {
	it("未知种类、空范围与非法值都被拒绝", () => {
		const cases: [Record<string, unknown>, RegExp][] = [
			[{ kind: "shell", commands: ["ls"] }, /permissions\[0\]\.kind/],
			[
				{ kind: "network", hosts: [] },
				/permissions\[0\]\.hosts 必须是非空数组/,
			],
			[
				{ kind: "network", hosts: ["https://example.com"] },
				/permissions\[0\]\.hosts\[0\]/,
			],
			[
				{ kind: "network", hosts: ["Example.com"] },
				/permissions\[0\]\.hosts\[0\]/,
			],
			[
				{ kind: "files", access: "write", paths: ["data"] },
				/permissions\[0\]\.access/,
			],
			[
				{ kind: "files", access: "read", paths: ["/etc"] },
				/permissions\[0\]\.paths\[0\]/,
			],
			[
				{ kind: "files", access: "read", paths: [".."] },
				/permissions\[0\]\.paths\[0\]/,
			],
			[{ kind: "model", roles: ["boss"] }, /permissions\[0\]\.roles\[0\]/],
			[
				{ kind: "ledger-write", namespaces: ["inventory"] },
				/permissions\[0\]\.namespaces\[0\]/,
			],
		];
		for (const [permission, message] of cases) {
			expect(() =>
				parseCodePluginManifest(manifestWith({ permissions: [permission] })),
			).toThrow(message);
		}
	});

	it("同一类权限不能声明两次", () => {
		expect(() =>
			parseCodePluginManifest(
				manifestWith({
					permissions: [
						{ kind: "model", roles: ["writer"] },
						{ kind: "model", roles: ["judge"] },
					],
				}),
			),
		).toThrow(/permissions\[1\]\.kind 重复：model/);
	});

	it("安装界面逐条显示四类权限的范围", () => {
		const parsed = parseCodePluginManifest(manifestWith({ permissions }));
		expect(describeCodePluginPermissions(parsed.permissions)).toEqual([
			{
				kind: "network",
				summary: "网络访问：api.example.com、*.example.org:8443",
			},
			{ kind: "files", summary: "读写文件：data、cache/state.json" },
			{ kind: "model", summary: "调用模型：settler、planner" },
			{ kind: "ledger-write", summary: "写入台账：character、clue" },
		]);
		const readOnly = parseCodePluginManifest(
			manifestWith({
				permissions: [{ kind: "files", access: "read", paths: ["data"] }],
			}),
		);
		expect(describeCodePluginPermissions(readOnly.permissions)).toEqual([
			{ kind: "files", summary: "读取文件：data" },
		]);
	});

	it("升级时只列出权限的实际变化", () => {
		const previous: CodePluginPermission[] = [
			{ kind: "network", hosts: ["api.example.com"] },
			{ kind: "model", roles: ["settler"] },
		];
		const widened: CodePluginPermission[] = [
			{ kind: "network", hosts: ["api.example.com", "*.example.org"] },
			{ kind: "model", roles: ["settler"] },
		];
		const changes = diffCodePluginPermissions(previous, widened);
		expect(changes.requiresConfirmation).toBe(true);
		expect(changes.added.map((change) => change.summary)).toEqual([
			"网络访问：api.example.com、*.example.org",
		]);
		expect(changes.removed.map((change) => change.summary)).toEqual([
			"网络访问：api.example.com",
		]);

		const narrowed = diffCodePluginPermissions(widened, [
			{ kind: "network", hosts: ["api.example.com", "*.example.org"] },
		]);
		expect(narrowed.added).toEqual([]);
		expect(narrowed.removed.map((change) => change.summary)).toEqual([
			"调用模型：settler",
		]);

		const reordered = diffCodePluginPermissions(
			[{ kind: "model", roles: ["settler", "planner"] }],
			[{ kind: "model", roles: ["planner", "settler"] }],
		);
		expect(reordered.requiresConfirmation).toBe(false);

		const fresh = diffCodePluginPermissions([], previous);
		expect(fresh.added).toHaveLength(2);
		expect(fresh.removed).toEqual([]);
		expect(
			diffCodePluginPermissions(previous, previous).requiresConfirmation,
		).toBe(false);
	});
});

describe("代码插件兼容范围", () => {
	it("按 semver 范围判断本机版本", () => {
		expect(isEngineCompatible(">=0.1.0 <0.2.0", "0.1.0")).toBe(true);
		expect(isEngineCompatible(">=0.1.0 <0.2.0", "0.1.9")).toBe(true);
		expect(isEngineCompatible(">=0.1.0 <0.2.0", "0.2.0")).toBe(false);
		expect(isEngineCompatible("^0.2.0", "0.1.0")).toBe(false);
		expect(() => isEngineCompatible(">=0.1.0", "dev")).toThrow(
			/engineVersion 不是合法的版本号/,
		);
		expect(() => isEngineCompatible("latest", "0.1.0")).toThrow(
			/engineRange 不是合法的版本范围/,
		);
	});
});

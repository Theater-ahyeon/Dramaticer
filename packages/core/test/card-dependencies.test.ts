import { describe, expect, it } from "vitest";
import {
	checkCardDependencies,
	parseDeclarativeRequirements,
} from "../src/index.js";

const empty = parseDeclarativeRequirements(undefined);

describe("卡片依赖核对", () => {
	it("缺少必需插件时给出安装建议，必需依赖未满足", () => {
		const report = checkCardDependencies({
			requires: parseDeclarativeRequirements({
				plugins: [{ name: "xianxia.core", versionRange: "^1.2.0" }],
			}),
			recommends: empty,
		});
		expect(report.satisfied).toBe(false);
		expect(report.issues).toEqual([
			{
				kind: "plugin",
				level: "required",
				name: "xianxia.core",
				versionRange: "^1.2.0",
				installedVersion: null,
				status: "missing",
				message:
					"缺少必需插件 xianxia.core（版本 ^1.2.0），请先安装 xianxia.core",
			},
		]);
	});

	it("缺少推荐玩法包时只给提示，不影响必需依赖结论", () => {
		const report = checkCardDependencies({
			requires: empty,
			recommends: parseDeclarativeRequirements({
				playpacks: [{ name: "xianxia.pack" }],
			}),
		});
		expect(report.satisfied).toBe(true);
		expect(report.issues).toEqual([
			expect.objectContaining({
				kind: "playpack",
				level: "recommended",
				name: "xianxia.pack",
				versionRange: null,
				status: "missing",
			}),
		]);
		expect(report.issues[0]?.message).toBe("推荐安装玩法包 xianxia.pack");
	});

	it("依赖全部满足时不产生提示", () => {
		const report = checkCardDependencies(
			{
				requires: parseDeclarativeRequirements({
					plugins: [{ name: "xianxia.core", versionRange: "^1.2.0" }],
					playpacks: [{ name: "xianxia.pack", versionRange: ">=2.0.0 <3.0.0" }],
				}),
				recommends: parseDeclarativeRequirements({
					plugins: [{ name: "xianxia.extra", versionRange: "~1.1.0" }],
				}),
			},
			{
				plugins: [
					{ name: "xianxia.core", version: "1.4.0" },
					{ name: "xianxia.extra", version: "1.1.9" },
				],
				playpacks: [{ name: "xianxia.pack", version: "2.3.4" }],
			},
		);
		expect(report).toEqual({ satisfied: true, issues: [] });
	});

	it("已安装版本不满足范围时提示升级", () => {
		const report = checkCardDependencies(
			{
				requires: parseDeclarativeRequirements({
					plugins: [{ name: "xianxia.core", versionRange: "^1.2.0" }],
				}),
				recommends: empty,
			},
			{ plugins: [{ name: "xianxia.core", version: "1.1.0" }], playpacks: [] },
		);
		expect(report.satisfied).toBe(false);
		expect(report.issues[0]).toMatchObject({
			status: "version-mismatch",
			installedVersion: "1.1.0",
		});
		expect(report.issues[0]?.message).toBe(
			"插件 xianxia.core 已安装 1.1.0，不满足 ^1.2.0，请升级 xianxia.core",
		);
	});

	it("已安装但版本未知时不把范围当作满足", () => {
		const report = checkCardDependencies(
			{
				requires: parseDeclarativeRequirements({
					plugins: [{ name: "xianxia.core", versionRange: "^1.2.0" }],
				}),
				recommends: empty,
			},
			{ plugins: [{ name: "xianxia.core" }], playpacks: [] },
		);
		expect(report.satisfied).toBe(false);
		expect(report.issues[0]).toMatchObject({
			status: "unknown-version",
			installedVersion: null,
		});
	});

	it("版本范围按 semver 语法校验", () => {
		expect(() =>
			parseDeclarativeRequirements({
				plugins: [{ name: "xianxia.core", versionRange: "latest" }],
			}),
		).toThrow(
			"requirements.plugins[0].versionRange 不是合法的版本范围：latest",
		);
	});
});

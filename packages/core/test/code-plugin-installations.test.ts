import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	CODE_PLUGIN_FORMAT,
	CODE_PLUGIN_FORMAT_VERSION,
	type CodePluginManifest,
	StoryStore,
	assertInstalledCodePluginsMatch,
	confirmCodePluginInstallation,
	parseCodePluginManifest,
	planCodePluginInstallation,
} from "../src/index.js";

const openedStores: StoryStore[] = [];

function tempDbPath(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-install-"));
	onTestFinished(() => {
		for (const store of openedStores.splice(0)) store.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return join(dir, "story.db");
}

function openStore(path: string): StoryStore {
	const store = StoryStore.open(path);
	openedStores.push(store);
	return store;
}

const npmsource = { kind: "npm" as const, spec: "dramaticer-clock@1.0.0" };

function makeManifest(
	overrides: Record<string, unknown> = {},
): CodePluginManifest {
	return parseCodePluginManifest({
		format: CODE_PLUGIN_FORMAT,
		formatVersion: CODE_PLUGIN_FORMAT_VERSION,
		name: "test.clock",
		version: "1.0.0",
		tier: "code",
		engine: ">=0.1.0 <0.2.0",
		entry: "dist/index.js",
		permissions: [
			{ kind: "network", hosts: ["api.example.com"] },
			{ kind: "model", roles: ["settler"] },
		],
		...overrides,
	});
}

describe("代码插件安装记录", () => {
	it("首次安装列出全部权限并等待确认，确认前没有记录", () => {
		const store = openStore(tempDbPath());
		const plan = planCodePluginInstallation(store, makeManifest(), npmsource);
		expect(plan.previousVersion).toBeNull();
		expect(plan.requiresConfirmation).toBe(true);
		expect(plan.added.map((change) => change.summary)).toEqual([
			"网络访问：api.example.com",
			"调用模型：settler",
		]);
		expect(plan.removed).toEqual([]);
		expect(store.getCodePluginInstallation("test.clock")).toBeNull();
		expect(store.listCodePluginInstallations()).toEqual([]);
	});

	it("确认后写入记录，重新打开数据库仍能读回", () => {
		const path = tempDbPath();
		const store = openStore(path);
		const manifest = makeManifest();
		const plan = planCodePluginInstallation(store, manifest, npmsource);
		const record = confirmCodePluginInstallation(store, plan, {
			installedAt: "2026-11-12T00:00:00.000Z",
		});
		expect(record.name).toBe("test.clock");
		expect(record.version).toBe("1.0.0");
		expect(record.manifest).toEqual(manifest);
		expect(record.grantedPermissions).toEqual(manifest.permissions);
		expect(record.source).toEqual(npmsource);
		expect(record.installedAt).toBe("2026-11-12T00:00:00.000Z");
		const reopened = openStore(path);
		expect(reopened.getCodePluginInstallation("test.clock")).toEqual(record);
		expect(reopened.listCodePluginInstallations()).toEqual([record]);
	});

	it("升级只列出新增与移除的权限", () => {
		const store = openStore(tempDbPath());
		confirmCodePluginInstallation(
			store,
			planCodePluginInstallation(store, makeManifest(), npmsource),
			{ installedAt: "2026-11-12T00:00:00.000Z" },
		);
		const upgraded = makeManifest({
			version: "1.1.0",
			permissions: [
				{ kind: "network", hosts: ["api.example.com", "cdn.example.com"] },
				{ kind: "files", access: "read", paths: ["data"] },
			],
		});
		const plan = planCodePluginInstallation(store, upgraded, {
			kind: "git",
			spec: "https://example.com/clock.git",
		});
		expect(plan.previousVersion).toBe("1.0.0");
		expect(plan.requiresConfirmation).toBe(true);
		expect(plan.added.map((change) => change.summary)).toEqual([
			"网络访问：api.example.com、cdn.example.com",
			"读取文件：data",
		]);
		expect(plan.removed.map((change) => change.summary)).toEqual([
			"网络访问：api.example.com",
			"调用模型：settler",
		]);
		const record = confirmCodePluginInstallation(store, plan, {
			installedAt: "2026-11-12T01:00:00.000Z",
		});
		expect(record.version).toBe("1.1.0");
		expect(record.source.kind).toBe("git");
		expect(store.listCodePluginInstallations()).toHaveLength(1);
	});

	it("权限没有变化时不重复确认", () => {
		const store = openStore(tempDbPath());
		const manifest = makeManifest();
		confirmCodePluginInstallation(
			store,
			planCodePluginInstallation(store, manifest, npmsource),
			{ installedAt: "2026-11-12T00:00:00.000Z" },
		);
		const plan = planCodePluginInstallation(
			store,
			makeManifest({
				version: "1.0.1",
				permissions: [
					{ kind: "model", roles: ["settler"] },
					{ kind: "network", hosts: ["api.example.com"] },
				],
			}),
			npmsource,
		);
		expect(plan.previousVersion).toBe("1.0.0");
		expect(plan.requiresConfirmation).toBe(false);
		expect(plan.added).toEqual([]);
		expect(plan.removed).toEqual([]);
		const record = confirmCodePluginInstallation(store, plan, {
			installedAt: "2026-11-12T02:00:00.000Z",
		});
		expect(record.version).toBe("1.0.1");
	});

	it("拒绝安装后不留记录", () => {
		const store = openStore(tempDbPath());
		planCodePluginInstallation(store, makeManifest(), npmsource);
		expect(store.listCodePluginInstallations()).toEqual([]);
	});

	it("计划与当前记录对不上时拒绝写入", () => {
		const store = openStore(tempDbPath());
		const stale = planCodePluginInstallation(store, makeManifest(), npmsource);
		const upgraded = planCodePluginInstallation(
			store,
			makeManifest({ version: "1.1.0" }),
			npmsource,
		);
		confirmCodePluginInstallation(store, upgraded, {
			installedAt: "2026-11-12T00:00:00.000Z",
		});
		expect(() =>
			confirmCodePluginInstallation(store, stale, {
				installedAt: "2026-11-12T00:00:00.000Z",
			}),
		).toThrow(/安装计划已过期：test\.clock/);
		expect(store.getCodePluginInstallation("test.clock")?.version).toBe(
			"1.1.0",
		);
	});

	it("启动核对通过，清单或记录不一致时指出插件名", () => {
		const store = openStore(tempDbPath());
		const manifest = makeManifest();
		confirmCodePluginInstallation(
			store,
			planCodePluginInstallation(store, manifest, npmsource),
			{ installedAt: "2026-11-12T00:00:00.000Z" },
		);
		expect(() =>
			assertInstalledCodePluginsMatch(store, [manifest]),
		).not.toThrow();
		expect(() =>
			assertInstalledCodePluginsMatch(store, [
				makeManifest({ description: "磁盘上的清单被改过" }),
			]),
		).toThrow(/安装记录与磁盘清单不一致：test\.clock/);
		expect(() => assertInstalledCodePluginsMatch(store, [])).toThrow(
			/安装记录没有对应的磁盘清单：test\.clock/,
		);
		expect(() =>
			assertInstalledCodePluginsMatch(store, [
				makeManifest(),
				makeManifest({ name: "test.other" }),
			]),
		).toThrow(/缺少安装记录：test\.other/);
	});

	it("存储层拒绝清单与已授予权限不一致的记录", () => {
		const store = openStore(tempDbPath());
		const manifest = makeManifest();
		const base = {
			name: manifest.name,
			version: manifest.version,
			manifest,
			source: npmsource,
			installedAt: "2026-11-12T00:00:00.000Z",
		};
		expect(() =>
			store.saveCodePluginInstallation({
				...base,
				grantedPermissions: manifest.permissions.slice(0, 1),
			}),
		).toThrow(/已授予的权限与清单声明的权限不一致：test\.clock/);
		expect(() =>
			store.saveCodePluginInstallation({
				...base,
				version: "2.0.0",
				grantedPermissions: manifest.permissions,
			}),
		).toThrow(/安装记录的名称或版本与清单不一致/);
	});

	it("来源必须是 npm、git 或 zip，并带非空说明", () => {
		const store = openStore(tempDbPath());
		expect(() =>
			planCodePluginInstallation(store, makeManifest(), {
				kind: "http",
				spec: "https://example.com",
			} as never),
		).toThrow(/codePluginSource\.kind/);
		expect(() =>
			planCodePluginInstallation(store, makeManifest(), {
				kind: "npm",
				spec: " ",
			}),
		).toThrow(/codePluginSource\.spec 必须是非空字符串/);
		expect(() =>
			planCodePluginInstallation(store, makeManifest(), {
				kind: "zip",
				spec: "clock.zip",
				extra: true,
			} as never),
		).toThrow(/codePluginSource\.extra 是未知字段/);
	});
});

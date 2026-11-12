import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { zipSync } from "fflate";
import { c as createTar } from "tar";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	CODE_PLUGIN_FORMAT,
	CODE_PLUGIN_FORMAT_VERSION,
	CODE_PLUGIN_MANIFEST_FILENAME,
	CodePluginManager,
	ExtensionRegistry,
	StoryStore,
	parseNpmSpec,
} from "../src/index.js";

interface FixtureOptions {
	readonly name?: string;
	readonly version?: string;
	readonly engine?: string;
	readonly permissions?: unknown[];
	readonly entry?: string;
	readonly extraFiles?: Readonly<Record<string, string>>;
}

const DEFAULT_ENTRY = "export default function activate() {}\n";

function tempRoot(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-installer-"));
	onTestFinished(() => {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	});
	return dir;
}

function openStore(root: string): StoryStore {
	const store = StoryStore.open(join(root, "story.db"));
	onTestFinished(() => store.close());
	return store;
}

function writeFixture(root: string, options: FixtureOptions = {}): string {
	const dir = join(root, "fixture");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, CODE_PLUGIN_MANIFEST_FILENAME),
		JSON.stringify({
			format: CODE_PLUGIN_FORMAT,
			formatVersion: CODE_PLUGIN_FORMAT_VERSION,
			name: options.name ?? "fixture.clock",
			version: options.version ?? "1.0.0",
			tier: "code",
			engine: options.engine ?? ">=0.1.0 <0.2.0",
			entry: "index.mjs",
			permissions: options.permissions ?? [],
		}),
		"utf8",
	);
	writeFileSync(join(dir, "index.mjs"), options.entry ?? DEFAULT_ENTRY, "utf8");
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: options.name ?? "fixture.clock",
			version: options.version ?? "1.0.0",
			type: "module",
		}),
		"utf8",
	);
	for (const [path, content] of Object.entries(options.extraFiles ?? {})) {
		const target = join(dir, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content, "utf8");
	}
	return dir;
}

async function packTarball(sourceDir: string, outPath: string): Promise<void> {
	const parent = mkdtempSync(join(dirname(sourceDir), "npm-"));
	cpSync(sourceDir, join(parent, "package"), { recursive: true });
	try {
		await createTar({ cwd: parent, gzip: true, file: outPath }, ["package"]);
	} finally {
		rmSync(parent, { recursive: true, force: true, maxRetries: 5 });
	}
}

function writeZip(sourceDir: string, outPath: string): void {
	const entries: Record<string, Uint8Array> = {};
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			entries[relative(sourceDir, path).replaceAll("\\", "/")] = new Uint8Array(
				readFileSync(path),
			);
		}
	};
	walk(sourceDir);
	writeFileSync(outPath, zipSync(entries));
}

function initGitRepo(dir: string): void {
	execFileSync("git", ["init", "--quiet"], { cwd: dir });
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync(
		"git",
		[
			"-c",
			"user.email=fixture@example.com",
			"-c",
			"user.name=Fixture",
			"commit",
			"-m",
			"fixture",
			"--quiet",
		],
		{ cwd: dir },
	);
}

function npmRegistryFetch(options: {
	readonly name: string;
	readonly version: string;
	readonly tarballUrl: string;
	readonly tarball: Uint8Array;
	readonly integrity: string;
}): typeof fetch {
	const metadataUrl = `https://example.com/${options.name}`;
	const respond = async (input: RequestInfo | URL) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (url === metadataUrl) {
			return new Response(
				JSON.stringify({
					"dist-tags": { latest: options.version },
					versions: {
						[options.version]: {
							dist: {
								tarball: options.tarballUrl,
								integrity: options.integrity,
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (url === options.tarballUrl) {
			return new Response(options.tarball, { status: 200 });
		}
		return new Response("not found", { status: 404 });
	};
	return respond as typeof fetch;
}

function delay(ms: number): Promise<void> {
	const deferred = Promise.withResolvers<void>();
	setTimeout(deferred.resolve, ms);
	return deferred.promise;
}

async function waitForState(
	runtime: { readonly state: string },
	state: string,
	timeoutMs = 3_000,
): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (runtime.state === state) return;
		await delay(20);
	}
	throw new Error(`等待状态 ${state} 超时，当前为 ${runtime.state}`);
}

describe("代码插件安装", () => {
	it("从 npm 来源安装本地 fixture 并写入安装记录", async () => {
		const root = tempRoot();
		const store = openStore(root);
		const fixture = writeFixture(join(root, "source"), {
			permissions: [{ kind: "files", access: "read", paths: ["data"] }],
		});
		const tarballPath = join(root, "fixture-clock.tgz");
		await packTarball(fixture, tarballPath);
		const tarball = new Uint8Array(readFileSync(tarballPath));
		const manager = new CodePluginManager({
			pluginsDir: join(root, "plugins"),
			store,
			engineVersion: "0.1.0",
			npmRegistry: "https://example.com",
			registryFetch: npmRegistryFetch({
				name: "fixture.clock",
				version: "1.0.0",
				tarballUrl: "https://example.com/fixture-clock-1.0.0.tgz",
				tarball,
				integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
			}),
		});
		const preparation = await manager.prepare({
			kind: "npm",
			spec: "fixture.clock@1.0.0",
		});
		expect(preparation.compatible).toBe(true);
		expect(preparation.plan.added.map((change) => change.summary)).toEqual([
			"读取文件：data",
		]);
		const record = await manager.confirm(preparation, {
			installedAt: "2026-11-12T00:00:00.000Z",
		});
		expect(record.grantedPermissions).toEqual(preparation.manifest.permissions);
		expect(
			readFileSync(join(root, "plugins", "fixture.clock", "index.mjs"), "utf8"),
		).toBe(DEFAULT_ENTRY);
		expect(store.getCodePluginInstallation("fixture.clock")?.version).toBe(
			"1.0.0",
		);
		expect(manager.readInstalledManifests().map((item) => item.name)).toEqual([
			"fixture.clock",
		]);
	});

	it("从 git 来源安装本地仓库", async () => {
		const root = tempRoot();
		const store = openStore(root);
		const repo = writeFixture(join(root, "repo"), {
			name: "fixture.git",
			entry: `export default function activate(api) { api.log("git"); }\n`,
			extraFiles: { "docs/readme.md": "fixture" },
		});
		initGitRepo(repo);
		const manager = new CodePluginManager({
			pluginsDir: join(root, "plugins"),
			store,
			engineVersion: "0.1.0",
		});
		const preparation = await manager.prepare({ kind: "git", spec: repo });
		expect(preparation.compatible).toBe(true);
		const record = await manager.confirm(preparation, {
			installedAt: "2026-11-12T00:00:00.000Z",
		});
		expect(record.source).toEqual({ kind: "git", spec: repo });
		const installedDir = join(root, "plugins", "fixture.git");
		expect(existsSync(join(installedDir, "docs", "readme.md"))).toBe(true);
		expect(existsSync(join(installedDir, ".git"))).toBe(false);
	});

	it("从 zip 来源安装本地文件", async () => {
		const root = tempRoot();
		const store = openStore(root);
		const fixture = writeFixture(join(root, "source"), {
			name: "fixture.zip",
			extraFiles: { "data/info.txt": "zipped" },
		});
		const zipPath = join(root, "fixture.zip.zip");
		writeZip(fixture, zipPath);
		const manager = new CodePluginManager({
			pluginsDir: join(root, "plugins"),
			store,
			engineVersion: "0.1.0",
		});
		const preparation = await manager.prepare({ kind: "zip", spec: zipPath });
		const record = await manager.confirm(preparation, {
			installedAt: "2026-11-12T00:00:00.000Z",
		});
		expect(record.version).toBe("1.0.0");
		expect(
			readFileSync(
				join(root, "plugins", "fixture.zip", "data", "info.txt"),
				"utf8",
			),
		).toBe("zipped");
	});

	it("zip 条目逃出安装目录时拒绝解包", async () => {
		const root = tempRoot();
		const store = openStore(root);
		const zipPath = join(root, "evil.zip");
		writeFileSync(
			zipPath,
			zipSync({
				"../escape.txt": new Uint8Array([120]),
				[CODE_PLUGIN_MANIFEST_FILENAME]: new Uint8Array([123, 125]),
			}),
		);
		const manager = new CodePluginManager({
			pluginsDir: join(root, "plugins"),
			store,
			engineVersion: "0.1.0",
		});
		await expect(
			manager.prepare({ kind: "zip", spec: zipPath }),
		).rejects.toThrow(/zip 条目/);
		expect(existsSync(join(root, "escape.txt"))).toBe(false);
		expect(existsSync(join(root, "plugins", "fixture.clock"))).toBe(false);
	});

	it("版本不兼容时给出提示且不安装", async () => {
		const root = tempRoot();
		const store = openStore(root);
		const fixture = writeFixture(join(root, "source"), {
			engine: ">=9.0.0 <10.0.0",
		});
		const zipPath = join(root, "incompatible.zip");
		writeZip(fixture, zipPath);
		const manager = new CodePluginManager({
			pluginsDir: join(root, "plugins"),
			store,
			engineVersion: "0.1.0",
		});
		const preparation = await manager.prepare({ kind: "zip", spec: zipPath });
		expect(preparation.compatible).toBe(false);
		expect(preparation.stagedDir).toBeNull();
		expect(preparation.message).toMatch(/要求 Dramaticer >=9\.0\.0/);
		await expect(manager.confirm(preparation)).rejects.toThrow(
			/要求 Dramaticer >=9\.0\.0/,
		);
		expect(existsSync(join(root, "plugins", "fixture.clock"))).toBe(false);
		expect(store.getCodePluginInstallation("fixture.clock")).toBeNull();
	});

	it("更新检查给出新版本与权限差异，更新保留故事级配置", async () => {
		const root = tempRoot();
		const store = openStore(root);
		const v1 = writeFixture(join(root, "v1"), {
			permissions: [{ kind: "files", access: "read", paths: ["data"] }],
			extraFiles: { "v1-only.txt": "old" },
		});
		const v1Zip = join(root, "v1.zip");
		writeZip(v1, v1Zip);
		const manager = new CodePluginManager({
			pluginsDir: join(root, "plugins"),
			store,
			engineVersion: "0.1.0",
		});
		const first = await manager.prepare({ kind: "zip", spec: v1Zip });
		await manager.confirm(first, { installedAt: "2026-11-12T00:00:00.000Z" });

		store.createStory({ id: "s1", title: "测试" });
		store.updateStorySettings("s1", {
			pluginOverrides: {
				config: { "fixture.clock": { theme: "dark" } },
				switches: {},
			},
		});

		const latest = await manager.checkUpdate("fixture.clock");
		expect(latest.updateAvailable).toBe(false);
		expect(latest.message).toBe("已是最新版本 1.0.0");

		const v2 = writeFixture(join(root, "v2"), {
			version: "2.0.0",
			permissions: [
				{ kind: "files", access: "read", paths: ["data"] },
				{ kind: "model", roles: ["settler"] },
			],
			extraFiles: { "v2-only.txt": "new" },
		});
		writeZip(v2, v1Zip);
		const updateCheck = await manager.checkUpdate("fixture.clock");
		expect(updateCheck.updateAvailable).toBe(true);
		expect(updateCheck.latestVersion).toBe("2.0.0");
		expect(updateCheck.requiresConfirmation).toBe(true);
		expect(updateCheck.added.map((change) => change.summary)).toEqual([
			"调用模型：settler",
		]);

		const preparation = await manager.prepare({ kind: "zip", spec: v1Zip });
		const record = await manager.confirm(preparation, {
			installedAt: "2026-11-12T01:00:00.000Z",
		});
		expect(record.version).toBe("2.0.0");
		const installedDir = join(root, "plugins", "fixture.clock");
		expect(existsSync(join(installedDir, "v2-only.txt"))).toBe(true);
		expect(existsSync(join(installedDir, "v1-only.txt"))).toBe(false);
		expect(
			store.getStorySettings("s1").pluginOverrides.config["fixture.clock"],
		).toEqual({ theme: "dark" });
	});

	it("更新检查提示版本不兼容", async () => {
		const root = tempRoot();
		const store = openStore(root);
		const v1 = writeFixture(join(root, "v1"));
		const zipPath = join(root, "plugin.zip");
		writeZip(v1, zipPath);
		const manager = new CodePluginManager({
			pluginsDir: join(root, "plugins"),
			store,
			engineVersion: "0.1.0",
		});
		const first = await manager.prepare({ kind: "zip", spec: zipPath });
		await manager.confirm(first, { installedAt: "2026-11-12T00:00:00.000Z" });

		const v2 = writeFixture(join(root, "v2"), {
			version: "2.0.0",
			engine: ">=9.0.0 <10.0.0",
		});
		writeZip(v2, zipPath);
		const update = await manager.checkUpdate("fixture.clock");
		expect(update.compatible).toBe(false);
		expect(update.updateAvailable).toBe(false);
		expect(update.message).toMatch(/要求 Dramaticer >=9\.0\.0/);
	});

	it("卸载回收 worker、注册项、插件目录与安装记录", async () => {
		const root = tempRoot();
		const store = openStore(root);
		const fixture = writeFixture(join(root, "source"), {
			name: "fixture.slot",
			entry: `export default function activate(api) {
	api.slot("lore", () => null);
}
`,
		});
		const zipPath = join(root, "slot.zip");
		writeZip(fixture, zipPath);
		const registry = new ExtensionRegistry();
		const manager = new CodePluginManager({
			pluginsDir: join(root, "plugins"),
			store,
			engineVersion: "0.1.0",
			registry,
		});
		const preparation = await manager.prepare({ kind: "zip", spec: zipPath });
		await manager.confirm(preparation, {
			installedAt: "2026-11-12T00:00:00.000Z",
		});
		const runtime = await manager.start("fixture.slot");
		await waitForState(runtime, "active");
		expect(registry.slots().lore).toEqual(["fixture.slot"]);
		expect(manager.runtime("fixture.slot")).toBe(runtime);

		await manager.uninstall("fixture.slot");
		expect(runtime.state).toBe("disposed");
		expect(registry.slots()).toEqual({});
		expect(manager.runtime("fixture.slot")).toBeNull();
		expect(existsSync(join(root, "plugins", "fixture.slot"))).toBe(false);
		expect(store.getCodePluginInstallation("fixture.slot")).toBeNull();
		await expect(manager.uninstall("fixture.slot")).rejects.toThrow(
			/插件没有安装/,
		);
	});

	it("解析 npm 来源说明", () => {
		expect(parseNpmSpec("pkg")).toEqual({ name: "pkg", wanted: "" });
		expect(parseNpmSpec("pkg@1.2.3")).toEqual({ name: "pkg", wanted: "1.2.3" });
		expect(parseNpmSpec("@scope/pkg")).toEqual({
			name: "@scope/pkg",
			wanted: "",
		});
		expect(parseNpmSpec("@scope/pkg@^1.0.0")).toEqual({
			name: "@scope/pkg",
			wanted: "^1.0.0",
		});
		expect(() => parseNpmSpec("@scope")).toThrow(/缺少包名/);
		expect(() => parseNpmSpec("Pkg")).toThrow(/包名不合法/);
	});
});

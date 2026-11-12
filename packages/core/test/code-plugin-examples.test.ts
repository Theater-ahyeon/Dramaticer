import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	CODE_PLUGIN_FORMAT,
	CODE_PLUGIN_FORMAT_VERSION,
	CODE_PLUGIN_MANIFEST_FILENAME,
	CODE_PLUGIN_PERMISSION_KINDS,
	CODE_PLUGIN_TIER,
	CONTEXT_SLOT_NAMES,
	type CodePluginPermission,
	type CodePluginRuntime,
	ExtensionRegistry,
	LEDGER_NAMESPACES,
	LLM_MODEL_ROLE_NAMES,
	parseCodePluginManifest,
	startCodePluginRuntime,
} from "../src/index.js";

const docsDir = join(import.meta.dirname, "../../../docs/plugins");
const pluginDir = join(docsDir, "examples", "code-travel-log");
const manifestPath = join(pluginDir, CODE_PLUGIN_MANIFEST_FILENAME);
const docPath = join(docsDir, "code-plugins.md");

const runtimes: CodePluginRuntime[] = [];

function readManifest() {
	return parseCodePluginManifest(
		JSON.parse(readFileSync(manifestPath, "utf8")),
		"example",
	);
}

async function start(
	grantedPermissions: readonly CodePluginPermission[],
): Promise<{ runtime: CodePluginRuntime; registry: ExtensionRegistry }> {
	const manifest = readManifest();
	const registry = new ExtensionRegistry();
	const runtime = await startCodePluginRuntime({
		pluginDir,
		manifest,
		grantedPermissions,
		registry,
		config: { file: "data/travel.md" },
	});
	runtimes.push(runtime);
	return { runtime, registry };
}

function slotRequest() {
	return {
		slot: "memory" as const,
		storyId: "story-1",
		nodeId: null,
		switches: {},
		state: null,
	};
}

afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.dispose();
});

describe("示例代码插件", () => {
	it("清单通过解析，示例目录提供入口与数据文件", () => {
		const manifest = readManifest();
		expect(manifest.name).toBe("example.travel-log");
		expect(manifest.tier).toBe(CODE_PLUGIN_TIER);
		expect(manifest.entry).toBe("plugin.mjs");
		expect(manifest.permissions).toEqual([
			{ kind: "files", access: "read", paths: ["data"] },
		]);
		expect(manifest.configSchema).toMatchObject({ type: "object" });
	});

	it("按声明的文件权限在沙箱里装载并注册三种扩展点", async () => {
		const { runtime, registry } = await start(readManifest().permissions);
		expect(runtime.state).toBe("active");

		expect(registry.blockTypes()).toContain("旅行日志");
		expect(registry.blockType("旅行日志")).toMatchObject({
			name: "旅行日志",
			display: { kind: "html" },
			context: { kind: "keep-depth", depth: 2 },
			semantics: { kind: "none" },
		});

		expect(registry.toolNames()).toContain("travel_log");
		const tool = registry.tool("travel_log");
		expect(tool?.permission).toBe("read");
		expect(registry.tools("fast").map((entry) => entry.name)).toContain(
			"travel_log",
		);
		const result = (await tool?.execute?.({})) as { text: string };
		expect(result.text).toContain("渡口换船");

		const content = await registry
			.slotProviders("memory")[0]
			?.provider.provide(slotRequest());
		expect(content?.source).toBe("example.travel-log");
		expect(content?.messages[0]?.content).toContain("悬赏一柄失窃的短剑");

		const read = runtime.trace.find(
			(entry) =>
				entry.kind === "permission" &&
				entry.action === "files.read" &&
				entry.outcome === "allowed",
		);
		expect(read?.target).toBe("read:data/travel.md");
	});

	it("没有授予文件权限时槽位与工具都失败，Trace 记拒绝且插件保持运行", async () => {
		const { runtime, registry } = await start([]);
		expect(runtime.state).toBe("active");

		const content = await registry
			.slotProviders("memory")[0]
			?.provider.provide(slotRequest());
		expect(content).toBeNull();
		const tool = registry.tool("travel_log");
		await expect(tool?.execute?.({})).rejects.toThrow("没有声明文件权限");

		const denied = runtime.trace.filter(
			(entry) =>
				entry.kind === "permission" &&
				entry.capability === "files" &&
				entry.outcome === "denied",
		);
		expect(denied.length).toBe(2);
		expect(runtime.state).toBe("active");
	});

	it("停止后撤销全部注册项", async () => {
		const { runtime, registry } = await start(readManifest().permissions);
		await runtime.dispose();
		expect(runtime.state).toBe("disposed");
		expect(registry.blockTypes()).toEqual([]);
		expect(registry.toolNames()).toEqual([]);
		expect(registry.slotProviders("memory")).toEqual([]);
	});
});

describe("代码插件开发文档", () => {
	it("覆盖清单字段、四类权限与运行时 API", () => {
		const doc = readFileSync(docPath, "utf8");
		for (const key of [
			"format",
			"formatVersion",
			"name",
			"version",
			"tier",
			"engine",
			"entry",
			"title",
			"description",
			"inject",
			"provide",
			"configSchema",
			"permissions",
		]) {
			expect(doc).toContain(`\`${key}\``);
		}
		for (const kind of CODE_PLUGIN_PERMISSION_KINDS) {
			expect(doc).toContain(`\`${kind}\``);
		}
		for (const role of LLM_MODEL_ROLE_NAMES) {
			expect(doc).toContain(`\`${role}\``);
		}
		for (const namespace of LEDGER_NAMESPACES) {
			expect(doc).toContain(`\`${namespace}\``);
		}
		for (const slot of CONTEXT_SLOT_NAMES) {
			expect(doc).toContain(`\`${slot}\``);
		}
		for (const method of [
			"activate",
			"network",
			"readFile",
			"writeFile",
			"model",
			"writeLedger",
			"slot",
			"tool",
			"blockType",
			"mechanism",
			"onDispose",
			"log",
		]) {
			expect(doc).toContain(`\`${method}()`);
		}
		expect(doc).toContain(`\`${CODE_PLUGIN_FORMAT}\``);
		expect(doc).toContain(`\`${CODE_PLUGIN_TIER}\``);
		expect(doc).toContain(`\`${CODE_PLUGIN_MANIFEST_FILENAME}\``);
		expect(doc).toContain(
			`\`formatVersion\` 只支持 ${CODE_PLUGIN_FORMAT_VERSION}`,
		);
	});
});

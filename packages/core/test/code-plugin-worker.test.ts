import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	CODE_PLUGIN_FORMAT,
	CODE_PLUGIN_FORMAT_VERSION,
	type CodePluginManifest,
	type CodePluginModelRequest,
	type CodePluginRuntime,
	ExtensionRegistry,
	type LedgerDiffInput,
	parseCodePluginManifest,
	startCodePluginRuntime,
} from "../src/index.js";

const tempDirs: string[] = [];
const runtimes: CodePluginRuntime[] = [];

function tempPluginDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-worker-"));
	mkdirSync(join(dir, "data"), { recursive: true });
	tempDirs.push(dir);
	return dir;
}

function makeManifest(
	permissions: unknown[] = [],
	overrides: Record<string, unknown> = {},
): CodePluginManifest {
	return parseCodePluginManifest({
		format: CODE_PLUGIN_FORMAT,
		formatVersion: CODE_PLUGIN_FORMAT_VERSION,
		name: "test.probe",
		version: "1.0.0",
		tier: "code",
		engine: ">=0.1.0 <0.2.0",
		entry: "plugin.mjs",
		permissions,
		...overrides,
	});
}

function writePlugin(dir: string, source: string): void {
	writeFileSync(join(dir, "plugin.mjs"), source, "utf8");
}

async function start(
	dir: string,
	manifest: CodePluginManifest,
	granted = manifest.permissions,
	options: Partial<Parameters<typeof startCodePluginRuntime>[0]> = {},
): Promise<CodePluginRuntime> {
	const runtime = await startCodePluginRuntime({
		pluginDir: dir,
		manifest,
		grantedPermissions: granted,
		...options,
	});
	runtimes.push(runtime);
	return runtime;
}

async function waitForState(
	runtime: CodePluginRuntime,
	state: CodePluginRuntime["state"],
	timeoutMs = 3_000,
): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (runtime.state === state) return;
		await sleep(20);
	}
	throw new Error(
		`等待插件状态 ${state} 超时，当前为 ${runtime.state}：${runtime.status.reason ?? ""}`,
	);
}

async function sleep(ms: number): Promise<void> {
	const deferred = Promise.withResolvers<void>();
	setTimeout(deferred.resolve, ms);
	return deferred.promise;
}

function fetchPong(): typeof fetch {
	return async () =>
		new Response("pong", {
			status: 200,
			headers: { "content-type": "text/plain" },
		});
}

function capabilityProbePlugin(): string {
	return `
export default async function activate(api) {
	api.slot("lore", async function () {
		const result = {};
		try {
			const response = await api.network("https://example.com/data");
			result.network = response.body;
		} catch (error) {
			result.networkError = error.message;
		}
		try {
			result.read = (await api.readFile("data/input.txt")).content;
		} catch (error) {
			result.readError = error.message;
		}
		try {
			result.write = (await api.writeFile("data/output.txt", "written")).written;
		} catch (error) {
			result.writeError = error.message;
		}
		try {
			result.model = await api.model("settler", [{ role: "user", content: "hi" }], { temperature: 0 });
		} catch (error) {
			result.modelError = error.message;
		}
		try {
			result.ledger = await api.writeLedger([
				{ path: ["clue", "c1", "text"], op: "set", value: "线索" },
			]);
		} catch (error) {
			result.ledgerError = error.message;
		}
		return {
			messages: [{ role: "system", content: JSON.stringify(result) }],
			source: "probe",
		};
	});
}
`;
}

async function provideLore(
	registry: ExtensionRegistry,
): Promise<Record<string, unknown>> {
	const entry = registry.slotProviders("lore")[0];
	expect(entry).toBeDefined();
	const content = await entry.provider.provide({
		slot: "lore",
		storyId: "story-1",
		nodeId: null,
		switches: {},
		state: null,
	});
	expect(content).not.toBeNull();
	const raw = content?.messages[0]?.content;
	expect(typeof raw).toBe("string");
	return JSON.parse(raw as string) as Record<string, unknown>;
}

afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.dispose();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 20,
		});
	}
});

describe("代码插件 worker 隔离", () => {
	it("声明过的四类能力正常执行，并各写一条 allowed Trace", async () => {
		const dir = tempPluginDir();
		writeFileSync(join(dir, "data", "input.txt"), "hello", "utf8");
		writePlugin(dir, capabilityProbePlugin());
		const manifest = makeManifest([
			{ kind: "network", hosts: ["example.com"] },
			{ kind: "files", access: "read-write", paths: ["data"] },
			{ kind: "model", roles: ["settler"] },
			{ kind: "ledger-write", namespaces: ["clue"] },
		]);
		const registry = new ExtensionRegistry();
		const submitted: (readonly LedgerDiffInput[])[] = [];
		let modelRole: string | null = null;
		const runtime = await start(dir, manifest, manifest.permissions, {
			registry,
			fetch: fetchPong(),
			model: (request: CodePluginModelRequest) => {
				modelRole = request.role;
				return { answer: 42 };
			},
			ledger: (diffs) => {
				submitted.push(diffs);
			},
		});
		expect(runtime.state).toBe("active");
		const result = await provideLore(registry);
		expect(result.network).toBe("pong");
		expect(result.read).toBe("hello");
		expect(result.write).toBe(7);
		expect(result.model).toEqual({ answer: 42 });
		expect(modelRole).toBe("settler");
		expect(result.ledger).toEqual({ accepted: 1 });
		expect(submitted).toHaveLength(1);
		expect(submitted[0][0]).toMatchObject({
			path: ["clue", "c1", "text"],
			op: "set",
			value: "线索",
			source: "settler",
		});
		const allowed = runtime.trace.filter(
			(entry) => entry.kind === "permission" && entry.outcome === "allowed",
		);
		expect(allowed.map((entry) => entry.capability).sort()).toEqual([
			"files",
			"files",
			"ledger-write",
			"model",
			"network",
		]);
	});

	it("未声明的四类调用各被拒绝，能力实现与台账接收器都不会被调用", async () => {
		const dir = tempPluginDir();
		writeFileSync(join(dir, "data", "input.txt"), "hello", "utf8");
		writePlugin(dir, capabilityProbePlugin());
		const manifest = makeManifest();
		const registry = new ExtensionRegistry();
		let modelCalls = 0;
		let ledgerCalls = 0;
		const runtime = await start(dir, manifest, [], {
			registry,
			fetch: fetchPong(),
			model: () => {
				modelCalls += 1;
				return { answer: 42 };
			},
			ledger: () => {
				ledgerCalls += 1;
			},
		});
		const result = await provideLore(registry);
		expect(result.networkError).toContain("没有声明访问");
		expect(result.readError).toContain("没有声明文件权限");
		expect(result.writeError).toContain("没有声明文件权限");
		expect(result.modelError).toContain("没有声明调用 settler 模型的权限");
		expect(result.ledgerError).toContain("没有声明写入 clue 台账的权限");
		expect(modelCalls).toBe(0);
		expect(ledgerCalls).toBe(0);
		const denied = runtime.trace.filter(
			(entry) => entry.kind === "permission" && entry.outcome === "denied",
		);
		expect(new Set(denied.map((entry) => entry.capability))).toEqual(
			new Set(["network", "files", "model", "ledger-write"]),
		);
		expect(denied.every((entry) => entry.reason !== null)).toBe(true);
		expect(runtime.state).toBe("active");
	});

	it("只读文件权限拒绝写入，声明范围之外的主机与文件路径被拒绝", async () => {
		const dir = tempPluginDir();
		writeFileSync(join(dir, "data", "input.txt"), "hello", "utf8");
		writePlugin(
			dir,
			`
export default function activate(api) {
	api.slot("lore", async function () {
		const result = {};
		try {
			await api.writeFile("data/input.txt", "x");
		} catch (error) {
			result.writeError = error.message;
		}
		try {
			await api.network("https://example.org/");
		} catch (error) {
			result.networkError = error.message;
		}
		try {
			await api.readFile("secrets.txt");
		} catch (error) {
			result.readError = error.message;
		}
		return {
			messages: [{ role: "system", content: JSON.stringify(result) }],
			source: "probe",
		};
	});
}
`,
		);
		const manifest = makeManifest([
			{ kind: "network", hosts: ["example.com"] },
			{ kind: "files", access: "read", paths: ["data"] },
		]);
		const registry = new ExtensionRegistry();
		await start(dir, manifest, manifest.permissions, {
			registry,
			fetch: fetchPong(),
		});
		const result = await provideLore(registry);
		expect(result.writeError).toContain("只允许读取");
		expect(result.networkError).toContain("没有声明访问 example.org");
		expect(result.readError).toContain("没有声明访问 secrets.txt");
	});

	it("台账 diff 必须通过结算器的校验，非法条目不会到达接收器", async () => {
		const dir = tempPluginDir();
		writePlugin(
			dir,
			`
export default function activate(api) {
	api.slot("lore", async function () {
		const result = {};
		try {
			await api.writeLedger([
				{ path: ["item", "sword", "holder"], op: "set", value: "阿甲" },
			]);
		} catch (error) {
			result.namespaceError = error.message;
		}
		try {
			await api.writeLedger([
				{ path: ["clue", "c1", "status"], op: "set", value: "不存在的状态" },
			]);
		} catch (error) {
			result.valueError = error.message;
		}
		return {
			messages: [{ role: "system", content: JSON.stringify(result) }],
			source: "probe",
		};
	});
}
`,
		);
		const manifest = makeManifest([
			{ kind: "ledger-write", namespaces: ["clue"] },
		]);
		const registry = new ExtensionRegistry();
		let ledgerCalls = 0;
		await start(dir, manifest, manifest.permissions, {
			registry,
			ledger: () => {
				ledgerCalls += 1;
			},
		});
		const result = await provideLore(registry);
		expect(result.namespaceError).toContain("没有声明写入 item 台账的权限");
		expect(result.valueError).toContain("台账 diff 校验失败");
		expect(ledgerCalls).toBe(0);
	});

	it("worker 崩溃后主进程继续，插件状态为 failed，注册的扩展点被撤销", async () => {
		const dir = tempPluginDir();
		writePlugin(
			dir,
			`
export default function activate(api) {
	api.slot("lore", async function () {
		return { messages: [{ role: "system", content: "x" }], source: "probe" };
	});
	setTimeout(function () {
		throw new Error("插件崩溃测试");
	}, 20);
}
`,
		);
		const healthyDir = tempPluginDir();
		writePlugin(
			healthyDir,
			`
export default function activate(api) {
	api.slot("lore", async function () {
		return { messages: [{ role: "system", content: "healthy" }], source: "probe" };
	});
}
`,
		);
		const registry = new ExtensionRegistry();
		const crashing = await start(dir, makeManifest(), [], { registry });
		const healthy = await start(
			healthyDir,
			makeManifest([], { name: "test.healthy" }),
			[],
			{ registry },
		);
		await waitForState(crashing, "failed");
		expect(crashing.status.reason).toContain("插件崩溃测试");
		expect(
			crashing.trace.some(
				(entry) => entry.kind === "lifecycle" && entry.outcome === "failed",
			),
		).toBe(true);
		expect(healthy.state).toBe("active");
		const healthyEntry = registry.slotProviders("lore")[0];
		expect(healthyEntry?.plugin).toBe("test.healthy");
		const healthyContent = await healthyEntry?.provider.provide({
			slot: "lore",
			storyId: "story-1",
			nodeId: null,
			switches: {},
			state: null,
		});
		expect(healthyContent?.messages[0]?.content).toBe("healthy");
		const registrations = crashing.trace.filter(
			(entry) => entry.action === "slot",
		);
		expect(
			registrations.some((entry) => entry.outcome === "unregistered"),
		).toBe(true);
	});

	it("激活超时的插件记为失败，不阻塞其他插件", async () => {
		const dir = tempPluginDir();
		writePlugin(
			dir,
			`
export default function activate() {
	return new Promise(function () {});
}
`,
		);
		const runtime = await start(dir, makeManifest(), [], {
			activationTimeoutMs: 100,
		});
		expect(runtime.state).toBe("failed");
		expect(runtime.status.reason).toContain("激活超过 100 毫秒");
	});

	it("调用超时的插件被终止，槽位不再产出内容", async () => {
		const dir = tempPluginDir();
		writePlugin(
			dir,
			`
export default function activate(api) {
	api.slot("lore", function () {
		return new Promise(function () {});
	});
}
`,
		);
		const registry = new ExtensionRegistry();
		const runtime = await start(dir, makeManifest(), [], {
			registry,
			invokeTimeoutMs: 100,
		});
		const entry = registry.slotProviders("lore")[0];
		expect(entry).toBeDefined();
		const content = await entry.provider.provide({
			slot: "lore",
			storyId: "story-1",
			nodeId: null,
			switches: {},
			state: null,
		});
		expect(content).toBeNull();
		expect(runtime.state).toBe("failed");
		expect(registry.slotProviders("lore")).toEqual([]);
	});

	it("超过大小上限的消息被拒绝并终止插件", async () => {
		const dir = tempPluginDir();
		writePlugin(
			dir,
			`
export default function activate(api) {
	api.slot("x".repeat(2048), async function () {
		return { messages: [{ role: "system", content: "x" }], source: "probe" };
	});
}
`,
		);
		const runtime = await start(dir, makeManifest(), [], {
			maxMessageBytes: 256,
		});
		expect(runtime.state).toBe("failed");
		expect(runtime.status.reason).toContain("超过上限");
	});

	it("插件注册的工具只在 active 时可执行，崩溃后从注册表消失", async () => {
		const dir = tempPluginDir();
		writePlugin(
			dir,
			`
export default function activate(api) {
	api.tool(
		{
			name: "plugin_lookup",
			description: "查询插件内部数据",
			parameters: { type: "object", properties: { q: { type: "string" } } },
			permission: "read",
			progressLabel: "查询中……",
		},
		["fast"],
		async function (args) {
			return { echo: args.q };
		},
	);
	setTimeout(function () {
		throw new Error("注册工具后崩溃");
	}, 20);
}
`,
		);
		const registry = new ExtensionRegistry();
		const runtime = await start(dir, makeManifest(), [], { registry });
		const tool = registry.tool("plugin_lookup");
		expect(tool).not.toBeNull();
		expect(await tool?.execute?.({ q: "天气" })).toEqual({ echo: "天气" });
		await waitForState(runtime, "failed");
		expect(registry.tool("plugin_lookup")).toBeNull();
	});

	it("Director 机制的注册被拒绝并写 Trace，插件继续运行", async () => {
		const dir = tempPluginDir();
		writePlugin(
			dir,
			`
export default function activate(api) {
	api.mechanism("test.mechanism");
}
`,
		);
		const runtime = await start(dir, makeManifest());
		await waitForTrace(
			runtime,
			(entry) =>
				entry.kind === "registration" &&
				entry.action === "mechanism" &&
				entry.outcome === "rejected",
		);
		expect(runtime.state).toBe("active");
		const rejected = runtime.trace.find(
			(entry) =>
				entry.kind === "registration" &&
				entry.action === "mechanism" &&
				entry.outcome === "rejected",
		);
		expect(rejected?.reason).toContain("同步纯函数");
	});
});

async function waitForTrace(
	runtime: CodePluginRuntime,
	predicate: (entry: CodePluginRuntime["trace"][number]) => boolean,
	timeoutMs = 3_000,
): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (runtime.trace.some(predicate)) return;
		await sleep(20);
	}
	throw new Error(`等待 Trace 记录超时：${runtime.status.reason ?? ""}`);
}

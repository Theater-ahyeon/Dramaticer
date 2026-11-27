import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	DECLARATIVE_PLUGIN_FORMAT,
	DECLARATIVE_PLUGIN_FORMAT_VERSION,
	type FloorRendererDefinition,
	type FloorRendererPlugin,
	LiteKernel,
	StoryStore,
	allowStorySandboxDomain,
	buildSandboxContentSecurityPolicy,
	createDeclarativeFloorRenderer,
	createDeclarativeFloorRendererPlugin,
	installStoryFloorRenderer,
	listSandboxRejections,
	parseDeclarativePlugin,
	readStoryFloorRenderers,
	readStorySandboxDomains,
	recordSandboxRejection,
	recordStorySandboxDetectedDomains,
	scanSandboxDomains,
	setStorySandboxAllowedDomains,
} from "../src/index.js";

function declarativeFloorRenderer(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		format: DECLARATIVE_PLUGIN_FORMAT,
		formatVersion: DECLARATIVE_PLUGIN_FORMAT_VERSION,
		name: "test.card",
		version: "1.0.0",
		kind: "floor-renderer",
		payload: {
			id: "test-status",
			name: "测试状态栏",
			blockTypes: ["状态栏"],
			permissions: ["sendMessage"],
			template: '<div class="status">{{content}}</div>',
			...overrides,
		},
	};
}

function parseRenderer(
	overrides: Record<string, unknown> = {},
): FloorRendererPlugin {
	const parsed = parseDeclarativePlugin(declarativeFloorRenderer(overrides));
	if (parsed.kind !== "floor-renderer") {
		throw new Error("测试插件必须是楼层渲染器");
	}
	return parsed;
}

describe("楼层渲染器扩展点", () => {
	it("注册后按块类型认领楼层，渲染只读原文", async () => {
		const kernel = new LiteKernel();
		const definition: FloorRendererDefinition = {
			id: "status",
			name: "状态栏",
			blockTypes: ["状态栏"],
			permissions: [],
			render: (input) => ({ html: `<div>${input.raw}</div>` }),
		};
		await kernel.load({
			name: "test/status",
			apply(context) {
				context.floorRenderer(definition);
			},
		});
		expect(kernel.snapshot().floorRenderers).toEqual(["status"]);

		const raw = "<状态栏>气力：3</状态栏>\n雨停了。";
		const outcome = await kernel.renderFloor({
			nodeId: "n1",
			raw,
			state: null,
		});
		expect(outcome.floor?.renderer).toBe("status");
		expect(outcome.floor?.html).toContain(raw);
		expect(outcome.failures).toEqual([]);
		expect(raw).toBe("<状态栏>气力：3</状态栏>\n雨停了。");

		const native = await kernel.renderFloor({
			nodeId: "n2",
			raw: "只有正文。",
			state: null,
		});
		expect(native.floor).toBeNull();
		await kernel.dispose();
	});

	it("按注册顺序匹配，先注册的获胜；卸载后不再认领", async () => {
		const kernel = new LiteKernel();
		await kernel.load({
			name: "test/first",
			apply(context) {
				context.floorRenderer({
					id: "first",
					name: "先注册",
					patterns: [/雨/],
					render: () => ({ html: "first" }),
				});
			},
		});
		await kernel.load({
			name: "test/second",
			apply(context) {
				context.floorRenderer({
					id: "second",
					name: "后注册",
					patterns: [/雨/],
					render: () => ({ html: "second" }),
				});
			},
		});
		expect(
			(await kernel.renderFloor({ nodeId: "n", raw: "雨" })).floor?.html,
		).toBe("first");

		await kernel.unload("test/first");
		expect(kernel.floorRenderers().map((entry) => entry.definition.id)).toEqual(
			["second"],
		);
		expect(
			(await kernel.renderFloor({ nodeId: "n", raw: "雨" })).floor?.html,
		).toBe("second");
		await kernel.dispose();
	});

	it("渲染器抛错或超时被跳过，后面的渲染器与原生正文仍可用", async () => {
		const kernel = new LiteKernel();
		await kernel.load({
			name: "test/broken",
			apply(context) {
				context.floorRenderer({
					id: "broken",
					name: "会抛错",
					patterns: [/雨/],
					render: () => {
						throw new Error("渲染失败");
					},
				});
				context.floorRenderer({
					id: "slow",
					name: "会超时",
					patterns: [/雨/],
					render: () => new Promise(() => {}),
				});
				context.floorRenderer({
					id: "works",
					name: "正常",
					patterns: [/雨/],
					render: () => ({ html: "兜底后的渲染" }),
				});
			},
		});
		const outcome = await kernel.renderFloor({ nodeId: "n", raw: "雨" }, 20);
		expect(outcome.floor?.renderer).toBe("works");
		expect(outcome.failures.map((failure) => failure.renderer)).toEqual([
			"broken",
			"slow",
		]);
		expect(outcome.failures[0]?.error).toContain("渲染失败");
		expect(outcome.failures[1]?.error).toContain("时间预算");

		await kernel.unload("test/broken");
		const native = await kernel.renderFloor(
			{ nodeId: "n", raw: "没有块，也没有雨字" },
			20,
		);
		expect(native.floor).toBeNull();
		await kernel.dispose();
	});

	it("重复的渲染器 id 让装载失败且不留下半成品", async () => {
		const kernel = new LiteKernel();
		const definition: FloorRendererDefinition = {
			id: "same",
			name: "同名",
			patterns: [/./],
			render: () => ({ html: "x" }),
		};
		await kernel.load({
			name: "test/same-1",
			apply(context) {
				context.floorRenderer(definition);
			},
		});
		const status = await kernel.load({
			name: "test/same-2",
			apply(context) {
				context.floorRenderer({ ...definition, name: "另一个同名" });
			},
		});
		expect(status.state).toBe("failed");
		expect(status.reason).toContain("楼层渲染器重复注册：same");
		expect(kernel.floorRenderers()).toHaveLength(1);
		await kernel.dispose();
	});
});

describe("声明式楼层渲染器", () => {
	it("模板里的占位符换成转义后的原文，权限按白名单校验", () => {
		const plugin = parseRenderer({
			patterns: ["状态栏|气力"],
			script: "fetch('https://example.com/lib.js')",
		});
		const definition = createDeclarativeFloorRenderer(plugin);
		expect(definition.permissions).toEqual(["sendMessage"]);
		const rendered = definition.render({
			nodeId: "n",
			raw: "<状态栏>气力：3</状态栏>",
			blocks: [],
			state: undefined,
		});
		expect(rendered?.html).toBe(
			'<div class="status">&lt;状态栏&gt;气力：3&lt;/状态栏&gt;</div>',
		);
	});

	it("至少要有一种认领条件，权限限定在白名单里", () => {
		expect(() => parseRenderer({ blockTypes: [] })).toThrow(
			"至少要声明 blockTypes 或 patterns",
		);
		expect(() => parseRenderer({ permissions: ["evalHost"] })).toThrow(
			"permissions[0] 只能是",
		);
		expect(() =>
			parseRenderer({ permissions: ["sendMessage", "sendMessage"] }),
		).toThrow("重复声明了 sendMessage");
		expect(() => parseRenderer({ patterns: ["["] })).toThrow();
	});

	it("声明式插件装载进内核后可以渲染楼层", async () => {
		const plugin = parseRenderer();
		const kernel = new LiteKernel();
		const status = await kernel.load(
			createDeclarativeFloorRendererPlugin(plugin),
		);
		expect(status.state).toBe("active");
		const outcome = await kernel.renderFloor({
			nodeId: "n",
			raw: "<状态栏>气力：3</状态栏>",
		});
		expect(outcome.floor?.renderer).toBe("test-status");
		expect(outcome.floor?.permissions).toEqual(["sendMessage"]);
		await kernel.dispose();
	});
});

describe("沙箱联网允许名单", () => {
	it("只从 http 与 https 地址里取主机名", () => {
		expect(
			scanSandboxDomains(
				"fetch('https://example.com/lib.js'); <img src=\"http://example.org/a.png\">",
			),
		).toEqual(["example.com", "example.org"]);
		expect(scanSandboxDomains("https://localhost/x")).toEqual([]);
		expect(scanSandboxDomains("没有地址")).toEqual([]);
	});

	it("默认不联网；允许的域名进入脚本、样式、图片与请求来源", () => {
		expect(buildSandboxContentSecurityPolicy([])).toBe(
			"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; media-src data: blob:; connect-src 'none'",
		);
		const csp = buildSandboxContentSecurityPolicy(["example.com"]);
		expect(csp).toContain("script-src 'unsafe-inline' http://example.com");
		expect(csp).toContain("connect-src");
		expect(csp).toContain("wss://example.com");
		expect(() => buildSandboxContentSecurityPolicy(["a;b"])).toThrow();
	});

	it("允许名单与检测结果存在故事上，重开数据库仍在", () => {
		const { store, path, close } = openStore();
		store.createStory({ id: "s1", title: "沙箱" });
		expect(readStorySandboxDomains(store, "s1")).toEqual({
			allowed: [],
			detected: [],
		});
		allowStorySandboxDomain(store, "s1", "Example.com", true);
		expect(readStorySandboxDomains(store, "s1").allowed).toEqual([
			"example.com",
		]);
		recordStorySandboxDetectedDomains(store, "s1", ["example.org"]);
		setStorySandboxAllowedDomains(store, "s1", ["example.com"]);
		close();

		const reopened = StoryStore.open(path);
		try {
			expect(readStorySandboxDomains(reopened, "s1")).toEqual({
				allowed: ["example.com"],
				detected: ["example.org"],
			});
		} finally {
			reopened.close();
		}
	});

	it("随卡渲染器安装到故事上，脚本里的域名进入检测结果", () => {
		const { store } = openStore();
		store.createStory({ id: "s1", title: "沙箱" });
		const plugin = parseRenderer({
			script: "fetch('https://example.com/lib.js')",
		});
		installStoryFloorRenderer(store, "s1", plugin, "card");
		const stored = readStoryFloorRenderers(store, "s1");
		expect(stored.map((entry) => entry.id)).toEqual(["test-status"]);
		expect(stored[0]?.name).toBe("测试状态栏");
		expect(readStorySandboxDomains(store, "s1").detected).toEqual([
			"example.com",
		]);
	});
});

describe("沙箱拒绝记录", () => {
	it("按故事追加并按最近在前读取", () => {
		const { store } = openStore();
		store.createStory({ id: "s1", title: "沙箱" });
		const first = recordSandboxRejection(store, {
			storyId: "s1",
			nodeId: null,
			renderer: "test-status",
			kind: "bridge",
			target: "writeState",
			reason: "没有声明 writeState",
		});
		recordSandboxRejection(store, {
			storyId: "s1",
			nodeId: null,
			renderer: "test-status",
			kind: "network",
			target: "https://example.com/lib.js",
			reason: "沙箱默认禁止联网",
		});
		const rows = listSandboxRejections(store, "s1");
		expect(rows).toHaveLength(2);
		expect(rows[0]?.kind).toBe("network");
		expect(rows[1]?.id).toBe(first.id);
		expect(() =>
			store.recordSandboxRejection({
				storyId: "s1",
				nodeId: null,
				renderer: "x",
				kind: "eval" as never,
				target: "x",
				reason: "x",
			}),
		).toThrow("沙箱拒绝类型不合法");
	});
});

function openStore(): {
	store: StoryStore;
	path: string;
	close: () => void;
} {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-sandbox-"));
	const path = join(dir, "story.db");
	const store = StoryStore.open(path);
	let open = true;
	const close = () => {
		if (!open) return;
		store.close();
		open = false;
	};
	onTestFinished(() => {
		close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return { store, path, close };
}

import { describe, expect, it } from "vitest";
import {
	BACKGROUND_JOB_PLUGINS,
	DEEP_ONLY_READ_TOOLS,
	DEEP_TURN_TOOLS,
	DEFAULT_TOOL_KERNEL,
	FAST_TURN_TOOLS,
	MERGED_INTO_SITUATION,
	READ_TOOLS,
	TOOL_PLUGINS,
	type ToolPlugin,
	backgroundJobPlugin,
	createBackgroundJobPlugins,
	createBackgroundJobRegistryFromPlugins,
	createDefaultBackgroundJobRegistry,
	createPluginKernel,
	createStaticKernel,
	createToolRegistryFromPlugins,
	emptyImagesConfig,
	resolveStoryBackgroundKinds,
} from "../src/index.js";

const FAST_TOOL_NAMES = [
	"memory_search",
	"lore_lookup",
	"state_get",
	"ledger_read",
	"rule_check",
];

const DEEP_TOOL_NAMES = [
	"memory_search",
	"lore_lookup",
	"state_get",
	"ledger_read",
	"history_read",
	"note_read",
	"ledger_write",
	"note_write",
	"file_read",
	"file_search",
	"file_write",
	"file_patch",
	"draft_write",
	"commit_draft",
	"rule_check",
];

describe("内置工具插件", () => {
	it("每个工具都有注册表条目且顺序与开放阶段不变", () => {
		expect(DEFAULT_TOOL_KERNEL.snapshot().tools).toEqual(DEEP_TOOL_NAMES);
		expect(DEFAULT_TOOL_KERNEL.snapshot().plugins).toEqual(
			TOOL_PLUGINS.map((plugin) => ({
				name: plugin.name,
				state: "active",
				reason: null,
				missing: [],
			})),
		);
		expect(TOOL_PLUGINS.map((plugin) => plugin.definition.name)).toEqual(
			DEEP_TOOL_NAMES,
		);
		expect(
			TOOL_PLUGINS.filter((plugin) => plugin.phases.includes("fast")).map(
				(plugin) => plugin.definition.name,
			),
		).toEqual(FAST_TOOL_NAMES);
	});

	it("快回合与深回合的工具名单、权限与定义与注册表一致", () => {
		expect(FAST_TURN_TOOLS.tools.map((tool) => tool.name)).toEqual(
			FAST_TOOL_NAMES,
		);
		expect(DEEP_TURN_TOOLS.tools.map((tool) => tool.name)).toEqual(
			DEEP_TOOL_NAMES,
		);
		const originals = [...READ_TOOLS, ...DEEP_ONLY_READ_TOOLS];
		for (const plugin of TOOL_PLUGINS) {
			const expected = [...originals, ...DEEP_TURN_TOOLS.tools].find(
				(tool) => tool.name === plugin.definition.name,
			);
			expect(plugin.definition).toEqual(expected);
		}
	});

	it("重复注册工具失败并回滚同一插件已经注册的条目", async () => {
		const owner = TOOL_PLUGINS[0];
		const duplicate: ToolPlugin = {
			name: "tool.duplicate-owner",
			definition: { ...owner.definition },
			phases: ["deep"],
			apply(context) {
				context.tool({ ...owner.definition, name: "test/extra" }, ["deep"]);
				context.tool(owner.definition, ["deep"]);
			},
		};
		const kernel = await createPluginKernel({
			plugins: [owner, duplicate],
		});
		expect(kernel.status("tool.duplicate-owner").state).toBe("failed");
		expect(kernel.tool("test/extra")).toBeNull();
		expect(kernel.tool(owner.definition.name)).toBe(owner.definition);
		await kernel.dispose();
	});

	it("卸载工具插件后该工具不再注册", async () => {
		const plugin = TOOL_PLUGINS[0];
		const kernel = await createPluginKernel({ plugins: [plugin] });
		expect(kernel.tool(plugin.definition.name)).not.toBeNull();
		await kernel.unload(plugin.name);
		expect(kernel.tool(plugin.definition.name)).toBeNull();
		await kernel.dispose();
	});

	it("工具插件没有激活时建立注册表直接抛错", () => {
		const plugin = TOOL_PLUGINS[0];
		const broken: ToolPlugin = {
			name: "tool.broken",
			definition: plugin.definition,
			phases: [],
			apply(context) {
				context.tool(plugin.definition, []);
			},
		};
		expect(() => createToolRegistryFromPlugins([broken], "fast")).toThrow(
			/工具插件 tool\.broken 没有激活/,
		);
	});
});

describe("内置后台任务插件", () => {
	it("每个任务类型都有注册表条目且入队条件与档位不变", () => {
		const registry = createDefaultBackgroundJobRegistry();
		expect([...registry.keys()]).toEqual([
			"events",
			"summary",
			"compression",
			"npc_agenda",
			"lore_prefilter",
			"import_kind",
			"settle",
			"scene",
			"user_will",
			"memory_revision",
			"gap_pass",
			"scene_log",
			"scene_archive",
			"opening",
			"opening_candidates",
			"visual_profile",
			"director_plan",
			"plan_prepare",
			"plan_review",
			"chapter_plan",
			"blueprint_suggestion",
			"candidate_actions",
		]);
		const expected = [
			["events", "confirmed", "deferred"],
			["summary", "confirmed", "deferred"],
			["compression", "confirmed", "deferred"],
			["npc_agenda", "confirmed", "deferred"],
			["lore_prefilter", "settled", "gap"],
			["import_kind", "story", "gap"],
			["settle", "settled", "gap"],
			["scene", "settled", "gap"],
			["user_will", "settled", "gap"],
			["memory_revision", "settled", "gap"],
			["gap_pass", "settled", "gap"],
			["scene_log", "settled", "gap"],
			["scene_archive", "story", "gap"],
			["opening", "story", "gap"],
			["opening_candidates", "story", "gap"],
			["visual_profile", "story", "gap"],
			["director_plan", "story", "deferred"],
			["plan_prepare", "story", "gap"],
			["plan_review", "story", "gap"],
			["chapter_plan", "story", "deferred"],
			["blueprint_suggestion", "story", "gap"],
			["candidate_actions", "settled", "gap"],
		];
		// 小品引擎已删除，判断小品条件的任务不再注册（ADR-0166）。
		expect(registry.has("director_bits")).toBe(false);
		for (const [kind, enqueue, tier] of expected) {
			expect(registry.get(kind)).toMatchObject({ enqueue, tier });
		}
		expect(registry.get("opening")?.needsRun).toBeTypeOf("function");
		expect(registry.get("import_kind")?.needsRun).toBeTypeOf("function");
		expect(registry.get("scene_archive")?.needsRun).toBeTypeOf("function");
		expect(registry.get("chapter_plan")?.needsRun).toBeTypeOf("function");
		expect(registry.get("blueprint_suggestion")?.needsRun).toBeTypeOf(
			"function",
		);
		expect(registry.get("settle")?.needsRun).toBeUndefined();
	});

	it("场记与合并调用按故事开关过滤，其余类型不受影响", () => {
		const registry = createDefaultBackgroundJobRegistry();
		const off = resolveStoryBackgroundKinds(registry, {
			sceneLogEnabled: false,
			gapPassEnabled: false,
		});
		expect(off).not.toContain("scene_log");
		expect(off).not.toContain("scene_archive");
		expect(off).not.toContain("gap_pass");
		expect(off).toContain("settle");
		const on = resolveStoryBackgroundKinds(registry, {
			sceneLogEnabled: true,
			gapPassEnabled: true,
		});
		expect(on).toContain("scene_log");
		expect(on).toContain("scene_archive");
		expect(on).toContain("gap_pass");
		// 场记打开时它是每楼唯一的局面更新，分散的每楼调用不再建任务。
		expect(on).toHaveLength(registry.size - MERGED_INTO_SITUATION.length);
		for (const kind of MERGED_INTO_SITUATION) expect(on).not.toContain(kind);
	});

	it("静态任务插件的注册表条目与插件清单一致", () => {
		const kernel = createStaticKernel(BACKGROUND_JOB_PLUGINS);
		expect(kernel.snapshot().backgroundJobs).toEqual(
			BACKGROUND_JOB_PLUGINS.map((plugin) => plugin.kind),
		);
		expect(kernel.snapshot().plugins.map((plugin) => plugin.state)).toEqual(
			BACKGROUND_JOB_PLUGINS.map(() => "active"),
		);
	});

	it("运行时依赖按选项补齐任务类型", () => {
		const embedder = {
			embed: async () => [],
		};
		const registry = createDefaultBackgroundJobRegistry({
			embedder,
		});
		expect(registry.has("embeddings")).toBe(true);
		expect(registry.get("embeddings")).toMatchObject({
			enqueue: "confirmed",
			tier: "gap",
		});
		expect(registry.has("illustrate")).toBe(false);
		const plugins = createBackgroundJobPlugins({ embedder });
		expect(plugins.at(-1)?.kind).toBe("embeddings");

		const withImages = createDefaultBackgroundJobRegistry({
			illustrate: { config: emptyImagesConfig(), mediaDir: "images" },
		});
		expect(withImages.get("illustrate")).toMatchObject({
			enqueue: "story",
			tier: "gap",
		});
		expect(withImages.get("illustrate")?.needsRun).toBeTypeOf("function");
		expect(withImages.has("embeddings")).toBe(false);
	});

	it("任务插件没有激活时建立注册表直接抛错", () => {
		const broken = backgroundJobPlugin("background.broken", "broken", {
			handler: () => {},
			enqueue: "story",
		});
		expect(() => createBackgroundJobRegistryFromPlugins([broken])).toThrow(
			/后台任务插件 background\.broken 没有激活/,
		);
	});

	it("卸载任务插件后该类型不再注册", async () => {
		const plugin = backgroundJobPlugin("background.test", "test/job", {
			handler: () => {},
		});
		const kernel = await createPluginKernel({ plugins: [plugin] });
		expect(kernel.backgroundJob("test/job")).not.toBeNull();
		await kernel.unload(plugin.name);
		expect(kernel.backgroundJob("test/job")).toBeNull();
		await kernel.dispose();
	});
});

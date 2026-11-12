import { afterEach, describe, expect, it, vi } from "vitest";
import { type PluginDefinition, createPluginKernel } from "../src/index.js";
import {
	createBlockPlugin,
	createDirectorPlugin,
	createScenePlugin,
	weatherServicePlugin,
} from "./plugin-fixtures.js";

const slotRequest = {
	slot: "scene",
	storyId: "story-1",
	nodeId: null,
	switches: {},
	state: null,
} as const;

afterEach(() => {
	vi.useRealTimers();
});

describe("createPluginKernel", () => {
	it("按数组顺序装载插件并按插件名传入配置", async () => {
		const kernel = await createPluginKernel({
			plugins: [
				createScenePlugin(),
				weatherServicePlugin,
				createDirectorPlugin(),
				createBlockPlugin(),
			],
			configs: { "test/weather-service": { unit: "f" } },
		});

		const snapshot = kernel.snapshot();
		expect(snapshot.plugins.map((plugin) => plugin.state)).toEqual([
			"active",
			"active",
			"active",
			"active",
		]);
		expect(snapshot.missingServices).toEqual([]);
		expect(snapshot.slots.scene).toEqual(["test/scene-weather"]);
		expect(snapshot.mechanisms).toEqual(["test/weather"]);
		expect(snapshot.blockTypes).toEqual(["weather"]);
		expect(snapshot.services).toEqual(["weather"]);

		const runs = await kernel.runSlot(slotRequest);
		expect(runs[0]?.content?.messages[0]?.content).toContain("灯塔 64 °F");

		await kernel.dispose();
	});

	it("依赖缺失的插件不装载，快照记录缺失服务与原因", async () => {
		const kernel = await createPluginKernel({
			plugins: [createScenePlugin()],
		});

		const status = kernel.status("test/scene-weather");
		expect(status.state).toBe("blocked");
		expect(status.missing).toEqual(["weather"]);
		expect(status.reason).toBe("缺少服务：weather");
		const snapshot = kernel.snapshot();
		expect(snapshot.missingServices).toEqual(["weather"]);
		expect(snapshot.slots).toEqual({});

		await kernel.dispose();
	});

	it("同名服务冲突使启动失败并回收已经装载的插件", async () => {
		let disposed = false;
		const provider: PluginDefinition = {
			name: "test/provider",
			provide: ["weather"],
			apply(ctx) {
				ctx.provide("weather", { forecast: () => "晴" });
				ctx.onDispose(() => {
					disposed = true;
				});
			},
		};
		const copy: PluginDefinition = {
			name: "test/provider-copy",
			provide: ["weather"],
			apply(ctx) {
				ctx.provide("weather", { forecast: () => "阴" });
			},
		};

		await expect(
			createPluginKernel({ plugins: [provider, copy] }),
		).rejects.toThrow("服务重复：weather（已经由 test/provider 提供）");
		expect(disposed).toBe(true);
	});
});

describe("插件生命周期回收", () => {
	it("卸载与热重载清除插件注册的定时器", async () => {
		vi.useFakeTimers();
		const ticks: string[] = [];
		const timed = (label: string): PluginDefinition => ({
			name: "test/timers",
			apply(ctx) {
				ctx.interval(() => ticks.push(label), 10);
				ctx.timeout(() => ticks.push(`${label}:once`), 15);
			},
		});

		const kernel = await createPluginKernel({ plugins: [timed("first")] });
		vi.advanceTimersByTime(20);
		expect(ticks).toEqual(["first", "first:once", "first"]);

		await kernel.reload(timed("second"));
		vi.advanceTimersByTime(20);
		expect(ticks).toEqual([
			"first",
			"first:once",
			"first",
			"second",
			"second:once",
			"second",
		]);

		await kernel.unload("test/timers");
		vi.advanceTimersByTime(100);
		expect(ticks).toHaveLength(6);

		await kernel.dispose();
	});

	it("装载失败时清除已经注册的定时器", async () => {
		vi.useFakeTimers();
		const ticks: string[] = [];
		const broken: PluginDefinition = {
			name: "test/broken-timers",
			apply(ctx) {
				ctx.interval(() => ticks.push("tick"), 5);
				ctx.timeout(() => ticks.push("once"), 5);
				throw new Error("初始化失败");
			},
		};

		const kernel = await createPluginKernel({ plugins: [broken] });
		expect(kernel.status("test/broken-timers").state).toBe("failed");
		vi.advanceTimersByTime(50);
		expect(ticks).toEqual([]);

		await kernel.dispose();
	});

	it("卸载回收后台任务类型，重复注册只让后来的插件失败", async () => {
		const jobPlugin = (name: string): PluginDefinition => ({
			name,
			apply(ctx) {
				ctx.backgroundJob("test/job", { handler: () => {}, tier: "deferred" });
			},
		});

		const kernel = await createPluginKernel({
			plugins: [jobPlugin("test/job-owner")],
		});
		expect(kernel.snapshot().backgroundJobs).toEqual(["test/job"]);
		expect(kernel.backgroundJobs()[0]?.plugin).toBe("test/job-owner");
		const registered = kernel.backgroundJob("test/job");
		expect(registered?.enqueue).toBe("confirmed");
		expect(registered?.tier).toBe("deferred");

		const duplicate = await kernel.load(jobPlugin("test/job-copy"));
		expect(duplicate.state).toBe("failed");
		expect(duplicate.reason).toBe("后台任务类型重复注册：test/job");
		expect(kernel.snapshot().backgroundJobs).toEqual(["test/job"]);

		await kernel.unload("test/job-owner");
		expect(kernel.snapshot().backgroundJobs).toEqual([]);
		expect(kernel.backgroundJob("test/job")).toBeNull();

		await kernel.dispose();
	});
});

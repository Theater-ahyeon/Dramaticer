import { describe, expect, it } from "vitest";
import type {
	ContextSlotRequest,
	PluginDefinition,
	PluginKernel,
} from "../src/index.js";
import {
	createBlockPlugin,
	createCyclePlugins,
	createListenerPlugin,
	createScenePlugin,
	weatherServicePlugin,
} from "./plugin-fixtures.js";

const slotRequest: ContextSlotRequest = {
	slot: "scene",
	storyId: "story-1",
	nodeId: null,
	switches: {},
	state: null,
};

async function loadWeatherStack(kernel: PluginKernel): Promise<void> {
	await kernel.load(weatherServicePlugin);
	await kernel.load(createScenePlugin());
	await kernel.load(createBlockPlugin());
}

export function describeKernel(
	label: string,
	createKernel: () => PluginKernel,
): void {
	describe(label, () => {
		it("装载两个扩展点后可以从注册表取到实现", async () => {
			const kernel = createKernel();
			await loadWeatherStack(kernel);

			const snapshot = kernel.snapshot();
			expect(snapshot.slots.scene).toEqual(["test/scene-weather"]);
			expect(snapshot.blockTypes).toEqual(["weather"]);
			expect(snapshot.services).toEqual(["weather"]);
			expect(snapshot.plugins.map((plugin) => plugin.state)).toEqual([
				"active",
				"active",
				"active",
			]);

			const slotRuns = await kernel.runSlot(slotRequest);
			expect(slotRuns).toHaveLength(1);
			expect(slotRuns[0]?.plugin).toBe("test/scene-weather");
			expect(slotRuns[0]?.content?.messages[0]?.content).toContain(
				"灯塔 18 °C",
			);

			expect(kernel.blockType("weather")?.context).toEqual({ kind: "drop" });

			await kernel.dispose();
		});

		it("依赖缺失时阻塞并记录原因，提供者出现后自动激活", async () => {
			const kernel = createKernel();
			const blocked = await kernel.load(createScenePlugin());
			expect(blocked.state).toBe("blocked");
			expect(blocked.missing).toEqual(["weather"]);
			expect(blocked.reason).toBe("缺少服务：weather");

			await kernel.load(weatherServicePlugin);
			expect(kernel.status("test/scene-weather").state).toBe("active");
			const runs = await kernel.runSlot(slotRequest);
			expect(runs[0]?.content?.messages[0]?.content).toContain("灯塔 18 °C");

			await kernel.dispose();
		});

		it("互相依赖的插件被识别为循环依赖", async () => {
			const kernel = createKernel();
			const [a, b] = createCyclePlugins();
			await kernel.load(a);
			await kernel.load(b);

			const statusA = kernel.status(a.name);
			const statusB = kernel.status(b.name);
			expect(statusA.state).toBe("blocked");
			expect(statusB.state).toBe("blocked");
			expect(statusA.reason).toBe(
				"循环依赖：test/cycle-a → test/cycle-b → test/cycle-a",
			);
			expect(statusB.reason).toContain("循环依赖");

			await kernel.dispose();
		});

		it("同名服务被第二个插件声明时拒绝装载", async () => {
			const kernel = createKernel();
			await kernel.load(weatherServicePlugin);
			const copy: PluginDefinition = {
				name: "test/weather-copy",
				provide: ["weather"],
				apply(ctx) {
					ctx.provide("weather", { forecast: () => "副本" });
				},
			};
			await expect(kernel.load(copy)).rejects.toThrow(
				"服务重复：weather（已经由 test/weather-service 提供）",
			);
			expect(kernel.snapshot().services).toEqual(["weather"]);

			await kernel.dispose();
		});

		it("同名块类型重复注册失败且不留下半成品", async () => {
			const kernel = createKernel();
			await kernel.load(weatherServicePlugin);
			await kernel.load(createBlockPlugin());
			const duplicateBlock: PluginDefinition = {
				name: "test/block-copy",
				apply(ctx) {
					ctx.blockType({
						name: "weather",
						display: { kind: "hidden" },
						context: { kind: "drop" },
						semantics: { kind: "none" },
					});
				},
			};
			const failedBlock = await kernel.load(duplicateBlock);
			expect(failedBlock.state).toBe("failed");
			expect(failedBlock.reason).toContain("块类型重复注册：weather");
			expect(kernel.snapshot().blockTypes).toEqual(["weather"]);

			await kernel.dispose();
		});

		it("插件抛错时回滚已经注册的扩展点", async () => {
			const kernel = createKernel();
			const broken: PluginDefinition = {
				name: "test/broken",
				apply(ctx) {
					ctx.slot("scene", {
						provide: () => null,
					});
					throw new Error("初始化失败");
				},
			};
			const status = await kernel.load(broken);
			expect(status.state).toBe("failed");
			expect(status.reason).toBe("初始化失败");
			expect(kernel.snapshot().slots).toEqual({});

			await kernel.dispose();
		});

		it("卸载回收槽位、块类型与服务", async () => {
			const kernel = createKernel();
			await loadWeatherStack(kernel);
			await kernel.load(
				createListenerPlugin("test/listener", "test/event", () => "hit"),
			);
			expect(await kernel.serial("test/event")).toEqual(["hit"]);

			await kernel.unload("test/scene-weather");
			await kernel.unload("test/block-weather");
			await kernel.unload("test/listener");
			const snapshot = kernel.snapshot();
			expect(snapshot.slots).toEqual({});
			expect(snapshot.blockTypes).toEqual([]);
			expect(await kernel.serial("test/event")).toEqual([]);

			await kernel.unload("test/weather-service");
			expect(kernel.snapshot().services).toEqual([]);
			expect(kernel.service("weather")).toBeUndefined();

			await kernel.dispose();
		});

		it("热重载替换实现且不残留旧注册", async () => {
			const kernel = createKernel();
			await kernel.load(weatherServicePlugin);
			await kernel.load(createScenePlugin("第一版"));
			const before = await kernel.runSlot(slotRequest);
			expect(before[0]?.content?.messages[0]?.content).toContain("第一版");

			await kernel.reload(createScenePlugin("第二版"));
			const after = await kernel.runSlot(slotRequest);
			expect(after).toHaveLength(1);
			expect(after[0]?.content?.messages[0]?.content).toContain("第二版");
			expect(kernel.snapshot().slots.scene).toEqual(["test/scene-weather"]);

			await kernel.dispose();
		});

		it("提供者卸载后依赖它的插件回到阻塞状态", async () => {
			const kernel = createKernel();
			await kernel.load(weatherServicePlugin);
			await kernel.load(createScenePlugin());
			expect(kernel.status("test/scene-weather").state).toBe("active");

			await kernel.unload("test/weather-service");
			expect(kernel.status("test/scene-weather").state).toBe("blocked");
			expect(kernel.snapshot().slots).toEqual({});

			await kernel.dispose();
		});

		it("五种分发模式按注册顺序收集结果", async () => {
			const kernel = createKernel();
			const emitted: number[] = [];
			await kernel.load(
				createListenerPlugin("test/emit-1", "test/emit", (value) => {
					emitted.push(value as number);
				}),
			);
			await kernel.load(
				createListenerPlugin("test/emit-2", "test/emit", (value) => {
					emitted.push((value as number) * 10);
				}),
			);
			kernel.emit("test/emit", 2);
			expect(emitted).toEqual([2, 20]);

			for (const value of [1, 2, 3]) {
				await kernel.load(
					createListenerPlugin(
						`test/parallel-${value}`,
						"test/parallel",
						async () => {
							await Promise.resolve();
							return value;
						},
					),
				);
				await kernel.load(
					createListenerPlugin(
						`test/serial-${value}`,
						"test/serial",
						() => value,
					),
				);
			}
			expect(await kernel.parallel("test/parallel")).toEqual([1, 2, 3]);
			expect(await kernel.serial("test/serial")).toEqual([1, 2, 3]);

			await kernel.load(
				createListenerPlugin("test/bail-1", "test/bail", () => undefined),
			);
			await kernel.load(
				createListenerPlugin("test/bail-2", "test/bail", () => false),
			);
			await kernel.load(
				createListenerPlugin("test/bail-3", "test/bail", () => "first"),
			);
			await kernel.load(
				createListenerPlugin("test/bail-4", "test/bail", () => "second"),
			);
			expect(kernel.bail("test/bail")).toBe("first");

			await kernel.load(
				createListenerPlugin(
					"test/waterfall-1",
					"test/waterfall",
					(value) => (value as number) + 1,
				),
			);
			await kernel.load(
				createListenerPlugin(
					"test/waterfall-2",
					"test/waterfall",
					(value) => (value as number) * 2,
				),
			);
			expect(kernel.waterfall("test/waterfall", 2)).toBe(6);

			await kernel.dispose();
		});

		it("配置校验失败时不装载插件", async () => {
			const kernel = createKernel();
			const status = await kernel.load(weatherServicePlugin, {
				unit: "kelvin",
			});
			expect(status.state).toBe("failed");
			expect(status.reason).toContain("unit 必须是 c 或 f");
			expect(kernel.snapshot().services).toEqual([]);
			expect(kernel.service("weather")).toBeUndefined();

			await kernel.dispose();
		});
	});
}

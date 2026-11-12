import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
	ContextSlotContent,
	DirectorMechanism,
	PluginDefinition,
} from "./contracts.js";

export interface WeatherService {
	forecast(city: string): string;
}

export interface WeatherConfig {
	readonly unit: "c" | "f";
}

export const weatherConfigSchema: StandardSchemaV1<unknown, WeatherConfig> = {
	"~standard": {
		version: 1,
		vendor: "dramaticer-plugin-spike",
		validate(value) {
			if (value === undefined) return { value: { unit: "c" } };
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				return { issues: [{ message: "配置必须是对象" }] };
			}
			const unit = "unit" in value ? value.unit : undefined;
			if (unit !== "c" && unit !== "f") {
				return { issues: [{ message: "unit 必须是 c 或 f", path: ["unit"] }] };
			}
			return { value: { unit } };
		},
	},
};

/** 提供 weather 服务的插件，用来验证注入与配置校验。 */
export const weatherServicePlugin: PluginDefinition = {
	name: "spike/weather-service",
	provide: ["weather"],
	Config: weatherConfigSchema,
	apply(ctx, config) {
		// Cordis 已经用 weatherConfigSchema 校验过配置，这里只是恢复它的类型。
		const settings = config as WeatherConfig;
		const { unit } = settings;
		ctx.provide<WeatherService>("weather", {
			forecast: (city) => `${city} ${unit === "c" ? "18 °C" : "64 °F"}`,
		});
	},
};

/** 上下文槽位提供者：注入 weather 服务，向 scene 槽位写一条消息。 */
export function createScenePlugin(intro = "海雾正在升起"): PluginDefinition {
	return {
		name: "spike/scene-weather",
		inject: ["weather"],
		apply(ctx) {
			ctx.slot("scene", {
				packKey: "spike/weather",
				provide: (request): ContextSlotContent => {
					const weather = ctx.service<WeatherService>("weather");
					return {
						source: `spike/weather:${request.storyId}`,
						messages: [
							{
								role: "system",
								content: `${intro}：${weather?.forecast("灯塔") ?? "天气未知"}`,
							},
						],
					};
				},
			});
		},
	};
}

/** Director 机制：同步纯函数，注入 weather 服务。 */
export function createDirectorPlugin(): PluginDefinition {
	return {
		name: "spike/director-weather",
		inject: ["weather"],
		apply(ctx) {
			const mechanism: DirectorMechanism = {
				name: "spike/weather",
				evaluate: (context) => ({
					triggered: true,
					reason: "天气突变",
					suggestion: {
						mechanism: "spike/weather",
						priority: 30,
						directive: `${ctx.service<WeatherService>("weather")?.forecast("港口") ?? "风浪"}，让角色寻找遮蔽`,
						signals: { nodeId: context.nodeId },
					},
					signals: { nodeId: context.nodeId },
				}),
			};
			ctx.directorMechanism(mechanism);
		},
	};
}

/** 块类型：只影响解析与显示，不写台账。 */
export function createBlockPlugin(): PluginDefinition {
	return {
		name: "spike/block-weather",
		apply(ctx) {
			ctx.blockType({
				name: "weather",
				display: { kind: "hidden" },
				context: { kind: "drop" },
				semantics: { kind: "none" },
			});
		},
	};
}

/** 两个互相依赖的插件，用来观察循环依赖行为。 */
export function createCyclePlugins(): readonly [
	PluginDefinition,
	PluginDefinition,
] {
	return [
		{
			name: "spike/cycle-a",
			inject: ["cycle.b"],
			provide: ["cycle.a"],
			apply(ctx) {
				ctx.provide("cycle.a", "a");
			},
		},
		{
			name: "spike/cycle-b",
			inject: ["cycle.a"],
			provide: ["cycle.b"],
			apply(ctx) {
				ctx.provide("cycle.b", "b");
			},
		},
	];
}

export function createListenerPlugin(
	name: string,
	event: string,
	listener: (...args: unknown[]) => unknown,
): PluginDefinition {
	return {
		name,
		apply(ctx) {
			ctx.on(event, listener);
		},
	};
}

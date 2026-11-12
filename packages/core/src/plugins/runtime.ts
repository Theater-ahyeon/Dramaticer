import { BUILTIN_PLUGINS } from "./builtin.js";
import type { PluginDefinition, PluginKernel } from "./contracts.js";
import { LiteKernel } from "./lite-kernel.js";

export interface PluginKernelOptions {
	/** 装载顺序；缺省使用内置插件清单。 */
	readonly plugins?: readonly PluginDefinition[];
	/** 每个插件的配置，按插件名取用；配置校验失败时该插件标记为 failed。 */
	readonly configs?: Readonly<Record<string, unknown>>;
}

/**
 * 启动插件运行环境：按数组顺序装载插件并解析 `inject`/`provide`。
 * 依赖缺失的插件停在阻塞状态；同名服务冲突让启动失败，已经装载的插件先回收。
 */
export async function createPluginKernel(
	options: PluginKernelOptions = {},
): Promise<PluginKernel> {
	const kernel = new LiteKernel();
	try {
		for (const plugin of options.plugins ?? BUILTIN_PLUGINS) {
			await kernel.load(plugin, options.configs?.[plugin.name]);
		}
	} catch (error) {
		await kernel.dispose();
		throw error;
	}
	return kernel;
}

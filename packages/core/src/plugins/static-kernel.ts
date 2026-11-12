import type { PluginDefinition, PluginKernel } from "./contracts.js";
import { LiteKernel } from "./lite-kernel.js";

/**
 * 同步建立只装载静态插件的内核：内置机制与块类型在模块初始化时注册，
 * 调用方（解析器、导演评估）需要同步取用。
 */
export function createStaticKernel(
	plugins: readonly PluginDefinition[],
): PluginKernel {
	const kernel = new LiteKernel();
	for (const plugin of plugins) kernel.installSync(plugin);
	return kernel;
}

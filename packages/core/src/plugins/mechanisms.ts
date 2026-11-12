import { createBeatMechanism } from "../director/beat.js";
import { createClueTrackingMechanism } from "../director/clue.js";
import { createEventPoolMechanism } from "../director/event-pool.js";
import { createOpeningMechanism } from "../director/opening.js";
import { createPacingMechanism } from "../director/pacing.js";
import { createRepetitionMechanism } from "../director/repetition.js";
import type { DirectorMechanism } from "../director/types.js";
import type { PluginDefinition, PluginKernel } from "./contracts.js";
import { createStaticKernel } from "./static-kernel.js";

/** 内置导演机制插件：每个插件向内核注册一个同步纯函数机制。 */
export interface MechanismPlugin extends PluginDefinition {
	readonly mechanism: DirectorMechanism;
}

function mechanismPlugin(
	plugin: string,
	mechanism: DirectorMechanism,
): MechanismPlugin {
	return {
		name: plugin,
		mechanism,
		apply(context) {
			context.directorMechanism(mechanism);
		},
	};
}

/** 内置导演机制；顺序即评估顺序。 */
export const MECHANISM_PLUGINS: readonly MechanismPlugin[] = [
	mechanismPlugin("mechanism.clue", createClueTrackingMechanism()),
	mechanismPlugin("mechanism.opening", createOpeningMechanism()),
	mechanismPlugin("mechanism.beat", createBeatMechanism()),
	mechanismPlugin("mechanism.repetition", createRepetitionMechanism()),
	mechanismPlugin("mechanism.event-pool", createEventPoolMechanism()),
	mechanismPlugin("mechanism.pacing", createPacingMechanism()),
];

/** 只装载内置导演机制的内核；导演评估的缺省机制从这里取。 */
export const DEFAULT_MECHANISM_KERNEL: PluginKernel =
	createStaticKernel(MECHANISM_PLUGINS);

import type { BackgroundJobType } from "../background/types.js";
import type { BlockTypeDefinition } from "../blocks/types.js";
import type {
	ContextSlotContent,
	ContextSlotProvider,
	ContextSlotRequest,
} from "../context/assembler.js";
import type { ContextSlotName } from "../context/template.js";
import type {
	DirectorMechanism,
	DirectorMechanismContext,
	DirectorMechanismResult,
} from "../director/types.js";
import type { DeepToolDefinition, ToolPhase } from "../tools/registry.js";
import type {
	EventListener,
	RegisteredBackgroundJob,
	SlotRunResult,
} from "./contracts.js";
import { EventBus } from "./events.js";
import { ExtensionRegistry } from "./registry.js";

/** 扩展点取用与事件分发；装载、依赖解析与生命周期回收由内核实现。 */
export abstract class KernelSurface {
	protected readonly registry = new ExtensionRegistry();
	protected readonly bus = new EventBus();

	abstract service<T>(name: string): T | undefined;

	async runSlot(
		request: ContextSlotRequest,
	): Promise<readonly SlotRunResult[]> {
		return Promise.all(
			this.registry.slotProviders(request.slot).map(async (entry) => ({
				plugin: entry.plugin,
				content: (await entry.provider.provide(
					request,
				)) as ContextSlotContent | null,
			})),
		);
	}

	slotProvider(name: ContextSlotName): ContextSlotProvider | null {
		return this.registry.slotProviders(name)[0]?.provider ?? null;
	}

	runMechanisms(context: DirectorMechanismContext): readonly {
		plugin: string;
		name: string;
		result: DirectorMechanismResult;
	}[] {
		return this.registry.mechanisms().map((entry) => ({
			plugin: entry.plugin,
			name: entry.mechanism.name,
			result: entry.mechanism.evaluate(context),
		}));
	}

	/** 已注册的 Director 机制，按注册顺序。 */
	mechanisms(): readonly DirectorMechanism[] {
		return this.registry.mechanisms().map((entry) => entry.mechanism);
	}

	blockType(name: string): BlockTypeDefinition | null {
		return this.registry.blockType(name);
	}

	/** 已注册的块类型名，按注册顺序。 */
	blockTypes(): readonly string[] {
		return this.registry.blockTypes();
	}

	backgroundJob(kind: string): BackgroundJobType | null {
		return this.registry.backgroundJob(kind);
	}

	backgroundJobs(): readonly RegisteredBackgroundJob[] {
		return this.registry.backgroundJobs();
	}

	tool(name: string): DeepToolDefinition | null {
		return this.registry.tool(name);
	}

	tools(phase: ToolPhase): readonly DeepToolDefinition[] {
		return this.registry.tools(phase);
	}

	on(name: string, listener: EventListener): () => void {
		return this.bus.on(name, listener);
	}

	emit(name: string, ...args: unknown[]): void {
		this.bus.emit(name, ...args);
	}

	parallel(name: string, ...args: unknown[]): Promise<readonly unknown[]> {
		return this.bus.parallel(name, ...args);
	}

	serial(name: string, ...args: unknown[]): Promise<readonly unknown[]> {
		return this.bus.serial(name, ...args);
	}

	bail(name: string, ...args: unknown[]): unknown {
		return this.bus.bail(name, ...args);
	}

	waterfall<T>(name: string, value: T): T {
		return this.bus.waterfall(name, value);
	}
}

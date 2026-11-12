import type {
	BlockTypeDefinition,
	ContextSlotContent,
	ContextSlotRequest,
	DirectorMechanismContext,
	DirectorMechanismResult,
	EventListener,
	SlotRunResult,
} from "./contracts.js";
import { EventBus } from "./events.js";
import { ExtensionRegistry } from "./registry.js";

/**
 * 两个内核原型共用的扩展点取用与事件分发表面。
 * 装载、依赖解析与生命周期回收由各内核自己实现。
 */
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

	blockType(name: string): BlockTypeDefinition | null {
		return this.registry.blockType(name);
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

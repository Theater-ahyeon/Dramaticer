import { type Component, Context, type Fiber, FiberState } from "cordis";
import type {
	ContextSlotContent,
	ContextSlotRequest,
	DirectorMechanismContext,
	DirectorMechanismResult,
	EventListener,
	KernelSnapshot,
	PluginContext,
	PluginDefinition,
	PluginStatus,
	SlotRunResult,
} from "./contracts.js";
import { EventBus } from "./events.js";
import { ExtensionRegistry } from "./registry.js";

interface PluginEntry {
	readonly definition: PluginDefinition;
	fiber: Fiber | null;
	failure: string | null;
}

type ScopedCleanup = () => void | Promise<void>;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 用 Cordis 的 Context、依赖注入与生命周期回收装载 Dramaticer 插件。 */
export class CordisKernel {
	private readonly ctx = new Context();
	private readonly registry = new ExtensionRegistry();
	private readonly bus = new EventBus();
	private readonly plugins = new Map<string, PluginEntry>();
	private disposed = false;

	async load(
		definition: PluginDefinition,
		config?: unknown,
	): Promise<PluginStatus> {
		if (this.disposed) throw new Error("插件内核已经关闭");
		if (this.plugins.has(definition.name)) {
			throw new Error(`插件已经加载：${definition.name}`);
		}
		this.assertServicesAvailable(definition);
		const scoped: ScopedCleanup[] = [];
		const provided = new Set<string>();
		const component = this.toComponent(definition, scoped, provided);
		const entry: PluginEntry = { definition, fiber: null, failure: null };
		this.plugins.set(definition.name, entry);
		try {
			const fiber = this.ctx.use(component, config);
			entry.fiber = fiber;
			await fiber.await();
		} catch (error) {
			entry.failure = errorMessage(error);
			await entry.fiber?.dispose();
		}
		await this.settle();
		return this.status(definition.name);
	}

	async unload(name: string): Promise<void> {
		const entry = this.plugins.get(name);
		if (!entry) throw new Error(`插件没有加载：${name}`);
		await entry.fiber?.dispose();
		this.plugins.delete(name);
		await this.settle();
	}

	async reload(
		definition: PluginDefinition,
		config?: unknown,
	): Promise<PluginStatus> {
		if (!this.plugins.has(definition.name)) {
			throw new Error(`插件没有加载：${definition.name}`);
		}
		await this.unload(definition.name);
		return this.load(definition, config);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		for (const entry of this.plugins.values()) {
			await entry.fiber?.dispose();
		}
		this.plugins.clear();
	}

	status(name: string): PluginStatus {
		const entry = this.plugins.get(name);
		if (!entry) throw new Error(`插件没有加载：${name}`);
		if (entry.failure !== null) {
			return { name, state: "failed", reason: entry.failure, missing: [] };
		}
		const fiber = entry.fiber;
		if (!fiber) {
			return { name, state: "disposed", reason: null, missing: [] };
		}
		switch (fiber.state) {
			case FiberState.ACTIVE:
				return { name, state: "active", reason: null, missing: [] };
			case FiberState.FAILED:
				return {
					name,
					state: "failed",
					reason: "插件装载失败",
					missing: [],
				};
			case FiberState.PENDING: {
				const missing = this.missingServices(entry.definition);
				const cycle = this.findCycle(name);
				const reason =
					cycle !== null
						? `循环依赖：${cycle.join(" → ")}`
						: missing.length > 0
							? `缺少服务：${missing.join("、")}`
							: `等待服务：${(entry.definition.inject ?? []).filter((service) => !this.activeServices().has(service)).join("、")}`;
				return { name, state: "blocked", reason, missing };
			}
			default:
				return { name, state: "loading", reason: null, missing: [] };
		}
	}

	snapshot(): KernelSnapshot {
		return {
			plugins: [...this.plugins.keys()].map((name) => this.status(name)),
			slots: this.registry.slots(),
			mechanisms: this.registry
				.mechanisms()
				.map((entry) => entry.mechanism.name),
			blockTypes: this.registry.blockTypes(),
			services: this.activeServiceNames(),
		};
	}

	async runSlot(
		request: ContextSlotRequest,
	): Promise<readonly SlotRunResult[]> {
		const providers = this.registry.slotProviders(request.slot);
		return Promise.all(
			providers.map(async (entry) => ({
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

	blockType(name: string) {
		return this.registry.blockType(name);
	}

	service<T>(name: string): T | undefined {
		return this.ctx.get(name) as T | undefined;
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

	private toComponent(
		definition: PluginDefinition,
		scoped: ScopedCleanup[],
		provided: Set<string>,
	): Component {
		return {
			name: definition.name,
			inject: definition.inject ? [...definition.inject] : undefined,
			provide: definition.provide ? [...definition.provide] : undefined,
			Config: definition.Config as Component.Base["Config"],
			apply: (ctx: Context, config: unknown) => {
				const pluginContext = this.createPluginContext(
					definition,
					ctx,
					scoped,
					provided,
				);
				try {
					definition.apply(pluginContext, config);
					for (const name of definition.provide ?? []) {
						if (!provided.has(name)) {
							throw new Error(
								`插件 ${definition.name} 声明了服务 ${name} 但没有提供`,
							);
						}
					}
				} catch (error) {
					for (const cleanup of scoped.splice(0).reverse()) {
						void cleanup();
					}
					throw error;
				}
			},
		};
	}

	private createPluginContext(
		definition: PluginDefinition,
		ctx: Context,
		scoped: ScopedCleanup[],
		provided: Set<string>,
	): PluginContext {
		return {
			name: definition.name,
			slot: (name, provider) => {
				this.register(ctx, scoped, () =>
					this.registry.addSlot(name, definition.name, provider),
				);
			},
			directorMechanism: (mechanism) => {
				this.register(ctx, scoped, () =>
					this.registry.addMechanism(definition.name, mechanism),
				);
			},
			blockType: (blockDefinition) => {
				this.register(ctx, scoped, () =>
					this.registry.addBlockType(definition.name, blockDefinition),
				);
			},
			provide: <T>(name: string, value: T) => {
				if (!(definition.provide ?? []).includes(name)) {
					throw new Error(`插件 ${definition.name} 没有声明服务 ${name}`);
				}
				const dispose = ctx.provide(name, value);
				scoped.push(() => void dispose());
				provided.add(name);
			},
			service: <T>(name: string) => ctx.get(name) as T | undefined,
			on: (name, listener) => {
				this.register(ctx, scoped, () => this.bus.on(name, listener));
			},
			onDispose: (cleanup) => {
				this.register(ctx, scoped, () => cleanup);
			},
		};
	}

	private register(
		ctx: Context,
		scoped: ScopedCleanup[],
		register: () => () => void | Promise<void>,
	): void {
		let remove: (() => void | Promise<void>) | null = null;
		const wrapper = ctx.effect(() => {
			remove = register();
			return () => {
				const current = remove;
				remove = null;
				return current?.();
			};
		});
		scoped.push(() => wrapper());
	}

	private assertServicesAvailable(definition: PluginDefinition): void {
		for (const service of definition.provide ?? []) {
			const owners = this.serviceOwners(service);
			if (owners.length > 0) {
				throw new Error(
					`服务重复：${service}（已经由 ${owners.join("、")} 提供）`,
				);
			}
			if (this.ctx.get(service) !== undefined) {
				throw new Error(`服务重复：${service}（内核已经提供）`);
			}
		}
	}

	private serviceOwners(service: string): readonly string[] {
		const owners: string[] = [];
		for (const [name, entry] of this.plugins) {
			if (entry.failure !== null) continue;
			if (entry.definition.provide?.includes(service)) owners.push(name);
		}
		return owners;
	}

	private activeServiceNames(): readonly string[] {
		const names: string[] = [];
		for (const entry of this.plugins.values()) {
			if (entry.failure !== null || entry.fiber?.state !== FiberState.ACTIVE) {
				continue;
			}
			for (const name of entry.definition.provide ?? []) names.push(name);
		}
		return names;
	}

	private activeServices(): ReadonlySet<string> {
		return new Set(this.activeServiceNames());
	}

	private serviceProviders(service: string): readonly string[] {
		const providers: string[] = [];
		for (const [name, entry] of this.plugins) {
			if (entry.failure !== null) continue;
			if (entry.definition.provide?.includes(service)) providers.push(name);
		}
		return providers;
	}

	private missingServices(definition: PluginDefinition): readonly string[] {
		const active = this.activeServices();
		return (definition.inject ?? []).filter(
			(service) =>
				!active.has(service) && this.serviceProviders(service).length === 0,
		);
	}

	private findCycle(start: string): readonly string[] | null {
		const active = this.activeServices();
		const visit = (
			current: string,
			path: readonly string[],
		): string[] | null => {
			const entry = this.plugins.get(current);
			if (!entry) return null;
			for (const service of entry.definition.inject ?? []) {
				if (active.has(service)) continue;
				for (const provider of this.serviceProviders(service)) {
					if (path.includes(provider)) {
						return [...path.slice(path.indexOf(provider)), provider];
					}
					const found = visit(provider, [...path, provider]);
					if (found !== null) return found;
				}
			}
			return null;
		};
		return visit(start, [start]);
	}

	private async settle(): Promise<void> {
		await Promise.all(
			[...this.plugins.values()].map(async (entry) => {
				try {
					await entry.fiber?.await();
				} catch (error) {
					entry.failure ??= errorMessage(error);
				}
			}),
		);
	}
}

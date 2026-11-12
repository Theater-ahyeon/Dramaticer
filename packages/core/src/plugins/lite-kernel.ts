import type {
	EventListener,
	KernelSnapshot,
	PluginContext,
	PluginDefinition,
	PluginKernel,
	PluginStatus,
} from "./contracts.js";
import { KernelSurface } from "./kernel-surface.js";

type Cleanup = () => void | Promise<void>;

interface LiteEntry {
	readonly definition: PluginDefinition;
	readonly config: unknown;
	state: "pending" | "active" | "failed";
	failure: string | null;
	cleanups: Cleanup[];
}

async function resolveConfig(
	schema: PluginDefinition["Config"],
	config: unknown,
): Promise<unknown> {
	if (!schema) return config;
	const result = await schema["~standard"].validate(config);
	if (result.issues) {
		throw new Error(
			`配置无效：${result.issues.map((issue) => issue.message).join("；")}`,
		);
	}
	return result.value;
}

/**
 * 精简内核：只有注册表、依赖解析、生命周期回收与事件分发，不依赖任何插件框架。
 * 依赖不满足的插件停在 pending，服务出现后按装载顺序自动激活；服务消失后回到 pending。
 */
export class LiteKernel extends KernelSurface implements PluginKernel {
	private readonly plugins = new Map<string, LiteEntry>();
	private readonly serviceValues = new Map<string, unknown>();
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
		this.plugins.set(definition.name, {
			definition,
			config,
			state: "pending",
			failure: null,
			cleanups: [],
		});
		await this.settle();
		return this.status(definition.name);
	}

	/**
	 * 同步安装没有配置校验的插件；内置机制与块类型在模块初始化时使用。
	 * 依赖服务必须已经就绪，回收函数必须是同步的。
	 */
	installSync(definition: PluginDefinition): PluginStatus {
		if (this.disposed) throw new Error("插件内核已经关闭");
		if (this.plugins.has(definition.name)) {
			throw new Error(`插件已经加载：${definition.name}`);
		}
		if (definition.Config) {
			throw new Error(`插件 ${definition.name} 有配置校验，必须异步装载`);
		}
		this.assertServicesAvailable(definition);
		const entry: LiteEntry = {
			definition,
			config: undefined,
			state: "pending",
			failure: null,
			cleanups: [],
		};
		this.plugins.set(definition.name, entry);
		if (this.dependenciesMet(definition)) {
			const cleanups: Cleanup[] = [];
			entry.cleanups = cleanups;
			const provided = new Set<string>();
			try {
				definition.apply(
					this.createPluginContext(entry, cleanups, provided),
					undefined,
				);
				for (const name of definition.provide ?? []) {
					if (!provided.has(name)) {
						throw new Error(
							`插件 ${definition.name} 声明了服务 ${name} 但没有提供`,
						);
					}
				}
				entry.state = "active";
			} catch (error) {
				for (const cleanup of cleanups.splice(0).reverse()) {
					const result = cleanup();
					if (result instanceof Promise) {
						throw new Error(
							`插件 ${definition.name} 的同步装载使用了异步回收函数`,
						);
					}
				}
				entry.state = "failed";
				entry.failure = error instanceof Error ? error.message : String(error);
			}
		}
		return this.status(definition.name);
	}

	async unload(name: string): Promise<void> {
		const entry = this.plugins.get(name);
		if (!entry) throw new Error(`插件没有加载：${name}`);
		await this.deactivate(entry);
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
		for (const entry of [...this.plugins.values()].reverse()) {
			await this.deactivate(entry);
		}
		this.plugins.clear();
	}

	status(name: string): PluginStatus {
		const entry = this.plugins.get(name);
		if (!entry) throw new Error(`插件没有加载：${name}`);
		if (entry.state === "failed") {
			return {
				name,
				state: "failed",
				reason: entry.failure ?? "插件装载失败",
				missing: [],
			};
		}
		if (entry.state === "active") {
			return { name, state: "active", reason: null, missing: [] };
		}
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

	snapshot(): KernelSnapshot {
		const plugins = [...this.plugins.keys()].map((name) => this.status(name));
		const missingServices: string[] = [];
		for (const plugin of plugins) {
			for (const service of plugin.missing) {
				if (!missingServices.includes(service)) missingServices.push(service);
			}
		}
		return {
			plugins,
			missingServices,
			slots: this.registry.slots(),
			mechanisms: this.registry
				.mechanisms()
				.map((entry) => entry.mechanism.name),
			blockTypes: this.registry.blockTypes(),
			backgroundJobs: this.registry.backgroundJobs().map((entry) => entry.kind),
			tools: this.registry.toolNames(),
			services: this.activeServiceNames(),
		};
	}

	service<T>(name: string): T | undefined {
		return this.serviceValues.get(name) as T | undefined;
	}

	private async settle(): Promise<void> {
		for (;;) {
			let changed = false;
			for (const entry of this.plugins.values()) {
				if (
					entry.state === "active" &&
					!this.dependenciesMet(entry.definition)
				) {
					await this.deactivate(entry);
					changed = true;
				}
			}
			if (!changed) {
				for (const entry of this.plugins.values()) {
					if (entry.state !== "pending") continue;
					if (!this.dependenciesMet(entry.definition)) continue;
					await this.activate(entry);
					changed = true;
					break;
				}
			}
			if (!changed) return;
		}
	}

	private async activate(entry: LiteEntry): Promise<void> {
		const cleanups: Cleanup[] = [];
		entry.cleanups = cleanups;
		const provided = new Set<string>();
		try {
			const config = await resolveConfig(entry.definition.Config, entry.config);
			entry.definition.apply(
				this.createPluginContext(entry, cleanups, provided),
				config,
			);
			for (const name of entry.definition.provide ?? []) {
				if (!provided.has(name)) {
					throw new Error(
						`插件 ${entry.definition.name} 声明了服务 ${name} 但没有提供`,
					);
				}
			}
			entry.state = "active";
		} catch (error) {
			for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
			entry.state = "failed";
			entry.failure = error instanceof Error ? error.message : String(error);
		}
	}

	private async deactivate(entry: LiteEntry): Promise<void> {
		for (const cleanup of entry.cleanups.splice(0).reverse()) await cleanup();
		if (entry.state === "active") entry.state = "pending";
	}

	private createPluginContext(
		entry: LiteEntry,
		cleanups: Cleanup[],
		provided: Set<string>,
	): PluginContext {
		const definition = entry.definition;
		return {
			name: definition.name,
			slot: (name, provider) => {
				cleanups.push(this.registry.addSlot(name, definition.name, provider));
			},
			directorMechanism: (mechanism) => {
				cleanups.push(this.registry.addMechanism(definition.name, mechanism));
			},
			blockType: (blockDefinition) => {
				cleanups.push(
					this.registry.addBlockType(definition.name, blockDefinition),
				);
			},
			provide: <T>(name: string, value: T) => {
				if (!(definition.provide ?? []).includes(name)) {
					throw new Error(`插件 ${definition.name} 没有声明服务 ${name}`);
				}
				this.serviceValues.set(name, value);
				provided.add(name);
				cleanups.push(() => {
					this.serviceValues.delete(name);
				});
			},
			service: <T>(name: string) => this.service<T>(name),
			on: (name, listener) => {
				cleanups.push(this.bus.on(name, listener));
			},
			backgroundJob: (kind, entry) => {
				cleanups.push(
					this.registry.addBackgroundJob(definition.name, kind, entry),
				);
			},
			tool: (toolDefinition, phases) => {
				cleanups.push(
					this.registry.addTool(definition.name, toolDefinition, phases),
				);
			},
			timeout: (callback, delayMs) => {
				const handle = setTimeout(callback, delayMs);
				cleanups.push(() => clearTimeout(handle));
				return () => clearTimeout(handle);
			},
			interval: (callback, delayMs) => {
				const handle = setInterval(callback, delayMs);
				cleanups.push(() => clearInterval(handle));
				return () => clearInterval(handle);
			},
			onDispose: (cleanup) => {
				cleanups.push(cleanup);
			},
		};
	}

	private assertServicesAvailable(definition: PluginDefinition): void {
		for (const service of definition.provide ?? []) {
			const owners = this.serviceProviders(service);
			if (owners.length > 0) {
				throw new Error(
					`服务重复：${service}（已经由 ${owners.join("、")} 提供）`,
				);
			}
			if (this.serviceValues.has(service)) {
				throw new Error(`服务重复：${service}（内核已经提供）`);
			}
		}
	}

	private dependenciesMet(definition: PluginDefinition): boolean {
		const active = this.activeServices();
		return (definition.inject ?? []).every((service) => active.has(service));
	}

	private activeServiceNames(): readonly string[] {
		const names: string[] = [];
		for (const entry of this.plugins.values()) {
			if (entry.state !== "active") continue;
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
			if (entry.state === "failed") continue;
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
}

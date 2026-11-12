import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { BackgroundJobEntry } from "../background/registry.js";
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

export type PluginState =
	| "active"
	| "loading"
	| "blocked"
	| "failed"
	| "disposed";

export interface PluginStatus {
	readonly name: string;
	readonly state: PluginState;
	readonly reason: string | null;
	/** 尚未就绪的服务名。 */
	readonly missing: readonly string[];
}

export interface KernelSnapshot {
	readonly plugins: readonly PluginStatus[];
	/** 所有阻塞插件缺少的服务；已经由某个插件声明的服务不算缺失。 */
	readonly missingServices: readonly string[];
	readonly slots: Readonly<Record<string, readonly string[]>>;
	readonly mechanisms: readonly string[];
	readonly blockTypes: readonly string[];
	readonly backgroundJobs: readonly string[];
	readonly services: readonly string[];
}

/** 插件注册的后台任务类型；由内核在装载成功后归一化。 */
export interface RegisteredBackgroundJob {
	readonly plugin: string;
	readonly kind: string;
	readonly type: BackgroundJobType;
}

/** 监听器参数按扩展点各自声明，注册时不做双向兼容检查。 */
export type EventListener = {
	bivarianceHack(...args: unknown[]): unknown;
}["bivarianceHack"];

export interface PluginContext {
	readonly name: string;
	slot(name: ContextSlotName, provider: ContextSlotProvider): void;
	directorMechanism(mechanism: DirectorMechanism): void;
	blockType(definition: BlockTypeDefinition): void;
	provide<T>(name: string, value: T): void;
	service<T>(name: string): T | undefined;
	on(name: string, listener: EventListener): void;
	backgroundJob(kind: string, entry: BackgroundJobEntry): void;
	/** 一次性定时器；卸载或重载时自动清除。 */
	timeout(callback: () => void, delayMs: number): () => void;
	/** 周期定时器；卸载或重载时自动清除。 */
	interval(callback: () => void, delayMs: number): () => void;
	onDispose(cleanup: () => void | Promise<void>): void;
}

export interface PluginDefinition {
	readonly name: string;
	readonly inject?: readonly string[];
	readonly provide?: readonly string[];
	readonly Config?: StandardSchemaV1<unknown, unknown>;
	apply(context: PluginContext, config: unknown): void;
}

export interface SlotRunResult {
	readonly plugin: string;
	readonly content: ContextSlotContent | null;
}

/** 插件内核的对外接口，运行环境与测试按这个接口取用。 */
export interface PluginKernel {
	load(definition: PluginDefinition, config?: unknown): Promise<PluginStatus>;
	unload(name: string): Promise<void>;
	reload(definition: PluginDefinition, config?: unknown): Promise<PluginStatus>;
	status(name: string): PluginStatus;
	snapshot(): KernelSnapshot;
	runSlot(request: ContextSlotRequest): Promise<readonly SlotRunResult[]>;
	/** 槽位当前注册的第一个提供者；没有注册时返回 null。 */
	slotProvider(name: ContextSlotName): ContextSlotProvider | null;
	runMechanisms(context: DirectorMechanismContext): readonly {
		plugin: string;
		name: string;
		result: DirectorMechanismResult;
	}[];
	blockType(name: string): BlockTypeDefinition | null;
	backgroundJob(kind: string): BackgroundJobType | null;
	backgroundJobs(): readonly RegisteredBackgroundJob[];
	service<T>(name: string): T | undefined;
	on(name: string, listener: EventListener): () => void;
	emit(name: string, ...args: unknown[]): void;
	parallel(name: string, ...args: unknown[]): Promise<readonly unknown[]>;
	serial(name: string, ...args: unknown[]): Promise<readonly unknown[]>;
	bail(name: string, ...args: unknown[]): unknown;
	waterfall<T>(name: string, value: T): T;
	dispose(): Promise<void>;
}

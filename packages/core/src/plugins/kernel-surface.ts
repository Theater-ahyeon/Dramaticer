import type { BackgroundJobType } from "../background/types.js";
import type { BlockTypeDefinition } from "../blocks/types.js";
import type {
	ContextSlotContent,
	ContextSlotProvider,
	ContextSlotRequest,
} from "../context/assembler.js";
import type { ContextMessage, ContextSlotName } from "../context/template.js";
import type { DeepToolDefinition, ToolPhase } from "../tools/registry.js";
import type {
	EventListener,
	RegisteredBackgroundJob,
	SlotProviderEntry,
	SlotRunResult,
} from "./contracts.js";
import { EventBus } from "./events.js";
import {
	DEFAULT_FLOOR_RENDER_BUDGET_MS,
	type FloorRenderFailure,
	type FloorRenderOutcome,
	type FloorRenderRequest,
	type FloorRenderedContent,
	type FloorRenderedFloor,
	type RegisteredFloorRenderer,
	floorRendererClaims,
	readFloorRenderBlocks,
} from "./floor-renderers.js";
import { ExtensionRegistry } from "./registry.js";
import {
	REQUEST_REWRITE_HOOK,
	type RewrittenRequest,
	type TurnHookTraceEntry,
	runTurnHook,
} from "./turn-hooks.js";

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
		return this.slotProviderEntry(name)?.provider ?? null;
	}

	slotProviderEntry(name: ContextSlotName): SlotProviderEntry | null {
		return this.registry.slotProviders(name)[0] ?? null;
	}

	/**
	 * 组装后的请求改写：按注册顺序依次改写同一个消息数组。
	 * 每个钩子有独立的耗时上限，超时跳过并记录；请求无论有没有钩子都原样返回。
	 */
	async rewriteRequest(
		messages: readonly ContextMessage[],
		budgetMs?: number,
	): Promise<RewrittenRequest> {
		let current = messages;
		const hooks: TurnHookTraceEntry[] = [];
		for (const registration of this.bus.listeners(REQUEST_REWRITE_HOOK)) {
			const plugin = registration.plugin ?? "anonymous";
			const run = await runTurnHook({
				extension: "request.rewrite",
				hook: REQUEST_REWRITE_HOOK,
				plugin,
				budgetMs,
				run: () => registration.listener(current),
			});
			hooks.push(run.trace);
			if (run.trace.outcome === "timeout") continue;
			if (run.value === undefined || run.value === null) continue;
			current = assertRewrittenMessages(run.value, plugin);
		}
		return { messages: current, hooks };
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

	/** 已注册的楼层渲染器，按注册顺序。 */
	floorRenderers(): readonly RegisteredFloorRenderer[] {
		return this.registry.floorRenderers();
	}

	/**
	 * 按注册顺序匹配楼层：第一个认领且渲染成功的渲染器获胜。
	 * 抛错或超时的渲染器跳过并记录原因，正文仍按原生方式兜底显示（I17 的精神）。
	 */
	async renderFloor(
		request: FloorRenderRequest,
		budgetMs: number = DEFAULT_FLOOR_RENDER_BUDGET_MS,
	): Promise<FloorRenderOutcome> {
		if (!Number.isInteger(budgetMs) || budgetMs <= 0) {
			throw new Error(
				`楼层渲染的时间预算必须是正整数毫秒，实际为 ${String(budgetMs)}`,
			);
		}
		const blocks = readFloorRenderBlocks(request.raw);
		const input = {
			nodeId: request.nodeId,
			raw: request.raw,
			blocks,
			state: request.state,
		};
		const failures: FloorRenderFailure[] = [];
		for (const entry of this.registry.floorRenderers()) {
			if (!floorRendererClaims(entry.definition, input)) continue;
			try {
				const content = await runWithinBudget(
					() => entry.definition.render(input),
					budgetMs,
				);
				if (content === null) continue;
				return {
					floor: renderedFloor(entry.definition, content),
					failures,
				};
			} catch (error) {
				failures.push({
					renderer: entry.definition.id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		return { floor: null, failures };
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

const MESSAGE_ROLES: Readonly<Record<string, true>> = {
	system: true,
	user: true,
	assistant: true,
};

/** 改写钩子只能返回消息数组；返回非法结构说明插件出错，直接失败并指出插件。 */
function assertRewrittenMessages(
	value: unknown,
	plugin: string,
): readonly ContextMessage[] {
	if (!Array.isArray(value)) {
		throw new Error(`请求改写钩子 ${plugin} 必须返回消息数组`);
	}
	for (const message of value as readonly unknown[]) {
		if (typeof message !== "object" || message === null) {
			throw new Error(`请求改写钩子 ${plugin} 返回了非对象消息`);
		}
		const item = message as { role?: unknown; content?: unknown };
		if (typeof item.role !== "string" || MESSAGE_ROLES[item.role] !== true) {
			throw new Error(
				`请求改写钩子 ${plugin} 返回了不合法的消息角色：${String(item.role)}`,
			);
		}
		if (typeof item.content !== "string" || item.content.length === 0) {
			throw new Error(`请求改写钩子 ${plugin} 返回了空的消息内容`);
		}
	}
	return value as readonly ContextMessage[];
}

/** 渲染器抛出的错误原样上抛；超时也算失败，由调用方跳过并记录。 */
async function runWithinBudget<T>(
	run: () => T | PromiseLike<T>,
	budgetMs: number,
): Promise<T> {
	const { promise: deadline, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(
		() => reject(new Error(`超过楼层渲染时间预算 ${budgetMs} 毫秒`)),
		budgetMs,
	);
	try {
		return await Promise.race([Promise.resolve().then(run), deadline]);
	} finally {
		clearTimeout(timer);
	}
}

/** 渲染结果只接受字符串；拿不到完整结构说明插件出错，直接失败并指出渲染器。 */
function renderedFloor(
	definition: RegisteredFloorRenderer["definition"],
	content: FloorRenderedContent,
): FloorRenderedFloor {
	if (typeof content !== "object" || content === null) {
		throw new Error(`楼层渲染器 ${definition.id} 必须返回渲染结果对象`);
	}
	if (typeof content.html !== "string") {
		throw new Error(`楼层渲染器 ${definition.id} 必须返回 html 字符串`);
	}
	if (
		content.script !== undefined &&
		content.script !== null &&
		typeof content.script !== "string"
	) {
		throw new Error(`楼层渲染器 ${definition.id} 的 script 必须是字符串`);
	}
	if (
		content.style !== undefined &&
		content.style !== null &&
		typeof content.style !== "string"
	) {
		throw new Error(`楼层渲染器 ${definition.id} 的 style 必须是字符串`);
	}
	return {
		renderer: definition.id,
		name: definition.name,
		html: content.html,
		script: content.script ?? null,
		style: content.style ?? null,
		permissions: definition.permissions ?? [],
	};
}

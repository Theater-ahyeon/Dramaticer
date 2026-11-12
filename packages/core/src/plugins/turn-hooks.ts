import type { ContextMessage } from "../context/template.js";

/** 回合内扩展点：上下文槽位提供者与组装后的请求改写。 */
export type TurnHookExtension = "context.slot" | "request.rewrite";

export type TurnHookOutcome = "ok" | "timeout";

/** 请求改写钩子注册的事件名；水流式分发，依次把同一个请求交给下一个钩子。 */
export const REQUEST_REWRITE_HOOK = "request.rewrite";

/**
 * 一次钩子运行。超时的钩子被跳过，扩展点、插件、耗时与原因都写进 Trace（I17）。
 */
export interface TurnHookTraceEntry {
	readonly extension: TurnHookExtension;
	readonly plugin: string;
	/** 扩展点内的具体位置：槽位名，或者请求改写的事件名。 */
	readonly hook: string;
	readonly durationMs: number;
	readonly outcome: TurnHookOutcome;
	readonly reason: string | null;
}

/**
 * 回合内钩子的默认时间预算。内置记忆槽位会在回合内调用 embedding 与重排序渠道，
 * 预算要留出这些调用的时间；超时的提供者按缺失处理，所以不能设得太短。
 */
export const DEFAULT_TURN_HOOK_BUDGET_MS = 5_000;

/** 组装后的请求；`messages` 是依次改写后的最终请求。 */
export interface RewrittenRequest {
	readonly messages: readonly ContextMessage[];
	readonly hooks: readonly TurnHookTraceEntry[];
}

/** 回合只依赖这个接口，不直接持有插件内核。 */
export interface TurnRequestRewriter {
	rewriteRequest(
		messages: readonly ContextMessage[],
		budgetMs?: number,
	): Promise<RewrittenRequest>;
}

export interface TurnHookRun<T> {
	/** 超时被跳过时为 null。 */
	readonly value: T | null;
	readonly trace: TurnHookTraceEntry;
}

class HookBudgetExceededError extends Error {
	constructor(budgetMs: number) {
		super(`超过时间预算 ${budgetMs} 毫秒`);
		this.name = "HookBudgetExceededError";
	}
}

export function assertTurnHookBudgetMs(value: number): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(
			`回合钩子的时间预算必须是正整数毫秒，实际为 ${String(value)}`,
		);
	}
}

/**
 * 在预算内运行一个钩子：超时后返回 null，调用方按缺失处理；
 * 钩子抛出的其它错误原样抛出，不做静默放行。
 */
export async function runTurnHook<T>(input: {
	readonly extension: TurnHookExtension;
	readonly hook: string;
	readonly plugin: string;
	readonly budgetMs?: number;
	run(): T | PromiseLike<T>;
}): Promise<TurnHookRun<T>> {
	const budgetMs = input.budgetMs ?? DEFAULT_TURN_HOOK_BUDGET_MS;
	assertTurnHookBudgetMs(budgetMs);
	const startedAt = performance.now();
	const { promise: deadline, reject: rejectDeadline } =
		Promise.withResolvers<never>();
	const timer = setTimeout(
		() => rejectDeadline(new HookBudgetExceededError(budgetMs)),
		budgetMs,
	);
	try {
		const value = await Promise.race([
			Promise.resolve().then(() => input.run()),
			deadline,
		]);
		return {
			value,
			trace: {
				extension: input.extension,
				plugin: input.plugin,
				hook: input.hook,
				durationMs: Math.round(performance.now() - startedAt),
				outcome: "ok",
				reason: null,
			},
		};
	} catch (error) {
		if (!(error instanceof HookBudgetExceededError)) throw error;
		return {
			value: null,
			trace: {
				extension: input.extension,
				plugin: input.plugin,
				hook: input.hook,
				durationMs: Math.round(performance.now() - startedAt),
				outcome: "timeout",
				reason: error.message,
			},
		};
	} finally {
		clearTimeout(timer);
	}
}

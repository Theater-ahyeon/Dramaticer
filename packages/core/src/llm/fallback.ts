import {
	type LlmChannelsConfig,
	type LlmModelRole,
	resolveModelForRole,
} from "./channels.js";
import { createEventStream } from "./event-stream.js";
import {
	LlmAllChannelsFailedError,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamEvent,
	type LlmStreamingClient,
} from "./types.js";

// 后台保底（refactor/03，DESIGN §10.2）：路由器只在同一个模型的渠道之间切换
// （ADR-0042），跨模型的保底由调用方显式包一层。这里只给后台岗位用：主模型的
// 所有渠道都失败后改用 `fallback` 指向的模型，正文写作不隐式换模型。

export interface FallbackClientOptions {
	readonly primary: LlmStreamingClient;
	readonly fallback: LlmStreamingClient;
	/** 切到保底时回调一次，服务端用它写日志；参数是主模型的失败。 */
	readonly onFallback?: (error: LlmAllChannelsFailedError) => void;
}

/** 只有「所有渠道都失败」才切保底；参数错误、取消等照常抛出。 */
function shouldFallBack(
	error: unknown,
	signal: AbortSignal | undefined,
): error is LlmAllChannelsFailedError {
	return error instanceof LlmAllChannelsFailedError && signal?.aborted !== true;
}

/** 保底模型用自己的默认别名；请求里点名的主模型别名要去掉。 */
function forFallback(request: LlmRequest): LlmRequest {
	const { model: _primaryModel, ...rest } = request;
	return rest;
}

export function createFallbackClient(
	options: FallbackClientOptions,
): LlmStreamingClient {
	const { primary, fallback, onFallback } = options;
	return {
		async complete(
			request: LlmRequest,
			callOptions?: LlmCallOptions,
		): Promise<LlmResult> {
			try {
				return await primary.complete(request, callOptions);
			} catch (error) {
				if (!shouldFallBack(error, request.signal)) throw error;
				onFallback?.(error);
				return fallback.complete(forFallback(request), callOptions);
			}
		},
		stream(request: LlmRequest, callOptions?: LlmCallOptions): LlmStream {
			return createEventStream<LlmStreamEvent, LlmResult>(async (emit) => {
				let emitted = false;
				try {
					const stream = primary.stream(request, callOptions);
					for await (const event of stream) {
						emitted = true;
						emit(event);
					}
					return await stream.result();
				} catch (error) {
					// 已经推送过内容就不能换模型重来，否则下游会收到两段拼起来的文本。
					if (emitted || !shouldFallBack(error, request.signal)) throw error;
					onFallback?.(error);
					const stream = fallback.stream(forFallback(request), callOptions);
					for await (const event of stream) emit(event);
					return stream.result();
				}
			});
		},
	};
}

/** 后台岗位：结算与规划；没有单独配置时回落到 background 模型。 */
export const BACKGROUND_ROLES = [
	"settler",
	"planner",
] as const satisfies readonly LlmModelRole[];

/**
 * 渠道配置里值得提醒的地方，启动日志与设置页的模型分页都显示。只看配置，
 * 不发请求，不碰密钥。
 */
export function readChannelWarnings(config: LlmChannelsConfig): string[] {
	const warnings: string[] = [];
	for (const model of config.models.values()) {
		const fallbackAlias = model.fallback ?? null;
		if (fallbackAlias === null) continue;
		const fallback = config.models.get(fallbackAlias);
		if (fallback === undefined) continue;
		const shared = model.channels.filter((id) =>
			fallback.channels.includes(id),
		);
		if (shared.length > 0) {
			warnings.push(
				`模型 ${model.alias} 的保底 ${fallbackAlias} 和它共用渠道 ${shared.join("、")}：这个渠道额度耗尽或被停用时两者会一起停，建议让保底走另一家供应商`,
			);
		}
		if (!fallback.enabled) {
			warnings.push(`模型 ${model.alias} 的保底 ${fallbackAlias} 已经被停用`);
		}
	}
	const reported = new Set<string>();
	for (const role of BACKGROUND_ROLES) {
		let alias: string;
		try {
			alias = resolveModelForRole(config, role);
		} catch {
			continue;
		}
		if (reported.has(alias)) continue;
		reported.add(alias);
		const model = config.models.get(alias);
		if (model === undefined || (model.fallback ?? null) !== null) continue;
		const conventional = `${alias}-fallback`;
		warnings.push(
			config.models.has(conventional)
				? `后台模型 ${alias} 没有指向保底：有 ${conventional} 但 ${alias} 没写 fallback: ${conventional}`
				: `后台模型 ${alias} 没有配置保底（fallback）：主渠道失败时后台任务会中断`,
		);
	}
	return warnings;
}

import type { ServerResponse } from "node:http";
import {
	type ChatTurnResult,
	type GenerateAssistantTurnOptions,
	LlmAllChannelsFailedError,
	LlmProviderError,
	type ParsedContent,
	type StoryStore,
	generateAssistantTurn,
	regenerateAssistantTurn,
} from "@dramaticer/core";
import type { ApiErrorBody } from "@dramaticer/protocol";
import type { BackgroundScheduler } from "./background.js";
import { HttpError } from "./http.js";
import type { StoryRuntime, StoryRuntimeManager } from "./runtime.js";
import { type SseStream, createSseStream } from "./sse.js";

/** 每个故事同一时间只允许一个回合；冲突的请求直接返回 409。 */
export interface TurnTicket {
	readonly signal: AbortSignal;
	abort(reason?: unknown): void;
	release(): void;
}

interface ActiveTurn {
	readonly controller: AbortController;
	readonly done: Promise<void>;
}

export class TurnCoordinator {
	readonly #active = new Map<string, ActiveTurn>();

	begin(storyId: string): TurnTicket | null {
		if (this.#active.has(storyId)) return null;
		const controller = new AbortController();
		const finished = Promise.withResolvers<void>();
		this.#active.set(storyId, { controller, done: finished.promise });
		let released = false;
		return {
			signal: controller.signal,
			abort: (reason?: unknown) => {
				if (!controller.signal.aborted) controller.abort(reason);
			},
			release: () => {
				if (released) return;
				released = true;
				this.#active.delete(storyId);
				finished.resolve();
			},
		};
	}

	/** 服务端关闭时中止全部回合，并等它们把已生成的内容写完。 */
	async abortAll(reason: unknown = new Error("服务端关闭")): Promise<void> {
		const entries = [...this.#active.values()];
		for (const entry of entries) {
			if (!entry.controller.signal.aborted) entry.controller.abort(reason);
		}
		await Promise.all(entries.map((entry) => entry.done));
	}
}

export interface TurnRouteOptions {
	readonly store: StoryStore;
	readonly runtime: StoryRuntimeManager | null;
	readonly turns: TurnCoordinator;
	readonly log: (line: string) => void;
	readonly heartbeatMs: number;
	readonly scheduler?: BackgroundScheduler | null;
	readonly now?: () => number;
}

interface GenerationHooks {
	readonly onTextDelta: (
		delta: string,
		snapshot: readonly ParsedContent[],
	) => void;
	readonly onThinkingDelta: (delta: string) => void;
	readonly onToolCall: (call: {
		readonly name: string;
		readonly ok: boolean;
	}) => void;
	readonly now: () => number;
}

interface StreamTurnOptions {
	readonly res: ServerResponse;
	readonly storyId: string;
	readonly ticket: TurnTicket;
	readonly options: TurnRouteOptions;
	/** 流开始前准备楼层，返回 turn.started 里要带的用户楼层 id。 */
	readonly prepare: (
		runtime: StoryRuntime,
		signal: AbortSignal,
	) => Promise<string>;
	readonly run: (
		runtime: StoryRuntime,
		signal: AbortSignal,
		hooks: GenerationHooks,
	) => Promise<ChatTurnResult>;
}

/**
 * `POST /api/stories/:id/turns` 的 SSE 实现：先建用户楼层，再流式生成；
 * 客户端断开时中止上游并保存已经生成的部分正文。
 */
export async function handleTurnStream(
	res: ServerResponse,
	storyId: string,
	text: string,
	options: TurnRouteOptions,
): Promise<void> {
	const ticket = options.turns.begin(storyId);
	if (ticket === null) {
		throw new HttpError(409, "conflict", "这个故事正在生成上一轮回复");
	}
	let userNodeId: string | null = null;
	await streamTurn({
		res,
		storyId,
		ticket,
		options,
		prepare: async () => {
			const head = options.store.getHead(storyId);
			const userNode = options.store.appendNode({
				storyId,
				parentId: head?.id ?? null,
				role: "user",
				raw: text,
			});
			userNodeId = userNode.id;
			return userNode.id;
		},
		run: async (runtime, signal, hooks) => {
			if (userNodeId === null) {
				throw new Error("准备用户楼层失败");
			}
			return generateAssistantTurn({
				...turnOptions(runtime, storyId, options),
				userNodeId,
				signal,
				...hooks,
			});
		},
	});
}

/**
 * `POST /api/nodes/:id/regenerate` 的 SSE 实现：以旧助手楼层的父楼层为锚点
 * 新建兄弟楼层，旧楼层与旧 Trace 保持不变。
 */
export async function handleRegenerateStream(
	res: ServerResponse,
	nodeId: string,
	options: TurnRouteOptions,
): Promise<void> {
	const assistantNode = options.store.getNode(nodeId);
	if (assistantNode === null) {
		throw new HttpError(404, "not_found", `楼层节点不存在：${nodeId}`);
	}
	if (assistantNode.role !== "assistant") {
		throw new HttpError(
			400,
			"bad_request",
			`楼层 ${nodeId} 不是助手楼层，不能重新生成`,
		);
	}
	const userNodeId = assistantNode.parentId;
	if (userNodeId === null) {
		throw new HttpError(
			400,
			"bad_request",
			`助手楼层 ${nodeId} 没有父用户楼层`,
		);
	}
	const storyId = assistantNode.storyId;
	const ticket = options.turns.begin(storyId);
	if (ticket === null) {
		throw new HttpError(409, "conflict", "这个故事正在生成上一轮回复");
	}
	await streamTurn({
		res,
		storyId,
		ticket,
		options,
		prepare: async () => userNodeId,
		run: async (runtime, signal, hooks) =>
			regenerateAssistantTurn({
				...turnOptions(runtime, storyId, options),
				assistantNodeId: nodeId,
				signal,
				...hooks,
			}),
	});
}

/** 两种流式回合共用的生成参数；模型、模板与预算都来自故事运行时。 */
function turnOptions(
	runtime: StoryRuntime,
	storyId: string,
	options: TurnRouteOptions,
): Omit<GenerateAssistantTurnOptions, "userNodeId"> {
	return {
		store: options.store,
		client: runtime.chatClient,
		storyId,
		template: runtime.template,
		providers: runtime.providers,
		budgetTokens: runtime.settings.budgetTokens,
		structuredOutput: runtime.settings.structuredOutput,
		toolTransport: runtime.toolTransport,
		embedder: runtime.embedder,
		viewpoint: runtime.settings.viewpoint,
		model: runtime.modelAlias,
		maxTokens: runtime.maxTokens,
		temperature: runtime.settings.temperature,
		reasoning: runtime.settings.reasoning,
	};
}

async function streamTurn(stream: StreamTurnOptions): Promise<void> {
	const { res, storyId, ticket, options } = stream;
	let sse: SseStream | null = null;
	let clientGone = false;
	let heartbeat: NodeJS.Timeout | undefined;
	const onClose = (): void => {
		if (res.writableEnded) return;
		clientGone = true;
		ticket.abort(new Error("客户端断开连接"));
	};
	res.once("close", onClose);
	try {
		if (options.runtime === null) {
			throw new HttpError(500, "internal", "服务端没有配置渠道");
		}
		const runtime = await options.runtime.get(storyId);
		if (clientGone || ticket.signal.aborted) return;
		const userNodeId = await stream.prepare(runtime, ticket.signal);
		if (clientGone || ticket.signal.aborted) return;
		sse = createSseStream(res);
		sse.send("turn.started", { storyId, userNodeId });
		heartbeat = setInterval(
			() => sse?.comment("ping"),
			Math.max(1, options.heartbeatMs),
		);
		heartbeat.unref();
		const now = options.now ?? Date.now;
		let lastBlocksAt = Number.NEGATIVE_INFINITY;
		const result = await stream.run(runtime, ticket.signal, {
			onTextDelta: (delta, snapshot) => {
				if (clientGone || sse === null) return;
				sse.send("text.delta", { delta });
				const current = now();
				if (current - lastBlocksAt >= 100) {
					lastBlocksAt = current;
					sse.send("blocks.replace", { blocks: snapshot });
				}
			},
			onThinkingDelta: (delta) => {
				if (clientGone || sse === null) return;
				sse.send("thinking.delta", { delta });
			},
			onToolCall: (call) => {
				if (clientGone || sse === null) return;
				sse.send("tool.call", { name: call.name, ok: call.ok });
			},
			now,
		});
		if (clientGone || sse === null) return;
		sse.send("blocks.replace", { blocks: result.blocks });
		if (result.trace.llm.stopReason === "aborted") {
			sse.send("turn.error", {
				code: "upstream_error",
				message: "回合被中止，已经生成的内容已保存",
			});
			options.log("回合被中止：已保留部分正文");
			return;
		}
		sse.send("turn.completed", {
			storyId,
			userNode: result.userNode,
			node: result.node,
			stateDiffs: result.stateDiffs,
			plotNotes: result.plotNotes,
			usage: result.trace.llm.usage,
			trace: result.trace,
			firstTokenMs: result.trace.timing.firstTokenMs,
		});
		options.scheduler?.schedule(storyId);
	} catch (error) {
		if (sse === null) throw error;
		if (!clientGone) {
			sse.send("turn.error", toTurnError(error));
			options.log(
				`回合失败：${error instanceof Error ? error.name : "未知错误"}`,
			);
		}
	} finally {
		clearInterval(heartbeat);
		res.off("close", onClose);
		ticket.release();
		sse?.close();
	}
}

function toTurnError(error: unknown): ApiErrorBody {
	if (error instanceof HttpError) {
		return error.details === undefined
			? { code: error.code, message: error.message }
			: { code: error.code, message: error.message, details: error.details };
	}
	if (
		error instanceof LlmAllChannelsFailedError ||
		error instanceof LlmProviderError
	) {
		return { code: "upstream_error", message: error.message };
	}
	return { code: "internal", message: "生成失败" };
}

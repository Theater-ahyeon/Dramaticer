import type { ServerResponse } from "node:http";
import {
	LlmAllChannelsFailedError,
	LlmProviderError,
	type StoryStore,
	generateAssistantTurn,
} from "@dramaticer/core";
import type { ApiErrorBody } from "@dramaticer/protocol";
import { HttpError } from "./http.js";
import type { StoryRuntimeManager } from "./runtime.js";
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
	readonly now?: () => number;
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
	let stream: SseStream | null = null;
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
		const head = options.store.getHead(storyId);
		const userNode = options.store.appendNode({
			storyId,
			parentId: head?.id ?? null,
			role: "user",
			raw: text,
		});
		stream = createSseStream(res);
		stream.send("turn.started", { storyId, userNodeId: userNode.id });
		heartbeat = setInterval(
			() => stream?.comment("ping"),
			Math.max(1, options.heartbeatMs),
		);
		heartbeat.unref();
		const now = options.now ?? Date.now;
		let lastBlocksAt = Number.NEGATIVE_INFINITY;
		const result = await generateAssistantTurn({
			store: options.store,
			client: runtime.chatClient,
			storyId,
			userNodeId: userNode.id,
			template: runtime.template,
			providers: runtime.providers,
			budgetTokens: runtime.settings.budgetTokens,
			structuredOutput: runtime.settings.structuredOutput,
			embedder: runtime.embedder,
			viewpoint: runtime.settings.viewpoint,
			model: runtime.modelAlias,
			maxTokens: runtime.settings.maxTokens,
			temperature: runtime.settings.temperature,
			reasoning: runtime.settings.reasoning,
			signal: ticket.signal,
			onTextDelta: (delta, snapshot) => {
				if (clientGone || stream === null) return;
				stream.send("text.delta", { delta });
				const current = now();
				if (current - lastBlocksAt >= 100) {
					lastBlocksAt = current;
					stream.send("blocks.replace", { blocks: snapshot });
				}
			},
			onThinkingDelta: (delta) => {
				if (clientGone || stream === null) return;
				stream.send("thinking.delta", { delta });
			},
			onToolCall: (call) => {
				if (clientGone || stream === null) return;
				stream.send("tool.call", { name: call.name, ok: call.ok });
			},
			now,
		});
		if (clientGone || stream === null) return;
		stream.send("blocks.replace", { blocks: result.blocks });
		if (result.trace.llm.stopReason === "aborted") {
			stream.send("turn.error", {
				code: "upstream_error",
				message: "回合被中止，已经生成的内容已保存",
			});
			options.log("回合被中止：已保留部分正文");
			return;
		}
		stream.send("turn.completed", {
			storyId,
			userNode: result.userNode,
			node: result.node,
			stateDiffs: result.stateDiffs,
			plotNotes: result.plotNotes,
			usage: result.trace.llm.usage,
			trace: result.trace,
			firstTokenMs: result.trace.timing.firstTokenMs,
		});
	} catch (error) {
		if (stream === null) throw error;
		if (!clientGone) {
			stream.send("turn.error", toTurnError(error));
			options.log(
				`回合失败：${error instanceof Error ? error.name : "未知错误"}`,
			);
		}
	} finally {
		clearInterval(heartbeat);
		res.off("close", onClose);
		ticket.release();
		stream?.close();
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

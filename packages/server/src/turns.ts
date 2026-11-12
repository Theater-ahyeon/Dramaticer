import type { ServerResponse } from "node:http";
import {
	type ChatTurnResult,
	DeepTurnWithoutCommitError,
	type DirectorIntensity,
	type GenerateAssistantTurnOptions,
	type IllustrateTurnOptions,
	type ImagesConfig,
	LlmAllChannelsFailedError,
	LlmProviderError,
	type ParsedContent,
	type StoryStore,
	type TurnDraftSnapshot,
	type TurnMode,
	type TurnStartedInfo,
	generateAssistantTurn,
	regenerateAssistantTurn,
	resolveTurnMode,
} from "@dramaticer/core";
import { type ApiErrorBody, toDisplayedBlocks } from "@dramaticer/protocol";
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

/**
 * 正在运行的深回合句柄表：按 `runId` 找到追加要求的入口。
 * 运行结束或流关闭时移除，追加请求随后按运行状态返回 409。
 */
export interface ActiveTurnRun {
	readonly runId: string;
	readonly storyId: string;
	/** 追加一条指引；校验与拒绝理由由 core 的句柄给出。 */
	readonly push: (text: string) => void;
}

export class TurnRunRegistry {
	readonly #runs = new Map<string, ActiveTurnRun>();

	register(run: ActiveTurnRun): void {
		this.#runs.set(run.runId, run);
	}

	unregister(runId: string): void {
		this.#runs.delete(runId);
	}

	get(runId: string): ActiveTurnRun | null {
		return this.#runs.get(runId) ?? null;
	}

	get size(): number {
		return this.#runs.size;
	}
}

export interface TurnRouteOptions {
	readonly store: StoryStore;
	readonly runtime: StoryRuntimeManager | null;
	readonly turns: TurnCoordinator;
	readonly runs: TurnRunRegistry;
	readonly log: (line: string) => void;
	readonly heartbeatMs: number;
	readonly scheduler?: BackgroundScheduler | null;
	readonly now?: () => number;
	/** 启动时读取的生图配置；不设置时按没有 provider 处理。 */
	readonly imagesConfig?: ImagesConfig;
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
	readonly onToolProgress: (event: {
		readonly phase: string;
		readonly detail: string;
	}) => void;
	readonly onDraftReplace: (draft: TurnDraftSnapshot) => void;
	readonly onTurnStarted: (started: TurnStartedInfo) => void;
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

export interface TurnRequestInputs {
	/** 单轮导演强度；请求没给时为 null。 */
	readonly directorIntensity?: DirectorIntensity | null;
	/** 单轮模式；请求没给时为 null，使用故事设置。 */
	readonly turnMode?: TurnMode | null;
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
	inputs: TurnRequestInputs = {},
): Promise<void> {
	const turnMode = resolveRequestedTurnMode(
		options.store,
		storyId,
		inputs.turnMode ?? null,
	);
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
				turnMode,
				directorIntensity: inputs.directorIntensity ?? null,
				signal,
				...hooks,
			});
		},
	});
}

/**
 * `POST /api/nodes/:id/retry` 的 SSE 实现：以已有的用户楼层为父节点重新生成回复。
 * 不追加新的用户楼层，用于深回合失败或中止后重试同一轮。
 */
export async function handleRetryStream(
	res: ServerResponse,
	nodeId: string,
	options: TurnRouteOptions,
	turnMode: TurnMode | null,
): Promise<void> {
	const userNode = options.store.getNode(nodeId);
	if (userNode === null) {
		throw new HttpError(404, "not_found", `楼层节点不存在：${nodeId}`);
	}
	if (userNode.role !== "user") {
		throw new HttpError(
			400,
			"bad_request",
			`楼层 ${nodeId} 不是用户楼层，不能重试这一轮`,
		);
	}
	const storyId = userNode.storyId;
	const ticket = options.turns.begin(storyId);
	if (ticket === null) {
		throw new HttpError(409, "conflict", "这个故事正在生成上一轮回复");
	}
	await streamTurn({
		res,
		storyId,
		ticket,
		options,
		prepare: async () => userNode.id,
		run: async (runtime, signal, hooks) =>
			generateAssistantTurn({
				...turnOptions(runtime, storyId, options),
				userNodeId: userNode.id,
				turnMode,
				signal,
				...hooks,
			}),
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
		requestRewriter: runtime.requestRewriter,
		budgetTokens: runtime.settings.budgetTokens,
		structuredOutput: runtime.settings.structuredOutput,
		toolTransport: runtime.toolTransport,
		embedder: runtime.embedder,
		reranker: runtime.reranker,
		viewpoint: runtime.settings.viewpoint,
		model: runtime.modelAlias,
		maxTokens: runtime.maxTokens,
		temperature: runtime.settings.temperature,
		reasoning: runtime.settings.reasoning,
		illustrate: resolveIllustrateOptions(
			options.store,
			storyId,
			options.imagesConfig,
		),
	};
}

/** 工具可见性与回合内的频率检查共用故事设置里的 imageConfig。 */
function resolveIllustrateOptions(
	store: StoryStore,
	storyId: string,
	imagesConfig: ImagesConfig | undefined,
): IllustrateTurnOptions {
	const config = store.getStorySettings(storyId).imageConfig;
	const workflow =
		config.workflowId.trim().length === 0
			? null
			: store.getImageWorkflow(config.workflowId.trim());
	return {
		...config,
		providerConfigured:
			workflow !== null &&
			imagesConfig !== undefined &&
			imagesConfig.providers.has(workflow.provider),
	};
}

async function streamTurn(stream: StreamTurnOptions): Promise<void> {
	const { res, storyId, ticket, options } = stream;
	let sse: SseStream | null = null;
	let clientGone = false;
	let heartbeat: NodeJS.Timeout | undefined;
	let userNodeId: string | null = null;
	let started = false;
	const activeRuns: string[] = [];
	const sendStarted = (runId: string | null): void => {
		if (started || sse === null || clientGone || userNodeId === null) return;
		started = true;
		sse.send("turn.started", { storyId, userNodeId, runId });
	};
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
		userNodeId = await stream.prepare(runtime, ticket.signal);
		if (clientGone || ticket.signal.aborted) return;
		sse = createSseStream(res);
		heartbeat = setInterval(
			() => sse?.comment("ping"),
			Math.max(1, options.heartbeatMs),
		);
		heartbeat.unref();
		const now = options.now ?? Date.now;
		let lastBlocksAt = Number.NEGATIVE_INFINITY;
		let lastDraftAt = Number.NEGATIVE_INFINITY;
		const result = await stream.run(runtime, ticket.signal, {
			onTurnStarted: (startedTurn) => {
				sendStarted(startedTurn.runId);
				const handle = startedTurn.handle;
				if (handle === null) return;
				activeRuns.push(handle.runId);
				options.runs.register({
					runId: handle.runId,
					storyId,
					push: (text) => {
						handle.pushGuidance(text);
						if (!clientGone && sse !== null) {
							sse.send("turn.steering", { runId: handle.runId, text });
						}
					},
				});
			},
			onTextDelta: (delta, snapshot) => {
				if (clientGone || sse === null) return;
				sse.send("text.delta", { delta });
				const current = now();
				if (current - lastBlocksAt >= 100) {
					lastBlocksAt = current;
					sse.send("blocks.replace", {
						blocks: toDisplayedBlocks(snapshot),
					});
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
			onToolProgress: (event) => {
				if (clientGone || sse === null) return;
				sse.send("turn.progress", {
					phase: event.phase,
					detail: event.detail,
				});
			},
			onDraftReplace: (draft) => {
				if (clientGone || sse === null) return;
				const current = now();
				if (current - lastDraftAt >= 100) {
					lastDraftAt = current;
					sse.send("draft.replace", {
						text: draft.text,
						version: draft.version,
					});
				}
			},
			now,
		});
		if (clientGone || sse === null) return;
		sse.send("blocks.replace", { blocks: toDisplayedBlocks(result.blocks) });
		const deep = result.trace.deep;
		const run = result.trace.run;
		if (deep !== null && run !== null && deep.commit !== "none") {
			sse.send("turn.committed", {
				storyId,
				runId: run.runId,
				nodeId: result.node.id,
				blocks: toDisplayedBlocks(result.blocks),
				commit: deep.commit,
			});
		}
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
			blocks: toDisplayedBlocks(result.blocks),
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
			sendStarted(null);
			sse.send("turn.error", toTurnError(error));
			options.log(
				`回合失败：${error instanceof Error ? error.name : "未知错误"}`,
			);
		}
	} finally {
		clearInterval(heartbeat);
		res.off("close", onClose);
		for (const runId of activeRuns) options.runs.unregister(runId);
		ticket.release();
		sse?.close();
	}
}

/** 写任何楼层之前先解析模式与防失控上限；配置非法时按 400 拒绝。 */
function resolveRequestedTurnMode(
	store: StoryStore,
	storyId: string,
	requested: TurnMode | null,
): TurnMode {
	try {
		return resolveTurnMode(store, storyId, requested, null).mode;
	} catch (error) {
		throw new HttpError(
			400,
			"bad_request",
			error instanceof Error ? error.message : "回合模式不可用",
			{ path: requested === null ? "turnMode" : "mode" },
		);
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
	if (error instanceof DeepTurnWithoutCommitError) {
		return { code: "internal", message: error.message };
	}
	return { code: "internal", message: "生成失败" };
}

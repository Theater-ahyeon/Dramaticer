import { parseBlocks } from "../blocks/parser.js";
import type { ParsedContent } from "../blocks/types.js";
import {
	type ContextSlotProviders,
	type ContextTrace,
	type ContextTraceEntry,
	assembleContext,
} from "../context/assembler.js";
import { contextPackFingerprint } from "../context/pack-format.js";
import { loadReusableContextPack, saveContextPack } from "../context/pack.js";
import type { ContextTemplate } from "../context/template.js";
import {
	type DirectorIntensity,
	resolveDirectorIntensity,
} from "../director/intensity.js";
import type { DirectorPush } from "../director/lines.js";
import { formatDirectorNotes } from "../director/notes.js";
import {
	ILLUSTRATE_TOOL,
	type IllustrateTurnOptions,
	applyIllustrateCalls,
	resolveIllustrateTool,
} from "../images/tool.js";
import { type LlmToolTransport, assertToolTransport } from "../llm/channels.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { RerankClient } from "../llm/rerank.js";
import {
	DEFAULT_TRUNCATION_TERMINATORS,
	detectTruncations,
} from "../llm/truncation.js";
import type {
	LlmMessage,
	LlmReasoningLevel,
	LlmStreamingClient,
	LlmUsage,
} from "../llm/types.js";
import type { PlotNote } from "../memory/plot-note.js";
import {
	type TurnHookTraceEntry,
	type TurnRequestRewriter,
	assertTurnHookBudgetMs,
} from "../plugins/turn-hooks.js";
import {
	type RerollReason,
	applyRerollReasonWill,
	assertRerollReason,
	formatRerollCorrection,
} from "../preferences/reroll.js";
import type { TurnRunEventInput, TurnRunFinalStatus } from "../run-log.js";
import { readStoryFeatureState } from "../settings/features.js";
import { formatWritingDials } from "../settings/writing.js";
import type { StoryStore } from "../store/story-store.js";
import {
	collectStructuredOutputFromText,
	collectStructuredOutputFromToolCalls,
} from "../structured/collect.js";
import { STRUCTURED_OUTPUT_TOOLS } from "../structured/schema.js";
import type {
	AcceptedStateUpdate,
	StructuredOutputCollection,
	StructuredOutputMode,
} from "../structured/types.js";
import type { NewStateDiff, StateDiff, TimelineNode } from "../timeline.js";
import { createTokenEstimator } from "../tokens.js";
import {
	DEEP_TURN_TOOLS,
	FAST_TURN_TOOLS,
	NOTE_READ_TOOL_NAME,
	NOTE_WRITE_TOOL_NAME,
	RULE_CHECK_TOOL,
	RULE_CHECK_TOOL_NAME,
	formatWorkspaceGuide,
} from "../tools/index.js";
import type {
	DeepToolDefinition,
	ToolProgressEvent,
} from "../tools/registry.js";
import {
	type TurnTrace,
	type TurnTraceRun,
	cacheTraceFromUsage,
} from "../trace.js";
import { type DeepTurnResult, runDeepTurn } from "./deep-turn.js";
import { TurnDraftController, type TurnDraftSnapshot } from "./draft.js";
import {
	type ModelTurnResult,
	TurnAbortedError,
	runModelTurns,
} from "./executor.js";
import { TurnGuidanceController, type TurnStartedInfo } from "./guidance.js";
import {
	type TurnMode,
	assertDeepContextTokenLimit,
	assertDeepMaxToolCalls,
	assertDeepRecentToolSteps,
	assertDeepTimeoutMs,
	assertMaxReadRounds,
} from "./mode.js";
import { TurnNoteController } from "./notes.js";
import {
	PLAN_PREP_PHASES,
	type PlanTurnTrace,
	buildSelfCheckList,
	formatSelfCheckList,
	isPlanPrepareEnabled,
	isPlanWritingMode,
	readPreparedPlan,
	runPlanPhases,
} from "./plan-turn.js";
import {
	type ChatProfile,
	DEFAULT_CHAT_PROFILE,
	assertChatProfile,
} from "./profile.js";
import {
	createDirectorSlotProvider,
	createReunionSlotProvider,
	isDirectorSlotProvider,
	isReunionSlotProvider,
} from "./providers.js";
import { detectContextLayout } from "./template.js";

export interface ChatTurnOptions {
	readonly store: StoryStore;
	readonly client: LlmStreamingClient;
	readonly storyId: string;
	readonly userText: string;
	readonly template: ContextTemplate;
	readonly providers?: ContextSlotProviders;
	/**
	 * 组装后的请求改写入口；不设置时请求与组装结果一致。
	 * 由槽位集合的内核提供，每个钩子有耗时上限。
	 */
	readonly requestRewriter?: TurnRequestRewriter | null;
	/** 回合钩子的时间预算；不设置时使用默认值。 */
	readonly hookBudgetMs?: number;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
	/** 工具调用传输；不设置时走原生函数调用。 */
	readonly toolTransport?: LlmToolTransport | null;
	/** 有 embedding 客户端时 memory_search 启用向量路。 */
	readonly embedder?: EmbeddingClient | null;
	/** memory_search 的融合后重排序客户端。 */
	readonly reranker?: RerankClient | null;
	/** 知情者视角；不设置时读取工具返回全知结果。 */
	readonly viewpoint?: string | null;
	/** 单轮模式；不设置时使用故事设置里的锁定值。 */
	readonly turnMode?: TurnMode | null;
	/** 对话档位；不设置时是 native。naive 不提供读写工具，也不写台账。 */
	readonly profile?: ChatProfile;
	/** 读取工具软上限；不设置时使用故事设置。 */
	readonly maxReadRounds?: number | null;
	/** 单轮导演强度；优先于导演槽位配置里的值。 */
	readonly directorIntensity?: DirectorIntensity | null;
	/** 单轮推进档位；优先于导演槽位上的值。 */
	readonly directorPush?: DirectorPush | null;
	/** 生图设置；工具可见性与频率检查都读这里。 */
	readonly illustrate?: IllustrateTurnOptions | null;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
	/** 采样种子；评测用它区分两次同配置生成。 */
	readonly seed?: number;
	readonly reasoning?: LlmReasoningLevel;
	readonly signal?: AbortSignal;
	readonly onTextDelta?: (
		delta: string,
		snapshot: readonly ParsedContent[],
	) => void;
	readonly onThinkingDelta?: (delta: string) => void;
	/** 每次读取工具执行后回调，服务端用它转发 SSE 事件。 */
	readonly onToolCall?: (call: {
		readonly name: string;
		readonly ok: boolean;
	}) => void;
	/** 工具执行前的进度阶段；同一阶段连续调用只回调一次。 */
	readonly onToolProgress?: (event: ToolProgressEvent) => void;
	/** 深回合草稿整份替换后的快照；服务端用它发 SSE。 */
	readonly onDraftReplace?: (draft: TurnDraftSnapshot) => void;
	/** 运行开始后、第一次模型请求前的启动信息；快回合没有运行句柄。 */
	readonly onTurnStarted?: (started: TurnStartedInfo) => void;
	readonly now?: () => number;
}

export interface GenerateAssistantTurnOptions
	extends Omit<ChatTurnOptions, "userText"> {
	readonly userNodeId: string;
	/** 重新生成时被放弃的助手楼层；不设置时是普通生成，不写偏好记录。 */
	readonly swipeFromNodeId?: string | null;
	/**
	 * 重 roll 的原因；只与被放弃楼层一起使用。原因进入偏好信号的载荷、
	 * 写成一条长期有效的纠正，并作为本次重写的即时指示。
	 */
	readonly rerollReason?: RerollReason | null;
}

export interface RegenerateAssistantTurnOptions
	extends Omit<ChatTurnOptions, "userText"> {
	readonly assistantNodeId: string;
	/** 玩家给出的重 roll 原因；不填表示没有说明。 */
	readonly rerollReason?: RerollReason | null;
}

export interface ChatTurnResult {
	readonly userNode: TimelineNode;
	readonly node: TimelineNode;
	readonly stateDiffs: readonly StateDiff[];
	readonly plotNotes: readonly PlotNote[];
	readonly structured: StructuredOutputCollection;
	readonly blocks: readonly ParsedContent[];
	readonly reasoning: string;
	readonly trace: TurnTrace;
}

/** 正文里需要成对闭合的写入标签；续写与截断检测共用。 */
const WRITE_BLOCK_TAGS = ["state_update", "plot_note"] as const;

/**
 * 截断检测口径：未闭合的写入标签、没有以结束字符收尾的正文都算截断；
 * 以完整标签收尾的回复不算突然中断。
 */
const TRUNCATION_OPTIONS = {
	expectedTags: WRITE_BLOCK_TAGS,
	terminators: `${DEFAULT_TRUNCATION_TERMINATORS}>`,
	detectAbruptEnd: true,
} as const;

export interface ResolvedDeepTurnSettings {
	readonly maxToolCalls: number;
	readonly maxDurationMs: number;
	readonly contextTokenLimit: number;
	readonly recentToolSteps: number;
	/** 模板放开的工具名；null 表示注册表里的全部工具。 */
	readonly tools: readonly string[] | null;
	/** 是否放开导演手记；模板缺省为 true。 */
	readonly notesEnabled: boolean;
}

export interface ResolvedFastTurnMode {
	readonly mode: "fast";
	readonly maxReadRounds: number;
	readonly deep: null;
}

export interface ResolvedDeepTurnMode {
	readonly mode: "deep";
	/** 快回合的软上限；深回合不使用它。 */
	readonly maxReadRounds: number;
	readonly deep: ResolvedDeepTurnSettings;
}

export type ResolvedTurnMode = ResolvedFastTurnMode | ResolvedDeepTurnMode;

/**
 * 深回合在达到上限、超时或没有任何正文时结束，又没有提交草稿：
 * 运行记为失败，不写助手楼层，head 停在用户楼层。
 */
export class DeepTurnWithoutCommitError extends Error {
	readonly runId: string;
	readonly reason: ModelTurnResult["stopReason"];

	constructor(
		message: string,
		runId: string,
		reason: ModelTurnResult["stopReason"],
	) {
		super(message);
		this.name = "DeepTurnWithoutCommitError";
		this.runId = runId;
		this.reason = reason;
	}
}

/**
 * 模式与读取工具软上限的唯一解析口：单轮参数优先于故事设置。
 * 深回合只解析防失控上限；没有按任何运行状况切换模式的路径。
 * 服务端在写楼层之前调用它，配置非法时请求不会留下用户楼层。
 */
export function resolveTurnMode(
	store: StoryStore,
	storyId: string,
	requestedMode: TurnMode | null | undefined,
	requestedRounds: number | null | undefined,
): ResolvedTurnMode {
	const settings = store.getStorySettings(storyId);
	const mode = requestedMode ?? settings.turnMode;
	const maxReadRounds = requestedRounds ?? settings.maxReadRounds;
	assertMaxReadRounds(maxReadRounds, "读取工具软上限");
	if (mode === "fast") return { mode, maxReadRounds, deep: null };
	assertDeepMaxToolCalls(
		settings.deepMaxToolCalls,
		"故事设置的 deepMaxToolCalls",
	);
	assertDeepTimeoutMs(settings.deepTimeoutMs, "故事设置的 deepTimeoutMs");
	assertDeepContextTokenLimit(
		settings.deepContextTokenLimit,
		"故事设置的 deepContextTokenLimit",
	);
	assertDeepRecentToolSteps(
		settings.deepRecentToolSteps,
		"故事设置的 deepRecentToolSteps",
	);
	return {
		mode,
		maxReadRounds,
		deep: {
			maxToolCalls: settings.deepMaxToolCalls,
			maxDurationMs: settings.deepTimeoutMs,
			contextTokenLimit: settings.deepContextTokenLimit,
			recentToolSteps: settings.deepRecentToolSteps,
			tools: null,
			notesEnabled: true,
		},
	};
}

/**
 * 模板里的深回合配置覆盖故事设置，故事设置覆盖默认值。
 * 快回合忽略 deepTurn，模板缺省的字段保持解析出的故事设置。
 */
function applyTemplateDeepTurn(
	template: ContextTemplate,
	resolved: ResolvedTurnMode,
): ResolvedTurnMode {
	const config = template.deepTurn;
	if (resolved.mode !== "deep" || config === undefined) return resolved;
	return {
		...resolved,
		deep: {
			...resolved.deep,
			maxToolCalls: config.maxToolCalls ?? resolved.deep.maxToolCalls,
			maxDurationMs: config.maxDurationMs ?? resolved.deep.maxDurationMs,
			tools: config.tools ?? null,
			notesEnabled: config.notesEnabled ?? true,
		},
	};
}

/**
 * 深回合只暴露模板放开的工具；手记关闭时两个手记工具一并排除，
 * 名单之外的工具调用由执行器按未知工具拒绝并记录。
 */
function selectDeepTurnTools(
	deep: ResolvedDeepTurnSettings,
): readonly DeepToolDefinition[] {
	const whitelist = deep.tools === null ? null : new Set(deep.tools);
	return DEEP_TURN_TOOLS.tools.filter(
		(tool) =>
			(whitelist === null || whitelist.has(tool.name)) &&
			(deep.notesEnabled ||
				(tool.name !== NOTE_READ_TOOL_NAME &&
					tool.name !== NOTE_WRITE_TOOL_NAME)),
	);
}

/**
 * 单轮强度与推进档位覆盖导演槽位上的值。槽位携带了评估用的配置与机制，
 * 这里只重建导演槽位与跟随它的重逢槽位，其它槽位原样复用。
 */
function resolveTurnProviders(options: {
	readonly store: StoryStore;
	readonly providers?: ContextSlotProviders;
	readonly directorIntensity?: DirectorIntensity | null;
	readonly directorPush?: DirectorPush | null;
}): ContextSlotProviders | undefined {
	const requestedIntensity = options.directorIntensity ?? null;
	const requestedPush = options.directorPush ?? null;
	if (requestedIntensity === null && requestedPush === null) {
		return options.providers;
	}
	const director = options.providers?.director;
	if (director === undefined) {
		throw new Error("指定了单轮导演参数，但上下文槽位里没有导演槽位");
	}
	if (!isDirectorSlotProvider(director)) {
		throw new Error("指定了单轮导演参数，但导演槽位没有携带配置");
	}
	const reunion = options.providers?.reunion;
	const reunionOverride =
		requestedPush !== null &&
		reunion !== undefined &&
		isReunionSlotProvider(reunion)
			? {
					reunion: {
						...createReunionSlotProvider(options.store, {
							...reunion.options,
							directorPush: requestedPush,
						}),
						...(reunion.plugin === undefined ? {} : { plugin: reunion.plugin }),
					},
				}
			: {};
	return {
		...options.providers,
		director: {
			...createDirectorSlotProvider(options.store, {
				config:
					requestedIntensity === null
						? director.config
						: resolveDirectorIntensity(director.config, requestedIntensity),
				engine: director.engine,
				push: requestedPush ?? director.push,
				...(director.when === null ? {} : { when: director.when }),
			}),
			...(director.plugin === undefined ? {} : { plugin: director.plugin }),
		},
		...reunionOverride,
	};
}

interface ExtraContextEntry {
	/** 写进上下文构成的来源，例如 `writing:写作选项`。 */
	readonly source: string;
	readonly text: string;
}

/**
 * 组装之后追加的系统消息（写作要求、准备阶段、自查清单、工作区说明）
 * 同样是模型看到的上下文；按条目补进 Trace，才能在本轮上下文里读到。
 */
function withExtraContextEntries(
	trace: ContextTrace,
	extras: readonly ExtraContextEntry[],
): ContextTrace {
	if (extras.length === 0) return trace;
	const estimator = createTokenEstimator();
	const entries: ContextTraceEntry[] = extras.map((extra) => ({
		segmentId: extra.source,
		kind: "static",
		slot: null,
		source: extra.source,
		priority: 0,
		tokens: estimator(extra.text),
		status: "included",
	}));
	const addedTokens = entries.reduce((sum, entry) => sum + entry.tokens, 0);
	return {
		budgetTokens: trace.budgetTokens,
		totalTokens: trace.totalTokens + addedTokens,
		entries: [...trace.entries, ...entries],
	};
}

/**
 * 单轮生成：追加用户楼层，组装上下文，流式生成并解析块，
 * 把回复、状态 diff 与 Trace 一起写进楼层树。
 */
export async function runChatTurn(
	options: ChatTurnOptions,
): Promise<ChatTurnResult> {
	if (typeof options.userText !== "string" || options.userText.length === 0) {
		throw new Error("用户消息必须是非空字符串");
	}
	if (!Number.isInteger(options.budgetTokens) || options.budgetTokens < 0) {
		throw new Error("token 预算必须是非负整数");
	}
	if (!options.store.getStory(options.storyId)) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const resolved = resolveTurnMode(
		options.store,
		options.storyId,
		options.turnMode,
		options.maxReadRounds,
	);
	const providers = resolveTurnProviders(options);
	const head = options.store.getHead(options.storyId);

	const userNode = options.store.appendNode({
		storyId: options.storyId,
		parentId: head?.id ?? null,
		role: "user",
		raw: options.userText,
	});
	return generateAssistantTurn({
		...options,
		providers,
		directorIntensity: null,
		// 导演槽位已经按这一轮的档位重建；推进档位还要给规划准备用，
		// 生成过程本身不再按它重建槽位。
		directorPush: options.directorPush ?? null,
		userNodeId: userNode.id,
		turnMode: resolved.mode,
		maxReadRounds: resolved.maxReadRounds,
	});
}

/**
 * 基于一个已存在的用户楼层生成助手回复：不追加用户楼层，
 * 新回复作为该用户楼层的子节点写入，并把 head 移过去。
 */
export async function generateAssistantTurn(
	options: GenerateAssistantTurnOptions,
): Promise<ChatTurnResult> {
	if (!Number.isInteger(options.budgetTokens) || options.budgetTokens < 0) {
		throw new Error("token 预算必须是非负整数");
	}
	if (!options.store.getStory(options.storyId)) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const userNode = options.store.getNode(options.userNodeId);
	if (!userNode) {
		throw new Error(`用户楼层不存在：${options.userNodeId}`);
	}
	if (userNode.storyId !== options.storyId) {
		throw new Error(
			`用户楼层 ${userNode.id} 属于另一个故事 ${userNode.storyId}`,
		);
	}
	if (userNode.role !== "user") {
		throw new Error(
			`助手楼层需要以用户楼层为父节点：${userNode.id} 的角色是 ${userNode.role}`,
		);
	}
	const rerollReason =
		options.rerollReason === undefined || options.rerollReason === null
			? null
			: assertRerollReason(options.rerollReason);
	if (rerollReason !== null && !options.swipeFromNodeId) {
		throw new Error("重 roll 的原因只用于重新生成，普通生成不能带原因");
	}
	const resolved = applyTemplateDeepTurn(
		options.template,
		resolveTurnMode(
			options.store,
			options.storyId,
			options.turnMode,
			options.maxReadRounds,
		),
	);
	const profile = options.profile ?? DEFAULT_CHAT_PROFILE;
	assertChatProfile(profile);
	if (options.hookBudgetMs !== undefined) {
		assertTurnHookBudgetMs(options.hookBudgetMs);
	}
	const writesLedger = profile === "native";
	const now = options.now ?? Date.now;
	const providers = resolveTurnProviders(options);
	const fingerprint = contextPackFingerprint({
		template: options.template,
		budgetTokens: options.budgetTokens,
		profile,
		directorIntensity: options.directorIntensity ?? null,
		providers,
	});
	const cached = loadReusableContextPack(
		options.store,
		options.storyId,
		userNode.id,
		fingerprint,
	);
	const assembled =
		cached ??
		(await assembleContext({
			template: options.template,
			budgetTokens: options.budgetTokens,
			storyId: options.storyId,
			nodeId: userNode.id,
			providers,
			hookBudgetMs: options.hookBudgetMs,
		}));
	const slotHooks = assembled.hooks ?? [];
	// 跳过的提供者按缺失处理，缺了槽位的包不能被后续回合复用。
	const slotsSkipped = slotHooks.some((hook) => hook.outcome === "timeout");
	if (cached === null && !slotsSkipped) {
		saveContextPack(options.store, {
			storyId: options.storyId,
			nodeId: userNode.id,
			fingerprint,
			assembled,
		});
	}
	const rewritten =
		options.requestRewriter === undefined || options.requestRewriter === null
			? { messages: assembled.messages, hooks: [] }
			: await options.requestRewriter.rewriteRequest(
					assembled.messages,
					options.hookBudgetMs,
				);
	const turnHooks = [...slotHooks, ...rewritten.hooks];

	const startedAt = now();
	const functionCall =
		writesLedger && options.structuredOutput === "function-call";
	const transport = assertToolTransport(options.toolTransport ?? "native");
	const illustrateTool = writesLedger
		? resolveIllustrateTool(options.store, options.illustrate)
		: null;
	const exposeReadTools =
		resolved.mode === "deep"
			? writesLedger
			: writesLedger &&
				(functionCall || transport === "text") &&
				readStoryFeatureState(options.store, options.storyId).values.tools ===
					true;
	const declaredRuleCount =
		writesLedger &&
		readStoryFeatureState(options.store, options.storyId).values.rules === true
			? options.store.listStoryRules(options.storyId).length
			: 0;
	const readTools = exposeReadTools
		? (resolved.mode === "deep"
				? selectDeepTurnTools(resolved.deep)
				: FAST_TURN_TOOLS.tools
			).filter(
				(tool) => tool.name !== RULE_CHECK_TOOL_NAME || declaredRuleCount > 0,
			)
		: [];
	const tools =
		readTools.length === 0 && illustrateTool === null
			? undefined
			: [...readTools, ...(illustrateTool === null ? [] : [illustrateTool])];
	const advertiseDisabled = tools !== undefined || transport === "text";
	const disabledTools = [
		...(illustrateTool === null && advertiseDisabled ? [ILLUSTRATE_TOOL] : []),
		...(advertiseDisabled && !(exposeReadTools && declaredRuleCount > 0)
			? [
					{
						...RULE_CHECK_TOOL,
						disabledReason:
							declaredRuleCount === 0 ? "卡没有声明规则" : "本回合没有开放工具",
					},
				]
			: []),
	];
	// 运行表只记录深回合；快回合保持现有 Trace 语义，不写运行行。
	const runId =
		resolved.mode === "deep"
			? options.store.startTurnRun({
					storyId: options.storyId,
					userNodeId: userNode.id,
					mode: "deep",
				}).runId
			: null;
	const onRunEvent =
		runId === null
			? undefined
			: (event: TurnRunEventInput): void => {
					options.store.appendTurnRunEvent({ runId, ...event });
				};
	const draft =
		resolved.mode === "deep"
			? new TurnDraftController({
					onReplace: (snapshot) => {
						onRunEvent?.({
							kind: "draft.replace",
							payload: {
								version: snapshot.version,
								textLength: snapshot.text.length,
							},
						});
						options.onDraftReplace?.(snapshot);
					},
					onCommit: (snapshot, method) => {
						onRunEvent?.({
							kind: "draft.commit",
							payload: {
								version: snapshot.version,
								textLength: snapshot.text.length,
								method,
							},
						});
					},
				})
			: null;
	const notes =
		resolved.mode === "deep" && resolved.deep.notesEnabled
			? new TurnNoteController()
			: null;
	const guidance =
		resolved.mode === "deep"
			? new TurnGuidanceController(runId as string, (text) => {
					onRunEvent?.({
						kind: "steering",
						payload: { textLength: text.length },
					});
				})
			: null;
	options.onTurnStarted?.({
		runId,
		handle:
			guidance === null
				? null
				: {
						runId: guidance.runId,
						pushGuidance: (text) => guidance.push(text),
					},
	});
	// 深回合在组装后的消息之后注入手记；快回合不注入。
	const notedBase =
		notes === null
			? rewritten.messages
			: withDirectorNotes(options.store, rewritten.messages, userNode.id);
	// 写作选项紧贴生成位置：玩家改了选项，下一楼的上下文就不一样。
	// 朴素基线（B0）保持原样上下文，不加写作要求。
	const writing = writesLedger
		? formatWritingDials(options.store, userNode.storyId)
		: null;
	const extra: LlmMessage[] = [];
	const extraTrace: ExtraContextEntry[] = [];
	const appendExtra = (source: string, content: string): void => {
		extra.push({ role: "system", content });
		extraTrace.push({ source, text: content });
	};
	if (writing !== null) appendExtra("writing:写作选项", writing);
	// 规划写法：固定的准备阶段先理清材料，再交给同一次正文调用。
	// 间隙里已经备好时直接用，回合内不再有准备调用。
	let planTrace: PlanTurnTrace | null = null;
	if (
		resolved.mode === "fast" &&
		writesLedger &&
		isPlanWritingMode(options.store, options.storyId)
	) {
		const anchorNodeId = userNode.parentId ?? userNode.id;
		const progress = (phase: string, detail: string): void =>
			options.onToolProgress?.({ type: "progress", phase, detail });
		let preparation = isPlanPrepareEnabled(options.store, options.storyId)
			? readPreparedPlan(
					options.store,
					options.storyId,
					anchorNodeId,
					userNode.raw,
					options.directorPush ?? null,
				)
			: null;
		if (preparation !== null) {
			for (const name of PLAN_PREP_PHASES) progress(name, "");
		} else {
			preparation = await runPlanPhases({
				store: options.store,
				client: options.client,
				storyId: options.storyId,
				anchorNodeId,
				playerMessage: userNode.raw,
				push: options.directorPush ?? null,
				signal: options.signal,
				onProgress: progress,
			});
		}
		planTrace = preparation.trace;
		if (preparation.text !== "") {
			appendExtra("plan:本轮准备", preparation.text);
		}
	}
	// 深度写法：程序生成的自查清单交给模型，交稿前逐项核对草稿。
	if (resolved.mode === "deep") {
		const checks = buildSelfCheckList(
			options.store,
			options.storyId,
			userNode.id,
		);
		const checklist = formatSelfCheckList(checks);
		if (checklist !== null) {
			appendExtra("deep:自查清单", checklist);
			for (const item of checks) {
				options.onToolProgress?.({
					type: "progress",
					phase: "自查清单",
					detail: item.length > 60 ? `${item.slice(0, 60)}…` : item,
				});
			}
		}
		appendExtra(
			"deep:工作区说明",
			formatWorkspaceGuide({
				store: options.store,
				storyId: options.storyId,
				anchorNodeId: userNode.id,
				draft,
				notes,
			}),
		);
	}
	const noted: readonly LlmMessage[] =
		extra.length === 0 ? notedBase : [...notedBase, ...extra];
	const contextTrace = withExtraContextEntries(assembled.trace, extraTrace);
	// 重 roll 的即时指示紧贴生成位置，排在历史与导演之后。
	const messages =
		rerollReason === null
			? noted
			: [
					...noted,
					{
						role: "system" as const,
						content: formatRerollCorrection(rerollReason),
					},
				];
	const turnOptions = {
		client: options.client,
		messages,
		structuredTools: functionCall ? STRUCTURED_OUTPUT_TOOLS : undefined,
		tools,
		disabledTools,
		toolTransport: transport,
		toolContext: {
			store: options.store,
			storyId: options.storyId,
			beforeNodeId: userNode.id,
			embedder: options.embedder ?? null,
			reranker: options.reranker ?? null,
			viewpoint: options.viewpoint ?? null,
			notes,
			draft,
		},
		model: options.model,
		maxTokens: options.maxTokens,
		temperature: options.temperature,
		seed: options.seed,
		reasoning: options.reasoning,
		signal: options.signal,
		continuation: {
			expectedTags: WRITE_BLOCK_TAGS,
			continueOn: ["length", "unclosed_tag"],
		},
		onTextDelta: options.onTextDelta,
		onThinkingDelta: options.onThinkingDelta,
		onToolCall: options.onToolCall,
		onToolProgress: options.onToolProgress,
		onRunEvent,
		draft,
		notes,
		guidance,
		now,
	} as const;
	let turn: ModelTurnResult;
	let deepTurn: DeepTurnResult | null = null;
	try {
		if (resolved.mode === "deep") {
			deepTurn = await runDeepTurn({
				...turnOptions,
				maxToolCalls: resolved.deep.maxToolCalls,
				maxDurationMs: resolved.deep.maxDurationMs,
				contextTokenLimit: resolved.deep.contextTokenLimit,
				recentToolSteps: resolved.deep.recentToolSteps,
			});
			turn = deepTurn.turn;
		} else {
			turn = await runModelTurns({
				...turnOptions,
				maxReadRounds: resolved.maxReadRounds,
			});
		}
	} catch (error) {
		if (runId !== null) {
			options.store.appendTurnRunEvent({
				runId,
				kind: "error",
				payload: { message: describeRunError(error) },
			});
			options.store.finishTurnRun({
				runId,
				status: error instanceof TurnAbortedError ? "aborted" : "failed",
			});
			guidance?.close();
		}
		if (resolved.mode === "deep") throw error;
		if (
			error instanceof TurnAbortedError &&
			error.partialText.trim().length > 0
		) {
			return persistAbortedTurn({
				options,
				userNode,
				contextTrace,
				hooks: turnHooks,
				startedAt,
				error,
				now,
				mode: resolved,
				profile,
				transport,
				runId: null,
			});
		}
		throw error;
	}
	const result = turn.result;
	const completedAt = now();
	const completion = resolveTurnBody({
		mode: resolved.mode,
		draft,
		turn,
	});
	if (completion.text === null) {
		const message = describeMissingCommit(turn.stopReason);
		const failedRunId = runId as string;
		options.store.appendTurnRunEvent({
			runId: failedRunId,
			kind: "error",
			payload: { message, reason: turn.stopReason },
		});
		options.store.finishTurnRun({ runId: failedRunId, status: "failed" });
		guidance?.close();
		throw new DeepTurnWithoutCommitError(message, failedRunId, turn.stopReason);
	}
	const finalText = completion.text;
	const blocks =
		finalText === result.text ? turn.blocks : parseBlocks(finalText);
	const truncations = detectTruncations(
		{ text: finalText, stopReason: result.stopReason },
		TRUNCATION_OPTIONS,
	);

	const structured = !writesLedger
		? emptyStructuredCollection(options.structuredOutput)
		: withProposedStateUpdates(
				functionCall
					? collectStructuredOutputFromToolCalls(turn.toolCalls)
					: collectStructuredOutputFromText(finalText),
				turn.proposedStateUpdates,
			);

	return await options.store.runInTransaction(() => {
		const node = options.store.appendNode({
			storyId: options.storyId,
			parentId: userNode.id,
			role: "assistant",
			raw: finalText,
		});
		recordRegeneratedSwipe(options, node);
		recordRerollReasonWill(options, node, userNode, writesLedger);
		if (notes !== null && notes.pending.length > 0) {
			options.store.saveDirectorNotes({
				storyId: options.storyId,
				nodeId: node.id,
				diffs: notes.pending,
			});
		}
		const savedDiffs = writesLedger
			? options.store.appendStateDiffs(
					toNewStateDiffs(options.storyId, node.id, structured.stateUpdates),
				)
			: [];
		const plotNotes = writesLedger
			? options.store.insertPlotNotes(
					structured.notes.map((note) => ({
						storyId: options.storyId,
						sourceNodeId: node.id,
						text: note.text,
					})),
				)
			: [];
		const imageResult = writesLedger
			? applyIllustrateCalls({
					store: options.store,
					storyId: options.storyId,
					nodeId: node.id,
					calls: turn.toolCalls,
					options: options.illustrate,
				})
			: { accepted: 0, rejected: [], calls: [] };
		guidance?.close();
		const runTrace = finishRunWithTrace(
			options.store,
			runId,
			"completed",
			node.id,
		);
		const trace: TurnTrace = {
			storyId: options.storyId,
			nodeId: node.id,
			parentNodeId: userNode.id,
			templateId: options.template.id,
			turnMode: resolved.mode,
			...(planTrace === null ? {} : { plan: planTrace }),
			profile,
			rerollReason,
			createdAt: node.createdAt,
			context: contextTrace,
			layout: detectContextLayout(options.template),
			segmentOrder: contextTrace.entries.map((entry) => entry.segmentId),
			llm: {
				role: "writer",
				model: result.model,
				channel: result.channel,
				stopReason: result.stopReason,
				finishReason: result.finishReason,
				truncations,
				usage: turn.usage,
				attempts: turn.attempts,
				rounds: turn.modelRounds,
				cached: turn.cached,
			},
			cache: cacheTraceFromUsage(turn.usage),
			tools: {
				transport,
				rounds: turn.rounds,
				maxRounds: resolved.maxReadRounds,
				capped: turn.capped,
				calls: [
					...turn.calls
						.filter((call) => call.name !== "illustrate")
						.map((call) => ({
							name: call.name,
							ok: call.ok,
							error: call.error,
							permission: call.permission,
						})),
					...imageResult.calls.map((call) => ({
						...call,
						permission: "side_effect" as const,
					})),
				],
				rejected: turn.rejected.map((rejection) => ({
					name: rejection.name,
					reason: rejection.reason,
				})),
			},
			images: {
				accepted: imageResult.accepted,
				rejected: imageResult.rejected,
			},
			structured: {
				mode: structured.mode,
				acceptedStateUpdates: structured.stateUpdates.length,
				acceptedNotes: structured.notes.length,
				issues: structured.issues,
			},
			timing: {
				firstTokenMs: turn.firstTokenMs,
				durationMs: completedAt - startedAt,
			},
			deep:
				deepTurn === null
					? null
					: {
							maxToolCalls: deepTurn.maxToolCalls,
							maxDurationMs: deepTurn.maxDurationMs,
							toolCallCount: deepTurn.toolCallCount,
							durationMs: deepTurn.durationMs,
							stopReason: deepTurn.stopReason,
							commit: draft?.commitMethod ?? "none",
							drift: completion.drift,
							contextOmitted: deepTurn.contextOmitted ?? undefined,
						},
			run: runTrace,
			...(turnHooks.length === 0 ? {} : { hooks: turnHooks }),
		};
		options.store.saveTurnTrace(trace);
		return {
			userNode,
			node,
			stateDiffs: savedDiffs,
			plotNotes,
			structured,
			blocks,
			reasoning: result.reasoning,
			trace,
		};
	});
}

/**
 * 重新生成一条助手回复：以原回复的父用户楼层为输入，
 * 在父节点下新建助手兄弟节点并把 head 移过去；旧回复与旧 Trace 保持不变。
 */
export async function regenerateAssistantTurn(
	options: RegenerateAssistantTurnOptions,
): Promise<ChatTurnResult> {
	if (!options.store.getStory(options.storyId)) {
		throw new Error(`故事不存在：${options.storyId}`);
	}
	const assistantNode = options.store.getNode(options.assistantNodeId);
	if (!assistantNode) {
		throw new Error(`助手楼层不存在：${options.assistantNodeId}`);
	}
	if (assistantNode.storyId !== options.storyId) {
		throw new Error(
			`助手楼层 ${assistantNode.id} 属于另一个故事 ${assistantNode.storyId}`,
		);
	}
	if (assistantNode.role !== "assistant") {
		throw new Error(
			`只能重新生成助手楼层：${assistantNode.id} 的角色是 ${assistantNode.role}`,
		);
	}
	if (assistantNode.parentId === null) {
		throw new Error(`助手楼层没有父用户楼层：${assistantNode.id}`);
	}
	return generateAssistantTurn({
		...options,
		userNodeId: assistantNode.parentId,
		swipeFromNodeId: assistantNode.id,
	});
}

/**
 * 重新生成写出新楼层时补一条 swipe 偏好；与楼层写入同一事务，
 * 中止后保存了部分正文的楼层同样记录。普通生成不传来源，只写楼层。
 */
function recordRegeneratedSwipe(
	options: GenerateAssistantTurnOptions,
	node: TimelineNode,
): void {
	const abandonedNodeId = options.swipeFromNodeId;
	if (abandonedNodeId === undefined || abandonedNodeId === null) return;
	const reason =
		options.rerollReason === undefined || options.rerollReason === null
			? null
			: assertRerollReason(options.rerollReason);
	options.store.recordPreference({
		storyId: options.storyId,
		nodeId: node.id,
		kind: "swipe",
		payload: {
			abandonedNodeId,
			acceptedNodeId: node.id,
			...(reason === null ? {} : { reason }),
		},
		createdAt: node.createdAt,
	});
}

/** 重 roll 的原因写成长期有效的纠正；没有原因或本档不写台账时不写。 */
function recordRerollReasonWill(
	options: GenerateAssistantTurnOptions,
	node: TimelineNode,
	userNode: TimelineNode,
	writesLedger: boolean,
): void {
	if (!writesLedger) return;
	const reason = options.rerollReason;
	if (reason === undefined || reason === null) return;
	applyRerollReasonWill({
		store: options.store,
		storyId: options.storyId,
		nodeId: node.id,
		sourceNodeId: userNode.id,
		reason,
		createdAt: node.createdAt,
	});
}

/** 深回合开始前把沿当前路径累加的手记作为系统消息追加到上下文之后。 */
function withDirectorNotes(
	store: StoryStore,
	messages: readonly LlmMessage[],
	nodeId: string,
): readonly LlmMessage[] {
	const entries = store.readDirectorNoteEntries(nodeId);
	if (entries.length === 0) return messages;
	return [
		...messages,
		{ role: "system", content: formatDirectorNotes(entries) },
	];
}

/** 运行结束却没有提交草稿时的原因。 */
function describeMissingCommit(reason: ModelTurnResult["stopReason"]): string {
	if (reason === "timeout") return "深回合超过时长上限，没有提交草稿";
	if (reason === "max_tool_calls") {
		return "深回合达到工具调用上限，没有提交草稿";
	}
	return "模型没有生成正文，运行没有提交草稿";
}

/**
 * 运行结束后的楼层正文：显式提交用草稿；正常结束但没有提交时，
 * 把最后一次输出当作草稿自动提交并记漂移；达到上限、超时或没有正文
 * 且没有提交时返回 null，调用方不写助手楼层。
 */
function resolveTurnBody(input: {
	readonly mode: TurnMode;
	readonly draft: TurnDraftController | null;
	readonly turn: ModelTurnResult;
}): { readonly text: string | null; readonly drift: "missing_commit" | null } {
	if (input.mode !== "deep") {
		return { text: input.turn.result.text, drift: null };
	}
	const draft = input.draft;
	if (draft === null) throw new Error("深回合缺少草稿控制器");
	if (draft.committed) return { text: draft.text, drift: null };
	if (input.turn.stopReason !== "completed") {
		return { text: null, drift: null };
	}
	const body = input.turn.result.text;
	if (body.trim().length > 0 && body !== draft.text) draft.replace(body);
	if (draft.version > 0) {
		draft.commit("auto");
		return { text: draft.text, drift: "missing_commit" };
	}
	return { text: null, drift: null };
}

/** 中止时保存已经生成的部分正文；没有正文时不创建楼层。 */
async function persistAbortedTurn(input: {
	readonly options: GenerateAssistantTurnOptions;
	readonly userNode: TimelineNode;
	readonly contextTrace: ContextTrace;
	readonly hooks: readonly TurnHookTraceEntry[];
	readonly startedAt: number;
	readonly error: TurnAbortedError;
	readonly now: () => number;
	readonly mode: ResolvedTurnMode;
	readonly profile: ChatProfile;
	readonly transport: LlmToolTransport;
	/** 深回合的运行 id；快回合为 null。 */
	readonly runId: string | null;
}): Promise<ChatTurnResult> {
	const { options, userNode, contextTrace, error } = input;
	const completedAt = input.now();
	return await options.store.runInTransaction(() => {
		const node = options.store.appendNode({
			storyId: options.storyId,
			parentId: userNode.id,
			role: "assistant",
			raw: error.partialText,
		});
		recordRegeneratedSwipe(options, node);
		recordRerollReasonWill(options, node, userNode, input.profile === "native");
		const runTrace = finishRunWithTrace(
			options.store,
			input.runId,
			"aborted",
			node.id,
		);
		const trace: TurnTrace = {
			storyId: options.storyId,
			nodeId: node.id,
			parentNodeId: userNode.id,
			templateId: options.template.id,
			turnMode: input.mode.mode,
			profile: input.profile,
			rerollReason: options.rerollReason ?? null,
			createdAt: node.createdAt,
			context: contextTrace,
			layout: detectContextLayout(options.template),
			segmentOrder: contextTrace.entries.map((entry) => entry.segmentId),
			llm: {
				role: "writer",
				model: options.model ?? "unknown",
				channel: null,
				stopReason: "aborted",
				finishReason: null,
				truncations: [],
				usage: emptyUsage(),
				attempts: 0,
				rounds: 0,
				cached: false,
			},
			cache: cacheTraceFromUsage(emptyUsage()),
			tools: {
				transport: input.transport,
				rounds: 0,
				maxRounds: input.mode.maxReadRounds,
				capped: false,
				calls: [],
				rejected: [],
			},
			structured: {
				mode: options.structuredOutput,
				acceptedStateUpdates: 0,
				acceptedNotes: 0,
				issues: [],
			},
			timing: {
				firstTokenMs: error.firstTokenMs,
				durationMs: completedAt - input.startedAt,
			},
			deep:
				input.mode.deep === null
					? null
					: {
							maxToolCalls: input.mode.deep.maxToolCalls,
							maxDurationMs: input.mode.deep.maxDurationMs,
							toolCallCount: error.toolCallCount,
							durationMs: completedAt - input.startedAt,
							stopReason: "aborted",
							commit: "none",
							drift: null,
						},
			run: runTrace,
			...(input.hooks.length === 0 ? {} : { hooks: input.hooks }),
		};
		options.store.saveTurnTrace(trace);
		return {
			userNode,
			node,
			stateDiffs: [],
			plotNotes: [],
			structured: {
				mode: options.structuredOutput,
				stateUpdates: [],
				notes: [],
				issues: [],
			},
			blocks: parseBlocks(error.partialText),
			reasoning: error.partialReasoning,
			trace,
		};
	});
}

function emptyUsage(): LlmUsage {
	return {
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		reasoningTokens: null,
		cachedTokens: null,
	};
}

/** 结束运行并把最终状态与事件条数写进 Trace；快回合没有运行行。 */
function finishRunWithTrace(
	store: StoryStore,
	runId: string | null,
	status: TurnRunFinalStatus,
	nodeId: string,
): TurnTraceRun | null {
	if (runId === null) return null;
	const run = store.finishTurnRun({ runId, status, nodeId });
	return {
		runId: run.runId,
		status: run.status,
		eventCount: store.countTurnRunEvents(run.runId),
	};
}

function describeRunError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

/** 朴素模式不收集结构化写入，返回与请求模式一致的空集合。 */
function emptyStructuredCollection(
	mode: StructuredOutputMode,
): StructuredOutputCollection {
	return { mode, stateUpdates: [], notes: [], issues: [] };
}

/** 工具收集的台账写入与标签或函数调用的结构化写入合并，提交时一起写入。 */
function withProposedStateUpdates(
	structured: StructuredOutputCollection,
	proposed: readonly AcceptedStateUpdate[],
): StructuredOutputCollection {
	if (proposed.length === 0) return structured;
	return {
		...structured,
		stateUpdates: [...structured.stateUpdates, ...proposed],
	};
}

function toNewStateDiffs(
	storyId: string,
	nodeId: string,
	updates: readonly AcceptedStateUpdate[],
): NewStateDiff[] {
	return updates.map((update) => {
		const common = {
			storyId,
			nodeId,
			path: update.path,
			reason: update.reason,
			source: "model",
			storyTime: update.storyTime ?? null,
			confidence: update.confidence ?? null,
		};
		return update.op === "set"
			? { ...common, op: "set", value: update.value }
			: { ...common, op: "delete" };
	});
}

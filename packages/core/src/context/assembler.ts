import type { HistoryViewTrace } from "../blocks/history.js";
import type { DirectorPush } from "../director/lines.js";
import {
	type TurnHookBudget,
	type TurnHookTraceEntry,
	runTurnHook,
} from "../plugins/turn-hooks.js";
import type {
	RetrievalHit,
	RetrievalRouteRanking,
} from "../retrieval/hybrid.js";
import type { FeatureSwitchOverrides } from "../settings/features.js";
import { type TokenEstimator, createTokenEstimator } from "../tokens.js";
import {
	type ContextConditionFacts,
	type ContextMessage,
	type ContextSegment,
	type ContextSlotName,
	type ContextTemplate,
	assertContextTemplate,
	evaluateContextCondition,
} from "./template.js";

export interface ContextSlotRequest {
	readonly slot: ContextSlotName;
	readonly storyId: string;
	readonly nodeId: string | null;
	readonly switches: Readonly<Record<string, boolean>>;
	readonly state: unknown;
	/** 本回合组装上下文的总 token 预算；提供者据此判断内容是否还放得下。 */
	readonly budgetTokens?: number;
	/** 插件槽位的时间预算；提供者按剩余时间决定做到哪里，模板执行记进 Trace。 */
	readonly budget?: TurnHookBudget;
	/** 本轮临时开关；提供者读功能开关时叠在故事设置上（DESIGN §22）。 */
	readonly featureOverrides?: FeatureSwitchOverrides;
	/** 这一轮玩家是否按了推进；原著窗口据此决定要不要给「接下来」几件。 */
	readonly directorPush?: DirectorPush | null;
}

/** 槽位内容里需要随上下文包复核的引用。 */
export interface ContextSlotReferences {
	/** 实际注入的世界书条目 id；被删除后旧包不再复用。 */
	readonly loreEntryIds?: readonly string[];
	/** 实际注入的现场分析所在楼层；不在当前路径上时旧包不再复用。 */
	readonly sceneAnalysisNodeId?: string | null;
}

export interface ContextSlotContent {
	readonly messages: readonly ContextMessage[];
	/**
	 * 追加到最后一条 user 消息末尾的文本，不产生独立消息。
	 * 预算按 suffix 自己的 token 计算，裁剪时整段一起丢弃；原文不改写。
	 */
	readonly suffix?: string;
	/** 写进 Trace 的来源描述，例如"世界书：2 条常驻、3 条检索"。 */
	readonly source: string;
	/** 这一类内容逐条的来源对象；没有逐条来源的槽位不产生这个字段。 */
	readonly items?: readonly ContextTraceItem[];
	/** 历史槽位的块视图统计；其它槽位不产生这个字段。 */
	readonly history?: HistoryViewTrace;
	/** 记忆检索的每一路名次、融合结果与实际注入的楼层。 */
	readonly retrieval?: ContextRetrievalTrace;
	/** 上下文包需要复核的引用；没有引用的槽位不产生这个字段。 */
	readonly references?: ContextSlotReferences;
}

/**
 * 上下文里一条内容的来源对象。`id` 能直接定位到设定、记录、百科页或状态项；
 * 原文楼、场次与摘要各有自己的定位方式。
 */
export type ContextItemSource =
	| { readonly kind: "lore"; readonly id: string; readonly name: string }
	| {
			readonly kind: "record";
			readonly ids: readonly string[];
			readonly nodeId: string;
			readonly floorNo: number;
	  }
	| { readonly kind: "wiki"; readonly id: string; readonly name: string }
	| { readonly kind: "state"; readonly target: string; readonly label: string }
	| {
			readonly kind: "floor";
			readonly nodeId: string;
			readonly floorNo: number;
	  }
	| { readonly kind: "scene"; readonly nodeId: string }
	| { readonly kind: "summary"; readonly id: string }
	| { readonly kind: "pref"; readonly id: string }
	| { readonly kind: "card"; readonly id: "character" | "persona" }
	| { readonly kind: "outline"; readonly id: string }
	| { readonly kind: "slot"; readonly slot: ContextSlotName }
	| { readonly kind: "segment"; readonly segmentId: string }
	| {
			readonly kind: "canon";
			readonly bookId: string;
			readonly eventId: number;
			readonly chapterOrdinal: number;
	  };

/** 上下文里一条可单独定位的内容；tokens 由槽位提供者估算。 */
export interface ContextTraceItem {
	readonly label: string;
	readonly tokens: number;
	readonly source: ContextItemSource;
}

/** 一次注入的范围：父段只包含楼层的一部分，整楼是整层原文。 */
export type RetrievalInjectionScope = "segment" | "floor";

export interface RetrievalInjectionTrace {
	readonly nodeId: string;
	readonly kind: RetrievalHit["kind"];
	readonly scope: RetrievalInjectionScope;
	readonly parentOrdinal: number | null;
}

/** 记忆槽位的检索记录：每一路的原始名次、RRF 融合结果与最终进入上下文的楼层。 */
export interface ContextRetrievalTrace {
	readonly routes: readonly RetrievalRouteRanking[];
	readonly hits: readonly RetrievalHit[];
	/** 实际写进上下文消息的楼层 id，按注入顺序；可能少于 `hits`。 */
	readonly injectedNodeIds: readonly string[];
	/** 每次注入的范围；旧 Trace 没有这个字段。 */
	readonly injected?: readonly RetrievalInjectionTrace[];
}

export interface ContextSlotProvider {
	/**
	 * 上下文包复用时的配置指纹；同一槽位换配置后旧包不再复用。
	 * 不声明时只按槽位名区分。
	 */
	readonly packKey?: string;
	/**
	 * 注册该提供者的插件名；由收集内核槽位的调用方填入。
	 * 直接构造提供者的调用方不填，组装时不做计时也不跳过。
	 */
	readonly plugin?: string;
	provide(
		request: ContextSlotRequest,
	): ContextSlotContent | null | PromiseLike<ContextSlotContent | null>;
}

export type ContextSlotProviders = Readonly<
	Partial<Record<ContextSlotName, ContextSlotProvider>>
>;

export interface ContextAssemblyInput {
	readonly template: ContextTemplate;
	readonly budgetTokens: number;
	readonly storyId: string;
	readonly nodeId?: string | null;
	readonly switches?: Readonly<Record<string, boolean>>;
	readonly state?: unknown;
	readonly providers?: ContextSlotProviders;
	readonly tokenEstimator?: TokenEstimator;
	/** 每个槽位提供者的时间预算；不设置时使用默认值。 */
	readonly hookBudgetMs?: number;
	/** 本轮临时开关，原样交给每个槽位提供者。 */
	readonly featureOverrides?: FeatureSwitchOverrides;
	/** 本轮推进档位；原著窗口据此在推进时多给「接下来」几件。 */
	readonly directorPush?: DirectorPush | null;
}

export type ContextTraceStatus =
	| "included"
	| "condition-false"
	| "missing-slot"
	| "budget-dropped";

export interface ContextTraceEntry {
	readonly segmentId: string;
	readonly kind: ContextSegment["kind"];
	readonly slot: ContextSlotName | null;
	readonly source: string;
	readonly priority: number;
	readonly tokens: number;
	readonly status: ContextTraceStatus;
	/** 这一片段里逐条内容的来源对象；旧 Trace 没有这个字段。 */
	readonly items?: readonly ContextTraceItem[];
	/** suffix 实际拼接到最后一条 user 消息时记录；没有玩家消息时槽位记为 missing-slot。 */
	readonly appendedTo?: "last-user";
	/** 历史槽位生效的块视图策略与省略量；没有省略时 omitted 为空。 */
	readonly history?: HistoryViewTrace;
	/** 记忆槽位的检索名次与融合结果；其它槽位不产生这个字段。 */
	readonly retrieval?: ContextRetrievalTrace;
}

export interface ContextTrace {
	readonly budgetTokens: number;
	readonly totalTokens: number;
	/** 按模板顺序列出每一个片段，包括没有进入上下文的部分。 */
	readonly entries: readonly ContextTraceEntry[];
}

export interface AssembledContextSegment {
	readonly segmentId: string;
	readonly kind: ContextSegment["kind"];
	readonly slot: ContextSlotName | null;
	readonly source: string;
	readonly tokens: number;
	readonly messages: readonly ContextMessage[];
}

export interface AssembledContext {
	/** 按模板顺序拼接；可直接作为 LlmRequest 的 messages。 */
	readonly messages: readonly ContextMessage[];
	readonly segments: readonly AssembledContextSegment[];
	readonly trace: ContextTrace;
	/** 进入上下文的引用；上下文包据此复核复用是否仍然有效。 */
	readonly references: ContextAssemblyReferences;
	/** 本次组装的槽位钩子耗时与跳过原因；不写进上下文包。 */
	readonly hooks?: readonly TurnHookTraceEntry[];
}

export interface ContextAssemblyReferences {
	readonly loreEntryIds: readonly string[];
	readonly sceneAnalysisNodeId: string | null;
	readonly retrievalNodeIds: readonly string[];
}

const MESSAGE_ROLE_BY_NAME: Readonly<Record<string, true>> = {
	system: true,
	user: true,
	assistant: true,
};

interface ResolvedSegment {
	readonly segment: ContextSegment;
	/** null 表示条件不满足或槽位没有提供内容。 */
	readonly messages: readonly ContextMessage[] | null;
	readonly source: string;
	readonly status: "candidate" | "condition-false" | "missing-slot";
	/** 拼接到最后一条 user 消息末尾的文本。 */
	readonly suffix?: string;
	readonly history?: HistoryViewTrace;
	readonly retrieval?: ContextRetrievalTrace;
	readonly references?: ContextSlotReferences;
	readonly items?: readonly ContextTraceItem[];
	/** 槽位提供者经过内核注册时的耗时记录；直接构造的提供者没有。 */
	readonly hook?: TurnHookTraceEntry;
}

/**
 * 按模板组装上下文：条件段先求值，槽位按需向提供者取内容，
 * 然后按优先级裁剪到 token 预算内。输出顺序始终是模板顺序。
 */
export async function assembleContext(
	input: ContextAssemblyInput,
): Promise<AssembledContext> {
	assertContextTemplate(input.template);
	if (!Number.isInteger(input.budgetTokens) || input.budgetTokens < 0) {
		throw new Error("token 预算必须是非负整数");
	}
	if (typeof input.storyId !== "string" || input.storyId.length === 0) {
		throw new Error("组装上下文时 storyId 必须是非空字符串");
	}
	const nodeId = input.nodeId ?? null;
	if (nodeId !== null && (typeof nodeId !== "string" || nodeId.length === 0)) {
		throw new Error("组装上下文时 nodeId 必须是非空字符串或 null");
	}

	const facts: ContextConditionFacts = {
		switches: input.switches ?? {},
		state: input.state,
	};
	const estimator = input.tokenEstimator ?? createTokenEstimator();

	const resolved = await Promise.all(
		input.template.segments.map((segment) =>
			resolveSegment(segment, input, facts),
		),
	);

	const tokenCounts = resolved.map((item) =>
		countSegmentTokens(item, estimator),
	);

	const keptIndexes = selectWithinBudget(
		resolved,
		tokenCounts,
		input.budgetTokens,
	);

	// 先把保留下来的消息按模板顺序拼起来，再决定 suffix 落到哪一条 user 消息上。
	const messages: ContextMessage[] = [];
	const suffixIndexes: number[] = [];
	const suffixes: string[] = [];
	const loreEntryIds: string[] = [];
	const retrievalNodeIds: string[] = [];
	const seenLoreEntryIds = new Set<string>();
	const seenRetrievalNodeIds = new Set<string>();
	let sceneAnalysisNodeId: string | null = null;
	resolved.forEach((item, index) => {
		if (item.status !== "candidate" || !keptIndexes.has(index)) return;
		messages.push(...(item.messages ?? []));
		if (item.suffix !== undefined) {
			suffixIndexes.push(index);
			suffixes.push(item.suffix);
		}
		for (const entryId of item.references?.loreEntryIds ?? []) {
			if (seenLoreEntryIds.has(entryId)) continue;
			seenLoreEntryIds.add(entryId);
			loreEntryIds.push(entryId);
		}
		if (item.references?.sceneAnalysisNodeId !== undefined) {
			sceneAnalysisNodeId = item.references.sceneAnalysisNodeId;
		}
		for (const nodeId of item.retrieval?.injectedNodeIds ?? []) {
			if (seenRetrievalNodeIds.has(nodeId)) continue;
			seenRetrievalNodeIds.add(nodeId);
			retrievalNodeIds.push(nodeId);
		}
	});
	let lastUserIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") {
			lastUserIndex = index;
			break;
		}
	}
	const suffixLanded = suffixIndexes.length > 0 && lastUserIndex >= 0;
	if (suffixLanded) {
		const target = messages[lastUserIndex] as ContextMessage;
		messages[lastUserIndex] = {
			role: "user",
			content: `${target.content}${SUFFIX_SEPARATOR}${suffixes.join("\n")}`,
		};
	}

	const segments: AssembledContextSegment[] = [];
	const entries: ContextTraceEntry[] = [];
	let totalTokens = 0;
	resolved.forEach((item, index) => {
		const hasSuffix = suffixIndexes.includes(index);
		const tokens = tokenCounts[index] as number;
		let status: ContextTraceStatus =
			item.status === "candidate"
				? keptIndexes.has(index)
					? "included"
					: "budget-dropped"
				: item.status;
		// 没有玩家消息时 suffix 无处拼接，整个片段记为缺失且不占预算。
		if (status === "included" && hasSuffix && !suffixLanded) {
			status = "missing-slot";
		}
		const entryTokens = status === "missing-slot" ? 0 : tokens;
		if (status === "included") totalTokens += entryTokens;
		entries.push({
			segmentId: item.segment.id,
			kind: item.segment.kind,
			slot: item.segment.kind === "slot" ? item.segment.slot : null,
			source: item.source,
			priority: item.segment.priority ?? 0,
			tokens: entryTokens,
			status,
			...(status === "included" && hasSuffix
				? { appendedTo: "last-user" as const }
				: {}),
			...(item.history === undefined ? {} : { history: item.history }),
			...(item.retrieval === undefined ? {} : { retrieval: item.retrieval }),
			...(item.items === undefined ? {} : { items: item.items }),
		});
		if (status === "included") {
			segments.push({
				segmentId: item.segment.id,
				kind: item.segment.kind,
				slot: item.segment.kind === "slot" ? item.segment.slot : null,
				source: item.source,
				tokens,
				messages: item.messages ?? [],
			});
		}
	});

	const hooks = resolved.flatMap((item) =>
		item.hook === undefined ? [] : [item.hook],
	);

	return {
		messages,
		segments,
		trace: {
			budgetTokens: input.budgetTokens,
			totalTokens,
			entries,
		},
		references: { loreEntryIds, sceneAnalysisNodeId, retrievalNodeIds },
		...(hooks.length === 0 ? {} : { hooks }),
	};
}

async function resolveSegment(
	segment: ContextSegment,
	input: ContextAssemblyInput,
	facts: ContextConditionFacts,
): Promise<ResolvedSegment> {
	const fallbackSource =
		segment.kind === "static"
			? `template:${input.template.id}/${segment.id}`
			: `slot:${segment.slot}`;
	if (
		segment.when !== undefined &&
		!evaluateContextCondition(segment.when, facts)
	) {
		return {
			segment,
			messages: null,
			source: fallbackSource,
			status: "condition-false",
		};
	}
	if (segment.kind === "static") {
		return {
			segment,
			messages: [{ role: segment.role ?? "system", content: segment.text }],
			source: fallbackSource,
			status: "candidate",
		};
	}

	const provider = input.providers?.[segment.slot];
	if (provider === undefined) {
		return {
			segment,
			messages: null,
			source: fallbackSource,
			status: "missing-slot",
		};
	}
	const request: ContextSlotRequest = {
		slot: segment.slot,
		storyId: input.storyId,
		nodeId: input.nodeId ?? null,
		switches: facts.switches,
		state: facts.state,
		budgetTokens: input.budgetTokens,
		...(input.featureOverrides === undefined
			? {}
			: { featureOverrides: input.featureOverrides }),
		...(input.directorPush === undefined
			? {}
			: { directorPush: input.directorPush }),
	};
	let content: ContextSlotContent | null;
	let hook: TurnHookTraceEntry | undefined;
	if (provider.plugin === undefined) {
		content = await provider.provide(request);
	} else {
		const run = await runTurnHook({
			extension: "context.slot",
			hook: segment.slot,
			plugin: provider.plugin,
			budgetMs: input.hookBudgetMs,
			run: async (budget) => await provider.provide({ ...request, budget }),
		});
		hook = run.trace;
		content = run.value;
	}
	if (content === null) {
		return {
			segment,
			messages: null,
			source: fallbackSource,
			status: "missing-slot",
			...(hook === undefined ? {} : { hook }),
		};
	}
	assertSlotContent(content, segment.slot);
	if (content.messages.length === 0 && content.suffix === undefined) {
		return {
			segment,
			messages: null,
			source: fallbackSource,
			status: "missing-slot",
			...(hook === undefined ? {} : { hook }),
		};
	}
	return {
		segment,
		messages: content.messages,
		source: content.source,
		status: "candidate",
		...(hook === undefined ? {} : { hook }),
		...(content.suffix === undefined ? {} : { suffix: content.suffix }),
		...(content.history === undefined ? {} : { history: content.history }),
		...(content.retrieval === undefined
			? {}
			: { retrieval: content.retrieval }),
		...(content.references === undefined
			? {}
			: { references: content.references }),
		...(content.items === undefined ? {} : { items: content.items }),
	};
}

function assertSlotContent(
	content: ContextSlotContent,
	slot: ContextSlotName,
): void {
	if (typeof content.source !== "string" || content.source.length === 0) {
		throw new Error(`槽位 ${slot} 的来源描述必须是非空字符串`);
	}
	if (!Array.isArray(content.messages)) {
		throw new Error(`槽位 ${slot} 的 messages 必须是数组`);
	}
	for (const message of content.messages) {
		if (MESSAGE_ROLE_BY_NAME[message.role] !== true) {
			throw new Error(
				`槽位 ${slot} 返回了不合法的消息角色：${String(message.role)}`,
			);
		}
		if (typeof message.content !== "string" || message.content.length === 0) {
			throw new Error(`槽位 ${slot} 返回的消息内容必须是非空字符串`);
		}
	}
	if (content.suffix !== undefined) {
		if (typeof content.suffix !== "string" || content.suffix.length === 0) {
			throw new Error(`槽位 ${slot} 的 suffix 必须是非空字符串`);
		}
	}
	if (content.items !== undefined) {
		if (!Array.isArray(content.items)) {
			throw new Error(`槽位 ${slot} 的 items 必须是数组`);
		}
		for (const item of content.items) {
			if (typeof item.label !== "string" || item.label.length === 0) {
				throw new Error(`槽位 ${slot} 的 items.label 必须是非空字符串`);
			}
			if (
				typeof item.tokens !== "number" ||
				!Number.isFinite(item.tokens) ||
				item.tokens < 0
			) {
				throw new Error(`槽位 ${slot} 的 items.tokens 必须是非负有限数字`);
			}
			if (typeof item.source?.kind !== "string") {
				throw new Error(`槽位 ${slot} 的 items.source 必须带 kind`);
			}
		}
	}
	if (content.references !== undefined) {
		const references = content.references;
		if (typeof references !== "object" || references === null) {
			throw new Error(`槽位 ${slot} 的 references 必须是对象`);
		}
		if (references.loreEntryIds !== undefined) {
			if (!Array.isArray(references.loreEntryIds)) {
				throw new Error(`槽位 ${slot} 的 references.loreEntryIds 必须是数组`);
			}
			for (const entryId of references.loreEntryIds) {
				if (typeof entryId !== "string" || entryId.length === 0) {
					throw new Error(
						`槽位 ${slot} 的 references.loreEntryIds 必须是非空字符串数组`,
					);
				}
			}
		}
		if (
			references.sceneAnalysisNodeId !== undefined &&
			references.sceneAnalysisNodeId !== null &&
			(typeof references.sceneAnalysisNodeId !== "string" ||
				references.sceneAnalysisNodeId.length === 0)
		) {
			throw new Error(
				`槽位 ${slot} 的 references.sceneAnalysisNodeId 必须是非空字符串或 null`,
			);
		}
	}
}

/** 拼接到玩家原文与多段 suffix 之间的分隔符。 */
const SUFFIX_SEPARATOR = "\n\n";

function estimateTokens(text: string, estimator: TokenEstimator): number {
	const tokens = estimator(text);
	if (!Number.isFinite(tokens) || tokens < 0) {
		throw new Error("token 估算必须返回非负有限数字");
	}
	return tokens;
}

function countSegmentTokens(
	item: ResolvedSegment,
	estimator: TokenEstimator,
): number {
	let total =
		item.messages === null ? 0 : countMessageTokens(item.messages, estimator);
	if (item.suffix !== undefined)
		total += estimateTokens(item.suffix, estimator);
	return total;
}

function countMessageTokens(
	messages: readonly ContextMessage[],
	estimator: TokenEstimator,
): number {
	let total = 0;
	for (const message of messages) {
		const tokens = estimator(message.content);
		if (!Number.isFinite(tokens) || tokens < 0) {
			throw new Error("token 估算必须返回非负有限数字");
		}
		total += tokens;
	}
	return total;
}

function selectWithinBudget(
	resolved: readonly ResolvedSegment[],
	tokenCounts: readonly number[],
	budgetTokens: number,
): ReadonlySet<number> {
	const candidates = resolved.flatMap((item, index) =>
		item.status === "candidate" ? [index] : [],
	);
	// 高优先级先选；同优先级保留模板里靠前的片段，尽量维持前缀稳定。
	candidates.sort((left, right) => {
		const leftPriority = resolved[left]?.segment.priority ?? 0;
		const rightPriority = resolved[right]?.segment.priority ?? 0;
		return rightPriority - leftPriority || left - right;
	});
	const kept = new Set<number>();
	let used = 0;
	for (const index of candidates) {
		const tokens = tokenCounts[index] as number;
		if (used + tokens <= budgetTokens) {
			kept.add(index);
			used += tokens;
		}
	}
	return kept;
}

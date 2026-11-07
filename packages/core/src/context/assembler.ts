import type { HistoryViewTrace } from "../blocks/history.js";
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
}

export interface ContextSlotContent {
	readonly messages: readonly ContextMessage[];
	/** 写进 Trace 的来源描述，例如"世界书：2 条常驻、3 条检索"。 */
	readonly source: string;
	/** 历史槽位的块视图统计；其它槽位不产生这个字段。 */
	readonly history?: HistoryViewTrace;
}

export interface ContextSlotProvider {
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
	/** 历史槽位生效的块视图策略与省略量；没有省略时 omitted 为空。 */
	readonly history?: HistoryViewTrace;
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
	readonly history?: HistoryViewTrace;
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
		item.messages === null ? 0 : countMessageTokens(item.messages, estimator),
	);

	const keptIndexes = selectWithinBudget(
		resolved,
		tokenCounts,
		input.budgetTokens,
	);
	const totalTokens = [...keptIndexes].reduce(
		(total, index) => total + (tokenCounts[index] as number),
		0,
	);

	const messages: ContextMessage[] = [];
	const segments: AssembledContextSegment[] = [];
	const entries: ContextTraceEntry[] = [];
	resolved.forEach((item, index) => {
		const tokens = tokenCounts[index] as number;
		const status: ContextTraceStatus =
			item.status === "candidate"
				? keptIndexes.has(index)
					? "included"
					: "budget-dropped"
				: item.status;
		entries.push({
			segmentId: item.segment.id,
			kind: item.segment.kind,
			slot: item.segment.kind === "slot" ? item.segment.slot : null,
			source: item.source,
			priority: item.segment.priority ?? 0,
			tokens,
			status,
			...(item.history === undefined ? {} : { history: item.history }),
		});
		if (status === "included") {
			const included = item.messages as readonly ContextMessage[];
			messages.push(...included);
			segments.push({
				segmentId: item.segment.id,
				kind: item.segment.kind,
				slot: item.segment.kind === "slot" ? item.segment.slot : null,
				source: item.source,
				tokens,
				messages: included,
			});
		}
	});

	return {
		messages,
		segments,
		trace: {
			budgetTokens: input.budgetTokens,
			totalTokens,
			entries,
		},
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
			messages: [{ role: "system", content: segment.text }],
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
	const content = await provider.provide({
		slot: segment.slot,
		storyId: input.storyId,
		nodeId: input.nodeId ?? null,
		switches: facts.switches,
		state: facts.state,
	});
	if (content === null) {
		return {
			segment,
			messages: null,
			source: fallbackSource,
			status: "missing-slot",
		};
	}
	assertSlotContent(content, segment.slot);
	if (content.messages.length === 0) {
		return {
			segment,
			messages: null,
			source: fallbackSource,
			status: "missing-slot",
		};
	}
	return {
		segment,
		messages: content.messages,
		source: content.source,
		status: "candidate",
		...(content.history === undefined ? {} : { history: content.history }),
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

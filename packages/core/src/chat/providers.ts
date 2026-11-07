import { parseBlocks } from "../blocks/parser.js";
import { renderContextView } from "../blocks/view.js";
import type {
	ContextSlotContent,
	ContextSlotProvider,
	ContextSlotProviders,
} from "../context/assembler.js";
import type { ContextMessage } from "../context/template.js";
import { evaluateDirector } from "../director/evaluate.js";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorConfig,
	type DirectorMechanism,
} from "../director/types.js";
import { normalizeEntityName } from "../entity.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import { MAX_MEMORY_EVENT_LIMIT } from "../memory/event.js";
import {
	type LoreEntry,
	loreEntryContentKey,
	loreEntryMatchScore,
} from "../memory/lore.js";
import type { SummaryLevel } from "../memory/summary.js";
import { retrieveMemory } from "../retrieval/hybrid.js";
import type { StoryStore } from "../store/story-store.js";
import { type TokenEstimator, createTokenEstimator } from "../tokens.js";

export interface HistorySlotProviderOptions {
	/** 最多带最近多少楼，默认 20。 */
	readonly limit?: number;
}

export const DEFAULT_HISTORY_LIMIT = 20;

/** 把固定的消息集合包装成槽位提供者，例如角色卡生成的系统提示词。 */
export function createStaticSlotProvider(
	messages: readonly ContextMessage[],
	source: string,
): ContextSlotProvider {
	if (typeof source !== "string" || source.length === 0) {
		throw new Error("槽位内容的来源描述必须是非空字符串");
	}
	if (messages.length === 0) {
		throw new Error(`槽位 ${source} 至少要有一条消息`);
	}
	for (const message of messages) {
		if (typeof message.content !== "string" || message.content.length === 0) {
			throw new Error(`槽位 ${source} 的消息内容必须是非空字符串`);
		}
	}
	const frozen = messages.map((message) => ({ ...message }));
	return {
		provide(): ContextSlotContent {
			return { messages: frozen, source };
		},
	};
}

/** 把路径上的最近若干楼渲染成上下文视图，交给历史槽位。 */
export function createHistorySlotProvider(
	store: StoryStore,
	options: HistorySlotProviderOptions = {},
): ContextSlotProvider {
	const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("历史槽位的楼数上限必须是正整数");
	}
	return {
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const path = store.getPathToNode(request.nodeId);
			const nodes = path.slice(-limit);
			const messages: ContextMessage[] = [];
			nodes.forEach((node, index) => {
				const depth = nodes.length - 1 - index;
				const text = renderContextView(parseBlocks(node.raw), { depth });
				if (text.trim().length === 0) return;
				messages.push({ role: node.role, content: text });
			});
			if (messages.length === 0) return null;
			return { messages, source: `history:最近 ${messages.length} 楼` };
		},
	};
}

/** 从状态快照读取当前状态，把结果渲染成系统消息。 */
export function createStateSlotProvider(
	store: StoryStore,
): ContextSlotProvider {
	return {
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const { state } = store.getStateSnapshot(request.nodeId);
			if (Object.keys(state).length === 0) return null;
			const diffCount = store.countStateDiffsAlongPath(request.nodeId);
			return {
				messages: [
					{
						role: "system",
						content: `当前状态：\n${JSON.stringify(state, null, 2)}`,
					},
				],
				source: `state:${diffCount} 条 diff`,
			};
		},
	};
}

export interface MemorySlotProviderOptions {
	/** 最多注入多少条检索结果，默认 6。 */
	readonly limit?: number;
	/** 有 embedding 客户端时启用向量路；没有时只走其余各路。 */
	readonly embedder?: EmbeddingClient | null;
}

export const DEFAULT_MEMORY_SLOT_LIMIT = 6;

/**
 * 以当前楼层之前的路径为范围做多路记忆检索，把命中结果渲染成一条系统消息。
 * 当前楼层的原文作为检索语句，同一楼层只出现一次。
 */
export function createMemorySlotProvider(
	store: StoryStore,
	options: MemorySlotProviderOptions = {},
): ContextSlotProvider {
	const limit = options.limit ?? DEFAULT_MEMORY_SLOT_LIMIT;
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("记忆槽位的检索条数必须是正整数");
	}
	const embedder = options.embedder ?? null;
	return {
		async provide(request): Promise<ContextSlotContent | null> {
			if (request.nodeId === null) return null;
			const current = store.getNode(request.nodeId);
			if (!current) {
				throw new Error(`楼层节点不存在：${request.nodeId}`);
			}
			if (current.storyId !== request.storyId) {
				throw new Error(
					`楼层节点 ${request.nodeId} 属于另一个故事 ${current.storyId}`,
				);
			}
			const pathBefore = store.getPathToNode(request.nodeId).slice(0, -1);
			if (pathBefore.length === 0) return null;
			const lastBefore = pathBefore[pathBefore.length - 1];
			if (lastBefore === undefined) return null;
			const eventsByNode = new Map<string, string[]>();
			for (const event of store.getEventsForPath(lastBefore.id, {
				limit: MAX_MEMORY_EVENT_LIMIT,
			})) {
				const texts = eventsByNode.get(event.sourceNodeId);
				if (texts === undefined) {
					eventsByNode.set(event.sourceNodeId, [event.text]);
				} else {
					texts.push(event.text);
				}
			}

			const result = await retrieveMemory({
				store,
				embedder,
				storyId: request.storyId,
				query: current.raw,
				beforeNodeId: request.nodeId,
				limit,
			});

			const positions = new Map(
				pathBefore.map((node, index) => [node.id, index] as const),
			);
			const seen = new Set<string>();
			const lines: string[] = [];
			for (const hit of result.hits) {
				if (seen.has(hit.nodeId)) continue;
				seen.add(hit.nodeId);
				const sourceNode = store.getNode(hit.nodeId);
				if (!sourceNode) {
					throw new Error(`检索结果引用了不存在的楼层：${hit.nodeId}`);
				}
				let text: string;
				if (hit.kind === "event") {
					const texts = eventsByNode.get(hit.nodeId);
					if (texts === undefined) {
						throw new Error(
							`检索结果把楼层 ${hit.nodeId} 标为事件，但该楼层没有事件正文`,
						);
					}
					text = texts.join("；");
				} else {
					const index = positions.get(hit.nodeId);
					if (index === undefined) {
						throw new Error(`检索结果里的楼层 ${hit.nodeId} 不在当前路径上`);
					}
					text = renderContextView(parseBlocks(sourceNode.raw), {
						depth: pathBefore.length - 1 - index,
					});
				}
				text = text.trim();
				if (text.length === 0) continue;
				const kind = hit.kind === "event" ? "事件" : "原文块";
				lines.push(`- 楼层 ${hit.nodeId}（${kind}）：${text}`);
			}
			if (lines.length === 0) return null;
			return {
				messages: [
					{
						role: "system",
						content: `相关记忆（按相关度排序）：\n${lines.join("\n")}`,
					},
				],
				source: `memory:${lines.length}`,
			};
		},
	};
}

export interface SummarySlotProviderOptions {
	/** 摘要段占用的 token 上限，默认 800。 */
	readonly tokenLimit?: number;
	readonly tokenEstimator?: TokenEstimator;
}
export const DEFAULT_SUMMARY_TOKEN_LIMIT = 800;

/**
 * 返回当前分支下有效的主线摘要与最近一条章节摘要；超过 token 上限时
 * 从最久远的摘要开始丢弃。
 */
export function createSummarySlotProvider(
	store: StoryStore,
	options: SummarySlotProviderOptions = {},
): ContextSlotProvider {
	const tokenLimit = options.tokenLimit ?? DEFAULT_SUMMARY_TOKEN_LIMIT;
	if (!Number.isInteger(tokenLimit) || tokenLimit < 1) {
		throw new Error("摘要槽位的 token 上限必须是正整数");
	}
	const estimator = options.tokenEstimator ?? createTokenEstimator();
	const header = "故事摘要：";
	return {
		provide(request): ContextSlotContent | null {
			const headNodeId =
				request.nodeId ?? store.getHead(request.storyId)?.id ?? null;
			if (headNodeId === null) return null;
			const valid = store.getValidSummaries(request.storyId, headNodeId);
			const latestChapter = valid
				.filter((summary) => summary.level === "chapter")
				.at(-1);
			const mainlines = valid.filter((summary) => summary.level === "mainline");
			const selected =
				latestChapter === undefined ? mainlines : [...mainlines, latestChapter];
			if (selected.length === 0) return null;

			const path = store.getPathToNode(headNodeId);
			const positions = new Map(
				path.map((node, index) => [node.id, index] as const),
			);
			const byRecency = [...selected].sort(
				(left, right) =>
					(positions.get(right.endNodeId) ?? -1) -
					(positions.get(left.endNodeId) ?? -1),
			);
			let used = estimator(header);
			const kept = new Set<string>();
			for (const summary of byRecency) {
				const tokens = estimator(summary.text);
				if (used + tokens > tokenLimit) continue;
				used += tokens;
				kept.add(summary.id);
			}
			if (kept.size === 0) return null;

			const lines = [header];
			const keptMainlines = mainlines.filter((summary) => kept.has(summary.id));
			for (const summary of keptMainlines) {
				lines.push(`【主线】${summary.text}`);
			}
			const chapterKept =
				latestChapter !== undefined && kept.has(latestChapter.id);
			if (chapterKept && latestChapter !== undefined) {
				lines.push(`【章节】${latestChapter.text}`);
			}
			const levels: SummaryLevel[] = [];
			if (keptMainlines.length > 0) levels.push("mainline");
			if (chapterKept) levels.push("chapter");
			return {
				messages: [{ role: "system", content: lines.join("\n") }],
				source: `summary:${levels.join("+")}`,
			};
		},
	};
}

export interface LoreSlotProviderOptions {
	/** 世界书段占用的 token 上限，默认 800。 */
	readonly tokenLimit?: number;
	readonly tokenEstimator?: TokenEstimator;
}

export const DEFAULT_LORE_TOKEN_LIMIT = 800;

interface SelectedLoreLine {
	readonly constant: boolean;
	readonly line: string;
	readonly tokens: number;
}

/**
 * 常驻世界书条目每轮都注入；其余条目用当前楼层的原文匹配关键词与关联实体的
 * 名称和别名，只有命中的条目才出现。超出 token 上限时先从后往前删除检索条目，
 * 常驻条目最后才裁。
 */
export function createLoreSlotProvider(
	store: StoryStore,
	options: LoreSlotProviderOptions = {},
): ContextSlotProvider {
	const tokenLimit = options.tokenLimit ?? DEFAULT_LORE_TOKEN_LIMIT;
	if (!Number.isInteger(tokenLimit) || tokenLimit < 1) {
		throw new Error("世界书槽位的 token 上限必须是正整数");
	}
	const estimator = options.tokenEstimator ?? createTokenEstimator();
	const header = "世界书条目：";
	return {
		provide(request): ContextSlotContent | null {
			const nodeId = request.nodeId;
			let normalizedQuery = "";
			if (nodeId !== null) {
				const node = store.getNode(nodeId);
				if (!node) {
					throw new Error(`楼层节点不存在：${nodeId}`);
				}
				if (node.storyId !== request.storyId) {
					throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
				}
				normalizedQuery = normalizeEntityName(node.raw);
			}
			const entries = store.listLoreEntries(request.storyId);
			if (entries.length === 0) return null;

			const orderedNonConstant: { entry: LoreEntry; score: number }[] = [];
			for (const entry of entries) {
				if (entry.constant) continue;
				let entityAliases: readonly string[] = [];
				if (entry.entityId !== null) {
					const entity = store.getEntity(entry.entityId);
					if (!entity) {
						throw new Error(
							`世界书条目 ${entry.id} 关联的实体不存在：${entry.entityId}`,
						);
					}
					entityAliases = entity.aliases;
				}
				const score = loreEntryMatchScore(
					entry,
					normalizedQuery,
					entityAliases,
				);
				if (score > 0) orderedNonConstant.push({ entry, score });
			}
			orderedNonConstant.sort((left, right) => right.score - left.score);

			const candidates = [
				...entries.filter((entry) => entry.constant),
				...orderedNonConstant.map((match) => match.entry),
			];
			const seenEntities = new Set<string>();
			const seenContents = new Set<string>();
			const selected: SelectedLoreLine[] = [];
			for (const entry of candidates) {
				if (entry.entityId !== null) {
					if (seenEntities.has(entry.entityId)) continue;
					seenEntities.add(entry.entityId);
				}
				const contentKey = loreEntryContentKey(entry);
				if (seenContents.has(contentKey)) continue;
				seenContents.add(contentKey);
				const prefix = entry.constant ? "【常驻】" : "【检索】";
				const line = `${prefix}${entry.name}：${entry.content}`;
				selected.push({
					constant: entry.constant,
					line,
					tokens: estimator(line),
				});
			}
			if (selected.length === 0) return null;

			let total = estimator(header);
			for (const item of selected) total += item.tokens;
			while (total > tokenLimit) {
				let index = lastIndexWhere(selected, (item) => !item.constant);
				if (index < 0) index = selected.length - 1;
				if (index < 0) break;
				total -= selected[index]?.tokens ?? 0;
				selected.splice(index, 1);
			}
			if (selected.length === 0) return null;

			const constantsKept = selected.filter((item) => item.constant).length;
			const retrievedKept = selected.length - constantsKept;
			return {
				messages: [
					{
						role: "system",
						content: [header, ...selected.map((item) => item.line)].join("\n"),
					},
				],
				source: `lore:常驻 ${constantsKept} 条、检索 ${retrievedKept} 条`,
			};
		},
	};
}

function lastIndexWhere<T>(
	items: readonly T[],
	predicate: (item: T) => boolean,
): number {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (item !== undefined && predicate(item)) return index;
	}
	return -1;
}

export interface DirectorSlotProviderOptions {
	/** 不设置时使用默认配置（开启、线索阈值 12 楼、上限 5 条）。 */
	readonly config?: DirectorConfig;
	/** 默认使用内置机制；后续机制统一从这里注册。 */
	readonly mechanisms?: readonly DirectorMechanism[];
}

/**
 * 评估全部导演机制，有建议时只返回一条以「【导演】」开头的系统消息。
 * 评估结果写入该楼层的决策记录；导演关闭时既不出消息也不写记录。
 */
export function createDirectorSlotProvider(
	store: StoryStore,
	options: DirectorSlotProviderOptions = {},
): ContextSlotProvider {
	const config = options.config ?? DEFAULT_DIRECTOR_CONFIG;
	return {
		provide(request): ContextSlotContent | null {
			const nodeId =
				request.nodeId ?? store.getHead(request.storyId)?.id ?? null;
			if (nodeId === null) return null;
			const suggestion = evaluateDirector({
				store,
				storyId: request.storyId,
				nodeId,
				config,
				mechanisms: options.mechanisms,
			});
			if (suggestion === null) return null;
			return {
				messages: [
					{ role: "system", content: `【导演】${suggestion.directive}` },
				],
				source: `director:${suggestion.mechanism}`,
			};
		},
	};
}

/** 角色槽位使用导入时保存的卡提示词；来源只记录长度，不重复正文。 */
export function createCharacterSlotProvider(
	characterPrompt: string,
): ContextSlotProvider {
	if (
		typeof characterPrompt !== "string" ||
		characterPrompt.trim().length === 0
	) {
		throw new Error("角色提示词必须是非空字符串");
	}
	return {
		provide(): ContextSlotContent {
			return {
				messages: [{ role: "system", content: characterPrompt }],
				source: `character:${characterPrompt.length} 字符`,
			};
		},
	};
}

export interface StandardChatProvidersOptions {
	readonly store: StoryStore;
	/** 为空表示故事还没有导入角色卡，角色槽位记为缺失。 */
	readonly characterPrompt: string | null;
	readonly embedder?: EmbeddingClient | null;
	readonly directorConfig?: DirectorConfig;
	readonly mechanisms?: readonly DirectorMechanism[];
}

/** 生产对话与回放评测共用的七个槽位。 */
export function createStandardChatProviders(
	options: StandardChatProvidersOptions,
): ContextSlotProviders {
	const embedder = options.embedder ?? null;
	const character =
		options.characterPrompt === null ||
		options.characterPrompt.trim().length === 0
			? {}
			: { character: createCharacterSlotProvider(options.characterPrompt) };
	return {
		...character,
		history: createHistorySlotProvider(options.store),
		state: createStateSlotProvider(options.store),
		summary: createSummarySlotProvider(options.store),
		memory: createMemorySlotProvider(options.store, { embedder }),
		lore: createLoreSlotProvider(options.store),
		director: createDirectorSlotProvider(options.store, {
			config: options.directorConfig,
			mechanisms: options.mechanisms,
		}),
	};
}

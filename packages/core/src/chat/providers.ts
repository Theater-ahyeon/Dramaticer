import {
	type HistoryBlockPolicy,
	renderHistoryView,
} from "../blocks/history.js";
import { parseBlocks } from "../blocks/parser.js";
import { renderContextView } from "../blocks/view.js";
import {
	formatWritingBlueprintSummary,
	readWritingBlueprintSummary,
} from "../blueprint/summary.js";
import type {
	ContextItemSource,
	ContextSlotContent,
	ContextSlotProvider,
	ContextTraceItem,
	RetrievalInjectionTrace,
} from "../context/assembler.js";
import type { ContextMessage } from "../context/template.js";
import type { DirectorPush, DirectorWhen } from "../director/lines.js";
import {
	collectDirectorLineHistoryIds,
	readDirectorActionInput,
	selectDirectorAction,
} from "../director/lines.js";
import {
	DEFAULT_DIRECTOR_ORGANIZATION,
	type DirectorEngine,
	type DirectorOrganizationKind,
	createDirectorEngine,
} from "../director/organization.js";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorConfig,
	type DirectorMechanism,
} from "../director/types.js";
import { readEffectiveLore } from "../edits/index.js";
import { normalizeEntityName } from "../entity.js";
import { type JsonObject, type JsonValue, isJsonObject } from "../json.js";
import {
	CHARACTER_PROFILE_FIELD_LABELS,
	type CharacterProfile,
	type CharacterProfileField,
	type CharacterProfileNote,
	readCharacterProfiles,
	readSceneKnowledge,
} from "../ledger/character-profile.js";
import { readLedger } from "../ledger/read.js";
import {
	DEFAULT_REUNION_UNRESOLVED_LIMIT,
	REUNION_KIND_LABELS,
	formatReunionMention,
	selectReunionMentions,
} from "../ledger/reunion.js";
import { readSceneGoal } from "../ledger/scene-goal.js";
import { readSceneSegments } from "../ledger/scenes.js";
import { USER_WILL_KINDS, type UserWillKind } from "../ledger/schema.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { RerankClient } from "../llm/rerank.js";
import {
	type ChapterCompression,
	formatCompressionSections,
} from "../memory/compression.js";
import { MAX_MEMORY_EVENT_LIMIT } from "../memory/event.js";
import type { ImportAuditInjectionRule } from "../memory/import-audit.js";
import {
	type LoreEntry,
	type LorePrefilter,
	loreEntryContentKey,
	loreEntryMatchScore,
} from "../memory/lore.js";
import type { SummaryLevel } from "../memory/summary.js";
import { retrieveMemory } from "../retrieval/hybrid.js";
import { readStoryFeatureState } from "../settings/features.js";
import type { StoryStore } from "../store/story-store.js";
import { type TokenEstimator, createTokenEstimator } from "../tokens.js";
import { type WorldModelKind, createWorldModel } from "../world-model/index.js";

export interface HistorySlotProviderOptions {
	/** 最多带最近多少楼，默认 20。 */
	readonly limit?: number;
	/** 块的 prompt 视图策略，默认省略更早楼层的显示类块。 */
	readonly policy?: HistoryBlockPolicy;
	/** `default` 策略下不套用显示类省略的楼数，默认 1。 */
	readonly recentRawFloors?: number;
	/** 统计省略量用的 token 估算器，默认与上下文组装相同。 */
	readonly estimator?: TokenEstimator;
}

export const DEFAULT_HISTORY_LIMIT = 20;

function contextItem(
	label: string,
	tokens: number,
	source: ContextItemSource,
): ContextTraceItem {
	return { label, tokens, source };
}

/** 状态槽位注入的是台账快照；逐条来源按叶子路径拆开。 */
function stateItems(
	state: JsonObject,
	estimator: TokenEstimator,
): ContextTraceItem[] {
	const items: ContextTraceItem[] = [];
	const walk = (value: JsonValue, path: readonly string[]): void => {
		const namespace = path[0] ?? "";
		if (namespace === "userWill") return;
		if (isJsonObject(value)) {
			for (const [key, child] of Object.entries(value)) {
				walk(child as JsonValue, [...path, key]);
			}
			return;
		}
		if (path.length === 0) return;
		const label = path.slice(1).join(" · ") || path[0] || "";
		const text = `${label}：${JSON.stringify(value)}`;
		items.push(
			contextItem(label, estimator(text), {
				kind: "state",
				target: JSON.stringify(path),
				label,
			}),
		);
	};
	walk(state as JsonValue, []);
	return items;
}

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
		packKey: JSON.stringify({ source, messages: frozen }),
		provide(): ContextSlotContent {
			return { messages: frozen, source };
		},
	};
}

/** 把路径上的最近若干楼渲染成 prompt 视图，交给历史槽位。 */
export function createHistorySlotProvider(
	store: StoryStore,
	options: HistorySlotProviderOptions = {},
): ContextSlotProvider {
	const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("历史槽位的楼数上限必须是正整数");
	}
	const estimator = options.estimator ?? createTokenEstimator();
	return {
		packKey: JSON.stringify({
			limit,
			policy: options.policy ?? null,
			recentRawFloors: options.recentRawFloors ?? null,
		}),
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const path = store.getPathToNode(request.nodeId);
			const positions = new Map(
				path.map((node, index) => [node.id, index + 1] as const),
			);
			const nodes = path.slice(-limit);
			const view = renderHistoryView(
				nodes.map((node, index) => ({
					raw: node.raw,
					depth: nodes.length - 1 - index,
				})),
				{
					policy: options.policy,
					recentRawFloors: options.recentRawFloors,
					estimator: options.estimator,
				},
			);
			const messages: ContextMessage[] = [];
			const items: ContextTraceItem[] = [];
			nodes.forEach((node, index) => {
				const text = view.texts[index] ?? "";
				if (text.trim().length === 0) return;
				messages.push({ role: node.role, content: text });
				const floorNo = positions.get(node.id) ?? 0;
				items.push(
					contextItem(`第 ${floorNo} 楼`, estimator(text), {
						kind: "floor",
						nodeId: node.id,
						floorNo,
					}),
				);
			});
			if (messages.length === 0) return null;
			return {
				messages,
				source: `history:最近 ${messages.length} 楼`,
				history: view.trace,
				items,
			};
		},
	};
}

export interface RawHistorySlotProviderOptions {
	/** 最多带最近多少楼原文，默认 20。 */
	readonly limit?: number;
}

/** 把路径上最近若干楼的原文直接交给历史槽位；不做块视图，只跳过空楼层。 */
export function createRawHistorySlotProvider(
	store: StoryStore,
	options: RawHistorySlotProviderOptions = {},
): ContextSlotProvider {
	const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
	if (!Number.isInteger(limit) || limit < 1) {
		throw new Error("历史槽位的楼数上限必须是正整数");
	}
	const estimator = createTokenEstimator();
	return {
		packKey: `raw-history:${limit}`,
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const path = store.getPathToNode(request.nodeId);
			const positions = new Map(
				path.map((node, index) => [node.id, index + 1] as const),
			);
			const messages: ContextMessage[] = [];
			const items: ContextTraceItem[] = [];
			for (const node of path.slice(-limit)) {
				if (node.raw.trim().length === 0) continue;
				messages.push({ role: node.role, content: node.raw });
				const floorNo = positions.get(node.id) ?? 0;
				items.push(
					contextItem(`第 ${floorNo} 楼`, estimator(node.raw), {
						kind: "floor",
						nodeId: node.id,
						floorNo,
					}),
				);
			}
			if (messages.length === 0) return null;
			return {
				messages,
				source: `history:最近 ${messages.length} 楼原文`,
				items,
			};
		},
	};
}

export interface StateSlotProviderOptions {
	/** 世界模型的表示方式；默认台账。 */
	readonly worldModel?: WorldModelKind;
}

/** 从世界模型读取当前状态，把硬事实与补充段落渲染成系统消息。 */
export function createStateSlotProvider(
	store: StoryStore,
	options: StateSlotProviderOptions = {},
): ContextSlotProvider {
	const worldModel = createWorldModel(store, options.worldModel);
	const estimator = createTokenEstimator();
	return {
		packKey: `state:${worldModel.kind}`,
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const view = worldModel.read(request.nodeId);
			if (Object.keys(view.state).length === 0 && view.sections.length === 0) {
				return null;
			}
			const messages: ContextMessage[] = [
				{
					role: "system",
					content: `当前状态：\n${JSON.stringify(view.state, null, 2)}`,
				},
			];
			const items = stateItems(view.state, estimator);
			for (const section of view.sections) {
				messages.push({
					role: "system",
					content: `${section.title}：\n${section.text}`,
				});
				items.push(
					contextItem(section.title, estimator(section.text), {
						kind: "state",
						target: JSON.stringify(["section", section.title]),
						label: section.title,
					}),
				);
			}
			return { messages, source: view.source, items };
		},
	};
}

/**
 * 取当前路径上最近一条现场分析；没有分析时返回 null，由 Trace 记为缺失槽位。
 */
export function createSceneSlotProvider(
	store: StoryStore,
): ContextSlotProvider {
	return {
		packKey: "scene",
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const analysis = store.getLatestSceneAnalysisOnPath(request.nodeId);
			if (analysis === null) return null;
			return {
				messages: [{ role: "system", content: `现场分析：\n${analysis.text}` }],
				source: `scene:楼层 ${analysis.nodeId}，估算 ${analysis.tokenCount} token`,
				references: { sceneAnalysisNodeId: analysis.nodeId },
				items: [
					contextItem("现场分析", analysis.tokenCount, {
						kind: "scene",
						nodeId: analysis.nodeId,
					}),
				],
			};
		},
	};
}

/**
 * 当前这一场的场面卡：谁想要什么、这一场结束时应该改变什么。
 * 导演关闭时不注入；这一场还没有卡时槽位缺失。
 */
export function createSceneCardSlotProvider(
	store: StoryStore,
): ContextSlotProvider {
	const estimator = createTokenEstimator();
	return {
		packKey: "sceneCard",
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const nodeId = request.nodeId;
			const mode = store.getStorySettings(request.storyId).directorConfig.mode;
			if (mode === "off") return null;
			const segments = readSceneSegments(store, nodeId);
			const current = segments.find((segment) =>
				segment.floorIds.includes(nodeId),
			);
			if (current === undefined || current.endNodeId !== null) return null;
			const card = readSceneGoal(store, request.storyId, nodeId);
			if (card === null) return null;
			const lines = card.present.map(
				(actor) => `${actor.who}想要${actor.want}`,
			);
			const content = `场面卡：\n${lines.join("\n")}\n这一场结束时应该改变：${card.change}`;
			return {
				messages: [
					{
						role: "system",
						content,
					},
				],
				source: `scene_card:楼层 ${current.startNodeId}，${card.present.length} 人`,
				items: [
					contextItem("场面卡", estimator(content), {
						kind: "scene",
						nodeId: current.startNodeId,
					}),
				],
			};
		},
	};
}

/**
 * 写作模型只看到当前卷的核心问题、最近一个里程碑的方向与本章该埋的线；
 * 完整蓝图留在导演层。没有可写的内容时返回 null，不产生空段。
 */
export function createBlueprintSlotProvider(
	store: StoryStore,
): ContextSlotProvider {
	const estimator = createTokenEstimator();
	return {
		packKey: "blueprint",
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const nodeId = request.nodeId;
			const summary = readWritingBlueprintSummary(
				store.readBlueprintEntries(nodeId),
				store.readDirectorLineStates(nodeId),
				collectDirectorLineHistoryIds(store.listDirectorLinesAlongPath(nodeId)),
			);
			if (summary === null) return null;
			const formatted = formatWritingBlueprintSummary(summary);
			if (formatted === null) return null;
			const items: ContextTraceItem[] = [];
			if (summary.volume !== null) {
				const { id, title, coreQuestion } = summary.volume;
				if (title.length > 0 || coreQuestion.length > 0) {
					items.push(
						contextItem(
							title.length === 0 ? "当前卷" : `当前卷：${title}`,
							estimator(`${title}${coreQuestion}`),
							{ kind: "outline", id },
						),
					);
				}
			}
			if (summary.milestone !== null) {
				items.push(
					contextItem("最近的里程碑", estimator(summary.milestone.want), {
						kind: "outline",
						id: summary.milestone.id,
					}),
				);
			}
			if (summary.seeds.length > 0) {
				const id = summary.milestone?.id ?? summary.volume?.id ?? "blueprint";
				items.push(
					contextItem(
						`本章该埋的线 ${summary.seeds.length} 条`,
						estimator(summary.seeds.join("\n")),
						{ kind: "outline", id },
					),
				);
			}
			return {
				messages: [{ role: "system", content: formatted.text }],
				source: formatted.source,
				items,
			};
		},
	};
}

/** 默认注入最近几场归档的知情标注。 */
export const DEFAULT_PROFILE_KNOWLEDGE_SCENES = 3;

/** 注入时最多列出的未了结事项条数。 */
const PROFILE_UNRESOLVED_LIMIT = 3;

/** 知情标注里摘要的截断长度。 */
const PROFILE_SUMMARY_CLIP = 60;

export interface ProfileSlotProviderOptions {
	/** 知情标注覆盖最近几场归档，默认 3。 */
	readonly knowledgeSceneLimit?: number;
}

function formatProfileNote(note: CharacterProfileNote): string {
	return `- ${CHARACTER_PROFILE_FIELD_LABELS[note.field]}：${note.text}（场次 ${note.sceneEndNodeId}）`;
}

/** 想要、瞒着、说话样本取最新一条；上次出场与未了结单独排。 */
function formatCharacterProfile(profile: CharacterProfile): string {
	const latest = new Map<CharacterProfileField, CharacterProfileNote>();
	for (const note of profile.notes) latest.set(note.field, note);
	const lines: string[] = [];
	for (const field of ["want", "hide", "speech"] as const) {
		const note = latest.get(field);
		if (note !== undefined) lines.push(formatProfileNote(note));
	}
	if (profile.lastScene !== null) {
		lines.push(
			`- 上次出场：场次 ${profile.lastScene.endNodeId}（起于 ${profile.lastScene.startNodeId}）`,
		);
	}
	const unresolved = profile.notes
		.filter((note) => note.field === "unresolved")
		.slice(-PROFILE_UNRESOLVED_LIMIT);
	if (unresolved.length > 0) {
		lines.push(
			`- 未了结：${unresolved
				.map((note) => `${note.text}（场次 ${note.sceneEndNodeId}）`)
				.join("；")}`,
		);
	}
	return lines.join("\n");
}

function clipProfileSummary(summary: string): string {
	const text = summary.replace(/\s+/g, " ").trim();
	if (text.length <= PROFILE_SUMMARY_CLIP) return text;
	return `${text.slice(0, PROFILE_SUMMARY_CLIP)}…`;
}

/**
 * 当前在场人物的档案与最近几场的知情标注。档案全部来自场次归档；
 * 还没有归档时不注入，避免空段。没有变化时返回 null。
 */
export function createProfileSlotProvider(
	store: StoryStore,
	options: ProfileSlotProviderOptions = {},
): ContextSlotProvider {
	const sceneLimit =
		options.knowledgeSceneLimit ?? DEFAULT_PROFILE_KNOWLEDGE_SCENES;
	if (!Number.isInteger(sceneLimit) || sceneLimit < 1) {
		throw new Error("知情标注的场次数上限必须是正整数");
	}
	const estimator = createTokenEstimator();
	return {
		packKey: `profile:${sceneLimit}`,
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const nodeId = request.nodeId;
			const archives = store.listSceneArchivesAlongPath(nodeId);
			if (archives.length === 0) return null;
			const latestScene = archives[archives.length - 1];
			const log = store.getLatestSceneLogOnPath(nodeId);
			const present = new Set(log?.present ?? latestScene?.present ?? []);
			const blocks: string[] = [];
			const items: ContextTraceItem[] = [];
			for (const profile of readCharacterProfiles(store, nodeId)) {
				if (!present.has(profile.who)) continue;
				const text = formatCharacterProfile(profile);
				if (text.length === 0) continue;
				const block = `${profile.who}：\n${text}`;
				blocks.push(block);
				const entity = store.findEntityByName(request.storyId, profile.who);
				items.push(
					contextItem(
						profile.who,
						estimator(block),
						entity === null
							? {
									kind: "scene",
									nodeId:
										profile.lastScene?.endNodeId ??
										archives[0]?.endNodeId ??
										nodeId,
								}
							: { kind: "wiki", id: entity.id, name: profile.who },
					),
				);
			}
			const knows =
				readStoryFeatureState(store, request.storyId, request.featureOverrides)
					.values.knows === true;
			const annotatedScenes = knows
				? readSceneKnowledge(store, nodeId)
						.facts.slice(-sceneLimit)
						.filter((fact) => fact.uninformed.length > 0)
				: [];
			const sections: string[] = [];
			if (blocks.length > 0) {
				sections.push(`人物档案：\n${blocks.join("\n\n")}`);
			}
			if (annotatedScenes.length > 0) {
				const lines = annotatedScenes.map(
					(fact) =>
						`- 场次 ${fact.endNodeId}（${clipProfileSummary(fact.summary)}）：${fact.uninformed.join("、")}不在场、不知情`,
				);
				sections.push(`知情标注：\n${lines.join("\n")}`);
				for (const fact of annotatedScenes) {
					items.push(
						contextItem(
							`场次 ${fact.endNodeId} 的知情标注`,
							estimator(
								`${clipProfileSummary(fact.summary)}：${fact.uninformed.join("、")}`,
							),
							{ kind: "scene", nodeId: fact.endNodeId },
						),
					);
				}
			}
			if (sections.length === 0) return null;
			return {
				messages: [{ role: "system", content: sections.join("\n\n") }],
				source: `profile:${blocks.length} 人，知情标注 ${annotatedScenes.length} 场`,
				items,
			};
		},
	};
}

/** 重逢注入的配置；导演建议只在线组织方式下作为「被安排登场」的触发文本。 */
export interface ReunionSlotProviderOptions {
	/** 「最近窗口」的楼数；不设置时与默认历史窗口一致。 */
	readonly recentFloors?: number;
	/** 每个人物最多列出的未了结事项条数，默认 3。 */
	readonly unresolvedLimit?: number;
	readonly directorConfig?: DirectorConfig;
	readonly directorOrganization?: DirectorOrganizationKind;
	/** 单轮推进档位；随导演槽位一起重建。 */
	readonly directorPush?: DirectorPush | null;
}

export interface ReunionSlotProvider extends ContextSlotProvider {
	readonly options: ReunionSlotProviderOptions;
}

export function isReunionSlotProvider(
	value: ContextSlotProvider | undefined,
): value is ReunionSlotProvider {
	return value !== undefined && "options" in value;
}

/**
 * 久未出场的人物、地点与物品被提到或被导演安排登场时，注入它们的档案：
 * 上次出场的场次、当时的关系与未了结的事。触发是纯程序判断，不调用模型。
 */
export function createReunionSlotProvider(
	store: StoryStore,
	options: ReunionSlotProviderOptions = {},
): ReunionSlotProvider {
	const unresolvedLimit =
		options.unresolvedLimit ?? DEFAULT_REUNION_UNRESOLVED_LIMIT;
	if (!Number.isInteger(unresolvedLimit) || unresolvedLimit < 1) {
		throw new Error("重逢注入的未了结条数上限必须是正整数");
	}
	const config = options.directorConfig ?? DEFAULT_DIRECTOR_CONFIG;
	const organization =
		options.directorOrganization ?? DEFAULT_DIRECTOR_ORGANIZATION;
	const push = options.directorPush ?? null;
	const providerOptions: ReunionSlotProviderOptions = {
		...options,
		recentFloors: options.recentFloors,
		unresolvedLimit,
		directorConfig: config,
		directorOrganization: organization,
		directorPush: push,
	};
	const estimator = createTokenEstimator();
	return {
		options: providerOptions,
		packKey: JSON.stringify({
			recentFloors: providerOptions.recentFloors ?? null,
			unresolvedLimit,
			director: { config, organization, push },
		}),
		provide(request): ContextSlotContent | null {
			const nodeId =
				request.nodeId ?? store.getHead(request.storyId)?.id ?? null;
			if (nodeId === null) return null;
			if (
				readStoryFeatureState(store, request.storyId, request.featureOverrides)
					.values.reunion !== true
			)
				return null;
			const path = store.getPathToNode(nodeId);
			const lastUser = [...path].reverse().find((node) => node.role === "user");
			const trigger: string[] = [];
			if (lastUser !== undefined) trigger.push(lastUser.raw);
			const when = readStoryFeatureState(
				store,
				request.storyId,
				request.featureOverrides,
			).values.director;
			if (organization === "lines" && config.mode !== "off" && when !== "off") {
				const selection = selectDirectorAction(
					readDirectorActionInput(
						store,
						request.storyId,
						nodeId,
						config,
						push,
						when,
					),
				);
				if (selection !== null && selection.directive !== "") {
					trigger.push(selection.directive);
				}
			}
			if (trigger.length === 0) return null;
			const mentions = selectReunionMentions({
				store,
				storyId: request.storyId,
				nodeId,
				triggerText: trigger.join("\n"),
				...(providerOptions.recentFloors === undefined
					? {}
					: { recentFloors: providerOptions.recentFloors }),
			});
			if (mentions.length === 0) return null;
			const counts = new Map<string, number>();
			for (const mention of mentions) {
				const label = REUNION_KIND_LABELS[mention.candidate.kind];
				counts.set(label, (counts.get(label) ?? 0) + 1);
			}
			const summary = [...counts.entries()]
				.map(([label, count]) => `${label} ${count}`)
				.join("、");
			const items = mentions.map((mention) => {
				const candidate = mention.candidate;
				const entity = store.findEntityByName(request.storyId, candidate.name);
				return contextItem(
					candidate.name,
					estimator(formatReunionMention(mention)),
					entity === null
						? { kind: "scene", nodeId: candidate.lastScene.endNodeId }
						: { kind: "wiki", id: entity.id, name: candidate.name },
				);
			});
			return {
				messages: [
					{
						role: "system",
						content: `重逢档案：\n${mentions.map(formatReunionMention).join("\n\n")}`,
					},
				],
				source: `reunion:${summary}`,
				items,
			};
		},
	};
}

/** 用户意志在提示词里的类别标签。 */
const USER_WILL_LABELS: Readonly<Record<UserWillKind, string>> = {
	preference: "偏好",
	boundary: "底线",
	correction: "纠正",
};

interface UserWillLine {
	readonly id: string;
	readonly kind: UserWillKind;
	readonly text: string;
	readonly createdAt: string;
}

/**
 * 取当前路径上的用户意志条目；分支切换后只出现当前分支写入的条目。
 * 没有条目时返回 null，由 Trace 记为缺失槽位。
 */
export function createUserWillSlotProvider(
	store: StoryStore,
): ContextSlotProvider {
	const estimator = createTokenEstimator();
	return {
		packKey: "userWill",
		provide(request): ContextSlotContent | null {
			if (request.nodeId === null) return null;
			const value = readLedger(store, request.nodeId, ["userWill"]);
			if (!isJsonObject(value)) return null;
			const entries: UserWillLine[] = [];
			for (const [id, entry] of Object.entries(value)) {
				if (!isJsonObject(entry)) continue;
				const kind = entry.kind;
				const text = entry.text;
				if (
					typeof kind !== "string" ||
					!(USER_WILL_KINDS as readonly string[]).includes(kind)
				) {
					continue;
				}
				if (typeof text !== "string" || text.trim().length === 0) continue;
				const createdAt =
					typeof entry.createdAt === "string" ? entry.createdAt : "";
				entries.push({ id, kind: kind as UserWillKind, text, createdAt });
			}
			if (entries.length === 0) return null;
			entries.sort(
				(left, right) =>
					left.createdAt.localeCompare(right.createdAt) ||
					left.id.localeCompare(right.id),
			);
			const lines = entries.map(
				(entry) => `- 【${USER_WILL_LABELS[entry.kind]}】${entry.text}`,
			);
			return {
				messages: [
					{ role: "system", content: `用户意志：\n${lines.join("\n")}` },
				],
				source: `userWill:${entries.length} 条`,
				items: entries.map((entry, index) =>
					contextItem(
						`${USER_WILL_LABELS[entry.kind]}：${entry.text}`,
						estimator(lines[index] ?? entry.text),
						{ kind: "pref", id: entry.id },
					),
				),
			};
		},
	};
}

export interface MemorySlotProviderOptions {
	/** 最多注入多少条检索结果，默认 6。 */
	readonly limit?: number;
	/** 有 embedding 客户端时启用向量路；没有时只走其余各路。 */
	readonly embedder?: EmbeddingClient | null;
	/** 融合后的可选重排序客户端。 */
	readonly reranker?: RerankClient | null;
	/** 判断整个故事是否还放得下上下文时使用；默认按字符估算。 */
	readonly tokenEstimator?: TokenEstimator;
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
	const reranker = options.reranker ?? null;
	const estimator = options.tokenEstimator ?? createTokenEstimator();
	return {
		packKey: JSON.stringify({
			limit,
			embedder: embedder !== null,
			reranker: reranker !== null,
		}),
		async provide(request): Promise<ContextSlotContent | null> {
			if (request.nodeId === null) return null;
			if (
				readStoryFeatureState(store, request.storyId, request.featureOverrides)
					.values.search !== true
			)
				return null;
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
			// 整个故事都放得下、并且原文窗口能带全时，检索只会重复注入同一批内容。
			if (
				request.budgetTokens !== undefined &&
				pathBefore.length <= DEFAULT_HISTORY_LIMIT
			) {
				const storyTokens = pathBefore.reduce(
					(total, node) => total + estimator(node.raw),
					0,
				);
				if (storyTokens <= request.budgetTokens) return null;
			}
			const eventsByNode = new Map<string, { id: string; text: string }[]>();
			const eventTimes = new Map<string, string | null>();
			for (const event of store.getEventsForPath(lastBefore.id, {
				limit: MAX_MEMORY_EVENT_LIMIT,
			})) {
				const events = eventsByNode.get(event.sourceNodeId);
				if (events === undefined) {
					eventsByNode.set(event.sourceNodeId, [
						{ id: event.id, text: event.text },
					]);
				} else {
					events.push({ id: event.id, text: event.text });
				}
				if (!eventTimes.has(event.sourceNodeId)) {
					eventTimes.set(event.sourceNodeId, event.storyTime);
				}
			}
			const presentNames: string[] = [];
			const sceneLog = store.getLatestSceneLogOnPath(request.nodeId);
			if (sceneLog !== null) {
				presentNames.push(...sceneLog.present);
			} else {
				const archives = store.listSceneArchivesAlongPath(request.nodeId);
				const latest = archives[archives.length - 1];
				if (latest !== undefined) presentNames.push(...latest.present);
			}

			const result = await retrieveMemory({
				store,
				embedder,
				reranker,
				storyId: request.storyId,
				query: current.raw,
				beforeNodeId: request.nodeId,
				limit,
				entityNames: presentNames,
			});

			const positions = new Map(
				pathBefore.map((node, index) => [node.id, index] as const),
			);
			const seen = new Set<string>();
			const injectedNodeIds: string[] = [];
			const injected: RetrievalInjectionTrace[] = [];
			const lines: string[] = [];
			const orderedHits = [...result.hits].sort((left, right) => {
				const leftTime = eventTimes.get(left.nodeId)?.trim() ?? "";
				const rightTime = eventTimes.get(right.nodeId)?.trim() ?? "";
				if (leftTime !== rightTime) {
					if (leftTime.length === 0) return 1;
					if (rightTime.length === 0) return -1;
					return leftTime < rightTime ? -1 : 1;
				}
				const leftPosition = positions.get(left.nodeId) ?? -1;
				const rightPosition = positions.get(right.nodeId) ?? -1;
				return leftPosition - rightPosition;
			});
			const items: ContextTraceItem[] = [];
			for (const hit of orderedHits) {
				if (seen.has(hit.nodeId)) continue;
				seen.add(hit.nodeId);
				const sourceNode = store.getNode(hit.nodeId);
				if (!sourceNode) {
					throw new Error(`检索结果引用了不存在的楼层：${hit.nodeId}`);
				}
				let text: string;
				if (hit.kind === "event") {
					const events = eventsByNode.get(hit.nodeId);
					if (events === undefined) {
						throw new Error(
							`检索结果把楼层 ${hit.nodeId} 标为事件，但该楼层没有事件正文`,
						);
					}
					text = events.map((event) => event.text).join("；");
				} else if (hit.parentText !== null) {
					text = hit.parentText;
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
				injectedNodeIds.push(hit.nodeId);
				const scope =
					hit.kind === "chunk" &&
					hit.parentText !== null &&
					store.countChunkParentsForNode(hit.nodeId) > 1
						? "segment"
						: "floor";
				injected.push({
					nodeId: hit.nodeId,
					kind: hit.kind,
					scope,
					parentOrdinal: hit.parentOrdinal,
				});
				const kind = hit.kind === "event" ? "事件" : "原文块";
				const line = `- 楼层 ${hit.nodeId}（${kind}）：${text}`;
				lines.push(line);
				const floorNo = (positions.get(hit.nodeId) ?? -1) + 1;
				if (hit.kind === "event") {
					const events = eventsByNode.get(hit.nodeId) ?? [];
					items.push(
						contextItem(`第 ${floorNo} 楼 · 事件`, estimator(text), {
							kind: "record",
							ids: events.map((event) => event.id),
							nodeId: hit.nodeId,
							floorNo,
						}),
					);
				} else {
					items.push(
						contextItem(`第 ${floorNo} 楼 · 原文`, estimator(text), {
							kind: "floor",
							nodeId: hit.nodeId,
							floorNo,
						}),
					);
				}
			}
			if (lines.length === 0) return null;
			return {
				messages: [
					{
						role: "system",
						content: `相关记忆（按故事时间排序）：\n${lines.join("\n")}`,
					},
				],
				source: `memory:${lines.length}`,
				retrieval: {
					routes: result.routes,
					hits: result.hits,
					injectedNodeIds,
					injected,
				},
				items,
			};
		},
	};
}

export interface SummarySlotProviderOptions {
	/** 摘要段占用的 token 上限，默认 800。 */
	readonly tokenLimit?: number;
	/** 八段式压缩占用的 token 上限，默认 2,000。 */
	readonly compressionTokenLimit?: number;
	readonly tokenEstimator?: TokenEstimator;
}
export const DEFAULT_SUMMARY_TOKEN_LIMIT = 800;
/** 实测三份 20 楼章节压缩为 1,146、1,210、1,491 token，默认预算要容得下完整八段。 */
export const DEFAULT_COMPRESSION_TOKEN_LIMIT = 2_000;

const SUMMARY_HEADER = "故事摘要：";
const COMPRESSION_HEADER = "故事压缩：";

function formatCompressionForPrompt(
	compression: ChapterCompression,
	willOnly: boolean,
): string {
	const label = compression.level === "mainline" ? "主线压缩" : "章节压缩";
	if (willOnly) {
		return `【${label}·用户意志】\n【用户意志】\n${compression.sections.用户意志}`;
	}
	return `【${label}】\n${formatCompressionSections(compression.sections)}`;
}

/**
 * 主线压缩全部注入，另加最近一条章节压缩；整段放不进预算时退化为只保留
 * 该压缩的用户意志段，用户意志段不受预算裁剪。
 */
function buildCompressionSlotContent(
	store: StoryStore,
	compressions: readonly ChapterCompression[],
	headNodeId: string,
	tokenLimit: number,
	estimator: TokenEstimator,
): ContextSlotContent | null {
	const latestChapter = compressions
		.filter((compression) => compression.level === "chapter")
		.at(-1);
	const mainlines = compressions.filter(
		(compression) => compression.level === "mainline",
	);
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
	let used = estimator(COMPRESSION_HEADER);
	const full = new Set<string>();
	const willOnly = new Set<string>();
	for (const compression of byRecency) {
		const fullTokens = estimator(
			formatCompressionForPrompt(compression, false),
		);
		if (used + fullTokens <= tokenLimit) {
			used += fullTokens;
			full.add(compression.id);
			continue;
		}
		used += estimator(formatCompressionForPrompt(compression, true));
		willOnly.add(compression.id);
	}
	const keptMainlines = mainlines.filter(
		(compression) => full.has(compression.id) || willOnly.has(compression.id),
	);
	const chapterKept =
		latestChapter !== undefined &&
		(full.has(latestChapter.id) || willOnly.has(latestChapter.id));
	const lines = [COMPRESSION_HEADER];
	const items: ContextTraceItem[] = [];
	for (const compression of keptMainlines) {
		const text = formatCompressionForPrompt(
			compression,
			!full.has(compression.id),
		);
		lines.push(text);
		items.push(
			contextItem(
				compression.level === "mainline" ? "主线压缩" : "章节压缩",
				estimator(text),
				{ kind: "summary", id: compression.id },
			),
		);
	}
	if (chapterKept && latestChapter !== undefined) {
		const text = formatCompressionForPrompt(
			latestChapter,
			!full.has(latestChapter.id),
		);
		lines.push(text);
		items.push(
			contextItem("章节压缩", estimator(text), {
				kind: "summary",
				id: latestChapter.id,
			}),
		);
	}
	const levels: SummaryLevel[] = [];
	if (keptMainlines.length > 0) levels.push("mainline");
	if (chapterKept) levels.push("chapter");
	return {
		messages: [{ role: "system", content: lines.join("\n") }],
		source: `compression:${levels.join("+")}`,
		items,
	};
}

/**
 * 返回当前分支下有效的主线摘要与最近一条章节摘要；超过 token 上限时
 * 从最久远的摘要开始丢弃。存在有效压缩时改为注入压缩，压缩段按
 * `compressionTokenLimit` 裁剪，用户意志段不裁剪。
 */
export function createSummarySlotProvider(
	store: StoryStore,
	options: SummarySlotProviderOptions = {},
): ContextSlotProvider {
	const tokenLimit = options.tokenLimit ?? DEFAULT_SUMMARY_TOKEN_LIMIT;
	const compressionTokenLimit =
		options.compressionTokenLimit ?? DEFAULT_COMPRESSION_TOKEN_LIMIT;
	if (!Number.isInteger(tokenLimit) || tokenLimit < 1) {
		throw new Error("摘要槽位的 token 上限必须是正整数");
	}
	if (!Number.isInteger(compressionTokenLimit) || compressionTokenLimit < 1) {
		throw new Error("压缩槽位的 token 上限必须是正整数");
	}
	const estimator = options.tokenEstimator ?? createTokenEstimator();
	const header = SUMMARY_HEADER;
	return {
		packKey: `summary:${tokenLimit}:${compressionTokenLimit}`,
		provide(request): ContextSlotContent | null {
			const headNodeId =
				request.nodeId ?? store.getHead(request.storyId)?.id ?? null;
			if (headNodeId === null) return null;
			const compressions = store.getValidCompressions(
				request.storyId,
				headNodeId,
			);
			if (compressions.length > 0) {
				return buildCompressionSlotContent(
					store,
					compressions,
					headNodeId,
					compressionTokenLimit,
					estimator,
				);
			}
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
			const keptTokens = new Map<string, number>();
			for (const summary of byRecency) {
				const tokens = estimator(summary.text);
				if (used + tokens > tokenLimit) continue;
				used += tokens;
				kept.add(summary.id);
				keptTokens.set(summary.id, tokens);
			}
			if (kept.size === 0) return null;

			const lines = [header];
			const items: ContextTraceItem[] = [];
			const keptMainlines = mainlines.filter((summary) => kept.has(summary.id));
			for (const summary of keptMainlines) {
				lines.push(`【主线】${summary.text}`);
			}
			const chapterKept =
				latestChapter !== undefined && kept.has(latestChapter.id);
			if (chapterKept && latestChapter !== undefined) {
				lines.push(`【章节】${latestChapter.text}`);
			}
			for (const summary of keptMainlines) {
				items.push(
					contextItem("主线摘要", keptTokens.get(summary.id) ?? 0, {
						kind: "summary",
						id: summary.id,
					}),
				);
			}
			if (chapterKept && latestChapter !== undefined) {
				items.push(
					contextItem("章节摘要", keptTokens.get(latestChapter.id) ?? 0, {
						kind: "summary",
						id: latestChapter.id,
					}),
				);
			}
			const levels: SummaryLevel[] = [];
			if (keptMainlines.length > 0) levels.push("mainline");
			if (chapterKept) levels.push("chapter");
			return {
				messages: [{ role: "system", content: lines.join("\n") }],
				source: `summary:${levels.join("+")}`,
				items,
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
	readonly id: string;
	/** 每轮都注入的常驻集合；超出预算时先删命中条目 */
	readonly base: boolean;
	readonly line: string;
	readonly tokens: number;
}

export interface LoreInjectionRole {
	/** 每轮都注入的行；`index` 只带标题与关键词 */
	readonly base: "full" | "index" | null;
	/** 命中当前楼层时是否再注入一条 */
	readonly matched: boolean;
}

/**
 * 一条世界书条目在本轮的注入方式。没有分型记录的条目（不是从导入来的）与
 * 原样模式都按导入时的常驻标记处理；升级模式按生效类型决定，已转成初始记忆
 * 的条目只按命中注入。
 */
export function resolveLoreInjectionRole(
	entry: LoreEntry,
	mode: "upgrade" | "raw",
	rule: ImportAuditInjectionRule | undefined,
	options: { readonly style?: boolean } = {},
): LoreInjectionRole {
	if (rule?.memory === true) return { base: null, matched: true };
	if (rule === undefined || mode === "raw") {
		return entry.constant
			? { base: "full", matched: false }
			: { base: null, matched: true };
	}
	switch (rule.kind) {
		case "common":
			return { base: "full", matched: false };
		case "entity":
			return { base: "index", matched: true };
		case "rule":
			return { base: null, matched: true };
		// 文风类条目（卡自带的文风与格式要求）只由功能页的「写作指令层」决定：
		// 开着时每轮常驻，关着时不注入（DESIGN §22）。
		case "writing":
			return options.style === true
				? { base: "full", matched: false }
				: { base: null, matched: false };
		default:
			return { base: null, matched: false };
	}
}

function loreInjectionPrefix(
	mode: "upgrade" | "raw",
	rule: ImportAuditInjectionRule | undefined,
	base: boolean,
): string {
	if (!base) {
		if (rule?.memory === true) return "【记忆】";
		if (mode === "upgrade" && rule !== undefined) {
			if (rule.kind === "entity") return "【实体】";
			if (rule.kind === "rule") return "【规则】";
		}
		return "【检索】";
	}
	if (mode === "upgrade" && rule !== undefined) {
		if (rule.kind === "writing") return "【文风】";
		return rule.kind === "entity" ? "【索引】" : "【常识】";
	}
	return "【常驻】";
}

/**
 * 常驻世界书条目每轮都注入；其余条目用当前楼层的原文匹配关键词与关联实体的
 * 名称和别名，只有命中的条目才出现。升级模式按导入分型决定注入集合：常识全文
 * 与实体索引常驻，规则与实体详情在命中时注入，已转成初始记忆的条目只按命中
 * 注入。超出 token 上限时先从后往前删除命中条目，常驻条目最后才裁。
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
		packKey: `lore:${tokenLimit}`,
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
			const entries = readEffectiveLore(store, request.storyId, nodeId);
			if (entries.length === 0) return null;

			const mode = store.getStorySettings(request.storyId).importMode;
			const style =
				readStoryFeatureState(store, request.storyId, request.featureOverrides)
					.values.style === true;
			const rules = new Map(
				store
					.listImportAuditInjectionRules(request.storyId)
					.map((rule) => [rule.source, rule] as const),
			);
			const roles = new Map(
				entries.map((entry) => {
					const rule = rules.get(entry.source);
					return [
						entry.id,
						{
							rule,
							role: resolveLoreInjectionRole(entry, mode, rule, { style }),
						},
					] as const;
				}),
			);

			const prefilter =
				nodeId === null
					? null
					: readLorePrefilterForRequest(store, request.storyId, nodeId);
			const matchedEntries: LoreEntry[] = [];
			if (prefilter !== null) {
				const byId = new Map(
					entries.map((entry) => [entry.id, entry] as const),
				);
				for (const id of prefilter.entryIds) {
					const entry = byId.get(id);
					if (entry === undefined) continue;
					if (!(roles.get(entry.id)?.role.matched ?? false)) continue;
					matchedEntries.push(entry);
				}
			} else {
				const scored: { entry: LoreEntry; score: number }[] = [];
				for (const entry of entries) {
					if (!(roles.get(entry.id)?.role.matched ?? false)) continue;
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
					if (score > 0) scored.push({ entry, score });
				}
				scored.sort((left, right) => right.score - left.score);
				matchedEntries.push(...scored.map((match) => match.entry));
			}

			const selected: SelectedLoreLine[] = [];
			const selectedByEntryId = new Map<string, number>();
			const seenEntities = new Set<string>();
			const seenContents = new Set<string>();
			for (const entry of entries) {
				const resolved = roles.get(entry.id);
				if (resolved === undefined || resolved.role.base === null) continue;
				if (entry.entityId !== null) {
					if (seenEntities.has(entry.entityId)) continue;
					seenEntities.add(entry.entityId);
				}
				const contentKey = loreEntryContentKey(entry);
				if (seenContents.has(contentKey)) continue;
				seenContents.add(contentKey);
				const prefix = loreInjectionPrefix(mode, resolved.rule, true);
				const body =
					resolved.role.base === "index"
						? entry.keywords.length === 0
							? entry.name
							: `${entry.name}：${entry.keywords.join("、")}`
						: `${entry.name}：${entry.content}`;
				const line = `${prefix}${body}`;
				selectedByEntryId.set(entry.id, selected.length);
				selected.push({
					id: entry.id,
					base: true,
					line,
					tokens: estimator(line),
				});
			}

			for (const entry of matchedEntries) {
				const resolved = roles.get(entry.id);
				if (resolved === undefined) continue;
				const prefix = loreInjectionPrefix(mode, resolved.rule, false);
				const line = `${prefix}${entry.name}：${entry.content}`;
				const existing = selectedByEntryId.get(entry.id);
				if (existing !== undefined) {
					selected[existing] = {
						id: entry.id,
						base: true,
						line,
						tokens: estimator(line),
					};
					continue;
				}
				if (entry.entityId !== null) {
					if (seenEntities.has(entry.entityId)) continue;
					seenEntities.add(entry.entityId);
				}
				const contentKey = loreEntryContentKey(entry);
				if (seenContents.has(contentKey)) continue;
				seenContents.add(contentKey);
				selected.push({
					id: entry.id,
					base: false,
					line,
					tokens: estimator(line),
				});
			}
			if (selected.length === 0) return null;

			let total = estimator(header);
			for (const item of selected) total += item.tokens;
			while (total > tokenLimit) {
				let index = lastIndexWhere(selected, (item) => !item.base);
				if (index < 0) index = selected.length - 1;
				if (index < 0) break;
				total -= selected[index]?.tokens ?? 0;
				selected.splice(index, 1);
			}
			if (selected.length === 0) return null;

			const baseKept = selected.filter((item) => item.base).length;
			const retrievedKept = selected.length - baseKept;
			const modeTag =
				rules.size === 0 ? "" : mode === "raw" ? "原样 " : "升级 ";
			const entryById = new Map(
				entries.map((entry) => [entry.id, entry] as const),
			);
			const items: ContextTraceItem[] = [];
			for (const item of selected) {
				const entry = entryById.get(item.id);
				if (entry === undefined) continue;
				items.push(
					contextItem(item.line, item.tokens, {
						kind: "lore",
						id: entry.id,
						name: entry.name,
					}),
				);
			}
			return {
				messages: [
					{
						role: "system",
						content: [header, ...selected.map((item) => item.line)].join("\n"),
					},
				],
				source: `lore:${modeTag}常驻 ${baseKept} 条、检索 ${retrievedKept} 条`,
				references: {
					loreEntryIds: selected.map((item) => item.id),
				},
				items,
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

/**
 * 预筛结果写在回合落定后的助手楼层上；下一轮组装的参照楼层是新的用户楼层，
 * 所以先看参照楼层本身，再回退到它的父楼层。没有记录时返回 null，由关键词与
 * 实体命中兜底。
 */
function readLorePrefilterForRequest(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): LorePrefilter | null {
	const node = store.getNode(nodeId);
	if (!node) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const own = store.getLorePrefilter(nodeId);
	if (own !== null) return own;
	if (node.parentId === null) return null;
	const parent = store.getLorePrefilter(node.parentId);
	return parent !== null && parent.storyId === storyId ? parent : null;
}

export interface DirectorSlotProviderOptions {
	/** 不设置时使用默认配置（透明模式、线索阈值 12 楼、上限 5 条）。 */
	readonly config?: DirectorConfig;
	/** 机制型引擎使用的机制序列；其他组织方式忽略。 */
	readonly mechanisms?: readonly DirectorMechanism[];
	/** 导演的组织方式；不设置时使用现有机制序列。 */
	readonly organization?: DirectorOrganizationKind;
	/** 复用已有引擎；单轮强度覆盖时用它保留同一套组织方式。 */
	readonly engine?: DirectorEngine;
	/** 单轮的推进档位；不设置时是常规回合。 */
	readonly push?: DirectorPush | null;
	/** 导演何时出手；不设置时读故事的「导演」功能开关。 */
	readonly when?: "off" | DirectorWhen;
}

/** 导演槽位把评估用的配置与引擎一起带出来，单轮强度覆盖时据此重建。 */
export interface DirectorSlotProvider extends ContextSlotProvider {
	readonly config: DirectorConfig;
	readonly engine: DirectorEngine;
	readonly push: DirectorPush | null;
	/** 显式指定的出手时机；null 表示每次读故事的「导演」功能开关。 */
	readonly when: "off" | DirectorWhen | null;
}

export function isDirectorSlotProvider(
	value: ContextSlotProvider,
): value is DirectorSlotProvider {
	if (!("config" in value)) return false;
	return value.config !== undefined;
}

/** 导演建议拼进玩家消息末尾时统一附上的尾注。 */
export const DIRECTOR_SUFFIX_NOTE = "玩家行动优先，你可以按剧情需要调整。";

/**
 * 按组织方式评估导演，有建议时返回一段拼接到本轮最后一条玩家消息末尾的 suffix。
 * 评估结果写入该楼层的决策记录；mode 为 off 时既不产出 suffix 也不写记录。
 */
export function createDirectorSlotProvider(
	store: StoryStore,
	options: DirectorSlotProviderOptions = {},
): DirectorSlotProvider {
	const config = options.config ?? DEFAULT_DIRECTOR_CONFIG;
	const engine =
		options.engine ??
		createDirectorEngine(
			options.organization ?? DEFAULT_DIRECTOR_ORGANIZATION,
			{ mechanisms: options.mechanisms },
		);
	const estimator = createTokenEstimator();
	return {
		config,
		engine,
		push: options.push ?? null,
		when: options.when ?? null,
		packKey: JSON.stringify({
			config,
			organization: engine.kind,
			mechanisms: engine.mechanismNames,
			push: options.push ?? null,
		}),
		provide(request): ContextSlotContent | null {
			const nodeId =
				request.nodeId ?? store.getHead(request.storyId)?.id ?? null;
			if (nodeId === null) return null;
			// 「导演」功能开关决定何时出手：关闭时不评估，仅推进时由引擎让位。
			const when =
				options.when ??
				readStoryFeatureState(store, request.storyId, request.featureOverrides)
					.values.director;
			if (when === "off") return null;
			const suggestion = engine.evaluate({
				store,
				storyId: request.storyId,
				nodeId,
				config,
				push: options.push ?? null,
				when,
			});
			if (suggestion === null) return null;
			const suffix = `【导演】${suggestion.directive}\n${DIRECTOR_SUFFIX_NOTE}`;
			return {
				messages: [],
				suffix,
				source: `director:${suggestion.mechanism}`,
				items: [
					contextItem(suggestion.mechanism, estimator(suffix), {
						kind: "outline",
						id: "director",
					}),
				],
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
	const estimator = createTokenEstimator();
	return {
		packKey: `character:${characterPrompt}`,
		provide(): ContextSlotContent {
			return {
				messages: [{ role: "system", content: characterPrompt }],
				source: `character:${characterPrompt.length} 字符`,
				items: [
					contextItem("角色卡", estimator(characterPrompt), {
						kind: "card",
						id: "character",
					}),
				],
			};
		},
	};
}

/** persona 槽位使用故事设置里的玩家人设；来源只记录长度，不重复正文。 */
export function createPersonaSlotProvider(
	persona: string,
): ContextSlotProvider {
	if (typeof persona !== "string" || persona.trim().length === 0) {
		throw new Error("persona 必须是非空字符串");
	}
	const estimator = createTokenEstimator();
	return {
		packKey: `persona:${persona}`,
		provide(): ContextSlotContent {
			return {
				messages: [{ role: "system", content: persona }],
				source: `persona:${persona.length} 字符`,
				items: [
					contextItem("玩家人设", estimator(persona), {
						kind: "card",
						id: "persona",
					}),
				],
			};
		},
	};
}

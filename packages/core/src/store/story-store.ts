import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import {
	ASSISTANT_ACTION_KINDS,
	type AssistantAction,
	type AssistantActionKind,
	type AssistantActionStatus,
	AssistantConversationHasPendingActionsError,
	DEFAULT_ASSISTANT_ACTION_LIST_LIMIT,
	type ListAssistantActionsOptions,
	type NewAssistantActionInput,
	assertAssistantActionKind,
	assertAssistantActionListLimit,
	assertAssistantActionPayload,
	assertAssistantActionStatus,
	canonicalAssistantActionPayload,
	isAssistantActionStatus,
} from "../assistant/actions.js";
import {
	ASSISTANT_EVENT_KINDS,
	type AssistantCompaction,
	type AssistantConversation,
	type AssistantConversationSearchOptions,
	type AssistantConversationStatus,
	type AssistantConversationUpdate,
	type AssistantEvent,
	type AssistantEventKind,
	type AssistantMessage,
	AssistantRunConflictError,
	type AssistantSearchHit,
	DEFAULT_ASSISTANT_COMPACTION_THRESHOLD,
	DEFAULT_ASSISTANT_CONTEXT_BUDGET,
	DEFAULT_ASSISTANT_LIST_LIMIT,
	DEFAULT_ASSISTANT_PERMISSION,
	DEFAULT_ASSISTANT_THINKING,
	DEFAULT_ASSISTANT_TITLE,
	type ListAssistantConversationsOptions,
	type ListAssistantEventsOptions,
	type NewAssistantCompactionInput,
	type NewAssistantConversationInput,
	type NewAssistantMessageInput,
	assertAssistantCompactionThreshold,
	assertAssistantContextBudget,
	assertAssistantConversationStatus,
	assertAssistantEventKind,
	assertAssistantListLimit,
	assertAssistantMessageOrdinals,
	assertAssistantMessageRole,
	assertAssistantPermission,
	assertAssistantThinking,
} from "../assistant/types.js";
import {
	type BackgroundJob,
	type BackgroundJobCounts,
	type BackgroundJobEnqueueCondition,
	type BackgroundJobStatus,
	isBackgroundJobEnqueueCondition,
} from "../background/types.js";
import {
	type HistoryBlockPolicy,
	assertHistoryBlockPolicy,
} from "../blocks/history.js";
import { type TurnMode, isTurnMode } from "../chat/mode.js";
import { parseContextCondition } from "../context/condition.js";
import {
	type ContextPack,
	type ContextPackPayload,
	type NewContextPackInput,
	parseContextPackPayload,
	serializeContextPackPayload,
} from "../context/pack-format.js";
import {
	type ContextCondition,
	type ContextTemplate,
	DEFAULT_CONTEXT_TEMPLATE_ID,
} from "../context/template.js";
import {
	type DirectorCandidateAction,
	type ReplaceDirectorCandidateActionsOptions,
	isDirectorCandidateKind,
} from "../director/candidates.js";
import { assertDirectorConfig } from "../director/evaluate.js";
import {
	type DirectorNoteDiff,
	type DirectorNoteEntry,
	type DirectorNoteRecord,
	type NewDirectorNoteInput,
	applyDirectorNoteDiffs,
	assertDirectorNoteDiffs,
} from "../director/notes.js";
import {
	type DirectorBeatState,
	type DirectorPlan,
	type DirectorPlanEntries,
	type DirectorPlanMergeResult,
	type DirectorPlanMergeSource,
	type DirectorPlanSource,
	type NewDirectorBeatStateInput,
	type StoredDirectorArc,
	type StoredDirectorBeat,
	type StoredDirectorSequence,
	isDirectorPlanSource,
	parseDirectorPlan,
} from "../director/plan.js";
import type {
	AdvanceNpcAgendasInput,
	EventPoolEntry,
	EventPoolUpsertResult,
	NewEventPoolEntryInput,
	NewNpcAgendaInput,
	NpcAgenda,
	NpcAgendaUpsertResult,
} from "../director/pool.js";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorConfig,
	type DirectorDecision,
	type DirectorMechanismRecord,
	type NewDirectorDecisionInput,
} from "../director/types.js";
import {
	type Entity,
	type EntityKind,
	type NewEntityInput,
	isEntityKind,
	normalizeEntityName,
} from "../entity.js";
import { validateImagePromptRequest } from "../images/request.js";
import { assertComfyUiSlots, parseComfyUiWorkflow } from "../images/slots.js";
import {
	type CharacterVisualProfileRecord,
	DEFAULT_IMAGE_CONFIG,
	type ImageConfig,
	ImageWorkflowInUseError,
	type ImageWorkflowRecord,
	type NewNodeImageInput,
	type NodeImageRecord,
	type SaveCharacterVisualProfilesInput,
	type SaveImageWorkflowInput,
	assertCharacterVisualProfile,
	assertImageConfig,
	assertUniqueVisualProfiles,
	isNodeImageStatus,
	isVisualProfileSource,
} from "../images/types.js";
import {
	type JsonObject,
	type JsonValue,
	assertJsonValue,
	assertPlainObject,
	isJsonObject,
	rejectUnknownKeys,
} from "../json.js";
import {
	LEDGER_CHANGE_CARD_SOURCES,
	LEDGER_CHANGE_CARD_STATUSES,
	type LedgerChangeCard,
	type LedgerChangeCardSource,
	type LedgerChangeCardStatus,
	type NewLedgerChangeCardInput,
	assertLedgerBeforeEntries,
	assertLedgerChangeCardDiffs,
	isLedgerChangeCardStatus,
} from "../ledger/cards.js";
import {
	type GapPassRun,
	type NewGapPassRun,
	assertGapPassDroppedEntries,
	assertGapPassRejections,
} from "../ledger/gap-pass.js";
import {
	LEDGER_SOURCES,
	type LedgerSource,
	assertLedgerConfidence,
} from "../ledger/schema.js";
import {
	type EntityCandidate,
	type LedgerRepair,
	type LedgerSettlement,
	type NewEntityCandidateInput,
	type NewLedgerSettlement,
	assertLedgerRepairs,
} from "../ledger/settlement.js";
import { isLlmReasoningLevel } from "../llm/types.js";
import {
	type ChapterCompression,
	type NewChapterCompressionInput,
	assertCompressionSections,
	formatCompressionSections,
	isCompressionLevel,
} from "../memory/compression.js";
import {
	DEFAULT_MEMORY_EVENT_LIMIT,
	DEFAULT_MEMORY_EVENT_SOURCE,
	type GetEventsForPathOptions,
	MAX_MEMORY_EVENT_LIMIT,
	type MemoryEvent,
	NPC_AGENDA_EVENT_SOURCE,
	type NewMemoryEventInput,
} from "../memory/event.js";
import type {
	LoreEntry,
	LorePrefilter,
	NewLoreEntryInput,
	NewLorePrefilterInput,
} from "../memory/lore.js";
import {
	type NewPlotNoteInput,
	type PlotNote,
	isPlotNoteStatus,
} from "../memory/plot-note.js";
import type { NewSceneAnalysis, SceneAnalysis } from "../memory/scene.js";
import {
	type NewSummaryInput,
	type Summary,
	isSummaryLevel,
} from "../memory/summary.js";
import {
	diffCodePluginPermissions,
	parseCodePluginManifest,
	parseCodePluginPermissions,
} from "../plugins/code-plugins.js";
import {
	type CodePluginInstallationRecord,
	assertCodePluginInstallSource,
} from "../plugins/installation.js";
import {
	type CardDecisionPreferencePayload,
	type EditPreferencePayload,
	type ListPreferenceEventsOptions,
	type NewPreferenceEventInput,
	type PreferenceEvent,
	type PreferenceEventKind,
	type PreferenceEventPayload,
	type SwipePreferencePayload,
	assertPreferencePayload,
	isPreferenceEventKind,
} from "../preferences/events.js";
import {
	buildTrigramQuery,
	normalizeRetrievalText,
} from "../retrieval/chunk-index.js";
import {
	type ChunkStrategy,
	DEFAULT_CHUNK_STRATEGY,
	chunkText,
	chunkTextByParent,
	isChunkStrategy,
} from "../retrieval/chunk-text.js";
import {
	type TurnRunEvent,
	type TurnRunEventInput,
	type TurnRunFinalStatus,
	type TurnRunRecord,
	assertTurnRunEventKind,
	isTurnRunFinalStatus,
	isTurnRunStatus,
} from "../run-log.js";
import { applyStateDiffsTo } from "../state.js";
import { isStructuredOutputMode } from "../structured/types.js";
import type {
	NewStateDiff,
	NodeTextMatch,
	StateDiff,
	StateDiffOp,
	StateSnapshot,
	Story,
	StoryTime,
	TimelineNode,
	TimelineRole,
} from "../timeline.js";
import { createTokenEstimator } from "../tokens.js";
import type { TurnTrace } from "../trace.js";
import { serializeJsonValue } from "./json-value.js";
import {
	DEFAULT_EMBEDDING_DIMENSIONS,
	applyMigrations,
	buildMigrations,
} from "./migrations.js";
import {
	type AppendOpeningCandidatesInput,
	CONTEXT_TEMPLATE_UPDATE_KEYS,
	type ChooseOpeningCandidateResult,
	type ContextTemplateRecord,
	type CreateContextTemplateInput,
	DEFAULT_STORY_SETTINGS_VALUES,
	DIRECTOR_CONFIG_KEYS,
	type ListOpeningCandidatesOptions,
	type OpeningCandidateRecord,
	type OpeningPackRecord,
	STORY_SETTINGS_UPDATE_KEYS,
	type SaveOpeningPackInput,
	type StorySettings,
	type StorySettingsUpdate,
	type UpdateContextTemplateInput,
	assertStoredContextTemplate,
	assertStorySettingsUpdate,
	isOpeningCandidateStatus,
	parseStoryPluginOverrides,
} from "./settings.js";

interface StoryRow {
	readonly id: string;
	readonly title: string;
	readonly created_at: string;
}

interface StorySettingsRow {
	readonly story_id: string;
	readonly card_name: string | null;
	readonly character_prompt: string | null;
	readonly persona: string | null;
	readonly template_id: string | null;
	readonly model: string | null;
	readonly budget_tokens: number;
	readonly structured_output: string;
	readonly temperature: number;
	readonly max_tokens: number;
	readonly reasoning: string;
	readonly turn_mode: string;
	readonly max_read_rounds: number;
	readonly deep_max_tool_calls: number;
	readonly deep_timeout_ms: number;
	readonly deep_context_token_limit: number;
	readonly deep_recent_tool_steps: number;
	readonly viewpoint: string | null;
	readonly director_config: string;
	readonly history_block_policy: string;
	readonly gap_pass_enabled: number;
	readonly gap_plan_seconds: number;
	readonly image_config: string | null;
	readonly plugin_overrides: string;
	readonly updated_at: string;
}

interface ContextTemplateRow {
	readonly id: string;
	readonly name: string;
	readonly template: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface NodeRow {
	readonly id: string;
	readonly story_id: string;
	readonly parent_id: string | null;
	readonly role: string;
	readonly raw: string;
	readonly created_at: string;
}

interface StateDiffRow {
	readonly id: number;
	readonly story_id: string;
	readonly node_id: string;
	readonly ordinal: number;
	readonly path: string;
	readonly op: string;
	readonly value: string | null;
	readonly reason: string | null;
	readonly source: string;
	readonly story_time_start: string | null;
	readonly story_time_end: string | null;
	readonly confidence: number | null;
	readonly created_at: string;
}

interface LedgerSettlementRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly source: string;
	readonly added_count: number;
	readonly repairs: string;
	readonly created_at: string;
}

interface EntityCandidateRow {
	readonly story_id: string;
	readonly normalized_name: string;
	readonly kind: string;
	readonly hits: number;
	readonly first_node_id: string;
	readonly created_at: string;
}

interface SceneAnalysisRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly text: string;
	readonly token_count: number;
	readonly created_at: string;
}

interface DirectorNoteRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly diffs: string;
	readonly created_at: string;
}

interface GapPassRunRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly rejected_segments: string;
	readonly dropped_entries: string;
	readonly created_at: string;
}

interface OpeningPackRow {
	readonly story_id: string;
	readonly payload: string;
	readonly input_hash: string;
	readonly source_node_id: string | null;
	readonly created_at: string;
}

interface OpeningCandidateRow {
	readonly id: string;
	readonly story_id: string;
	readonly ordinal: number;
	readonly raw: string;
	readonly status: string;
	readonly created_at: string;
}

interface PluginInstallationRow {
	readonly name: string;
	readonly version: string;
	readonly manifest: string;
	readonly granted_permissions: string;
	readonly source_kind: string;
	readonly source_spec: string;
	readonly installed_at: string;
}

interface ImageWorkflowRow {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly payload: string;
	readonly slots: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface CharacterVisualProfileRow {
	readonly story_id: string;
	readonly character: string;
	readonly profile: string;
	readonly source: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface NodeImageRow {
	readonly id: string;
	readonly story_id: string;
	readonly node_id: string;
	readonly ordinal: number;
	readonly status: string;
	readonly request: string;
	readonly prompt: string | null;
	readonly negative_prompt: string | null;
	readonly workflow_id: string;
	readonly seed: number | null;
	readonly attempts: number;
	readonly file_name: string | null;
	readonly media_type: string | null;
	readonly width: number | null;
	readonly height: number | null;
	readonly error: string | null;
	readonly created_at: string;
	readonly updated_at: string;
}

interface PreferenceEventRow {
	readonly id: string;
	readonly story_id: string;
	readonly node_id: string;
	readonly kind: string;
	readonly payload: string;
	readonly created_at: string;
}

interface LedgerChangeCardRow {
	readonly id: string;
	readonly story_id: string;
	readonly source: string;
	readonly assistant_conversation_id: string | null;
	readonly source_node_id: string;
	readonly text: string;
	readonly diffs: string;
	readonly before: string;
	readonly status: string;
	readonly rejection_reason: string | null;
	readonly created_at: string;
	readonly decided_at: string | null;
}

interface NodeTextRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly score: number;
	readonly snippet: string;
}

interface TraceRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly trace: string;
}

interface TurnRunRow {
	readonly run_id: string;
	readonly story_id: string;
	readonly user_node_id: string;
	readonly node_id: string | null;
	readonly mode: string;
	readonly status: string;
	readonly started_at: string;
	readonly finished_at: string | null;
}

interface TurnRunEventRow {
	readonly run_id: string;
	readonly seq: number;
	readonly kind: string;
	readonly payload: string;
	readonly created_at: string;
}

interface AssistantConversationRow {
	readonly id: string;
	readonly story_id: string | null;
	readonly skill: string;
	readonly title: string;
	readonly permission: string;
	readonly status: string;
	readonly model_alias: string | null;
	readonly thinking: string;
	readonly context_budget: number;
	readonly compaction_threshold: number;
	readonly created_at: string;
	readonly updated_at: string;
	readonly last_message_at: string | null;
}

interface AssistantMessageRow {
	readonly conversation_id: string;
	readonly ordinal: number;
	readonly role: string;
	readonly text: string;
	readonly tool_name: string | null;
	readonly tool_result: string | null;
	readonly usage: string | null;
	readonly created_at: string;
}

interface AssistantMessageSearchRow {
	readonly conversation_id: string;
	readonly ordinal: number;
	readonly snippet: string;
	readonly score: number;
}

interface AssistantMessageLikeRow {
	readonly conversation_id: string;
	readonly ordinal: number;
	readonly text: string;
}

interface AssistantEventRow {
	readonly conversation_id: string;
	readonly seq: number;
	readonly kind: string;
	readonly payload: string;
	readonly created_at: string;
}

interface AssistantCompactionRow {
	readonly id: string;
	readonly conversation_id: string;
	readonly seq: number;
	readonly summary: string;
	readonly omitted_message_ids: string;
	readonly before_tokens: number;
	readonly after_tokens: number;
	readonly created_at: string;
}

interface AssistantActionRow {
	readonly id: string;
	readonly conversation_id: string;
	readonly story_id: string | null;
	readonly kind: string;
	readonly summary: string;
	readonly payload: string;
	readonly status: string;
	readonly rejection_reason: string | null;
	readonly created_at: string;
	readonly decided_at: string | null;
}

interface StateSnapshotRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly state: string;
	readonly computed_at: string;
}

interface EntityRow {
	readonly id: string;
	readonly story_id: string;
	readonly kind: string;
	readonly name: string;
	readonly description: string;
	readonly source: string;
	readonly created_at: string;
}

interface EntityAliasRow {
	readonly alias: string;
}

interface BackgroundJobRow {
	readonly id: number;
	readonly story_id: string;
	readonly node_id: string | null;
	readonly kind: string;
	readonly status: string;
	readonly attempts: number;
	readonly last_error: string | null;
	readonly created_at: string;
	readonly started_at: string | null;
	readonly finished_at: string | null;
}

interface MemoryEventRow {
	readonly id: string;
	readonly story_id: string;
	readonly source_node_id: string;
	readonly ordinal: number;
	readonly story_time: string | null;
	readonly location: string | null;
	readonly participants: string;
	readonly importance: number;
	readonly knowers: string;
	readonly text: string;
	readonly source: string;
	readonly created_at: string;
}

interface SummaryRow {
	readonly id: string;
	readonly story_id: string;
	readonly level: string;
	readonly start_node_id: string;
	readonly end_node_id: string;
	readonly text: string;
	readonly token_count: number;
	readonly created_at: string;
}

interface ChapterCompressionRow {
	readonly id: string;
	readonly story_id: string;
	readonly level: string;
	readonly start_node_id: string;
	readonly end_node_id: string;
	readonly sections: string;
	readonly token_count: number;
	readonly created_at: string;
}

interface NormalisedMemoryEvent {
	readonly id: string;
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly ordinal: number;
	readonly storyTime: string | null;
	readonly location: string | null;
	readonly participants: readonly string[];
	readonly importance: number;
	readonly knowers: readonly string[];
	readonly text: string;
	readonly source: string;
	readonly createdAt: string;
}

interface NormalisedSummary {
	readonly id: string;
	readonly storyId: string;
	readonly level: Summary["level"];
	readonly startNodeId: string;
	readonly endNodeId: string;
	readonly text: string;
	readonly tokenCount: number;
	readonly createdAt: string;
}

interface ChunkRow {
	readonly chunk_id: number;
	readonly story_id: string;
	readonly node_id: string;
	readonly parent_ordinal: number | null;
	readonly parent_text: string | null;
	readonly score: number;
}

interface ChunkTextRow {
	readonly chunk_id: number;
	readonly text: string;
}

interface ChunkIdentityRow {
	readonly story_id: string;
	readonly node_id: string;
}

interface ChunkVectorRow {
	readonly chunk_id: number;
	readonly story_id: string;
	readonly node_id: string;
	readonly parent_ordinal: number | null;
	readonly parent_text: string | null;
	readonly distance: number;
}

interface NodeChunkVectorRow {
	readonly chunk_id: number;
	readonly ordinal: number;
	readonly embedding: Buffer;
}

interface PlotNoteRow {
	readonly id: string;
	readonly story_id: string;
	readonly source_node_id: string;
	readonly text: string;
	readonly status: string;
	readonly created_at: string;
	readonly fulfilled_at: string | null;
}

interface DirectorDecisionRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly directive: string | null;
	readonly mechanisms: string;
	readonly signals: string;
	readonly created_at: string;
}

interface StoryArcRow {
	readonly story_id: string;
	readonly arc_id: string;
	readonly title: string;
	readonly through_line: string;
	readonly difficulty: number;
	readonly red_lines: string;
	readonly source: string;
	readonly ordinal: number;
	readonly created_at: string;
	readonly updated_at: string;
}

interface StorySequenceRow {
	readonly story_id: string;
	readonly sequence_id: string;
	readonly arc_id: string;
	readonly ordinal: number;
	readonly title: string;
	readonly source: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface StoryBeatRow {
	readonly story_id: string;
	readonly beat_id: string;
	readonly sequence_id: string;
	readonly ordinal: number;
	readonly goal: string;
	readonly entry_signs: string;
	readonly fit_points: string;
	readonly source: string;
	readonly created_at: string;
	readonly updated_at: string;
}

interface DirectorBeatStateRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly beat_id: string;
	readonly completed: number;
	readonly created_at: string;
}

interface DirectorCandidateActionRow {
	readonly id: string;
	readonly story_id: string;
	readonly node_id: string;
	readonly ordinal: number;
	readonly kind: string;
	readonly text: string;
	readonly created_at: string;
}

interface EventPoolRow {
	readonly story_id: string;
	readonly source_id: string;
	readonly text: string;
	readonly preconditions: string | null;
	readonly cooldown: number;
	readonly enabled: number;
	readonly source: string;
	readonly created_at: string;
}

interface NpcAgendaRow {
	readonly story_id: string;
	readonly entity_id: string;
	readonly goal: string;
	readonly every_chapters: number;
	readonly importance: number;
	readonly progress: string;
	readonly last_advanced_node_id: string | null;
	readonly created_at: string;
	readonly updated_at: string;
}

interface LoreEntryRow {
	readonly id: string;
	readonly story_id: string;
	readonly entity_id: string | null;
	readonly name: string;
	readonly content: string;
	readonly constant: number;
	readonly keywords: string;
	readonly source: string;
	readonly created_at: string;
}

interface LorePrefilterRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly entry_ids: string;
	readonly created_at: string;
}

interface ContextPackRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly payload: string;
	readonly created_at: string;
}

interface NormalisedPlotNote {
	readonly id: string;
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly text: string;
	readonly createdAt: string;
}

interface NormalisedDirectorDecision {
	readonly nodeId: string;
	readonly storyId: string;
	readonly directive: string | null;
	readonly mechanisms: readonly DirectorMechanismRecord[];
	readonly signals: JsonObject;
	readonly createdAt: string;
}

interface NormalisedEventPoolEntry {
	readonly storyId: string;
	readonly sourceId: string;
	readonly text: string;
	readonly preconditions: ContextCondition | null;
	readonly cooldown: number;
	readonly enabled: boolean;
	readonly source: string;
	readonly createdAt: string;
}

interface NormalisedNpcAgenda {
	readonly storyId: string;
	readonly entityId: string;
	readonly goal: string;
	readonly everyChapters: number;
	readonly importance: number;
	readonly createdAt: string;
}

interface NormalisedLoreEntry {
	readonly id: string;
	readonly storyId: string;
	readonly entityId: string | null;
	readonly name: string;
	readonly content: string;
	readonly constant: boolean;
	readonly keywords: readonly string[];
	readonly source: string;
	readonly createdAt: string;
}

export interface CreateStoryInput {
	readonly id?: string;
	readonly title: string;
	readonly createdAt?: string;
}

export interface AppendNodeInput {
	readonly id?: string;
	readonly storyId: string;
	readonly parentId: string | null;
	readonly role: TimelineRole;
	readonly raw: string;
	readonly createdAt?: string;
}

export interface SearchNodeTextOptions {
	readonly storyId?: string;
	readonly limit?: number;
}

export interface SearchChunksOptions {
	readonly storyId: string;
	/** 只搜索该节点祖先路径上的楼层，排除该节点自身与其他分支。 */
	readonly beforeNodeId?: string;
	readonly limit?: number;
}

export interface ChunkSearchMatch {
	readonly storyId: string;
	readonly nodeId: string;
	readonly chunkId: number;
	/** 父段在楼层内的序号；旧分块没有父段。 */
	readonly parentOrdinal: number | null;
	/** 命中后应注入的父段文本；旧分块为 null。 */
	readonly parentText: string | null;
	/** FTS5 的 bm25 原始分数，越小越相关。 */
	readonly score: number;
}

export interface ChunkWithoutVector {
	readonly chunkId: number;
	readonly text: string;
}

export interface ChunkVectorInput {
	readonly chunkId: number;
	readonly embedding: readonly number[];
}

export interface ChunkVectorForNode {
	readonly chunkId: number;
	readonly ordinal: number;
	readonly vector: readonly number[];
}

export interface SearchVectorsOptions {
	readonly storyId: string;
	/** 只搜索该节点祖先路径上的楼层，排除该节点自身与其他分支。 */
	readonly beforeNodeId?: string;
	readonly limit?: number;
}

export interface VectorSearchMatch {
	readonly storyId: string;
	readonly nodeId: string;
	readonly chunkId: number;
	/** 父段在楼层内的序号；旧分块没有父段。 */
	readonly parentOrdinal: number | null;
	/** 命中后应注入的父段文本；旧分块为 null。 */
	readonly parentText: string | null;
	/** 向量的 L2 距离，越小越接近。 */
	readonly distance: number;
}

export interface StoryStoreOpenOptions {
	/** 向量维度；必须与数据库中已有的 chunk_vectors 表一致。 */
	readonly embeddingDimensions?: number;
	/** 分块策略；缺省按父子分块建立索引。 */
	readonly chunkStrategy?: ChunkStrategy;
}

export interface ListEntitiesOptions {
	readonly kind?: EntityKind;
}

export interface ResolveEntitiesOptions {
	readonly storyId?: string;
}

export interface RecordEventExtractionsInput {
	readonly storyId: string;
	/** 本次窗口内的助手楼层；没有事件的楼层也要传。 */
	readonly nodeIds: readonly string[];
	readonly events: readonly NewMemoryEventInput[];
	readonly createdAt?: string;
}

export interface EnqueueBackgroundJobsInput {
	readonly storyId: string;
	readonly kinds: readonly string[];
	/** 每种任务类型的入队条件；缺省为 confirmed。 */
	readonly conditions?: Readonly<Record<string, BackgroundJobEnqueueCondition>>;
	readonly createdAt?: string;
}

export interface EnqueueStoryBackgroundJobsInput {
	readonly storyId: string;
	readonly kinds: readonly string[];
	readonly createdAt?: string;
}

export interface ListBackgroundJobsOptions {
	readonly storyId?: string;
	readonly status?: BackgroundJobStatus;
	readonly kinds?: readonly string[];
	readonly limit?: number;
}

export interface CountBackgroundJobsOptions {
	readonly storyId: string;
	readonly kinds?: readonly string[];
}

export interface FailBackgroundJobInput {
	readonly error: string;
	readonly maxAttempts: number;
	readonly finishedAt?: string;
}

interface NormalisedStateDiff {
	readonly storyId: string;
	readonly nodeId: string;
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	readonly valueJson: string | null;
	readonly reason: string | null;
	readonly source: string;
	readonly storyTime: StoryTime | null;
	readonly confidence: number | null;
}

interface NormalisedAlias {
	readonly alias: string;
	readonly normalized: string;
}

function normaliseAliases(aliases: readonly string[]): NormalisedAlias[] {
	if (!Array.isArray(aliases)) {
		throw new Error("实体别名必须是数组");
	}
	const seen = new Set<string>();
	const result: NormalisedAlias[] = [];
	for (const alias of aliases) {
		assertNonEmptyString(alias, "实体别名");
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0) {
			throw new Error(`实体别名去掉标点与空白后为空：${alias}`);
		}
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		result.push({ alias, normalized });
	}
	return result;
}

const DEFAULTS = {
	searchLimit: 20,
	maxSearchLimit: 1000,
	minQueryLength: 3,
} as const;

const estimateTokens = createTokenEstimator();

function assertNonEmptyString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
}

function requireTemplateName(value: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("上下文模板名称必须是非空字符串");
	}
	return value.trim();
}

function optionalTrimmedString(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串或 null`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${label} 不能是空字符串`);
	}
	return trimmed;
}

function toTurnRunRecord(row: TurnRunRow): TurnRunRecord {
	if (!isTurnMode(row.mode)) {
		throw new Error(`运行 ${row.run_id} 的回合模式不合法：${row.mode}`);
	}
	if (!isTurnRunStatus(row.status)) {
		throw new Error(`运行 ${row.run_id} 的状态不合法：${row.status}`);
	}
	return {
		runId: row.run_id,
		storyId: row.story_id,
		userNodeId: row.user_node_id,
		nodeId: row.node_id,
		mode: row.mode,
		status: row.status,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

function toTurnRunEvent(row: TurnRunEventRow): TurnRunEvent {
	assertTurnRunEventKind(
		row.kind,
		`运行 ${row.run_id} 的事件 ${row.seq} 的种类`,
	);
	const payload: unknown = JSON.parse(row.payload);
	if (!isJsonObject(payload)) {
		throw new Error(
			`运行 ${row.run_id} 的事件 ${row.seq} 的载荷不是 JSON 对象`,
		);
	}
	return {
		runId: row.run_id,
		seq: row.seq,
		kind: row.kind,
		payload,
		createdAt: row.created_at,
	};
}

function rowToAssistantConversation(
	row: AssistantConversationRow,
): AssistantConversation {
	assertAssistantPermission(row.permission, `助手会话 ${row.id} 的权限`);
	assertAssistantConversationStatus(row.status, `助手会话 ${row.id} 的状态`);
	assertAssistantThinking(row.thinking, `助手会话 ${row.id} 的思考强度`);
	assertAssistantContextBudget(
		row.context_budget,
		`助手会话 ${row.id} 的上下文预算`,
	);
	assertAssistantCompactionThreshold(
		row.compaction_threshold,
		`助手会话 ${row.id} 的压缩阈值`,
	);
	return {
		id: row.id,
		storyId: row.story_id,
		skill: row.skill,
		title: row.title,
		permission: row.permission,
		status: row.status,
		modelAlias: row.model_alias,
		thinking: row.thinking,
		contextBudget: row.context_budget,
		compactionThreshold: row.compaction_threshold,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastMessageAt: row.last_message_at,
	};
}

function rowToAssistantMessage(row: AssistantMessageRow): AssistantMessage {
	const label = `助手消息 ${row.conversation_id}#${row.ordinal}`;
	assertAssistantMessageRole(row.role, `${label} 的角色`);
	let toolResult: JsonValue | null = null;
	if (row.tool_result !== null) {
		const parsed: unknown = JSON.parse(row.tool_result);
		assertJsonValue(parsed, `${label} 的工具结果`);
		toolResult = parsed as JsonValue;
	}
	let usage: JsonObject | null = null;
	if (row.usage !== null) {
		const parsed: unknown = JSON.parse(row.usage);
		if (!isJsonObject(parsed)) {
			throw new Error(`${label} 的用量不是 JSON 对象`);
		}
		usage = parsed;
	}
	return {
		conversationId: row.conversation_id,
		ordinal: row.ordinal,
		role: row.role,
		text: row.text,
		toolName: row.tool_name,
		toolResult,
		usage,
		createdAt: row.created_at,
	};
}

function rowToAssistantEvent(row: AssistantEventRow): AssistantEvent {
	assertAssistantEventKind(
		row.kind,
		`助手会话 ${row.conversation_id} 的事件 ${row.seq} 的种类`,
	);
	const payload: unknown = JSON.parse(row.payload);
	if (!isJsonObject(payload)) {
		throw new Error(
			`助手会话 ${row.conversation_id} 的事件 ${row.seq} 的载荷不是 JSON 对象`,
		);
	}
	return {
		conversationId: row.conversation_id,
		seq: row.seq,
		kind: row.kind,
		payload,
		createdAt: row.created_at,
	};
}

function rowToAssistantCompaction(
	row: AssistantCompactionRow,
): AssistantCompaction {
	const label = `助手压缩记录 ${row.conversation_id}#${row.seq}`;
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.omitted_message_ids);
	} catch {
		throw new Error(`${label} 的省略消息序号不是合法 JSON`);
	}
	assertAssistantMessageOrdinals(parsed, `${label} 的省略消息序号`);
	if (typeof row.summary !== "string" || row.summary.trim().length === 0) {
		throw new Error(`${label} 的摘要不能为空`);
	}
	return {
		id: row.id,
		conversationId: row.conversation_id,
		seq: row.seq,
		summary: row.summary,
		omittedMessageIds: parsed,
		beforeTokens: row.before_tokens,
		afterTokens: row.after_tokens,
		createdAt: row.created_at,
	};
}

function rowToAssistantAction(row: AssistantActionRow): AssistantAction {
	assertAssistantActionKind(row.kind, `助手动作 ${row.id} 的种类`);
	if (!isAssistantActionStatus(row.status)) {
		throw new Error(`助手动作 ${row.id} 的状态不合法：${row.status}`);
	}
	const payload: unknown = JSON.parse(row.payload);
	if (!isJsonObject(payload)) {
		throw new Error(`助手动作 ${row.id} 的载荷不是 JSON 对象`);
	}
	return {
		id: row.id,
		conversationId: row.conversation_id,
		storyId: row.story_id,
		kind: row.kind,
		summary: row.summary,
		payload,
		status: row.status,
		rejectionReason: row.rejection_reason,
		createdAt: row.created_at,
		decidedAt: row.decided_at,
	};
}

const ASSISTANT_SNIPPET_RADIUS = 24;

/** 把命中位置前后各截一段，命中词用方括号标出。 */
function createAssistantSnippet(text: string, query: string): string {
	const index = text.toLowerCase().indexOf(query.toLowerCase());
	if (index < 0) {
		return text.length <= ASSISTANT_SNIPPET_RADIUS * 2
			? text
			: `${text.slice(0, ASSISTANT_SNIPPET_RADIUS * 2)}…`;
	}
	const start = Math.max(0, index - ASSISTANT_SNIPPET_RADIUS);
	const end = Math.min(
		text.length,
		index + query.length + ASSISTANT_SNIPPET_RADIUS,
	);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	return `${prefix}${text.slice(start, index)}[${text.slice(index, index + query.length)}]${text.slice(index + query.length, end)}${suffix}`;
}

function normaliseNameArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是字符串数组`);
	}
	return value.map((item, index) => {
		if (typeof item !== "string") {
			throw new Error(`${label}[${index}] 必须是字符串`);
		}
		const trimmed = item.trim();
		if (trimmed.length === 0) {
			throw new Error(`${label}[${index}] 不能是空字符串`);
		}
		return trimmed;
	});
}

function isTimelineRole(value: unknown): value is TimelineRole {
	return value === "system" || value === "user" || value === "assistant";
}

function rowToStory(row: StoryRow): Story {
	return {
		id: row.id,
		title: row.title,
		createdAt: row.created_at,
	};
}

function rowToStorySettings(row: StorySettingsRow): StorySettings {
	if (!isStructuredOutputMode(row.structured_output)) {
		throw new Error(
			`故事 ${row.story_id} 的 structured_output 不合法：${row.structured_output}`,
		);
	}
	if (!isLlmReasoningLevel(row.reasoning)) {
		throw new Error(
			`故事 ${row.story_id} 的 reasoning 不合法：${row.reasoning}`,
		);
	}
	if (!isTurnMode(row.turn_mode)) {
		throw new Error(
			`故事 ${row.story_id} 的 turn_mode 不合法：${row.turn_mode}`,
		);
	}
	// 旧版本保存的配置没有后来新增的字段，读取时用默认值补齐；
	// 更早的版本用 enabled 布尔值表示开关，读取时换成 mode 并丢掉 enabled。
	const parsedDirectorConfig = readStoredDirectorConfig(
		JSON.parse(row.director_config) as unknown,
	);
	const parsedHistoryBlockPolicy: unknown = JSON.parse(
		row.history_block_policy,
	);
	assertHistoryBlockPolicy(parsedHistoryBlockPolicy);
	return {
		storyId: row.story_id,
		cardName: row.card_name,
		characterPrompt: row.character_prompt,
		persona: row.persona,
		templateId: row.template_id,
		model: row.model,
		budgetTokens: row.budget_tokens,
		structuredOutput: row.structured_output,
		temperature: row.temperature,
		maxTokens: row.max_tokens,
		reasoning: row.reasoning,
		turnMode: row.turn_mode,
		maxReadRounds: row.max_read_rounds,
		deepMaxToolCalls: row.deep_max_tool_calls,
		deepTimeoutMs: row.deep_timeout_ms,
		deepContextTokenLimit: row.deep_context_token_limit,
		deepRecentToolSteps: row.deep_recent_tool_steps,
		viewpoint: row.viewpoint,
		directorConfig: parsedDirectorConfig,
		historyBlockPolicy: parsedHistoryBlockPolicy,
		gapPassEnabled: readBooleanColumn(
			row.gap_pass_enabled,
			`故事 ${row.story_id} 的 gap_pass_enabled`,
		),
		gapPlanSeconds: row.gap_plan_seconds,
		imageConfig: readStoredImageConfig(row.image_config),
		pluginOverrides: parseStoryPluginOverrides(
			JSON.parse(row.plugin_overrides) as unknown,
		),
		updatedAt: row.updated_at,
	};
}

function readStoredImageConfig(value: string | null): ImageConfig {
	if (value === null || value.trim().length === 0) return DEFAULT_IMAGE_CONFIG;
	return assertImageConfig(JSON.parse(value) as unknown);
}

function readBooleanColumn(value: number, label: string): boolean {
	if (value === 0) return false;
	if (value === 1) return true;
	throw new Error(`${label} 必须是 0 或 1：${String(value)}`);
}

function rowToContextTemplate(row: ContextTemplateRow): ContextTemplateRecord {
	const parsed: unknown = JSON.parse(row.template);
	assertStoredContextTemplate(parsed as ContextTemplateRecord["template"]);
	return {
		id: row.id,
		name: row.name,
		template: parsed as ContextTemplateRecord["template"],
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function readStoredDirectorConfig(value: unknown): DirectorConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("故事设置的 director_config 必须是对象");
	}
	const { enabled, ...stored } = value as Record<string, unknown>;
	if (stored.mode === undefined && enabled !== undefined) {
		if (typeof enabled !== "boolean") {
			throw new Error("旧导演配置的 enabled 必须是布尔值");
		}
		stored.mode = enabled ? "transparent" : "off";
	}
	const config: DirectorConfig = {
		...DEFAULT_DIRECTOR_CONFIG,
		...(stored as Partial<DirectorConfig>),
	};
	assertDirectorConfig(config);
	return config;
}

function serializeDirectorConfig(config: DirectorConfig): string {
	rejectUnknownKeys(
		config as unknown as Record<string, unknown>,
		DIRECTOR_CONFIG_KEYS,
		"故事设置的 directorConfig",
	);
	const defined: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(config)) {
		if (value !== undefined) defined[key] = value;
	}
	return serializeJsonValue(defined, "故事设置的 directorConfig");
}

function serializeHistoryBlockPolicy(policy: HistoryBlockPolicy): string {
	assertHistoryBlockPolicy(policy, "故事设置的 historyBlockPolicy");
	return JSON.stringify(policy);
}

function rowToNode(row: NodeRow): TimelineNode {
	return {
		id: row.id,
		storyId: row.story_id,
		parentId: row.parent_id,
		role: row.role as TimelineRole,
		raw: row.raw,
		createdAt: row.created_at,
	};
}

function assertStateDiffPath(
	value: unknown,
	label: string,
): asserts value is string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((segment) => typeof segment !== "string" || segment.length === 0)
	) {
		throw new Error(`${label} 的 path 必须是非空字符串组成的非空数组`);
	}
}

/** 起止都为空的 storyTime 与未指定等价，统一存成 NULL。 */
function normaliseStoryTime(value: unknown, label: string): StoryTime | null {
	if (value === undefined || value === null) return null;
	const record = assertPlainObject(value, `${label} 的 storyTime`);
	rejectUnknownKeys(record, ["start", "end"], `${label} 的 storyTime`);
	const start = normaliseStoryTimeBound(
		record.start,
		`${label} 的 storyTime.start`,
	);
	const end = normaliseStoryTimeBound(record.end, `${label} 的 storyTime.end`);
	if (start === null && end === null) return null;
	return { start, end };
}

function normaliseStoryTimeBound(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串或 null`);
	}
	return value;
}

function rowToStateDiff(row: StateDiffRow): StateDiff {
	const path: unknown = JSON.parse(row.path);
	assertStateDiffPath(path, `状态 diff ${row.id}`);
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		ordinal: row.ordinal,
		path,
		op: row.op as StateDiffOp,
		value: row.value === null ? null : JSON.parse(row.value),
		reason: row.reason,
		source: row.source,
		storyTime:
			row.story_time_start === null && row.story_time_end === null
				? null
				: { start: row.story_time_start, end: row.story_time_end },
		confidence: row.confidence,
		createdAt: row.created_at,
	};
}

function rowToLedgerSettlement(row: LedgerSettlementRow): LedgerSettlement {
	if (!(LEDGER_SOURCES as readonly string[]).includes(row.source)) {
		throw new Error(`楼层 ${row.node_id} 的结算来源不合法：${row.source}`);
	}
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		source: row.source as LedgerSource,
		addedCount: row.added_count,
		repairs: assertLedgerRepairs(
			JSON.parse(row.repairs) as unknown,
			`楼层 ${row.node_id} 的结算记录`,
		),
		createdAt: row.created_at,
	};
}

function rowToSceneAnalysis(row: SceneAnalysisRow): SceneAnalysis {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		text: row.text,
		tokenCount: row.token_count,
		createdAt: row.created_at,
	};
}

function rowToDirectorNote(row: DirectorNoteRow): DirectorNoteRecord {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		diffs: assertDirectorNoteDiffs(
			JSON.parse(row.diffs) as unknown,
			`楼层 ${row.node_id} 的导演手记`,
		),
		createdAt: row.created_at,
	};
}

function rowToGapPassRun(row: GapPassRunRow): GapPassRun {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		rejectedSegments: assertGapPassRejections(
			JSON.parse(row.rejected_segments) as unknown,
			`楼层 ${row.node_id} 的合并调用记录`,
		),
		droppedEntries: assertGapPassDroppedEntries(
			JSON.parse(row.dropped_entries) as unknown,
			`楼层 ${row.node_id} 的合并调用记录`,
		),
		createdAt: row.created_at,
	};
}

function rowToOpeningPack(row: OpeningPackRow): OpeningPackRecord {
	const payload = JSON.parse(row.payload) as unknown;
	if (!isJsonObject(payload)) {
		throw new Error(`故事 ${row.story_id} 的开局包内容必须是 JSON 对象`);
	}
	return {
		storyId: row.story_id,
		payload,
		inputHash: row.input_hash,
		sourceNodeId: row.source_node_id,
		createdAt: row.created_at,
	};
}

function rowToOpeningCandidate(
	row: OpeningCandidateRow,
): OpeningCandidateRecord {
	if (!isOpeningCandidateStatus(row.status)) {
		throw new Error(`开场候选 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		ordinal: row.ordinal,
		raw: row.raw,
		status: row.status,
		createdAt: row.created_at,
	};
}

function rowToPluginInstallation(
	row: PluginInstallationRow,
): CodePluginInstallationRecord {
	const manifest = parseCodePluginManifest(
		JSON.parse(row.manifest) as unknown,
		`插件 ${row.name} 的安装记录`,
	);
	if (manifest.name !== row.name || manifest.version !== row.version) {
		throw new Error(`插件 ${row.name} 的安装记录与清单的名称或版本不一致`);
	}
	return {
		name: row.name,
		version: row.version,
		manifest,
		grantedPermissions: parseCodePluginPermissions(
			JSON.parse(row.granted_permissions) as unknown,
			`插件 ${row.name} 的已授予权限`,
		),
		source: assertCodePluginInstallSource(
			{ kind: row.source_kind, spec: row.source_spec },
			`插件 ${row.name} 的安装来源`,
		),
		installedAt: row.installed_at,
	};
}

function rowToImageWorkflow(row: ImageWorkflowRow): ImageWorkflowRecord {
	const workflow = parseComfyUiWorkflow(
		JSON.parse(row.payload) as unknown,
		`图片 workflow ${row.id} 的 payload`,
	);
	const slots = assertComfyUiSlots(
		workflow,
		JSON.parse(row.slots) as unknown,
		`图片 workflow ${row.id} 的 slots`,
	);
	return {
		id: row.id,
		name: row.name,
		provider: row.provider,
		payload: workflow,
		slots,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToCharacterVisualProfile(
	row: CharacterVisualProfileRow,
): CharacterVisualProfileRecord {
	if (!isVisualProfileSource(row.source)) {
		throw new Error(
			`故事 ${row.story_id} 的视觉档案 ${row.character} 来源不合法：${row.source}`,
		);
	}
	const profile = assertCharacterVisualProfile(
		JSON.parse(row.profile) as unknown,
		`故事 ${row.story_id} 的视觉档案 ${row.character}`,
	);
	if (profile.character !== row.character) {
		throw new Error(
			`故事 ${row.story_id} 的视觉档案人物 ${row.character} 与内容 ${profile.character} 不一致`,
		);
	}
	return {
		storyId: row.story_id,
		character: row.character,
		profile,
		source: row.source,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToNodeImage(row: NodeImageRow): NodeImageRecord {
	if (!isNodeImageStatus(row.status)) {
		throw new Error(`图片记录 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		ordinal: row.ordinal,
		status: row.status,
		request: validateImagePromptRequest(
			JSON.parse(row.request) as unknown,
			`图片记录 ${row.id} 的 request`,
		),
		prompt: row.prompt,
		negativePrompt: row.negative_prompt,
		workflowId: row.workflow_id,
		seed: row.seed,
		attempts: row.attempts,
		fileName: row.file_name,
		mediaType: row.media_type,
		width: row.width,
		height: row.height,
		error: row.error,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToLedgerChangeCard(row: LedgerChangeCardRow): LedgerChangeCard {
	if (!(LEDGER_CHANGE_CARD_SOURCES as readonly string[]).includes(row.source)) {
		throw new Error(`变更卡 ${row.id} 的来源不合法：${row.source}`);
	}
	if (!isLedgerChangeCardStatus(row.status)) {
		throw new Error(`变更卡 ${row.id} 的状态不合法：${row.status}`);
	}
	const diffs = assertLedgerChangeCardDiffs(
		JSON.parse(row.diffs) as unknown,
		`变更卡 ${row.id} 的 diffs`,
	);
	return {
		id: row.id,
		storyId: row.story_id,
		source: row.source as LedgerChangeCardSource,
		assistantConversationId: row.assistant_conversation_id,
		sourceNodeId: row.source_node_id,
		text: row.text,
		diffs,
		before: assertLedgerBeforeEntries(
			JSON.parse(row.before) as unknown,
			diffs,
			`变更卡 ${row.id} 的 before`,
		),
		status: row.status,
		rejectionReason: row.rejection_reason,
		createdAt: row.created_at,
		decidedAt: row.decided_at,
	};
}

function rowToPreferenceEvent(row: PreferenceEventRow): PreferenceEvent {
	if (!isPreferenceEventKind(row.kind)) {
		throw new Error(`偏好记录 ${row.id} 的种类不合法：${row.kind}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		kind: row.kind,
		payload: assertPreferencePayload(
			row.kind,
			JSON.parse(row.payload) as unknown,
			`偏好记录 ${row.id} 的载荷`,
		),
		createdAt: row.created_at,
	};
}

function rowToEntityCandidate(row: EntityCandidateRow): EntityCandidate {
	if (!isEntityKind(row.kind)) {
		throw new Error(
			`实体候选 ${row.normalized_name} 的类别不合法：${row.kind}`,
		);
	}
	return {
		storyId: row.story_id,
		normalizedName: row.normalized_name,
		kind: row.kind,
		hits: row.hits,
		firstNodeId: row.first_node_id,
		createdAt: row.created_at,
	};
}

function rowToStateSnapshot(row: StateSnapshotRow): StateSnapshot {
	const parsed: unknown = JSON.parse(row.state);
	if (!isJsonObject(parsed)) {
		throw new Error(`楼层 ${row.node_id} 的状态快照不是 JSON 对象`);
	}
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		state: parsed,
		computedAt: row.computed_at,
	};
}

/** vec0 以 float32 小端二进制返回向量。 */
function decodeEmbedding(value: unknown, label: string): number[] {
	if (!Buffer.isBuffer(value)) {
		throw new Error(`${label} 的向量不是二进制数据`);
	}
	if (value.byteLength % 4 !== 0) {
		throw new Error(`${label} 的向量字节数不是 4 的倍数：${value.byteLength}`);
	}
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	const vector = new Array<number>(value.byteLength / 4);
	for (let index = 0; index < vector.length; index += 1) {
		vector[index] = view.getFloat32(index * 4, true);
	}
	return vector;
}

function isBackgroundJobStatus(value: unknown): value is BackgroundJobStatus {
	return (
		value === "pending" ||
		value === "running" ||
		value === "done" ||
		value === "failed" ||
		value === "discarded"
	);
}

function assertBackgroundJobId(value: unknown): asserts value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`后台任务 id 必须是正整数：${String(value)}`);
	}
}

function rowToBackgroundJob(row: BackgroundJobRow): BackgroundJob {
	if (!isBackgroundJobStatus(row.status)) {
		throw new Error(`后台任务 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		kind: row.kind,
		status: row.status,
		attempts: row.attempts,
		lastError: row.last_error,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

function rowToMemoryEvent(row: MemoryEventRow): MemoryEvent {
	return {
		id: row.id,
		storyId: row.story_id,
		sourceNodeId: row.source_node_id,
		ordinal: row.ordinal,
		storyTime: row.story_time,
		location: row.location,
		participants: parseStoredNameArray(
			row.participants,
			`事件 ${row.id} 的参与者`,
		),
		importance: row.importance,
		knowers: parseStoredNameArray(row.knowers, `事件 ${row.id} 的知情者`),
		text: row.text,
		source: row.source,
		createdAt: row.created_at,
	};
}

function parseStoredNameArray(value: string, label: string): string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`${label}不是字符串数组`);
	}
	return parsed.map((item) => {
		if (typeof item !== "string" || item.length === 0) {
			throw new Error(`${label}不是字符串数组`);
		}
		return item;
	});
}

function normalisePrefilterEntryIds(value: readonly string[]): string[] {
	if (!Array.isArray(value)) {
		throw new Error("世界书预筛的 entryIds 必须是数组");
	}
	const seen = new Set<string>();
	const entryIds: string[] = [];
	for (const [index, item] of value.entries()) {
		const label = `世界书预筛 entryIds[${index}]`;
		assertNonEmptyString(item, label);
		if (item !== item.trim()) {
			throw new Error(`${label} 不能包含首尾空白`);
		}
		if (seen.has(item)) {
			throw new Error(`${label} 重复：${item}`);
		}
		seen.add(item);
		entryIds.push(item);
	}
	return entryIds;
}

function rowToSummary(row: SummaryRow): Summary {
	if (!isSummaryLevel(row.level)) {
		throw new Error(`摘要 ${row.id} 的级别不合法：${row.level}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		level: row.level,
		startNodeId: row.start_node_id,
		endNodeId: row.end_node_id,
		text: row.text,
		tokenCount: row.token_count,
		createdAt: row.created_at,
	};
}

function rowToChapterCompression(
	row: ChapterCompressionRow,
): ChapterCompression {
	if (!isCompressionLevel(row.level)) {
		throw new Error(`压缩 ${row.id} 的级别不合法：${row.level}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.sections);
	} catch (error) {
		throw new Error(`压缩 ${row.id} 的 sections 不是合法 JSON`, {
			cause: error,
		});
	}
	return {
		id: row.id,
		storyId: row.story_id,
		level: row.level,
		startNodeId: row.start_node_id,
		endNodeId: row.end_node_id,
		sections: assertCompressionSections(parsed, `压缩 ${row.id} 的 sections`),
		tokenCount: row.token_count,
		createdAt: row.created_at,
	};
}

function rowToPlotNote(row: PlotNoteRow): PlotNote {
	if (!isPlotNoteStatus(row.status)) {
		throw new Error(`剧情笔记 ${row.id} 的状态不合法：${row.status}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		sourceNodeId: row.source_node_id,
		text: row.text,
		status: row.status,
		createdAt: row.created_at,
		fulfilledAt: row.fulfilled_at,
	};
}

function rowToDirectorDecision(row: DirectorDecisionRow): DirectorDecision {
	const mechanisms = parseStoredMechanisms(row.mechanisms, row.node_id);
	const parsedSignals: unknown = JSON.parse(row.signals);
	if (!isJsonObject(parsedSignals)) {
		throw new Error(`楼层 ${row.node_id} 的导演决策 signals 不是 JSON 对象`);
	}
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		directive: row.directive,
		mechanisms,
		signals: parsedSignals,
		createdAt: row.created_at,
	};
}

function rowToStoredDirectorArc(row: StoryArcRow): StoredDirectorArc {
	if (!isDirectorPlanSource(row.source)) {
		throw new Error(`弧线 ${row.arc_id} 的来源不合法：${row.source}`);
	}
	return {
		id: row.arc_id,
		title: row.title,
		throughLine: row.through_line,
		difficulty: row.difficulty,
		redLines: parseStoredStringArray(
			row.red_lines,
			`弧线 ${row.arc_id} 的 redLines`,
		),
		source: row.source,
		ordinal: row.ordinal,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToStoredDirectorSequence(
	row: StorySequenceRow,
): StoredDirectorSequence {
	if (!isDirectorPlanSource(row.source)) {
		throw new Error(`序列 ${row.sequence_id} 的来源不合法：${row.source}`);
	}
	return {
		id: row.sequence_id,
		arcId: row.arc_id,
		title: row.title,
		source: row.source,
		ordinal: row.ordinal,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToStoredDirectorBeat(row: StoryBeatRow): StoredDirectorBeat {
	if (!isDirectorPlanSource(row.source)) {
		throw new Error(`节拍 ${row.beat_id} 的来源不合法：${row.source}`);
	}
	return {
		id: row.beat_id,
		sequenceId: row.sequence_id,
		goal: row.goal,
		entrySigns: parseStoredStringArray(
			row.entry_signs,
			`节拍 ${row.beat_id} 的 entrySigns`,
		),
		fitPoints: parseStoredStringArray(
			row.fit_points,
			`节拍 ${row.beat_id} 的 fitPoints`,
		),
		source: row.source,
		ordinal: row.ordinal,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseStoredStringArray(value: string, label: string): string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`${label} 不是字符串数组`);
	}
	return parsed.map((item, index) => {
		if (typeof item !== "string") {
			throw new Error(`${label}[${index}] 必须是字符串`);
		}
		return item;
	});
}

function rowToDirectorBeatState(row: DirectorBeatStateRow): DirectorBeatState {
	if (row.completed !== 0 && row.completed !== 1) {
		throw new Error(`楼层 ${row.node_id} 的拍状态 completed 不是 0 或 1`);
	}
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		beatId: row.beat_id,
		completed: row.completed === 1,
		createdAt: row.created_at,
	};
}

function rowToDirectorCandidateAction(
	row: DirectorCandidateActionRow,
): DirectorCandidateAction {
	if (!isDirectorCandidateKind(row.kind)) {
		throw new Error(`候选行动 ${row.id} 的 kind 不合法：${row.kind}`);
	}
	return {
		id: row.id,
		storyId: row.story_id,
		nodeId: row.node_id,
		ordinal: row.ordinal,
		kind: row.kind,
		text: row.text,
		createdAt: row.created_at,
	};
}

function parseStoredMechanisms(
	value: string,
	nodeId: string,
): DirectorMechanismRecord[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`楼层 ${nodeId} 的导演决策 mechanisms 不是数组`);
	}
	return parsed.map((entry, index) => {
		if (!isJsonObject(entry)) {
			throw new Error(
				`楼层 ${nodeId} 的导演决策 mechanisms[${index}] 不是对象`,
			);
		}
		const { name, triggered, reason } = entry;
		if (typeof name !== "string" || name.length === 0) {
			throw new Error(
				`楼层 ${nodeId} 的导演决策 mechanisms[${index}].name 不合法`,
			);
		}
		if (typeof triggered !== "boolean") {
			throw new Error(
				`楼层 ${nodeId} 的导演决策 mechanisms[${index}].triggered 不合法`,
			);
		}
		if (typeof reason !== "string" || reason.length === 0) {
			throw new Error(
				`楼层 ${nodeId} 的导演决策 mechanisms[${index}].reason 不合法`,
			);
		}
		return { name, triggered, reason };
	});
}

function rowToLoreEntry(row: LoreEntryRow): LoreEntry {
	return {
		id: row.id,
		storyId: row.story_id,
		entityId: row.entity_id,
		name: row.name,
		content: row.content,
		constant: row.constant === 1,
		keywords: parseStoredNameArray(
			row.keywords,
			`世界书条目 ${row.id} 的关键词`,
		),
		source: row.source,
		createdAt: row.created_at,
	};
}

function rowToLorePrefilter(row: LorePrefilterRow): LorePrefilter {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		entryIds: parseStoredNameArray(
			row.entry_ids,
			`世界书预筛 ${row.node_id} 的条目 id`,
		),
		createdAt: row.created_at,
	};
}

function rowToContextPack(row: ContextPackRow): ContextPack {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		payload: parseContextPackPayload(row.payload),
		createdAt: row.created_at,
	};
}

function parseStoredCondition(value: string, label: string): ContextCondition {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${label}不是合法 JSON`);
	}
	return parseContextCondition(parsed, label);
}

function rowToEventPoolEntry(row: EventPoolRow): EventPoolEntry {
	return {
		storyId: row.story_id,
		sourceId: row.source_id,
		text: row.text,
		preconditions:
			row.preconditions === null
				? null
				: parseStoredCondition(
						row.preconditions,
						`事件池条目 ${row.source_id} 的 preconditions`,
					),
		cooldown: row.cooldown,
		enabled: row.enabled === 1,
		source: row.source,
		createdAt: row.created_at,
	};
}

function rowToNpcAgenda(row: NpcAgendaRow): NpcAgenda {
	return {
		storyId: row.story_id,
		entityId: row.entity_id,
		goal: row.goal,
		everyChapters: row.every_chapters,
		importance: row.importance,
		progress: row.progress,
		lastAdvancedNodeId: row.last_advanced_node_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class StoryStore {
	readonly #db: Database.Database;
	readonly #embeddingDimensions: number;
	readonly #chunkStrategy: ChunkStrategy;

	private constructor(
		db: Database.Database,
		embeddingDimensions: number,
		chunkStrategy: ChunkStrategy,
	) {
		this.#db = db;
		this.#embeddingDimensions = embeddingDimensions;
		this.#chunkStrategy = chunkStrategy;
	}

	static open(path: string, options: StoryStoreOpenOptions = {}): StoryStore {
		assertNonEmptyString(path, "数据库路径");
		const embeddingDimensions =
			options.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
		const chunkStrategy = options.chunkStrategy ?? DEFAULT_CHUNK_STRATEGY;
		if (!isChunkStrategy(chunkStrategy)) {
			throw new Error(`分块策略不合法：${String(chunkStrategy)}`);
		}
		const db = new Database(path);
		db.pragma("foreign_keys = ON");
		const store = new StoryStore(db, embeddingDimensions, chunkStrategy);
		try {
			sqliteVec.load(db);
			applyMigrations(db, buildMigrations(embeddingDimensions));
			store.#assertEmbeddingDimensions();
			store.#backfillChunks();
		} catch (error) {
			db.close();
			throw error;
		}
		return store;
	}

	close(): void {
		this.#db.close();
	}

	getSchemaVersion(): number {
		return this.#db.pragma("user_version", { simple: true }) as number;
	}

	/**
	 * 在单个事务里执行回调。回调可以跨越异步边界（例如流式读取文件），
	 * 失败时回滚并原样抛出错误；事务未提交前其他调用方看不到写入。
	 */
	async runInTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const result = await fn();
			this.#db.exec("COMMIT");
			return result;
		} catch (error) {
			if (this.#db.inTransaction) this.#db.exec("ROLLBACK");
			throw error;
		}
	}

	createStory(input: CreateStoryInput): Story {
		assertNonEmptyString(input.title, "故事标题");
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "故事 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		if (this.getStory(id)) {
			throw new Error(`故事已存在：${id}`);
		}
		this.#db
			.prepare("INSERT INTO stories (id, title, created_at) VALUES (?, ?, ?)")
			.run(id, input.title, createdAt);
		const story = this.getStory(id);
		if (!story) {
			throw new Error(`故事写入后读取失败：${id}`);
		}
		return story;
	}

	getStory(id: string): Story | null {
		const row = this.#db
			.prepare("SELECT id, title, created_at FROM stories WHERE id = ?")
			.get(id) as StoryRow | undefined;
		return row ? rowToStory(row) : null;
	}

	updateStoryTitle(id: string, title: string): Story {
		assertNonEmptyString(title, "故事标题");
		if (!this.getStory(id)) {
			throw new Error(`故事不存在：${id}`);
		}
		this.#db
			.prepare("UPDATE stories SET title = ? WHERE id = ?")
			.run(title, id);
		const story = this.getStory(id);
		if (!story) {
			throw new Error(`故事更新后读取失败：${id}`);
		}
		return story;
	}

	listStories(): Story[] {
		const rows = this.#db
			.prepare("SELECT id, title, created_at FROM stories ORDER BY rowid ASC")
			.all() as StoryRow[];
		return rows.map(rowToStory);
	}

	/** 读取一个代码插件的安装记录；没有安装过时返回 null。 */
	getCodePluginInstallation(name: string): CodePluginInstallationRecord | null {
		assertNonEmptyString(name, "插件名称");
		const row = this.#db
			.prepare("SELECT * FROM plugin_installations WHERE name = ?")
			.get(name) as PluginInstallationRow | undefined;
		return row === undefined ? null : rowToPluginInstallation(row);
	}

	listCodePluginInstallations(): CodePluginInstallationRecord[] {
		const rows = this.#db
			.prepare("SELECT * FROM plugin_installations ORDER BY name")
			.all() as PluginInstallationRow[];
		return rows.map(rowToPluginInstallation);
	}

	/** 写入或更新安装记录；安装与升级都覆盖同一行。 */
	saveCodePluginInstallation(
		record: CodePluginInstallationRecord,
	): CodePluginInstallationRecord {
		const manifest = parseCodePluginManifest(record.manifest, "安装记录的清单");
		if (manifest.name !== record.name || manifest.version !== record.version) {
			throw new Error(
				`安装记录的名称或版本与清单不一致：${record.name}@${record.version}`,
			);
		}
		const grantedPermissions = parseCodePluginPermissions(
			record.grantedPermissions,
			"安装记录已授予的权限",
		);
		const changes = diffCodePluginPermissions(
			grantedPermissions,
			manifest.permissions,
		);
		if (changes.added.length > 0 || changes.removed.length > 0) {
			throw new Error(
				`安装记录已授予的权限与清单声明的权限不一致：${manifest.name}`,
			);
		}
		const source = assertCodePluginInstallSource(
			record.source,
			"安装记录的来源",
		);
		assertNonEmptyString(record.installedAt, "安装记录的安装时间");
		this.#db
			.prepare(
				`INSERT INTO plugin_installations
					(name, version, manifest, granted_permissions, source_kind, source_spec, installed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (name) DO UPDATE SET
					version = excluded.version,
					manifest = excluded.manifest,
					granted_permissions = excluded.granted_permissions,
					source_kind = excluded.source_kind,
					source_spec = excluded.source_spec,
					installed_at = excluded.installed_at`,
			)
			.run(
				manifest.name,
				manifest.version,
				JSON.stringify(manifest),
				JSON.stringify(manifest.permissions),
				source.kind,
				source.spec,
				record.installedAt,
			);
		const saved = this.getCodePluginInstallation(manifest.name);
		if (saved === null) {
			throw new Error(`安装记录写入后读取失败：${manifest.name}`);
		}
		return saved;
	}

	/** 删除安装记录；插件卸载时调用，记录不存在时返回 false。 */
	deleteCodePluginInstallation(name: string): boolean {
		assertNonEmptyString(name, "插件名称");
		const result = this.#db
			.prepare("DELETE FROM plugin_installations WHERE name = ?")
			.run(name);
		return result.changes > 0;
	}

	/** 故事没有保存过设置时返回默认值，不写入数据库。 */
	getStorySettings(storyId: string): StorySettings {
		assertNonEmptyString(storyId, "故事 id");
		const story = this.getStory(storyId);
		if (!story) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM story_settings WHERE story_id = ?")
			.get(storyId) as StorySettingsRow | undefined;
		if (row) return rowToStorySettings(row);
		return {
			storyId,
			cardName: null,
			characterPrompt: null,
			persona: null,
			templateId: null,
			model: null,
			budgetTokens: DEFAULT_STORY_SETTINGS_VALUES.budgetTokens,
			structuredOutput: DEFAULT_STORY_SETTINGS_VALUES.structuredOutput,
			temperature: DEFAULT_STORY_SETTINGS_VALUES.temperature,
			maxTokens: DEFAULT_STORY_SETTINGS_VALUES.maxTokens,
			reasoning: DEFAULT_STORY_SETTINGS_VALUES.reasoning,
			turnMode: DEFAULT_STORY_SETTINGS_VALUES.turnMode,
			maxReadRounds: DEFAULT_STORY_SETTINGS_VALUES.maxReadRounds,
			deepMaxToolCalls: DEFAULT_STORY_SETTINGS_VALUES.deepMaxToolCalls,
			deepTimeoutMs: DEFAULT_STORY_SETTINGS_VALUES.deepTimeoutMs,
			deepContextTokenLimit:
				DEFAULT_STORY_SETTINGS_VALUES.deepContextTokenLimit,
			deepRecentToolSteps: DEFAULT_STORY_SETTINGS_VALUES.deepRecentToolSteps,
			viewpoint: null,
			directorConfig: DEFAULT_STORY_SETTINGS_VALUES.directorConfig,
			historyBlockPolicy: DEFAULT_STORY_SETTINGS_VALUES.historyBlockPolicy,
			gapPassEnabled: DEFAULT_STORY_SETTINGS_VALUES.gapPassEnabled,
			gapPlanSeconds: DEFAULT_STORY_SETTINGS_VALUES.gapPlanSeconds,
			imageConfig: DEFAULT_STORY_SETTINGS_VALUES.imageConfig,
			pluginOverrides: DEFAULT_STORY_SETTINGS_VALUES.pluginOverrides,
			updatedAt: story.createdAt,
		};
	}

	/** 故事是否保存过设置；没有保存时 `getStorySettings` 返回默认值。 */
	hasStorySettings(storyId: string): boolean {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.#db
			.prepare("SELECT 1 AS present FROM story_settings WHERE story_id = ?")
			.get(storyId) as { readonly present: number } | undefined;
		return row !== undefined;
	}

	/** 合并式更新；`null` 清空可空字段，未出现的字段保持原值。 */
	updateStorySettings(
		storyId: string,
		update: StorySettingsUpdate,
	): StorySettings {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		rejectUnknownKeys(
			update as unknown as Record<string, unknown>,
			STORY_SETTINGS_UPDATE_KEYS,
			"故事设置",
		);
		assertStorySettingsUpdate(update);
		if (
			update.templateId !== undefined &&
			update.templateId !== null &&
			update.templateId !== DEFAULT_CONTEXT_TEMPLATE_ID &&
			!this.getContextTemplate(update.templateId)
		) {
			throw new Error(`上下文模板不存在：${update.templateId}`);
		}
		const current = this.getStorySettings(storyId);
		const next = {
			cardName:
				update.cardName !== undefined ? update.cardName : current.cardName,
			characterPrompt:
				update.characterPrompt !== undefined
					? update.characterPrompt
					: current.characterPrompt,
			persona: update.persona !== undefined ? update.persona : current.persona,
			templateId:
				update.templateId !== undefined
					? update.templateId
					: current.templateId,
			model: update.model !== undefined ? update.model : current.model,
			budgetTokens:
				update.budgetTokens !== undefined
					? update.budgetTokens
					: current.budgetTokens,
			structuredOutput:
				update.structuredOutput !== undefined
					? update.structuredOutput
					: current.structuredOutput,
			temperature:
				update.temperature !== undefined
					? update.temperature
					: current.temperature,
			maxTokens:
				update.maxTokens !== undefined ? update.maxTokens : current.maxTokens,
			reasoning:
				update.reasoning !== undefined ? update.reasoning : current.reasoning,
			turnMode:
				update.turnMode !== undefined ? update.turnMode : current.turnMode,
			maxReadRounds:
				update.maxReadRounds !== undefined
					? update.maxReadRounds
					: current.maxReadRounds,
			deepMaxToolCalls:
				update.deepMaxToolCalls !== undefined
					? update.deepMaxToolCalls
					: current.deepMaxToolCalls,
			deepTimeoutMs:
				update.deepTimeoutMs !== undefined
					? update.deepTimeoutMs
					: current.deepTimeoutMs,
			deepContextTokenLimit:
				update.deepContextTokenLimit !== undefined
					? update.deepContextTokenLimit
					: current.deepContextTokenLimit,
			deepRecentToolSteps:
				update.deepRecentToolSteps !== undefined
					? update.deepRecentToolSteps
					: current.deepRecentToolSteps,
			viewpoint:
				update.viewpoint !== undefined ? update.viewpoint : current.viewpoint,
			directorConfig:
				update.directorConfig !== undefined
					? update.directorConfig
					: current.directorConfig,
			historyBlockPolicy:
				update.historyBlockPolicy !== undefined
					? update.historyBlockPolicy
					: current.historyBlockPolicy,
			gapPassEnabled:
				update.gapPassEnabled !== undefined
					? update.gapPassEnabled
					: current.gapPassEnabled,
			gapPlanSeconds:
				update.gapPlanSeconds !== undefined
					? update.gapPlanSeconds
					: current.gapPlanSeconds,
			imageConfig:
				update.imageConfig !== undefined
					? update.imageConfig
					: current.imageConfig,
			pluginOverrides:
				update.pluginOverrides !== undefined
					? update.pluginOverrides
					: current.pluginOverrides,
		};
		const updatedAt = new Date().toISOString();
		this.#db
			.prepare(
				`INSERT INTO story_settings
					(story_id, card_name, character_prompt, persona, template_id, model,
					 budget_tokens, structured_output, temperature, max_tokens, reasoning,
					 turn_mode, max_read_rounds, deep_max_tool_calls, deep_timeout_ms,
					 deep_context_token_limit, deep_recent_tool_steps, viewpoint,
					 director_config, history_block_policy, gap_pass_enabled,
					 gap_plan_seconds, image_config, plugin_overrides, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(story_id) DO UPDATE SET
					card_name = excluded.card_name,
					character_prompt = excluded.character_prompt,
					persona = excluded.persona,
					template_id = excluded.template_id,
					model = excluded.model,
					budget_tokens = excluded.budget_tokens,
					structured_output = excluded.structured_output,
					temperature = excluded.temperature,
					max_tokens = excluded.max_tokens,
					reasoning = excluded.reasoning,
					turn_mode = excluded.turn_mode,
					max_read_rounds = excluded.max_read_rounds,
					deep_max_tool_calls = excluded.deep_max_tool_calls,
					deep_timeout_ms = excluded.deep_timeout_ms,
					deep_context_token_limit = excluded.deep_context_token_limit,
					deep_recent_tool_steps = excluded.deep_recent_tool_steps,
					viewpoint = excluded.viewpoint,
					director_config = excluded.director_config,
					history_block_policy = excluded.history_block_policy,
					gap_pass_enabled = excluded.gap_pass_enabled,
					gap_plan_seconds = excluded.gap_plan_seconds,
					image_config = excluded.image_config,
					plugin_overrides = excluded.plugin_overrides,
					updated_at = excluded.updated_at`,
			)
			.run(
				storyId,
				next.cardName,
				next.characterPrompt,
				next.persona,
				next.templateId,
				next.model,
				next.budgetTokens,
				next.structuredOutput,
				next.temperature,
				next.maxTokens,
				next.reasoning,
				next.turnMode,
				next.maxReadRounds,
				next.deepMaxToolCalls,
				next.deepTimeoutMs,
				next.deepContextTokenLimit,
				next.deepRecentToolSteps,
				next.viewpoint,
				serializeDirectorConfig(next.directorConfig),
				serializeHistoryBlockPolicy(next.historyBlockPolicy),
				next.gapPassEnabled ? 1 : 0,
				next.gapPlanSeconds,
				serializeJsonValue(next.imageConfig, "故事设置的 imageConfig"),
				serializeJsonValue(
					parseStoryPluginOverrides(next.pluginOverrides),
					"故事设置的 pluginOverrides",
				),
				updatedAt,
			);
		const saved = this.getStorySettings(storyId);
		if (saved.updatedAt !== updatedAt) {
			throw new Error(`故事设置写入后读取失败：${storyId}`);
		}
		return saved;
	}

	createContextTemplate(
		input: CreateContextTemplateInput,
	): ContextTemplateRecord {
		const name = requireTemplateName(input.name);
		assertStoredContextTemplate(input.template);
		if (this.#findTemplateIdByName(name) !== null) {
			throw new Error(`上下文模板名称已存在：${name}`);
		}
		const id = randomUUID();
		const now = new Date().toISOString();
		this.#db
			.prepare(
				`INSERT INTO context_templates (id, name, template, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				name,
				serializeJsonValue(input.template, "上下文模板"),
				now,
				now,
			);
		const saved = this.getContextTemplate(id);
		if (!saved) {
			throw new Error(`上下文模板写入后读取失败：${id}`);
		}
		return saved;
	}

	getContextTemplate(id: string): ContextTemplateRecord | null {
		assertNonEmptyString(id, "上下文模板 id");
		const row = this.#db
			.prepare("SELECT * FROM context_templates WHERE id = ?")
			.get(id) as ContextTemplateRow | undefined;
		return row ? rowToContextTemplate(row) : null;
	}

	listContextTemplates(): ContextTemplateRecord[] {
		const rows = this.#db
			.prepare("SELECT * FROM context_templates ORDER BY rowid ASC")
			.all() as ContextTemplateRow[];
		return rows.map(rowToContextTemplate);
	}

	updateContextTemplate(
		id: string,
		update: UpdateContextTemplateInput,
	): ContextTemplateRecord {
		const current = this.getContextTemplate(id);
		if (!current) {
			throw new Error(`上下文模板不存在：${id}`);
		}
		rejectUnknownKeys(
			update as unknown as Record<string, unknown>,
			CONTEXT_TEMPLATE_UPDATE_KEYS,
			"上下文模板更新",
		);
		if (update.name === undefined && update.template === undefined) {
			throw new Error("上下文模板更新至少要包含 name 或 template");
		}
		const name =
			update.name === undefined
				? current.name
				: requireTemplateName(update.name);
		if (name !== current.name) {
			const existingId = this.#findTemplateIdByName(name);
			if (existingId !== null && existingId !== id) {
				throw new Error(`上下文模板名称已存在：${name}`);
			}
		}
		const template = update.template ?? current.template;
		assertStoredContextTemplate(template);
		this.#db
			.prepare(
				`UPDATE context_templates
				SET name = ?, template = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(
				name,
				serializeJsonValue(template, "上下文模板"),
				new Date().toISOString(),
				id,
			);
		const saved = this.getContextTemplate(id);
		if (!saved) {
			throw new Error(`上下文模板更新后读取失败：${id}`);
		}
		return saved;
	}

	/** 仍被故事设置引用的模板不能删除，否则运行时会找不到模板。 */
	deleteContextTemplate(id: string): void {
		if (!this.getContextTemplate(id)) {
			throw new Error(`上下文模板不存在：${id}`);
		}
		const storyId = this.findStoryUsingContextTemplate(id);
		if (storyId !== null) {
			throw new Error(`上下文模板 ${id} 仍被故事 ${storyId} 引用，不能删除`);
		}
		this.#db.prepare("DELETE FROM context_templates WHERE id = ?").run(id);
	}

	/** 返回引用该模板的第一个故事 id；没有引用时返回 null。 */
	findStoryUsingContextTemplate(id: string): string | null {
		const row = this.#db
			.prepare(
				"SELECT story_id FROM story_settings WHERE template_id = ? LIMIT 1",
			)
			.get(id) as { readonly story_id: string } | undefined;
		return row ? row.story_id : null;
	}

	#findTemplateIdByName(name: string): string | null {
		const row = this.#db
			.prepare("SELECT id FROM context_templates WHERE name = ?")
			.get(name) as { readonly id: string } | undefined;
		return row ? row.id : null;
	}

	/**
	 * 按规范化名称合并：同一故事里的同名实体只有一行，重复导入只补别名。
	 * 名称本身总是登记为别名，因此 resolveEntities 也能按名称命中。
	 */
	upsertEntity(input: NewEntityInput): Entity {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!isEntityKind(input.kind)) {
			throw new Error(`实体类型不合法：${String(input.kind)}`);
		}
		assertNonEmptyString(input.name, "实体名称");
		assertNonEmptyString(input.source, "实体来源");
		const description = input.description ?? "";
		if (typeof description !== "string") {
			throw new Error("实体描述必须是字符串");
		}
		const normalizedName = normalizeEntityName(input.name);
		if (normalizedName.length === 0) {
			throw new Error(`实体名称去掉标点与空白后为空：${input.name}`);
		}
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (input.id !== undefined) {
			assertNonEmptyString(input.id, "实体 id");
		}
		const aliases = normaliseAliases(input.aliases ?? []);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "实体的创建时间");
		const existing = this.#db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities WHERE story_id = ? AND normalized_name = ?`,
			)
			.get(input.storyId, normalizedName) as EntityRow | undefined;
		const insertAlias = this.#db.prepare(
			`INSERT INTO entity_aliases (entity_id, story_id, alias, normalized_alias)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (entity_id, normalized_alias) DO NOTHING`,
		);
		return this.#db.transaction((): Entity => {
			if (existing) {
				for (const alias of aliases) {
					insertAlias.run(
						existing.id,
						input.storyId,
						alias.alias,
						alias.normalized,
					);
				}
				const merged = this.getEntity(existing.id);
				if (!merged) {
					throw new Error(`实体读取失败：${existing.id}`);
				}
				return merged;
			}
			const id = input.id ?? randomUUID();
			if (this.getEntity(id)) {
				throw new Error(`实体已存在：${id}`);
			}
			this.#db
				.prepare(
					`INSERT INTO entities
						(id, story_id, kind, name, normalized_name, description, source, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					id,
					input.storyId,
					input.kind,
					input.name,
					normalizedName,
					description,
					input.source,
					createdAt,
				);
			insertAlias.run(id, input.storyId, input.name, normalizedName);
			for (const alias of aliases) {
				insertAlias.run(id, input.storyId, alias.alias, alias.normalized);
			}
			const entity = this.getEntity(id);
			if (!entity) {
				throw new Error(`实体写入后读取失败：${id}`);
			}
			return entity;
		})();
	}

	getEntity(id: string): Entity | null {
		const row = this.#db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities WHERE id = ?`,
			)
			.get(id) as EntityRow | undefined;
		return row ? this.#rowToEntity(row) : null;
	}

	findEntityByName(storyId: string, name: string): Entity | null {
		assertNonEmptyString(storyId, "故事 id");
		assertNonEmptyString(name, "实体名称");
		const normalized = normalizeEntityName(name);
		if (normalized.length === 0) return null;
		const row = this.#db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities WHERE story_id = ? AND normalized_name = ?`,
			)
			.get(storyId, normalized) as EntityRow | undefined;
		return row ? this.#rowToEntity(row) : null;
	}

	listEntities(storyId: string, options: ListEntitiesOptions = {}): Entity[] {
		assertNonEmptyString(storyId, "故事 id");
		if (options.kind !== undefined && !isEntityKind(options.kind)) {
			throw new Error(`实体类型不合法：${String(options.kind)}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT id, story_id, kind, name, description, source, created_at
				FROM entities
				WHERE story_id = @storyId AND (@kind IS NULL OR kind = @kind)
				ORDER BY row_id ASC`,
			)
			.all({ storyId, kind: options.kind ?? null }) as EntityRow[];
		return rows.map((row) => this.#rowToEntity(row));
	}

	/**
	 * 按规范化后的别名返回全部命中的实体。不同实体可以共用同一个别名
	 * （例如角色名同时作为某个世界书词条的主关键词），调用方拿到全部候选。
	 */
	resolveEntities(
		alias: string,
		options: ResolveEntitiesOptions = {},
	): Entity[] {
		assertNonEmptyString(alias, "实体别名");
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0) {
			throw new Error(`实体别名去掉标点与空白后为空：${alias}`);
		}
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "故事 id");
			if (!this.getStory(options.storyId)) {
				throw new Error(`故事不存在：${options.storyId}`);
			}
		}
		const rows = this.#db
			.prepare(
				`SELECT e.id, e.story_id, e.kind, e.name, e.description, e.source, e.created_at
				FROM entities AS e
				JOIN entity_aliases AS a ON a.entity_id = e.id
				WHERE a.normalized_alias = @normalized
					AND (@storyId IS NULL OR e.story_id = @storyId)
				ORDER BY e.row_id ASC`,
			)
			.all({
				normalized,
				storyId: options.storyId ?? null,
			}) as EntityRow[];
		return rows.map((row) => this.#rowToEntity(row));
	}

	addEntityAlias(entityId: string, alias: string): Entity {
		assertNonEmptyString(entityId, "实体 id");
		const entity = this.getEntity(entityId);
		if (!entity) {
			throw new Error(`实体不存在：${entityId}`);
		}
		assertNonEmptyString(alias, "实体别名");
		const normalized = normalizeEntityName(alias);
		if (normalized.length === 0) {
			throw new Error(`实体别名去掉标点与空白后为空：${alias}`);
		}
		this.#db
			.prepare(
				`INSERT INTO entity_aliases (entity_id, story_id, alias, normalized_alias)
				VALUES (?, ?, ?, ?)
				ON CONFLICT (entity_id, normalized_alias) DO NOTHING`,
			)
			.run(entity.id, entity.storyId, alias, normalized);
		const updated = this.getEntity(entity.id);
		if (!updated) {
			throw new Error(`实体读取失败：${entity.id}`);
		}
		return updated;
	}

	#rowToEntity(row: EntityRow): Entity {
		if (!isEntityKind(row.kind)) {
			throw new Error(`实体 ${row.id} 的类型不合法：${row.kind}`);
		}
		const aliases = this.#db
			.prepare(
				"SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY rowid ASC",
			)
			.all(row.id) as EntityAliasRow[];
		return {
			id: row.id,
			storyId: row.story_id,
			kind: row.kind,
			name: row.name,
			description: row.description,
			source: row.source,
			createdAt: row.created_at,
			aliases: aliases.map((alias) => alias.alias),
		};
	}

	appendNode(input: AppendNodeInput): TimelineNode {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!isTimelineRole(input.role)) {
			throw new Error(`楼层角色不合法：${String(input.role)}`);
		}
		if (typeof input.raw !== "string") {
			throw new Error("楼层原文必须是字符串");
		}
		if (input.parentId !== null) {
			assertNonEmptyString(input.parentId, "父节点 id");
		}
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (input.parentId !== null) {
			const parent = this.getNode(input.parentId);
			if (!parent) {
				throw new Error(`父节点不存在：${input.parentId}`);
			}
			if (parent.storyId !== input.storyId) {
				throw new Error(
					`父节点 ${input.parentId} 属于另一个故事 ${parent.storyId}`,
				);
			}
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "楼层 id");
		if (this.getNode(id)) {
			throw new Error(`楼层节点已存在：${id}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		const insertNode = this.#db.prepare(
			`INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
		);
		const moveHead = this.#db.prepare(
			"UPDATE stories SET head_node_id = ? WHERE id = ?",
		);
		return this.#db.transaction((): TimelineNode => {
			insertNode.run(
				id,
				input.storyId,
				input.parentId,
				input.role,
				input.raw,
				createdAt,
			);
			moveHead.run(id, input.storyId);
			this.#indexNodeChunks({
				id,
				storyId: input.storyId,
				raw: input.raw,
			});
			const node = this.getNode(id);
			if (!node) {
				throw new Error(`楼层节点写入后读取失败：${id}`);
			}
			return node;
		})();
	}

	getNode(id: string): TimelineNode | null {
		const row = this.#db
			.prepare(
				"SELECT id, story_id, parent_id, role, raw, created_at FROM nodes WHERE id = ?",
			)
			.get(id) as NodeRow | undefined;
		return row ? rowToNode(row) : null;
	}

	/** 按创建顺序列出故事的楼层节点；用于构建分支树。 */
	listStoryNodes(storyId: string): TimelineNode[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT id, story_id, parent_id, role, raw, created_at
				FROM nodes
				WHERE story_id = ?
				ORDER BY created_at ASC, row_id ASC`,
			)
			.all(storyId) as NodeRow[];
		return rows.map(rowToNode);
	}

	/** 返回从根到指定节点的完整路径，顺序为根在前。 */
	getPathToNode(nodeId: string): TimelineNode[] {
		const start = this.getNode(nodeId);
		if (!start) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const path: TimelineNode[] = [start];
		let current = start;
		while (current.parentId !== null) {
			const parent = this.getNode(current.parentId);
			if (!parent) {
				throw new Error(`楼层树断裂：${current.id} 的父节点缺失`);
			}
			path.push(parent);
			current = parent;
		}
		return path.reverse();
	}

	/** 返回故事的当前分支指针；故事还没有楼层时返回 null。 */
	getHead(storyId: string): TimelineNode | null {
		assertNonEmptyString(storyId, "故事 id");
		const row = this.#db
			.prepare("SELECT head_node_id FROM stories WHERE id = ?")
			.get(storyId) as { readonly head_node_id: string | null } | undefined;
		if (row === undefined) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (row.head_node_id === null) return null;
		const node = this.getNode(row.head_node_id);
		if (!node) {
			throw new Error(
				`楼层树断裂：故事 ${storyId} 的 head 节点 ${row.head_node_id} 缺失`,
			);
		}
		return node;
	}

	/** 把 head 指向指定楼层，用于切换分支。 */
	setHead(storyId: string, nodeId: string): TimelineNode {
		assertNonEmptyString(storyId, "故事 id");
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		if (node.storyId !== storyId) {
			throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
		}
		this.#db
			.prepare("UPDATE stories SET head_node_id = ? WHERE id = ?")
			.run(nodeId, storyId);
		return node;
	}

	/** 返回从根到当前 head 的路径；没有 head 时返回空数组。 */
	getPathToHead(storyId: string): TimelineNode[] {
		const head = this.getHead(storyId);
		return head === null ? [] : this.getPathToNode(head.id);
	}

	/** 以某个楼层为参照重新生成一条回复：新建兄弟节点，旧节点保留。 */
	swipeNode(nodeId: string, raw: string): TimelineNode {
		return this.#db.transaction((): TimelineNode => {
			const node = this.#appendSibling(nodeId, raw);
			this.recordPreference({
				storyId: node.storyId,
				nodeId: node.id,
				kind: "swipe",
				payload: { abandonedNodeId: nodeId, acceptedNodeId: node.id },
				createdAt: node.createdAt,
			});
			return node;
		})();
	}

	/** 编辑某条回复：旧节点保留为兄弟节点，编辑后的内容写入新节点。 */
	editNode(nodeId: string, raw: string): TimelineNode {
		return this.#db.transaction((): TimelineNode => {
			const node = this.#appendSibling(nodeId, raw);
			this.recordPreference({
				storyId: node.storyId,
				nodeId: node.id,
				kind: "edit",
				payload: { beforeNodeId: nodeId, afterNodeId: node.id },
				createdAt: node.createdAt,
			});
			return node;
		})();
	}

	/** 用户基于某个节点继续发言时，该节点即被确认；有子节点就是已确认。 */
	isNodeConfirmed(nodeId: string): boolean {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT 1 AS present FROM nodes WHERE parent_id = ? LIMIT 1")
			.get(nodeId) as { readonly present: number } | undefined;
		return row !== undefined;
	}

	#appendSibling(nodeId: string, raw: string): TimelineNode {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (typeof raw !== "string" || raw.length === 0) {
			throw new Error("新建楼层的原文必须是非空字符串");
		}
		const original = this.getNode(nodeId);
		if (!original) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		return this.appendNode({
			storyId: original.storyId,
			parentId: original.parentId,
			role: original.role,
			raw,
		});
	}

	/**
	 * 追加一条偏好信号。只写本表，不进入剧情上下文、预算、检索与导演。
	 * 与对应操作放在同一个事务里，任一步失败时操作与记录一起回滚。
	 */
	recordPreference(input: NewPreferenceEventInput): PreferenceEvent {
		assertNonEmptyString(input.storyId, "偏好记录的故事 id");
		assertNonEmptyString(input.nodeId, "偏好记录的楼层 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isPreferenceEventKind(input.kind)) {
			throw new Error(`偏好记录的种类不合法：${String(input.kind)}`);
		}
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`偏好记录的楼层不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`偏好记录的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const payload = assertPreferencePayload(input.kind, input.payload);
		this.#assertPreferenceReferences(
			input.kind,
			input.storyId,
			input.nodeId,
			payload,
		);
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "偏好记录 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "偏好记录时间");
		this.#db
			.prepare(
				`INSERT INTO preference_events (id, story_id, node_id, kind, payload, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.storyId,
				input.nodeId,
				input.kind,
				JSON.stringify(payload),
				createdAt,
			);
		return {
			id,
			storyId: input.storyId,
			nodeId: input.nodeId,
			kind: input.kind,
			payload,
			createdAt,
		};
	}

	/** 按创建顺序列出故事的偏好记录，可以按种类过滤。 */
	listPreferenceEvents(
		storyId: string,
		options: ListPreferenceEventsOptions = {},
	): PreferenceEvent[] {
		assertNonEmptyString(storyId, "偏好记录的故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const kind = options.kind;
		if (kind !== undefined && !isPreferenceEventKind(kind)) {
			throw new Error(`偏好记录的种类不合法：${String(kind)}`);
		}
		const rows =
			kind === undefined
				? (this.#db
						.prepare(
							`SELECT * FROM preference_events
							WHERE story_id = ?
							ORDER BY created_at ASC, rowid ASC`,
						)
						.all(storyId) as PreferenceEventRow[])
				: (this.#db
						.prepare(
							`SELECT * FROM preference_events
							WHERE story_id = ? AND kind = ?
							ORDER BY created_at ASC, rowid ASC`,
						)
						.all(storyId, kind) as PreferenceEventRow[]);
		return rows.map(rowToPreferenceEvent);
	}

	#assertPreferenceReferences(
		kind: PreferenceEventKind,
		storyId: string,
		nodeId: string,
		payload: PreferenceEventPayload,
	): void {
		if (kind === "swipe") {
			const { abandonedNodeId, acceptedNodeId } =
				payload as SwipePreferencePayload;
			if (acceptedNodeId !== nodeId) {
				throw new Error(
					`swipe 的 acceptedNodeId ${acceptedNodeId} 必须等于记录的所在楼层 ${nodeId}`,
				);
			}
			this.#assertPreferenceNodeInStory(
				abandonedNodeId,
				storyId,
				"被放弃的楼层",
			);
		} else if (kind === "edit") {
			const { beforeNodeId, afterNodeId } = payload as EditPreferencePayload;
			if (afterNodeId !== nodeId) {
				throw new Error(
					`edit 的 afterNodeId ${afterNodeId} 必须等于记录的所在楼层 ${nodeId}`,
				);
			}
			this.#assertPreferenceNodeInStory(beforeNodeId, storyId, "编辑前的楼层");
		} else if (kind === "card_decision") {
			const { cardId } = payload as CardDecisionPreferencePayload;
			const card = this.getLedgerChangeCard(cardId);
			if (card === null) {
				throw new Error(`变更卡不存在：${cardId}`);
			}
			if (card.storyId !== storyId) {
				throw new Error(`变更卡 ${cardId} 属于另一个故事 ${card.storyId}`);
			}
			if (card.sourceNodeId !== nodeId) {
				throw new Error(
					`card_decision 的所在楼层 ${nodeId} 必须与变更卡的来源楼层 ${card.sourceNodeId} 一致`,
				);
			}
		}
	}

	#assertPreferenceNodeInStory(
		nodeId: string,
		storyId: string,
		label: string,
	): void {
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`${label}不存在：${nodeId}`);
		}
		if (node.storyId !== storyId) {
			throw new Error(`${label} ${nodeId} 属于另一个故事 ${node.storyId}`);
		}
	}

	appendStateDiff(input: NewStateDiff): StateDiff {
		const [stored] = this.appendStateDiffs([input]);
		if (!stored) {
			throw new Error("状态 diff 写入失败");
		}
		return stored;
	}

	appendStateDiffs(inputs: readonly NewStateDiff[]): StateDiff[] {
		if (!Array.isArray(inputs)) {
			throw new Error("状态 diff 必须是数组");
		}
		if (inputs.length === 0) {
			return [];
		}
		const normalised = inputs.map((input, index) =>
			this.#normaliseStateDiff(input, index),
		);
		const createdAt = new Date().toISOString();
		const insert = this.#db.prepare(
			`INSERT INTO state_diffs (story_id, node_id, ordinal, path, op, value, reason, source, story_time_start, story_time_end, confidence, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const nextOrdinal = this.#db.prepare(
			"SELECT COALESCE(MAX(ordinal), -1) + 1 AS next_ordinal FROM state_diffs WHERE node_id = ?",
		);
		// 写入新的 diff 后，该楼层及其全部后代的快照都已过期。
		const invalidateSnapshots = this.#db.prepare(
			`WITH RECURSIVE affected(node_id) AS (
				SELECT id FROM nodes WHERE id = ?
				UNION ALL
				SELECT nodes.id FROM nodes JOIN affected ON nodes.parent_id = affected.node_id
			)
			DELETE FROM state_snapshots WHERE node_id IN (SELECT node_id FROM affected)`,
		);
		const run = this.#db.transaction(
			(diffs: readonly NormalisedStateDiff[]): StateDiff[] => {
				const ordinals = new Map<string, number>();
				const stored: StateDiff[] = [];
				for (const diff of diffs) {
					let ordinal = ordinals.get(diff.nodeId);
					if (ordinal === undefined) {
						const row = nextOrdinal.get(diff.nodeId) as {
							next_ordinal: number;
						};
						ordinal = row.next_ordinal;
					}
					const info = insert.run(
						diff.storyId,
						diff.nodeId,
						ordinal,
						JSON.stringify(diff.path),
						diff.op,
						diff.valueJson,
						diff.reason,
						diff.source,
						diff.storyTime?.start ?? null,
						diff.storyTime?.end ?? null,
						diff.confidence,
						createdAt,
					);
					ordinals.set(diff.nodeId, ordinal + 1);
					stored.push({
						id: Number(info.lastInsertRowid),
						storyId: diff.storyId,
						nodeId: diff.nodeId,
						ordinal,
						path: diff.path,
						op: diff.op,
						value: diff.valueJson === null ? null : JSON.parse(diff.valueJson),
						reason: diff.reason,
						source: diff.source,
						storyTime: diff.storyTime,
						confidence: diff.confidence,
						createdAt,
					});
				}
				for (const nodeId of new Set(diffs.map((diff) => diff.nodeId))) {
					invalidateSnapshots.run(nodeId);
				}
				return stored;
			},
		);
		return run(normalised);
	}

	/** 读取某个楼层节点产生的状态 diff，按写入顺序排列。 */
	getStateDiffs(nodeId: string): StateDiff[] {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				"SELECT * FROM state_diffs WHERE node_id = ? ORDER BY ordinal ASC",
			)
			.all(nodeId) as StateDiffRow[];
		return rows.map(rowToStateDiff);
	}

	/**
	 * 删除某个楼层上的状态 diff；结算器替换不合格条目时使用。
	 * 传入不属于该楼层的 id 时整次抛错，不删除任何行。
	 */
	deleteStateDiffs(nodeId: string, ids: readonly number[]): number {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		if (!Array.isArray(ids)) {
			throw new Error("要删除的状态 diff id 必须是数组");
		}
		if (ids.length === 0) return 0;
		for (const id of ids) {
			if (!Number.isInteger(id) || id < 1) {
				throw new Error(`状态 diff id 必须是正整数：${String(id)}`);
			}
		}
		const remove = this.#db.prepare(
			"DELETE FROM state_diffs WHERE id = ? AND node_id = ?",
		);
		const invalidateSnapshots = this.#db.prepare(
			`WITH RECURSIVE affected(node_id) AS (
				SELECT id FROM nodes WHERE id = ?
				UNION ALL
				SELECT nodes.id FROM nodes JOIN affected ON nodes.parent_id = affected.node_id
			)
			DELETE FROM state_snapshots WHERE node_id IN (SELECT node_id FROM affected)`,
		);
		return this.#db.transaction((): number => {
			for (const id of ids) {
				const info = remove.run(id, nodeId);
				if (info.changes !== 1) {
					throw new Error(`楼层 ${nodeId} 没有 id 为 ${id} 的状态 diff`);
				}
			}
			invalidateSnapshots.run(nodeId);
			return ids.length;
		})();
	}

	/** 按路径顺序（根在前）累加所需的全部状态 diff。 */
	getStateDiffsAlongPath(nodeId: string): StateDiff[] {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT state_diffs.*
				FROM state_diffs JOIN chain ON state_diffs.node_id = chain.node_id
				ORDER BY chain.depth DESC, state_diffs.ordinal ASC`,
			)
			.all(nodeId) as StateDiffRow[];
		return rows.map(rowToStateDiff);
	}

	/** 统计路径上的 diff 条数，不读取 diff 内容。 */
	countStateDiffsAlongPath(nodeId: string): number {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare(
				`WITH RECURSIVE chain(node_id) AS (
					SELECT id FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT COUNT(*) AS count
				FROM state_diffs JOIN chain ON state_diffs.node_id = chain.node_id`,
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 记录一个楼层的结算结果；同一楼层只允许结算一次。 */
	recordLedgerSettlement(input: NewLedgerSettlement): LedgerSettlement {
		assertNonEmptyString(input.nodeId, "结算记录的楼层 id");
		assertNonEmptyString(input.storyId, "结算记录的故事 id");
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`结算记录的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (!(LEDGER_SOURCES as readonly string[]).includes(input.source)) {
			throw new Error(
				`结算记录的来源只能是 ${LEDGER_SOURCES.join("、")}，收到 ${JSON.stringify(input.source)}`,
			);
		}
		if (!Number.isInteger(input.addedCount) || input.addedCount < 0) {
			throw new Error("结算记录的新增条数必须是非负整数");
		}
		const repairs = assertLedgerRepairs(input.repairs, `楼层 ${input.nodeId}`);
		if (this.getLedgerSettlement(input.nodeId) !== null) {
			throw new Error(`楼层 ${input.nodeId} 已经结算过`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "结算记录的创建时间");
		this.#db
			.prepare(
				`INSERT INTO ledger_settlements
					(node_id, story_id, source, added_count, repairs, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.nodeId,
				input.storyId,
				input.source,
				input.addedCount,
				JSON.stringify(repairs),
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			source: input.source,
			addedCount: input.addedCount,
			repairs,
			createdAt,
		};
	}

	/** 读取某个楼层的结算结果；没有结算过时返回 null。 */
	getLedgerSettlement(nodeId: string): LedgerSettlement | null {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM ledger_settlements WHERE node_id = ?")
			.get(nodeId) as LedgerSettlementRow | undefined;
		return row === undefined ? null : rowToLedgerSettlement(row);
	}

	/** 按创建顺序列出故事的结算记录。 */
	listLedgerSettlements(storyId: string): LedgerSettlement[] {
		assertNonEmptyString(storyId, "结算记录的故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM ledger_settlements
				WHERE story_id = ?
				ORDER BY created_at ASC, node_id ASC`,
			)
			.all(storyId) as LedgerSettlementRow[];
		return rows.map(rowToLedgerSettlement);
	}

	/**
	 * 沿当前路径取最多 limit 个已落定、尚未结算的助手楼层，按从旧到新排列。
	 * 已落定指正文生成完成；中止保存的部分正文不算。
	 */
	listUnsettledSettledAssistantNodes(storyId: string, limit: number): string[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (!Number.isInteger(limit) || limit < 1) {
			throw new Error("结算窗口的楼层数必须是正整数");
		}
		const head = this.getHead(storyId);
		if (head === null) return [];
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT nodes.id AS node_id
				FROM nodes
				JOIN chain ON nodes.id = chain.node_id
				LEFT JOIN traces ON traces.node_id = nodes.id
				WHERE nodes.role = 'assistant'
					AND COALESCE(json_extract(traces.trace, '$.llm.stopReason'), '') <> 'aborted'
					AND COALESCE(json_extract(traces.trace, '$.profile'), 'native') <> 'naive'
					AND NOT EXISTS (
						SELECT 1 FROM ledger_settlements
						WHERE ledger_settlements.node_id = nodes.id
					)
				ORDER BY chain.depth DESC
				LIMIT ?`,
			)
			.all(head.id, limit) as { readonly node_id: string }[];
		return rows.map((row) => row.node_id);
	}

	/** 写入一张变更卡；同一 id 只能写一次。 */
	insertLedgerChangeCard(input: NewLedgerChangeCardInput): LedgerChangeCard {
		assertNonEmptyString(input.id, "变更卡 id");
		assertNonEmptyString(input.storyId, "变更卡的故事 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (
			!(LEDGER_CHANGE_CARD_SOURCES as readonly string[]).includes(input.source)
		) {
			throw new Error(
				`变更卡的来源只能是 ${LEDGER_CHANGE_CARD_SOURCES.join("、")}，收到 ${JSON.stringify(input.source)}`,
			);
		}
		const assistantConversationId = input.assistantConversationId ?? null;
		if (input.source === "assistant") {
			if (assistantConversationId === null) {
				throw new Error("助手生成的变更卡必须写明 assistantConversationId");
			}
			const conversation = this.getAssistantConversation(
				assistantConversationId,
			);
			if (conversation === null) {
				throw new Error(`助手会话不存在：${assistantConversationId}`);
			}
			if (
				conversation.storyId !== null &&
				conversation.storyId !== input.storyId
			) {
				throw new Error(
					`变更卡的 storyId 与会话所属故事不一致：${input.storyId}`,
				);
			}
		} else if (assistantConversationId !== null) {
			throw new Error("只有助手生成的变更卡可以带 assistantConversationId");
		}
		const node = this.getNode(input.sourceNodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.sourceNodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`变更卡的 storyId 与来源楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (typeof input.text !== "string" || input.text.trim().length === 0) {
			throw new Error("变更卡的说明必须是非空字符串");
		}
		if (!isLedgerChangeCardStatus(input.status)) {
			throw new Error(
				`变更卡的状态只能是 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}，收到 ${String(input.status)}`,
			);
		}
		const diffs = assertLedgerChangeCardDiffs(
			input.diffs,
			`变更卡 ${input.id}`,
		);
		if (diffs.length === 0 && input.status !== "rejected") {
			throw new Error(`变更卡 ${input.id} 没有修改内容`);
		}
		const before = assertLedgerBeforeEntries(
			input.before,
			diffs,
			`变更卡 ${input.id} 的 before`,
		);
		const rejectionReason = input.rejectionReason ?? null;
		if (input.status === "rejected") {
			if (rejectionReason === null || rejectionReason.trim().length === 0) {
				throw new Error("被拒绝的变更卡必须写明原因");
			}
		} else if (rejectionReason !== null) {
			throw new Error("只有被拒绝的变更卡可以带拒绝原因");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "变更卡的创建时间");
		const decidedAt = input.decidedAt ?? null;
		if (input.status === "pending") {
			if (decidedAt !== null) {
				throw new Error("待定变更卡不能有决定时间");
			}
		} else if (decidedAt === null) {
			throw new Error("已决定的变更卡必须有决定时间");
		}
		if (this.getLedgerChangeCard(input.id) !== null) {
			throw new Error(`变更卡已存在：${input.id}`);
		}
		this.#db
			.prepare(
				`INSERT INTO ledger_change_cards
					(id, story_id, source, assistant_conversation_id, source_node_id, text, diffs, before, status, rejection_reason, created_at, decided_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.id,
				input.storyId,
				input.source,
				assistantConversationId,
				input.sourceNodeId,
				input.text,
				JSON.stringify(diffs),
				JSON.stringify(before),
				input.status,
				rejectionReason,
				createdAt,
				decidedAt,
			);
		const card = this.getLedgerChangeCard(input.id);
		if (card === null) {
			throw new Error(`变更卡 ${input.id} 写入后读取失败`);
		}
		return card;
	}

	/** 读取一张变更卡；不存在时返回 null。 */
	getLedgerChangeCard(cardId: string): LedgerChangeCard | null {
		assertNonEmptyString(cardId, "变更卡 id");
		const row = this.#db
			.prepare("SELECT * FROM ledger_change_cards WHERE id = ?")
			.get(cardId) as LedgerChangeCardRow | undefined;
		return row === undefined ? null : rowToLedgerChangeCard(row);
	}

	/** 按创建顺序列出故事的变更卡，可以按状态过滤。 */
	listLedgerChangeCards(
		storyId: string,
		options: { readonly status?: LedgerChangeCardStatus } = {},
	): LedgerChangeCard[] {
		assertNonEmptyString(storyId, "变更卡的故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const status = options.status;
		if (status !== undefined && !isLedgerChangeCardStatus(status)) {
			throw new Error(
				`变更卡的状态只能是 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}，收到 ${String(status)}`,
			);
		}
		const rows =
			status === undefined
				? (this.#db
						.prepare(
							`SELECT * FROM ledger_change_cards
							WHERE story_id = ?
							ORDER BY created_at ASC, id ASC`,
						)
						.all(storyId) as LedgerChangeCardRow[])
				: (this.#db
						.prepare(
							`SELECT * FROM ledger_change_cards
							WHERE story_id = ? AND status = ?
							ORDER BY created_at ASC, id ASC`,
						)
						.all(storyId, status) as LedgerChangeCardRow[]);
		return rows.map(rowToLedgerChangeCard);
	}

	/** 更新变更卡的状态与决定时间；卡片不能退回待定。 */
	updateLedgerChangeCardStatus(
		cardId: string,
		status: LedgerChangeCardStatus,
		decidedAt: string,
	): LedgerChangeCard {
		assertNonEmptyString(cardId, "变更卡 id");
		if (!isLedgerChangeCardStatus(status)) {
			throw new Error(
				`变更卡的状态只能是 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}，收到 ${String(status)}`,
			);
		}
		if (status === "pending") {
			throw new Error("变更卡不能退回待定状态");
		}
		assertNonEmptyString(decidedAt, "变更卡的决定时间");
		return this.#db.transaction((): LedgerChangeCard => {
			const existing = this.getLedgerChangeCard(cardId);
			if (existing === null) {
				throw new Error(`变更卡不存在：${cardId}`);
			}
			const info = this.#db
				.prepare(
					"UPDATE ledger_change_cards SET status = ?, decided_at = ? WHERE id = ?",
				)
				.run(status, decidedAt, cardId);
			if (info.changes !== 1) {
				throw new Error(`变更卡不存在：${cardId}`);
			}
			if (status === "approved" || status === "rejected") {
				this.recordPreference({
					storyId: existing.storyId,
					nodeId: existing.sourceNodeId,
					kind: "card_decision",
					payload: { cardId, decision: status },
					createdAt: decidedAt,
				});
			}
			const card = this.getLedgerChangeCard(cardId);
			if (card === null) {
				throw new Error(`变更卡 ${cardId} 更新后读取失败`);
			}
			return card;
		})();
	}

	/** 写入一个楼层的现场分析；同一楼层重复执行覆盖同一行。 */
	saveSceneAnalysis(input: NewSceneAnalysis): SceneAnalysis {
		assertNonEmptyString(input.nodeId, "现场分析的楼层 id");
		assertNonEmptyString(input.storyId, "现场分析的故事 id");
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`现场分析的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (typeof input.text !== "string" || input.text.trim().length === 0) {
			throw new Error("现场分析的正文必须是非空字符串");
		}
		if (!Number.isInteger(input.tokenCount) || input.tokenCount < 0) {
			throw new Error("现场分析的 token 数必须是非负整数");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "现场分析的创建时间");
		this.#db
			.prepare(
				`INSERT INTO scene_analyses (node_id, story_id, text, token_count, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (node_id) DO UPDATE SET
					text = excluded.text,
					token_count = excluded.token_count,
					created_at = excluded.created_at`,
			)
			.run(
				input.nodeId,
				input.storyId,
				input.text,
				input.tokenCount,
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			text: input.text,
			tokenCount: input.tokenCount,
			createdAt,
		};
	}

	/** 读取一个楼层的现场分析；没有时返回 null。 */
	getSceneAnalysis(nodeId: string): SceneAnalysis | null {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM scene_analyses WHERE node_id = ?")
			.get(nodeId) as SceneAnalysisRow | undefined;
		return row === undefined ? null : rowToSceneAnalysis(row);
	}

	/** 沿节点所在的路径取最近一层的现场分析；没有时返回 null。 */
	getLatestSceneAnalysisOnPath(nodeId: string): SceneAnalysis | null {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT scene_analyses.*
				FROM scene_analyses JOIN chain ON scene_analyses.node_id = chain.node_id
				ORDER BY chain.depth ASC
				LIMIT 1`,
			)
			.get(nodeId) as SceneAnalysisRow | undefined;
		return row === undefined ? null : rowToSceneAnalysis(row);
	}

	/** 写入一个楼层的导演手记修改；每个楼层只有一行，重复写入直接失败。 */
	saveDirectorNotes(input: NewDirectorNoteInput): DirectorNoteRecord {
		assertNonEmptyString(input.nodeId, "导演手记的楼层 id");
		assertNonEmptyString(input.storyId, "导演手记的故事 id");
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`导演手记的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const diffs = assertDirectorNoteDiffs(input.diffs, "导演手记的 diffs");
		if (diffs.length === 0) {
			throw new Error("导演手记的 diffs 至少要有一条");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "导演手记的创建时间");
		this.#db
			.prepare(
				`INSERT INTO director_notes (node_id, story_id, diffs, created_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(input.nodeId, input.storyId, JSON.stringify(diffs), createdAt);
		return { nodeId: input.nodeId, storyId: input.storyId, diffs, createdAt };
	}

	/** 读取一个楼层的手记修改；没有记录时返回 null。 */
	getDirectorNotes(nodeId: string): DirectorNoteRecord | null {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM director_notes WHERE node_id = ?")
			.get(nodeId) as DirectorNoteRow | undefined;
		return row === undefined ? null : rowToDirectorNote(row);
	}

	/**
	 * 沿节点所在的路径从根到该楼层逐楼应用手记修改：后写的楼层覆盖同名键，
	 * `delete` 移除键。其他分支的记录不参与累加。
	 */
	readDirectorNoteEntries(nodeId: string): DirectorNoteEntry[] {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT director_notes.*
				FROM director_notes JOIN chain ON director_notes.node_id = chain.node_id
				ORDER BY chain.depth DESC`,
			)
			.all(nodeId) as DirectorNoteRow[];
		let entries: DirectorNoteEntry[] = [];
		for (const row of rows) {
			entries = applyDirectorNoteDiffs(entries, rowToDirectorNote(row).diffs);
		}
		return entries;
	}

	/** 写入一个楼层的合并调用执行记录；同一楼层重复执行覆盖同一行。 */
	saveGapPassRun(input: NewGapPassRun): GapPassRun {
		assertNonEmptyString(input.nodeId, "合并调用记录的楼层 id");
		assertNonEmptyString(input.storyId, "合并调用记录的故事 id");
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`合并调用记录的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const rejectedSegments = assertGapPassRejections(
			input.rejectedSegments,
			"合并调用记录的 rejectedSegments",
		);
		const droppedEntries = assertGapPassDroppedEntries(
			input.droppedEntries ?? [],
			"合并调用记录的 droppedEntries",
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "合并调用记录的创建时间");
		this.#db
			.prepare(
				`INSERT INTO gap_pass_runs (node_id, story_id, rejected_segments, dropped_entries, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (node_id) DO UPDATE SET
					rejected_segments = excluded.rejected_segments,
					dropped_entries = excluded.dropped_entries,
					created_at = excluded.created_at`,
			)
			.run(
				input.nodeId,
				input.storyId,
				JSON.stringify(rejectedSegments),
				JSON.stringify(droppedEntries),
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			rejectedSegments,
			droppedEntries,
			createdAt,
		};
	}

	/** 读取一个楼层的合并调用执行记录；没有时返回 null。 */
	getGapPassRun(nodeId: string): GapPassRun | null {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM gap_pass_runs WHERE node_id = ?")
			.get(nodeId) as GapPassRunRow | undefined;
		return row === undefined ? null : rowToGapPassRun(row);
	}

	/** 写入开局包；同一故事只保留一行，重复生成覆盖旧内容。 */
	saveOpeningPack(input: SaveOpeningPackInput): OpeningPackRecord {
		assertNonEmptyString(input.storyId, "开局包的故事 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isJsonObject(input.payload)) {
			throw new Error("开局包的内容必须是 JSON 对象");
		}
		assertNonEmptyString(input.inputHash, "开局包的输入摘要");
		if (input.sourceNodeId !== null) {
			assertNonEmptyString(input.sourceNodeId, "开局包的来源楼层 id");
			const node = this.getNode(input.sourceNodeId);
			if (!node) {
				throw new Error(`楼层节点不存在：${input.sourceNodeId}`);
			}
			if (node.storyId !== input.storyId) {
				throw new Error(
					`开局包的来源楼层 ${input.sourceNodeId} 属于另一个故事`,
				);
			}
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "开局包的创建时间");
		this.#db
			.prepare(
				`INSERT INTO opening_packs
					(story_id, payload, input_hash, source_node_id, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (story_id) DO UPDATE SET
					payload = excluded.payload,
					input_hash = excluded.input_hash,
					source_node_id = excluded.source_node_id,
					created_at = excluded.created_at`,
			)
			.run(
				input.storyId,
				JSON.stringify(input.payload),
				input.inputHash,
				input.sourceNodeId,
				createdAt,
			);
		const saved = this.getOpeningPack(input.storyId);
		if (saved === null) {
			throw new Error(`开局包写入后读取失败：${input.storyId}`);
		}
		return saved;
	}

	/** 读取故事的开局包；没有生成过时返回 null。 */
	getOpeningPack(storyId: string): OpeningPackRecord | null {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM opening_packs WHERE story_id = ?")
			.get(storyId) as OpeningPackRow | undefined;
		return row === undefined ? null : rowToOpeningPack(row);
	}

	/**
	 * 追加一批开场候选。编号接着故事里已有的最大编号，批内按给定顺序；
	 * 已有候选的状态不变。
	 */
	appendOpeningCandidates(
		input: AppendOpeningCandidatesInput,
	): OpeningCandidateRecord[] {
		assertNonEmptyString(input.storyId, "开场候选的故事 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!Array.isArray(input.raws) || input.raws.length === 0) {
			throw new Error("开场候选至少需要一段正文");
		}
		for (const raw of input.raws) {
			if (typeof raw !== "string" || raw.trim().length === 0) {
				throw new Error("开场候选的正文必须是非空字符串");
			}
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "开场候选的创建时间");
		const insert = this.#db.prepare(
			`INSERT INTO opening_candidates
				(id, story_id, ordinal, raw, status, created_at)
			VALUES (?, ?, ?, ?, 'pending', ?)`,
		);
		return this.#db.transaction((): OpeningCandidateRecord[] => {
			const row = this.#db
				.prepare(
					"SELECT COALESCE(MAX(ordinal) + 1, 0) AS next FROM opening_candidates WHERE story_id = ?",
				)
				.get(input.storyId) as { readonly next: number };
			const created: OpeningCandidateRecord[] = [];
			input.raws.forEach((raw, index) => {
				const id = randomUUID();
				insert.run(id, input.storyId, row.next + index, raw, createdAt);
				const candidate = this.getOpeningCandidate(id);
				if (candidate === null) {
					throw new Error(`开场候选写入后读取失败：${id}`);
				}
				created.push(candidate);
			});
			return created;
		})();
	}

	/** 按追加顺序列出故事的开场候选；可以只看某个状态。 */
	listOpeningCandidates(
		storyId: string,
		options: ListOpeningCandidatesOptions = {},
	): OpeningCandidateRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (
			options.status !== undefined &&
			!isOpeningCandidateStatus(options.status)
		) {
			throw new Error(`开场候选的状态不合法：${String(options.status)}`);
		}
		const rows =
			options.status === undefined
				? (this.#db
						.prepare(
							"SELECT * FROM opening_candidates WHERE story_id = ? ORDER BY ordinal ASC",
						)
						.all(storyId) as OpeningCandidateRow[])
				: (this.#db
						.prepare(
							"SELECT * FROM opening_candidates WHERE story_id = ? AND status = ? ORDER BY ordinal ASC",
						)
						.all(storyId, options.status) as OpeningCandidateRow[]);
		return rows.map(rowToOpeningCandidate);
	}

	/** 读取一条开场候选；不存在时返回 null。 */
	getOpeningCandidate(id: string): OpeningCandidateRecord | null {
		assertNonEmptyString(id, "开场候选 id");
		const row = this.#db
			.prepare("SELECT * FROM opening_candidates WHERE id = ?")
			.get(id) as OpeningCandidateRow | undefined;
		return row === undefined ? null : rowToOpeningCandidate(row);
	}

	/**
	 * 选中一条待选候选：把它的正文原样追加为故事根部的首个助手楼层，
	 * 状态改为 chosen，同一故事其余待选候选改为 discarded。
	 */
	chooseOpeningCandidate(
		id: string,
		options: { readonly chosenAt?: string } = {},
	): ChooseOpeningCandidateResult {
		assertNonEmptyString(id, "开场候选 id");
		const chosenAt = options.chosenAt ?? new Date().toISOString();
		assertNonEmptyString(chosenAt, "开场候选的选中时间");
		return this.#db.transaction((): ChooseOpeningCandidateResult => {
			const candidate = this.getOpeningCandidate(id);
			if (candidate === null) {
				throw new Error(`开场候选不存在：${id}`);
			}
			if (candidate.status !== "pending") {
				throw new Error(
					`开场候选 ${id} 的状态是 ${candidate.status}，只有 pending 可以选中`,
				);
			}
			const head = this.getHead(candidate.storyId);
			if (head !== null) {
				throw new Error(
					`故事 ${candidate.storyId} 已经有楼层 ${head.id}，开场候选只能成为首个楼层`,
				);
			}
			const node = this.appendNode({
				storyId: candidate.storyId,
				parentId: null,
				role: "assistant",
				raw: candidate.raw,
				createdAt: chosenAt,
			});
			this.#db
				.prepare("UPDATE opening_candidates SET status = 'chosen' WHERE id = ?")
				.run(id);
			this.#db
				.prepare(
					"UPDATE opening_candidates SET status = 'discarded' WHERE story_id = ? AND status = 'pending'",
				)
				.run(candidate.storyId);
			const updated = this.getOpeningCandidate(id);
			if (updated === null) {
				throw new Error(`开场候选状态更新后读取失败：${id}`);
			}
			return { candidate: updated, node };
		})();
	}

	/** 列出所有 workflow，按创建顺序。 */
	listImageWorkflows(): ImageWorkflowRecord[] {
		const rows = this.#db
			.prepare("SELECT * FROM image_workflows ORDER BY created_at ASC, id ASC")
			.all() as ImageWorkflowRow[];
		return rows.map(rowToImageWorkflow);
	}

	/** 读取一个 workflow；不存在时返回 null。 */
	getImageWorkflow(id: string): ImageWorkflowRecord | null {
		assertNonEmptyString(id, "图片 workflow id");
		const row = this.#db
			.prepare("SELECT * FROM image_workflows WHERE id = ?")
			.get(id) as ImageWorkflowRow | undefined;
		return row === undefined ? null : rowToImageWorkflow(row);
	}

	/** 保存 workflow；同名导入更新同一行，id 与创建时间不变。 */
	saveImageWorkflow(input: SaveImageWorkflowInput): ImageWorkflowRecord {
		const name = input.name.trim();
		if (name.length === 0) {
			throw new Error("图片 workflow 的 name 必须是非空字符串");
		}
		const provider = input.provider.trim();
		if (provider.length === 0) {
			throw new Error("图片 workflow 的 provider 必须是非空字符串");
		}
		const workflow = parseComfyUiWorkflow(
			input.payload,
			"图片 workflow 的 payload",
		);
		const slots = assertComfyUiSlots(
			workflow,
			input.slots,
			"图片 workflow 的 slots",
		);
		const now = new Date().toISOString();
		this.#db
			.prepare(
				`INSERT INTO image_workflows
					(id, name, provider, payload, slots, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(name) DO UPDATE SET
					provider = excluded.provider,
					payload = excluded.payload,
					slots = excluded.slots,
					updated_at = excluded.updated_at`,
			)
			.run(
				randomUUID(),
				name,
				provider,
				serializeJsonValue(workflow, "图片 workflow 的 payload"),
				serializeJsonValue(slots, "图片 workflow 的 slots"),
				now,
				now,
			);
		const row = this.#db
			.prepare("SELECT * FROM image_workflows WHERE name = ?")
			.get(name) as ImageWorkflowRow | undefined;
		if (row === undefined) {
			throw new Error(`图片 workflow 写入后读取失败：${name}`);
		}
		return rowToImageWorkflow(row);
	}

	/** 删除没有被图片记录引用的 workflow。 */
	deleteImageWorkflow(id: string): void {
		assertNonEmptyString(id, "图片 workflow id");
		this.#db.transaction((): void => {
			const row = this.#db
				.prepare("SELECT id FROM image_workflows WHERE id = ?")
				.get(id) as { readonly id: string } | undefined;
			if (row === undefined) {
				throw new Error(`图片 workflow 不存在：${id}`);
			}
			const imageCount = this.countNodeImagesForWorkflow(id);
			if (imageCount > 0) {
				throw new ImageWorkflowInUseError(id, imageCount);
			}
			this.#db.prepare("DELETE FROM image_workflows WHERE id = ?").run(id);
		})();
	}

	/** 统计引用某个 workflow 的图片记录数。 */
	countNodeImagesForWorkflow(workflowId: string): number {
		assertNonEmptyString(workflowId, "图片 workflow id");
		const row = this.#db
			.prepare(
				"SELECT COUNT(*) AS count FROM node_images WHERE workflow_id = ?",
			)
			.get(workflowId) as { readonly count: number };
		return row.count;
	}

	/** 楼层上的图片记录，按 ordinal 排序。 */
	listNodeImages(nodeId: string): NodeImageRecord[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const rows = this.#db
			.prepare(
				"SELECT * FROM node_images WHERE node_id = ? ORDER BY ordinal ASC",
			)
			.all(nodeId) as NodeImageRow[];
		return rows.map(rowToNodeImage);
	}

	/** 一批楼层上的图片记录，一次查询完成，按楼层与序号排序。 */
	listNodeImagesForNodes(nodeIds: readonly string[]): NodeImageRecord[] {
		const unique = [...new Set(nodeIds)];
		if (unique.length === 0) return [];
		for (const nodeId of unique) {
			assertNonEmptyString(nodeId, "楼层节点 id");
		}
		const placeholders = unique.map(() => "?").join(", ");
		const rows = this.#db
			.prepare(
				`SELECT * FROM node_images WHERE node_id IN (${placeholders})
				ORDER BY node_id ASC, ordinal ASC`,
			)
			.all(...unique) as NodeImageRow[];
		return rows.map(rowToNodeImage);
	}

	/** 故事里全部图片记录，按楼层与序号排序。 */
	listStoryNodeImages(storyId: string): NodeImageRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		const rows = this.#db
			.prepare(
				"SELECT * FROM node_images WHERE story_id = ? ORDER BY node_id ASC, ordinal ASC",
			)
			.all(storyId) as NodeImageRow[];
		return rows.map(rowToNodeImage);
	}

	/** 按创建顺序读取待出图的记录；不传 limit 时返回全部。 */
	listPendingNodeImages(storyId: string, limit?: number): NodeImageRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
			throw new Error("待出图记录的条数必须是正整数");
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM node_images
				WHERE story_id = ? AND status = 'pending'
				ORDER BY created_at ASC, id ASC
				LIMIT ?`,
			)
			.all(storyId, limit ?? -1) as NodeImageRow[];
		return rows.map(rowToNodeImage);
	}

	getNodeImage(id: string): NodeImageRecord | null {
		assertNonEmptyString(id, "图片记录 id");
		const row = this.#db
			.prepare("SELECT * FROM node_images WHERE id = ?")
			.get(id) as NodeImageRow | undefined;
		return row === undefined ? null : rowToNodeImage(row);
	}

	/** 楼层已经接受了多少张图；失败的行也占一个位次。 */
	countNodeImages(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const row = this.#db
			.prepare("SELECT COUNT(*) AS count FROM node_images WHERE node_id = ?")
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 故事里出现过图片的楼层 id，用来计算两次出图之间的楼层间隔。 */
	listNodeImageNodeIds(storyId: string): string[] {
		assertNonEmptyString(storyId, "故事 id");
		const rows = this.#db
			.prepare(
				"SELECT DISTINCT node_id FROM node_images WHERE story_id = ? ORDER BY node_id ASC",
			)
			.all(storyId) as { readonly node_id: string }[];
		return rows.map((row) => row.node_id);
	}

	/** 登记一条待出图记录；序号在同一楼层的写入事务里递增。 */
	insertNodeImage(input: NewNodeImageInput): NodeImageRecord {
		assertNonEmptyString(input.storyId, "图片记录的故事 id");
		assertNonEmptyString(input.nodeId, "图片记录的楼层 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const node = this.getNode(input.nodeId);
		if (node === null) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`图片记录的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (node.role !== "assistant") {
			throw new Error(`图片只能挂在助手楼层上：${input.nodeId}`);
		}
		const request = validateImagePromptRequest(input.request);
		if (input.seed !== null) {
			if (
				typeof input.seed !== "number" ||
				!Number.isInteger(input.seed) ||
				input.seed < 0 ||
				input.seed > Number.MAX_SAFE_INTEGER
			) {
				throw new Error("图片记录的 seed 必须是非负整数或 null");
			}
		}
		if (this.getImageWorkflow(input.workflowId) === null) {
			throw new Error(`图片 workflow 不存在：${input.workflowId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "图片记录的创建时间");
		const id = randomUUID();
		this.#db.transaction((): void => {
			const ordinal = this.countNodeImages(input.nodeId);
			this.#db
				.prepare(
					`INSERT INTO node_images
						(id, story_id, node_id, ordinal, status, request, workflow_id,
						 seed, attempts, created_at, updated_at)
					VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 0, ?, ?)`,
				)
				.run(
					id,
					input.storyId,
					input.nodeId,
					ordinal,
					serializeJsonValue(request, "图片记录的 request"),
					input.workflowId,
					input.seed,
					createdAt,
					createdAt,
				);
		})();
		const saved = this.getNodeImage(id);
		if (saved === null) {
			throw new Error(`图片记录写入后读取失败：${id}`);
		}
		return saved;
	}

	/** 把待出图记录标为执行中，并写入编译后的提示词。 */
	startNodeImage(
		id: string,
		input: {
			readonly prompt: string;
			readonly negativePrompt: string;
			readonly updatedAt?: string;
		},
	): NodeImageRecord {
		const image = this.#requireNodeImage(id);
		if (image.status !== "pending") {
			throw new Error(
				`图片记录 ${id} 的状态是 ${image.status}，只有 pending 可以开始执行`,
			);
		}
		const updatedAt = input.updatedAt ?? new Date().toISOString();
		assertNonEmptyString(updatedAt, "图片记录的更新时间");
		this.#db
			.prepare(
				`UPDATE node_images
				SET status = 'running', prompt = ?, negative_prompt = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(input.prompt, input.negativePrompt, updatedAt, id);
		return this.#requireNodeImage(id);
	}

	/** 出图完成：写入文件元数据与宽高。 */
	finishNodeImage(
		id: string,
		input: {
			readonly fileName: string;
			readonly mediaType: string;
			readonly width: number;
			readonly height: number;
			readonly updatedAt?: string;
		},
	): NodeImageRecord {
		const image = this.#requireNodeImage(id);
		if (image.status !== "running") {
			throw new Error(
				`图片记录 ${id} 的状态是 ${image.status}，只有 running 可以完成`,
			);
		}
		assertNonEmptyString(input.fileName, "图片文件名");
		assertNonEmptyString(input.mediaType, "图片媒体类型");
		if (!Number.isInteger(input.width) || input.width < 1) {
			throw new Error("图片宽度必须是正整数");
		}
		if (!Number.isInteger(input.height) || input.height < 1) {
			throw new Error("图片高度必须是正整数");
		}
		const updatedAt = input.updatedAt ?? new Date().toISOString();
		assertNonEmptyString(updatedAt, "图片记录的更新时间");
		this.#db
			.prepare(
				`UPDATE node_images
				SET status = 'done', file_name = ?, media_type = ?, width = ?,
					height = ?, error = NULL, updated_at = ?
				WHERE id = ?`,
			)
			.run(
				input.fileName,
				input.mediaType,
				input.width,
				input.height,
				updatedAt,
				id,
			);
		return this.#requireNodeImage(id);
	}

	/** 单行失败：累计次数，达到上限后标为失败，否则退回待办。 */
	failNodeImage(
		id: string,
		input: {
			readonly error: string;
			readonly maxAttempts: number;
			readonly updatedAt?: string;
		},
	): NodeImageRecord {
		const image = this.#requireNodeImage(id);
		if (image.status !== "running") {
			throw new Error(
				`图片记录 ${id} 的状态是 ${image.status}，只有 running 可以失败`,
			);
		}
		if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
			throw new Error("图片记录的最大尝试次数必须是正整数");
		}
		const attempts = image.attempts + 1;
		const status = attempts >= input.maxAttempts ? "failed" : "pending";
		const updatedAt = input.updatedAt ?? new Date().toISOString();
		assertNonEmptyString(updatedAt, "图片记录的更新时间");
		this.#db
			.prepare(
				`UPDATE node_images
				SET status = ?, attempts = ?, error = ?, updated_at = ?
				WHERE id = ?`,
			)
			.run(
				status,
				attempts,
				input.error.length > 0 ? input.error : "出图失败",
				updatedAt,
				id,
			);
		return this.#requireNodeImage(id);
	}

	/**
	 * 进程在执行中途退出后，running 行不会被任务取到；启动时退回 pending。
	 * 失败次数只在真正失败时累计，这里不改。
	 */
	requeueRunningNodeImages(storyId?: string): number {
		if (storyId !== undefined) assertNonEmptyString(storyId, "故事 id");
		const result = this.#db
			.prepare(
				`UPDATE node_images
				SET status = 'pending', updated_at = @updatedAt
				WHERE status = 'running' AND (@storyId IS NULL OR story_id = @storyId)`,
			)
			.run({
				storyId: storyId ?? null,
				updatedAt: new Date().toISOString(),
			});
		return result.changes;
	}

	/** 手动重试：只接受 failed 行，退回 pending 并清零失败次数。 */
	retryNodeImage(id: string): NodeImageRecord {
		const image = this.#requireNodeImage(id);
		if (image.status !== "failed") {
			throw new Error(
				`图片记录 ${id} 的状态是 ${image.status}，只有 failed 可以重试`,
			);
		}
		this.#db
			.prepare(
				`UPDATE node_images
				SET status = 'pending', attempts = 0, error = NULL, updated_at = ?
				WHERE id = ?`,
			)
			.run(new Date().toISOString(), id);
		return this.#requireNodeImage(id);
	}

	#requireNodeImage(id: string): NodeImageRecord {
		const image = this.getNodeImage(id);
		if (image === null) throw new Error(`图片记录不存在：${id}`);
		return image;
	}

	/** 列出故事的视觉档案，按写入顺序。 */
	listCharacterVisualProfiles(storyId: string): CharacterVisualProfileRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				"SELECT * FROM character_visual_profiles WHERE story_id = ? ORDER BY rowid ASC",
			)
			.all(storyId) as CharacterVisualProfileRow[];
		return rows.map(rowToCharacterVisualProfile);
	}

	/** 读取一个故事里某个人的视觉档案；没有时返回 null。 */
	getCharacterVisualProfile(
		storyId: string,
		character: string,
	): CharacterVisualProfileRecord | null {
		assertNonEmptyString(storyId, "故事 id");
		assertNonEmptyString(character, "视觉档案的人物名");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.#db
			.prepare(
				"SELECT * FROM character_visual_profiles WHERE story_id = ? AND character = ?",
			)
			.get(storyId, character.trim()) as CharacterVisualProfileRow | undefined;
		return row === undefined ? null : rowToCharacterVisualProfile(row);
	}

	/**
	 * 保存一批视觉档案；同一个故事里的同一人物覆盖原行，不新增。
	 * 创建时间只在首次写入时确定，更新时间每次刷新。
	 */
	saveCharacterVisualProfiles(
		input: SaveCharacterVisualProfilesInput,
	): CharacterVisualProfileRecord[] {
		assertNonEmptyString(input.storyId, "视觉档案的故事 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isVisualProfileSource(input.source)) {
			throw new Error(`视觉档案的来源不合法：${String(input.source)}`);
		}
		if (!Array.isArray(input.profiles) || input.profiles.length === 0) {
			throw new Error("视觉档案至少需要一条");
		}
		const profiles = input.profiles.map((profile, index) =>
			assertCharacterVisualProfile(profile, `视觉档案[${index}]`),
		);
		assertUniqueVisualProfiles(profiles);
		const createdAt = input.createdAt ?? new Date().toISOString();
		const updatedAt = input.updatedAt ?? createdAt;
		assertNonEmptyString(createdAt, "视觉档案的创建时间");
		assertNonEmptyString(updatedAt, "视觉档案的更新时间");
		const upsert = this.#db.prepare(
			`INSERT INTO character_visual_profiles
				(story_id, character, profile, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (story_id, character) DO UPDATE SET
				profile = excluded.profile,
				source = excluded.source,
				updated_at = excluded.updated_at`,
		);
		this.#db.transaction(() => {
			for (const profile of profiles) {
				upsert.run(
					input.storyId,
					profile.character,
					serializeJsonValue(profile, `视觉档案 ${profile.character}`),
					input.source,
					createdAt,
					updatedAt,
				);
			}
		})();
		return profiles.map((profile) => {
			const saved = this.getCharacterVisualProfile(
				input.storyId,
				profile.character,
			);
			if (saved === null) {
				throw new Error(`视觉档案写入后读取失败：${profile.character}`);
			}
			return saved;
		});
	}

	/**
	 * 记录一次未知实体名称的出现；同一故事、同一规范化名称与类别只累加
	 * 命中次数，首个楼层保持第一次出现的位置。
	 */
	upsertEntityCandidate(input: NewEntityCandidateInput): EntityCandidate {
		assertNonEmptyString(input.storyId, "实体候选的故事 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isEntityKind(input.kind)) {
			throw new Error(`实体候选的 kind 不合法：${String(input.kind)}`);
		}
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`实体候选的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const normalizedName = normalizeEntityName(input.name);
		if (normalizedName.length === 0) {
			throw new Error(`实体名称去掉标点与空白后为空：${input.name}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "实体候选的创建时间");
		this.#db
			.prepare(
				`INSERT INTO entity_candidates
					(story_id, normalized_name, kind, hits, first_node_id, created_at)
				VALUES (?, ?, ?, 1, ?, ?)
				ON CONFLICT (story_id, normalized_name, kind)
				DO UPDATE SET hits = hits + 1`,
			)
			.run(input.storyId, normalizedName, input.kind, input.nodeId, createdAt);
		const row = this.#db
			.prepare(
				`SELECT * FROM entity_candidates
				WHERE story_id = ? AND normalized_name = ? AND kind = ?`,
			)
			.get(input.storyId, normalizedName, input.kind) as
			| EntityCandidateRow
			| undefined;
		if (row === undefined) {
			throw new Error(`实体候选写入后读取失败：${normalizedName}`);
		}
		return rowToEntityCandidate(row);
	}

	/** 列出故事里还没有建档的实体名称，按规范化名称与类别排序。 */
	listEntityCandidates(storyId: string): EntityCandidate[] {
		assertNonEmptyString(storyId, "实体候选的故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM entity_candidates
				WHERE story_id = ?
				ORDER BY normalized_name ASC, kind ASC`,
			)
			.all(storyId) as EntityCandidateRow[];
		return rows.map(rowToEntityCandidate);
	}

	/**
	 * 读取某个楼层末端的累计状态。缓存未命中时从父楼层的快照叠加
	 * 本楼层的 diff 计算，并把结果写入缓存；从根节点开始的路径只计算一次。
	 */
	getStateSnapshot(nodeId: string): StateSnapshot {
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const cached = this.#db
			.prepare(
				`SELECT node_id, story_id, state, computed_at
				FROM state_snapshots WHERE node_id = ?`,
			)
			.get(nodeId) as StateSnapshotRow | undefined;
		if (cached !== undefined) {
			const snapshot = rowToStateSnapshot(cached);
			if (snapshot.storyId !== node.storyId) {
				throw new Error(
					`楼层 ${nodeId} 的状态快照与楼层所属故事不一致：${snapshot.storyId}`,
				);
			}
			return snapshot;
		}
		const baseState =
			node.parentId === null ? {} : this.getStateSnapshot(node.parentId).state;
		const state = applyStateDiffsTo(baseState, this.getStateDiffs(nodeId));
		const computedAt = new Date().toISOString();
		this.#db
			.prepare(
				`INSERT INTO state_snapshots (node_id, story_id, state, computed_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(nodeId, node.storyId, JSON.stringify(state), computedAt);
		return {
			nodeId,
			storyId: node.storyId,
			state,
			computedAt,
		};
	}

	/** 读取当前 head 的累计状态；故事还没有楼层时返回 null。 */
	getStateSnapshotAtHead(storyId: string): StateSnapshot | null {
		const head = this.getHead(storyId);
		return head === null ? null : this.getStateSnapshot(head.id);
	}

	/**
	 * 在一个事务里写入某个楼层抽取出的全部事件。任一条非法时整批回滚。
	 */
	insertMemoryEvents(inputs: readonly NewMemoryEventInput[]): MemoryEvent[] {
		if (!Array.isArray(inputs)) {
			throw new Error("事件记忆必须是数组");
		}
		if (inputs.length === 0) return [];
		const normalised = inputs.map((input, index) =>
			this.#normaliseMemoryEvent(input, index),
		);
		const insert = this.#db.prepare(
			`INSERT INTO memory_events
				(id, story_id, source_node_id, ordinal, story_time, location,
				 participants, importance, knowers, text, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const created: MemoryEvent[] = [];
		this.#db.transaction(() => {
			for (const event of normalised) {
				insert.run(
					event.id,
					event.storyId,
					event.sourceNodeId,
					event.ordinal,
					event.storyTime,
					event.location,
					JSON.stringify(event.participants),
					event.importance,
					JSON.stringify(event.knowers),
					event.text,
					event.source,
					event.createdAt,
				);
				created.push({
					id: event.id,
					storyId: event.storyId,
					sourceNodeId: event.sourceNodeId,
					ordinal: event.ordinal,
					storyTime: event.storyTime,
					location: event.location,
					participants: [...event.participants],
					importance: event.importance,
					knowers: [...event.knowers],
					text: event.text,
					source: event.source,
					createdAt: event.createdAt,
				});
			}
		})();
		return created;
	}

	/**
	 * 列出已经抽取过事件的楼层：已经写入事件或存在抽取记录。
	 * 抽取记录包含没有抽到事件的楼层，用来避免重复抽取。
	 */
	listExtractedEventNodeIds(storyId: string): string[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT source_node_id AS id FROM memory_events
				WHERE story_id = ? AND source = ?
				UNION
				SELECT node_id AS id FROM event_extractions WHERE story_id = ?`,
			)
			.all(storyId, DEFAULT_MEMORY_EVENT_SOURCE, storyId) as {
			readonly id: string;
		}[];
		return rows.map((row) => row.id);
	}

	/**
	 * 在一个事务里写入窗口内的全部事件，并把窗口内每个楼层记为已抽取。
	 * 没有事件的楼层同样写入记录，重跑不会再次抽取。
	 */
	recordEventExtractions(input: RecordEventExtractionsInput): void {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!Array.isArray(input.nodeIds) || input.nodeIds.length === 0) {
			throw new Error("事件抽取窗口的楼层不能为空");
		}
		if (!Array.isArray(input.events)) {
			throw new Error("事件记忆必须是数组");
		}
		const nodeIds = input.nodeIds.map((nodeId, index) => {
			assertNonEmptyString(nodeId, `事件抽取窗口[${index}] 的楼层 id`);
			return nodeId;
		});
		const unique = new Set(nodeIds);
		if (unique.size !== nodeIds.length) {
			throw new Error("事件抽取窗口的楼层重复");
		}
		for (const nodeId of nodeIds) {
			const node = this.getNode(nodeId);
			if (!node) {
				throw new Error(`事件抽取窗口指向的楼层节点不存在：${nodeId}`);
			}
			if (node.storyId !== input.storyId) {
				throw new Error(
					`事件抽取窗口的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
				);
			}
			if (node.role !== "assistant") {
				throw new Error(`事件抽取窗口只接受助手楼层：${nodeId}`);
			}
		}
		const normalised = input.events.map((event, index) =>
			this.#normaliseMemoryEvent(event, index),
		);
		const counts = new Map<string, number>(nodeIds.map((id) => [id, 0]));
		for (const event of normalised) {
			if (!unique.has(event.sourceNodeId)) {
				throw new Error(`事件 ${event.sourceNodeId} 的来源楼层不在本次窗口内`);
			}
			counts.set(event.sourceNodeId, (counts.get(event.sourceNodeId) ?? 0) + 1);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "事件抽取记录的创建时间");
		const insertEvent = this.#db.prepare(
			`INSERT INTO memory_events
				(id, story_id, source_node_id, ordinal, story_time, location,
				 participants, importance, knowers, text, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertExtraction = this.#db.prepare(
			`INSERT INTO event_extractions (node_id, story_id, event_count, created_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (node_id) DO UPDATE SET event_count = excluded.event_count`,
		);
		this.#db.transaction(() => {
			for (const event of normalised) {
				insertEvent.run(
					event.id,
					event.storyId,
					event.sourceNodeId,
					event.ordinal,
					event.storyTime,
					event.location,
					JSON.stringify(event.participants),
					event.importance,
					JSON.stringify(event.knowers),
					event.text,
					event.source,
					event.createdAt,
				);
			}
			for (const nodeId of nodeIds) {
				insertExtraction.run(
					nodeId,
					input.storyId,
					counts.get(nodeId) ?? 0,
					createdAt,
				);
			}
		})();
	}

	/** 按路径顺序（根在前、楼层内按 ordinal）读取事件，支持分页。 */
	getEventsForPath(
		nodeId: string,
		options: GetEventsForPathOptions = {},
	): MemoryEvent[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const limit = options.limit ?? DEFAULT_MEMORY_EVENT_LIMIT;
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > MAX_MEMORY_EVENT_LIMIT
		) {
			throw new Error(
				`事件条数必须是 1 到 ${MAX_MEMORY_EVENT_LIMIT} 之间的整数`,
			);
		}
		const offset = options.offset ?? 0;
		if (!Number.isInteger(offset) || offset < 0) {
			throw new Error("事件分页偏移量必须是不小于 0 的整数");
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE path(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.depth + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT events.*
				FROM memory_events AS events
				JOIN path ON events.source_node_id = path.node_id
				ORDER BY path.depth DESC, events.ordinal ASC
				LIMIT ? OFFSET ?`,
			)
			.all(nodeId, limit, offset) as MemoryEventRow[];
		return rows.map(rowToMemoryEvent);
	}

	/** 读取某个楼层产生的全部事件，按 ordinal 排列。 */
	getEventsForNode(nodeId: string): MemoryEvent[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM memory_events
				WHERE source_node_id = ?
				ORDER BY ordinal ASC`,
			)
			.all(nodeId) as MemoryEventRow[];
		return rows.map(rowToMemoryEvent);
	}

	/** 统计某个楼层已经写入的事件数；可按来源过滤，重复执行前用它判断是否已经处理过。 */
	countEventsForNode(nodeId: string, source?: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		if (source !== undefined) {
			assertNonEmptyString(source, "事件来源");
		}
		const statement =
			source === undefined
				? "SELECT COUNT(*) AS count FROM memory_events WHERE source_node_id = ?"
				: "SELECT COUNT(*) AS count FROM memory_events WHERE source_node_id = ? AND source = ?";
		const params = source === undefined ? [nodeId] : [nodeId, source];
		const row = this.#db.prepare(statement).get(...params) as {
			readonly count: number;
		};
		return row.count;
	}

	/** 写入一批剧情笔记；整批在一个事务里，任一条非法就全部回滚。 */
	insertPlotNotes(inputs: readonly NewPlotNoteInput[]): PlotNote[] {
		if (!Array.isArray(inputs)) {
			throw new Error("剧情笔记必须是数组");
		}
		if (inputs.length === 0) return [];
		const normalised = inputs.map((input, index) =>
			this.#normalisePlotNote(input, index),
		);
		const insert = this.#db.prepare(
			`INSERT INTO plot_notes
				(id, story_id, source_node_id, text, status, created_at, fulfilled_at)
			VALUES (?, ?, ?, ?, 'open', ?, NULL)`,
		);
		const created: PlotNote[] = [];
		this.#db.transaction(() => {
			for (const note of normalised) {
				insert.run(
					note.id,
					note.storyId,
					note.sourceNodeId,
					note.text,
					note.createdAt,
				);
				created.push({
					id: note.id,
					storyId: note.storyId,
					sourceNodeId: note.sourceNodeId,
					text: note.text,
					status: "open",
					createdAt: note.createdAt,
					fulfilledAt: null,
				});
			}
		})();
		return created;
	}

	/** 按创建顺序返回故事里尚未兑现的剧情笔记。 */
	getOpenPlotNotes(storyId: string): PlotNote[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM plot_notes
				WHERE story_id = ? AND status = 'open'
				ORDER BY row_id ASC`,
			)
			.all(storyId) as PlotNoteRow[];
		return rows.map(rowToPlotNote);
	}

	/** 把一条未兑现的剧情笔记标记为已兑现；已兑现的再次兑现直接抛错。 */
	fulfillPlotNote(noteId: string, at: string): PlotNote {
		assertNonEmptyString(noteId, "剧情笔记 id");
		assertNonEmptyString(at, "兑现时间");
		const row = this.#db
			.prepare("SELECT * FROM plot_notes WHERE id = ?")
			.get(noteId) as PlotNoteRow | undefined;
		if (!row) {
			throw new Error(`剧情笔记不存在：${noteId}`);
		}
		const note = rowToPlotNote(row);
		if (note.status !== "open") {
			throw new Error(`剧情笔记已经兑现：${noteId}`);
		}
		this.#db
			.prepare(
				"UPDATE plot_notes SET status = 'fulfilled', fulfilled_at = ? WHERE id = ?",
			)
			.run(at, noteId);
		return { ...note, status: "fulfilled", fulfilledAt: at };
	}

	/** 统计某个楼层新建的剧情笔记数；已兑现的笔记同样计入。 */
	countPlotNotesForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare(
				"SELECT COUNT(*) AS count FROM plot_notes WHERE source_node_id = ?",
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 读出故事的全部计划行，按各自 `ordinal` 排序；嵌套结构由调用方还原。 */
	listDirectorPlanEntries(storyId: string): DirectorPlanEntries {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const arcRows = this.#db
			.prepare(
				"SELECT * FROM story_arcs WHERE story_id = ? ORDER BY ordinal ASC, arc_id ASC",
			)
			.all(storyId) as StoryArcRow[];
		const sequenceRows = this.#db
			.prepare(
				"SELECT * FROM story_sequences WHERE story_id = ? ORDER BY ordinal ASC, sequence_id ASC",
			)
			.all(storyId) as StorySequenceRow[];
		const beatRows = this.#db
			.prepare(
				"SELECT * FROM story_beats WHERE story_id = ? ORDER BY ordinal ASC, beat_id ASC",
			)
			.all(storyId) as StoryBeatRow[];
		return {
			arcs: arcRows.map(rowToStoredDirectorArc),
			sequences: sequenceRows.map(rowToStoredDirectorSequence),
			beats: beatRows.map(rowToStoredDirectorBeat),
		};
	}

	/** 整份替换计划；所有行标为 `source`，旧行在同一事务里删除。 */
	replaceDirectorPlan(
		storyId: string,
		plan: DirectorPlan,
		source: DirectorPlanSource = "player",
	): void {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (!isDirectorPlanSource(source)) {
			throw new Error(`导演计划的来源不合法：${String(source)}`);
		}
		const normalized = parseDirectorPlan(plan);
		const now = new Date().toISOString();
		const insertArc = this.#db.prepare(
			`INSERT INTO story_arcs
				(story_id, arc_id, title, through_line, difficulty, red_lines, source, ordinal, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertSequence = this.#db.prepare(
			`INSERT INTO story_sequences
				(story_id, sequence_id, arc_id, ordinal, title, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const insertBeat = this.#db.prepare(
			`INSERT INTO story_beats
				(story_id, beat_id, sequence_id, ordinal, goal, entry_signs, fit_points, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		this.#db.transaction(() => {
			this.#db
				.prepare("DELETE FROM story_beats WHERE story_id = ?")
				.run(storyId);
			this.#db
				.prepare("DELETE FROM story_sequences WHERE story_id = ?")
				.run(storyId);
			this.#db
				.prepare("DELETE FROM story_arcs WHERE story_id = ?")
				.run(storyId);
			normalized.arcs.forEach((arc, arcIndex) => {
				insertArc.run(
					storyId,
					arc.id,
					arc.title,
					arc.throughLine,
					arc.difficulty,
					JSON.stringify(arc.redLines),
					source,
					arcIndex,
					now,
					now,
				);
				arc.sequences.forEach((sequence, sequenceIndex) => {
					insertSequence.run(
						storyId,
						sequence.id,
						arc.id,
						sequenceIndex,
						sequence.title,
						source,
						now,
						now,
					);
					sequence.beats.forEach((beat, beatIndex) => {
						insertBeat.run(
							storyId,
							beat.id,
							sequence.id,
							beatIndex,
							beat.goal,
							JSON.stringify(beat.entrySigns),
							JSON.stringify(beat.fitPoints),
							source,
							now,
							now,
						);
					});
				});
			});
		})();
	}

	/**
	 * 后台规划器与卡导入的合并写入：按 id 更新或追加，不删除任何行，
	 * `player` 行保持原样。新行追加在各自列表末尾。
	 */
	mergeDirectorPlan(
		storyId: string,
		plan: DirectorPlan,
		source: DirectorPlanMergeSource,
	): DirectorPlanMergeResult {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (source !== "model" && source !== "import") {
			throw new Error(
				`合并导演计划的来源只能是 model 或 import，实际为 ${String(source)}`,
			);
		}
		const normalized = parseDirectorPlan(plan);
		const now = new Date().toISOString();
		const insertArc = this.#db.prepare(
			`INSERT INTO story_arcs
				(story_id, arc_id, title, through_line, difficulty, red_lines, source, ordinal, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const updateArc = this.#db.prepare(
			`UPDATE story_arcs
			SET title = ?, through_line = ?, difficulty = ?, red_lines = ?,
				source = ?, updated_at = ?
			WHERE story_id = ? AND arc_id = ?`,
		);
		const insertSequence = this.#db.prepare(
			`INSERT INTO story_sequences
				(story_id, sequence_id, arc_id, ordinal, title, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const updateSequence = this.#db.prepare(
			`UPDATE story_sequences SET title = ?, source = ?, updated_at = ?
			WHERE story_id = ? AND sequence_id = ?`,
		);
		const insertBeat = this.#db.prepare(
			`INSERT INTO story_beats
				(story_id, beat_id, sequence_id, ordinal, goal, entry_signs, fit_points, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const updateBeat = this.#db.prepare(
			`UPDATE story_beats
			SET goal = ?, entry_signs = ?, fit_points = ?, source = ?, updated_at = ?
			WHERE story_id = ? AND beat_id = ?`,
		);
		return this.#db.transaction((): DirectorPlanMergeResult => {
			const arcRows = new Map<string, StoryArcRow>();
			for (const row of this.#db
				.prepare("SELECT * FROM story_arcs WHERE story_id = ?")
				.all(storyId) as StoryArcRow[]) {
				arcRows.set(row.arc_id, row);
			}
			const sequenceRows = new Map<string, StorySequenceRow>();
			const nextSequenceOrdinal = new Map<string, number>();
			for (const row of this.#db
				.prepare("SELECT * FROM story_sequences WHERE story_id = ?")
				.all(storyId) as StorySequenceRow[]) {
				sequenceRows.set(row.sequence_id, row);
				nextSequenceOrdinal.set(
					row.arc_id,
					Math.max(nextSequenceOrdinal.get(row.arc_id) ?? 0, row.ordinal + 1),
				);
			}
			const beatRows = new Map<string, StoryBeatRow>();
			const nextBeatOrdinal = new Map<string, number>();
			for (const row of this.#db
				.prepare("SELECT * FROM story_beats WHERE story_id = ?")
				.all(storyId) as StoryBeatRow[]) {
				beatRows.set(row.beat_id, row);
				nextBeatOrdinal.set(
					row.sequence_id,
					Math.max(nextBeatOrdinal.get(row.sequence_id) ?? 0, row.ordinal + 1),
				);
			}
			let nextArcOrdinal = 0;
			for (const row of arcRows.values()) {
				nextArcOrdinal = Math.max(nextArcOrdinal, row.ordinal + 1);
			}
			let inserted = 0;
			let updated = 0;
			let skipped = 0;
			for (const arc of normalized.arcs) {
				const existingArc = arcRows.get(arc.id);
				if (existingArc === undefined) {
					insertArc.run(
						storyId,
						arc.id,
						arc.title,
						arc.throughLine,
						arc.difficulty,
						JSON.stringify(arc.redLines),
						source,
						nextArcOrdinal,
						now,
						now,
					);
					nextArcOrdinal += 1;
					inserted += 1;
					nextSequenceOrdinal.set(arc.id, 0);
				} else if (existingArc.source === "player") {
					skipped += 1;
				} else {
					updateArc.run(
						arc.title,
						arc.throughLine,
						arc.difficulty,
						JSON.stringify(arc.redLines),
						source,
						now,
						storyId,
						arc.id,
					);
					updated += 1;
				}
				for (const sequence of arc.sequences) {
					const existingSequence = sequenceRows.get(sequence.id);
					if (existingSequence === undefined) {
						const ordinal = nextSequenceOrdinal.get(arc.id) ?? 0;
						insertSequence.run(
							storyId,
							sequence.id,
							arc.id,
							ordinal,
							sequence.title,
							source,
							now,
							now,
						);
						nextSequenceOrdinal.set(arc.id, ordinal + 1);
						inserted += 1;
						nextBeatOrdinal.set(sequence.id, 0);
					} else {
						if (existingSequence.arc_id !== arc.id) {
							throw new Error(
								`序列 ${sequence.id} 已属于弧线 ${existingSequence.arc_id}，不能改挂到 ${arc.id}`,
							);
						}
						if (existingSequence.source === "player") {
							skipped += 1;
						} else {
							updateSequence.run(
								sequence.title,
								source,
								now,
								storyId,
								sequence.id,
							);
							updated += 1;
						}
					}
					for (const beat of sequence.beats) {
						const existingBeat = beatRows.get(beat.id);
						if (existingBeat === undefined) {
							const ordinal = nextBeatOrdinal.get(sequence.id) ?? 0;
							insertBeat.run(
								storyId,
								beat.id,
								sequence.id,
								ordinal,
								beat.goal,
								JSON.stringify(beat.entrySigns),
								JSON.stringify(beat.fitPoints),
								source,
								now,
								now,
							);
							nextBeatOrdinal.set(sequence.id, ordinal + 1);
							inserted += 1;
						} else {
							if (existingBeat.sequence_id !== sequence.id) {
								throw new Error(
									`节拍 ${beat.id} 已属于序列 ${existingBeat.sequence_id}，不能改挂到 ${sequence.id}`,
								);
							}
							if (existingBeat.source === "player") {
								skipped += 1;
							} else {
								updateBeat.run(
									beat.goal,
									JSON.stringify(beat.entrySigns),
									JSON.stringify(beat.fitPoints),
									source,
									now,
									storyId,
									beat.id,
								);
								updated += 1;
							}
						}
					}
				}
			}
			return { inserted, updated, skipped };
		})();
	}

	/** 读取某个楼层的拍状态；没有写过时返回 null。 */
	getDirectorBeatState(nodeId: string): DirectorBeatState | null {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM director_beat_states WHERE node_id = ?")
			.get(nodeId) as DirectorBeatStateRow | undefined;
		if (row === undefined) return null;
		if (row.story_id !== node.storyId) {
			throw new Error(`楼层 ${nodeId} 的拍状态与楼层所属故事不一致`);
		}
		return rowToDirectorBeatState(row);
	}

	/** 写入某个楼层的拍状态；同一楼层重复写入覆盖旧记录。 */
	saveDirectorBeatState(input: NewDirectorBeatStateInput): DirectorBeatState {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error("拍状态必须是对象");
		}
		assertNonEmptyString(input.nodeId, "拍状态的 nodeId");
		assertNonEmptyString(input.storyId, "拍状态的 storyId");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`拍状态的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		assertNonEmptyString(input.beatId, "拍状态的 beatId");
		if (typeof input.completed !== "boolean") {
			throw new Error("拍状态的 completed 必须是布尔值");
		}
		const beat = this.#db
			.prepare(
				"SELECT 1 AS found FROM story_beats WHERE story_id = ? AND beat_id = ?",
			)
			.get(input.storyId, input.beatId) as
			| { readonly found: number }
			| undefined;
		if (beat === undefined) {
			throw new Error(`节拍不存在：${input.beatId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "拍状态的 createdAt");
		this.#db
			.prepare(
				`INSERT INTO director_beat_states
					(node_id, story_id, beat_id, completed, created_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					beat_id = excluded.beat_id,
					completed = excluded.completed,
					created_at = excluded.created_at`,
			)
			.run(
				input.nodeId,
				input.storyId,
				input.beatId,
				input.completed ? 1 : 0,
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			beatId: input.beatId,
			completed: input.completed,
			createdAt,
		};
	}

	/** 按从给定楼层到根的路径顺序返回拍状态，最近一条在前。 */
	listDirectorBeatStatesAlongPath(nodeId: string): DirectorBeatState[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE path(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.depth + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT s.*
				FROM director_beat_states AS s
				JOIN path ON path.node_id = s.node_id
				ORDER BY path.depth ASC`,
			)
			.all(nodeId) as DirectorBeatStateRow[];
		return rows.map(rowToDirectorBeatState);
	}

	/**
	 * 整批替换某个楼层的候选行动：同一事务里删除旧行再按给定顺序写入，
	 * 重复执行不新增行。
	 */
	replaceDirectorCandidateActions(
		input: ReplaceDirectorCandidateActionsOptions,
	): DirectorCandidateAction[] {
		assertNonEmptyString(input.storyId, "候选行动的故事 id");
		assertNonEmptyString(input.nodeId, "候选行动的楼层 id");
		const node = this.getNode(input.nodeId);
		if (node === null) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`候选行动的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		if (!Array.isArray(input.actions) || input.actions.length === 0) {
			throw new Error("候选行动至少需要一条");
		}
		for (const action of input.actions) {
			if (!isDirectorCandidateKind(action.kind)) {
				throw new Error(`候选行动的 kind 不合法：${String(action.kind)}`);
			}
			if (typeof action.text !== "string" || action.text.trim().length === 0) {
				throw new Error("候选行动的正文必须是非空字符串");
			}
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "候选行动的创建时间");
		const insert = this.#db.prepare(
			`INSERT INTO director_candidate_actions
				(id, story_id, node_id, ordinal, kind, text, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);
		return this.#db.transaction((): DirectorCandidateAction[] => {
			this.#db
				.prepare("DELETE FROM director_candidate_actions WHERE node_id = ?")
				.run(input.nodeId);
			input.actions.forEach((action, ordinal) => {
				insert.run(
					randomUUID(),
					input.storyId,
					input.nodeId,
					ordinal,
					action.kind,
					action.text.trim(),
					createdAt,
				);
			});
			return this.listDirectorCandidateActions(input.nodeId);
		})();
	}

	/** 按 `ordinal` 读出某个楼层的候选行动；没有时返回空数组。 */
	listDirectorCandidateActions(nodeId: string): DirectorCandidateAction[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				"SELECT * FROM director_candidate_actions WHERE node_id = ? ORDER BY ordinal ASC",
			)
			.all(nodeId) as DirectorCandidateActionRow[];
		return rows.map(rowToDirectorCandidateAction);
	}

	/** 写入某个楼层的导演决策；同一楼层重复评估时覆盖旧记录。 */
	saveDirectorDecision(input: NewDirectorDecisionInput): DirectorDecision {
		const normalised = this.#normaliseDirectorDecision(input);
		this.#db
			.prepare(
				`INSERT INTO director_decisions
					(node_id, story_id, directive, mechanisms, signals, created_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					directive = excluded.directive,
					mechanisms = excluded.mechanisms,
					signals = excluded.signals,
					created_at = excluded.created_at`,
			)
			.run(
				normalised.nodeId,
				normalised.storyId,
				normalised.directive,
				serializeJsonValue(normalised.mechanisms, "导演决策的 mechanisms"),
				serializeJsonValue(normalised.signals, "导演决策的 signals"),
				normalised.createdAt,
			);
		return {
			nodeId: normalised.nodeId,
			storyId: normalised.storyId,
			directive: normalised.directive,
			mechanisms: normalised.mechanisms,
			signals: normalised.signals,
			createdAt: normalised.createdAt,
		};
	}

	/** 读取某个楼层的导演决策；没有评估过时返回 null。 */
	getDirectorDecision(nodeId: string): DirectorDecision | null {
		assertNonEmptyString(nodeId, "楼层节点 id");
		const node = this.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM director_decisions WHERE node_id = ?")
			.get(nodeId) as DirectorDecisionRow | undefined;
		if (row === undefined) return null;
		if (row.story_id !== node.storyId) {
			throw new Error(`楼层 ${nodeId} 的导演决策与楼层所属故事不一致`);
		}
		return rowToDirectorDecision(row);
	}

	/** 按根到给定楼层的路径顺序返回决策记录，其他分支的记录不参与。 */
	getDirectorDecisionsAlongPath(nodeId: string): DirectorDecision[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE path(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.depth + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT d.*
				FROM director_decisions AS d
				JOIN path ON path.node_id = d.node_id
				ORDER BY path.depth DESC`,
			)
			.all(nodeId) as DirectorDecisionRow[];
		return rows.map(rowToDirectorDecision);
	}

	/**
	 * 写入事件池。`(story_id, source_id)` 唯一：同一事件的重复导入更新正文、
	 * 条件与冷却，保留首次导入的创建时间。
	 */
	upsertEventPool(
		inputs: readonly NewEventPoolEntryInput[],
	): EventPoolUpsertResult {
		if (!Array.isArray(inputs)) {
			throw new Error("事件池必须是数组");
		}
		if (inputs.length === 0) return { inserted: 0, updated: 0 };
		const normalised = inputs.map((input, index) =>
			this.#normaliseEventPoolEntry(input, index),
		);
		const seen = new Set<string>();
		for (const entry of normalised) {
			const key = `${entry.storyId}\u0000${entry.sourceId}`;
			if (seen.has(key)) {
				throw new Error(
					`同一次写入里事件池条目的 sourceId 重复：${entry.sourceId}`,
				);
			}
			seen.add(key);
		}
		const exists = this.#db.prepare(
			"SELECT 1 AS present FROM event_pool WHERE story_id = ? AND source_id = ?",
		);
		const upsert = this.#db.prepare(
			`INSERT INTO event_pool
				(story_id, source_id, text, preconditions, cooldown, enabled, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (story_id, source_id) DO UPDATE SET
				text = excluded.text,
				preconditions = excluded.preconditions,
				cooldown = excluded.cooldown,
				enabled = excluded.enabled,
				source = excluded.source`,
		);
		const result: { inserted: number; updated: number } = {
			inserted: 0,
			updated: 0,
		};
		this.#db.transaction(() => {
			for (const entry of normalised) {
				const existing =
					exists.get(entry.storyId, entry.sourceId) !== undefined;
				upsert.run(
					entry.storyId,
					entry.sourceId,
					entry.text,
					entry.preconditions === null
						? null
						: serializeJsonValue(
								entry.preconditions,
								`事件池条目 ${entry.sourceId} 的 preconditions`,
							),
					entry.cooldown,
					entry.enabled ? 1 : 0,
					entry.source,
					entry.createdAt,
				);
				if (existing) {
					result.updated += 1;
				} else {
					result.inserted += 1;
				}
			}
		})();
		return result;
	}

	/** 按导入顺序列出故事里的事件池。 */
	listEventPool(storyId: string): EventPoolEntry[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM event_pool
				WHERE story_id = ?
				ORDER BY rowid ASC`,
			)
			.all(storyId) as EventPoolRow[];
		return rows.map(rowToEventPoolEntry);
	}

	/**
	 * 写入 NPC 议程。`(story_id, entity_id)` 唯一：重复导入更新目标、章节间隔与
	 * 重要度，保留已有的进度与上次推进楼层。
	 */
	upsertNpcAgendas(
		inputs: readonly NewNpcAgendaInput[],
	): NpcAgendaUpsertResult {
		if (!Array.isArray(inputs)) {
			throw new Error("NPC 议程必须是数组");
		}
		if (inputs.length === 0) return { inserted: 0, updated: 0 };
		const normalised = inputs.map((input, index) =>
			this.#normaliseNpcAgenda(input, index),
		);
		const seen = new Set<string>();
		for (const agenda of normalised) {
			const key = `${agenda.storyId}\u0000${agenda.entityId}`;
			if (seen.has(key)) {
				throw new Error(`同一次写入里 NPC 议程的实体重复：${agenda.entityId}`);
			}
			seen.add(key);
		}
		const exists = this.#db.prepare(
			"SELECT 1 AS present FROM npc_agendas WHERE story_id = ? AND entity_id = ?",
		);
		const upsert = this.#db.prepare(
			`INSERT INTO npc_agendas
				(story_id, entity_id, goal, every_chapters, importance, progress, last_advanced_node_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, '', NULL, ?, ?)
			ON CONFLICT (story_id, entity_id) DO UPDATE SET
				goal = excluded.goal,
				every_chapters = excluded.every_chapters,
				importance = excluded.importance,
				updated_at = excluded.updated_at`,
		);
		const result: { inserted: number; updated: number } = {
			inserted: 0,
			updated: 0,
		};
		const now = new Date().toISOString();
		this.#db.transaction(() => {
			for (const agenda of normalised) {
				const existing =
					exists.get(agenda.storyId, agenda.entityId) !== undefined;
				upsert.run(
					agenda.storyId,
					agenda.entityId,
					agenda.goal,
					agenda.everyChapters,
					agenda.importance,
					agenda.createdAt,
					now,
				);
				if (existing) {
					result.updated += 1;
				} else {
					result.inserted += 1;
				}
			}
		})();
		return result;
	}

	/** 按首次导入顺序列出故事里的 NPC 议程。 */
	listNpcAgendas(storyId: string): NpcAgenda[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM npc_agendas
				WHERE story_id = ?
				ORDER BY rowid ASC`,
			)
			.all(storyId) as NpcAgendaRow[];
		return rows.map(rowToNpcAgenda);
	}

	/**
	 * 在一个事务里推进多条 NPC 议程：更新进度与推进楼层，并为每条写一条
	 * “与此同时”事件。任一条非法时整批回滚。事件的 ordinal 接在该楼层已有
	 * 事件之后，避免与事件抽取写入的行冲突。
	 */
	advanceNpcAgendas(input: AdvanceNpcAgendasInput): MemoryEvent[] {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.nodeId, "楼层节点 id");
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(`楼层节点属于另一个故事：${input.nodeId}`);
		}
		if (!Array.isArray(input.advances)) {
			throw new Error("NPC 议程推进必须是数组");
		}
		if (input.advances.length === 0) return [];
		const selectAgenda = this.#db.prepare(
			"SELECT * FROM npc_agendas WHERE story_id = ? AND entity_id = ?",
		);
		const seen = new Set<string>();
		const prepared: {
			readonly entityId: string;
			readonly name: string;
			readonly progress: string;
			readonly importance: number;
		}[] = [];
		input.advances.forEach((advance, index) => {
			const label = `NPC 议程推进[${index}]`;
			if (
				advance === null ||
				typeof advance !== "object" ||
				Array.isArray(advance)
			) {
				throw new Error(`${label} 必须是对象`);
			}
			assertNonEmptyString(advance.entityId, `${label} 的 entityId`);
			if (seen.has(advance.entityId)) {
				throw new Error(`${label} 的实体重复：${advance.entityId}`);
			}
			seen.add(advance.entityId);
			if (
				typeof advance.progress !== "string" ||
				advance.progress.trim().length === 0
			) {
				throw new Error(`${label} 的 progress 必须是非空字符串`);
			}
			const row = selectAgenda.get(input.storyId, advance.entityId) as
				| NpcAgendaRow
				| undefined;
			if (row === undefined) {
				throw new Error(`${label} 找不到 NPC 议程：${advance.entityId}`);
			}
			const entity = this.getEntity(advance.entityId);
			if (entity === null) {
				throw new Error(`${label} 对应的实体不存在：${advance.entityId}`);
			}
			prepared.push({
				entityId: advance.entityId,
				name: entity.name,
				progress: advance.progress.trim(),
				importance: row.importance,
			});
		});
		const countRow = this.#db
			.prepare(
				"SELECT COUNT(*) AS count FROM memory_events WHERE source_node_id = ?",
			)
			.get(input.nodeId) as { readonly count: number };
		const ordinalBase = countRow.count;
		const update = this.#db.prepare(
			`UPDATE npc_agendas
			SET progress = ?, last_advanced_node_id = ?, updated_at = ?
			WHERE story_id = ? AND entity_id = ?`,
		);
		const now = new Date().toISOString();
		let created: MemoryEvent[] = [];
		this.#db.transaction(() => {
			for (const item of prepared) {
				const result = update.run(
					item.progress,
					input.nodeId,
					now,
					input.storyId,
					item.entityId,
				);
				if (result.changes !== 1) {
					throw new Error(`NPC 议程更新失败：${item.entityId}`);
				}
			}
			created = this.insertMemoryEvents(
				prepared.map((item, index) => ({
					storyId: input.storyId,
					sourceNodeId: input.nodeId,
					ordinal: ordinalBase + index,
					participants: [item.name],
					knowers: [item.name],
					importance: item.importance,
					text: `与此同时：${item.progress}`,
					source: NPC_AGENDA_EVENT_SOURCE,
				})),
			);
		})();
		return created;
	}

	/**
	 * 写入世界书条目。`(story_id, source)` 唯一：重复导入同一来源时跳过已有行，
	 * 返回值只包含本次真正写入的条目。
	 */
	insertLoreEntries(inputs: readonly NewLoreEntryInput[]): LoreEntry[] {
		if (!Array.isArray(inputs)) {
			throw new Error("世界书条目必须是数组");
		}
		if (inputs.length === 0) return [];
		const normalised = inputs.map((input, index) =>
			this.#normaliseLoreEntry(input, index),
		);
		const insert = this.#db.prepare(
			`INSERT INTO lore_entries
				(id, story_id, entity_id, name, content, constant, keywords, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT DO NOTHING`,
		);
		const created: LoreEntry[] = [];
		this.#db.transaction(() => {
			for (const entry of normalised) {
				const result = insert.run(
					entry.id,
					entry.storyId,
					entry.entityId,
					entry.name,
					entry.content,
					entry.constant ? 1 : 0,
					JSON.stringify(entry.keywords),
					entry.source,
					entry.createdAt,
				);
				if (result.changes === 0) continue;
				created.push({
					id: entry.id,
					storyId: entry.storyId,
					entityId: entry.entityId,
					name: entry.name,
					content: entry.content,
					constant: entry.constant,
					keywords: entry.keywords,
					source: entry.source,
					createdAt: entry.createdAt,
				});
			}
		})();
		return created;
	}

	/** 按导入顺序列出故事里全部世界书条目。 */
	listLoreEntries(storyId: string): LoreEntry[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM lore_entries
				WHERE story_id = ?
				ORDER BY row_id ASC`,
			)
			.all(storyId) as LoreEntryRow[];
		return rows.map(rowToLoreEntry);
	}

	/**
	 * 写入一个楼层的世界书预筛结果；同一楼层覆盖同一行。
	 * 条目 id 必须是非空字符串且不重复，所属故事必须与楼层一致。
	 */
	saveLorePrefilter(input: NewLorePrefilterInput): LorePrefilter {
		assertNonEmptyString(input.nodeId, "世界书预筛的楼层 id");
		assertNonEmptyString(input.storyId, "世界书预筛的 storyId");
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`世界书预筛的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const entryIds = normalisePrefilterEntryIds(input.entryIds);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "世界书预筛的 createdAt");
		this.#db
			.prepare(
				`INSERT INTO lore_prefilter (node_id, story_id, entry_ids, created_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					entry_ids = excluded.entry_ids,
					created_at = excluded.created_at`,
			)
			.run(input.nodeId, input.storyId, JSON.stringify(entryIds), createdAt);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			entryIds,
			createdAt,
		};
	}

	/** 读取一个楼层的预筛结果；没有记录时返回 null。 */
	getLorePrefilter(nodeId: string): LorePrefilter | null {
		assertNonEmptyString(nodeId, "世界书预筛的楼层 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM lore_prefilter WHERE node_id = ?")
			.get(nodeId) as LorePrefilterRow | undefined;
		return row === undefined ? null : rowToLorePrefilter(row);
	}

	/**
	 * 写入玩家楼层的上下文包；同一楼层覆盖同一行。payload 必须是当前版本且
	 * 结构合法，所属故事必须与楼层一致。
	 */
	saveContextPack(input: NewContextPackInput): ContextPack {
		assertNonEmptyString(input.nodeId, "上下文包的楼层 id");
		assertNonEmptyString(input.storyId, "上下文包的 storyId");
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`上下文包的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const payload = serializeContextPackPayload(input.payload);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "上下文包的 createdAt");
		this.#db
			.prepare(
				`INSERT INTO context_packs (node_id, story_id, payload, created_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					payload = excluded.payload,
					created_at = excluded.created_at`,
			)
			.run(input.nodeId, input.storyId, payload, createdAt);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			payload: input.payload,
			createdAt,
		};
	}

	/** 读取玩家楼层的上下文包；没有记录时返回 null。 */
	getContextPack(nodeId: string): ContextPack | null {
		assertNonEmptyString(nodeId, "上下文包的楼层 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT * FROM context_packs WHERE node_id = ?")
			.get(nodeId) as ContextPackRow | undefined;
		return row === undefined ? null : rowToContextPack(row);
	}

	/**
	 * 写入一条摘要。起点必须是终点的祖先，text 去掉首尾空白后必须非空；
	 * token_count 在这里用统一估算器计算。
	 */
	insertSummary(input: NewSummaryInput): Summary {
		const summary = this.#normaliseSummary(input);
		this.#db
			.prepare(
				`INSERT INTO summaries
					(id, story_id, level, start_node_id, end_node_id, text, token_count, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				summary.id,
				summary.storyId,
				summary.level,
				summary.startNodeId,
				summary.endNodeId,
				summary.text,
				summary.tokenCount,
				summary.createdAt,
			);
		return {
			id: summary.id,
			storyId: summary.storyId,
			level: summary.level,
			startNodeId: summary.startNodeId,
			endNodeId: summary.endNodeId,
			text: summary.text,
			tokenCount: summary.tokenCount,
			createdAt: summary.createdAt,
		};
	}

	/** 起止节点都在 head 的路径上、且起点在终点之前的摘要才有效。 */
	isSummaryValid(summary: Summary, headNodeId: string): boolean {
		const head = this.getNode(headNodeId);
		if (!head) {
			throw new Error(`楼层节点不存在：${headNodeId}`);
		}
		if (head.storyId !== summary.storyId) return false;
		const path = this.getPathToNode(headNodeId);
		const startIndex = path.findIndex(
			(node) => node.id === summary.startNodeId,
		);
		if (startIndex === -1) return false;
		const endIndex = path.findIndex((node) => node.id === summary.endNodeId);
		return endIndex !== -1 && startIndex < endIndex;
	}

	/** 只返回在当前 head 路径上仍然有效的摘要；先章节后主线，各自从早到晚。 */
	getValidSummaries(storyId: string, headNodeId: string): Summary[] {
		assertNonEmptyString(storyId, "故事 id");
		const head = this.getNode(headNodeId);
		if (!head) {
			throw new Error(`楼层节点不存在：${headNodeId}`);
		}
		if (head.storyId !== storyId) {
			throw new Error(`楼层节点 ${headNodeId} 属于另一个故事 ${head.storyId}`);
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE path(node_id, position) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.position + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT s.*
				FROM summaries AS s
				JOIN path AS start ON start.node_id = s.start_node_id
				JOIN path AS end ON end.node_id = s.end_node_id
				WHERE s.story_id = ?
					AND start.position > end.position
				ORDER BY (s.level = 'chapter') DESC, end.position DESC`,
			)
			.all(headNodeId, storyId) as SummaryRow[];
		return rows.map(rowToSummary);
	}

	/**
	 * 写入一条八段式压缩。起点必须是终点的祖先，八段必须齐全且都是非空字符串；
	 * token_count 在这里按渲染后的八段正文计算。同一区间重复写入由唯一约束拒绝。
	 */
	insertChapterCompression(
		input: NewChapterCompressionInput,
	): ChapterCompression {
		const compression = this.#normaliseCompression(input);
		this.#db
			.prepare(
				`INSERT INTO chapter_compressions
					(id, story_id, level, start_node_id, end_node_id, sections, token_count, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				compression.id,
				compression.storyId,
				compression.level,
				compression.startNodeId,
				compression.endNodeId,
				JSON.stringify(compression.sections),
				compression.tokenCount,
				compression.createdAt,
			);
		return compression;
	}

	/** 起止节点都在 head 的路径上、且起点在终点之前的压缩才有效。 */
	isCompressionValid(
		compression: ChapterCompression,
		headNodeId: string,
	): boolean {
		const head = this.getNode(headNodeId);
		if (!head) {
			throw new Error(`楼层节点不存在：${headNodeId}`);
		}
		if (head.storyId !== compression.storyId) return false;
		const path = this.getPathToNode(headNodeId);
		const startIndex = path.findIndex(
			(node) => node.id === compression.startNodeId,
		);
		if (startIndex === -1) return false;
		const endIndex = path.findIndex(
			(node) => node.id === compression.endNodeId,
		);
		return endIndex !== -1 && startIndex < endIndex;
	}

	/** 只返回在当前 head 路径上仍然有效的压缩；先章节后主线，各自从早到晚。 */
	getValidCompressions(
		storyId: string,
		headNodeId: string,
	): ChapterCompression[] {
		assertNonEmptyString(storyId, "故事 id");
		const head = this.getNode(headNodeId);
		if (!head) {
			throw new Error(`楼层节点不存在：${headNodeId}`);
		}
		if (head.storyId !== storyId) {
			throw new Error(`楼层节点 ${headNodeId} 属于另一个故事 ${head.storyId}`);
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE path(node_id, position) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, path.position + 1
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT c.*
				FROM chapter_compressions AS c
				JOIN path AS start ON start.node_id = c.start_node_id
				JOIN path AS end ON end.node_id = c.end_node_id
				WHERE c.story_id = ?
					AND start.position > end.position
				ORDER BY (c.level = 'chapter') DESC, end.position DESC`,
			)
			.all(headNodeId, storyId) as ChapterCompressionRow[];
		return rows.map(rowToChapterCompression);
	}

	/** 统计路径上已确认（有子节点）的助手楼层数，包含给定节点自身。 */
	countConfirmedAssistantNodesOnPath(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare(
				`WITH RECURSIVE path(node_id) AS (
					SELECT id FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id
					FROM path JOIN nodes ON nodes.id = path.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT COUNT(*) AS count
				FROM path
				JOIN nodes ON nodes.id = path.node_id
				WHERE nodes.role = 'assistant'
					AND EXISTS (
						SELECT 1 FROM nodes AS child WHERE child.parent_id = nodes.id
					)`,
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 统计某个楼层写入的检索块数。 */
	countChunksForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT COUNT(*) AS count FROM chunks WHERE node_id = ?")
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 统计某个楼层的父段数；旧分块没有父段时返回 0。 */
	countChunkParentsForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare(
				`SELECT COUNT(DISTINCT parent_ordinal) AS count
				FROM chunks
				WHERE node_id = ? AND parent_ordinal IS NOT NULL`,
			)
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 统计某个楼层已经写入的向量数。 */
	countChunkVectorsForNode(nodeId: string): number {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT COUNT(*) AS count FROM chunk_vectors WHERE node_id = ?")
			.get(nodeId) as { readonly count: number };
		return row.count;
	}

	/** 返回某个楼层里还没有向量的块，按序号排序。 */
	listChunksMissingVectors(nodeId: string): ChunkWithoutVector[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT c.id AS chunk_id, c.text
				FROM chunks AS c
				WHERE c.node_id = ?
					AND NOT EXISTS (
						SELECT 1 FROM chunk_vectors AS v WHERE v.chunk_id = c.id
					)
				ORDER BY c.ordinal ASC`,
			)
			.all(nodeId) as ChunkTextRow[];
		return rows.map((row) => ({ chunkId: row.chunk_id, text: row.text }));
	}

	/** 返回某个楼层已写入的块向量，按块序号排序。 */
	listChunkVectorsForNode(nodeId: string): ChunkVectorForNode[] {
		assertNonEmptyString(nodeId, "楼层节点 id");
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT c.id AS chunk_id, c.ordinal, v.embedding
				FROM chunks AS c
				JOIN chunk_vectors AS v ON v.chunk_id = c.id
				WHERE c.node_id = ?
				ORDER BY c.ordinal ASC`,
			)
			.all(nodeId) as NodeChunkVectorRow[];
		return rows.map((row) => ({
			chunkId: row.chunk_id,
			ordinal: row.ordinal,
			vector: decodeEmbedding(
				row.embedding,
				`楼层 ${nodeId} 的块 ${row.chunk_id}`,
			),
		}));
	}

	/**
	 * 在同一个事务里写入块向量。向量维度必须与数据库一致；
	 * 块不存在、向量非法或同一块重复写入都直接抛错。
	 */
	insertChunkVectors(inputs: readonly ChunkVectorInput[]): void {
		if (!Array.isArray(inputs)) {
			throw new Error("块向量必须是数组");
		}
		if (inputs.length === 0) return;
		const seen = new Set<number>();
		const rows = inputs.map((input, index) => {
			const label = `块向量[${index}]`;
			if (input === null || typeof input !== "object" || Array.isArray(input)) {
				throw new Error(`${label} 必须是对象`);
			}
			const { chunkId, embedding } = input;
			if (!Number.isInteger(chunkId) || chunkId < 1) {
				throw new Error(`${label}.chunkId 必须是正整数`);
			}
			if (seen.has(chunkId)) {
				throw new Error(`${label} 重复写入块 ${chunkId}`);
			}
			seen.add(chunkId);
			const chunk = this.#db
				.prepare("SELECT story_id, node_id FROM chunks WHERE id = ?")
				.get(chunkId) as ChunkIdentityRow | undefined;
			if (!chunk) {
				throw new Error(`${label} 引用了不存在的块 ${chunkId}`);
			}
			return {
				chunkId,
				storyId: chunk.story_id,
				nodeId: chunk.node_id,
				embedding: this.#normaliseEmbedding(embedding, `${label}.embedding`),
			};
		});
		const insert = this.#db.prepare(
			`INSERT INTO chunk_vectors (chunk_id, story_id, node_id, embedding)
			VALUES (?, ?, ?, ?)`,
		);
		this.#db.transaction(() => {
			for (const row of rows) {
				insert.run(BigInt(row.chunkId), row.storyId, row.nodeId, row.embedding);
			}
		})();
	}

	/**
	 * 按距离检索块向量。给 beforeNodeId 时只搜索它的祖先路径；
	 * 返回顺序是距离从小到大。
	 */
	searchVectors(
		vector: readonly number[],
		options: SearchVectorsOptions,
	): VectorSearchMatch[] {
		assertNonEmptyString(options.storyId, "故事 id");
		if (!this.getStory(options.storyId)) {
			throw new Error(`故事不存在：${options.storyId}`);
		}
		const query = this.#normaliseEmbedding(vector, "查询向量");
		const limit = options.limit ?? DEFAULTS.searchLimit;
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > DEFAULTS.maxSearchLimit
		) {
			throw new Error(
				`检索条数必须是 1 到 ${DEFAULTS.maxSearchLimit} 之间的整数`,
			);
		}
		const beforeNodeId = options.beforeNodeId ?? null;
		if (beforeNodeId !== null) {
			assertNonEmptyString(beforeNodeId, "楼层节点 id");
			const node = this.getNode(beforeNodeId);
			if (!node) {
				throw new Error(`楼层节点不存在：${beforeNodeId}`);
			}
			if (node.storyId !== options.storyId) {
				throw new Error(
					`楼层节点 ${beforeNodeId} 属于另一个故事 ${node.storyId}`,
				);
			}
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE ancestors(node_id) AS (
					SELECT parent_id FROM nodes WHERE id = @beforeNodeId
					UNION ALL
					SELECT nodes.parent_id
					FROM nodes JOIN ancestors ON nodes.id = ancestors.node_id
					WHERE nodes.parent_id IS NOT NULL
				),
				candidates AS (
					SELECT chunk_id, story_id, node_id, distance
					FROM chunk_vectors
					WHERE embedding MATCH @vector AND k = @limit
						AND story_id = @storyId
						AND (@beforeNodeId IS NULL
							OR node_id IN (SELECT node_id FROM ancestors))
					ORDER BY distance ASC
				)
				SELECT candidates.chunk_id, candidates.story_id, candidates.node_id,
					candidates.distance, chunks.parent_ordinal, chunks.parent_text
				FROM candidates
				JOIN chunks ON chunks.id = candidates.chunk_id
				ORDER BY candidates.distance ASC`,
			)
			.all({
				vector: query,
				limit,
				storyId: options.storyId,
				beforeNodeId,
			}) as ChunkVectorRow[];
		return rows.map((row) => ({
			storyId: row.story_id,
			nodeId: row.node_id,
			chunkId: row.chunk_id,
			parentOrdinal: row.parent_ordinal,
			parentText: row.parent_text,
			distance: row.distance,
		}));
	}

	/**
	 * 在块索引里检索。给 beforeNodeId 时只搜索它的祖先路径，结果是同一楼层
	 * 多个块里分数最好的那一块，因此每个楼层只占一个位次。
	 */
	searchChunks(
		query: string,
		options: SearchChunksOptions,
	): ChunkSearchMatch[] {
		if (typeof query !== "string") {
			throw new Error("检索语句必须是字符串");
		}
		assertNonEmptyString(options.storyId, "故事 id");
		if (!this.getStory(options.storyId)) {
			throw new Error(`故事不存在：${options.storyId}`);
		}
		const ftsQuery = buildTrigramQuery(query);
		if (ftsQuery === null) return [];
		const limit = options.limit ?? DEFAULTS.searchLimit;
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > DEFAULTS.maxSearchLimit
		) {
			throw new Error(
				`检索条数必须是 1 到 ${DEFAULTS.maxSearchLimit} 之间的整数`,
			);
		}
		const beforeNodeId = options.beforeNodeId ?? null;
		if (beforeNodeId !== null) {
			assertNonEmptyString(beforeNodeId, "楼层节点 id");
			const node = this.getNode(beforeNodeId);
			if (!node) {
				throw new Error(`楼层节点不存在：${beforeNodeId}`);
			}
			if (node.storyId !== options.storyId) {
				throw new Error(
					`楼层节点 ${beforeNodeId} 属于另一个故事 ${node.storyId}`,
				);
			}
		}
		const rows = this.#db
			.prepare(
				`WITH RECURSIVE ancestors(node_id) AS (
					SELECT parent_id FROM nodes WHERE id = @beforeNodeId
					UNION ALL
					SELECT nodes.parent_id
					FROM nodes JOIN ancestors ON nodes.id = ancestors.node_id
					WHERE nodes.parent_id IS NOT NULL
				),
				matches AS (
					SELECT c.id AS chunk_id, c.node_id, c.story_id,
						c.parent_ordinal, c.parent_text,
						bm25(chunks_fts) AS score
					FROM chunks_fts
					JOIN chunks AS c ON c.id = chunks_fts.rowid
					WHERE chunks_fts MATCH @query
						AND c.story_id = @storyId
						AND (@beforeNodeId IS NULL
							OR c.node_id IN (SELECT node_id FROM ancestors))
				),
				ranked AS (
					SELECT chunk_id, node_id, story_id, parent_ordinal, parent_text,
						score,
						ROW_NUMBER() OVER (
							PARTITION BY node_id,
								CASE WHEN parent_ordinal IS NULL THEN 0 ELSE parent_ordinal END
							ORDER BY score ASC, chunk_id ASC
						) AS position
					FROM matches
				)
				SELECT chunk_id, node_id, story_id, parent_ordinal, parent_text, score
				FROM ranked
				WHERE position = 1
				ORDER BY score ASC, chunk_id ASC
				LIMIT @limit`,
			)
			.all({
				query: ftsQuery,
				storyId: options.storyId,
				beforeNodeId,
				limit,
			}) as ChunkRow[];
		return rows.map((row) => ({
			storyId: row.story_id,
			nodeId: row.node_id,
			chunkId: row.chunk_id,
			parentOrdinal: row.parent_ordinal,
			parentText: row.parent_text,
			score: row.score,
		}));
	}

	searchNodeText(
		query: string,
		options: SearchNodeTextOptions = {},
	): NodeTextMatch[] {
		if (typeof query !== "string") {
			throw new Error("检索语句必须是字符串");
		}
		const trimmed = query.trim();
		const length = [...trimmed].length;
		if (length < DEFAULTS.minQueryLength) {
			throw new Error(
				`全文检索至少需要 ${DEFAULTS.minQueryLength} 个字符（trigram 分词）`,
			);
		}
		if (trimmed.includes("\u0000")) {
			throw new Error("全文检索语句不能包含空字符");
		}
		const limit = options.limit ?? DEFAULTS.searchLimit;
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > DEFAULTS.maxSearchLimit
		) {
			throw new Error(
				`检索条数必须是 1 到 ${DEFAULTS.maxSearchLimit} 之间的整数`,
			);
		}
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "故事 id");
		}
		const phrase = `"${trimmed.replaceAll('"', '""')}"`;
		const rows = this.#db
			.prepare(
				`SELECT node_id, story_id,
					bm25(node_text) AS score,
					snippet(node_text, 2, '[', ']', '…', 12) AS snippet
				FROM node_text
				WHERE node_text MATCH @query
					AND (@storyId IS NULL OR story_id = @storyId)
				ORDER BY score ASC, rowid ASC
				LIMIT @limit`,
			)
			.all({
				query: phrase,
				storyId: options.storyId ?? null,
				limit,
			}) as NodeTextRow[];
		return rows.map((row) => ({
			nodeId: row.node_id,
			storyId: row.story_id,
			score: row.score,
			snippet: row.snippet,
		}));
	}

	/** 保存一轮生成的 Trace；一个楼层只能写一次。 */
	saveTurnTrace(trace: TurnTrace): void {
		assertNonEmptyString(trace.nodeId, "Trace 的 nodeId");
		assertNonEmptyString(trace.storyId, "Trace 的 storyId");
		assertNonEmptyString(trace.createdAt, "Trace 的 createdAt");
		const node = this.getNode(trace.nodeId);
		if (!node) {
			throw new Error(`Trace 指向的楼层节点不存在：${trace.nodeId}`);
		}
		if (node.storyId !== trace.storyId) {
			throw new Error(
				`Trace 的 storyId 与楼层节点所属故事不一致：${trace.storyId}`,
			);
		}
		if (node.parentId !== trace.parentNodeId) {
			throw new Error(
				`Trace 的 parentNodeId 与楼层节点的父节点不一致：${trace.nodeId}`,
			);
		}
		const existing = this.#db
			.prepare("SELECT node_id FROM traces WHERE node_id = ?")
			.get(trace.nodeId) as { node_id: string } | undefined;
		if (existing) {
			throw new Error(`楼层 ${trace.nodeId} 已经写过 Trace`);
		}
		this.#db
			.prepare(
				`INSERT INTO traces (node_id, story_id, trace, created_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(trace.nodeId, trace.storyId, JSON.stringify(trace), trace.createdAt);
	}

	getTurnTrace(nodeId: string): TurnTrace | null {
		if (!this.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.#db
			.prepare("SELECT node_id, story_id, trace FROM traces WHERE node_id = ?")
			.get(nodeId) as TraceRow | undefined;
		if (row === undefined) return null;
		const parsed: unknown = JSON.parse(row.trace);
		if (
			!isJsonObject(parsed) ||
			parsed.nodeId !== row.node_id ||
			parsed.storyId !== row.story_id
		) {
			throw new Error(`楼层 ${nodeId} 的 Trace 记录与楼层不一致`);
		}
		const trace = parsed as unknown as TurnTrace;
		// v40 之前的 Trace 没有 run 段，读回时补成 null。
		return { ...trace, run: trace.run ?? null };
	}

	/** 为一次深回合运行建行；用户楼层必须存在且属于该故事。 */
	startTurnRun(input: {
		readonly runId?: string;
		readonly storyId: string;
		readonly userNodeId: string;
		readonly mode: TurnMode;
		readonly startedAt?: string;
	}): TurnRunRecord {
		assertNonEmptyString(input.storyId, "故事 id");
		assertNonEmptyString(input.userNodeId, "用户楼层 id");
		if (!isTurnMode(input.mode)) {
			throw new Error(`回合模式不合法：${String(input.mode)}`);
		}
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const userNode = this.getNode(input.userNodeId);
		if (!userNode) {
			throw new Error(`用户楼层不存在：${input.userNodeId}`);
		}
		if (userNode.storyId !== input.storyId) {
			throw new Error(
				`用户楼层 ${userNode.id} 属于另一个故事 ${userNode.storyId}`,
			);
		}
		if (userNode.role !== "user") {
			throw new Error(
				`运行必须以用户楼层为输入：${userNode.id} 的角色是 ${userNode.role}`,
			);
		}
		const runId = input.runId ?? randomUUID();
		assertNonEmptyString(runId, "运行 id");
		const startedAt = input.startedAt ?? new Date().toISOString();
		assertNonEmptyString(startedAt, "运行开始时间");
		if (this.getTurnRun(runId) !== null) {
			throw new Error(`运行已存在：${runId}`);
		}
		this.#db
			.prepare(
				`INSERT INTO turn_runs
				(run_id, story_id, user_node_id, node_id, mode, status, started_at)
				VALUES (?, ?, ?, NULL, ?, 'running', ?)`,
			)
			.run(runId, input.storyId, input.userNodeId, input.mode, startedAt);
		const run = this.getTurnRun(runId);
		if (run === null) {
			throw new Error(`运行写入后读取失败：${runId}`);
		}
		return run;
	}

	getTurnRun(runId: string): TurnRunRecord | null {
		assertNonEmptyString(runId, "运行 id");
		const row = this.#db
			.prepare(
				`SELECT run_id, story_id, user_node_id, node_id, mode, status,
					started_at, finished_at
				FROM turn_runs WHERE run_id = ?`,
			)
			.get(runId) as TurnRunRow | undefined;
		return row === undefined ? null : toTurnRunRecord(row);
	}

	/** 按助手楼层找运行；快回合与非生成楼层返回 null。 */
	getTurnRunForNode(nodeId: string): TurnRunRecord | null {
		assertNonEmptyString(nodeId, "楼层 id");
		const row = this.#db
			.prepare(
				`SELECT run_id, story_id, user_node_id, node_id, mode, status,
					started_at, finished_at
				FROM turn_runs WHERE node_id = ?`,
			)
			.get(nodeId) as TurnRunRow | undefined;
		return row === undefined ? null : toTurnRunRecord(row);
	}

	/** 一个故事的运行记录，最新的在前。 */
	listTurnRuns(storyId: string): TurnRunRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT run_id, story_id, user_node_id, node_id, mode, status,
					started_at, finished_at
				FROM turn_runs WHERE story_id = ?
				ORDER BY started_at DESC, run_id DESC`,
			)
			.all(storyId) as TurnRunRow[];
		return rows.map(toTurnRunRecord);
	}

	/** 追加一条事件；序号由存储层按运行内最大值加一。 */
	appendTurnRunEvent(input: {
		readonly runId: string;
		readonly kind: TurnRunEventInput["kind"];
		readonly payload: TurnRunEventInput["payload"];
		readonly createdAt?: string;
	}): TurnRunEvent {
		assertNonEmptyString(input.runId, "运行 id");
		assertTurnRunEventKind(input.kind, "运行事件种类");
		if (!isJsonObject(input.payload)) {
			throw new Error("运行事件载荷必须是 JSON 对象");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "运行事件时间");
		const run = this.getTurnRun(input.runId);
		if (run === null) {
			throw new Error(`运行不存在：${input.runId}`);
		}
		if (run.status !== "running") {
			throw new Error(
				`运行 ${input.runId} 的状态是 ${run.status}，不能再追加事件`,
			);
		}
		this.#db
			.prepare(
				`INSERT INTO turn_run_events (run_id, seq, kind, payload, created_at)
				SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?
				FROM turn_run_events WHERE run_id = ?`,
			)
			.run(
				input.runId,
				input.kind,
				JSON.stringify(input.payload),
				createdAt,
				input.runId,
			);
		const row = this.#db
			.prepare(
				`SELECT run_id, seq, kind, payload, created_at
				FROM turn_run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 1`,
			)
			.get(input.runId) as TurnRunEventRow | undefined;
		if (row === undefined) {
			throw new Error(`运行事件写入后读取失败：${input.runId}`);
		}
		return toTurnRunEvent(row);
	}

	listTurnRunEvents(runId: string): TurnRunEvent[] {
		assertNonEmptyString(runId, "运行 id");
		if (this.getTurnRun(runId) === null) {
			throw new Error(`运行不存在：${runId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT run_id, seq, kind, payload, created_at
				FROM turn_run_events WHERE run_id = ? ORDER BY seq ASC`,
			)
			.all(runId) as TurnRunEventRow[];
		return rows.map(toTurnRunEvent);
	}

	countTurnRunEvents(runId: string): number {
		assertNonEmptyString(runId, "运行 id");
		const row = this.#db
			.prepare("SELECT COUNT(*) AS count FROM turn_run_events WHERE run_id = ?")
			.get(runId) as { readonly count: number };
		return row.count;
	}

	/** 结束一次运行；助手楼层只在提交后写进来。 */
	finishTurnRun(input: {
		readonly runId: string;
		readonly status: TurnRunFinalStatus;
		readonly nodeId?: string | null;
		readonly finishedAt?: string;
	}): TurnRunRecord {
		assertNonEmptyString(input.runId, "运行 id");
		if (!isTurnRunFinalStatus(input.status)) {
			throw new Error(`运行结束状态不合法：${String(input.status)}`);
		}
		const run = this.getTurnRun(input.runId);
		if (run === null) {
			throw new Error(`运行不存在：${input.runId}`);
		}
		if (run.status !== "running") {
			throw new Error(
				`运行 ${input.runId} 的状态是 ${run.status}，不能重复结束`,
			);
		}
		const nodeId = input.nodeId ?? null;
		if (nodeId !== null) {
			assertNonEmptyString(nodeId, "助手楼层 id");
			const node = this.getNode(nodeId);
			if (!node) {
				throw new Error(`助手楼层不存在：${nodeId}`);
			}
			if (node.storyId !== run.storyId) {
				throw new Error(`助手楼层 ${nodeId} 属于另一个故事 ${node.storyId}`);
			}
			if (node.role !== "assistant") {
				throw new Error(
					`运行只能提交助手楼层：${nodeId} 的角色是 ${node.role}`,
				);
			}
		}
		const finishedAt = input.finishedAt ?? new Date().toISOString();
		assertNonEmptyString(finishedAt, "运行结束时间");
		const info = this.#db
			.prepare(
				`UPDATE turn_runs SET status = ?, node_id = COALESCE(?, node_id),
					finished_at = ?
				WHERE run_id = ? AND status = 'running'`,
			)
			.run(input.status, nodeId, finishedAt, input.runId);
		if (info.changes !== 1) {
			throw new Error(`运行 ${input.runId} 已经结束`);
		}
		const finished = this.getTurnRun(input.runId);
		if (finished === null) {
			throw new Error(`运行结束后读取失败：${input.runId}`);
		}
		return finished;
	}

	/** 启动时把上一个进程留下的 running 行标为 interrupted；事件原样保留。 */
	markInterruptedTurnRuns(finishedAt?: string): number {
		const value = finishedAt ?? new Date().toISOString();
		assertNonEmptyString(value, "运行结束时间");
		const info = this.#db
			.prepare(
				`UPDATE turn_runs SET status = 'interrupted', finished_at = ?
				WHERE status = 'running'`,
			)
			.run(value);
		return info.changes;
	}

	createAssistantConversation(
		input: NewAssistantConversationInput,
	): AssistantConversation {
		if (typeof input.skill !== "string" || input.skill.trim().length === 0) {
			throw new Error("助手技能必须是非空字符串");
		}
		const skill = input.skill.trim();
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "助手会话 id");
		if (this.getAssistantConversation(id) !== null) {
			throw new Error(`助手会话已存在：${id}`);
		}
		const storyId = input.storyId ?? null;
		if (storyId !== null) {
			assertNonEmptyString(storyId, "助手会话的故事 id");
			if (!this.getStory(storyId)) {
				throw new Error(`故事不存在：${storyId}`);
			}
		}
		const title = (input.title ?? DEFAULT_ASSISTANT_TITLE).trim();
		if (title.length === 0) {
			throw new Error("助手会话标题不能为空");
		}
		const permission = input.permission ?? DEFAULT_ASSISTANT_PERMISSION;
		assertAssistantPermission(permission, "助手会话权限");
		const thinking = input.thinking ?? DEFAULT_ASSISTANT_THINKING;
		assertAssistantThinking(thinking, "助手会话思考强度");
		const contextBudget =
			input.contextBudget ?? DEFAULT_ASSISTANT_CONTEXT_BUDGET;
		assertAssistantContextBudget(contextBudget, "助手会话上下文预算");
		const compactionThreshold =
			input.compactionThreshold ?? DEFAULT_ASSISTANT_COMPACTION_THRESHOLD;
		assertAssistantCompactionThreshold(compactionThreshold, "助手会话压缩阈值");
		const modelAlias = input.modelAlias ?? null;
		if (modelAlias !== null) {
			assertNonEmptyString(modelAlias, "助手会话模型别名");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手会话创建时间");
		this.#db
			.prepare(
				`INSERT INTO assistant_conversations
				(id, story_id, skill, title, permission, status, model_alias,
					thinking, context_budget, compaction_threshold, created_at,
					updated_at, last_message_at)
				VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, NULL)`,
			)
			.run(
				id,
				storyId,
				skill,
				title,
				permission,
				modelAlias,
				thinking,
				contextBudget,
				compactionThreshold,
				createdAt,
				createdAt,
			);
		const conversation = this.getAssistantConversation(id);
		if (conversation === null) {
			throw new Error(`助手会话写入后读取失败：${id}`);
		}
		return conversation;
	}

	getAssistantConversation(id: string): AssistantConversation | null {
		assertNonEmptyString(id, "助手会话 id");
		const row = this.#db
			.prepare("SELECT * FROM assistant_conversations WHERE id = ?")
			.get(id) as AssistantConversationRow | undefined;
		return row === undefined ? null : rowToAssistantConversation(row);
	}

	/** 按最近活动列出会话；可以按故事与技能过滤。 */
	listAssistantConversations(
		options: ListAssistantConversationsOptions = {},
	): AssistantConversation[] {
		const limit = options.limit ?? DEFAULT_ASSISTANT_LIST_LIMIT;
		assertAssistantListLimit(limit, "助手会话条数");
		const storyId = options.storyId ?? null;
		if (storyId !== null) {
			assertNonEmptyString(storyId, "助手会话的故事 id");
			if (!this.getStory(storyId)) {
				throw new Error(`故事不存在：${storyId}`);
			}
		}
		const skill = options.skill ?? null;
		if (skill !== null) assertNonEmptyString(skill, "助手技能");
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		if (storyId !== null) {
			conditions.push("story_id = ?");
			params.push(storyId);
		}
		if (skill !== null) {
			conditions.push("skill = ?");
			params.push(skill);
		}
		const where =
			conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
		params.push(limit);
		const rows = this.#db
			.prepare(
				`SELECT * FROM assistant_conversations
				${where}
				ORDER BY COALESCE(last_message_at, updated_at) DESC,
					created_at DESC, id ASC
				LIMIT ?`,
			)
			.all(...params) as AssistantConversationRow[];
		return rows.map(rowToAssistantConversation);
	}

	/**
	 * 按标题与消息正文搜索。标题走 LIKE，两字中文也能命中；正文优先用
	 * trigram 索引，查询短于三个字符时退回到 LIKE。
	 */
	searchAssistantConversations(
		query: string,
		options: AssistantConversationSearchOptions = {},
	): AssistantSearchHit[] {
		if (typeof query !== "string") {
			throw new Error("检索语句必须是字符串");
		}
		const trimmed = query.trim();
		if (trimmed.length === 0) {
			throw new Error("检索语句不能为空");
		}
		if (trimmed.includes("\u0000")) {
			throw new Error("检索语句不能包含空字符");
		}
		const limit = options.limit ?? DEFAULT_ASSISTANT_LIST_LIMIT;
		assertAssistantListLimit(limit, "检索条数");
		const storyId = options.storyId ?? null;
		if (storyId !== null) {
			assertNonEmptyString(storyId, "助手会话的故事 id");
			if (!this.getStory(storyId)) {
				throw new Error(`故事不存在：${storyId}`);
			}
		}
		const likePattern = `%${trimmed
			.replaceAll("\\", "\\\\")
			.replaceAll("%", "\\%")
			.replaceAll("_", "\\_")}%`;
		const titleRows = this.#db
			.prepare(
				`SELECT * FROM assistant_conversations
				WHERE title LIKE @pattern ESCAPE '\\'
					AND (@storyId IS NULL OR story_id = @storyId)
				ORDER BY COALESCE(last_message_at, updated_at) DESC,
					created_at DESC, id ASC
				LIMIT @limit`,
			)
			.all({
				pattern: likePattern,
				storyId,
				limit,
			}) as AssistantConversationRow[];
		const titleIds = new Set(titleRows.map((row) => row.id));

		const messageHits: {
			conversationId: string;
			ordinal: number;
			snippet: string;
			score: number;
		}[] = [];
		const ftsQuery = buildTrigramQuery(trimmed);
		if (ftsQuery !== null) {
			const rows = this.#db
				.prepare(
					`WITH matches AS (
						SELECT m.conversation_id AS conversation_id,
							m.ordinal AS ordinal,
							snippet(assistant_message_text, 2, '[', ']', '…', 12) AS snippet,
							bm25(assistant_message_text) AS score
						FROM assistant_message_text
						JOIN assistant_messages AS m
							ON m.rowid = assistant_message_text.rowid
						WHERE assistant_message_text MATCH @query
							AND (@storyId IS NULL OR m.conversation_id IN (
								SELECT id FROM assistant_conversations
								WHERE story_id = @storyId
							))
					),
					ranked AS (
						SELECT conversation_id, ordinal, snippet, score,
							ROW_NUMBER() OVER (
								PARTITION BY conversation_id
								ORDER BY score ASC, ordinal ASC
							) AS position
						FROM matches
					)
					SELECT conversation_id, ordinal, snippet, score
					FROM ranked WHERE position = 1
					ORDER BY score ASC, ordinal ASC, conversation_id ASC
					LIMIT @limit`,
				)
				.all({
					query: ftsQuery,
					storyId,
					limit,
				}) as AssistantMessageSearchRow[];
			for (const row of rows) {
				messageHits.push({
					conversationId: row.conversation_id,
					ordinal: row.ordinal,
					snippet: row.snippet,
					score: row.score,
				});
			}
		} else {
			const rows = this.#db
				.prepare(
					`WITH matches AS (
						SELECT conversation_id, ordinal, text,
							ROW_NUMBER() OVER (
								PARTITION BY conversation_id ORDER BY ordinal ASC
							) AS position
						FROM assistant_messages
						WHERE text LIKE @pattern ESCAPE '\\'
							AND (@storyId IS NULL OR conversation_id IN (
								SELECT id FROM assistant_conversations
								WHERE story_id = @storyId
							))
					)
					SELECT conversation_id, ordinal, text
					FROM matches WHERE position = 1
					ORDER BY ordinal ASC, conversation_id ASC
					LIMIT @limit`,
				)
				.all({
					pattern: likePattern,
					storyId,
					limit,
				}) as AssistantMessageLikeRow[];
			for (const row of rows) {
				messageHits.push({
					conversationId: row.conversation_id,
					ordinal: row.ordinal,
					snippet: createAssistantSnippet(row.text, trimmed),
					score: 0,
				});
			}
		}

		const results: AssistantSearchHit[] = [];
		const used = new Set<string>();
		for (const hit of messageHits) {
			if (results.length >= limit) break;
			const conversation = this.getAssistantConversation(hit.conversationId);
			if (conversation === null) {
				throw new Error(`助手会话不存在：${hit.conversationId}`);
			}
			used.add(hit.conversationId);
			results.push({
				conversation,
				matchedIn: "message",
				snippet: hit.snippet,
				messageOrdinal: hit.ordinal,
				score: hit.score,
			});
		}
		for (const row of titleRows) {
			if (results.length >= limit) break;
			if (used.has(row.id)) continue;
			results.push({
				conversation: rowToAssistantConversation(row),
				matchedIn: "title",
				snippet: createAssistantSnippet(row.title, trimmed),
				messageOrdinal: null,
				score: 0,
			});
		}
		return results;
	}

	getAssistantMessages(conversationId: string): AssistantMessage[] {
		assertNonEmptyString(conversationId, "助手会话 id");
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT conversation_id, ordinal, role, text, tool_name,
					tool_result, usage, created_at
				FROM assistant_messages
				WHERE conversation_id = ?
				ORDER BY ordinal ASC`,
			)
			.all(conversationId) as AssistantMessageRow[];
		return rows.map(rowToAssistantMessage);
	}

	/** 写入一次压缩记录；序号在同一事务里取最大值加一，并更新会话时间。 */
	createAssistantCompaction(
		input: NewAssistantCompactionInput,
	): AssistantCompaction {
		assertNonEmptyString(input.conversationId, "助手会话 id");
		if (
			typeof input.summary !== "string" ||
			input.summary.trim().length === 0
		) {
			throw new Error("助手压缩摘要不能为空");
		}
		assertAssistantMessageOrdinals(
			input.omittedMessageIds,
			"助手压缩的省略消息序号",
		);
		if (
			!Number.isInteger(input.beforeTokens) ||
			input.beforeTokens < 0 ||
			!Number.isInteger(input.afterTokens) ||
			input.afterTokens < 0
		) {
			throw new Error("助手压缩前后的 token 必须是非负整数");
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "助手压缩记录 id");
		if (this.getAssistantConversation(input.conversationId) === null) {
			throw new Error(`助手会话不存在：${input.conversationId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手压缩记录时间");
		return this.#db.transaction((): AssistantCompaction => {
			this.#db
				.prepare(
					`INSERT INTO assistant_compactions
					(id, conversation_id, seq, summary, omitted_message_ids,
						before_tokens, after_tokens, created_at)
					SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?
					FROM assistant_compactions WHERE conversation_id = ?`,
				)
				.run(
					id,
					input.conversationId,
					input.summary,
					JSON.stringify(input.omittedMessageIds),
					input.beforeTokens,
					input.afterTokens,
					createdAt,
					input.conversationId,
				);
			this.#db
				.prepare(
					"UPDATE assistant_conversations SET updated_at = ? WHERE id = ?",
				)
				.run(createdAt, input.conversationId);
			const row = this.#db
				.prepare(
					`SELECT id, conversation_id, seq, summary, omitted_message_ids,
						before_tokens, after_tokens, created_at
					FROM assistant_compactions
					WHERE conversation_id = ?
					ORDER BY seq DESC LIMIT 1`,
				)
				.get(input.conversationId) as AssistantCompactionRow | undefined;
			if (row === undefined) {
				throw new Error(`助手压缩记录写入后读取失败：${input.conversationId}`);
			}
			return rowToAssistantCompaction(row);
		})();
	}

	/** 最新一次压缩；没有压缩过时返回 null。后续请求按它过滤消息。 */
	getAssistantCompaction(conversationId: string): AssistantCompaction | null {
		assertNonEmptyString(conversationId, "助手会话 id");
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const row = this.#db
			.prepare(
				`SELECT id, conversation_id, seq, summary, omitted_message_ids,
					before_tokens, after_tokens, created_at
				FROM assistant_compactions
				WHERE conversation_id = ?
				ORDER BY seq DESC LIMIT 1`,
			)
			.get(conversationId) as AssistantCompactionRow | undefined;
		return row === undefined ? null : rowToAssistantCompaction(row);
	}

	listAssistantCompactions(conversationId: string): AssistantCompaction[] {
		assertNonEmptyString(conversationId, "助手会话 id");
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT id, conversation_id, seq, summary, omitted_message_ids,
					before_tokens, after_tokens, created_at
				FROM assistant_compactions
				WHERE conversation_id = ?
				ORDER BY seq ASC`,
			)
			.all(conversationId) as AssistantCompactionRow[];
		return rows.map(rowToAssistantCompaction);
	}
	/** 追加一条消息；序号在同一事务里取最大值加一，并更新会话的最后消息时间。 */
	appendAssistantMessage(input: NewAssistantMessageInput): AssistantMessage {
		assertNonEmptyString(input.conversationId, "助手会话 id");
		assertAssistantMessageRole(input.role, "助手消息角色");
		if (typeof input.text !== "string") {
			throw new Error("助手消息正文必须是字符串");
		}
		if (input.role !== "tool" && input.text.trim().length === 0) {
			throw new Error("助手消息正文不能为空");
		}
		const toolName = input.toolName ?? null;
		const toolResult = input.toolResult;
		if (input.role === "tool") {
			if (toolName === null) {
				throw new Error("工具消息必须提供工具名");
			}
			assertNonEmptyString(toolName, "工具名");
		} else if (toolName !== null || toolResult !== undefined) {
			throw new Error("只有工具消息可以携带工具名与工具结果");
		}
		const usage = input.usage;
		if (input.role !== "assistant" && usage !== undefined) {
			throw new Error("只有助手消息可以携带用量");
		}
		const toolResultJson =
			toolResult === undefined
				? null
				: serializeJsonValue(toolResult, "助手消息的工具结果");
		const usageJson =
			usage === undefined ? null : serializeJsonValue(usage, "助手消息的用量");
		if (this.getAssistantConversation(input.conversationId) === null) {
			throw new Error(`助手会话不存在：${input.conversationId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手消息时间");
		return this.#db.transaction((): AssistantMessage => {
			this.#db
				.prepare(
					`INSERT INTO assistant_messages
					(conversation_id, ordinal, role, text, tool_name, tool_result,
						usage, created_at)
					SELECT ?, COALESCE(MAX(ordinal), 0) + 1, ?, ?, ?, ?, ?, ?
					FROM assistant_messages WHERE conversation_id = ?`,
				)
				.run(
					input.conversationId,
					input.role,
					input.text,
					toolName,
					toolResultJson,
					usageJson,
					createdAt,
					input.conversationId,
				);
			this.#db
				.prepare(
					`UPDATE assistant_conversations
					SET updated_at = ?, last_message_at = ?
					WHERE id = ?`,
				)
				.run(createdAt, createdAt, input.conversationId);
			const row = this.#db
				.prepare(
					`SELECT conversation_id, ordinal, role, text, tool_name,
						tool_result, usage, created_at
					FROM assistant_messages
					WHERE conversation_id = ?
					ORDER BY ordinal DESC LIMIT 1`,
				)
				.get(input.conversationId) as AssistantMessageRow | undefined;
			if (row === undefined) {
				throw new Error(`助手消息写入后读取失败：${input.conversationId}`);
			}
			return rowToAssistantMessage(row);
		})();
	}

	updateAssistantConversation(
		id: string,
		update: AssistantConversationUpdate,
	): AssistantConversation {
		assertNonEmptyString(id, "助手会话 id");
		if (this.getAssistantConversation(id) === null) {
			throw new Error(`助手会话不存在：${id}`);
		}
		const sets: string[] = [];
		const params: (string | number | null)[] = [];
		if (update.title !== undefined) {
			const title = update.title.trim();
			if (title.length === 0) {
				throw new Error("助手会话标题不能为空");
			}
			sets.push("title = ?");
			params.push(title);
		}
		if (update.skill !== undefined) {
			if (
				typeof update.skill !== "string" ||
				update.skill.trim().length === 0
			) {
				throw new Error("助手技能必须是非空字符串");
			}
			sets.push("skill = ?");
			params.push(update.skill.trim());
		}
		if (update.permission !== undefined) {
			assertAssistantPermission(update.permission, "助手会话权限");
			sets.push("permission = ?");
			params.push(update.permission);
		}
		if (update.modelAlias !== undefined) {
			if (update.modelAlias !== null) {
				assertNonEmptyString(update.modelAlias, "助手会话模型别名");
			}
			sets.push("model_alias = ?");
			params.push(update.modelAlias);
		}
		if (update.thinking !== undefined) {
			assertAssistantThinking(update.thinking, "助手会话思考强度");
			sets.push("thinking = ?");
			params.push(update.thinking);
		}
		if (update.contextBudget !== undefined) {
			assertAssistantContextBudget(update.contextBudget, "助手会话上下文预算");
			sets.push("context_budget = ?");
			params.push(update.contextBudget);
		}
		if (update.compactionThreshold !== undefined) {
			assertAssistantCompactionThreshold(
				update.compactionThreshold,
				"助手会话压缩阈值",
			);
			sets.push("compaction_threshold = ?");
			params.push(update.compactionThreshold);
		}
		if (sets.length === 0) {
			throw new Error("助手会话更新至少需要一个字段");
		}
		sets.push("updated_at = ?");
		params.push(new Date().toISOString());
		params.push(id);
		this.#db
			.prepare(
				`UPDATE assistant_conversations SET ${sets.join(", ")} WHERE id = ?`,
			)
			.run(...params);
		const conversation = this.getAssistantConversation(id);
		if (conversation === null) {
			throw new Error(`助手会话更新后读取失败：${id}`);
		}
		return conversation;
	}

	setAssistantConversationStatus(
		id: string,
		status: AssistantConversationStatus,
	): AssistantConversation {
		assertNonEmptyString(id, "助手会话 id");
		assertAssistantConversationStatus(status, "助手会话状态");
		if (this.getAssistantConversation(id) === null) {
			throw new Error(`助手会话不存在：${id}`);
		}
		this.#db
			.prepare(
				"UPDATE assistant_conversations SET status = ?, updated_at = ? WHERE id = ?",
			)
			.run(status, new Date().toISOString(), id);
		const conversation = this.getAssistantConversation(id);
		if (conversation === null) {
			throw new Error(`助手会话状态更新后读取失败：${id}`);
		}
		return conversation;
	}

	/**
	 * 开始一次运行：在同一事务里检查会话没有在跑、把状态改成 running，
	 * 并写入 started 事件。并发启动的第二个请求抛 `AssistantRunConflictError`。
	 */
	startAssistantConversationRun(
		id: string,
		payload: JsonObject,
	): AssistantEvent {
		assertNonEmptyString(id, "助手会话 id");
		if (!isJsonObject(payload)) {
			throw new Error("助手 started 事件的载荷必须是 JSON 对象");
		}
		const createdAt = new Date().toISOString();
		return this.#db.transaction((): AssistantEvent => {
			const conversation = this.getAssistantConversation(id);
			if (conversation === null) {
				throw new Error(`助手会话不存在：${id}`);
			}
			if (conversation.status === "running") {
				throw new AssistantRunConflictError(id);
			}
			this.#db
				.prepare(
					"UPDATE assistant_conversations SET status = 'running', updated_at = ? WHERE id = ?",
				)
				.run(createdAt, id);
			this.#db
				.prepare(
					`INSERT INTO assistant_events
					(conversation_id, seq, kind, payload, created_at)
					SELECT ?, COALESCE(MAX(seq), 0) + 1, 'started', ?, ?
					FROM assistant_events WHERE conversation_id = ?`,
				)
				.run(id, JSON.stringify(payload), createdAt, id);
			const row = this.#db
				.prepare(
					`SELECT conversation_id, seq, kind, payload, created_at
					FROM assistant_events WHERE conversation_id = ?
					ORDER BY seq DESC LIMIT 1`,
				)
				.get(id) as AssistantEventRow | undefined;
			if (row === undefined) {
				throw new Error(`助手事件写入后读取失败：${id}`);
			}
			return rowToAssistantEvent(row);
		})();
	}

	/**
	 * 结束一次运行：在同一事务里切换会话状态并写入最终事件。
	 * 只有 completed、failed、cancelled、interrupted 四种结束状态。
	 */
	finishAssistantConversationRun(
		id: string,
		status: "completed" | "failed" | "cancelled" | "interrupted",
		kind: "completed" | "error",
		payload: JsonObject,
	): AssistantEvent {
		assertNonEmptyString(id, "助手会话 id");
		assertAssistantConversationStatus(status, "助手会话结束状态");
		assertAssistantEventKind(kind, "助手结束事件种类");
		if (status === "completed" && kind !== "completed") {
			throw new Error("完成的助手运行必须写 completed 事件");
		}
		if (status !== "completed" && kind !== "error") {
			throw new Error("失败、取消或中断的助手运行必须写 error 事件");
		}
		if (!isJsonObject(payload)) {
			throw new Error("助手结束事件的载荷必须是 JSON 对象");
		}
		const createdAt = new Date().toISOString();
		return this.#db.transaction((): AssistantEvent => {
			if (this.getAssistantConversation(id) === null) {
				throw new Error(`助手会话不存在：${id}`);
			}
			this.#db
				.prepare(
					"UPDATE assistant_conversations SET status = ?, updated_at = ? WHERE id = ?",
				)
				.run(status, createdAt, id);
			this.#db
				.prepare(
					`INSERT INTO assistant_events
					(conversation_id, seq, kind, payload, created_at)
					SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?
					FROM assistant_events WHERE conversation_id = ?`,
				)
				.run(id, kind, JSON.stringify(payload), createdAt, id);
			const row = this.#db
				.prepare(
					`SELECT conversation_id, seq, kind, payload, created_at
					FROM assistant_events WHERE conversation_id = ?
					ORDER BY seq DESC LIMIT 1`,
				)
				.get(id) as AssistantEventRow | undefined;
			if (row === undefined) {
				throw new Error(`助手事件写入后读取失败：${id}`);
			}
			return rowToAssistantEvent(row);
		})();
	}

	/** 启动时把上一个进程留下的运行中会话标为 interrupted。 */
	markInterruptedAssistantConversations(updatedAt?: string): number {
		const value = updatedAt ?? new Date().toISOString();
		assertNonEmptyString(value, "助手会话结束时间");
		const info = this.#db
			.prepare(
				`UPDATE assistant_conversations SET status = 'interrupted', updated_at = ?
				WHERE status = 'running'`,
			)
			.run(value);
		return info.changes;
	}

	/**
	 * 删除会话及其消息、事件与已决定动作；先删消息让 trigram 索引同步清理。
	 * 仍有待确认动作时拒绝删除，避免玩家丢掉待审提案。
	 */
	deleteAssistantConversation(id: string): void {
		assertNonEmptyString(id, "助手会话 id");
		if (this.getAssistantConversation(id) === null) {
			throw new Error(`助手会话不存在：${id}`);
		}
		const pending = this.countPendingAssistantActions({ conversationId: id });
		if (pending > 0) {
			throw new AssistantConversationHasPendingActionsError(id, pending);
		}
		this.#db.transaction(() => {
			this.#db
				.prepare("DELETE FROM assistant_messages WHERE conversation_id = ?")
				.run(id);
			this.#db
				.prepare("DELETE FROM assistant_conversations WHERE id = ?")
				.run(id);
			this.#db
				.prepare("DELETE FROM assistant_events WHERE conversation_id = ?")
				.run(id);
		})();
	}

	appendAssistantEvent(input: {
		readonly conversationId: string;
		readonly kind: AssistantEventKind;
		readonly payload: JsonObject;
		readonly createdAt?: string;
	}): AssistantEvent {
		assertNonEmptyString(input.conversationId, "助手会话 id");
		assertAssistantEventKind(input.kind, "助手事件种类");
		if (!isJsonObject(input.payload)) {
			throw new Error("助手事件载荷必须是 JSON 对象");
		}
		if (this.getAssistantConversation(input.conversationId) === null) {
			throw new Error(`助手会话不存在：${input.conversationId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手事件时间");
		this.#db
			.prepare(
				`INSERT INTO assistant_events
				(conversation_id, seq, kind, payload, created_at)
				SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?
				FROM assistant_events WHERE conversation_id = ?`,
			)
			.run(
				input.conversationId,
				input.kind,
				JSON.stringify(input.payload),
				createdAt,
				input.conversationId,
			);
		const row = this.#db
			.prepare(
				`SELECT conversation_id, seq, kind, payload, created_at
				FROM assistant_events WHERE conversation_id = ?
				ORDER BY seq DESC LIMIT 1`,
			)
			.get(input.conversationId) as AssistantEventRow | undefined;
		if (row === undefined) {
			throw new Error(`助手事件写入后读取失败：${input.conversationId}`);
		}
		return rowToAssistantEvent(row);
	}

	listAssistantEvents(
		conversationId: string,
		options: ListAssistantEventsOptions = {},
	): AssistantEvent[] {
		assertNonEmptyString(conversationId, "助手会话 id");
		const afterSeq = options.afterSeq ?? 0;
		if (!Number.isInteger(afterSeq) || afterSeq < 0) {
			throw new Error(`助手事件起始序号必须是非负整数：${String(afterSeq)}`);
		}
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const rows = this.#db
			.prepare(
				`SELECT conversation_id, seq, kind, payload, created_at
				FROM assistant_events
				WHERE conversation_id = ? AND seq > ?
				ORDER BY seq ASC`,
			)
			.all(conversationId, afterSeq) as AssistantEventRow[];
		return rows.map(rowToAssistantEvent);
	}

	countAssistantEvents(conversationId: string): number {
		assertNonEmptyString(conversationId, "助手会话 id");
		if (this.getAssistantConversation(conversationId) === null) {
			throw new Error(`助手会话不存在：${conversationId}`);
		}
		const row = this.#db
			.prepare(
				"SELECT COUNT(*) AS count FROM assistant_events WHERE conversation_id = ?",
			)
			.get(conversationId) as { readonly count: number };
		return row.count;
	}

	/**
	 * 写入一个待确认动作。同一会话里种类与规范化载荷都相同的待定动作只保留
	 * 第一条，重复提案直接返回已有记录。
	 */
	createAssistantAction(input: NewAssistantActionInput): AssistantAction {
		assertNonEmptyString(input.conversationId, "助手会话 id");
		assertAssistantActionKind(input.kind, "助手动作种类");
		if (
			typeof input.summary !== "string" ||
			input.summary.trim().length === 0
		) {
			throw new Error("助手动作的摘要必须是非空字符串");
		}
		assertAssistantActionPayload(input.kind, input.payload);
		const conversation = this.getAssistantConversation(input.conversationId);
		if (conversation === null) {
			throw new Error(`助手会话不存在：${input.conversationId}`);
		}
		const storyId = conversation.storyId;
		if (storyId === null && input.kind !== "channels") {
			throw new Error(`动作 ${input.kind} 必须来自关联故事的会话`);
		}
		if (storyId !== null && this.getStory(storyId) === null) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "助手动作的创建时间");
		const payload = canonicalAssistantActionPayload(input.payload);
		const existing = this.#db
			.prepare(
				`SELECT * FROM assistant_actions
				WHERE conversation_id = ? AND kind = ? AND payload = ?
					AND status = 'pending'
				LIMIT 1`,
			)
			.get(input.conversationId, input.kind, payload) as
			| AssistantActionRow
			| undefined;
		if (existing !== undefined) return rowToAssistantAction(existing);
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "助手动作 id");
		if (this.getAssistantAction(id) !== null) {
			throw new Error(`助手动作已存在：${id}`);
		}
		this.#db
			.prepare(
				`INSERT INTO assistant_actions
				(id, conversation_id, story_id, kind, summary, payload, status,
					rejection_reason, created_at, decided_at)
				VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
			)
			.run(
				id,
				input.conversationId,
				storyId,
				input.kind,
				input.summary.trim(),
				payload,
				createdAt,
			);
		const action = this.getAssistantAction(id);
		if (action === null) {
			throw new Error(`助手动作写入后读取失败：${id}`);
		}
		return action;
	}

	getAssistantAction(id: string): AssistantAction | null {
		assertNonEmptyString(id, "助手动作 id");
		const row = this.#db
			.prepare("SELECT * FROM assistant_actions WHERE id = ?")
			.get(id) as AssistantActionRow | undefined;
		return row === undefined ? null : rowToAssistantAction(row);
	}

	/** 按创建顺序列出待确认动作；可以按会话、故事与状态过滤。 */
	listAssistantActions(
		options: ListAssistantActionsOptions = {},
	): AssistantAction[] {
		const limit = options.limit ?? DEFAULT_ASSISTANT_ACTION_LIST_LIMIT;
		assertAssistantActionListLimit(limit, "助手动作条数");
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		if (options.conversationId !== undefined) {
			assertNonEmptyString(options.conversationId, "助手会话 id");
			if (this.getAssistantConversation(options.conversationId) === null) {
				throw new Error(`助手会话不存在：${options.conversationId}`);
			}
			conditions.push("conversation_id = ?");
			params.push(options.conversationId);
		}
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "助手动作的故事 id");
			if (this.getStory(options.storyId) === null) {
				throw new Error(`故事不存在：${options.storyId}`);
			}
			conditions.push("story_id = ?");
			params.push(options.storyId);
		}
		if (options.status !== undefined) {
			assertAssistantActionStatus(options.status, "助手动作状态");
			conditions.push("status = ?");
			params.push(options.status);
		}
		const where =
			conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
		params.push(limit);
		const rows = this.#db
			.prepare(
				`SELECT * FROM assistant_actions
				${where}
				ORDER BY created_at ASC, id ASC
				LIMIT ?`,
			)
			.all(...params) as AssistantActionRow[];
		return rows.map(rowToAssistantAction);
	}

	countPendingAssistantActions(
		options: {
			readonly conversationId?: string;
			readonly storyId?: string;
		} = {},
	): number {
		const conditions = ["status = 'pending'"];
		const params: string[] = [];
		if (options.conversationId !== undefined) {
			assertNonEmptyString(options.conversationId, "助手会话 id");
			conditions.push("conversation_id = ?");
			params.push(options.conversationId);
		}
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "助手动作的故事 id");
			conditions.push("story_id = ?");
			params.push(options.storyId);
		}
		const row = this.#db
			.prepare(
				`SELECT COUNT(*) AS count FROM assistant_actions
				WHERE ${conditions.join(" AND ")}`,
			)
			.get(...params) as { readonly count: number };
		return row.count;
	}

	/** 结束一个待确认动作；只有待定状态可以改成批准或拒绝。 */
	setAssistantActionDecision(
		id: string,
		status: Exclude<AssistantActionStatus, "pending">,
		options: {
			readonly decidedAt?: string;
			readonly rejectionReason?: string | null;
		} = {},
	): AssistantAction {
		assertNonEmptyString(id, "助手动作 id");
		if (status !== "approved" && status !== "rejected") {
			throw new Error("助手动作的结束状态只能是 approved 或 rejected");
		}
		const decidedAt = options.decidedAt ?? new Date().toISOString();
		assertNonEmptyString(decidedAt, "助手动作的决定时间");
		const rejectionReason =
			status === "rejected" ? (options.rejectionReason ?? null) : null;
		if (
			status === "rejected" &&
			(rejectionReason === null || rejectionReason.trim().length === 0)
		) {
			throw new Error("拒绝助手动作必须写明原因");
		}
		return this.#db.transaction((): AssistantAction => {
			const existing = this.getAssistantAction(id);
			if (existing === null) {
				throw new Error(`助手动作不存在：${id}`);
			}
			if (existing.status !== "pending") {
				throw new Error(
					`助手动作 ${id} 的状态是 ${existing.status}，不能再决定`,
				);
			}
			this.#db
				.prepare(
					`UPDATE assistant_actions
					SET status = ?, rejection_reason = ?, decided_at = ?
					WHERE id = ?`,
				)
				.run(status, rejectionReason, decidedAt, id);
			const action = this.getAssistantAction(id);
			if (action === null) {
				throw new Error(`助手动作 ${id} 更新后读取失败`);
			}
			return action;
		})();
	}

	/** 按任务类型的入队条件为故事补建缺失的后台任务。 */
	enqueueMissingBackgroundJobs(
		input: EnqueueBackgroundJobsInput,
	): BackgroundJob[] {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!Array.isArray(input.kinds)) {
			throw new Error("后台任务类型必须是数组");
		}
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const kinds: string[] = [];
		for (const kind of input.kinds) {
			assertNonEmptyString(kind, "后台任务类型");
			if (kind !== kind.trim()) {
				throw new Error(`后台任务类型不能包含首尾空白：${kind}`);
			}
			if (kinds.includes(kind)) {
				throw new Error(`后台任务类型重复：${kind}`);
			}
			kinds.push(kind);
		}
		if (kinds.length === 0) return [];
		const declared = input.conditions ?? {};
		for (const [kind, condition] of Object.entries(declared)) {
			if (!kinds.includes(kind)) {
				throw new Error(`后台任务类型 ${kind} 不在本次入队的类型列表里`);
			}
			if (!isBackgroundJobEnqueueCondition(condition)) {
				throw new Error(
					`后台任务类型 ${kind} 的入队条件不合法：${String(condition)}`,
				);
			}
		}
		const conditionFor = (kind: string): BackgroundJobEnqueueCondition =>
			Object.hasOwn(declared, kind)
				? (declared[kind] ?? "confirmed")
				: "confirmed";
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "后台任务的创建时间");
		const requiresSettled = kinds.some(
			(kind) => conditionFor(kind) === "settled",
		);
		const requiresConfirmed = kinds.some(
			(kind) => conditionFor(kind) === "confirmed",
		);
		const nodeIds = this.getPathToHead(input.storyId).map((node) => node.id);
		const pathNodeIds = new Set(nodeIds);
		const confirmed = requiresConfirmed
			? new Set(
					(
						this.#db
							.prepare(
								`SELECT DISTINCT parent.id AS id
								FROM nodes child
								JOIN nodes parent ON parent.id = child.parent_id
								LEFT JOIN traces ON traces.node_id = parent.id
								WHERE child.story_id = ?
									AND COALESCE(json_extract(traces.trace, '$.profile'), 'native') <> 'naive'`,
							)
							.all(input.storyId) as { readonly id: string }[]
					)
						.filter((row) => pathNodeIds.has(row.id))
						.map((row) => row.id),
				)
			: new Set<string>();
		const settled = requiresSettled
			? new Set(
					(
						this.#db
							.prepare(
								`SELECT nodes.id AS id
								FROM nodes
								LEFT JOIN traces ON traces.node_id = nodes.id
								WHERE nodes.story_id = ?
									AND nodes.role = 'assistant'
									AND COALESCE(json_extract(traces.trace, '$.llm.stopReason'), '') <> 'aborted'
									AND COALESCE(json_extract(traces.trace, '$.profile'), 'native') <> 'naive'`,
							)
							.all(input.storyId) as { readonly id: string }[]
					)
						.filter((row) => pathNodeIds.has(row.id))
						.map((row) => row.id),
				)
			: new Set<string>();
		const insert = this.#db.prepare(
			`INSERT INTO background_jobs
				(story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
			VALUES (?, ?, ?, 'pending', 0, NULL, ?, NULL, NULL)
			ON CONFLICT (node_id, kind) DO UPDATE SET
				status = 'pending',
				last_error = NULL,
				started_at = NULL,
				finished_at = NULL
			WHERE background_jobs.status = 'discarded'
			RETURNING id`,
		);
		const insertStoryJob = this.#db.prepare(
			`INSERT INTO background_jobs
				(story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
			VALUES (?, NULL, ?, 'pending', 0, NULL, ?, NULL, NULL)
			ON CONFLICT (story_id, kind) WHERE node_id IS NULL DO UPDATE SET
				status = 'pending',
				last_error = NULL,
				started_at = NULL,
				finished_at = NULL
			WHERE background_jobs.status IN ('done', 'failed', 'discarded')
			RETURNING id`,
		);
		const created: BackgroundJob[] = [];
		this.#db.transaction(() => {
			for (const nodeId of nodeIds) {
				for (const kind of kinds) {
					const condition = conditionFor(kind);
					if (condition === "story") continue;
					const eligible =
						condition === "settled"
							? settled.has(nodeId)
							: confirmed.has(nodeId);
					if (!eligible) continue;
					const row = insert.get(input.storyId, nodeId, kind, createdAt) as
						| { readonly id: number }
						| undefined;
					if (row === undefined) continue;
					const job = this.getBackgroundJob(row.id);
					if (!job) {
						throw new Error(`后台任务写入后读取失败：${String(row.id)}`);
					}
					created.push(job);
				}
			}
			for (const kind of kinds) {
				if (conditionFor(kind) !== "story") continue;
				const row = insertStoryJob.get(input.storyId, kind, createdAt) as
					| { readonly id: number }
					| undefined;
				if (row === undefined) continue;
				const job = this.getBackgroundJob(row.id);
				if (!job) {
					throw new Error(`后台任务写入后读取失败：${String(row.id)}`);
				}
				created.push(job);
			}
		})();
		return created;
	}

	/**
	 * 按任务类型入队故事级任务（node_id 为空），不判断这是不是当前需要的任务；
	 * 同一类型已经有待办或执行中的行时原样返回，已完成、失败或丢弃的行翻回 pending。
	 */
	enqueueStoryBackgroundJobs(
		input: EnqueueStoryBackgroundJobsInput,
	): BackgroundJob[] {
		assertNonEmptyString(input.storyId, "故事 id");
		if (!Array.isArray(input.kinds)) {
			throw new Error("后台任务类型必须是数组");
		}
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const kinds: string[] = [];
		for (const kind of input.kinds) {
			assertNonEmptyString(kind, "后台任务类型");
			if (kind !== kind.trim()) {
				throw new Error(`后台任务类型不能包含首尾空白：${kind}`);
			}
			if (kinds.includes(kind)) {
				throw new Error(`后台任务类型重复：${kind}`);
			}
			kinds.push(kind);
		}
		if (kinds.length === 0) return [];
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "后台任务的创建时间");
		const select = this.#db.prepare(
			`SELECT * FROM background_jobs
			WHERE story_id = ? AND node_id IS NULL AND kind = ?`,
		);
		const insert = this.#db.prepare(
			`INSERT INTO background_jobs
				(story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
			VALUES (?, NULL, ?, 'pending', 0, NULL, ?, NULL, NULL)`,
		);
		const reopen = this.#db.prepare(
			`UPDATE background_jobs
			SET status = 'pending', last_error = NULL, started_at = NULL, finished_at = NULL
			WHERE id = ? AND status IN ('done', 'failed', 'discarded')`,
		);
		const jobs: BackgroundJob[] = [];
		this.#db.transaction(() => {
			for (const kind of kinds) {
				const existing = select.get(input.storyId, kind) as
					| BackgroundJobRow
					| undefined;
				if (existing === undefined) {
					insert.run(input.storyId, kind, createdAt);
				} else if (
					existing.status === "done" ||
					existing.status === "failed" ||
					existing.status === "discarded"
				) {
					reopen.run(existing.id);
				}
				const row = select.get(input.storyId, kind) as BackgroundJobRow;
				jobs.push(rowToBackgroundJob(row));
			}
		})();
		return jobs;
	}

	/** 每个状态的任务条数；可以只看指定的任务类型。 */
	countBackgroundJobs(
		options: CountBackgroundJobsOptions,
	): BackgroundJobCounts {
		assertNonEmptyString(options.storyId, "故事 id");
		const kinds: string[] = [];
		if (options.kinds !== undefined) {
			if (!Array.isArray(options.kinds)) {
				throw new Error("后台任务类型必须是数组");
			}
			for (const kind of options.kinds) {
				assertNonEmptyString(kind, "后台任务类型");
				if (kinds.includes(kind)) {
					throw new Error(`后台任务类型重复：${kind}`);
				}
				kinds.push(kind);
			}
			if (kinds.length === 0) {
				return { pending: 0, running: 0, done: 0, failed: 0, discarded: 0 };
			}
		}
		const params: Record<string, unknown> = { storyId: options.storyId };
		let kindClause = "";
		if (kinds.length > 0) {
			const placeholders = kinds.map((kind, index) => {
				params[`kind${index}`] = kind;
				return `@kind${index}`;
			});
			kindClause = ` AND kind IN (${placeholders.join(", ")})`;
		}
		const rows = this.#db
			.prepare(
				`SELECT status, COUNT(*) AS count FROM background_jobs
				WHERE story_id = @storyId${kindClause}
				GROUP BY status`,
			)
			.all(params) as { readonly status: string; readonly count: number }[];
		const counts: Record<string, number> = {
			pending: 0,
			running: 0,
			done: 0,
			failed: 0,
			discarded: 0,
		};
		for (const row of rows) {
			if (!isBackgroundJobStatus(row.status)) {
				throw new Error(`后台任务的状态不合法：${row.status}`);
			}
			counts[row.status] = row.count;
		}
		return {
			pending: counts.pending ?? 0,
			running: counts.running ?? 0,
			done: counts.done ?? 0,
			failed: counts.failed ?? 0,
			discarded: counts.discarded ?? 0,
		};
	}

	getBackgroundJob(id: number): BackgroundJob | null {
		assertBackgroundJobId(id);
		const row = this.#db
			.prepare("SELECT * FROM background_jobs WHERE id = ?")
			.get(id) as BackgroundJobRow | undefined;
		return row ? rowToBackgroundJob(row) : null;
	}

	listBackgroundJobs(options: ListBackgroundJobsOptions = {}): BackgroundJob[] {
		if (options.storyId !== undefined) {
			assertNonEmptyString(options.storyId, "故事 id");
		}
		if (
			options.status !== undefined &&
			!isBackgroundJobStatus(options.status)
		) {
			throw new Error(`后台任务状态不合法：${String(options.status)}`);
		}
		const kinds: string[] = [];
		if (options.kinds !== undefined) {
			if (!Array.isArray(options.kinds)) {
				throw new Error("后台任务类型必须是数组");
			}
			for (const kind of options.kinds) {
				assertNonEmptyString(kind, "后台任务类型");
				if (kinds.includes(kind)) {
					throw new Error(`后台任务类型重复：${kind}`);
				}
				kinds.push(kind);
			}
			if (kinds.length === 0) return [];
		}
		const limit = options.limit ?? -1;
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit === 0) {
			throw new Error("后台任务条数必须是非零整数");
		}
		const params: Record<string, unknown> = {
			storyId: options.storyId ?? null,
			status: options.status ?? null,
			limit,
		};
		let kindClause = "";
		if (kinds.length > 0) {
			const placeholders = kinds.map((kind, index) => {
				params[`kind${index}`] = kind;
				return `@kind${index}`;
			});
			kindClause = ` AND kind IN (${placeholders.join(", ")})`;
		}
		const rows = this.#db
			.prepare(
				`SELECT * FROM background_jobs
				WHERE (@storyId IS NULL OR story_id = @storyId)
					AND (@status IS NULL OR status = @status)${kindClause}
				ORDER BY created_at ASC, id ASC
				LIMIT @limit`,
			)
			.all(params) as BackgroundJobRow[];
		return rows.map(rowToBackgroundJob);
	}

	/**
	 * 进程在执行中途退出后，running 行既不会被 drain 取到，也不计入待办。
	 * 启动时把它们退回 pending，并撤销开始执行时累计的那一次；其它状态不动。
	 */
	requeueRunningBackgroundJobs(storyId?: string): number {
		if (storyId !== undefined) assertNonEmptyString(storyId, "故事 id");
		const result = this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = 'pending', attempts = MAX(attempts - 1, 0), started_at = NULL, finished_at = NULL
				WHERE status = 'running' AND (@storyId IS NULL OR story_id = @storyId)`,
			)
			.run({ storyId: storyId ?? null });
		return result.changes;
	}

	/** 把 pending 任务标为 running，并累计执行次数。 */
	startBackgroundJob(id: number, startedAt?: string): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "pending") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 pending 可以开始执行`,
			);
		}
		const at = startedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的开始时间");
		this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = 'running', attempts = attempts + 1, started_at = ?, finished_at = NULL
				WHERE id = ?`,
			)
			.run(at, id);
		return this.#requireBackgroundJob(id);
	}

	/** 把 running 任务标为 done，并清空上一次失败的错误。 */
	finishBackgroundJob(id: number, finishedAt?: string): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "running") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 running 可以完成`,
			);
		}
		const at = finishedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的完成时间");
		this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = 'done', last_error = NULL, finished_at = ?
				WHERE id = ?`,
			)
			.run(at, id);
		return this.#requireBackgroundJob(id);
	}

	/**
	 * 记录一次失败：执行次数达到上限时标为 failed，否则退回 pending 等待下一轮。
	 */
	failBackgroundJob(id: number, input: FailBackgroundJobInput): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "running") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 running 可以记录失败`,
			);
		}
		assertNonEmptyString(input.error, "后台任务的错误信息");
		if (
			typeof input.maxAttempts !== "number" ||
			!Number.isInteger(input.maxAttempts) ||
			input.maxAttempts < 1
		) {
			throw new Error("后台任务的最大执行次数必须是正整数");
		}
		const at = input.finishedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的完成时间");
		const exhausted = job.attempts >= input.maxAttempts;
		this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = ?, last_error = ?, started_at = ?, finished_at = ?
				WHERE id = ?`,
			)
			.run(
				exhausted ? "failed" : "pending",
				input.error,
				exhausted ? job.startedAt : null,
				exhausted ? at : null,
				id,
			);
		return this.#requireBackgroundJob(id);
	}

	/**
	 * 把 running 任务退回 pending，并且不消耗执行次数：任务依赖的其它任务还没完成，
	 * 下一轮再试。
	 */
	deferBackgroundJob(id: number): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "running") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 running 可以退回等待`,
			);
		}
		this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = 'pending', attempts = attempts - 1, started_at = NULL, finished_at = NULL
				WHERE id = ?`,
			)
			.run(id);
		return this.#requireBackgroundJob(id);
	}

	/** 楼层已经不在当前路径上时把 pending 任务标为 discarded；不会自动重试。 */
	discardBackgroundJob(id: number, finishedAt?: string): BackgroundJob {
		const job = this.#requireBackgroundJob(id);
		if (job.status !== "pending") {
			throw new Error(
				`后台任务 ${id} 的状态是 ${job.status}，只有 pending 可以丢弃`,
			);
		}
		const at = finishedAt ?? new Date().toISOString();
		assertNonEmptyString(at, "后台任务的完成时间");
		this.#db
			.prepare(
				`UPDATE background_jobs
				SET status = 'discarded', started_at = NULL, finished_at = ?
				WHERE id = ?`,
			)
			.run(at, id);
		return this.#requireBackgroundJob(id);
	}

	#requireBackgroundJob(id: number): BackgroundJob {
		const job = this.getBackgroundJob(id);
		if (!job) {
			throw new Error(`后台任务不存在：${id}`);
		}
		return job;
	}

	/** 把楼层的原文切成检索块并写入 FTS；已存在的块由唯一约束挡住，可重复调用。 */
	#indexNodeChunks(node: {
		readonly id: string;
		readonly storyId: string;
		readonly raw: string;
	}): void {
		const insertChunk = this.#db.prepare(
			`INSERT INTO chunks (story_id, node_id, ordinal, text, parent_ordinal, parent_text)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (node_id, ordinal) DO NOTHING`,
		);
		const insertText = this.#db.prepare(
			`INSERT INTO chunks_fts (rowid, text, node_id, story_id)
			VALUES (?, ?, ?, ?)`,
		);
		const fragments =
			this.#chunkStrategy === "parent-child"
				? chunkTextByParent(node.raw)
				: chunkText(node.raw).map((text) => ({
						parentOrdinal: null,
						parentText: null,
						text,
					}));
		for (const [ordinal, fragment] of fragments.entries()) {
			const normalized = normalizeRetrievalText(fragment.text);
			if (normalized === "") continue;
			const info = insertChunk.run(
				node.storyId,
				node.id,
				ordinal,
				fragment.text,
				fragment.parentOrdinal,
				fragment.parentText,
			);
			if (info.changes !== 1) continue;
			insertText.run(info.lastInsertRowid, normalized, node.id, node.storyId);
		}
	}

	/**
	 * 校验数据库里的 vec0 表维度与本次打开使用的配置一致。
	 * vec0 的维度创建后不能修改，维度不一致时写入与检索都会失败。
	 */
	#assertEmbeddingDimensions(): void {
		const row = this.#db
			.prepare("SELECT sql FROM sqlite_master WHERE name = 'chunk_vectors'")
			.get() as { readonly sql: string } | undefined;
		if (!row) {
			throw new Error("数据库缺少 chunk_vectors 表");
		}
		const match = /embedding\s+float\[(\d+)\]/i.exec(row.sql);
		if (!match) {
			throw new Error("无法从 chunk_vectors 表读取向量维度");
		}
		const actual = Number(match[1]);
		if (actual !== this.#embeddingDimensions) {
			throw new Error(
				`数据库的向量维度是 ${actual}，与配置的 ${this.#embeddingDimensions} 不一致`,
			);
		}
	}

	#normaliseEmbedding(value: unknown, label: string): Buffer {
		if (!Array.isArray(value)) {
			throw new Error(`${label} 必须是数字数组`);
		}
		if (value.length !== this.#embeddingDimensions) {
			throw new Error(
				`${label} 的维度必须是 ${this.#embeddingDimensions}，实际为 ${value.length}`,
			);
		}
		const numbers = value.map((item, index) => {
			if (typeof item !== "number" || !Number.isFinite(item)) {
				throw new Error(`${label}[${index}] 必须是有限数字`);
			}
			return item;
		});
		return Buffer.from(new Float32Array(numbers).buffer);
	}

	/**
	 * 为还没有任何块的楼层补建索引。迁移后首次打开会覆盖全部旧楼层；
	 * 空文本的楼层没有块，下次打开会再次尝试，但不会产生重复行。
	 */
	#backfillChunks(): void {
		const nodes = this.#db
			.prepare(
				`SELECT id, story_id, raw FROM nodes
				WHERE NOT EXISTS (SELECT 1 FROM chunks WHERE chunks.node_id = nodes.id)
				ORDER BY row_id ASC`,
			)
			.all() as {
			readonly id: string;
			readonly story_id: string;
			readonly raw: string;
		}[];
		if (nodes.length === 0) return;
		this.#db.transaction(() => {
			for (const node of nodes) {
				this.#indexNodeChunks({
					id: node.id,
					storyId: node.story_id,
					raw: node.raw,
				});
			}
		})();
	}

	#normaliseCompression(input: NewChapterCompressionInput): ChapterCompression {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error("压缩必须是对象");
		}
		assertNonEmptyString(input.storyId, "压缩的 storyId");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isCompressionLevel(input.level)) {
			throw new Error(`压缩级别不合法：${String(input.level)}`);
		}
		assertNonEmptyString(input.startNodeId, "压缩的 startNodeId");
		assertNonEmptyString(input.endNodeId, "压缩的 endNodeId");
		const start = this.getNode(input.startNodeId);
		if (!start) {
			throw new Error(`压缩的起点楼层不存在：${input.startNodeId}`);
		}
		if (start.storyId !== input.storyId) {
			throw new Error(
				`压缩的起点楼层属于另一个故事 ${start.storyId}：${input.startNodeId}`,
			);
		}
		const end = this.getNode(input.endNodeId);
		if (!end) {
			throw new Error(`压缩的终点楼层不存在：${input.endNodeId}`);
		}
		if (end.storyId !== input.storyId) {
			throw new Error(
				`压缩的终点楼层属于另一个故事 ${end.storyId}：${input.endNodeId}`,
			);
		}
		const sections = assertCompressionSections(
			input.sections,
			"压缩的 sections",
		);
		const path = this.getPathToNode(input.endNodeId);
		const startIndex = path.findIndex((node) => node.id === input.startNodeId);
		if (startIndex === -1) {
			throw new Error(
				`压缩的起点必须是终点的祖先：${input.startNodeId} 不在 ${input.endNodeId} 的路径上`,
			);
		}
		if (startIndex === path.length - 1) {
			throw new Error("压缩的起点必须在终点之前");
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "压缩的 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "压缩的 createdAt");
		return {
			id,
			storyId: input.storyId,
			level: input.level,
			startNodeId: input.startNodeId,
			endNodeId: input.endNodeId,
			sections,
			tokenCount: estimateTokens(formatCompressionSections(sections)),
			createdAt,
		};
	}

	#normaliseSummary(input: NewSummaryInput): NormalisedSummary {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error("摘要必须是对象");
		}
		assertNonEmptyString(input.storyId, "摘要的 storyId");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		if (!isSummaryLevel(input.level)) {
			throw new Error(`摘要级别不合法：${String(input.level)}`);
		}
		assertNonEmptyString(input.startNodeId, "摘要的 startNodeId");
		assertNonEmptyString(input.endNodeId, "摘要的 endNodeId");
		const start = this.getNode(input.startNodeId);
		if (!start) {
			throw new Error(`摘要的起点楼层不存在：${input.startNodeId}`);
		}
		if (start.storyId !== input.storyId) {
			throw new Error(
				`摘要的起点楼层属于另一个故事 ${start.storyId}：${input.startNodeId}`,
			);
		}
		const end = this.getNode(input.endNodeId);
		if (!end) {
			throw new Error(`摘要的终点楼层不存在：${input.endNodeId}`);
		}
		if (end.storyId !== input.storyId) {
			throw new Error(
				`摘要的终点楼层属于另一个故事 ${end.storyId}：${input.endNodeId}`,
			);
		}
		if (typeof input.text !== "string") {
			throw new Error("摘要的 text 必须是字符串");
		}
		const text = input.text.trim();
		if (text.length === 0) {
			throw new Error("摘要的 text 不能是空字符串");
		}
		const path = this.getPathToNode(input.endNodeId);
		const startIndex = path.findIndex((node) => node.id === input.startNodeId);
		if (startIndex === -1) {
			throw new Error(
				`摘要的起点必须是终点的祖先：${input.startNodeId} 不在 ${input.endNodeId} 的路径上`,
			);
		}
		if (startIndex === path.length - 1) {
			throw new Error("摘要的起点必须在终点之前");
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, "摘要的 id");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "摘要的 createdAt");
		return {
			id,
			storyId: input.storyId,
			level: input.level,
			startNodeId: input.startNodeId,
			endNodeId: input.endNodeId,
			text,
			tokenCount: estimateTokens(text),
			createdAt,
		};
	}

	#normaliseMemoryEvent(
		input: NewMemoryEventInput,
		index: number,
	): NormalisedMemoryEvent {
		const label = `事件记忆[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		assertNonEmptyString(input.sourceNodeId, `${label} 的 sourceNodeId`);
		const node = this.getNode(input.sourceNodeId);
		if (!node) {
			throw new Error(`${label} 指向的楼层节点不存在：${input.sourceNodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`${label} 的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		if (
			typeof input.ordinal !== "number" ||
			!Number.isInteger(input.ordinal) ||
			input.ordinal < 0
		) {
			throw new Error(`${label} 的 ordinal 必须是不小于 0 的整数`);
		}
		if (typeof input.text !== "string" || input.text.trim().length === 0) {
			throw new Error(`${label} 的 text 必须是非空字符串`);
		}
		if (
			typeof input.importance !== "number" ||
			!Number.isFinite(input.importance) ||
			input.importance < 0 ||
			input.importance > 1
		) {
			throw new Error(`${label} 的 importance 必须在 0 到 1 之间`);
		}
		const storyTime = optionalTrimmedString(
			input.storyTime,
			`${label} 的 storyTime`,
		);
		const location = optionalTrimmedString(
			input.location,
			`${label} 的 location`,
		);
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, `${label} 的 id`);
		const source = input.source ?? DEFAULT_MEMORY_EVENT_SOURCE;
		assertNonEmptyString(source, `${label} 的 source`);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			id,
			storyId: input.storyId,
			sourceNodeId: input.sourceNodeId,
			ordinal: input.ordinal,
			storyTime,
			location,
			participants: normaliseNameArray(
				input.participants,
				`${label} 的 participants`,
			),
			importance: input.importance,
			knowers: normaliseNameArray(input.knowers, `${label} 的 knowers`),
			text: input.text,
			source,
			createdAt,
		};
	}

	#normalisePlotNote(
		input: NewPlotNoteInput,
		index: number,
	): NormalisedPlotNote {
		const label = `剧情笔记[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.sourceNodeId, `${label} 的 sourceNodeId`);
		const node = this.getNode(input.sourceNodeId);
		if (!node) {
			throw new Error(`${label} 指向的楼层节点不存在：${input.sourceNodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`${label} 的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		if (typeof input.text !== "string") {
			throw new Error(`${label} 的 text 必须是字符串`);
		}
		const text = input.text.trim();
		if (text.length === 0) {
			throw new Error(`${label} 的 text 不能是空字符串`);
		}
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, `${label} 的 id`);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			id,
			storyId: input.storyId,
			sourceNodeId: input.sourceNodeId,
			text,
			createdAt,
		};
	}

	#normaliseDirectorDecision(
		input: NewDirectorDecisionInput,
	): NormalisedDirectorDecision {
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error("导演决策必须是对象");
		}
		assertNonEmptyString(input.nodeId, "导演决策的 nodeId");
		assertNonEmptyString(input.storyId, "导演决策的 storyId");
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`导演决策的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		const directive =
			input.directive === null
				? null
				: optionalTrimmedString(input.directive, "导演决策的 directive");
		if (!Array.isArray(input.mechanisms) || input.mechanisms.length === 0) {
			throw new Error("导演决策的 mechanisms 必须是非空数组");
		}
		const mechanisms: DirectorMechanismRecord[] = [];
		for (const [index, entry] of input.mechanisms.entries()) {
			const label = `导演决策的 mechanisms[${index}]`;
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
				throw new Error(`${label} 必须是对象`);
			}
			if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
				throw new Error(`${label}.name 必须是非空字符串`);
			}
			const name = entry.name.trim();
			if (mechanisms.some((record) => record.name === name)) {
				throw new Error(`${label}.name 重复：${name}`);
			}
			if (typeof entry.triggered !== "boolean") {
				throw new Error(`${label}.triggered 必须是布尔值`);
			}
			if (
				typeof entry.reason !== "string" ||
				entry.reason.trim().length === 0
			) {
				throw new Error(`${label}.reason 必须是非空字符串`);
			}
			const reason = entry.reason.trim();
			mechanisms.push({ name, triggered: entry.triggered, reason });
		}
		if (!isJsonObject(input.signals)) {
			throw new Error("导演决策的 signals 必须是 JSON 对象");
		}
		serializeJsonValue(input.signals, "导演决策的 signals");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "导演决策的 createdAt");
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			directive,
			mechanisms,
			signals: input.signals,
			createdAt,
		};
	}

	#normaliseLoreEntry(
		input: NewLoreEntryInput,
		index: number,
	): NormalisedLoreEntry {
		const label = `世界书条目[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.name, `${label} 的 name`);
		const name = input.name.trim();
		if (name.length === 0) {
			throw new Error(`${label} 的 name 不能是空字符串`);
		}
		if (typeof input.content !== "string") {
			throw new Error(`${label} 的 content 必须是字符串`);
		}
		const content = input.content.trim();
		if (content.length === 0) {
			throw new Error(`${label} 的 content 不能是空字符串`);
		}
		const constant = input.constant ?? false;
		if (typeof constant !== "boolean") {
			throw new Error(`${label} 的 constant 必须是布尔值`);
		}
		const keywords = input.keywords ?? [];
		if (!Array.isArray(keywords)) {
			throw new Error(`${label} 的 keywords 必须是字符串数组`);
		}
		const normalizedKeywords: string[] = [];
		for (const keyword of keywords) {
			if (typeof keyword !== "string") {
				throw new Error(`${label} 的 keywords 必须是字符串数组`);
			}
			const trimmed = keyword.trim();
			if (trimmed.length === 0) {
				throw new Error(`${label} 的 keywords 不能包含空字符串`);
			}
			normalizedKeywords.push(trimmed);
		}
		const entityId = input.entityId ?? null;
		if (entityId !== null) {
			assertNonEmptyString(entityId, `${label} 的 entityId`);
			const entity = this.getEntity(entityId);
			if (!entity) {
				throw new Error(`${label} 指向的实体不存在：${entityId}`);
			}
			if (entity.storyId !== input.storyId) {
				throw new Error(
					`${label} 的 storyId 与实体所属故事不一致：${input.storyId}`,
				);
			}
		}
		assertNonEmptyString(input.source, `${label} 的 source`);
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, `${label} 的 id`);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			id,
			storyId: input.storyId,
			entityId,
			name,
			content,
			constant,
			keywords: normalizedKeywords,
			source: input.source,
			createdAt,
		};
	}

	#normaliseEventPoolEntry(
		input: NewEventPoolEntryInput,
		index: number,
	): NormalisedEventPoolEntry {
		const label = `事件池条目[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.sourceId, `${label} 的 sourceId`);
		const sourceId = input.sourceId.trim();
		if (sourceId.length === 0) {
			throw new Error(`${label} 的 sourceId 不能是空字符串`);
		}
		if (typeof input.text !== "string") {
			throw new Error(`${label} 的 text 必须是字符串`);
		}
		const text = input.text.trim();
		if (text.length === 0) {
			throw new Error(`${label} 的 text 不能是空字符串`);
		}
		const preconditions = input.preconditions ?? null;
		if (preconditions !== null) {
			parseContextCondition(preconditions, `${label} 的 preconditions`, {
				allowSwitch: false,
			});
		}
		const cooldown = input.cooldown ?? 0;
		if (
			typeof cooldown !== "number" ||
			!Number.isInteger(cooldown) ||
			cooldown < 0
		) {
			throw new Error(`${label} 的 cooldown 必须是非负整数`);
		}
		const enabled = input.enabled ?? true;
		if (typeof enabled !== "boolean") {
			throw new Error(`${label} 的 enabled 必须是布尔值`);
		}
		const source = input.source ?? "manual";
		if (typeof source !== "string" || source.trim().length === 0) {
			throw new Error(`${label} 的 source 必须是非空字符串`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			storyId: input.storyId,
			sourceId,
			text,
			preconditions,
			cooldown,
			enabled,
			source: source.trim(),
			createdAt,
		};
	}

	#normaliseNpcAgenda(
		input: NewNpcAgendaInput,
		index: number,
	): NormalisedNpcAgenda {
		const label = `NPC 议程[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		if (!this.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.entityId, `${label} 的 entityId`);
		const entity = this.getEntity(input.entityId);
		if (!entity) {
			throw new Error(`${label} 指向的实体不存在：${input.entityId}`);
		}
		if (entity.storyId !== input.storyId) {
			throw new Error(
				`${label} 的 storyId 与实体所属故事不一致：${input.storyId}`,
			);
		}
		if (typeof input.goal !== "string") {
			throw new Error(`${label} 的 goal 必须是字符串`);
		}
		const goal = input.goal.trim();
		if (goal.length === 0) {
			throw new Error(`${label} 的 goal 不能是空字符串`);
		}
		const everyChapters = input.everyChapters ?? 1;
		if (
			typeof everyChapters !== "number" ||
			!Number.isInteger(everyChapters) ||
			everyChapters < 1
		) {
			throw new Error(`${label} 的 everyChapters 必须是正整数`);
		}
		const importance = input.importance ?? 0.5;
		if (
			typeof importance !== "number" ||
			!Number.isFinite(importance) ||
			importance < 0 ||
			importance > 1
		) {
			throw new Error(`${label} 的 importance 必须是 0 到 1 之间的数字`);
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			storyId: input.storyId,
			entityId: entity.id,
			goal,
			everyChapters,
			importance,
			createdAt,
		};
	}

	#normaliseStateDiff(input: NewStateDiff, index: number): NormalisedStateDiff {
		const label = `状态 diff[${index}]`;
		if (input === null || typeof input !== "object") {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		assertNonEmptyString(input.nodeId, `${label} 的 nodeId`);
		assertNonEmptyString(input.source, `${label} 的 source`);
		const op = input.op as string;
		if (op !== "set" && op !== "delete") {
			throw new Error(`${label} 的 op 不合法：${op}`);
		}
		assertStateDiffPath(input.path, label);
		const node = this.getNode(input.nodeId);
		if (!node) {
			throw new Error(`${label} 指向的楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`${label} 的 storyId 与楼层节点所属故事不一致：${input.storyId}`,
			);
		}
		const reason = input.reason ?? null;
		if (reason !== null && typeof reason !== "string") {
			throw new Error(`${label} 的 reason 必须是字符串或 null`);
		}
		let valueJson: string | null = null;
		if (input.op === "set") {
			valueJson = serializeJsonValue(input.value, `${label} 的 value`);
		} else if ("value" in input && input.value !== undefined) {
			throw new Error(`${label} 的 op 为 delete 时不能携带 value`);
		}
		return {
			storyId: input.storyId,
			nodeId: input.nodeId,
			path: input.path,
			op,
			valueJson,
			reason,
			source: input.source,
			storyTime: normaliseStoryTime(input.storyTime, label),
			confidence: assertLedgerConfidence(
				input.confidence,
				`${label} 的 confidence`,
			),
		};
	}
}

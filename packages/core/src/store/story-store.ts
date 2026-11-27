// 故事库的外观：打开数据库、迁移、事务，公开方法委托给 store/repos/ 下的领域仓储
// （refactor/05）。外部调用方只认 StoryStore，签名与拆分前一致。
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import {
	type ChunkStrategy,
	DEFAULT_CHUNK_STRATEGY,
	isChunkStrategy,
} from "../retrieval/chunk-text.js";
import {
	DEFAULT_EMBEDDING_DIMENSIONS,
	applyMigrations,
	buildMigrations,
} from "./migrations.js";
import { AssistantRepo } from "./repos/assistant.js";
import { BackgroundRepo } from "./repos/background.js";
import { CanonRepo } from "./repos/canon.js";
import { DirectorLinesRepo } from "./repos/director-lines.js";
import { DirectorPlanRepo } from "./repos/director-plan.js";
import { EntitiesRepo } from "./repos/entities.js";
import { ImagesRepo } from "./repos/images.js";
import { LedgerRepo } from "./repos/ledger.js";
import { LoreRepo } from "./repos/lore.js";
import { MemoryRepo } from "./repos/memory.js";
import { NodesRepo } from "./repos/nodes.js";
import { OpeningsRepo } from "./repos/openings.js";
import { OutlineRepo } from "./repos/outline.js";
import { ScenesRepo } from "./repos/scenes.js";
import {
	type StoryStoreOpenOptions,
	assertNonEmptyString,
} from "./repos/shared.js";
import { StoriesRepo } from "./repos/stories.js";
import { TurnsRepo } from "./repos/turns.js";

export type { CreateStoryInput } from "./repos/stories.js";
export type { AppendNodeInput } from "./repos/nodes.js";
export type {
	SearchNodeTextOptions,
	SearchChunksOptions,
	ChunkSearchMatch,
	ChunkWithoutVector,
	ChunkVectorInput,
	ChunkVectorForNode,
	SearchVectorsOptions,
	VectorSearchMatch,
	RecordEventExtractionsInput,
} from "./repos/memory.js";
export type { StoryStoreOpenOptions } from "./repos/shared.js";
export type {
	ListEntitiesOptions,
	ResolveEntitiesOptions,
} from "./repos/entities.js";
export type {
	EnqueueBackgroundJobsInput,
	EnqueueStoryBackgroundJobsInput,
	ListBackgroundJobsOptions,
	CountBackgroundJobsOptions,
	FailBackgroundJobInput,
} from "./repos/background.js";
export type {
	ListBlueprintSuggestionRequestsOptions,
	ListBlueprintSuggestionsOptions,
	SaveBlueprintSuggestionsInput,
} from "./repos/outline.js";
export type {
	CanonChapterExtractionDefaults,
	CanonChapterExtractionPatch,
	CanonChapterSplitResult,
	CanonChapterUpdate,
	CanonChunkResultsInput,
	CanonCompiledEntityInput,
	CanonEntityInput,
	CanonEventTimelinePatch,
	CreateCanonBookInput,
} from "./repos/canon.js";

const REPOS = Symbol("StoryStore.repos");

interface Repos {
	readonly stories: StoriesRepo;
	readonly canon: CanonRepo;
	readonly entities: EntitiesRepo;
	readonly nodes: NodesRepo;
	readonly ledger: LedgerRepo;
	readonly scenes: ScenesRepo;
	readonly "director-lines": DirectorLinesRepo;
	readonly outline: OutlineRepo;
	readonly openings: OpeningsRepo;
	readonly images: ImagesRepo;
	readonly memory: MemoryRepo;
	readonly "director-plan": DirectorPlanRepo;
	readonly lore: LoreRepo;
	readonly turns: TurnsRepo;
	readonly assistant: AssistantRepo;
	readonly background: BackgroundRepo;
}

export interface StoryStore
	extends Pick<
			StoriesRepo,
			| "createStory"
			| "getStory"
			| "updateStoryTitle"
			| "listStories"
			| "insertStoryMedia"
			| "clearStoryMedia"
			| "getStoryMedia"
			| "listStoryMedia"
			| "getCodePluginInstallation"
			| "listCodePluginInstallations"
			| "saveCodePluginInstallation"
			| "deleteCodePluginInstallation"
			| "getStorySettings"
			| "hasStorySettings"
			| "updateStorySettings"
			| "createContextTemplate"
			| "getContextTemplate"
			| "listContextTemplates"
			| "updateContextTemplate"
			| "deleteContextTemplate"
			| "findStoryUsingContextTemplate"
			| "getStoryValue"
			| "setStoryValue"
		>,
		Pick<
			EntitiesRepo,
			| "upsertEntity"
			| "getEntity"
			| "findEntityByName"
			| "listEntities"
			| "resolveEntities"
			| "addEntityAlias"
			| "listCharacterVisualProfiles"
			| "getCharacterVisualProfile"
			| "saveCharacterVisualProfiles"
			| "upsertEntityCandidate"
			| "listEntityCandidates"
		>,
		Pick<
			NodesRepo,
			| "appendNode"
			| "getNode"
			| "listStoryNodes"
			| "getPathToNode"
			| "getHead"
			| "setHead"
			| "getPathToHead"
			| "swipeNode"
			| "appendReplyVariant"
			| "editNode"
			| "isNodeConfirmed"
			| "recordPreference"
			| "listPreferenceEvents"
			| "countConfirmedAssistantNodesOnPath"
		>,
		Pick<
			LedgerRepo,
			| "appendStateDiff"
			| "appendStateDiffs"
			| "getStateDiffs"
			| "deleteStateDiffs"
			| "getStateDiffsAlongPath"
			| "countStateDiffsAlongPath"
			| "recordLedgerSettlement"
			| "getLedgerSettlement"
			| "listLedgerSettlements"
			| "listUnsettledSettledAssistantNodes"
			| "insertLedgerChangeCard"
			| "getLedgerChangeCard"
			| "listLedgerChangeCards"
			| "updateLedgerChangeCardStatus"
			| "savePlayerEdit"
			| "listPlayerEdits"
			| "getStateSnapshot"
			| "getStateSnapshotAtHead"
		>,
		Pick<
			ScenesRepo,
			| "saveSceneAnalysis"
			| "getSceneAnalysis"
			| "getLatestSceneAnalysisOnPath"
			| "appendWikiRevisions"
			| "listWikiRevisionsAlongPath"
			| "saveMemoryEventQuotes"
			| "getMemoryEventQuotes"
			| "recordMemoryRejection"
			| "listMemoryRejections"
			| "saveGapPassRun"
			| "getGapPassRun"
			| "saveSceneLog"
			| "getSceneLog"
			| "getLatestSceneLogOnPath"
			| "saveSceneArchive"
			| "getSceneArchive"
			| "listSceneArchivesAlongPath"
			| "saveSceneControl"
			| "getSceneControl"
			| "listSceneControlKindsOnPath"
			| "insertSummary"
			| "isSummaryValid"
			| "getValidSummaries"
			| "insertChapterCompression"
			| "isCompressionValid"
			| "getValidCompressions"
		>,
		Pick<
			DirectorLinesRepo,
			| "saveDirectorNotes"
			| "getDirectorNotes"
			| "readDirectorNoteEntries"
			| "saveDirectorLines"
			| "muteDirectorLine"
			| "unmuteDirectorLine"
			| "listMutedDirectorLines"
			| "getDirectorLines"
			| "readDirectorLineStates"
			| "listDirectorLinesAlongPath"
			| "saveDirectorChapterReview"
			| "saveDirectorChapterPlan"
			| "getDirectorChapterReview"
			| "listDirectorChapterReviewsAlongPath"
			| "insertPlotNotes"
			| "getOpenPlotNotes"
			| "fulfillPlotNote"
			| "countPlotNotesForNode"
			| "replaceDirectorCandidateActions"
			| "listDirectorCandidateActions"
			| "saveDirectorDecision"
			| "getDirectorDecision"
			| "getDirectorDecisionsAlongPath"
		>,
		Pick<
			OutlineRepo,
			| "saveStoryBlueprint"
			| "getStoryBlueprintRecord"
			| "listStoryBlueprintRecords"
			| "saveStoryBlueprintBaseline"
			| "readStoryBlueprintBaseline"
			| "listBlueprintVersions"
			| "readBlueprintEntries"
			| "rollbackStoryBlueprint"
			| "createBlueprintSuggestionRequest"
			| "getBlueprintSuggestionRequest"
			| "listBlueprintSuggestionRequests"
			| "findPendingBlueprintSuggestionRequest"
			| "saveBlueprintSuggestions"
			| "listBlueprintSuggestions"
			| "getBlueprintSuggestion"
			| "acceptBlueprintSuggestion"
			| "rejectBlueprintSuggestion"
		>,
		Pick<
			OpeningsRepo,
			| "saveOpeningPack"
			| "getOpeningPack"
			| "appendOpeningCandidates"
			| "listOpeningCandidates"
			| "getOpeningCandidate"
			| "chooseOpeningCandidate"
		>,
		Pick<
			ImagesRepo,
			| "listImageWorkflows"
			| "getImageWorkflow"
			| "saveImageWorkflow"
			| "deleteImageWorkflow"
			| "countNodeImagesForWorkflow"
			| "listNodeImages"
			| "listNodeImagesForNodes"
			| "listStoryNodeImages"
			| "listPendingNodeImages"
			| "getNodeImage"
			| "countNodeImages"
			| "listNodeImageNodeIds"
			| "insertNodeImage"
			| "startNodeImage"
			| "finishNodeImage"
			| "failNodeImage"
			| "requeueRunningNodeImages"
			| "retryNodeImage"
		>,
		Pick<
			MemoryRepo,
			| "appendNotebookVersion"
			| "listNotebookVersions"
			| "insertMemoryEvents"
			| "listExtractedEventNodeIds"
			| "recordEventExtractions"
			| "getEventsForPath"
			| "getEventsForNode"
			| "countEventsForNode"
			| "countChunksForNode"
			| "countChunkParentsForNode"
			| "countChunkVectorsForNode"
			| "listChunksMissingVectors"
			| "listChunkVectorsForNode"
			| "insertChunkVectors"
			| "searchVectors"
			| "searchChunks"
			| "searchNodeText"
		>,
		Pick<
			DirectorPlanRepo,
			| "listDirectorPlanEntries"
			| "replaceDirectorPlan"
			| "mergeDirectorPlan"
			| "getDirectorBeatState"
			| "saveDirectorBeatState"
			| "listDirectorBeatStatesAlongPath"
			| "replaceDirectorBits"
			| "listDirectorBits"
			| "saveDirectorBitJudgments"
			| "findDirectorBitJudgments"
			| "upsertEventPool"
			| "listEventPool"
			| "upsertNpcAgendas"
			| "listNpcAgendas"
			| "advanceNpcAgendas"
		>,
		Pick<
			LoreRepo,
			| "replaceStoryRules"
			| "listStoryRules"
			| "insertLoreEntries"
			| "listLoreEntries"
			| "saveImportAuditEntries"
			| "listImportAuditEntries"
			| "setImportAuditEntryKind"
			| "listImportAuditInjectionRules"
			| "setImportAuditEntryMemory"
			| "convertImportAuditPluginResidueToMemory"
			| "saveLorePrefilter"
			| "getLorePrefilter"
		>,
		Pick<
			TurnsRepo,
			| "saveContextPack"
			| "getContextPack"
			| "clearContextPacks"
			| "saveTurnTrace"
			| "getTurnTrace"
			| "startTurnRun"
			| "getTurnRun"
			| "getTurnRunForNode"
			| "listTurnRuns"
			| "appendTurnRunEvent"
			| "listTurnRunEvents"
			| "countTurnRunEvents"
			| "finishTurnRun"
			| "markInterruptedTurnRuns"
		>,
		Pick<
			AssistantRepo,
			| "createAssistantConversation"
			| "getAssistantConversation"
			| "listAssistantConversations"
			| "searchAssistantConversations"
			| "getAssistantMessages"
			| "createAssistantCompaction"
			| "getAssistantCompaction"
			| "listAssistantCompactions"
			| "appendAssistantMessage"
			| "updateAssistantConversation"
			| "setAssistantConversationStatus"
			| "startAssistantConversationRun"
			| "finishAssistantConversationRun"
			| "markInterruptedAssistantConversations"
			| "deleteAssistantConversation"
			| "appendAssistantEvent"
			| "listAssistantEvents"
			| "countAssistantEvents"
			| "createAssistantAction"
			| "getAssistantAction"
			| "listAssistantActions"
			| "countPendingAssistantActions"
			| "setAssistantActionDecision"
		>,
		Pick<
			BackgroundRepo,
			| "enqueueMissingBackgroundJobs"
			| "enqueueStoryBackgroundJobs"
			| "countBackgroundJobs"
			| "getBackgroundJob"
			| "listBackgroundJobs"
			| "requeueRunningBackgroundJobs"
			| "startBackgroundJob"
			| "addBackgroundJobUsage"
			| "finishBackgroundJob"
			| "failBackgroundJob"
			| "deferBackgroundJob"
			| "discardBackgroundJob"
		>,
		Pick<
			CanonRepo,
			| "createCanonBook"
			| "listCanonBooks"
			| "getCanonBook"
			| "listCanonChapters"
			| "listCanonChapterRecords"
			| "getCanonChapter"
			| "updateCanonChapter"
			| "mergeCanonChapterWithNext"
			| "splitCanonChapter"
			| "deleteCanonBook"
			| "getCanonExtraction"
			| "ensureCanonExtraction"
			| "markCanonExtractionRunning"
			| "pauseCanonExtraction"
			| "finishCanonExtraction"
			| "addCanonExtractionUsage"
			| "refreshCanonExtraction"
			| "markInterruptedCanonExtractions"
			| "ensureCanonChapterExtraction"
			| "getCanonChapterExtraction"
			| "listCanonChapterExtractions"
			| "setCanonChapterExtraction"
			| "resetCanonChapterExtraction"
			| "clearCanonChapterResults"
			| "insertCanonChunkResults"
			| "listCanonEntities"
			| "upsertCanonEntities"
			| "replaceCanonEntities"
			| "listCanonEvents"
			| "listCanonTimeline"
			| "listCanonVoices"
			| "listCanonFacts"
			| "getCanonCompilation"
			| "ensureCanonCompilation"
			| "markCanonCompilationRunning"
			| "addCanonCompilationUsage"
			| "finishCanonCompilation"
			| "markInterruptedCanonCompilations"
			| "listCanonCompiledEntities"
			| "replaceCanonCompiledEntities"
			| "applyCanonEntityMerges"
			| "applyCanonEventTimeline"
			| "importCanonPackage"
		> {}

export class StoryStore {
	readonly [REPOS]: Repos;
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
		this[REPOS] = {
			stories: new StoriesRepo(db, this, embeddingDimensions, chunkStrategy),
			canon: new CanonRepo(db, this, embeddingDimensions, chunkStrategy),
			entities: new EntitiesRepo(db, this, embeddingDimensions, chunkStrategy),
			nodes: new NodesRepo(db, this, embeddingDimensions, chunkStrategy),
			ledger: new LedgerRepo(db, this, embeddingDimensions, chunkStrategy),
			scenes: new ScenesRepo(db, this, embeddingDimensions, chunkStrategy),
			"director-lines": new DirectorLinesRepo(
				db,
				this,
				embeddingDimensions,
				chunkStrategy,
			),
			outline: new OutlineRepo(db, this, embeddingDimensions, chunkStrategy),
			openings: new OpeningsRepo(db, this, embeddingDimensions, chunkStrategy),
			images: new ImagesRepo(db, this, embeddingDimensions, chunkStrategy),
			memory: new MemoryRepo(db, this, embeddingDimensions, chunkStrategy),
			"director-plan": new DirectorPlanRepo(
				db,
				this,
				embeddingDimensions,
				chunkStrategy,
			),
			lore: new LoreRepo(db, this, embeddingDimensions, chunkStrategy),
			turns: new TurnsRepo(db, this, embeddingDimensions, chunkStrategy),
			assistant: new AssistantRepo(
				db,
				this,
				embeddingDimensions,
				chunkStrategy,
			),
			background: new BackgroundRepo(
				db,
				this,
				embeddingDimensions,
				chunkStrategy,
			),
		};
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
				this[REPOS].nodes.indexNodeChunks({
					id: node.id,
					storyId: node.story_id,
					raw: node.raw,
				});
			}
		})();
	}
}

const DELEGATES: Readonly<Record<keyof Repos, readonly string[]>> = {
	stories: [
		"createStory",
		"getStory",
		"updateStoryTitle",
		"listStories",
		"insertStoryMedia",
		"clearStoryMedia",
		"getStoryMedia",
		"listStoryMedia",
		"getCodePluginInstallation",
		"listCodePluginInstallations",
		"saveCodePluginInstallation",
		"deleteCodePluginInstallation",
		"getStorySettings",
		"hasStorySettings",
		"updateStorySettings",
		"createContextTemplate",
		"getContextTemplate",
		"listContextTemplates",
		"updateContextTemplate",
		"deleteContextTemplate",
		"findStoryUsingContextTemplate",
		"getStoryValue",
		"setStoryValue",
	],
	entities: [
		"upsertEntity",
		"getEntity",
		"findEntityByName",
		"listEntities",
		"resolveEntities",
		"addEntityAlias",
		"listCharacterVisualProfiles",
		"getCharacterVisualProfile",
		"saveCharacterVisualProfiles",
		"upsertEntityCandidate",
		"listEntityCandidates",
	],
	nodes: [
		"appendNode",
		"getNode",
		"listStoryNodes",
		"getPathToNode",
		"getHead",
		"setHead",
		"getPathToHead",
		"swipeNode",
		"appendReplyVariant",
		"editNode",
		"isNodeConfirmed",
		"recordPreference",
		"listPreferenceEvents",
		"countConfirmedAssistantNodesOnPath",
	],
	ledger: [
		"appendStateDiff",
		"appendStateDiffs",
		"getStateDiffs",
		"deleteStateDiffs",
		"getStateDiffsAlongPath",
		"countStateDiffsAlongPath",
		"recordLedgerSettlement",
		"getLedgerSettlement",
		"listLedgerSettlements",
		"listUnsettledSettledAssistantNodes",
		"insertLedgerChangeCard",
		"getLedgerChangeCard",
		"listLedgerChangeCards",
		"updateLedgerChangeCardStatus",
		"savePlayerEdit",
		"listPlayerEdits",
		"getStateSnapshot",
		"getStateSnapshotAtHead",
	],
	scenes: [
		"saveSceneAnalysis",
		"getSceneAnalysis",
		"getLatestSceneAnalysisOnPath",
		"appendWikiRevisions",
		"listWikiRevisionsAlongPath",
		"saveMemoryEventQuotes",
		"getMemoryEventQuotes",
		"recordMemoryRejection",
		"listMemoryRejections",
		"saveGapPassRun",
		"getGapPassRun",
		"saveSceneLog",
		"getSceneLog",
		"getLatestSceneLogOnPath",
		"saveSceneArchive",
		"getSceneArchive",
		"listSceneArchivesAlongPath",
		"saveSceneControl",
		"getSceneControl",
		"listSceneControlKindsOnPath",
		"insertSummary",
		"isSummaryValid",
		"getValidSummaries",
		"insertChapterCompression",
		"isCompressionValid",
		"getValidCompressions",
	],
	"director-lines": [
		"saveDirectorNotes",
		"getDirectorNotes",
		"readDirectorNoteEntries",
		"saveDirectorLines",
		"muteDirectorLine",
		"unmuteDirectorLine",
		"listMutedDirectorLines",
		"getDirectorLines",
		"readDirectorLineStates",
		"listDirectorLinesAlongPath",
		"saveDirectorChapterReview",
		"saveDirectorChapterPlan",
		"getDirectorChapterReview",
		"listDirectorChapterReviewsAlongPath",
		"insertPlotNotes",
		"getOpenPlotNotes",
		"fulfillPlotNote",
		"countPlotNotesForNode",
		"replaceDirectorCandidateActions",
		"listDirectorCandidateActions",
		"saveDirectorDecision",
		"getDirectorDecision",
		"getDirectorDecisionsAlongPath",
	],
	outline: [
		"saveStoryBlueprint",
		"getStoryBlueprintRecord",
		"listStoryBlueprintRecords",
		"saveStoryBlueprintBaseline",
		"readStoryBlueprintBaseline",
		"listBlueprintVersions",
		"readBlueprintEntries",
		"rollbackStoryBlueprint",
		"createBlueprintSuggestionRequest",
		"getBlueprintSuggestionRequest",
		"listBlueprintSuggestionRequests",
		"findPendingBlueprintSuggestionRequest",
		"saveBlueprintSuggestions",
		"listBlueprintSuggestions",
		"getBlueprintSuggestion",
		"acceptBlueprintSuggestion",
		"rejectBlueprintSuggestion",
	],
	openings: [
		"saveOpeningPack",
		"getOpeningPack",
		"appendOpeningCandidates",
		"listOpeningCandidates",
		"getOpeningCandidate",
		"chooseOpeningCandidate",
	],
	images: [
		"listImageWorkflows",
		"getImageWorkflow",
		"saveImageWorkflow",
		"deleteImageWorkflow",
		"countNodeImagesForWorkflow",
		"listNodeImages",
		"listNodeImagesForNodes",
		"listStoryNodeImages",
		"listPendingNodeImages",
		"getNodeImage",
		"countNodeImages",
		"listNodeImageNodeIds",
		"insertNodeImage",
		"startNodeImage",
		"finishNodeImage",
		"failNodeImage",
		"requeueRunningNodeImages",
		"retryNodeImage",
	],
	memory: [
		"appendNotebookVersion",
		"listNotebookVersions",
		"insertMemoryEvents",
		"listExtractedEventNodeIds",
		"recordEventExtractions",
		"getEventsForPath",
		"getEventsForNode",
		"countEventsForNode",
		"countChunksForNode",
		"countChunkParentsForNode",
		"countChunkVectorsForNode",
		"listChunksMissingVectors",
		"listChunkVectorsForNode",
		"insertChunkVectors",
		"searchVectors",
		"searchChunks",
		"searchNodeText",
	],
	"director-plan": [
		"listDirectorPlanEntries",
		"replaceDirectorPlan",
		"mergeDirectorPlan",
		"getDirectorBeatState",
		"saveDirectorBeatState",
		"listDirectorBeatStatesAlongPath",
		"replaceDirectorBits",
		"listDirectorBits",
		"saveDirectorBitJudgments",
		"findDirectorBitJudgments",
		"upsertEventPool",
		"listEventPool",
		"upsertNpcAgendas",
		"listNpcAgendas",
		"advanceNpcAgendas",
	],
	lore: [
		"replaceStoryRules",
		"listStoryRules",
		"insertLoreEntries",
		"listLoreEntries",
		"saveImportAuditEntries",
		"listImportAuditEntries",
		"setImportAuditEntryKind",
		"listImportAuditInjectionRules",
		"setImportAuditEntryMemory",
		"convertImportAuditPluginResidueToMemory",
		"saveLorePrefilter",
		"getLorePrefilter",
	],
	turns: [
		"saveContextPack",
		"getContextPack",
		"clearContextPacks",
		"saveTurnTrace",
		"getTurnTrace",
		"startTurnRun",
		"getTurnRun",
		"getTurnRunForNode",
		"listTurnRuns",
		"appendTurnRunEvent",
		"listTurnRunEvents",
		"countTurnRunEvents",
		"finishTurnRun",
		"markInterruptedTurnRuns",
	],
	assistant: [
		"createAssistantConversation",
		"getAssistantConversation",
		"listAssistantConversations",
		"searchAssistantConversations",
		"getAssistantMessages",
		"createAssistantCompaction",
		"getAssistantCompaction",
		"listAssistantCompactions",
		"appendAssistantMessage",
		"updateAssistantConversation",
		"setAssistantConversationStatus",
		"startAssistantConversationRun",
		"finishAssistantConversationRun",
		"markInterruptedAssistantConversations",
		"deleteAssistantConversation",
		"appendAssistantEvent",
		"listAssistantEvents",
		"countAssistantEvents",
		"createAssistantAction",
		"getAssistantAction",
		"listAssistantActions",
		"countPendingAssistantActions",
		"setAssistantActionDecision",
	],
	background: [
		"enqueueMissingBackgroundJobs",
		"enqueueStoryBackgroundJobs",
		"countBackgroundJobs",
		"getBackgroundJob",
		"listBackgroundJobs",
		"requeueRunningBackgroundJobs",
		"startBackgroundJob",
		"addBackgroundJobUsage",
		"finishBackgroundJob",
		"failBackgroundJob",
		"deferBackgroundJob",
		"discardBackgroundJob",
	],
	canon: [
		"createCanonBook",
		"listCanonBooks",
		"getCanonBook",
		"listCanonChapters",
		"listCanonChapterRecords",
		"getCanonChapter",
		"updateCanonChapter",
		"mergeCanonChapterWithNext",
		"splitCanonChapter",
		"deleteCanonBook",
		"getCanonExtraction",
		"ensureCanonExtraction",
		"markCanonExtractionRunning",
		"pauseCanonExtraction",
		"finishCanonExtraction",
		"addCanonExtractionUsage",
		"refreshCanonExtraction",
		"markInterruptedCanonExtractions",
		"ensureCanonChapterExtraction",
		"getCanonChapterExtraction",
		"listCanonChapterExtractions",
		"setCanonChapterExtraction",
		"resetCanonChapterExtraction",
		"clearCanonChapterResults",
		"insertCanonChunkResults",
		"listCanonEntities",
		"upsertCanonEntities",
		"replaceCanonEntities",
		"listCanonEvents",
		"listCanonTimeline",
		"listCanonVoices",
		"listCanonFacts",
		"getCanonCompilation",
		"ensureCanonCompilation",
		"markCanonCompilationRunning",
		"addCanonCompilationUsage",
		"finishCanonCompilation",
		"markInterruptedCanonCompilations",
		"listCanonCompiledEntities",
		"replaceCanonCompiledEntities",
		"applyCanonEntityMerges",
		"applyCanonEventTimeline",
		"importCanonPackage",
	],
};

// 公开方法装到原型上，转给对应的领域仓储；签名由上面的接口合并给出。
for (const [repo, names] of Object.entries(DELEGATES) as [
	keyof Repos,
	readonly string[],
][]) {
	for (const name of names) {
		Object.defineProperty(StoryStore.prototype, name, {
			configurable: true,
			writable: true,
			value(this: StoryStore, ...args: unknown[]): unknown {
				const target = this[REPOS][repo] as unknown as Record<
					string,
					(...values: unknown[]) => unknown
				>;
				const method = target[name];
				if (method === undefined)
					throw new Error(`StoryStore 没有方法 ${name}`);
				return method.apply(target, args);
			},
		});
	}
}

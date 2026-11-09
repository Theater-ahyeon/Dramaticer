import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	type EmbeddingClient,
	type LlmCallOptions,
	type LlmRequest,
	type LlmResult,
	type LlmStream,
	type LlmStreamingClient,
	type StoryStore,
	StoryStore as StoryStoreClass,
	createEventExtractionHandler,
} from "@dramaticer/core";
import { importChatFileToStore } from "../chat-import.js";
import {
	type Snapshot,
	type SnapshotManifestFile,
	isLegacyCorpus,
	openSnapshot,
} from "../health/manifest.js";
import {
	buildStoryVectors,
	countStoryChunks,
	countStoryEvents,
	countStoryVectors,
	importStoryEntities,
	measureEventCoverage,
} from "./memory-eval.js";
import { storyIdOf } from "./question-files.js";

/** 与后台任务框架一致：一个窗口连续失败 3 次才终止整批。 */
const WINDOW_ATTEMPTS = 3;

export interface EventsBackfillProgress {
	readonly story: string;
	/** 本次运行处理到第几个窗口，从 1 开始；续跑时从已有抽取记录之后继续。 */
	readonly window: number;
	/** 这个窗口写入了多少个助手楼层的抽取记录。 */
	readonly floors: number;
	/** 本次运行累计写入抽取记录的楼层数。 */
	readonly totalFloors: number;
	/** 本次运行累计抽取到的事件数。 */
	readonly events: number;
	/** 本次运行发出的模型请求数（不含缓存命中）。 */
	readonly requests: number;
	readonly cachedRequests: number;
}

export interface EventsBackfillStoryResult {
	readonly story: string;
	readonly imported: boolean;
	readonly floorCount: number;
	readonly chunkCount: number;
	readonly vectorCount: number;
	readonly entityCount: number;
	readonly windowCount: number;
	readonly extractedFloors: number;
	readonly eventCount: number;
	/** 主路径已确认助手楼层数。 */
	readonly assistantFloors: number;
	/** 至少有一条事件的已确认助手楼层数。 */
	readonly floorsWithEvents: number;
}

export interface EventsBackfillOptions {
	readonly rawRoot: string;
	readonly dbPath: string;
	readonly client: LlmStreamingClient;
	readonly embedder: EmbeddingClient;
	/** 只处理这一个故事；不设置时处理 manifest 里全部 legacy 对话。 */
	readonly story?: string | null;
	/** 本次运行最多处理多少个窗口，跨故事累计；不设置表示不限。 */
	readonly maxWindows?: number | null;
	readonly onProgress?: (progress: EventsBackfillProgress) => void;
	readonly log?: (message: string) => void;
}

export interface EventsBackfillResult {
	readonly stories: readonly EventsBackfillStoryResult[];
	readonly windowCount: number;
	readonly extractedFloors: number;
	readonly eventCount: number;
	readonly requests: number;
	readonly cachedRequests: number;
	/** 因为达到 `maxWindows` 而停下，后面还有未抽取的楼层。 */
	readonly stoppedEarly: boolean;
}

/** 每个故事在 manifest 里的对话文件与它的故事 id。 */
export interface EventsBackfillTarget {
	readonly file: SnapshotManifestFile;
	readonly story: string;
}

/**
 * 把 legacy 评测对话导入指定数据库（已导入的故事跳过），补齐实体、lore、
 * 块向量，然后按路径窗口批量抽取事件。数据库跨运行保留，已完成窗口不会被重复请求。
 */
export async function runEventsBackfill(
	options: EventsBackfillOptions,
): Promise<EventsBackfillResult> {
	const maxWindows = normalizeMaxWindows(options.maxWindows ?? null);
	const log = options.log ?? (() => undefined);
	const snapshot = await openSnapshot(options.rawRoot);
	const targets = selectTargets(snapshot, options.story ?? null);
	await mkdir(path.dirname(options.dbPath), { recursive: true });
	const store = StoryStoreClass.open(options.dbPath, {
		embeddingDimensions: options.embedder.dimensions,
	});
	const counted = countClient(options.client);
	const stories: EventsBackfillStoryResult[] = [];
	let windowCount = 0;
	let extractedFloors = 0;
	let stoppedEarly = false;
	try {
		for (const target of targets) {
			if (maxWindows !== null && windowCount >= maxWindows) {
				stoppedEarly = true;
				break;
			}
			const imported = store.getStory(target.story) === null;
			if (imported) {
				log(`导入 ${target.story}`);
				await importChatFileToStore(
					store,
					await snapshot.resolveFile(target.file),
					{ storyId: target.story },
				);
				await importStoryEntities(
					store,
					target.story,
					snapshot,
					target.file.character ?? target.story,
				);
			}
			const vectors = await buildStoryVectors({
				store,
				storyId: target.story,
				embedder: options.embedder,
			});
			const extraction = await extractStoryWindows({
				store,
				storyId: target.story,
				client: counted.client,
				limit:
					maxWindows === null ? null : Math.max(0, maxWindows - windowCount),
				onProgress: (progress) =>
					options.onProgress?.({
						...progress,
						story: target.story,
						window: windowCount + progress.window,
						totalFloors: extractedFloors + progress.totalFloors,
						requests: counted.stats.requests,
						cachedRequests: counted.stats.cachedRequests,
					}),
			});
			windowCount += extraction.windowCount;
			extractedFloors += extraction.extractedFloors;
			stoppedEarly = extraction.stoppedEarly;
			const coverage = measureEventCoverage(store, target.story);
			stories.push({
				story: target.story,
				imported,
				floorCount: store.getPathToHead(target.story).length,
				chunkCount: countStoryChunks(store, target.story),
				vectorCount: countStoryVectors(store, target.story),
				entityCount: store.listEntities(target.story).length,
				windowCount: extraction.windowCount,
				extractedFloors: extraction.extractedFloors,
				eventCount: countStoryEvents(store, target.story),
				assistantFloors: coverage.assistantFloors,
				floorsWithEvents: coverage.floorsWithEvents,
			});
			log(
				`${target.story} 完成：${extraction.windowCount} 个窗口，${extraction.extractedFloors} 个楼层，${countStoryEvents(store, target.story)} 条事件，事件覆盖 ${coverage.floorsWithEvents}/${coverage.assistantFloors}，向量 ${vectors.vectorCount}/${vectors.chunkCount}`,
			);
			if (stoppedEarly) break;
		}
		return {
			stories,
			windowCount,
			extractedFloors,
			eventCount: stories.reduce((sum, story) => sum + story.eventCount, 0),
			requests: counted.stats.requests,
			cachedRequests: counted.stats.cachedRequests,
			stoppedEarly,
		};
	} finally {
		store.close();
	}
}

/** manifest 里的 legacy 对话；`story` 不设置时返回全部，重名直接抛错。 */
export function selectTargets(
	snapshot: Snapshot,
	story: string | null,
): EventsBackfillTarget[] {
	const files = snapshot
		.filesByRole("chat")
		.filter(isLegacyCorpus)
		.filter((file) => story === null || storyIdOf(file) === story);
	if (files.length === 0) {
		throw new Error(
			story === null
				? "manifest 里没有 legacy 对话"
				: `manifest 里没有故事 ${story}`,
		);
	}
	const seen = new Set<string>();
	return files.map((file) => {
		const id = storyIdOf(file);
		if (seen.has(id)) throw new Error(`manifest 里出现了重复的故事名 ${id}`);
		seen.add(id);
		return { file, story: id };
	});
}

interface ExtractStoryWindowsOptions {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly client: LlmStreamingClient;
	readonly limit: number | null;
	readonly onProgress?: (progress: {
		readonly window: number;
		readonly floors: number;
		readonly totalFloors: number;
		readonly events: number;
	}) => void;
}

/**
 * 反复调用生产的事件抽取处理器，直到当前路径上再没有未抽取的已确认助手楼层。
 * 每个窗口写入抽取记录后才推进，因此中断后重跑会从下一个窗口继续。
 */
async function extractStoryWindows(
	options: ExtractStoryWindowsOptions,
): Promise<{
	readonly windowCount: number;
	readonly extractedFloors: number;
	readonly stoppedEarly: boolean;
}> {
	let windowCount = 0;
	let extractedFloors = 0;
	for (;;) {
		const extracted = new Set(
			options.store.listExtractedEventNodeIds(options.storyId),
		);
		const pending = pendingAssistantFloors(
			options.store,
			options.storyId,
			extracted,
		);
		if (pending.length === 0) {
			return { windowCount, extractedFloors, stoppedEarly: false };
		}
		if (options.limit !== null && windowCount >= options.limit) {
			return { windowCount, extractedFloors, stoppedEarly: true };
		}
		const head = pending[0];
		if (head === undefined) throw new Error("待抽取楼层列表为空");
		await runWindow({
			store: options.store,
			storyId: options.storyId,
			client: options.client,
			first: head,
		});
		const after = new Set(
			options.store.listExtractedEventNodeIds(options.storyId),
		);
		const written = pending.filter((floor) => after.has(floor.id));
		if (written.length === 0) {
			throw new Error(
				`故事 ${options.storyId} 的抽取窗口没有写入任何楼层，无法继续`,
			);
		}
		windowCount += 1;
		extractedFloors += written.length;
		options.onProgress?.({
			window: windowCount,
			floors: written.length,
			totalFloors: extractedFloors,
			events: countStoryEvents(options.store, options.storyId),
		});
	}
}

async function runWindow(input: {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly client: LlmStreamingClient;
	readonly first: { readonly id: string; readonly createdAt: string };
}): Promise<void> {
	const handler = createEventExtractionHandler();
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= WINDOW_ATTEMPTS; attempt += 1) {
		try {
			await handler({
				store: input.store,
				client: input.client,
				job: {
					id: 0,
					storyId: input.storyId,
					nodeId: input.first.id,
					kind: "events",
					status: "running",
					attempts: attempt,
					lastError: null,
					createdAt: input.first.createdAt,
					startedAt: null,
					finishedAt: null,
				},
			});
			return;
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error(
		`故事 ${input.storyId} 的事件抽取窗口连续失败 ${WINDOW_ATTEMPTS} 次`,
		{ cause: lastError },
	);
}

/** 当前路径上尚未抽取的已确认助手楼层，按时间顺序。 */
function pendingAssistantFloors(
	store: StoryStore,
	storyId: string,
	extracted: ReadonlySet<string>,
): { readonly id: string; readonly createdAt: string }[] {
	const pathNodes = store.getPathToHead(storyId);
	const pending: { readonly id: string; readonly createdAt: string }[] = [];
	for (let index = 0; index < pathNodes.length; index += 1) {
		const node = pathNodes[index];
		if (node === undefined || node.role !== "assistant") continue;
		const confirmed =
			index < pathNodes.length - 1 || store.isNodeConfirmed(node.id);
		if (confirmed && !extracted.has(node.id)) {
			pending.push({ id: node.id, createdAt: node.createdAt });
		}
	}
	return pending;
}

function normalizeMaxWindows(value: number | null): number | null {
	if (value === null) return null;
	if (!Number.isInteger(value) || value < 1) {
		throw new Error("窗口上限必须是不小于 1 的整数");
	}
	return value;
}

interface CountedClient {
	readonly client: LlmStreamingClient;
	readonly stats: { requests: number; cachedRequests: number };
}

/** 累计真实发出的请求数与缓存命中数；缓存命中不算一次模型请求。 */
function countClient(inner: LlmStreamingClient): CountedClient {
	const stats = { requests: 0, cachedRequests: 0 };
	const client: LlmStreamingClient = {
		async complete(
			request: LlmRequest,
			options?: LlmCallOptions,
		): Promise<LlmResult> {
			const result = await inner.complete(request, options);
			if (result.cached) stats.cachedRequests += 1;
			else stats.requests += 1;
			return result;
		},
		stream(request: LlmRequest, options?: LlmCallOptions): LlmStream {
			return inner.stream(request, options);
		},
	};
	return { client, stats };
}

// server 路由：故事、导入、楼层树与路径、实体、设定、后台任务、连载（refactor/06 从 routes.ts 拆出）。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	ILLUSTRATE_JOB_KIND,
	ONE_TIME_JOB_KINDS,
	type StateDiff,
	type Story,
	type StoryStore,
	type TimelineNode,
	enqueueOpeningBackgroundJobs,
	enqueueVisualProfileBackgroundJob,
	exportSerialBook,
	fulfillLedgerClue,
	isJsonObject,
	listLedgerEntities,
	readLedger,
	readSerialView,
} from "@dramaticer/core";
import type {
	CreateStoryFromCardRequest,
	CreateStoryRequest,
	FulfillClueResult,
	ImportCharacterCard,
	ImportStoryRequest,
	ImportStoryResult,
	NodeImage,
	StoryBookExport,
	StoryCluesView,
	StoryEntitiesView,
	StoryJobErrorView,
	StoryJobsView,
	StoryLoreView,
	StoryPath,
	StorySerialView,
	StoryTree,
	StoryTreeNode,
	StoryView,
} from "@dramaticer/protocol";
import {
	type ImportedCardContent,
	type StCharacterCard,
	importCardContent,
	parseCharacterCardJson,
	parseCharacterCardPng,
	parseWorldInfoJson,
} from "@dramaticer/st-compat";
import { HttpError, sendJson } from "./http.js";
import { afterCardImport } from "./routes-card.js";

/** 大图角色卡（40–90 MB PNG 经 base64 编码后约 55–120 MB）单独放宽请求体上限。 */
export const CARD_IMPORT_MAX_BODY_BYTES = 128 * 1024 * 1024;
import {
	assertKnownKeys,
	fieldError,
	queryInteger,
	readObjectBody,
	requireMethod,
	requireObject,
	requireStory,
	requireStoryNode,
	requireText,
	toBadRequest,
} from "./routes-common.js";
import { toNodeImage } from "./routes-media.js";
import type { ApiRouteOptions } from "./routes.js";
import { saveImportedCardMedia } from "./story-media.js";

export async function handleStories(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	requireMethod(method, ["GET", "POST"]);
	if (method === "GET") {
		sendJson(
			res,
			200,
			options.store
				.listStories()
				.map((story) => toStoryView(story, options.store)),
		);
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["id", "title"]);
	if (body.id !== undefined) {
		if (typeof body.id !== "string" || body.id.trim().length === 0) {
			throw fieldError("id", "故事 id 必须是非空字符串");
		}
		if (options.store.getStory(body.id) !== null) {
			throw new HttpError(409, "conflict", `故事已存在：${body.id}`, {
				path: "id",
			});
		}
	}
	const request: CreateStoryRequest = {
		...(typeof body.id === "string" ? { id: body.id } : {}),
		title: requireText(body.title, "title"),
	};
	const story = options.store.createStory(request);
	enqueueOpeningBackgroundJobs(options.store, story.id);
	enqueueVisualProfileBackgroundJob(options.store, story.id);
	options.scheduler?.schedule(story.id);
	sendJson(res, 201, toStoryView(story, options.store));
}

export async function handleStory(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireMethod(method, ["GET", "PATCH"]);
	const story = requireStory(options.store, storyId);
	if (method === "GET") {
		sendJson(res, 200, toStoryView(story, options.store));
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["title"]);
	if (body.title === undefined) {
		throw fieldError("title", "更新故事至少要提供 title");
	}
	const title = requireText(body.title, "title");
	const saved = options.store.updateStoryTitle(story.id, title);
	sendJson(res, 200, toStoryView(saved, options.store));
}

function parseCardAndWorlds(request: ImportStoryRequest): {
	readonly parsedCard: StCharacterCard;
	readonly cardBytes: Uint8Array | null;
	readonly parsedWorlds: ReturnType<typeof parseWorldInfoJson>[];
} {
	let parsedCard: StCharacterCard;
	let cardBytes: Uint8Array | null = null;
	try {
		if (request.card.format === "png") {
			cardBytes = decodePngBase64(request.card.data);
			parsedCard = parseCharacterCardPng(cardBytes);
		} else {
			parsedCard = parseCharacterCardJson(request.card.data);
		}
	} catch (error) {
		throw toBadRequest(error, "card");
	}
	const parsedWorlds =
		request.worlds?.map((text, index) => {
			try {
				return parseWorldInfoJson(text);
			} catch (error) {
				throw toBadRequest(error, `worlds[${index}]`);
			}
		}) ?? [];
	return { parsedCard, cardBytes, parsedWorlds };
}

async function applyImportInTransaction(
	options: ApiRouteOptions,
	storyId: string,
	request: ImportStoryRequest,
	parsed: ReturnType<typeof parseCardAndWorlds>,
): Promise<ImportedCardContent> {
	let imported: ImportedCardContent;
	try {
		imported = await options.store.runInTransaction(async () => {
			const result = importCardContent(options.store, storyId, {
				card: parsed.parsedCard,
				worlds: parsed.parsedWorlds,
			});
			options.store.updateStorySettings(storyId, {
				cardName: result.cardName,
				characterPrompt: result.characterPrompt,
			});
			await saveImportedCardMedia({
				store: options.store,
				storyId,
				mediaDir: options.imagesMediaDir,
				cardName: parsed.parsedCard.name,
				pngBytes: parsed.cardBytes,
			});
			return result;
		});
	} catch (error) {
		throw toBadRequest(error, "card");
	}
	afterCardImport(options.store, storyId, parsed.parsedCard, request.card.data);
	enqueueOpeningBackgroundJobs(options.store, storyId);
	enqueueVisualProfileBackgroundJob(options.store, storyId);
	options.scheduler?.schedule(storyId);
	return imported;
}

export async function handleCreateFromCard(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	requireMethod(method, ["POST"]);
	const body = await readObjectBody(
		req,
		Math.max(options.maxJsonBodyBytes, CARD_IMPORT_MAX_BODY_BYTES),
	);
	assertKnownKeys(body, ["title", "card", "worlds"]);
	const customTitle =
		typeof body.title === "string" && body.title.trim().length > 0
			? body.title.trim()
			: null;
	if (body.title !== undefined && typeof body.title !== "string") {
		throw fieldError("title", "title 必须是字符串");
	}
	const card = parseCardPayload(body.card);
	const worlds = parseWorldPayload(body.worlds);
	const request: CreateStoryFromCardRequest = {
		...(customTitle === null ? {} : { title: customTitle }),
		card,
		worlds,
	};
	const parsed = parseCardAndWorlds(request);
	const initialTitle =
		customTitle ??
		(parsed.parsedCard.name.trim().length > 0
			? parsed.parsedCard.name.trim()
			: "新故事");
	let storyId = "";
	let imported: ImportedCardContent;
	try {
		imported = await options.store.runInTransaction(async () => {
			const created = options.store.createStory({ title: initialTitle });
			storyId = created.id;
			const result = importCardContent(options.store, storyId, {
				card: parsed.parsedCard,
				worlds: parsed.parsedWorlds,
			});
			const finalTitle =
				customTitle ??
				(result.cardName.trim().length > 0
					? result.cardName.trim()
					: initialTitle);
			if (finalTitle !== initialTitle) {
				options.store.updateStoryTitle(storyId, finalTitle);
			}
			options.store.updateStorySettings(storyId, {
				cardName: result.cardName,
				characterPrompt: result.characterPrompt,
			});
			await saveImportedCardMedia({
				store: options.store,
				storyId,
				mediaDir: options.imagesMediaDir,
				cardName: parsed.parsedCard.name,
				pngBytes: parsed.cardBytes,
			});
			return result;
		});
	} catch (error) {
		throw toBadRequest(error, "card");
	}
	afterCardImport(options.store, storyId, parsed.parsedCard, request.card.data);
	enqueueOpeningBackgroundJobs(options.store, storyId);
	enqueueVisualProfileBackgroundJob(options.store, storyId);
	options.scheduler?.schedule(storyId);
	const result: ImportStoryResult = {
		story: toStoryView(requireStory(options.store, storyId), options.store),
		cardName: imported.cardName,
		settings: options.store.getStorySettings(storyId),
		imported: {
			entities: imported.entities,
			lore: imported.lore,
			events: imported.events,
			npcAgendas: imported.npcAgendas,
			bits: imported.bits,
			rules: imported.rules,
			dependencies: imported.dependencies,
		},
	};
	sendJson(res, 201, result);
}

export async function handleImport(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireMethod(method, ["POST"]);
	requireStory(options.store, storyId);
	const body = await readObjectBody(
		req,
		Math.max(options.maxJsonBodyBytes, CARD_IMPORT_MAX_BODY_BYTES),
	);
	assertKnownKeys(body, ["card", "worlds"]);
	const card = parseCardPayload(body.card);
	const worlds = parseWorldPayload(body.worlds);
	const request: ImportStoryRequest = { card, worlds };
	const parsed = parseCardAndWorlds(request);
	const imported = await applyImportInTransaction(
		options,
		storyId,
		request,
		parsed,
	);
	const result: ImportStoryResult = {
		story: toStoryView(requireStory(options.store, storyId), options.store),
		cardName: imported.cardName,
		settings: options.store.getStorySettings(storyId),
		imported: {
			entities: imported.entities,
			lore: imported.lore,
			events: imported.events,
			npcAgendas: imported.npcAgendas,
			bits: imported.bits,
			rules: imported.rules,
			dependencies: imported.dependencies,
		},
	};
	sendJson(res, 200, result);
}

export function handleJobs(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const counts = options.store.countBackgroundJobs({ storyId });
	const jobs = options.store.listBackgroundJobs({ storyId });
	const calls = {
		perFloor: 0,
		oneTime: 0,
		images: 0,
		floors: 0,
		perFloorTokens: 0,
		oneTimeTokens: 0,
	};
	for (const job of jobs) {
		const count = job.llmCalls ?? 0;
		const tokens = job.llmTokens ?? 0;
		if (job.kind === ILLUSTRATE_JOB_KIND) calls.images += count;
		else if (ONE_TIME_JOB_KINDS.includes(job.kind)) {
			calls.oneTime += count;
			calls.oneTimeTokens += tokens;
		} else {
			calls.perFloor += count;
			calls.perFloorTokens += tokens;
		}
	}
	calls.floors = options.store
		.listStoryNodes(storyId)
		.filter((node) => node.role === "assistant").length;
	const recentErrors: StoryJobErrorView[] = jobs
		.filter((job) => job.lastError !== null)
		.sort((left, right) => {
			const byTime = errorTime(right).localeCompare(errorTime(left));
			return byTime === 0 ? right.id - left.id : byTime;
		})
		.slice(0, 5)
		.map((job) => ({
			jobId: job.id,
			nodeId: job.nodeId,
			kind: job.kind,
			status: job.status,
			attempts: job.attempts,
			error: job.lastError ?? "",
			recordedAt: errorTime(job),
		}));
	const view: StoryJobsView = { storyId, counts, recentErrors, calls };
	sendJson(res, 200, view);
}

export function errorTime(job: {
	readonly createdAt: string;
	readonly startedAt: string | null;
	readonly finishedAt: string | null;
}): string {
	return job.finishedAt ?? job.startedAt ?? job.createdAt;
}

export function handleTree(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const nodes = options.store.listStoryNodes(storyId);
	const childIds = new Map<string, string[]>();
	const roots: string[] = [];
	for (const node of nodes) {
		if (node.parentId === null) {
			roots.push(node.id);
			continue;
		}
		const children = childIds.get(node.parentId);
		if (children === undefined) childIds.set(node.parentId, [node.id]);
		else children.push(node.id);
	}
	const view: StoryTree = {
		storyId,
		headNodeId: options.store.getHead(storyId)?.id ?? null,
		roots,
		nodes: nodes.map(
			(node): StoryTreeNode => ({
				id: node.id,
				parentId: node.parentId,
				role: node.role,
				createdAt: node.createdAt,
				preview: treePreview(node.raw),
				childIds: childIds.get(node.id) ?? [],
			}),
		),
	};
	sendJson(res, 200, view);
}

/** 树里只显示一段可读的开头，完整原文从路径接口按需读取。 */
export function treePreview(raw: string): string {
	return raw.replace(/\s+/g, " ").trim().slice(0, 80);
}

export const PATH_DEFAULT_LIMIT = 60;

export const PATH_MAX_LIMIT = 200;

/**
 * 路径接口按页读取：`nodeId` 是锚点，缺省 head；只裁掉更早的楼层，
 * `before` 指向上一页最早那层，取它之前的一页。
 */
export function handlePath(
	res: ServerResponse,
	options: ApiRouteOptions,
	url: URL,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const limit =
		queryInteger(url, "limit", 1, PATH_MAX_LIMIT) ?? PATH_DEFAULT_LIMIT;
	const nodeId = url.searchParams.get("nodeId");
	const anchor =
		nodeId === null
			? options.store.getPathToHead(storyId)
			: options.store.getPathToNode(
					requireStoryNode(options.store, storyId, nodeId).id,
				);
	const before = url.searchParams.get("before");
	let pageEnd = anchor.length;
	if (before !== null) {
		const beforeNode = requireStoryNode(options.store, storyId, before);
		const index = anchor.findIndex((node) => node.id === beforeNode.id);
		if (index < 0) {
			throw new HttpError(
				404,
				"not_found",
				`楼层节点不在锚点路径上：${before}`,
			);
		}
		pageEnd = index;
	}
	const pageStart = Math.max(0, pageEnd - limit);
	const view: StoryPath = {
		storyId,
		headNodeId: options.store.getHead(storyId)?.id ?? null,
		nodes: toPathNodes(options.store, anchor.slice(pageStart, pageEnd)),
		hasMore: pageStart > 0,
	};
	sendJson(res, 200, view);
}

export async function handleHead(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["nodeId"]);
	const node = requireStoryNode(
		options.store,
		storyId,
		requireText(body.nodeId, "nodeId"),
	);
	options.store.setHead(storyId, node.id);
	sendJson(
		res,
		200,
		buildPath(options.store, storyId, options.store.getPathToNode(node.id)),
	);
}

export function handleStoryClues(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const head = options.store.getHead(storyId);
	const view: StoryCluesView = {
		storyId,
		headNodeId: head?.id ?? null,
		clues:
			head === null ? [] : listLedgerEntities(options.store, head.id).openClues,
	};
	sendJson(res, 200, view);
}

/**
 * 连载视图。`nodeId` 省略时取当前 head；指定时只接受同一个故事的楼层，
 * 分支回看与当前路径读的是同一套派生。
 */
export function handleStorySerial(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	url: URL,
): void {
	requireStory(options.store, storyId);
	const raw = url.searchParams.get("nodeId");
	let nodeId: string | undefined;
	if (raw !== null) {
		if (raw.length === 0) {
			throw fieldError("nodeId", "nodeId 不能为空");
		}
		requireStoryNode(options.store, storyId, raw);
		nodeId = raw;
	}
	const view: StorySerialView = readSerialView(
		options.store,
		storyId,
		nodeId === undefined ? {} : { nodeId },
	);
	sendJson(res, 200, view);
}

/**
 * `GET /api/stories/:id/serial/export`：按章节目录导出当前路径的 Markdown。
 * 正文逐字取楼层原文，只拼接派生标题与已归档场次摘要。
 */
export function handleStorySerialExport(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	url: URL,
): void {
	requireStory(options.store, storyId);
	const raw = url.searchParams.get("nodeId");
	let nodeId: string | undefined;
	if (raw !== null) {
		if (raw.length === 0) {
			throw fieldError("nodeId", "nodeId 不能为空");
		}
		requireStoryNode(options.store, storyId, raw);
		nodeId = raw;
	}
	const book: StoryBookExport = exportSerialBook(
		options.store,
		storyId,
		nodeId === undefined ? {} : { nodeId },
	);
	sendJson(res, 200, book);
}

export async function handleClueFulfill(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	clueId: string,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["storyId"]);
	const storyId = requireText(body.storyId, "storyId");
	requireStory(options.store, storyId);
	const head = options.store.getHead(storyId);
	if (head === null) {
		throw new HttpError(
			409,
			"conflict",
			`故事 ${storyId} 还没有楼层，不能兑现线索`,
		);
	}
	const clue = readLedger(options.store, head.id, ["clue", clueId]);
	if (clue === undefined) {
		throw new HttpError(404, "not_found", `线索不存在：${clueId}`);
	}
	if (isJsonObject(clue) && clue.status === "fulfilled") {
		throw new HttpError(409, "conflict", `线索已经兑现：${clueId}`);
	}
	let diffs: StateDiff[];
	try {
		diffs = await fulfillLedgerClue(options.store, storyId, clueId);
	} catch (error) {
		if (error instanceof Error && error.message.includes("已经兑现")) {
			throw new HttpError(409, "conflict", error.message);
		}
		throw toBadRequest(error, "clueId");
	}
	const view: FulfillClueResult = {
		storyId,
		clueId,
		headNodeId: head.id,
		diffs,
	};
	sendJson(res, 200, view);
}

export function handleEntities(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: StoryEntitiesView = {
		storyId,
		entities: options.store.listEntities(storyId),
	};
	sendJson(res, 200, view);
}

export function handleLore(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: StoryLoreView = {
		storyId,
		entries: options.store.listLoreEntries(storyId),
	};
	sendJson(res, 200, view);
}

export function buildPath(
	store: StoryStore,
	storyId: string,
	nodes: readonly TimelineNode[],
): StoryPath {
	return {
		storyId,
		headNodeId: store.getHead(storyId)?.id ?? null,
		nodes: toPathNodes(store, nodes),
		hasMore: false,
	};
}

/** 路径楼层带上附属图片；一次查询覆盖整页，图片按 `ordinal` 排序。 */
export function toPathNodes(
	store: StoryStore,
	nodes: readonly TimelineNode[],
): StoryPath["nodes"] {
	const grouped = new Map<string, NodeImage[]>();
	for (const record of store.listNodeImagesForNodes(
		nodes.map((node) => node.id),
	)) {
		const list = grouped.get(record.nodeId);
		const view = toNodeImage(record);
		if (list === undefined) grouped.set(record.nodeId, [view]);
		else list.push(view);
	}
	return nodes.map((node) => ({
		...node,
		images: grouped.get(node.id) ?? [],
	}));
}

export function parseCardPayload(value: unknown): ImportCharacterCard {
	const body = requireObject(value, "card");
	assertKnownKeys(body, ["format", "data"], "card");
	if (body.format !== "png" && body.format !== "json") {
		throw fieldError("card.format", 'card.format 必须是 "png" 或 "json"');
	}
	const data = requireText(body.data, "card.data");
	return body.format === "png"
		? { format: "png", data }
		: { format: "json", data };
}

export function parseWorldPayload(value: unknown): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw fieldError("worlds", "worlds 必须是字符串数组");
	}
	return value.map((item, index) => requireText(item, `worlds[${index}]`));
}

export function decodePngBase64(data: string): Uint8Array {
	const compact = data.replace(/\s+/g, "");
	if (
		compact.length === 0 ||
		compact.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
	) {
		throw fieldError("card.data", "card.data 不是合法的 base64");
	}
	return new Uint8Array(Buffer.from(compact, "base64"));
}

export function toStoryView(story: Story, store: StoryStore): StoryView {
	const head = store.getHead(story.id);
	return {
		id: story.id,
		title: story.title,
		createdAt: story.createdAt,
		headNodeId: head?.id ?? null,
	};
}

// server 路由：原著书与分章原文（canon/01）。
// 导入的 txt 可以到几十 MB，这个路由的请求体上限单独放宽。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type CanonChapterKind,
	type CanonChapterRecord,
	type CanonChapterSplitResult,
	type CanonCursorRecord,
	type CanonPackage,
	type CanonPackageImportResult,
	type CanonStartResult,
	type NewCanonChapter,
	beginCanonExtraction,
	buildCanonStartingPages,
	buildCanonWorldIndex,
	canonBookTitle,
	canonPackageFilename,
	decodeCanonBytes,
	estimateCanonExtraction,
	exportCanonPackage,
	importCanonPackage,
	isCanonChapterKind,
	isCanonIdentityKind,
	isCanonWindowMode,
	isJsonObject,
	resolveCanonCursor,
	setCanonAllowFullBookSpoilers,
	setCanonPendingAdvance,
	setCanonWindowMode,
	splitCanonText,
	startCanonFromHere,
	startCanonStory,
} from "@dramaticer/core";
import type {
	CanonBookDetailView,
	CanonBooksView,
	CanonChapterDetailView,
	CanonChapterExtractRequest,
	CanonChapterUpdateRequest,
	CanonCompiledView,
	CanonEstimateView,
	CanonExtractionOverviewView,
	CanonExtractionView,
	ImportCanonBookResult,
	ImportCanonPackageResult,
	StartCanonStoryResult,
	StoryCanonBindingView,
	StoryCanonView,
} from "@dramaticer/protocol";
import {
	type StCharacterCard,
	importCardContent,
	parseCharacterCardJson,
	parseCharacterCardPng,
	parseWorldInfoJson,
} from "@dramaticer/st-compat";
import { HttpError, readJsonBody, sendEmpty, sendJson } from "./http.js";
import { afterCardImport } from "./routes-card.js";
import {
	assertKnownKeys,
	fieldError,
	pathSegments,
	queryInteger,
	readObjectBody,
	requireMethod,
	requireStory,
	requireText,
	toBadRequest,
} from "./routes-common.js";
import {
	decodePngBase64,
	parseCardPayload,
	parseWorldPayload,
	toStoryView,
} from "./routes-stories.js";
import type { ApiRouteOptions } from "./routes.js";
import { saveImportedCardMedia } from "./story-media.js";

/** 32 MB 的 txt 经 base64 是 43 MB，留出余量。 */
export const CANON_IMPORT_MAX_BODY_BYTES = 48 * 1024 * 1024;

function requireCanonBook(options: ApiRouteOptions, bookId: string) {
	const book = options.store.getCanonBook(bookId);
	if (book === null) {
		throw new HttpError(404, "not_found", `原著不存在：${bookId}`);
	}
	return book;
}

function requireCanonChapter(
	options: ApiRouteOptions,
	bookId: string,
	chapterId: string,
) {
	const chapter = options.store.getCanonChapter(bookId, chapterId);
	if (chapter === null) {
		throw new HttpError(404, "not_found", `章节不存在：${chapterId}`);
	}
	return chapter;
}

function decodeCanonBase64(value: string): Uint8Array {
	const compact = value.replace(/^data:[^,]*,/, "").replace(/\s/g, "");
	if (compact.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
		throw fieldError("dataBase64", "dataBase64 不是合法的 base64");
	}
	const bytes = Buffer.from(compact, "base64");
	if (bytes.length === 0) {
		throw fieldError("dataBase64", "dataBase64 解码后是空文件");
	}
	return new Uint8Array(bytes);
}

async function importCanonBook(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const body = await readJsonBody(req, CANON_IMPORT_MAX_BODY_BYTES);
	if (!isJsonObject(body)) {
		throw fieldError("body", "请求体必须是 JSON 对象");
	}
	assertKnownKeys(body, ["title", "filename", "dataBase64", "text"]);
	for (const key of ["title", "filename", "dataBase64", "text"] as const) {
		const value = body[key];
		if (value !== undefined && typeof value !== "string") {
			throw fieldError(key, `${key} 必须是字符串`);
		}
	}
	const hasText = typeof body.text === "string" && body.text.trim().length > 0;
	const hasBase64 =
		typeof body.dataBase64 === "string" && body.dataBase64.trim().length > 0;
	if (hasText === hasBase64) {
		throw fieldError("body", "text 与 dataBase64 必须给一个，也只给一个");
	}
	let text: string;
	let encoding: string;
	if (hasText) {
		text = body.text as string;
		encoding = "utf-8";
	} else {
		const bytes = decodeCanonBase64(body.dataBase64 as string);
		try {
			const decoded = decodeCanonBytes(bytes);
			text = decoded.text;
			encoding = decoded.encoding;
		} catch (error) {
			throw toBadRequest(error, "dataBase64");
		}
	}
	const filename =
		typeof body.filename === "string" ? body.filename.trim() || null : null;
	const title = canonBookTitle(
		typeof body.title === "string" ? body.title : null,
		filename,
	);
	let chapters: readonly NewCanonChapter[];
	try {
		chapters = splitCanonText(text);
	} catch (error) {
		throw toBadRequest(error, "text");
	}
	const created = options.store.createCanonBook({
		title,
		filename,
		encoding,
		chapters,
	});
	const result: ImportCanonBookResult = {
		book: created.book,
		chapters: options.store.listCanonChapters(created.book.id),
	};
	sendJson(res, 201, result);
}

function requireCanonWorker(
	options: ApiRouteOptions,
): NonNullable<ApiRouteOptions["canonWorker"]> {
	const worker = options.canonWorker;
	if (worker === null || worker === undefined) {
		throw new HttpError(
			409,
			"conflict",
			"还没有配置模型渠道，不能调用原著的后台模型",
		);
	}
	return worker;
}

function canonExtractionView(
	options: ApiRouteOptions,
	bookId: string,
	chapterId?: string,
): CanonExtractionView {
	const extraction =
		options.store.getCanonExtraction(bookId) ??
		options.store.ensureCanonExtraction(bookId);
	const chapterProgress = new Map(
		options.store
			.listCanonChapterExtractions(bookId)
			.map((item) => [item.chapterId, item]),
	);
	return {
		extraction,
		chapters: options.store.listCanonChapters(bookId).map((chapter) => ({
			chapter,
			extraction: chapterProgress.get(chapter.id) ?? null,
		})),
		events: options.store.listCanonEvents(bookId, { chapterId }),
		voices: options.store.listCanonVoices(bookId, { chapterId }),
		facts: options.store.listCanonFacts(bookId, { chapterId }),
		entities: options.store.listCanonEntities(bookId),
	};
}

function requireCanonCompilation(options: ApiRouteOptions, bookId: string) {
	const compilation = options.store.getCanonCompilation(bookId);
	if (compilation === null) {
		throw new HttpError(409, "conflict", "这本原著还没有汇编任务");
	}
	return compilation;
}

/** 汇编结果；带截止章节时附上防剧透切片后的记事页与世界索引预览。 */
function canonCompiledView(
	options: ApiRouteOptions,
	bookId: string,
	upToChapter?: number,
): CanonCompiledView {
	return {
		compilation: requireCanonCompilation(options, bookId),
		entities: options.store.listCanonCompiledEntities(bookId),
		events: options.store.listCanonEvents(bookId),
		voices: options.store.listCanonVoices(bookId),
		facts: options.store.listCanonFacts(bookId),
		pages:
			upToChapter === undefined
				? null
				: buildCanonStartingPages(options.store, bookId, upToChapter),
		worldIndex:
			upToChapter === undefined
				? null
				: buildCanonWorldIndex(options.store, bookId, upToChapter),
	};
}

/** 当前故事绑定的原著、扮演身份与游标；给前端与 canon/05 用。 */
export function readStoryCanonView(
	options: ApiRouteOptions,
	storyId: string,
): StoryCanonView {
	const binding = options.store.getStoryCanonBinding(storyId);
	if (binding === null) return { bound: null };
	const book = options.store.getCanonBook(binding.bookId);
	const startEvent = options.store
		.listCanonEvents(binding.bookId)
		.find((item) => item.id === binding.startEventId);
	const head = options.store.getHead(storyId);
	const resolved = resolveCanonCursor(options.store, storyId, head?.id ?? null);
	const cursor =
		resolved?.cursor ??
		(head === null ? null : options.store.getCanonCursor(storyId, head.id)) ??
		options.store.getLatestCanonCursor(storyId);
	const timeline = (resolved?.timeline ?? []).map((event, index) => ({
		id: event.id,
		title: event.title,
		summary: event.summary,
		eventOrdinal: index + 1,
		chapterOrdinal: event.chapterOrdinal,
		isTurningPoint: event.isTurningPoint,
	}));
	const view: StoryCanonBindingView = {
		storyId: binding.storyId,
		bookId: binding.bookId,
		bookTitle: book?.title ?? "",
		startEventId: binding.startEventId,
		startEventTitle: startEvent?.title ?? "",
		startChapterOrdinal: binding.startChapterOrdinal,
		identityKind: binding.identityKind,
		playerEntityName: binding.playerEntityName,
		playerPage: binding.playerPage,
		allowFullBookSpoilers: binding.allowFullBookSpoilers,
		windowMode: binding.windowMode,
		pendingAdvance: binding.pendingAdvance,
		createdAt: binding.createdAt,
		cursor,
		currentEvent: resolved?.event ?? startEvent ?? null,
		timeline,
	};
	return { bound: view };
}

function parseIntInRange(
	value: unknown,
	label: string,
	min: number,
	max: number,
): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < min ||
		value > max
	) {
		throw fieldError(label, `${label} 必须是 ${min} 到 ${max} 之间的整数`);
	}
	return value;
}

/** `/api/stories/:id/canon` 与它的子路径：读绑定、改窗口设置、从这里开始、推进 N 件。 */
export async function handleStoryCanonRoute(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const parts = pathSegments(url.pathname);
	const action = parts[3];
	if (action === undefined) {
		requireMethod(method, ["GET"]);
		sendJson(res, 200, readStoryCanonView(options, storyId));
		return;
	}
	if (options.store.getStoryCanonBinding(storyId) === null) {
		throw new HttpError(404, "not_found", "这个故事没有绑定原著");
	}
	if (action === "settings") {
		requireMethod(method, ["PATCH"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, [
			"allowFullBookSpoilers",
			"windowMode",
			"pendingAdvance",
		]);
		if (body.allowFullBookSpoilers !== undefined) {
			if (typeof body.allowFullBookSpoilers !== "boolean") {
				throw fieldError(
					"allowFullBookSpoilers",
					"allowFullBookSpoilers 必须是布尔值",
				);
			}
			setCanonAllowFullBookSpoilers(
				options.store,
				storyId,
				body.allowFullBookSpoilers,
			);
		}
		if (body.windowMode !== undefined) {
			if (!isCanonWindowMode(body.windowMode)) {
				throw fieldError(
					"windowMode",
					"windowMode 只能是 summary_only、summary_voice 或 full_text",
				);
			}
			setCanonWindowMode(options.store, storyId, body.windowMode);
		}
		if (body.pendingAdvance !== undefined) {
			const count = parseIntInRange(
				body.pendingAdvance,
				"pendingAdvance",
				0,
				20,
			);
			setCanonPendingAdvance(options.store, storyId, count);
		}
		sendJson(res, 200, readStoryCanonView(options, storyId));
		return;
	}
	if (action === "advance") {
		requireMethod(method, ["POST"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["count"]);
		const count = parseIntInRange(body.count ?? 1, "count", 1, 20);
		setCanonPendingAdvance(options.store, storyId, count);
		sendJson(res, 200, readStoryCanonView(options, storyId));
		return;
	}
	if (action === "cursor") {
		requireMethod(method, ["POST"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["eventId", "nodeId"]);
		const eventId = parseIntInRange(
			body.eventId,
			"eventId",
			1,
			Number.MAX_SAFE_INTEGER,
		);
		if (body.nodeId !== undefined && typeof body.nodeId !== "string") {
			throw fieldError("nodeId", "nodeId 必须是字符串");
		}
		let cursor: CanonCursorRecord;
		try {
			cursor = startCanonFromHere(
				options.store,
				storyId,
				eventId,
				typeof body.nodeId === "string" ? body.nodeId : undefined,
			);
		} catch (error) {
			throw toBadRequest(error, "canon");
		}
		sendJson(res, 200, { cursor, canon: readStoryCanonView(options, storyId) });
		return;
	}
	throw new HttpError(404, "not_found", "没有这个接口");
}

/** 一步建故事并装原著；可选叠加一张角色卡提供文风与规则。 */
async function startCanonStoryRoute(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, [
		"title",
		"bookId",
		"startEventId",
		"identityKind",
		"playerName",
		"persona",
		"card",
		"worlds",
	]);
	const bookId = requireText(body.bookId, "bookId");
	if (!isCanonIdentityKind(body.identityKind)) {
		throw fieldError("identityKind", "identityKind 只能是 canon 或 custom");
	}
	const identityKind = body.identityKind;
	const playerName = requireText(body.playerName, "playerName");
	if (body.title !== undefined && typeof body.title !== "string") {
		throw fieldError("title", "title 必须是字符串");
	}
	const title =
		typeof body.title === "string" && body.title.trim().length > 0
			? body.title.trim()
			: undefined;
	if (body.persona !== undefined && typeof body.persona !== "string") {
		throw fieldError("persona", "persona 必须是字符串");
	}
	const persona =
		typeof body.persona === "string" && body.persona.trim().length > 0
			? body.persona
			: undefined;
	let startEventId: number | undefined;
	if (body.startEventId !== undefined) {
		const value = body.startEventId;
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
			throw fieldError("startEventId", "startEventId 必须是正整数");
		}
		startEventId = value;
	}
	const request = {
		card: body.card === undefined ? null : parseCardPayload(body.card),
		worlds: parseWorldPayload(body.worlds),
	};
	let parsedCard: StCharacterCard | null = null;
	let cardBytes: Uint8Array | null = null;
	if (request.card !== null) {
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
	}
	const parsedWorlds = request.worlds.map((text, index) => {
		try {
			return parseWorldInfoJson(text);
		} catch (error) {
			throw toBadRequest(error, `worlds[${index}]`);
		}
	});

	let outcome: {
		readonly started: CanonStartResult;
		readonly cardName: string | null;
	};
	try {
		outcome = await options.store.runInTransaction(startCanonInTransaction);
	} catch (error) {
		throw toBadRequest(error, "canon");
	}
	async function startCanonInTransaction() {
		const started = startCanonStory(options.store, {
			bookId,
			...(title === undefined ? {} : { title }),
			...(startEventId === undefined ? {} : { startEventId }),
			identity: {
				kind: identityKind,
				name: playerName,
				...(persona === undefined ? {} : { persona }),
			},
		});
		let cardName: string | null = null;
		if (parsedCard !== null && request.card !== null) {
			const imported = importCardContent(options.store, started.story.id, {
				card: parsedCard,
				worlds: parsedWorlds,
				skipCharacterEntity: true,
			});
			options.store.updateStorySettings(started.story.id, {
				cardName: imported.cardName,
				characterPrompt: imported.characterPrompt,
			});
			await saveImportedCardMedia({
				store: options.store,
				storyId: started.story.id,
				mediaDir: options.imagesMediaDir,
				cardName: parsedCard.name,
				pngBytes: cardBytes,
			});
			afterCardImport(
				options.store,
				started.story.id,
				parsedCard,
				request.card.data,
			);
			cardName = imported.cardName;
		}
		return { started, cardName };
	}
	const canonView = readStoryCanonView(options, outcome.started.story.id);
	if (canonView.bound === null) {
		throw new Error("原著绑定写入后读取失败");
	}
	const result: StartCanonStoryResult = {
		story: toStoryView(
			requireStory(options.store, outcome.started.story.id),
			options.store,
		),
		canon: canonView.bound,
		cardName: outcome.cardName,
	};
	sendJson(res, 201, result);
}

export async function handleCanonRoute(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	const parts = pathSegments(url.pathname);
	if (parts[0] !== "canon") {
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	if (parts[1] === "start-story" && parts.length === 2) {
		requireMethod(method, ["POST"]);
		await startCanonStoryRoute(req, res, options);
		return;
	}
	if (parts[1] === "extract" && parts.length === 2) {
		requireMethod(method, ["GET"]);
		const overview: CanonExtractionOverviewView = {
			books: options.store.listCanonBooks().map((book) => ({
				book,
				extraction: options.store.getCanonExtraction(book.id),
				compilation: options.store.getCanonCompilation(book.id),
			})),
		};
		sendJson(res, 200, overview);
		return;
	}
	if (parts[1] === "packages" && parts[2] === "import" && parts.length === 3) {
		requireMethod(method, ["POST"]);
		const body = await readJsonBody(req, CANON_IMPORT_MAX_BODY_BYTES);
		if (!isJsonObject(body)) {
			throw fieldError("body", "请求体必须是 JSON 对象");
		}
		assertKnownKeys(body, ["package"]);
		if (body.package === undefined) {
			throw fieldError("package", "缺少 package");
		}
		let created: CanonPackageImportResult;
		try {
			created = importCanonPackage(options.store, body.package);
		} catch (error) {
			throw toBadRequest(error, "package");
		}
		const result: ImportCanonPackageResult = {
			book: created.book,
			chapters: created.chapters,
		};
		sendJson(res, 201, result);
		return;
	}
	if (parts[1] !== "books") {
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	const bookId = parts[2];
	if (bookId === undefined) {
		if (parts.length !== 2) {
			throw new HttpError(404, "not_found", "没有这个接口");
		}
		if (method === "GET") {
			const view: CanonBooksView = { books: options.store.listCanonBooks() };
			sendJson(res, 200, view);
			return;
		}
		requireMethod(method, ["POST"]);
		await importCanonBook(req, res, options);
		return;
	}
	if (parts.length === 3) {
		if (method === "DELETE") {
			if (!options.store.deleteCanonBook(bookId)) {
				throw new HttpError(404, "not_found", `原著不存在：${bookId}`);
			}
			sendEmpty(res, 204);
			return;
		}
		requireMethod(method, ["GET"]);
		const view: CanonBookDetailView = {
			book: requireCanonBook(options, bookId),
			chapters: options.store.listCanonChapters(bookId),
		};
		sendJson(res, 200, view);
		return;
	}
	if (parts[3] === "compile" && parts.length === 4) {
		requireMethod(method, ["POST"]);
		const book = requireCanonBook(options, bookId);
		if (!book.hasText) {
			throw new HttpError(409, "conflict", "这本原著包不含原文，不需要汇编");
		}
		if (options.store.getCanonExtraction(bookId)?.status !== "done") {
			throw new HttpError(409, "conflict", "按章抽取还没有完成，不能汇编");
		}
		const worker = requireCanonWorker(options);
		const model = await worker.modelAlias();
		if (model === null) {
			throw new HttpError(
				409,
				"conflict",
				"没有可用的后台模型：在设置里配置 background 或 settler 角色",
			);
		}
		options.store.ensureCanonCompilation(bookId);
		options.store.markCanonCompilationRunning(bookId, model);
		worker.startCompile(bookId);
		sendJson(res, 202, canonCompiledView(options, bookId));
		return;
	}
	if (parts[3] === "compiled" && parts.length === 4) {
		requireMethod(method, ["GET"]);
		const book = requireCanonBook(options, bookId);
		const upToChapter = queryInteger(
			url,
			"upToChapter",
			1,
			Math.max(book.chapterCount, 1),
		);
		options.store.ensureCanonCompilation(bookId);
		sendJson(res, 200, canonCompiledView(options, bookId, upToChapter));
		return;
	}
	if (parts[3] === "export" && parts.length === 4) {
		requireMethod(method, ["GET"]);
		requireCanonBook(options, bookId);
		const raw = url.searchParams.get("includeText");
		if (raw !== null && raw !== "0" && raw !== "1") {
			throw fieldError("includeText", "includeText 只能是 0 或 1");
		}
		let payload: CanonPackage;
		try {
			payload = exportCanonPackage(options.store, bookId, {
				includeText: raw === "1",
			});
		} catch (error) {
			throw new HttpError(
				409,
				"conflict",
				error instanceof Error ? error.message : String(error),
			);
		}
		const filename = canonPackageFilename(options.store, bookId);
		sendJson(res, 200, payload, {
			"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
		});
		return;
	}
	if (parts[3] === "estimate" && parts.length === 4) {
		requireMethod(method, ["GET"]);
		requireCanonBook(options, bookId);
		const model =
			options.canonWorker === null || options.canonWorker === undefined
				? null
				: await options.canonWorker.modelAlias();
		const chapters = options.store.listCanonChapterRecords(bookId);
		const view: CanonEstimateView = estimateCanonExtraction({
			bookId,
			chapters: chapters.map((chapter) => ({ paragraphs: chapter.paragraphs })),
			model,
			roster: options.store.listCanonEntities(bookId).map((entity) => ({
				name: entity.name,
				aliases: entity.aliases,
				kind: entity.kind,
			})),
		});
		sendJson(res, 200, view);
		return;
	}
	if (parts[3] === "extract") {
		if (parts.length === 4) {
			requireMethod(method, ["GET"]);
			requireCanonBook(options, bookId);
			const chapterId = url.searchParams.get("chapterId") ?? undefined;
			if (chapterId !== undefined) {
				requireCanonChapter(options, bookId, chapterId);
			}
			sendJson(res, 200, canonExtractionView(options, bookId, chapterId));
			return;
		}
		const action = parts[4];
		if (action !== "start" && action !== "pause") {
			throw new HttpError(404, "not_found", "没有这个接口");
		}
		if (parts.length !== 5) {
			throw new HttpError(404, "not_found", "没有这个接口");
		}
		requireMethod(method, ["POST"]);
		requireCanonBook(options, bookId);
		if (action === "pause") {
			options.store.pauseCanonExtraction(bookId);
			sendJson(res, 200, canonExtractionView(options, bookId));
			return;
		}
		const worker = requireCanonWorker(options);
		const model = await worker.modelAlias();
		if (model === null) {
			throw new HttpError(
				409,
				"conflict",
				"没有可用的后台模型：在设置里配置 background 或 settler 角色",
			);
		}
		beginCanonExtraction(options.store, bookId, model);
		worker.startBook(bookId);
		sendJson(res, 202, canonExtractionView(options, bookId));
		return;
	}
	const chapterId = parts[4];
	if (parts[3] !== "chapters" || chapterId === undefined) {
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	if (parts.length === 6 && parts[5] === "extract") {
		requireMethod(method, ["POST"]);
		requireCanonBook(options, bookId);
		requireCanonChapter(options, bookId, chapterId);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["mode"]);
		let mode: CanonChapterExtractRequest["mode"] = "resume";
		if (body.mode !== undefined) {
			if (body.mode !== "resume" && body.mode !== "full") {
				throw fieldError("mode", "mode 只能是 resume 或 full");
			}
			mode = body.mode;
		}
		const worker = requireCanonWorker(options);
		const model = await worker.modelAlias();
		if (model === null) {
			throw new HttpError(
				409,
				"conflict",
				"没有可用的后台模型：在设置里配置 background 或 settler 角色",
			);
		}
		options.store.markCanonExtractionRunning(bookId, model);
		worker.reextractChapter(bookId, chapterId, mode);
		sendJson(res, 202, canonExtractionView(options, bookId, chapterId));
		return;
	}
	if (parts.length === 5) {
		if (method === "GET") {
			const view: CanonChapterDetailView = {
				chapter: requireCanonChapter(options, bookId, chapterId),
			};
			sendJson(res, 200, view);
			return;
		}
		requireMethod(method, ["PATCH"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["title", "kind"]);
		if (body.title === undefined && body.kind === undefined) {
			throw fieldError("body", "至少给 title 或 kind");
		}
		const update: {
			title?: string;
			kind?: CanonChapterKind;
		} = {};
		if (body.title !== undefined) {
			if (typeof body.title !== "string") {
				throw fieldError("title", "title 必须是字符串");
			}
			update.title = body.title;
		}
		if (body.kind !== undefined) {
			if (!isCanonChapterKind(body.kind)) {
				throw fieldError(
					"kind",
					"kind 必须是 chapter、prologue、epilogue 或 extra",
				);
			}
			update.kind = body.kind;
		}
		let chapter: CanonChapterRecord | null;
		try {
			chapter = options.store.updateCanonChapter(bookId, chapterId, update);
		} catch (error) {
			throw toBadRequest(error, "title");
		}
		if (chapter === null) {
			throw new HttpError(404, "not_found", `章节不存在：${chapterId}`);
		}
		const view: CanonChapterDetailView = { chapter };
		sendJson(res, 200, view);
		return;
	}
	if (parts.length !== 6) {
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	const action = parts[5];
	if (action === "merge-next") {
		requireMethod(method, ["POST"]);
		try {
			options.store.mergeCanonChapterWithNext(bookId, chapterId);
		} catch (error) {
			throw toBadRequest(error, "chapterId");
		}
		if (options.store.getCanonChapter(bookId, chapterId) === null) {
			throw new HttpError(404, "not_found", `章节不存在：${chapterId}`);
		}
		const view: CanonBookDetailView = {
			book: requireCanonBook(options, bookId),
			chapters: options.store.listCanonChapters(bookId),
		};
		sendJson(res, 200, view);
		return;
	}
	if (action === "split") {
		requireMethod(method, ["POST"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["paragraphIndex"]);
		const paragraphIndex = body.paragraphIndex;
		if (
			typeof paragraphIndex !== "number" ||
			!Number.isInteger(paragraphIndex)
		) {
			throw fieldError("paragraphIndex", "paragraphIndex 必须是整数");
		}
		let result: CanonChapterSplitResult | null;
		try {
			result = options.store.splitCanonChapter(
				bookId,
				chapterId,
				paragraphIndex,
			);
		} catch (error) {
			throw toBadRequest(error, "paragraphIndex");
		}
		if (result === null) {
			throw new HttpError(404, "not_found", `章节不存在：${chapterId}`);
		}
		const view: CanonBookDetailView = {
			book: requireCanonBook(options, bookId),
			chapters: options.store.listCanonChapters(bookId),
		};
		sendJson(res, 200, view);
		return;
	}
	throw new HttpError(404, "not_found", "没有这个接口");
}

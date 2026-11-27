// server 路由：原著书与分章原文（canon/01）。
// 导入的 txt 可以到几十 MB，这个路由的请求体上限单独放宽。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type CanonChapterKind,
	type CanonChapterRecord,
	type CanonChapterSplitResult,
	type NewCanonChapter,
	canonBookTitle,
	decodeCanonBytes,
	isCanonChapterKind,
	isJsonObject,
	splitCanonText,
} from "@dramaticer/core";
import type {
	CanonBookDetailView,
	CanonBooksView,
	CanonChapterDetailView,
	CanonChapterUpdateRequest,
	ImportCanonBookResult,
} from "@dramaticer/protocol";
import { HttpError, readJsonBody, sendEmpty, sendJson } from "./http.js";
import {
	assertKnownKeys,
	fieldError,
	pathSegments,
	readObjectBody,
	requireMethod,
	toBadRequest,
} from "./routes-common.js";
import type { ApiRouteOptions } from "./routes.js";

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

export async function handleCanonRoute(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	const parts = pathSegments(url.pathname);
	if (parts[0] !== "canon" || parts[1] !== "books") {
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
	const chapterId = parts[4];
	if (parts[3] !== "chapters" || chapterId === undefined) {
		throw new HttpError(404, "not_found", "没有这个接口");
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

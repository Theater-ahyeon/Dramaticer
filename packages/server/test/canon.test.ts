import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
	ApiErrorResponse,
	CanonBookDetailView,
	CanonBooksView,
	CanonChapterDetailView,
	ImportCanonBookResult,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

const FIXTURES = join(
	import.meta.dirname,
	"..",
	"..",
	"core",
	"test",
	"fixtures",
);

interface TestServer {
	readonly running: RunningServer;
	readonly dir: string;
	readonly dbPath: string;
}

async function startTestServer(dir?: string): Promise<TestServer> {
	const workDir = dir ?? mkdtempSync(join(import.meta.dirname, ".tmp-canon-"));
	if (dir === undefined) {
		onTestFinished(() => {
			rmSync(workDir, { recursive: true, force: true, maxRetries: 5 });
		});
	}
	const dbPath = join(workDir, "story.db");
	const webRoot = join(workDir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath,
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return { running, dir: workDir, dbPath };
}

function base64Fixture(name: string): string {
	return readFileSync(join(FIXTURES, name)).toString("base64");
}

async function post(
	origin: string,
	path: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function patch(
	origin: string,
	path: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function importSample(
	origin: string,
	fixture = "canon-sample.txt",
): Promise<ImportCanonBookResult> {
	const response = await post(origin, "/api/canon/books", {
		filename: "云海纪事.txt",
		dataBase64: base64Fixture(fixture),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as ImportCanonBookResult;
}

describe("原著接口", () => {
	it("导入 UTF-8 小说后能看到书与分章列表", async () => {
		const { running } = await startTestServer();
		const origin = running.origin;
		const imported = await importSample(origin);
		expect(imported.book.title).toBe("云海纪事");
		expect(imported.book.encoding).toBe("utf-8");
		expect(imported.book.chapterCount).toBe(8);
		expect(imported.book.charCount).toBeGreaterThan(0);
		expect(imported.chapters[0]).toMatchObject({
			ordinal: 1,
			title: "序章 雨夜",
			kind: "prologue",
			volumeTitle: null,
		});
		expect(imported.chapters[1]).toMatchObject({
			title: "第一章 山门的清晨",
			volumeTitle: "第一卷 风起",
			paragraphCount: 3,
		});
		expect(imported.chapters[0]).not.toHaveProperty("paragraphs");

		const list = await fetch(`${origin}/api/canon/books`);
		expect(list.status).toBe(200);
		const books = (await list.json()) as CanonBooksView;
		expect(books.books.map((book) => book.id)).toContain(imported.book.id);

		const detailResponse = await fetch(
			`${origin}/api/canon/books/${imported.book.id}`,
		);
		expect(detailResponse.status).toBe(200);
		const detail = (await detailResponse.json()) as CanonBookDetailView;
		expect(detail.chapters).toHaveLength(8);

		const chapterResponse = await fetch(
			`${origin}/api/canon/books/${imported.book.id}/chapters/${imported.chapters[0]?.id}`,
		);
		expect(chapterResponse.status).toBe(200);
		const chapter = (await chapterResponse.json()) as CanonChapterDetailView;
		expect(chapter.chapter.paragraphs[0]).toContain("山门外的雨");
	});

	it("GB18030 文件导入后没有乱码", async () => {
		const { running } = await startTestServer();
		const imported = await importSample(
			running.origin,
			"canon-sample-gb18030.txt",
		);
		expect(imported.book.encoding).toBe("gb18030");
		expect(imported.chapters.map((chapter) => chapter.title)).toEqual([
			"序章 雨夜",
			"第一章 山门的清晨",
			"第二章 旧信",
			"归途",
			"番外 师父的茶",
			"第三章 夜行",
			"Chapter 4 The Ferry",
			"尾声 归山",
		]);
		const first = await fetch(
			`${running.origin}/api/canon/books/${imported.book.id}/chapters/${imported.chapters[0]?.id}`,
		);
		const chapter = (await first.json()) as CanonChapterDetailView;
		expect(chapter.chapter.paragraphs[0]).toContain("山门外的雨");
	});

	it("改标题与类型、合并下一章、某段后拆分都会写回", async () => {
		const { running } = await startTestServer();
		const origin = running.origin;
		const imported = await importSample(origin);
		const target = imported.chapters[1];
		if (target === undefined) throw new Error("缺少测试章节");
		const base = `/api/canon/books/${imported.book.id}/chapters/${target.id}`;

		const renamed = await patch(origin, base, {
			title: "第一章 改名",
			kind: "extra",
		});
		expect(renamed.status).toBe(200);
		const renamedBody = (await renamed.json()) as CanonChapterDetailView;
		expect(renamedBody.chapter.title).toBe("第一章 改名");
		expect(renamedBody.chapter.kind).toBe("extra");

		const merged = await post(origin, `${base}/merge-next`, {});
		expect(merged.status).toBe(200);
		const mergedBody = (await merged.json()) as CanonBookDetailView;
		expect(mergedBody.chapters).toHaveLength(7);
		expect(mergedBody.book.chapterCount).toBe(7);
		expect(mergedBody.chapters.map((chapter) => chapter.ordinal)).toEqual([
			1, 2, 3, 4, 5, 6, 7,
		]);

		const split = await post(origin, `${base}/split`, { paragraphIndex: 1 });
		expect(split.status).toBe(200);
		const splitBody = (await split.json()) as CanonBookDetailView;
		expect(splitBody.chapters).toHaveLength(8);
		expect(splitBody.chapters[2]?.title).toBe("第一章 改名（续）");

		const reloaded = await fetch(
			`${origin}/api/canon/books/${imported.book.id}`,
		);
		const detail = (await reloaded.json()) as CanonBookDetailView;
		expect(detail.book.chapterCount).toBe(8);
	});

	it("删除原著后列表与详情都不再有它", async () => {
		const { running } = await startTestServer();
		const origin = running.origin;
		const imported = await importSample(origin);
		const removed = await fetch(
			`${origin}/api/canon/books/${imported.book.id}`,
			{ method: "DELETE" },
		);
		expect(removed.status).toBe(204);
		const detail = await fetch(`${origin}/api/canon/books/${imported.book.id}`);
		expect(detail.status).toBe(404);
		const list = await fetch(`${origin}/api/canon/books`);
		const books = (await list.json()) as CanonBooksView;
		expect(books.books).toHaveLength(0);
	});

	it("服务重启后书与章节仍在", async () => {
		const { running, dir } = await startTestServer();
		const imported = await importSample(running.origin);
		await running.close();
		const restarted = await startTestServer(dir);
		try {
			const detail = await fetch(
				`${restarted.running.origin}/api/canon/books/${imported.book.id}`,
			);
			expect(detail.status).toBe(200);
			const body = (await detail.json()) as CanonBookDetailView;
			expect(body.book.title).toBe("云海纪事");
			expect(body.chapters).toHaveLength(8);
		} finally {
			await restarted.running.close();
		}
	});

	it("坏请求返回 400 或 404", async () => {
		const { running } = await startTestServer();
		const origin = running.origin;
		const noSource = await post(origin, "/api/canon/books", {});
		expect(noSource.status).toBe(400);
		const unknownKey = await post(origin, "/api/canon/books", {
			dataBase64: base64Fixture("canon-sample.txt"),
			nope: true,
		});
		expect(unknownKey.status).toBe(400);
		const badBase64 = await post(origin, "/api/canon/books", {
			dataBase64: "不是 base64",
		});
		expect(badBase64.status).toBe(400);
		const missing = await fetch(`${origin}/api/canon/books/nope`);
		expect(missing.status).toBe(404);

		const imported = await importSample(origin);
		const target = imported.chapters[0];
		if (target === undefined) throw new Error("缺少测试章节");
		const base = `/api/canon/books/${imported.book.id}/chapters/${target.id}`;
		const badSplit = await post(origin, `${base}/split`, {
			paragraphIndex: 0,
		});
		expect(badSplit.status).toBe(400);
		const lastMerge = await post(
			origin,
			`/api/canon/books/${imported.book.id}/chapters/${imported.chapters[7]?.id}/merge-next`,
			{},
		);
		expect(lastMerge.status).toBe(400);
		const badKind = await patch(origin, base, { kind: "volume" });
		expect(badKind.status).toBe(400);
		const error = (await badKind.json()) as ApiErrorResponse;
		expect(error.error.code).toBe("bad_request");
	});
});

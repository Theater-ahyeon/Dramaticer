import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	StoryStore,
	canonBookTitle,
	countCanonChars,
	decodeCanonBytes,
	splitCanonText,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function sampleText(): string {
	return readFileSync(join(FIXTURES, "canon-sample.txt"), "utf8");
}

function utf16beWithBom(text: string): Uint8Array {
	const little = Buffer.from(text, "utf16le");
	const swapped = Buffer.alloc(little.length);
	for (let index = 0; index < little.length; index += 2) {
		swapped[index] = little[index + 1] ?? 0;
		swapped[index + 1] = little[index] ?? 0;
	}
	return Buffer.concat([Buffer.from([0xfe, 0xff]), swapped]);
}

function openCanonStore(): { store: StoryStore; path: string } {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-"));
	const path = join(dir, "story.db");
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return { store, path };
}

function importSample(store: StoryStore) {
	const decoded = decodeCanonBytes(
		readFileSync(join(FIXTURES, "canon-sample.txt")),
	);
	return store.createCanonBook({
		title: "云海纪事",
		filename: "canon-sample.txt",
		encoding: decoded.encoding,
		chapters: splitCanonText(decoded.text),
	});
}

describe("原著编码识别", () => {
	const text = sampleText();

	it("UTF-8 与 UTF-8 BOM 都按 utf-8 解码", () => {
		expect(decodeCanonBytes(Buffer.from(text, "utf8")).encoding).toBe("utf-8");
		const withBom = Buffer.concat([
			Buffer.from([0xef, 0xbb, 0xbf]),
			Buffer.from(text, "utf8"),
		]);
		const decoded = decodeCanonBytes(withBom);
		expect(decoded.encoding).toBe("utf-8");
		expect(decoded.text.startsWith("\uFEFF")).toBe(false);
		expect(decoded.text).toBe(text);
	});

	it("UTF-16 LE 与 BE 按 BOM 解码", () => {
		const le = Buffer.concat([
			Buffer.from([0xff, 0xfe]),
			Buffer.from(text, "utf16le"),
		]);
		expect(decodeCanonBytes(le)).toEqual({ text, encoding: "utf-16le" });
		const be = decodeCanonBytes(utf16beWithBom(text));
		expect(be.encoding).toBe("utf-16be");
		expect(be.text).toBe(text);
	});

	it("GB18030 文件解码后与 UTF-8 完全一致，分章也一致", () => {
		const decoded = decodeCanonBytes(
			readFileSync(join(FIXTURES, "canon-sample-gb18030.txt")),
		);
		expect(decoded.encoding).toBe("gb18030");
		expect(decoded.text).toBe(text);
		expect(
			splitCanonText(decoded.text).map((chapter) => chapter.title),
		).toEqual(splitCanonText(text).map((chapter) => chapter.title));
	});

	it("空文件与无法识别的字节直接抛错", () => {
		expect(() => decodeCanonBytes(new Uint8Array())).toThrow(/空的/);
		expect(() => decodeCanonBytes(new Uint8Array([0xff]))).toThrow(/无法识别/);
	});
});

describe("原著分章", () => {
	it("按卷、章、序章、番外与无标号短行切分", () => {
		const chapters = splitCanonText(sampleText());
		expect(
			chapters.map((chapter) => ({
				title: chapter.title,
				kind: chapter.kind,
				volumeTitle: chapter.volumeTitle,
			})),
		).toEqual([
			{ title: "序章 雨夜", kind: "prologue", volumeTitle: null },
			{
				title: "第一章 山门的清晨",
				kind: "chapter",
				volumeTitle: "第一卷 风起",
			},
			{ title: "第二章 旧信", kind: "chapter", volumeTitle: "第一卷 风起" },
			{ title: "归途", kind: "chapter", volumeTitle: "第一卷 风起" },
			{ title: "番外 师父的茶", kind: "extra", volumeTitle: "第一卷 风起" },
			{
				title: "第三章 夜行",
				kind: "chapter",
				volumeTitle: "第二卷 潮生",
			},
			{
				title: "Chapter 4 The Ferry",
				kind: "chapter",
				volumeTitle: "第二卷 潮生",
			},
			{ title: "尾声 归山", kind: "epilogue", volumeTitle: "第二卷 潮生" },
		]);
	});

	it("正文里的第三天、第一次与缩进标题处理正确", () => {
		const chapters = splitCanonText(sampleText());
		const first = chapters.find(
			(chapter) => chapter.title === "第一章 山门的清晨",
		);
		expect(first?.paragraphs).toHaveLength(3);
		expect(first?.paragraphs[1]).toBe("第三天，雨停了。");
		expect(first?.paragraphs[2]?.startsWith("他第一次看见")).toBe(true);
		expect(chapters.some((chapter) => chapter.title.includes("第三天"))).toBe(
			false,
		);
		expect(
			chapters.find((chapter) => chapter.title === "第三章 夜行")
				?.paragraphs[0],
		).toContain("夜里没有风");
	});

	it("没有标题的长正文按字数分成若干部分，短正文只有一章", () => {
		const paragraphs = Array.from(
			{ length: 400 },
			(_, index) => `第${index + 1}段正文写了一些并不会成为标题的句子。`,
		);
		const long = splitCanonText(paragraphs.join("\n\n"));
		expect(long.length).toBeGreaterThan(1);
		expect(long[0]?.title).toBe("第 1 部分");
		expect(long[1]?.title).toBe("第 2 部分");
		expect(long.every((chapter) => chapter.kind === "chapter")).toBe(true);
		const short = splitCanonText("只有一段很短正文。");
		expect(short).toHaveLength(1);
		expect(short[0]?.title).toBe("全文");
	});

	it("英文卷与章标题也识别", () => {
		const chapters = splitCanonText(
			"Volume 1 The Sea\n\nChapter 1 The Door\n\n正文第一段。\n\nChapter 2 The Key\n\n正文第二段。",
		);
		expect(chapters.map((chapter) => chapter.title)).toEqual([
			"Chapter 1 The Door",
			"Chapter 2 The Key",
		]);
		expect(chapters[0]?.volumeTitle).toBe("Volume 1 The Sea");
	});

	it("书名为空时用文件名，没有文件名时用默认名", () => {
		expect(canonBookTitle("  ", "云海纪事.txt")).toBe("云海纪事");
		expect(canonBookTitle("自定义", "x.txt")).toBe("自定义");
		expect(canonBookTitle(undefined, undefined)).toBe("未命名原著");
	});

	it("字数不计空白", () => {
		expect(countCanonChars(["一 二", "\t三\n"])).toBe(3);
	});
});

describe("原著存储与编辑", () => {
	it("导入后按顺序编号，列表与单章读取分开", () => {
		const { store } = openCanonStore();
		const { book, chapters } = importSample(store);
		expect(book.chapterCount).toBe(8);
		expect(book.charCount).toBe(
			chapters.reduce((total, chapter) => total + chapter.charCount, 0),
		);
		const summaries = store.listCanonChapters(book.id);
		expect(summaries.map((chapter) => chapter.ordinal)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8,
		]);
		expect(summaries[0]).not.toHaveProperty("paragraphs");
		const full = store.getCanonChapter(book.id, chapters[1]?.id ?? "");
		expect(full?.paragraphs).toHaveLength(3);
	});

	it("改标题与类型后刷新仍在", () => {
		const { store } = openCanonStore();
		const { book, chapters } = importSample(store);
		const target = chapters[1];
		if (target === undefined) throw new Error("缺少测试章节");
		const updated = store.updateCanonChapter(book.id, target.id, {
			title: "第一章 改名",
			kind: "extra",
		});
		expect(updated?.title).toBe("第一章 改名");
		expect(updated?.kind).toBe("extra");
		expect(store.getCanonChapter(book.id, target.id)?.title).toBe(
			"第一章 改名",
		);
	});

	it("合并下一章：段落并入、序号重排、字数重算", () => {
		const { store } = openCanonStore();
		const { book, chapters } = importSample(store);
		const first = chapters[1];
		const second = chapters[2];
		if (first === undefined || second === undefined) {
			throw new Error("缺少测试章节");
		}
		const totalBefore = book.charCount;
		const merged = store.mergeCanonChapterWithNext(book.id, first.id);
		expect(merged?.paragraphCount).toBe((first.paragraphs.length ?? 0) + 1);
		const after = store.listCanonChapters(book.id);
		expect(after).toHaveLength(7);
		expect(after.map((chapter) => chapter.ordinal)).toEqual([
			1, 2, 3, 4, 5, 6, 7,
		]);
		expect(after.some((chapter) => chapter.id === second.id)).toBe(false);
		const reloaded = store.getCanonBook(book.id);
		expect(reloaded?.chapterCount).toBe(7);
		expect(reloaded?.charCount).toBe(totalBefore);
		const last = chapters[7];
		if (last === undefined) throw new Error("缺少测试章节");
		expect(() => store.mergeCanonChapterWithNext(book.id, last.id)).toThrow(
			/最后一章/,
		);
	});

	it("在某段后拆分：两章都留在原位，序号与字数重算", () => {
		const { store } = openCanonStore();
		const { book, chapters } = importSample(store);
		const target = chapters[1];
		if (target === undefined) throw new Error("缺少测试章节");
		expect(() => store.splitCanonChapter(book.id, target.id, 0)).toThrow(
			/拆分位置/,
		);
		const result = store.splitCanonChapter(book.id, target.id, 1);
		expect(result?.first.paragraphs).toEqual([target.paragraphs[0]]);
		expect(result?.second.paragraphs).toEqual(target.paragraphs.slice(1));
		expect(result?.second.title).toBe("第一章 山门的清晨（续）");
		const after = store.listCanonChapters(book.id);
		expect(after).toHaveLength(9);
		expect(after[1]?.id).toBe(target.id);
		expect(after[2]?.id).toBe(result?.second.id);
		expect(after.map((chapter) => chapter.ordinal)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9,
		]);
		expect(store.getCanonBook(book.id)?.chapterCount).toBe(9);
	});

	it("删除原著会连同章节一起清理", () => {
		const { store } = openCanonStore();
		const { book, chapters } = importSample(store);
		expect(store.deleteCanonBook(book.id)).toBe(true);
		expect(store.getCanonBook(book.id)).toBeNull();
		expect(store.listCanonChapters(book.id)).toHaveLength(0);
		expect(store.getCanonChapter(book.id, chapters[0]?.id ?? "")).toBeNull();
		expect(store.deleteCanonBook(book.id)).toBe(false);
	});

	it("关掉数据库再打开，书与章节仍在", () => {
		const dir = mkdtempSync(join(import.meta.dirname, ".tmp-canon-"));
		const path = join(dir, "story.db");
		onTestFinished(() => {
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
		});
		const first = StoryStore.open(path);
		const { book } = importSample(first);
		first.close();
		const second = StoryStore.open(path);
		try {
			expect(second.getCanonBook(book.id)?.title).toBe("云海纪事");
			expect(second.listCanonChapters(book.id)).toHaveLength(8);
			expect(second.getCanonChapter(book.id, book.id)).toBeNull();
		} finally {
			second.close();
		}
	});
});

// StoryStore 的领域仓储：原著书与分章原文（canon/01）。
// 书不属于任何故事；原文只在本机数据库里，写完可合并、拆分、改标题。
import { randomUUID } from "node:crypto";
import {
	CANON_TEXT_ENCODINGS,
	type CanonBookRecord,
	type CanonBookStatus,
	type CanonChapterKind,
	type CanonChapterRecord,
	type CanonChapterSummary,
	type NewCanonChapter,
	assertCanonChapterKind,
	countCanonChars,
	isCanonBookStatus,
} from "../../canon/index.js";
import { StoreRepo } from "./base.js";

export interface CreateCanonBookInput {
	readonly id?: string;
	readonly title: string;
	readonly filename?: string | null;
	readonly encoding: string;
	readonly chapters: readonly NewCanonChapter[];
	readonly createdAt?: string;
}

export interface CanonChapterUpdate {
	readonly title?: string;
	readonly kind?: CanonChapterKind;
}

export interface CanonChapterSplitResult {
	readonly first: CanonChapterRecord;
	readonly second: CanonChapterRecord;
}

interface CanonBookRow {
	readonly id: string;
	readonly title: string;
	readonly filename: string | null;
	readonly encoding: string;
	readonly char_count: number;
	readonly chapter_count: number;
	readonly status: string;
	readonly created_at: string;
}

interface CanonChapterRow {
	readonly id: string;
	readonly book_id: string;
	readonly ordinal: number;
	readonly volume_title: string | null;
	readonly title: string;
	readonly kind: string;
	readonly paragraphs: string;
	readonly paragraph_count: number;
	readonly char_count: number;
	readonly created_at: string;
}

const RENUMBER_OFFSET = 1_000_000;

function readStatus(value: string): CanonBookStatus {
	if (!isCanonBookStatus(value)) {
		throw new Error(`原著状态不合法：${value}`);
	}
	return value;
}

function parseParagraphs(value: string, label: string): readonly string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`${label} 不是段落数组`);
	}
	return parsed.map((item, index) => {
		if (typeof item !== "string" || item.length === 0) {
			throw new Error(`${label} 第 ${index + 1} 段不是非空字符串`);
		}
		return item;
	});
}

function rowToBook(row: CanonBookRow): CanonBookRecord {
	return {
		id: row.id,
		title: row.title,
		filename: row.filename,
		encoding: row.encoding,
		charCount: row.char_count,
		chapterCount: row.chapter_count,
		status: readStatus(row.status),
		createdAt: row.created_at,
	};
}

function rowToChapterSummary(row: CanonChapterRow): CanonChapterSummary {
	return {
		id: row.id,
		bookId: row.book_id,
		ordinal: row.ordinal,
		volumeTitle: row.volume_title,
		title: row.title,
		kind: assertCanonChapterKind(row.kind, `章节 ${row.id} 的类型`),
		paragraphCount: row.paragraph_count,
		charCount: row.char_count,
	};
}

function rowToChapterRecord(row: CanonChapterRow): CanonChapterRecord {
	return {
		...rowToChapterSummary(row),
		paragraphs: parseParagraphs(row.paragraphs, `章节 ${row.id} 的原文`),
		createdAt: row.created_at,
	};
}

export class CanonRepo extends StoreRepo {
	createCanonBook(input: CreateCanonBookInput): {
		readonly book: CanonBookRecord;
		readonly chapters: readonly CanonChapterRecord[];
	} {
		const title = input.title.trim();
		if (title.length === 0) {
			throw new Error("原著书名不能为空");
		}
		if (!CANON_TEXT_ENCODINGS.some((value) => value === input.encoding)) {
			throw new Error(`不支持的原文编码：${input.encoding}`);
		}
		if (input.chapters.length === 0) {
			throw new Error("原著至少要有一章");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		const bookId = input.id ?? randomUUID();
		const chapters = input.chapters.map((chapter, index) =>
			this.#normalizeChapter(chapter, index, bookId, createdAt),
		);
		const charCount = chapters.reduce(
			(total, chapter) => total + chapter.charCount,
			0,
		);
		this.db.transaction(() => {
			this.db
				.prepare(
					`INSERT INTO canon_books
					(id, title, filename, encoding, char_count, chapter_count, status, created_at)
					VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`,
				)
				.run(
					bookId,
					title,
					input.filename?.trim() || null,
					input.encoding,
					charCount,
					chapters.length,
					createdAt,
				);
			const insert = this.db.prepare(
				`INSERT INTO canon_chapters
				(id, book_id, ordinal, volume_title, title, kind, paragraphs,
				 paragraph_count, char_count, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			chapters.forEach((chapter, index) => {
				insert.run(
					chapter.id,
					bookId,
					index + 1,
					chapter.volumeTitle,
					chapter.title,
					chapter.kind,
					JSON.stringify(chapter.paragraphs),
					chapter.paragraphs.length,
					chapter.charCount,
					createdAt,
				);
			});
		})();
		return {
			book: this.#requireBook(bookId),
			chapters: this.listCanonChapterRecords(bookId),
		};
	}

	listCanonBooks(): readonly CanonBookRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM canon_books ORDER BY created_at DESC, id ASC")
			.all() as CanonBookRow[];
		return rows.map(rowToBook);
	}

	getCanonBook(bookId: string): CanonBookRecord | null {
		const row = this.db
			.prepare("SELECT * FROM canon_books WHERE id = ?")
			.get(bookId) as CanonBookRow | undefined;
		return row === undefined ? null : rowToBook(row);
	}

	listCanonChapters(bookId: string): readonly CanonChapterSummary[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_chapters
				WHERE book_id = ? ORDER BY ordinal ASC`,
			)
			.all(bookId) as CanonChapterRow[];
		return rows.map(rowToChapterSummary);
	}

	listCanonChapterRecords(bookId: string): readonly CanonChapterRecord[] {
		const rows = this.db
			.prepare(
				`SELECT * FROM canon_chapters
				WHERE book_id = ? ORDER BY ordinal ASC`,
			)
			.all(bookId) as CanonChapterRow[];
		return rows.map(rowToChapterRecord);
	}

	getCanonChapter(
		bookId: string,
		chapterId: string,
	): CanonChapterRecord | null {
		const row = this.db
			.prepare("SELECT * FROM canon_chapters WHERE book_id = ? AND id = ?")
			.get(bookId, chapterId) as CanonChapterRow | undefined;
		return row === undefined ? null : rowToChapterRecord(row);
	}

	updateCanonChapter(
		bookId: string,
		chapterId: string,
		update: CanonChapterUpdate,
	): CanonChapterRecord | null {
		const current = this.getCanonChapter(bookId, chapterId);
		if (current === null) return null;
		const title =
			update.title === undefined ? current.title : update.title.trim();
		if (title.length === 0) {
			throw new Error("章节标题不能为空");
		}
		const kind =
			update.kind === undefined
				? current.kind
				: assertCanonChapterKind(update.kind, "章节类型");
		this.db
			.prepare(
				"UPDATE canon_chapters SET title = ?, kind = ? WHERE book_id = ? AND id = ?",
			)
			.run(title, kind, bookId, chapterId);
		return this.getCanonChapter(bookId, chapterId);
	}

	/** 把下一章的段落并入这一章；最后一章没有下一章可合并。 */
	mergeCanonChapterWithNext(
		bookId: string,
		chapterId: string,
	): CanonChapterRecord | null {
		const current = this.getCanonChapter(bookId, chapterId);
		if (current === null) return null;
		const nextRow = this.db
			.prepare(
				`SELECT * FROM canon_chapters
				WHERE book_id = ? AND ordinal > ?
				ORDER BY ordinal ASC LIMIT 1`,
			)
			.get(bookId, current.ordinal) as CanonChapterRow | undefined;
		if (nextRow === undefined) {
			throw new Error("已经是最后一章，没有下一章可以合并");
		}
		const next = rowToChapterRecord(nextRow);
		const paragraphs = [...current.paragraphs, ...next.paragraphs];
		this.db.transaction(() => {
			this.db
				.prepare(
					`UPDATE canon_chapters
					SET paragraphs = ?, paragraph_count = ?, char_count = ?
					WHERE book_id = ? AND id = ?`,
				)
				.run(
					JSON.stringify(paragraphs),
					paragraphs.length,
					countCanonChars(paragraphs),
					bookId,
					chapterId,
				);
			this.db
				.prepare("DELETE FROM canon_chapters WHERE book_id = ? AND id = ?")
				.run(bookId, next.id);
			this.#renumberChapters(bookId);
		})();
		return this.getCanonChapter(bookId, chapterId);
	}

	/** 在第 `paragraphIndex` 段之后切开；前半保留原章，后半作为新章插在后面。 */
	splitCanonChapter(
		bookId: string,
		chapterId: string,
		paragraphIndex: number,
	): CanonChapterSplitResult | null {
		const current = this.getCanonChapter(bookId, chapterId);
		if (current === null) return null;
		const total = current.paragraphs.length;
		if (total < 2) {
			throw new Error("这一章只有一段，无法再拆");
		}
		if (
			!Number.isInteger(paragraphIndex) ||
			paragraphIndex < 1 ||
			paragraphIndex >= total
		) {
			throw new Error(`拆分位置必须是 1 到 ${total - 1} 之间的整数`);
		}
		const firstParagraphs = current.paragraphs.slice(0, paragraphIndex);
		const secondParagraphs = current.paragraphs.slice(paragraphIndex);
		const secondId = randomUUID();
		const secondTitle = `${current.title}（续）`;
		this.db.transaction(() => {
			this.db
				.prepare(
					"UPDATE canon_chapters SET ordinal = ordinal + ? WHERE book_id = ?",
				)
				.run(RENUMBER_OFFSET, bookId);
			this.db
				.prepare(
					`INSERT INTO canon_chapters
					(id, book_id, ordinal, volume_title, title, kind, paragraphs,
					 paragraph_count, char_count, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					secondId,
					bookId,
					RENUMBER_OFFSET * 2,
					current.volumeTitle,
					secondTitle,
					current.kind,
					JSON.stringify(secondParagraphs),
					secondParagraphs.length,
					countCanonChars(secondParagraphs),
					new Date().toISOString(),
				);
			this.db
				.prepare(
					`UPDATE canon_chapters
					SET paragraphs = ?, paragraph_count = ?, char_count = ?
					WHERE book_id = ? AND id = ?`,
				)
				.run(
					JSON.stringify(firstParagraphs),
					firstParagraphs.length,
					countCanonChars(firstParagraphs),
					bookId,
					chapterId,
				);
			const ids = (
				this.db
					.prepare(
						`SELECT id FROM canon_chapters
						WHERE book_id = ? AND id <> ?
						ORDER BY ordinal ASC`,
					)
					.all(bookId, secondId) as { readonly id: string }[]
			).map((row) => row.id);
			const position = ids.indexOf(chapterId);
			ids.splice(position + 1, 0, secondId);
			this.#assignOrdinals(bookId, ids);
			this.#recountBook(bookId);
		})();
		const first = this.getCanonChapter(bookId, chapterId);
		const second = this.getCanonChapter(bookId, secondId);
		if (first === null || second === null) {
			throw new Error("拆分后的章节读取失败");
		}
		return { first, second };
	}

	deleteCanonBook(bookId: string): boolean {
		const result = this.db
			.prepare("DELETE FROM canon_books WHERE id = ?")
			.run(bookId);
		return result.changes > 0;
	}

	#requireBook(bookId: string): CanonBookRecord {
		const book = this.getCanonBook(bookId);
		if (book === null) {
			throw new Error(`原著 ${bookId} 不存在`);
		}
		return book;
	}

	#normalizeChapter(
		chapter: NewCanonChapter,
		index: number,
		bookId: string,
		createdAt: string,
	): CanonChapterRecord {
		const label = `第 ${index + 1} 章`;
		const title = chapter.title.trim();
		if (title.length === 0) {
			throw new Error(`${label}的标题不能为空`);
		}
		const volumeTitle = chapter.volumeTitle?.trim() || null;
		const kind = assertCanonChapterKind(chapter.kind, `${label}的类型`);
		if (chapter.paragraphs.length === 0) {
			throw new Error(`${label}没有正文`);
		}
		const paragraphs = chapter.paragraphs.map((paragraph, paragraphIndex) => {
			const trimmed = paragraph.trim();
			if (trimmed.length === 0) {
				throw new Error(`${label}第 ${paragraphIndex + 1} 段是空的`);
			}
			return trimmed;
		});
		return {
			id: randomUUID(),
			bookId,
			ordinal: index + 1,
			volumeTitle,
			title,
			kind,
			paragraphCount: paragraphs.length,
			charCount: countCanonChars(paragraphs),
			paragraphs,
			createdAt,
		};
	}

	#renumberChapters(bookId: string): void {
		const ids = (
			this.db
				.prepare(
					`SELECT id FROM canon_chapters
					WHERE book_id = ? ORDER BY ordinal ASC`,
				)
				.all(bookId) as { readonly id: string }[]
		).map((row) => row.id);
		this.#assignOrdinals(bookId, ids);
		this.#recountBook(bookId);
	}

	/** 先把序号整体挪到高处，避免 UNIQUE(book_id, ordinal) 在逐行更新时撞车。 */
	#assignOrdinals(bookId: string, ids: readonly string[]): void {
		if (ids.length === 0) return;
		this.db
			.prepare(
				"UPDATE canon_chapters SET ordinal = ordinal + ? WHERE book_id = ?",
			)
			.run(RENUMBER_OFFSET, bookId);
		const update = this.db.prepare(
			"UPDATE canon_chapters SET ordinal = ? WHERE id = ?",
		);
		ids.forEach((id, index) => {
			update.run(index + 1, id);
		});
	}

	#recountBook(bookId: string): void {
		const row = this.db
			.prepare(
				`SELECT COUNT(*) AS chapters, COALESCE(SUM(char_count), 0) AS chars
				FROM canon_chapters WHERE book_id = ?`,
			)
			.get(bookId) as { readonly chapters: number; readonly chars: number };
		this.db
			.prepare(
				"UPDATE canon_books SET chapter_count = ?, char_count = ? WHERE id = ?",
			)
			.run(row.chapters, row.chars, bookId);
	}
}

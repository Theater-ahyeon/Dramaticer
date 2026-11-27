import { isJsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import {
	CANON_PACKAGE_FORMAT,
	CANON_PACKAGE_VERSION,
	type CanonBaseEntry,
	type CanonBookRecord,
	type CanonChapterKind,
	type CanonChapterSummary,
	type CanonEntityKind,
	type CanonPackage,
	type CanonPackageBook,
	type CanonPackageChapter,
	type CanonPackageEntity,
	type CanonPackageEvent,
	type CanonPackageFact,
	type CanonPackageVoice,
	assertCanonChapterKind,
	isCanonEntityKind,
} from "./types.js";

// 原著故事包（canon/03，v5 §5.3、§5.6）：把汇编结果导出成可分享的 JSON。
// 默认不含原文，也不含任何本机路径；导入后直接是已抽取、已汇编的原著，
// 不再调用模型。

export interface CanonPackageExportOptions {
	/** 只有玩家显式要求时才附带各章原文。 */
	readonly includeText?: boolean;
}

export interface CanonPackageImportResult {
	readonly book: CanonBookRecord;
	readonly chapters: readonly CanonChapterSummary[];
}

export function exportCanonPackage(
	store: StoryStore,
	bookId: string,
	options: CanonPackageExportOptions = {},
): CanonPackage {
	const book = store.getCanonBook(bookId);
	if (book === null) throw new Error(`原著 ${bookId} 不存在`);
	const compilation = store.getCanonCompilation(bookId);
	if (compilation === null || compilation.status !== "done") {
		throw new Error("这本原著还没有完成全书汇编，不能导出");
	}
	const includeText = options.includeText === true;
	const chapters = store.listCanonChapterRecords(bookId);
	const chapterViews: CanonPackageChapter[] = chapters.map((chapter) => ({
		ordinal: chapter.ordinal,
		volumeTitle: chapter.volumeTitle,
		title: chapter.title,
		kind: chapter.kind,
		charCount: chapter.charCount,
		paragraphCount: chapter.paragraphCount,
		...(includeText ? { paragraphs: chapter.paragraphs } : {}),
	}));
	const entities: CanonPackageEntity[] = store
		.listCanonCompiledEntities(bookId)
		.map((entity) => ({
			name: entity.name,
			aliases: entity.aliases,
			kind: entity.kind,
			lead: entity.lead,
			base: entity.base,
			baseEntries: entity.baseEntries,
			firstChapterOrdinal: entity.firstChapterOrdinal,
			lastChapterOrdinal: entity.lastChapterOrdinal,
		}));
	const events: CanonPackageEvent[] = store
		.listCanonEvents(bookId)
		.map((event) => ({
			chapterOrdinal: event.chapterOrdinal,
			seq: event.seq,
			title: event.title,
			summary: event.summary,
			digest: event.digest,
			participants: event.participants,
			location: event.location,
			timeText: event.timeText,
			paragraphStart: event.paragraphStart,
			paragraphEnd: event.paragraphEnd,
			isInterlude: event.isInterlude,
			timelineOrder: event.timelineOrder,
			isTurningPoint: event.isTurningPoint,
		}));
	const voices: CanonPackageVoice[] = store
		.listCanonVoices(bookId)
		.map((voice) => ({
			chapterOrdinal: voice.chapterOrdinal,
			ordinal: voice.ordinal,
			character: voice.character,
			kind: voice.kind,
			text: voice.text,
		}));
	const facts: CanonPackageFact[] = store
		.listCanonFacts(bookId)
		.map((fact) => ({
			chapterOrdinal: fact.chapterOrdinal,
			entityName: fact.entityName,
			aliases: fact.aliases,
			entityKind: fact.entityKind,
			fact: fact.fact,
		}));
	const bookView: CanonPackageBook = {
		title: book.title,
		filename: book.filename,
		encoding: book.encoding,
		charCount: book.charCount,
		chapterCount: book.chapterCount,
		hasText: book.hasText,
	};
	return {
		format: CANON_PACKAGE_FORMAT,
		version: CANON_PACKAGE_VERSION,
		exportedAt: new Date().toISOString(),
		book: bookView,
		chapters: chapterViews,
		entities,
		events,
		voices,
		facts,
	};
}

export function importCanonPackage(
	store: StoryStore,
	value: unknown,
): CanonPackageImportResult {
	return store.importCanonPackage(parseCanonPackage(value));
}

/** 导入前把整包校验一遍；不认识的格式、越界的章节号都在这里直接失败。 */
export function parseCanonPackage(value: unknown): CanonPackage {
	if (!isJsonObject(value)) throw new Error("原著包必须是 JSON 对象");
	if (value.format !== CANON_PACKAGE_FORMAT) {
		throw new Error("这个文件不是 Dramaticer 原著包");
	}
	if (value.version !== CANON_PACKAGE_VERSION) {
		throw new Error(
			`不支持的原著包版本：${String(value.version)}，当前只认 ${CANON_PACKAGE_VERSION}`,
		);
	}
	const bookRaw = requireObject(value.book, "book");
	const book: CanonPackageBook = {
		title: requireText(bookRaw.title, "book.title"),
		filename: requireOptionalText(bookRaw.filename, "book.filename"),
		encoding: requireText(bookRaw.encoding, "book.encoding"),
		charCount: requireInteger(bookRaw.charCount, "book.charCount", 0),
		chapterCount: requireInteger(bookRaw.chapterCount, "book.chapterCount", 0),
		hasText: requireBoolean(bookRaw.hasText, "book.hasText"),
	};
	const chaptersRaw = requireArray(value.chapters, "chapters");
	if (chaptersRaw.length === 0) throw new Error("原著包里至少要有一章");
	const chapters = chaptersRaw.map((item, index) => {
		const record = requireObject(item, `chapters[${index}]`);
		const ordinal = requireInteger(
			record.ordinal,
			`chapters[${index}].ordinal`,
			1,
		);
		if (ordinal !== index + 1) {
			throw new Error(
				`原著包的章节序号必须从 1 连续编号，第 ${index + 1} 项是 ${ordinal}`,
			);
		}
		const paragraphCount = requireInteger(
			record.paragraphCount,
			`chapters[${index}].paragraphCount`,
			0,
		);
		const paragraphs =
			record.paragraphs === undefined
				? undefined
				: requireArray(record.paragraphs, `chapters[${index}].paragraphs`).map(
						(paragraph, paragraphIndex) =>
							requireText(
								paragraph,
								`chapters[${index}].paragraphs[${paragraphIndex}]`,
							),
					);
		if (paragraphs !== undefined && paragraphs.length !== paragraphCount) {
			throw new Error(`原著包第 ${ordinal} 章的段落数与 paragraphCount 不一致`);
		}
		const kind: CanonChapterKind = assertCanonChapterKind(
			record.kind,
			`chapters[${index}].kind`,
		);
		return {
			ordinal,
			volumeTitle: requireOptionalText(
				record.volumeTitle,
				`chapters[${index}].volumeTitle`,
			),
			title: requireText(record.title, `chapters[${index}].title`),
			kind,
			charCount: requireInteger(
				record.charCount,
				`chapters[${index}].charCount`,
				0,
			),
			paragraphCount,
			...(paragraphs === undefined ? {} : { paragraphs }),
		} satisfies CanonPackageChapter;
	});
	if (book.chapterCount !== chapters.length) {
		throw new Error("原著包的 chapterCount 与 chapters 数量不一致");
	}
	const ordinals = new Set(chapters.map((chapter) => chapter.ordinal));
	const entitiesRaw = requireArray(value.entities, "entities");
	if (entitiesRaw.length === 0) throw new Error("原著包里没有汇编实体");
	const entityNames = new Set<string>();
	const entities = entitiesRaw.map((item, index) => {
		const record = requireObject(item, `entities[${index}]`);
		const name = requireText(record.name, `entities[${index}].name`);
		if (entityNames.has(name)) throw new Error(`原著包里实体「${name}」重复`);
		entityNames.add(name);
		const kind: CanonEntityKind = requireEntityKind(
			record.kind,
			`entities[${index}].kind`,
		);
		const firstChapterOrdinal = requireInteger(
			record.firstChapterOrdinal,
			`entities[${index}].firstChapterOrdinal`,
			1,
		);
		const lastChapterOrdinal = requireInteger(
			record.lastChapterOrdinal,
			`entities[${index}].lastChapterOrdinal`,
			1,
		);
		if (lastChapterOrdinal < firstChapterOrdinal) {
			throw new Error(`原著包实体「${name}」的末章早于首章`);
		}
		const entriesRaw = requireArray(
			record.baseEntries,
			`entities[${index}].baseEntries`,
		);
		const baseEntries: CanonBaseEntry[] = entriesRaw.map(
			(entry, entryIndex) => {
				const item2 = requireObject(
					entry,
					`entities[${index}].baseEntries[${entryIndex}]`,
				);
				return {
					chapterOrdinal: requireInteger(
						item2.chapterOrdinal,
						`entities[${index}].baseEntries[${entryIndex}].chapterOrdinal`,
						1,
					),
					text: requireText(
						item2.text,
						`entities[${index}].baseEntries[${entryIndex}].text`,
					),
				};
			},
		);
		return {
			name,
			aliases: requireStringList(record.aliases, `entities[${index}].aliases`),
			kind,
			lead: requireText(record.lead, `entities[${index}].lead`),
			base: requireText(record.base, `entities[${index}].base`),
			baseEntries,
			firstChapterOrdinal,
			lastChapterOrdinal,
		} satisfies CanonPackageEntity;
	});
	const eventsRaw = requireArray(value.events, "events");
	const eventKeys = new Set<string>();
	const events = eventsRaw.map((item, index) => {
		const record = requireObject(item, `events[${index}]`);
		const chapterOrdinal = requireChapterOrdinal(
			record.chapterOrdinal,
			ordinals,
			`events[${index}].chapterOrdinal`,
		);
		const seq = requireInteger(record.seq, `events[${index}].seq`, 1);
		const key = `${chapterOrdinal}:${seq}`;
		if (eventKeys.has(key)) {
			throw new Error(`原著包第 ${chapterOrdinal} 章的事件序号 ${seq} 重复`);
		}
		eventKeys.add(key);
		const paragraphStart = requireInteger(
			record.paragraphStart,
			`events[${index}].paragraphStart`,
			1,
		);
		const paragraphEnd = requireInteger(
			record.paragraphEnd,
			`events[${index}].paragraphEnd`,
			1,
		);
		if (paragraphEnd < paragraphStart) {
			throw new Error(`原著包事件 ${index + 1} 的段落结束早于开始`);
		}
		if (record.isInterlude !== true && record.isInterlude !== false) {
			throw new Error(`events[${index}].isInterlude 必须是布尔值`);
		}
		if (record.isTurningPoint !== true && record.isTurningPoint !== false) {
			throw new Error(`events[${index}].isTurningPoint 必须是布尔值`);
		}
		const timelineOrder =
			record.timelineOrder === null
				? null
				: requireInteger(
						record.timelineOrder,
						`events[${index}].timelineOrder`,
						1,
					);
		return {
			chapterOrdinal,
			seq,
			title: requireText(record.title, `events[${index}].title`),
			summary: requireText(record.summary, `events[${index}].summary`),
			digest: requireText(record.digest, `events[${index}].digest`),
			participants: requireStringList(
				record.participants,
				`events[${index}].participants`,
			),
			location: requireOptionalText(
				record.location,
				`events[${index}].location`,
			),
			timeText: requireOptionalText(
				record.timeText,
				`events[${index}].timeText`,
			),
			paragraphStart,
			paragraphEnd,
			isInterlude: record.isInterlude,
			timelineOrder,
			isTurningPoint: record.isTurningPoint,
		} satisfies CanonPackageEvent;
	});
	const voicesRaw = requireArray(value.voices, "voices");
	const voiceKeys = new Set<string>();
	const voices = voicesRaw.map((item, index) => {
		const record = requireObject(item, `voices[${index}]`);
		const chapterOrdinal = requireChapterOrdinal(
			record.chapterOrdinal,
			ordinals,
			`voices[${index}].chapterOrdinal`,
		);
		const ordinal = requireInteger(
			record.ordinal,
			`voices[${index}].ordinal`,
			1,
		);
		const key = `${chapterOrdinal}:${ordinal}`;
		if (voiceKeys.has(key)) {
			throw new Error(
				`原著包第 ${chapterOrdinal} 章的话术序号 ${ordinal} 重复`,
			);
		}
		voiceKeys.add(key);
		if (record.kind !== "speech" && record.kind !== "thought") {
			throw new Error(`voices[${index}].kind 只能是 speech 或 thought`);
		}
		return {
			chapterOrdinal,
			ordinal,
			character: requireText(record.character, `voices[${index}].character`),
			kind: record.kind,
			text: requireText(record.text, `voices[${index}].text`),
		} satisfies CanonPackageVoice;
	});
	const factsRaw = requireArray(value.facts, "facts");
	const facts = factsRaw.map((item, index) => {
		const record = requireObject(item, `facts[${index}]`);
		return {
			chapterOrdinal: requireChapterOrdinal(
				record.chapterOrdinal,
				ordinals,
				`facts[${index}].chapterOrdinal`,
			),
			entityName: requireText(record.entityName, `facts[${index}].entityName`),
			aliases: requireStringList(record.aliases, `facts[${index}].aliases`),
			entityKind: requireEntityKind(
				record.entityKind,
				`facts[${index}].entityKind`,
			),
			fact: requireText(record.fact, `facts[${index}].fact`),
		} satisfies CanonPackageFact;
	});
	return {
		format: CANON_PACKAGE_FORMAT,
		version: CANON_PACKAGE_VERSION,
		exportedAt: requireText(value.exportedAt, "exportedAt"),
		book,
		chapters,
		entities,
		events,
		voices,
		facts,
	};
}

/** 导出后写进下载文件的文件名；去掉路径分隔符与扩展名。 */
export function canonPackageFilename(
	store: StoryStore,
	bookId: string,
): string {
	const book = store.getCanonBook(bookId);
	if (book === null) throw new Error(`原著 ${bookId} 不存在`);
	const base = (book.filename ?? book.title)
		.replace(/\.txt$/i, "")
		.replace(/[\\/:*?"<>|]/g, "")
		.trim();
	return `${base.length === 0 ? "原著" : base}.canon.json`;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!isJsonObject(value)) throw new Error(`${label} 必须是对象`);
	return value;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
	return value;
}

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function requireOptionalText(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string")
		throw new Error(`${label} 必须是字符串或 null`);
	return value;
}

function requireInteger(value: unknown, label: string, min: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
		throw new Error(`${label} 必须是大于等于 ${min} 的整数`);
	}
	return value;
}

function requireBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
	return value;
}

function requireStringList(value: unknown, label: string): readonly string[] {
	const list = requireArray(value, label);
	return list.map((item, index) => requireText(item, `${label}[${index}]`));
}

function requireEntityKind(value: unknown, label: string): CanonEntityKind {
	if (!isCanonEntityKind(value)) {
		throw new Error(`${label} 必须是 人物、地点、势力、物品 或 其他`);
	}
	return value;
}

function requireChapterOrdinal(
	value: unknown,
	ordinals: ReadonlySet<number>,
	label: string,
): number {
	const ordinal = requireInteger(value, label, 1);
	if (!ordinals.has(ordinal)) {
		throw new Error(`${label} 引用了不存在的第 ${ordinal} 章`);
	}
	return ordinal;
}

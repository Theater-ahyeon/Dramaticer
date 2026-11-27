/**
 * 原著分章：按卷、章、序章、番外等标题切分，章内保留原文分段。
 * 标题规则覆盖常见中文与英文小说写法；正文里的「第三天」这类句子不会被当成标题。
 */
import type { CanonChapterKind, NewCanonChapter } from "./types.js";

/** 标题行的长度上限；超过这个长度的行按正文处理。 */
const HEADING_MAX_CHARS = 60;

/** 没有显式标题时，按这个字数把正文切成若干章。 */
const FALLBACK_CHUNK_CHARS = 6000;

/** 第一个标题之前的文字至少这么多字才单独成章，否则当作书名页丢弃。 */
const LEADING_MIN_CHARS = 60;

const CJK_NUMBER = "〇零一二三四五六七八九十百千两0-9０-９";

const VOLUME_PATTERNS: readonly RegExp[] = [
	new RegExp(`^第[\\s　]*[${CJK_NUMBER}]+[\\s　]*卷`),
	new RegExp(`^卷[\\s　]*[${CJK_NUMBER}]+`),
	/^(volume|vol\.?|book|part)\s+([0-9]+|[ivxlcdm]+)\b/i,
];

const CHAPTER_PATTERNS: readonly RegExp[] = [
	new RegExp(`^第[\\s　]*[${CJK_NUMBER}]+[\\s　]*[章回节]`),
	/^(chapter|chap\.?)\s+([0-9]+|[ivxlcdm]+)\b/i,
];

const SPECIAL_CHAPTER_PATTERNS: readonly {
	readonly pattern: RegExp;
	readonly kind: CanonChapterKind;
}[] = [
	{
		pattern: /^(序章|楔子|引子|序幕|序言|序)(?:[\s　:：·、.．-].*)?$/,
		kind: "prologue",
	},
	{
		pattern: /^(尾声|终章|后记|尾记|大结局)(?:[\s　:：·、.．-].*)?$/,
		kind: "epilogue",
	},
	{
		pattern: /^(番外篇?|外传|前传|附录)(?:[\s　:：·、.．-].*)?$/,
		kind: "extra",
	},
	{
		pattern: /^(prologue|foreword|preface)(?:\b.*)?$/i,
		kind: "prologue",
	},
	{ pattern: /^(epilogue|afterword)(?:\b.*)?$/i, kind: "epilogue" },
	{ pattern: /^(interlude|extra|side story)(?:\b.*)?$/i, kind: "extra" },
];

/** 数字序号标题：`12 山门`、`12. 山门`、`12、山门`。 */
const NUMBERED_TITLE_PATTERN =
	/^[0-9０-９]{1,4}(?:[\s　]+|[.、．)）:：])[^\s　].{0,40}$/;

const SENTENCE_PUNCTUATION = /[，。！？；：、,.!?;:…—]/;
const TITLE_MARKUP = /[*\-=_~#|/\\]/;

function startsWithVolumePattern(line: string): boolean {
	return VOLUME_PATTERNS.some((pattern) => pattern.test(line));
}

function startsWithChapterPattern(line: string): boolean {
	return CHAPTER_PATTERNS.some((pattern) => pattern.test(line));
}

function isHeadingSized(line: string): boolean {
	return line.length <= HEADING_MAX_CHARS;
}

function specialKind(line: string): CanonChapterKind | null {
	for (const entry of SPECIAL_CHAPTER_PATTERNS) {
		if (entry.pattern.test(line)) return entry.kind;
	}
	return null;
}

/** 无标号的短行：只有前后都是空行、上一章已有内容、下一行是正文时才当标题。 */
function isBareTitle(line: string): boolean {
	if (line.length === 0 || line.length > 16) return false;
	if (SENTENCE_PUNCTUATION.test(line)) return false;
	if (TITLE_MARKUP.test(line)) return false;
	if (/^[0-9０-９]/.test(line)) return false;
	// 「第三天」「第一次」这类时间与次数说法在正文里常单独成段。
	if (line.startsWith("第")) return false;
	return true;
}

function nextNonEmptyLine(
	lines: readonly string[],
	from: number,
): string | null {
	for (let index = from + 1; index < lines.length; index += 1) {
		const trimmed = (lines[index] ?? "").trim();
		if (trimmed.length > 0) return trimmed;
	}
	return null;
}

export function countCanonChars(paragraphs: readonly string[]): number {
	let count = 0;
	for (const paragraph of paragraphs) {
		count += paragraph.replace(/\s/g, "").length;
	}
	return count;
}

interface MutableChapter {
	readonly volumeTitle: string | null;
	readonly title: string;
	readonly kind: CanonChapterKind;
	readonly paragraphs: string[];
}

function fallbackChapters(paragraphs: readonly string[]): MutableChapter[] {
	if (countCanonChars(paragraphs) <= FALLBACK_CHUNK_CHARS) {
		return [
			{
				volumeTitle: null,
				title: "全文",
				kind: "chapter",
				paragraphs: [...paragraphs],
			},
		];
	}
	const chunks: MutableChapter[] = [];
	let current: string[] = [];
	let currentChars = 0;
	const flush = () => {
		if (current.length === 0) return;
		chunks.push({
			volumeTitle: null,
			title: `第 ${chunks.length + 1} 部分`,
			kind: "chapter",
			paragraphs: current,
		});
		current = [];
		currentChars = 0;
	};
	for (const paragraph of paragraphs) {
		const chars = countCanonChars([paragraph]);
		if (current.length > 0 && currentChars + chars > FALLBACK_CHUNK_CHARS) {
			flush();
		}
		current.push(paragraph);
		currentChars += chars;
	}
	flush();
	return chunks;
}

/**
 * 把原文切成章。没有识别到任何标题时按字数兜底；
 * 标题之前的书名页只有达到一定字数才作为「卷首」保留。
 */
export function splitCanonText(text: string): NewCanonChapter[] {
	const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	const chapters: MutableChapter[] = [];
	const leading: string[] = [];
	let current: MutableChapter | null = null;
	let volumeTitle: string | null = null;
	let sawHeading = false;
	let leadingResolved = false;

	const flush = () => {
		if (current !== null && current.paragraphs.length > 0) {
			chapters.push(current);
		}
		current = null;
	};
	const includeLeading = () => {
		if (leadingResolved) return;
		leadingResolved = true;
		if (leading.length > 0 && countCanonChars(leading) >= LEADING_MIN_CHARS) {
			chapters.push({
				volumeTitle: null,
				title: "卷首",
				kind: "chapter",
				paragraphs: [...leading],
			});
		}
	};
	const start = (title: string, kind: CanonChapterKind) => {
		flush();
		current = { volumeTitle, title, kind, paragraphs: [] };
	};
	const currentCharCount = () =>
		current === null ? 0 : countCanonChars(current.paragraphs);
	const appendParagraph = (line: string) => {
		if (current === null) return;
		current.paragraphs.push(line);
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = (lines[index] ?? "").trim();
		if (line.length === 0) continue;
		const headingSized = isHeadingSized(line);
		if (headingSized && startsWithVolumePattern(line)) {
			flush();
			includeLeading();
			sawHeading = true;
			volumeTitle = line;
			continue;
		}
		if (headingSized) {
			const kind = specialKind(line);
			if (kind !== null) {
				includeLeading();
				sawHeading = true;
				start(line, kind);
				continue;
			}
			if (startsWithChapterPattern(line)) {
				includeLeading();
				sawHeading = true;
				start(line, "chapter");
				continue;
			}
			if (
				NUMBERED_TITLE_PATTERN.test(line) &&
				!SENTENCE_PUNCTUATION.test(line)
			) {
				includeLeading();
				sawHeading = true;
				start(line, "chapter");
				continue;
			}
			if (
				currentCharCount() >= 20 &&
				(index === 0 || (lines[index - 1] ?? "").trim().length === 0) &&
				(index + 1 >= lines.length ||
					(lines[index + 1] ?? "").trim().length === 0) &&
				isBareTitle(line) &&
				(nextNonEmptyLine(lines, index)?.length ?? 0) >= 20
			) {
				includeLeading();
				sawHeading = true;
				start(line, "chapter");
				continue;
			}
		}
		if (current === null) {
			if (!sawHeading) {
				leading.push(line);
				continue;
			}
			start("卷首", "chapter");
		}
		appendParagraph(line);
	}
	flush();

	const result =
		sawHeading && chapters.length > 0 ? chapters : fallbackChapters(leading);
	if (result.length === 0) {
		throw new Error("原著里没有可分章的正文");
	}
	return result.map((chapter) => ({
		volumeTitle: chapter.volumeTitle,
		title: chapter.title,
		kind: chapter.kind,
		paragraphs: chapter.paragraphs,
	}));
}

/** 默认书名：优先玩家填写的书名，其次文件名去掉扩展名。 */
export function canonBookTitle(
	title: string | null | undefined,
	filename: string | null | undefined,
): string {
	const trimmedTitle = title?.trim() ?? "";
	if (trimmedTitle.length > 0) return trimmedTitle;
	const name = filename?.trim() ?? "";
	const base = name
		.replace(/^.*[\\/]/, "")
		.replace(/\.[^.]+$/u, "")
		.trim();
	return base.length > 0 ? base : "未命名原著";
}

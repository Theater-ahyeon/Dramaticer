import { existsSync } from "node:fs";
import path from "node:path";
import {
	type JsonObject,
	type JsonValue,
	isJsonObject,
} from "@dramaticer/core";
import Database from "better-sqlite3";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import {
	STORY_CORPORA,
	type StoryCorpus,
	openSnapshot,
	storyCorpus,
} from "../health/manifest.js";
import { parseMessageIndex } from "../node-id.js";
import type { QuestionKind, RetrievalQuestion } from "./question-files.js";
import {
	readQuestionFile,
	sanitizeFileName,
	storyIdOf,
} from "./question-files.js";
import { addCounts, emptyCounts, requireNonEmpty } from "./shared.js";
import type { SkippedStory } from "./shared.js";

const KIND_ORDER: readonly QuestionKind[] = ["state", "event"];
const ANSWER_LENGTH_BUCKETS: readonly {
	readonly label: string;
	readonly min: number;
	readonly max: number;
}[] = [
	{ label: "规范化后为空", min: 0, max: 0 },
	{ label: "1 字符", min: 1, max: 1 },
	{ label: "2–3 字符", min: 2, max: 3 },
	{ label: "4–9 字符", min: 4, max: 9 },
	{ label: "10 字符以上", min: 10, max: Number.POSITIVE_INFINITY },
];

export interface AcuScore {
	readonly questionCount: number;
	readonly coveredCount: number;
}

export interface AcuKindScore extends AcuScore {
	readonly kind: QuestionKind;
}

/** 规范化之后答案的字符数分档；短答案在表格里容易偶然命中。 */
export interface AcuLengthScore extends AcuScore {
	readonly label: string;
}

export interface AcuStoryScore extends AcuScore {
	readonly story: string;
	readonly corpus: StoryCorpus;
	/** 这个对话里是否存在任何 ACU 表格数据；没有就是“不适用” */
	readonly applicable: boolean;
	/** 有表格内容的提问楼层数 */
	readonly snapshotFloorCount: number;
	readonly byKind: readonly AcuKindScore[];
	readonly byAnswerLength: readonly AcuLengthScore[];
}

export interface AcuCorpusScore extends AcuScore {
	readonly corpus: StoryCorpus;
	readonly chatCount: number;
	readonly skippedStoryCount: number;
	readonly byKind: readonly AcuKindScore[];
	readonly byAnswerLength: readonly AcuLengthScore[];
}

export interface AcuBaseline {
	readonly generatedAt: string;
	readonly stories: readonly AcuStoryScore[];
	readonly corpora: readonly AcuCorpusScore[];
	readonly skippedStories: readonly SkippedStory[];
	readonly byKind: readonly AcuKindScore[];
	readonly byAnswerLength: readonly AcuLengthScore[];
	readonly total: AcuScore;
}

export interface EvaluateAcuCoverageOptions {
	readonly chatPath: string;
	readonly storyId: string;
	readonly corpus: StoryCorpus;
	readonly questions: readonly RetrievalQuestion[];
}

export interface CollectAcuBaselineOptions {
	readonly rawRoot: string;
	readonly evalsetRoot: string;
	readonly generatedAt?: string;
}

const SCORE_KEYS = ["questionCount", "coveredCount"] as const;

type MutableScore = Record<(typeof SCORE_KEYS)[number], number>;

interface HashSheetSnapshot {
	readonly rows: readonly (readonly string[])[];
}

interface SqlOperation {
	readonly kind: "sql_sheet_batch" | "sql_batch";
	readonly statements: readonly string[];
	readonly params: readonly (readonly unknown[])[];
}

/** 表格里的文本和答案都按这个规则规范化后再做包含判断。 */
export function normalizeForTableMatch(text: string): string {
	return text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * ACU 对照组：取提问楼层之前最近的表格内容，判断题目的标准答案是否原样
 * 出现在某一个单元格里。表格有三处来源：对话头部 `sheets` 的单元格历史
 * 加上逐楼层的 `hash_sheets`、消息里的 `TavernDB_ACU_Data`，以及
 * `TavernDB_ACU_IsolatedData` 里记录的 SQL 更新。
 */
export async function evaluateAcuCoverage(
	options: EvaluateAcuCoverageOptions,
): Promise<AcuStoryScore> {
	const storyId = requireNonEmpty(options.storyId, "故事 id");
	const questionsByFloor = new Map<number, RetrievalQuestion[]>();
	for (const question of options.questions) {
		if (question.story !== storyId) {
			throw new Error(
				`题目 ${question.id} 属于故事 ${question.story}，与 ${storyId} 不一致`,
			);
		}
		const askIndex = parseMessageIndex(storyId, question.askAtNode);
		const bucket = questionsByFloor.get(askIndex);
		if (bucket) bucket.push(question);
		else questionsByFloor.set(askIndex, [question]);
	}

	const cells = new Map<string, string>();
	let hashSheets: readonly HashSheetSnapshot[] | null = null;
	const fullContents = new Map<string, readonly string[]>();
	const database = new AcuTableDatabase();
	let applicable = false;
	let snapshotFloorCount = 0;
	const seenFloors = new Set<number>();
	const byKind = new Map<QuestionKind, MutableScore>();
	const byLength = new Map<string, MutableScore>();
	const total = emptyCounts(SCORE_KEYS);

	try {
		for await (const entry of parseChatJsonlFile(options.chatPath)) {
			if (entry.kind === "header") {
				readCellValues(entry.header.chatMetadata, cells);
				if (cells.size > 0) applicable = true;
				continue;
			}
			const { message } = entry;
			const asked = questionsByFloor.get(message.index);
			if (asked) {
				seenFloors.add(message.index);
				const tableValues = collectSnapshotValues(
					cells,
					hashSheets,
					fullContents,
					database,
				)
					.map(normalizeForTableMatch)
					.filter((value) => value !== "");
				if (tableValues.length > 0) snapshotFloorCount += 1;
				for (const question of asked) {
					const answerText = normalizeForTableMatch(question.answer);
					const covered =
						answerText !== "" &&
						tableValues.some((value) => value.includes(answerText));
					let kindScore = byKind.get(question.kind);
					if (!kindScore) {
						kindScore = emptyCounts(SCORE_KEYS);
						byKind.set(question.kind, kindScore);
					}
					recordCovered(kindScore, covered);
					const bucket = answerLengthBucket(answerText.length);
					let lengthScore = byLength.get(bucket);
					if (!lengthScore) {
						lengthScore = emptyCounts(SCORE_KEYS);
						byLength.set(bucket, lengthScore);
					}
					recordCovered(lengthScore, covered);
					recordCovered(total, covered);
				}
			}

			const messageHash = readHashSheets(message.raw);
			if (messageHash) {
				hashSheets = messageHash;
				applicable = true;
			}
			if (readFullSheetContents(message.raw, fullContents)) applicable = true;
			const operations = readSqlOperations(message.raw);
			if (operations.length > 0) {
				applicable = true;
				for (const operation of operations) database.apply(operation);
			}
		}
	} finally {
		database.close();
	}

	const missingFloors = [...questionsByFloor.entries()]
		.filter(([floor]) => !seenFloors.has(floor))
		.map(([, questions]) => ({
			floor: questions[0]?.askAtNode ?? "",
			ids: questions.map((question) => question.id),
		}));
	if (missingFloors.length > 0) {
		const detail = missingFloors
			.map(({ floor, ids }) => `${floor}（题目 ${ids.join("、")}）`)
			.join("；");
		throw new Error(`故事 ${storyId} 缺少提问楼层：${detail}`);
	}

	const kindScores: AcuKindScore[] = [];
	for (const kind of KIND_ORDER) {
		const score = byKind.get(kind);
		if (score) kindScores.push({ kind, ...score });
	}
	const lengthScores: AcuLengthScore[] = [];
	for (const bucket of ANSWER_LENGTH_BUCKETS) {
		const score = byLength.get(bucket.label);
		if (score) lengthScores.push({ label: bucket.label, ...score });
	}
	return {
		story: storyId,
		corpus: options.corpus,
		applicable,
		snapshotFloorCount,
		byKind: kindScores,
		byAnswerLength: lengthScores,
		...total,
	};
}

export async function collectAcuBaseline(
	options: CollectAcuBaselineOptions,
): Promise<AcuBaseline> {
	const snapshot = await openSnapshot(options.rawRoot);
	const chatFiles = snapshot.filesByRole("chat");
	if (chatFiles.length === 0) {
		throw new Error("manifest 里没有 chat");
	}

	const stories: AcuStoryScore[] = [];
	const skippedStories: SkippedStory[] = [];
	for (const file of chatFiles) {
		const story = storyIdOf(file);
		const corpus = storyCorpus(file);
		const baseName = sanitizeFileName(story);
		const chatPath = await snapshot.resolveFile(file);
		const questions: RetrievalQuestion[] = [];
		let skipReason: string | null = null;
		for (const kind of KIND_ORDER) {
			const questionPath = path.join(
				options.evalsetRoot,
				`${kind}-${baseName}.jsonl`,
			);
			if (!existsSync(questionPath)) {
				if (kind === "state") {
					if (corpus === "legacy") {
						throw new Error(`缺少状态题文件：${questionPath}`);
					}
					skipReason = "缺少状态题文件";
					break;
				}
				continue;
			}
			questions.push(...(await readQuestionFile(questionPath, kind)));
		}
		if (skipReason !== null) {
			skippedStories.push({ story, corpus, reason: skipReason });
			continue;
		}
		stories.push(
			await evaluateAcuCoverage({
				chatPath,
				storyId: story,
				corpus,
				questions,
			}),
		);
	}

	const corpora: AcuCorpusScore[] = [];
	for (const corpus of STORY_CORPORA) {
		const corpusStories = stories.filter((story) => story.corpus === corpus);
		const skipped = skippedStories.filter((story) => story.corpus === corpus);
		if (corpusStories.length === 0 && skipped.length === 0) continue;
		const aggregate = aggregateAcuScores(corpusStories);
		corpora.push({
			corpus,
			chatCount: corpusStories.length + skipped.length,
			skippedStoryCount: skipped.length,
			...aggregate.total,
			byKind: aggregate.byKind,
			byAnswerLength: aggregate.byAnswerLength,
		});
	}

	const overall = aggregateAcuScores(stories);
	return {
		generatedAt: options.generatedAt ?? new Date().toISOString(),
		stories,
		corpora,
		skippedStories,
		byKind: overall.byKind,
		byAnswerLength: overall.byAnswerLength,
		total: overall.total,
	};
}

function aggregateAcuScores(stories: readonly AcuStoryScore[]): {
	readonly total: AcuScore;
	readonly byKind: readonly AcuKindScore[];
	readonly byAnswerLength: readonly AcuLengthScore[];
} {
	const total = emptyCounts(SCORE_KEYS);
	const byKind = new Map<QuestionKind, MutableScore>();
	const byLength = new Map<string, MutableScore>();
	for (const story of stories) {
		if (!story.applicable) continue;
		addCounts(total, story);
		for (const score of story.byKind) {
			let target = byKind.get(score.kind);
			if (!target) {
				target = emptyCounts(SCORE_KEYS);
				byKind.set(score.kind, target);
			}
			addCounts<(typeof SCORE_KEYS)[number]>(target, score);
		}
		for (const score of story.byAnswerLength) {
			let target = byLength.get(score.label);
			if (!target) {
				target = emptyCounts(SCORE_KEYS);
				byLength.set(score.label, target);
			}
			addCounts<(typeof SCORE_KEYS)[number]>(target, score);
		}
	}
	const kindScores: AcuKindScore[] = [];
	for (const kind of KIND_ORDER) {
		const score = byKind.get(kind);
		if (score) kindScores.push({ kind, ...score });
	}
	const lengthScores: AcuLengthScore[] = [];
	for (const bucket of ANSWER_LENGTH_BUCKETS) {
		const score = byLength.get(bucket.label);
		if (score) lengthScores.push({ label: bucket.label, ...score });
	}
	return { total, byKind: kindScores, byAnswerLength: lengthScores };
}

function answerLengthBucket(length: number): string {
	for (const bucket of ANSWER_LENGTH_BUCKETS) {
		if (length >= bucket.min && length <= bucket.max) return bucket.label;
	}
	throw new Error(`答案长度 ${length} 没有对应的分档`);
}

function recordCovered(score: MutableScore, covered: boolean): void {
	score.questionCount += 1;
	if (covered) score.coveredCount += 1;
}

function collectSnapshotValues(
	cells: ReadonlyMap<string, string>,
	hashSheets: readonly HashSheetSnapshot[] | null,
	fullContents: ReadonlyMap<string, readonly string[]>,
	database: AcuTableDatabase,
): string[] {
	const values: string[] = [];
	if (hashSheets) {
		for (const sheet of hashSheets) {
			for (const row of sheet.rows) {
				for (const uid of row) {
					const value = cells.get(uid);
					if (value !== undefined && value !== "") values.push(value);
				}
			}
		}
	}
	for (const sheetValues of fullContents.values()) values.push(...sheetValues);
	values.push(...database.values());
	return values;
}

function readCellValues(
	chatMetadata: JsonValue,
	target: Map<string, string>,
): void {
	if (!isJsonObject(chatMetadata)) return;
	const sheets = chatMetadata.sheets;
	if (!Array.isArray(sheets)) return;
	for (const sheet of sheets) {
		if (!isJsonObject(sheet)) continue;
		if (sheet.enable === false) continue;
		const history = sheet.cellHistory;
		if (!Array.isArray(history)) continue;
		for (const cell of history) {
			if (!isJsonObject(cell)) continue;
			const uid = cell.uid;
			const data = cell.data;
			if (typeof uid !== "string" || !isJsonObject(data)) continue;
			const value = data.value;
			if (typeof value === "string" && value !== "") target.set(uid, value);
		}
	}
}

function readHashSheets(raw: JsonObject): readonly HashSheetSnapshot[] | null {
	const hashes = raw.hash_sheets;
	if (!isJsonObject(hashes)) return null;
	const snapshots: HashSheetSnapshot[] = [];
	for (const [, value] of Object.entries(hashes)) {
		if (!Array.isArray(value)) continue;
		const rows: string[][] = [];
		for (const row of value) {
			if (!Array.isArray(row)) continue;
			rows.push(row.filter((uid): uid is string => typeof uid === "string"));
		}
		snapshots.push({ rows });
	}
	return snapshots;
}

function readFullSheetContents(
	raw: JsonObject,
	target: Map<string, readonly string[]>,
): boolean {
	let found = false;
	const data = raw.TavernDB_ACU_Data;
	if (data !== undefined && collectSheetContents(data, target)) found = true;
	const isolated = raw.TavernDB_ACU_IsolatedData;
	if (isolated !== undefined && collectIndependentData(isolated, target)) {
		found = true;
	}
	return found;
}

/** 只取 `independentData`（整表内容）；`storageFrame` 的日志交给 SQL 重放。 */
function collectIndependentData(
	value: JsonValue,
	target: Map<string, readonly string[]>,
): boolean {
	if (Array.isArray(value)) {
		let found = false;
		for (const item of value) {
			if (collectIndependentData(item, target)) found = true;
		}
		return found;
	}
	if (!isJsonObject(value)) return false;
	let found = false;
	const independent = value.independentData;
	if (independent !== undefined && collectSheetContents(independent, target)) {
		found = true;
	}
	for (const [key, item] of Object.entries(value)) {
		if (key === "independentData") continue;
		if (collectIndependentData(item, target)) found = true;
	}
	return found;
}

function collectSheetContents(
	value: JsonValue,
	target: Map<string, readonly string[]>,
): boolean {
	if (Array.isArray(value)) {
		let found = false;
		for (const item of value) {
			if (collectSheetContents(item, target)) found = true;
		}
		return found;
	}
	if (!isJsonObject(value)) return false;
	const uid = value.uid;
	const content = value.content;
	if (typeof uid === "string" && Array.isArray(content)) {
		const values = collectCellValues(content);
		if (values.length > 0) {
			target.set(uid, values);
			return true;
		}
		return false;
	}
	let found = false;
	for (const item of Object.values(value)) {
		if (collectSheetContents(item, target)) found = true;
	}
	return found;
}

function collectCellValues(rows: readonly JsonValue[]): string[] {
	const values: string[] = [];
	for (const row of rows) {
		if (!Array.isArray(row)) continue;
		for (const item of row) {
			if (typeof item === "string" && item !== "") values.push(item);
			else if (typeof item === "number" && Number.isFinite(item)) {
				values.push(String(item));
			}
		}
	}
	return values;
}

function readSqlOperations(raw: JsonObject): SqlOperation[] {
	const isolated = raw.TavernDB_ACU_IsolatedData;
	if (isolated === undefined) return [];
	const operations: SqlOperation[] = [];
	collectSqlOperations(isolated, operations);
	return operations;
}

function collectSqlOperations(value: JsonValue, target: SqlOperation[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectSqlOperations(item, target);
		return;
	}
	if (!isJsonObject(value)) return;
	const kind = value.kind;
	if (kind === "sql_sheet_batch" || kind === "sql_batch") {
		const statements = value.statements;
		if (!Array.isArray(statements)) {
			throw new Error(`${kind} 缺少 statements`);
		}
		const params: unknown[][] = [];
		if (Array.isArray(value.params)) {
			for (const item of value.params) {
				if (Array.isArray(item)) params.push([...item]);
			}
		}
		target.push({
			kind,
			statements: statements.map((statement, index) => {
				if (typeof statement !== "string") {
					throw new Error(`${kind} 的第 ${index} 条语句不是字符串`);
				}
				return statement;
			}),
			params,
		});
	}
	for (const item of Object.values(value)) {
		collectSqlOperations(item, target);
	}
}

/**
 * `TavernDB_ACU_IsolatedData` 把表格变化记录成一串 SQL。这里在内存数据库里
 * 按顺序重放：第一次插入某张表时按 INSERT 的列名建表，其余语句原样执行。
 * 语句有问题就直接抛错，不做跳过。
 */
class AcuTableDatabase {
	private readonly database: Database.Database;
	private readonly knownTables = new Set<string>();

	constructor() {
		this.database = new Database(":memory:");
	}

	apply(operation: SqlOperation): void {
		if (operation.kind === "sql_sheet_batch") {
			for (const statement of operation.statements) {
				this.ensureTable(statement);
				this.database.exec(statement);
			}
			return;
		}
		operation.statements.forEach((statement, index) => {
			this.ensureTable(statement);
			const params = operation.params[index] ?? [];
			this.database.prepare(statement).run(...params);
		});
	}

	values(): string[] {
		const tables = this.database
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
			)
			.all() as { name: string }[];
		const values: string[] = [];
		for (const { name } of tables) {
			const rows = this.database
				.prepare(`SELECT * FROM ${quoteIdentifier(name)}`)
				.all() as Record<string, unknown>[];
			for (const row of rows) {
				for (const value of Object.values(row)) {
					if (value === null || value === undefined) continue;
					const text = String(value);
					if (text !== "") values.push(text);
				}
			}
		}
		return values;
	}

	close(): void {
		this.database.close();
	}

	private ensureTable(statement: string): void {
		const match = statement.match(
			/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+`?([A-Za-z_]\w*)`?\s*\(([^)]*)\)/i,
		);
		if (!match) return;
		const table = match[1];
		const columnList = match[2];
		if (table === undefined || columnList === undefined) return;
		if (this.knownTables.has(table)) return;
		const columns = columnList
			.split(",")
			.map((column) => column.trim().replace(/^`|`$/g, ""))
			.filter((column) => column !== "");
		if (columns.length === 0) {
			throw new Error(`无法从语句里识别表 ${table} 的列：${statement}`);
		}
		const definitions = columns.map((column) =>
			column.toLowerCase() === "row_id"
				? `${quoteIdentifier(column)} INTEGER PRIMARY KEY`
				: `${quoteIdentifier(column)} TEXT`,
		);
		if (!columns.some((column) => column.toLowerCase() === "row_id")) {
			definitions.unshift(`${quoteIdentifier("row_id")} INTEGER PRIMARY KEY`);
		}
		this.database.exec(
			`CREATE TABLE ${quoteIdentifier(table)} (${definitions.join(", ")})`,
		);
		this.knownTables.add(table);
	}
}

function quoteIdentifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

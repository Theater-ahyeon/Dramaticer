import type { Dirent, Stats } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { JsonObject } from "../json.js";
import { normalizeRetrievalText } from "../retrieval/chunk-index.js";
import type { DeepToolDefinition } from "../tools/registry.js";

export const DOCS_SEARCH_TOOL_NAME = "docs_search";
export const DEFAULT_DOCS_SEARCH_LIMIT = 5;
export const MAX_DOCS_SEARCH_LIMIT = 10;

const MAX_SNIPPET_CHARS = 160;
const MAX_MATCHED_TERMS = 8;
const REQUIRED_DOC_FILES = ["DESIGN.md", "dev/TASKS.md", "dev/HUMAN.md"];
const REPORT_DIR = "dev/reports";

/** 一次文档检索的命中；`line` 是片段在文档里的起始行号。 */
export interface AssistantDocsHit {
	readonly path: string;
	readonly title: string;
	readonly line: number;
	readonly snippet: string;
	readonly matchedTerms: readonly string[];
	readonly score: number;
}

interface ParsedDocBlock {
	readonly path: string;
	readonly title: string;
	readonly line: number;
	readonly text: string;
}

interface IndexedDocBlock {
	readonly block: ParsedDocBlock;
	readonly titleNormalized: string;
	readonly textNormalized: string;
	readonly titleTrigrams: ReadonlySet<string>;
	readonly textTrigrams: ReadonlySet<string>;
}

interface DocsFile {
	readonly path: string;
	readonly text: string;
}

/**
 * 内置文档的只读索引：启动时把 DESIGN、任务清单、人类事项与各份报告
 * 按标题与文本块切分，查询用 trigram 计分；查询少于三个字符时退回
 * 子串匹配，与助手会话搜索的口径一致。
 */
export class AssistantDocsIndex {
	readonly #root: string;
	readonly #blocks: readonly IndexedDocBlock[];
	readonly #files: readonly string[];

	private constructor(
		root: string,
		files: readonly string[],
		blocks: readonly IndexedDocBlock[],
	) {
		this.#root = root;
		this.#files = files;
		this.#blocks = blocks;
	}

	static async load(docsRoot: string): Promise<AssistantDocsIndex> {
		if (typeof docsRoot !== "string" || docsRoot.trim().length === 0) {
			throw new Error("文档目录必须是非空路径");
		}
		const root = path.resolve(docsRoot);
		let info: Stats;
		try {
			info = await stat(root);
		} catch (error) {
			if (errorCode(error) === "ENOENT") {
				throw new Error(`文档目录不存在：${root}`);
			}
			throw new Error(`无法访问文档目录：${root}（${errorMessage(error)}）`);
		}
		if (!info.isDirectory()) {
			throw new Error(`文档路径不是目录：${root}`);
		}
		const files: DocsFile[] = [];
		for (const relativePath of REQUIRED_DOC_FILES) {
			const text = await readDocFile(
				path.join(root, ...relativePath.split("/")),
			);
			if (text !== null) files.push({ path: relativePath, text });
		}
		const reportNames = await listReportFiles(
			path.join(root, ...REPORT_DIR.split("/")),
		);
		for (const name of reportNames) {
			const relativePath = `${REPORT_DIR}/${name}`;
			const text = await readDocFile(
				path.join(root, ...relativePath.split("/")),
			);
			if (text !== null) files.push({ path: relativePath, text });
		}
		if (files.length === 0) {
			throw new Error(`文档目录下没有可读文档：${root}`);
		}
		const blocks: IndexedDocBlock[] = [];
		for (const file of files) {
			for (const block of parseDocBlocks(file.path, file.text)) {
				blocks.push(indexDocBlock(block));
			}
		}
		return new AssistantDocsIndex(
			root,
			files.map((file) => file.path),
			blocks,
		);
	}

	get root(): string {
		return this.#root;
	}

	/** 已读取的文档相对路径，按内置文件、任务清单、人类事项、报告的顺序。 */
	get files(): readonly string[] {
		return this.#files;
	}

	search(query: string, limit = DEFAULT_DOCS_SEARCH_LIMIT): AssistantDocsHit[] {
		if (typeof query !== "string" || query.trim().length === 0) {
			throw new Error("文档检索词必须是非空字符串");
		}
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > MAX_DOCS_SEARCH_LIMIT
		) {
			throw new Error(
				`limit 必须是 1 到 ${MAX_DOCS_SEARCH_LIMIT} 之间的整数：${String(limit)}`,
			);
		}
		const normalized = normalizeRetrievalText(query);
		if (normalized.length === 0) {
			throw new Error("文档检索词必须包含可检索的文字");
		}
		const useTrigrams = [...normalized].length >= 3;
		const queryTrigrams = useTrigrams ? buildTrigrams(normalized) : null;
		const literal = query.trim();
		const scored: { block: IndexedDocBlock; score: number; terms: string[] }[] =
			[];
		for (const block of this.#blocks) {
			if (queryTrigrams === null) {
				const titleHits = block.titleNormalized.includes(normalized) ? 2 : 0;
				const textHits = countOccurrences(block.textNormalized, normalized);
				const score = titleHits + textHits;
				if (score === 0) continue;
				scored.push({ block, score, terms: [literal] });
				continue;
			}
			const titleHits = [...queryTrigrams].filter((gram) =>
				block.titleTrigrams.has(gram),
			);
			const textHits = [...queryTrigrams].filter((gram) =>
				block.textTrigrams.has(gram),
			);
			const score = titleHits.length * 2 + textHits.length;
			if (score === 0) continue;
			const terms = [...new Set([...titleHits, ...textHits])].slice(
				0,
				MAX_MATCHED_TERMS,
			);
			scored.push({ block, score, terms });
		}
		scored.sort((left, right) => right.score - left.score);
		return scored.slice(0, limit).map(({ block, score, terms }) => ({
			path: block.block.path,
			title: block.block.title,
			line: block.block.line,
			snippet: snippetFor(block.block.text, terms),
			matchedTerms: terms,
			score,
		}));
	}
}

/** `docs_search` 工具：只读检索内置文档，不访问网络，也不调用模型。 */
export function createDocsSearchTool(
	index: AssistantDocsIndex,
): DeepToolDefinition {
	return {
		name: DOCS_SEARCH_TOOL_NAME,
		description:
			"检索内置文档（设计、任务清单、人类事项与各份报告）。返回文档路径、标题、片段与匹配词；只读。",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", minLength: 1 },
				limit: {
					type: "integer",
					minimum: 1,
					maximum: MAX_DOCS_SEARCH_LIMIT,
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
		permission: "read",
		progressLabel: "检索文档……",
		execute: async (args: JsonObject): Promise<string> => {
			for (const key of Object.keys(args)) {
				if (key !== "query" && key !== "limit") {
					throw new Error(`不接受参数 ${key}`);
				}
			}
			const query = args.query;
			if (typeof query !== "string" || query.trim().length === 0) {
				throw new Error("query 必须是非空字符串");
			}
			const limit =
				args.limit === undefined
					? DEFAULT_DOCS_SEARCH_LIMIT
					: typeof args.limit === "number"
						? args.limit
						: Number.NaN;
			const hits = index.search(query, limit);
			if (hits.length === 0) {
				return `文档检索「${query.trim()}」没有命中；内置文档里没有相关记录。`;
			}
			const lines = [`文档检索「${query.trim()}」命中 ${hits.length} 段：`];
			for (const [position, hit] of hits.entries()) {
				lines.push(
					`${position + 1}. ${hit.path}:${hit.line} 标题「${hit.title}」`,
				);
				lines.push(`   匹配词：${hit.matchedTerms.join("、")}`);
				lines.push(`   片段：${hit.snippet}`);
			}
			return lines.join("\n");
		},
	};
}

async function readDocFile(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return null;
		throw new Error(`读取文档失败：${filePath}（${errorMessage(error)}）`);
	}
}

async function listReportFiles(reportDir: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(reportDir, { withFileTypes: true });
	} catch (error) {
		if (errorCode(error) === "ENOENT") return [];
		throw new Error(`读取报告目录失败：${reportDir}（${errorMessage(error)}）`);
	}
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));
}

function parseDocBlocks(relativePath: string, text: string): ParsedDocBlock[] {
	const lines = text.split(/\r?\n/);
	const blocks: ParsedDocBlock[] = [];
	let headings: { level: number; title: string }[] = [];
	let title = relativePath;
	let blockLines: string[] = [];
	let blockLine = 1;
	const flush = (): void => {
		const content = blockLines.join("\n").trim();
		if (content.length > 0) {
			blocks.push({
				path: relativePath,
				title,
				line: blockLine,
				text: content,
			});
		}
		blockLines = [];
	};
	for (const [offset, line] of lines.entries()) {
		const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading !== null) {
			flush();
			const level = (heading[1] ?? "").length;
			const headingTitle = (heading[2] ?? "").trim();
			headings = headings.filter((item) => item.level < level);
			headings.push({ level, title: headingTitle });
			title = headings.map((item) => item.title).join(" > ");
			continue;
		}
		if (line.trim().length === 0) {
			flush();
			continue;
		}
		if (blockLines.length === 0) blockLine = offset + 1;
		blockLines.push(line);
	}
	flush();
	return blocks;
}

function indexDocBlock(block: ParsedDocBlock): IndexedDocBlock {
	const titleNormalized = normalizeRetrievalText(block.title);
	const textNormalized = normalizeRetrievalText(block.text);
	return {
		block,
		titleNormalized,
		textNormalized,
		titleTrigrams: buildTrigrams(titleNormalized),
		textTrigrams: buildTrigrams(textNormalized),
	};
}

function buildTrigrams(text: string): Set<string> {
	const chars = [...text];
	const grams = new Set<string>();
	for (let start = 0; start + 3 <= chars.length; start += 1) {
		grams.add(chars.slice(start, start + 3).join(""));
	}
	return grams;
}

function countOccurrences(text: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let index = text.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = text.indexOf(needle, index + needle.length);
	}
	return count;
}

function snippetFor(text: string, terms: readonly string[]): string {
	const flattened = text.replace(/\s+/g, " ").trim();
	let hit = -1;
	let hitLength = 0;
	for (const term of terms) {
		const index = flattened.indexOf(term);
		if (index !== -1 && (hit === -1 || index < hit)) {
			hit = index;
			hitLength = term.length;
		}
	}
	if (hit === -1) {
		return flattened.length <= MAX_SNIPPET_CHARS
			? flattened
			: `${flattened.slice(0, MAX_SNIPPET_CHARS)}……`;
	}
	const start = Math.max(0, hit - 60);
	const end = Math.min(flattened.length, hit + hitLength + 80);
	const prefix = start > 0 ? "……" : "";
	const suffix = end < flattened.length ? "……" : "";
	return `${prefix}${flattened.slice(start, end)}${suffix}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
	if (error === null || typeof error !== "object" || !("code" in error)) {
		return null;
	}
	const code = error.code;
	return typeof code === "string" ? code : null;
}

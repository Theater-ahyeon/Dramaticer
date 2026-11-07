import Database from "better-sqlite3";

export interface ChunkInput {
	readonly storyId: string;
	readonly nodeId: string;
	readonly text: string;
}

export interface ChunkSearchOptions {
	readonly storyId?: string;
	readonly nodeIds?: readonly string[];
	readonly limit?: number;
}

export interface ChunkMatch {
	readonly storyId: string;
	readonly nodeId: string;
	/** FTS5 的 bm25 原始分数，越小越相关。 */
	readonly score: number;
}

interface ChunkRow {
	readonly story_id: string;
	readonly node_id: string;
	readonly score: number;
}

const DEFAULTS = {
	searchLimit: 20,
	maxSearchLimit: 1000,
	minQueryChars: 3,
} as const;

/**
 * 写入索引和构造查询共用的规范化：先做 NFKC，再去掉标点、符号和空白。
 * 两侧必须一致，否则全角字符与标点会把同一个词切成不同的三字窗口。
 */
export function normalizeRetrievalText(text: string): string {
	if (typeof text !== "string") {
		throw new Error("检索文本必须是字符串");
	}
	return text.normalize("NFKC").replace(/[\p{P}\p{S}\s]/gu, "");
}

/**
 * 把检索文本转成 FTS5 trigram 查询：规范化后取全部连续三字窗口，用 OR 连接。
 * 少于三个字符时返回 null。
 */
export function buildTrigramQuery(text: string): string | null {
	const chars = [...normalizeRetrievalText(text)];
	if (chars.length < DEFAULTS.minQueryChars) return null;
	const grams = new Set<string>();
	for (let start = 0; start + DEFAULTS.minQueryChars <= chars.length; start++) {
		grams.add(chars.slice(start, start + DEFAULTS.minQueryChars).join(""));
	}
	return [...grams]
		.map((gram) => `"${gram.replaceAll('"', '""')}"`)
		.join(" OR ");
}

/**
 * 只存文本块的 FTS5 索引，充当记忆引擎的 BM25 基线。
 * 表格按 trigram 分词，因此中文不需要预先分词；写入和查询都先经过 normalizeRetrievalText。
 * 规范化后没有可检索字符的块不写入索引。
 */
export class ChunkIndex {
	readonly #db: Database.Database;

	private constructor(db: Database.Database) {
		this.#db = db;
	}

	static open(path = ":memory:"): ChunkIndex {
		if (typeof path !== "string" || path.length === 0) {
			throw new Error("索引路径必须是非空字符串");
		}
		const db = new Database(path);
		try {
			db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunk_text USING fts5(
				text,
				node_id UNINDEXED,
				story_id UNINDEXED,
				tokenize = 'trigram'
			)`);
		} catch (error) {
			db.close();
			throw error;
		}
		return new ChunkIndex(db);
	}

	add(chunks: readonly ChunkInput[]): void {
		if (!Array.isArray(chunks)) {
			throw new Error("待写入的文本块必须是数组");
		}
		if (chunks.length === 0) return;
		const insert = this.#db.prepare(
			"INSERT INTO chunk_text (text, node_id, story_id) VALUES (?, ?, ?)",
		);
		const run = this.#db.transaction((items: readonly ChunkInput[]) => {
			for (const [index, item] of items.entries()) {
				const label = `文本块[${index}]`;
				assertNonEmptyString(item.storyId, `${label} 的 storyId`);
				assertNonEmptyString(item.nodeId, `${label} 的 nodeId`);
				assertNonEmptyString(item.text, `${label} 的 text`);
				const normalized = normalizeRetrievalText(item.text);
				if (normalized === "") continue;
				insert.run(normalized, item.nodeId, item.storyId);
			}
		});
		run(chunks);
	}

	count(): number {
		const row = this.#db
			.prepare("SELECT count(*) AS count FROM chunk_text")
			.get() as { count: number };
		return row.count;
	}

	search(query: string, options: ChunkSearchOptions = {}): ChunkMatch[] {
		const ftsQuery = buildTrigramQuery(query);
		if (ftsQuery === null) return [];
		const limit = options.limit ?? DEFAULTS.searchLimit;
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > DEFAULTS.maxSearchLimit
		) {
			throw new Error(
				`检索条数必须是 1 到 ${DEFAULTS.maxSearchLimit} 之间的整数`,
			);
		}
		const { storyId, nodeIds } = options;
		if (storyId !== undefined) {
			assertNonEmptyString(storyId, "故事 id");
		}
		if (nodeIds !== undefined) {
			if (!Array.isArray(nodeIds)) {
				throw new Error("楼层过滤条件必须是数组");
			}
			for (const nodeId of nodeIds) {
				assertNonEmptyString(nodeId, "楼层过滤条件里的节点 id");
			}
			if (nodeIds.length === 0) return [];
		}
		const rows = this.#db
			.prepare(
				`SELECT story_id, node_id, bm25(chunk_text) AS score
				FROM chunk_text
				WHERE chunk_text MATCH @query
					AND (@storyId IS NULL OR story_id = @storyId)
					AND (@nodeIds IS NULL OR node_id IN (SELECT value FROM json_each(@nodeIds)))
				ORDER BY score ASC, rowid ASC
				LIMIT @limit`,
			)
			.all({
				query: ftsQuery,
				storyId: storyId ?? null,
				nodeIds: nodeIds === undefined ? null : JSON.stringify(nodeIds),
				limit,
			}) as ChunkRow[];
		return rows.map((row) => ({
			storyId: row.story_id,
			nodeId: row.node_id,
			score: row.score,
		}));
	}

	close(): void {
		this.#db.close();
	}
}

function assertNonEmptyString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
}

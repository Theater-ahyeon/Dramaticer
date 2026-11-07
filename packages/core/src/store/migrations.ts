import type Database from "better-sqlite3";

export interface Migration {
	readonly version: number;
	readonly description: string;
	readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
	{
		version: 1,
		description: "初始 schema：故事、楼层、状态 diff、楼层全文索引",
		statements: [
			`CREATE TABLE stories (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				created_at TEXT NOT NULL
			) STRICT`,
			`CREATE TABLE nodes (
				row_id INTEGER PRIMARY KEY,
				id TEXT NOT NULL UNIQUE,
				story_id TEXT NOT NULL REFERENCES stories(id),
				parent_id TEXT REFERENCES nodes(id),
				role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
				raw TEXT NOT NULL,
				created_at TEXT NOT NULL
			) STRICT`,
			"CREATE INDEX nodes_story_idx ON nodes(story_id)",
			"CREATE INDEX nodes_parent_idx ON nodes(parent_id)",
			`CREATE TRIGGER nodes_parent_same_story
			BEFORE INSERT ON nodes
			WHEN NEW.parent_id IS NOT NULL
				AND COALESCE((SELECT story_id FROM nodes WHERE id = NEW.parent_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '楼层节点的父节点必须存在且属于同一个故事');
			END`,
			`CREATE TRIGGER nodes_immutable
			BEFORE UPDATE ON nodes
			BEGIN
				SELECT RAISE(ABORT, '楼层节点的原文不可修改');
			END`,
			`CREATE TABLE state_diffs (
				id INTEGER PRIMARY KEY,
				story_id TEXT NOT NULL REFERENCES stories(id),
				node_id TEXT NOT NULL REFERENCES nodes(id),
				ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
				path TEXT NOT NULL,
				op TEXT NOT NULL CHECK (op IN ('set', 'delete')),
				value TEXT,
				reason TEXT,
				source TEXT NOT NULL,
				created_at TEXT NOT NULL,
				UNIQUE (node_id, ordinal)
			) STRICT`,
			"CREATE INDEX state_diffs_node_idx ON state_diffs(node_id)",
			`CREATE TRIGGER state_diffs_story_matches_node
			BEFORE INSERT ON state_diffs
			WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '状态 diff 的 story_id 必须与所在楼层一致');
			END`,
			// trigram：中文没有空格，unicode61 会把整句当成一个词，无法检索。
			`CREATE VIRTUAL TABLE node_text USING fts5(
				node_id UNINDEXED,
				story_id UNINDEXED,
				raw,
				tokenize = 'trigram'
			)`,
			`CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes
			BEGIN
				INSERT INTO node_text(rowid, node_id, story_id, raw)
				VALUES (new.row_id, new.id, new.story_id, new.raw);
			END`,
			`CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes
			BEGIN
				DELETE FROM node_text WHERE rowid = old.row_id;
			END`,
		],
	},
];

export const LATEST_SCHEMA_VERSION: number =
	MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export function applyMigrations(db: Database.Database): void {
	const current = db.pragma("user_version", { simple: true }) as number;
	if (current > LATEST_SCHEMA_VERSION) {
		throw new Error(
			`数据库 schema 版本 ${current} 高于当前代码支持的版本 ${LATEST_SCHEMA_VERSION}`,
		);
	}
	for (const migration of MIGRATIONS) {
		if (migration.version <= current) continue;
		db.transaction(() => {
			for (const statement of migration.statements) {
				db.exec(statement);
			}
			db.pragma(`user_version = ${migration.version}`);
		})();
	}
}

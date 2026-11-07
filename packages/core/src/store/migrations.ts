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
	{
		version: 2,
		description: "楼层 Trace：每轮的上下文、渠道、用量与结构化输出记录",
		statements: [
			`CREATE TABLE traces (
				node_id TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id),
				story_id TEXT NOT NULL REFERENCES stories(id),
				trace TEXT NOT NULL,
				created_at TEXT NOT NULL
			) STRICT`,
			"CREATE INDEX traces_story_idx ON traces(story_id)",
		],
	},
	{
		version: 3,
		description: "分支指针：故事的 head 指向当前分支的末端楼层",
		statements: [
			"ALTER TABLE stories ADD COLUMN head_node_id TEXT REFERENCES nodes(id)",
			`CREATE TRIGGER stories_head_same_story
			BEFORE UPDATE OF head_node_id ON stories
			WHEN NEW.head_node_id IS NOT NULL
				AND COALESCE((SELECT story_id FROM nodes WHERE id = NEW.head_node_id), '') <> NEW.id
			BEGIN
				SELECT RAISE(ABORT, 'head 节点必须存在且属于同一个故事');
			END`,
		],
	},
	{
		version: 4,
		description: "状态快照缓存：按楼层保存沿路径累加 diff 的结果",
		statements: [
			`CREATE TABLE state_snapshots (
				node_id TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id),
				story_id TEXT NOT NULL REFERENCES stories(id),
				state TEXT NOT NULL,
				computed_at TEXT NOT NULL
			) STRICT`,
			`CREATE TRIGGER state_snapshots_story_matches_node
			BEFORE INSERT ON state_snapshots
			WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '状态快照的 story_id 必须与所在楼层一致');
			END`,
		],
	},
	{
		version: 5,
		description: "后台任务队列：每个已确认楼层的每种任务类型一行",
		statements: [
			`CREATE TABLE background_jobs (
				id INTEGER PRIMARY KEY,
				story_id TEXT NOT NULL REFERENCES stories(id),
				node_id TEXT NOT NULL REFERENCES nodes(id),
				kind TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
				attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
				last_error TEXT,
				created_at TEXT NOT NULL,
				started_at TEXT,
				finished_at TEXT,
				UNIQUE (node_id, kind)
			) STRICT`,
			"CREATE INDEX background_jobs_story_status_idx ON background_jobs(story_id, status, created_at)",
			`CREATE TRIGGER background_jobs_story_matches_node
			BEFORE INSERT ON background_jobs
			WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '后台任务的 story_id 必须与所在楼层一致');
			END`,
		],
	},
	{
		version: 6,
		description: "实体与别名：角色卡和世界书定义的人名、地名与词条",
		statements: [
			`CREATE TABLE entities (
				row_id INTEGER PRIMARY KEY,
				id TEXT NOT NULL UNIQUE,
				story_id TEXT NOT NULL REFERENCES stories(id),
				kind TEXT NOT NULL CHECK (kind IN ('character', 'location', 'item', 'faction', 'lore', 'unknown')),
				name TEXT NOT NULL,
				normalized_name TEXT NOT NULL,
				description TEXT NOT NULL,
				source TEXT NOT NULL,
				created_at TEXT NOT NULL,
				UNIQUE (story_id, normalized_name)
			) STRICT`,
			"CREATE INDEX entities_story_kind_idx ON entities(story_id, kind)",
			`CREATE TABLE entity_aliases (
				entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
				story_id TEXT NOT NULL REFERENCES stories(id),
				alias TEXT NOT NULL,
				normalized_alias TEXT NOT NULL,
				PRIMARY KEY (entity_id, normalized_alias)
			) STRICT`,
			"CREATE INDEX entity_aliases_lookup_idx ON entity_aliases(story_id, normalized_alias)",
			`CREATE TRIGGER entity_aliases_story_matches_entity
			BEFORE INSERT ON entity_aliases
			WHEN COALESCE((SELECT story_id FROM entities WHERE id = NEW.entity_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '实体别名的 story_id 必须与实体一致');
			END`,
		],
	},
	{
		version: 7,
		description: "事件记忆：按楼层只追加的事件、参与者、知情者与重要度",
		statements: [
			`CREATE TABLE memory_events (
				row_id INTEGER PRIMARY KEY,
				id TEXT NOT NULL UNIQUE,
				story_id TEXT NOT NULL REFERENCES stories(id),
				source_node_id TEXT NOT NULL REFERENCES nodes(id),
				ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
				story_time TEXT,
				location TEXT,
				participants TEXT NOT NULL,
				importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
				knowers TEXT NOT NULL,
				text TEXT NOT NULL,
				created_at TEXT NOT NULL,
				UNIQUE (source_node_id, ordinal)
			) STRICT`,
			"CREATE INDEX memory_events_story_idx ON memory_events(story_id)",
			"CREATE INDEX memory_events_node_idx ON memory_events(source_node_id)",
			`CREATE TRIGGER memory_events_story_matches_node
			BEFORE INSERT ON memory_events
			WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.source_node_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '事件记忆的 story_id 必须与来源楼层一致');
			END`,
			`CREATE TRIGGER memory_events_immutable
			BEFORE UPDATE ON memory_events
			BEGIN
				SELECT RAISE(ABORT, '事件记忆不可修改');
			END`,
			`CREATE TRIGGER memory_events_no_delete
			BEFORE DELETE ON memory_events
			BEGIN
				SELECT RAISE(ABORT, '事件记忆不可删除');
			END`,
		],
	},
	{
		version: 8,
		description: "分层摘要：章节与主线摘要覆盖的楼层区间",
		statements: [
			`CREATE TABLE summaries (
				row_id INTEGER PRIMARY KEY,
				id TEXT NOT NULL UNIQUE,
				story_id TEXT NOT NULL REFERENCES stories(id),
				level TEXT NOT NULL CHECK (level IN ('chapter', 'mainline')),
				start_node_id TEXT NOT NULL REFERENCES nodes(id),
				end_node_id TEXT NOT NULL REFERENCES nodes(id),
				text TEXT NOT NULL,
				token_count INTEGER NOT NULL CHECK (token_count > 0),
				created_at TEXT NOT NULL,
				UNIQUE (story_id, level, start_node_id, end_node_id)
			) STRICT`,
			"CREATE INDEX summaries_story_level_idx ON summaries(story_id, level)",
			`CREATE TRIGGER summaries_story_matches_nodes
			BEFORE INSERT ON summaries
			WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.start_node_id), '') <> NEW.story_id
				OR COALESCE((SELECT story_id FROM nodes WHERE id = NEW.end_node_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '摘要的 story_id 必须与起止楼层一致');
			END`,
		],
	},
	{
		version: 9,
		description: "剧情笔记：来源楼层、未兑现与已兑现状态",
		statements: [
			`CREATE TABLE plot_notes (
				row_id INTEGER PRIMARY KEY,
				id TEXT NOT NULL UNIQUE,
				story_id TEXT NOT NULL REFERENCES stories(id),
				source_node_id TEXT NOT NULL REFERENCES nodes(id),
				text TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('open', 'fulfilled')),
				created_at TEXT NOT NULL,
				fulfilled_at TEXT,
				CHECK (
					(status = 'open' AND fulfilled_at IS NULL)
					OR (status = 'fulfilled' AND fulfilled_at IS NOT NULL)
				)
			) STRICT`,
			"CREATE INDEX plot_notes_story_status_idx ON plot_notes(story_id, status, row_id)",
			`CREATE TRIGGER plot_notes_story_matches_node
			BEFORE INSERT ON plot_notes
			WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.source_node_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '剧情笔记的 story_id 必须与来源楼层一致');
			END`,
			// 只允许更新 status 与 fulfilled_at，正文与来源在写入后固定。
			`CREATE TRIGGER plot_notes_immutable_fields
			BEFORE UPDATE ON plot_notes
			WHEN NEW.id <> OLD.id
				OR NEW.story_id <> OLD.story_id
				OR NEW.source_node_id <> OLD.source_node_id
				OR NEW.text <> OLD.text
				OR NEW.created_at <> OLD.created_at
			BEGIN
				SELECT RAISE(ABORT, '剧情笔记的正文与来源不可修改');
			END`,
			`CREATE TRIGGER plot_notes_no_delete
			BEFORE DELETE ON plot_notes
			BEGIN
				SELECT RAISE(ABORT, '剧情笔记不可删除');
			END`,
		],
	},
];

export const LATEST_SCHEMA_VERSION: number =
	MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

function assertMigrationSequence(migrations: readonly Migration[]): void {
	migrations.forEach((migration, index) => {
		const expected = index + 1;
		if (migration.version !== expected) {
			throw new Error(
				`迁移列表第 ${index + 1} 项的版本号必须是 ${expected}，实际为 ${migration.version}`,
			);
		}
	});
}

export function applyMigrations(
	db: Database.Database,
	migrations: readonly Migration[] = MIGRATIONS,
): void {
	assertMigrationSequence(migrations);
	const latestVersion = migrations[migrations.length - 1]?.version ?? 0;
	const current = db.pragma("user_version", { simple: true }) as number;
	if (current > latestVersion) {
		throw new Error(
			`数据库 schema 版本 ${current} 高于当前代码支持的版本 ${latestVersion}`,
		);
	}
	for (const migration of migrations) {
		if (migration.version <= current) continue;
		db.transaction(() => {
			for (const statement of migration.statements) {
				db.exec(statement);
			}
			db.pragma(`user_version = ${migration.version}`);
		})();
	}
}

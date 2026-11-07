import type Database from "better-sqlite3";

export interface Migration {
	readonly version: number;
	readonly description: string;
	readonly statements: readonly string[];
}

const BASE_MIGRATIONS: readonly Migration[] = [
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
	{
		version: 10,
		description:
			"运行时分块与 BM25 索引：每个楼层的检索块及其 trigram 全文索引",
		statements: [
			`CREATE TABLE chunks (
				id INTEGER PRIMARY KEY,
				story_id TEXT NOT NULL REFERENCES stories(id),
				node_id TEXT NOT NULL REFERENCES nodes(id),
				ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
				text TEXT NOT NULL,
				UNIQUE (node_id, ordinal)
			) STRICT`,
			"CREATE INDEX chunks_story_node_idx ON chunks(story_id, node_id)",
			`CREATE TRIGGER chunks_story_matches_node
			BEFORE INSERT ON chunks
			WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
			BEGIN
				SELECT RAISE(ABORT, '文本块的 story_id 必须与所在楼层一致');
			END`,
			// 与 node_text 相同：trigram 让中文不需要预先分词；rowid 对应 chunks.id。
			`CREATE VIRTUAL TABLE chunks_fts USING fts5(
				text,
				node_id UNINDEXED,
				story_id UNINDEXED,
				tokenize = 'trigram'
			)`,
		],
	},
];

export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

/**
 * vec0 的维度在创建表时固定，所以迁移列表按配置的 embedding 维度生成。
 * 同一个数据库必须始终用同一个维度打开，StoryStore 会校验表里的实际维度。
 */
export function buildMigrations(
	embeddingDimensions: number = DEFAULT_EMBEDDING_DIMENSIONS,
): readonly Migration[] {
	if (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 1) {
		throw new Error("embedding 维度必须是正整数");
	}
	return [
		...BASE_MIGRATIONS,
		{
			version: 11,
			description: "块向量：vec0 表按 chunks.id 保存 embedding，供向量检索",
			statements: [
				`CREATE VIRTUAL TABLE chunk_vectors USING vec0(
					chunk_id INTEGER PRIMARY KEY,
					story_id TEXT,
					node_id TEXT,
					embedding float[${embeddingDimensions}]
				)`,
			],
		},
		{
			version: 12,
			description: "世界书条目：常驻与关键词检索共用一张只读的 lore 表",
			statements: [
				`CREATE TABLE lore_entries (
					row_id INTEGER PRIMARY KEY,
					id TEXT NOT NULL UNIQUE,
					story_id TEXT NOT NULL REFERENCES stories(id),
					entity_id TEXT REFERENCES entities(id),
					name TEXT NOT NULL,
					content TEXT NOT NULL,
					constant INTEGER NOT NULL CHECK (constant IN (0, 1)),
					keywords TEXT NOT NULL,
					source TEXT NOT NULL,
					created_at TEXT NOT NULL,
					UNIQUE (story_id, source)
				) STRICT`,
				"CREATE INDEX lore_entries_story_idx ON lore_entries(story_id, row_id)",
				`CREATE TRIGGER lore_entries_story_matches_entity
				BEFORE INSERT ON lore_entries
				WHEN NEW.entity_id IS NOT NULL
					AND COALESCE((SELECT story_id FROM entities WHERE id = NEW.entity_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '世界书条目的 story_id 必须与实体一致');
				END`,
			],
		},
		{
			version: 13,
			description: "导演决策：每个楼层最多一条评估记录，重复评估覆盖旧记录",
			statements: [
				`CREATE TABLE director_decisions (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					directive TEXT,
					mechanisms TEXT NOT NULL,
					signals TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				`CREATE TRIGGER director_decisions_story_matches_node
				BEFORE INSERT ON director_decisions
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '导演决策的 story_id 必须与楼层节点一致');
				END`,
				`CREATE TRIGGER director_decisions_identity_immutable
				BEFORE UPDATE ON director_decisions
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '导演决策的楼层与故事归属不可修改');
				END`,
			],
		},
		{
			version: 14,
			description: "导演素材：事件池与 NPC 议程",
			statements: [
				`CREATE TABLE event_pool (
					story_id TEXT NOT NULL REFERENCES stories(id),
					source_id TEXT NOT NULL,
					text TEXT NOT NULL,
					preconditions TEXT,
					cooldown INTEGER NOT NULL DEFAULT 0 CHECK (cooldown >= 0),
					source TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (story_id, source_id)
				) STRICT`,
				`CREATE TABLE npc_agendas (
					story_id TEXT NOT NULL REFERENCES stories(id),
					entity_id TEXT NOT NULL REFERENCES entities(id),
					goal TEXT NOT NULL,
					every_chapters INTEGER NOT NULL DEFAULT 1 CHECK (every_chapters >= 1),
					importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
					progress TEXT NOT NULL DEFAULT '',
					last_advanced_node_id TEXT REFERENCES nodes(id),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					PRIMARY KEY (story_id, entity_id)
				) STRICT`,
				`CREATE TRIGGER npc_agendas_story_matches_entity
				BEFORE INSERT ON npc_agendas
				WHEN COALESCE((SELECT story_id FROM entities WHERE id = NEW.entity_id), '') <> NEW.story_id
					OR (
						NEW.last_advanced_node_id IS NOT NULL
						AND COALESCE((SELECT story_id FROM nodes WHERE id = NEW.last_advanced_node_id), '') <> NEW.story_id
					)
				BEGIN
					SELECT RAISE(ABORT, 'NPC 议程的故事必须与实体和推进楼层一致');
				END`,
				`CREATE TRIGGER npc_agendas_update_story_matches
				BEFORE UPDATE ON npc_agendas
				WHEN NEW.story_id <> OLD.story_id
					OR NEW.entity_id <> OLD.entity_id
					OR (
						NEW.last_advanced_node_id IS NOT NULL
						AND COALESCE((SELECT story_id FROM nodes WHERE id = NEW.last_advanced_node_id), '') <> NEW.story_id
					)
				BEGIN
					SELECT RAISE(ABORT, 'NPC 议程的故事与实体不可修改，推进楼层必须属于同一故事');
				END`,
			],
		},
		{
			version: 15,
			description: "事件池条目的启用开关",
			statements: [
				"ALTER TABLE event_pool ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))",
			],
		},
		{
			version: 16,
			description: "事件记忆来源：区分抽取事件与议程推进事件",
			statements: [
				"ALTER TABLE memory_events ADD COLUMN source TEXT NOT NULL DEFAULT 'events'",
			],
		},
		{
			version: 17,
			description: "故事运行配置与原生上下文模板",
			statements: [
				`CREATE TABLE story_settings (
					story_id TEXT PRIMARY KEY REFERENCES stories(id),
					card_name TEXT,
					character_prompt TEXT,
					persona TEXT,
					template_id TEXT,
					model TEXT,
					budget_tokens INTEGER NOT NULL CHECK (budget_tokens >= 0),
					structured_output TEXT NOT NULL CHECK (structured_output IN ('function-call', 'text-tags')),
					temperature REAL NOT NULL CHECK (temperature >= 0 AND temperature <= 2),
					max_tokens INTEGER NOT NULL CHECK (max_tokens >= 1),
					reasoning TEXT NOT NULL,
					viewpoint TEXT,
					director_config TEXT NOT NULL,
					updated_at TEXT NOT NULL
				) STRICT`,
				`CREATE TABLE context_templates (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL UNIQUE,
					template TEXT NOT NULL,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				) STRICT`,
			],
		},
		{
			version: 18,
			description: "台账事实的故事时间：diff 可带故事内时间段",
			statements: [
				"ALTER TABLE state_diffs ADD COLUMN story_time_start TEXT",
				"ALTER TABLE state_diffs ADD COLUMN story_time_end TEXT",
			],
		},
		{
			version: 19,
			description: "楼层结算结果：每个已落定的助手楼层一行",
			statements: [
				`CREATE TABLE ledger_settlements (
					node_id TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					source TEXT NOT NULL CHECK (source IN ('model', 'settler', 'player', 'import')),
					added_count INTEGER NOT NULL CHECK (added_count >= 0),
					repairs TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX ledger_settlements_story_idx ON ledger_settlements(story_id)",
				`CREATE TRIGGER ledger_settlements_story_matches_node
				BEFORE INSERT ON ledger_settlements
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '结算记录的 story_id 必须与所在楼层一致');
				END`,
			],
		},
		{
			version: 20,
			description: "结算置信度与实体候选",
			statements: [
				"ALTER TABLE state_diffs ADD COLUMN confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))",
				`CREATE TABLE entity_candidates (
					story_id TEXT NOT NULL REFERENCES stories(id),
					normalized_name TEXT NOT NULL,
					kind TEXT NOT NULL CHECK (kind IN ('character', 'location', 'item', 'faction', 'lore', 'unknown')),
					hits INTEGER NOT NULL CHECK (hits >= 1),
					first_node_id TEXT NOT NULL REFERENCES nodes(id),
					created_at TEXT NOT NULL,
					PRIMARY KEY (story_id, normalized_name, kind)
				) STRICT`,
				"CREATE INDEX entity_candidates_story_idx ON entity_candidates(story_id)",
				`CREATE TRIGGER entity_candidates_story_matches_node
				BEFORE INSERT ON entity_candidates
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.first_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '实体候选的 story_id 必须与首个楼层一致');
				END`,
			],
		},
		{
			version: 21,
			description: "现场分析：每个已结算的助手楼层一行，同一楼层重跑覆盖",
			statements: [
				`CREATE TABLE scene_analyses (
					node_id TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					text TEXT NOT NULL,
					token_count INTEGER NOT NULL CHECK (token_count >= 0),
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX scene_analyses_story_idx ON scene_analyses(story_id)",
				`CREATE TRIGGER scene_analyses_story_matches_node
				BEFORE INSERT ON scene_analyses
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '现场分析的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER scene_analyses_identity_immutable
				BEFORE UPDATE ON scene_analyses
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '现场分析的楼层与故事归属不可修改');
				END`,
			],
		},
		{
			version: 22,
			description: "历史槽位的块 prompt 视图策略",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN history_block_policy TEXT NOT NULL
					DEFAULT '{"mode":"default","overrides":{}}'`,
			],
		},
		{
			version: 23,
			description: "事件抽取记录：窗口内每个楼层一行，含没有抽到事件的楼层",
			statements: [
				`CREATE TABLE event_extractions (
					node_id TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					event_count INTEGER NOT NULL CHECK (event_count >= 0),
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX event_extractions_story_idx ON event_extractions(story_id)",
				`CREATE TRIGGER event_extractions_story_matches_node
				BEFORE INSERT ON event_extractions
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '事件抽取记录的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER event_extractions_identity_immutable
				BEFORE UPDATE ON event_extractions
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '事件抽取记录的楼层与故事归属不可修改');
				END`,
			],
		},
		{
			version: 24,
			description: "台账变更卡：玩家修订与结算冲突都先落成待审卡片",
			statements: [
				`CREATE TABLE ledger_change_cards (
					id TEXT PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					source TEXT NOT NULL CHECK (source IN ('model', 'settler', 'player', 'import')),
					source_node_id TEXT NOT NULL REFERENCES nodes(id),
					text TEXT NOT NULL,
					diffs TEXT NOT NULL,
					before TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'rolled_back')),
					rejection_reason TEXT,
					created_at TEXT NOT NULL,
					decided_at TEXT
				) STRICT`,
				"CREATE INDEX ledger_change_cards_story_idx ON ledger_change_cards(story_id, status)",
				`CREATE TRIGGER ledger_change_cards_story_matches_node
				BEFORE INSERT ON ledger_change_cards
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.source_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '变更卡的 story_id 必须与来源楼层一致');
				END`,
				`CREATE TRIGGER ledger_change_cards_identity_immutable
				BEFORE UPDATE ON ledger_change_cards
				WHEN NEW.id <> OLD.id
					OR NEW.story_id <> OLD.story_id
					OR NEW.source <> OLD.source
					OR NEW.source_node_id <> OLD.source_node_id
					OR NEW.text <> OLD.text
					OR NEW.diffs <> OLD.diffs
					OR NEW.before <> OLD.before
					OR NEW.created_at <> OLD.created_at
				BEGIN
					SELECT RAISE(ABORT, '变更卡的内容与归属不可修改');
				END`,
			],
		},
		{
			version: 25,
			description: "间隙合并调用：故事开关与每个楼层的执行记录",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN gap_pass_enabled INTEGER NOT NULL DEFAULT 0
					CHECK (gap_pass_enabled IN (0, 1))`,
				`CREATE TABLE gap_pass_runs (
					node_id TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					rejected_segments TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX gap_pass_runs_story_idx ON gap_pass_runs(story_id)",
				`CREATE TRIGGER gap_pass_runs_story_matches_node
				BEFORE INSERT ON gap_pass_runs
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '间隙合并调用记录的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER gap_pass_runs_identity_immutable
				BEFORE UPDATE ON gap_pass_runs
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '间隙合并调用记录的楼层与故事归属不可修改');
				END`,
			],
		},
	];
}

export const MIGRATIONS: readonly Migration[] = buildMigrations();

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

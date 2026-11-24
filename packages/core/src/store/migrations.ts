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
		{
			version: 26,
			description: "间隙档位：长间隙阈值、后置任务与过期任务丢弃",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN gap_plan_seconds INTEGER NOT NULL
					DEFAULT 212 CHECK (gap_plan_seconds >= 0)`,
				`CREATE TABLE background_jobs_next (
					id INTEGER PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					node_id TEXT NOT NULL REFERENCES nodes(id),
					kind TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'discarded')),
					attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
					last_error TEXT,
					created_at TEXT NOT NULL,
					started_at TEXT,
					finished_at TEXT,
					UNIQUE (node_id, kind)
				) STRICT`,
				`INSERT INTO background_jobs_next
					(id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
				SELECT id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at
				FROM background_jobs`,
				"DROP TABLE background_jobs",
				"ALTER TABLE background_jobs_next RENAME TO background_jobs",
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
			version: 27,
			description: "间隙合并调用记录：逐条丢弃的窗口外条目",
			statements: [
				`ALTER TABLE gap_pass_runs ADD COLUMN dropped_entries TEXT NOT NULL DEFAULT '[]'`,
			],
		},
		{
			version: 28,
			description: "回合模式与读取工具软上限",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN turn_mode TEXT NOT NULL DEFAULT 'fast'
					CHECK (turn_mode IN ('fast', 'deep'))`,
				`ALTER TABLE story_settings ADD COLUMN max_read_rounds INTEGER NOT NULL
					DEFAULT 3 CHECK (max_read_rounds >= 0)`,
			],
		},
		{
			version: 29,
			description: "开局包与故事级后台任务",
			statements: [
				`CREATE TABLE opening_packs (
					story_id TEXT PRIMARY KEY REFERENCES stories(id),
					payload TEXT NOT NULL,
					input_hash TEXT NOT NULL,
					source_node_id TEXT REFERENCES nodes(id),
					created_at TEXT NOT NULL
				) STRICT`,
				`CREATE TRIGGER opening_packs_story_matches_node
				BEFORE INSERT ON opening_packs
				WHEN NEW.source_node_id IS NOT NULL
					AND COALESCE((SELECT story_id FROM nodes WHERE id = NEW.source_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '开局包的 story_id 必须与来源楼层一致');
				END`,
				`CREATE TABLE background_jobs_next (
					id INTEGER PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					node_id TEXT REFERENCES nodes(id),
					kind TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'discarded')),
					attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
					last_error TEXT,
					created_at TEXT NOT NULL,
					started_at TEXT,
					finished_at TEXT,
					UNIQUE (node_id, kind)
				) STRICT`,
				`INSERT INTO background_jobs_next
					(id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
				SELECT id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at
				FROM background_jobs`,
				"DROP TABLE background_jobs",
				"ALTER TABLE background_jobs_next RENAME TO background_jobs",
				"CREATE INDEX background_jobs_story_status_idx ON background_jobs(story_id, status, created_at)",
				`CREATE UNIQUE INDEX background_jobs_story_kind_idx
				ON background_jobs(story_id, kind) WHERE node_id IS NULL`,
				`CREATE TRIGGER background_jobs_story_matches_node
				BEFORE INSERT ON background_jobs
				WHEN NEW.node_id IS NOT NULL
					AND COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '后台任务的 story_id 必须与所在楼层一致');
				END`,
			],
		},
		{
			version: 30,
			description: "首楼开场候选",
			statements: [
				`CREATE TABLE opening_candidates (
					id TEXT PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
					raw TEXT NOT NULL CHECK (length(raw) > 0),
					status TEXT NOT NULL CHECK (status IN ('pending', 'chosen', 'discarded')),
					created_at TEXT NOT NULL,
					UNIQUE (story_id, ordinal)
				) STRICT`,
				`CREATE INDEX opening_candidates_story_status_idx
				ON opening_candidates(story_id, status)`,
			],
		},
		{
			version: 31,
			description: "偏好信号：swipe、选项选择、变更卡决定与编辑，只追加",
			statements: [
				`CREATE TABLE preference_events (
					id TEXT PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					node_id TEXT NOT NULL REFERENCES nodes(id),
					kind TEXT NOT NULL CHECK (kind IN ('swipe', 'choice', 'card_decision', 'edit')),
					payload TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				`CREATE INDEX preference_events_story_kind_idx
				ON preference_events(story_id, kind, created_at)`,
				`CREATE TRIGGER preference_events_story_matches_node
				BEFORE INSERT ON preference_events
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '偏好记录的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER preference_events_immutable
				BEFORE UPDATE ON preference_events
				BEGIN
					SELECT RAISE(ABORT, '偏好记录只追加，不能修改');
				END`,
				`CREATE TRIGGER preference_events_no_delete
				BEFORE DELETE ON preference_events
				BEGIN
					SELECT RAISE(ABORT, '偏好记录只追加，不能删除');
				END`,
			],
		},
		{
			version: 32,
			description: "导演计划：弧线、序列、节拍与楼层拍状态",
			statements: [
				`CREATE TABLE story_arcs (
					story_id TEXT NOT NULL REFERENCES stories(id),
					arc_id TEXT NOT NULL CHECK (length(arc_id) > 0),
					title TEXT NOT NULL CHECK (length(title) > 0),
					through_line TEXT NOT NULL CHECK (length(through_line) > 0),
					difficulty REAL NOT NULL CHECK (difficulty >= 0 AND difficulty <= 1),
					red_lines TEXT NOT NULL,
					source TEXT NOT NULL CHECK (source IN ('player', 'model', 'import')),
					ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					PRIMARY KEY (story_id, arc_id)
				) STRICT`,
				`CREATE INDEX story_arcs_story_ordinal_idx
				ON story_arcs(story_id, ordinal)`,
				`CREATE TABLE story_sequences (
					story_id TEXT NOT NULL REFERENCES stories(id),
					sequence_id TEXT NOT NULL CHECK (length(sequence_id) > 0),
					arc_id TEXT NOT NULL,
					ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
					title TEXT NOT NULL CHECK (length(title) > 0),
					source TEXT NOT NULL CHECK (source IN ('player', 'model', 'import')),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					PRIMARY KEY (story_id, sequence_id)
				) STRICT`,
				`CREATE INDEX story_sequences_arc_ordinal_idx
				ON story_sequences(story_id, arc_id, ordinal)`,
				`CREATE TRIGGER story_sequences_arc_same_story
				BEFORE INSERT ON story_sequences
				WHEN COALESCE(
					(SELECT story_id FROM story_arcs
						WHERE story_id = NEW.story_id AND arc_id = NEW.arc_id),
					''
				) <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '序列的弧线必须存在且属于同一个故事');
				END`,
				`CREATE TRIGGER story_sequences_identity_immutable
				BEFORE UPDATE ON story_sequences
				WHEN NEW.story_id <> OLD.story_id
					OR NEW.sequence_id <> OLD.sequence_id
					OR NEW.arc_id <> OLD.arc_id
				BEGIN
					SELECT RAISE(ABORT, '序列的故事、id 与所属弧线不可修改');
				END`,
				`CREATE TABLE story_beats (
					story_id TEXT NOT NULL REFERENCES stories(id),
					beat_id TEXT NOT NULL CHECK (length(beat_id) > 0),
					sequence_id TEXT NOT NULL,
					ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
					goal TEXT NOT NULL CHECK (length(goal) > 0),
					entry_signs TEXT NOT NULL,
					fit_points TEXT NOT NULL,
					source TEXT NOT NULL CHECK (source IN ('player', 'model', 'import')),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					PRIMARY KEY (story_id, beat_id)
				) STRICT`,
				`CREATE INDEX story_beats_sequence_ordinal_idx
				ON story_beats(story_id, sequence_id, ordinal)`,
				`CREATE TRIGGER story_beats_sequence_same_story
				BEFORE INSERT ON story_beats
				WHEN COALESCE(
					(SELECT story_id FROM story_sequences
						WHERE story_id = NEW.story_id AND sequence_id = NEW.sequence_id),
					''
				) <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '节拍的序列必须存在且属于同一个故事');
				END`,
				`CREATE TRIGGER story_beats_identity_immutable
				BEFORE UPDATE ON story_beats
				WHEN NEW.story_id <> OLD.story_id
					OR NEW.beat_id <> OLD.beat_id
					OR NEW.sequence_id <> OLD.sequence_id
				BEGIN
					SELECT RAISE(ABORT, '节拍的故事、id 与所属序列不可修改');
				END`,
				`CREATE TABLE director_beat_states (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					beat_id TEXT NOT NULL,
					completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
					created_at TEXT NOT NULL
				) STRICT`,
				`CREATE INDEX director_beat_states_story_beat_idx
				ON director_beat_states(story_id, beat_id)`,
				`CREATE TRIGGER director_beat_states_story_matches_node
				BEFORE INSERT ON director_beat_states
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '拍状态的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER director_beat_states_beat_same_story
				BEFORE INSERT ON director_beat_states
				WHEN COALESCE(
					(SELECT story_id FROM story_beats
						WHERE story_id = NEW.story_id AND beat_id = NEW.beat_id),
					''
				) <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '拍状态的节拍必须存在且属于同一个故事');
				END`,
				`CREATE TRIGGER director_beat_states_identity_immutable
				BEFORE UPDATE ON director_beat_states
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '拍状态的楼层与故事归属不可修改');
				END`,
				`CREATE TRIGGER director_beat_states_beat_same_story_update
				BEFORE UPDATE ON director_beat_states
				WHEN NEW.beat_id <> OLD.beat_id
					AND COALESCE(
						(SELECT story_id FROM story_beats
							WHERE story_id = NEW.story_id AND beat_id = NEW.beat_id),
						''
					) <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '拍状态的节拍必须存在且属于同一个故事');
				END`,
			],
		},
		{
			version: 33,
			description: "导演候选行动：每个楼层 4 条行动与 1 条场景变化",
			statements: [
				`CREATE TABLE director_candidate_actions (
					id TEXT PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					node_id TEXT NOT NULL REFERENCES nodes(id),
					ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
					kind TEXT NOT NULL CHECK (kind IN ('action', 'scene_change')),
					text TEXT NOT NULL CHECK (length(text) > 0),
					created_at TEXT NOT NULL,
					UNIQUE (node_id, ordinal)
				) STRICT`,
				`CREATE INDEX director_candidate_actions_story_idx
				ON director_candidate_actions(story_id)`,
				`CREATE TRIGGER director_candidate_actions_story_matches_node
				BEFORE INSERT ON director_candidate_actions
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '候选行动的 story_id 必须与所在楼层一致');
				END`,
			],
		},
		{
			version: 34,
			description:
				"生图表：workflow 模板、角色视觉档案、楼层图片与故事生图配置",
			statements: [
				`CREATE TABLE image_workflows (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL CHECK (length(name) > 0),
					provider TEXT NOT NULL CHECK (length(provider) > 0),
					payload TEXT NOT NULL,
					slots TEXT NOT NULL,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					UNIQUE (name)
				) STRICT`,
				`CREATE TABLE character_visual_profiles (
					story_id TEXT NOT NULL REFERENCES stories(id),
					character TEXT NOT NULL CHECK (length(character) > 0),
					profile TEXT NOT NULL,
					source TEXT NOT NULL CHECK (source IN ('model', 'player', 'import')),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					PRIMARY KEY (story_id, character)
				) STRICT`,
				`CREATE TABLE node_images (
					id TEXT PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					node_id TEXT NOT NULL REFERENCES nodes(id),
					ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
					status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
					request TEXT NOT NULL,
					prompt TEXT,
					negative_prompt TEXT,
					workflow_id TEXT NOT NULL REFERENCES image_workflows(id),
					seed INTEGER,
					attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
					file_name TEXT,
					media_type TEXT,
					width INTEGER,
					height INTEGER,
					error TEXT,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					UNIQUE (node_id, ordinal)
				) STRICT`,
				`CREATE INDEX node_images_story_status_idx
				ON node_images(story_id, status, created_at)`,
				`CREATE INDEX node_images_workflow_idx
				ON node_images(workflow_id)`,
				`CREATE TRIGGER node_images_story_matches_node
				BEFORE INSERT ON node_images
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '图片记录的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER node_images_identity_immutable
				BEFORE UPDATE ON node_images
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '图片记录的楼层与故事归属不可修改');
				END`,
				"ALTER TABLE story_settings ADD COLUMN image_config TEXT",
			],
		},
		{
			version: 35,
			description:
				"父子分块：块表增加父段字段，清空旧块与向量，并把 embedding 任务退回待执行",
			statements: [
				"ALTER TABLE chunks ADD COLUMN parent_ordinal INTEGER",
				"ALTER TABLE chunks ADD COLUMN parent_text TEXT",
				"DELETE FROM chunk_vectors",
				"DELETE FROM chunks_fts",
				"DELETE FROM chunks",
				`UPDATE background_jobs
				SET status = 'pending', attempts = 0, last_error = NULL,
					started_at = NULL, finished_at = NULL
				WHERE kind = 'embeddings'`,
			],
		},
		{
			version: 36,
			description:
				"八段式章节压缩：章节与主线压缩的起止楼层、八段正文与 token 数",
			statements: [
				`CREATE TABLE chapter_compressions (
					row_id INTEGER PRIMARY KEY,
					id TEXT NOT NULL UNIQUE,
					story_id TEXT NOT NULL REFERENCES stories(id),
					level TEXT NOT NULL CHECK (level IN ('chapter', 'mainline')),
					start_node_id TEXT NOT NULL REFERENCES nodes(id),
					end_node_id TEXT NOT NULL REFERENCES nodes(id),
					sections TEXT NOT NULL,
					token_count INTEGER NOT NULL CHECK (token_count > 0),
					created_at TEXT NOT NULL,
					UNIQUE (story_id, level, start_node_id, end_node_id)
				) STRICT`,
				`CREATE INDEX chapter_compressions_story_level_idx
				ON chapter_compressions(story_id, level)`,
				`CREATE TRIGGER chapter_compressions_story_matches_nodes
				BEFORE INSERT ON chapter_compressions
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.start_node_id), '') <> NEW.story_id
					OR COALESCE((SELECT story_id FROM nodes WHERE id = NEW.end_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '压缩的 story_id 必须与起止楼层一致');
				END`,
			],
		},
		{
			version: 37,
			description: "世界书预筛：每个楼层保存下一轮要注入的非恒常条目 id",
			statements: [
				`CREATE TABLE lore_prefilter (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					entry_ids TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX lore_prefilter_story_idx ON lore_prefilter(story_id)",
				`CREATE TRIGGER lore_prefilter_story_matches_node
				BEFORE INSERT ON lore_prefilter
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '世界书预筛的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER lore_prefilter_identity_immutable
				BEFORE UPDATE ON lore_prefilter
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '世界书预筛的楼层与故事归属不可修改');
				END`,
			],
		},
		{
			version: 38,
			description: "上下文包：玩家楼层保存组装结果与引用",
			statements: [
				`CREATE TABLE context_packs (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					payload TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX context_packs_story_idx ON context_packs(story_id)",
				`CREATE TRIGGER context_packs_story_matches_node
				BEFORE INSERT ON context_packs
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '上下文包的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER context_packs_identity_immutable
				BEFORE UPDATE ON context_packs
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '上下文包的楼层与故事归属不可修改');
				END`,
			],
		},
		{
			version: 39,
			description: "深回合的防失控上限与上下文卫生设置",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN deep_max_tool_calls INTEGER NOT NULL
					DEFAULT 40 CHECK (deep_max_tool_calls BETWEEN 1 AND 200)`,
				`ALTER TABLE story_settings ADD COLUMN deep_timeout_ms INTEGER NOT NULL
					DEFAULT 600000 CHECK (deep_timeout_ms BETWEEN 60000 AND 3600000)`,
				`ALTER TABLE story_settings ADD COLUMN deep_context_token_limit INTEGER NOT NULL
					DEFAULT 48000 CHECK (deep_context_token_limit >= 1)`,
				`ALTER TABLE story_settings ADD COLUMN deep_recent_tool_steps INTEGER NOT NULL
					DEFAULT 4 CHECK (deep_recent_tool_steps BETWEEN 1 AND 20)`,
			],
		},
		{
			version: 40,
			description:
				"深回合运行日志：一次运行一行，运行内事件只追加且按序号严格递增",
			statements: [
				`CREATE TABLE turn_runs (
					run_id TEXT PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					user_node_id TEXT NOT NULL REFERENCES nodes(id),
					node_id TEXT REFERENCES nodes(id),
					mode TEXT NOT NULL CHECK (mode IN ('fast', 'deep')),
					status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted', 'failed', 'aborted')),
					started_at TEXT NOT NULL,
					finished_at TEXT
				) STRICT`,
				"CREATE INDEX turn_runs_story_idx ON turn_runs(story_id, started_at)",
				`CREATE UNIQUE INDEX turn_runs_node_idx
				ON turn_runs(node_id) WHERE node_id IS NOT NULL`,
				`CREATE TRIGGER turn_runs_story_matches_user_node
				BEFORE INSERT ON turn_runs
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.user_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '运行记录的 story_id 必须与用户楼层一致');
				END`,
				`CREATE TRIGGER turn_runs_node_matches_story
				BEFORE UPDATE ON turn_runs
				WHEN NEW.node_id IS NOT NULL
					AND COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '运行记录的助手楼层必须属于同一故事');
				END`,
				`CREATE TABLE turn_run_events (
					run_id TEXT NOT NULL REFERENCES turn_runs(run_id),
					seq INTEGER NOT NULL CHECK (seq >= 1),
					kind TEXT NOT NULL,
					payload TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (run_id, seq)
				) STRICT`,
				`CREATE TRIGGER turn_run_events_append_only_update
				BEFORE UPDATE ON turn_run_events
				BEGIN
					SELECT RAISE(ABORT, '运行事件只追加，不能修改');
				END`,
				`CREATE TRIGGER turn_run_events_append_only_delete
				BEFORE DELETE ON turn_run_events
				BEGIN
					SELECT RAISE(ABORT, '运行事件只追加，不能删除');
				END`,
			],
		},
		{
			version: 41,
			description: "导演手记：每个楼层保存手记修改，沿路径累加",
			statements: [
				`CREATE TABLE director_notes (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					diffs TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX director_notes_story_idx ON director_notes(story_id)",
				`CREATE TRIGGER director_notes_story_matches_node
				BEFORE INSERT ON director_notes
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '导演手记的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER director_notes_identity_immutable
				BEFORE UPDATE ON director_notes
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '导演手记的楼层与故事归属不可修改');
				END`,
			],
		},
		{
			version: 42,
			description: "故事级插件开关与配置覆盖；同一故事的所有分支共享",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN plugin_overrides TEXT NOT NULL
					DEFAULT '{}'`,
			],
		},
		{
			version: 43,
			description: "代码插件的安装记录：清单、已授予权限、来源与时间",
			statements: [
				`CREATE TABLE plugin_installations (
					name TEXT PRIMARY KEY,
					version TEXT NOT NULL,
					manifest TEXT NOT NULL,
					granted_permissions TEXT NOT NULL,
					source_kind TEXT NOT NULL
						CHECK (source_kind IN ('npm', 'git', 'zip')),
					source_spec TEXT NOT NULL,
					installed_at TEXT NOT NULL
				) STRICT`,
			],
		},
		{
			version: 44,
			description: "应用内助手：会话、消息、只追加事件与消息正文 trigram 检索",
			statements: [
				`CREATE TABLE assistant_conversations (
					id TEXT PRIMARY KEY,
					story_id TEXT REFERENCES stories(id),
					skill TEXT NOT NULL CHECK (length(trim(skill)) > 0),
					title TEXT NOT NULL CHECK (length(trim(title)) > 0),
					permission TEXT NOT NULL
						CHECK (permission IN ('read_only', 'confirm', 'auto')),
					status TEXT NOT NULL CHECK (status IN (
						'idle', 'running', 'completed', 'failed', 'cancelled',
						'interrupted'
					)),
					model_alias TEXT,
					thinking TEXT NOT NULL CHECK (thinking IN ('off', 'low', 'high')),
					context_budget INTEGER NOT NULL DEFAULT 48000
						CHECK (context_budget >= 1),
					compaction_threshold REAL NOT NULL DEFAULT 0.8
						CHECK (compaction_threshold BETWEEN 0.5 AND 0.95),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					last_message_at TEXT
				) STRICT`,
				"CREATE INDEX assistant_conversations_story_idx ON assistant_conversations(story_id)",
				"CREATE INDEX assistant_conversations_title_idx ON assistant_conversations(title)",
				`CREATE TABLE assistant_messages (
					conversation_id TEXT NOT NULL
						REFERENCES assistant_conversations(id) ON DELETE CASCADE,
					ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
					role TEXT NOT NULL
						CHECK (role IN ('user', 'assistant', 'tool', 'system')),
					text TEXT NOT NULL,
					tool_name TEXT,
					tool_result TEXT,
					usage TEXT,
					created_at TEXT NOT NULL,
					PRIMARY KEY (conversation_id, ordinal),
					CHECK (role = 'tool' OR tool_name IS NULL),
					CHECK (role = 'tool' OR tool_result IS NULL),
					CHECK (role = 'assistant' OR usage IS NULL),
					CHECK (role <> 'tool' OR tool_name IS NOT NULL)
				) STRICT`,
				`CREATE VIRTUAL TABLE assistant_message_text USING fts5(
					conversation_id UNINDEXED,
					ordinal UNINDEXED,
					text,
					tokenize = 'trigram'
				)`,
				`CREATE TRIGGER assistant_messages_fts_insert AFTER INSERT ON assistant_messages
				BEGIN
					INSERT INTO assistant_message_text(rowid, conversation_id, ordinal, text)
					VALUES (new.rowid, new.conversation_id, new.ordinal, new.text);
				END`,
				`CREATE TRIGGER assistant_messages_fts_delete AFTER DELETE ON assistant_messages
				BEGIN
					DELETE FROM assistant_message_text WHERE rowid = old.rowid;
				END`,
				`CREATE TABLE assistant_events (
					conversation_id TEXT NOT NULL
						REFERENCES assistant_conversations(id) ON DELETE CASCADE,
					seq INTEGER NOT NULL CHECK (seq >= 1),
					kind TEXT NOT NULL,
					payload TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (conversation_id, seq)
				) STRICT`,
				`CREATE TRIGGER assistant_events_append_only_update
				BEFORE UPDATE ON assistant_events
				BEGIN
					SELECT RAISE(ABORT, '助手事件只追加，不能修改');
				END`,
				// 会话删除时父行已经不存在，触发器放行；单独删除事件仍然被拒绝。
				`CREATE TRIGGER assistant_events_append_only_delete
				BEFORE DELETE ON assistant_events
				WHEN EXISTS (
					SELECT 1 FROM assistant_conversations
					WHERE id = old.conversation_id
				)
				BEGIN
					SELECT RAISE(ABORT, '助手事件只追加，不能删除');
				END`,
			],
		},
		{
			version: 45,
			description: "助手待确认动作；台账变更卡允许助手来源并记录会话",
			statements: [
				`CREATE TABLE assistant_actions (
					id TEXT PRIMARY KEY,
					conversation_id TEXT NOT NULL
						REFERENCES assistant_conversations(id) ON DELETE CASCADE,
					story_id TEXT REFERENCES stories(id),
					kind TEXT NOT NULL CHECK (kind IN (
						'channels', 'settings', 'template', 'lore',
						'director_plan', 'card', 'image_config'
					)),
					summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
					payload TEXT NOT NULL,
					status TEXT NOT NULL
						CHECK (status IN ('pending', 'approved', 'rejected')),
					rejection_reason TEXT,
					created_at TEXT NOT NULL,
					decided_at TEXT,
					CHECK (
						(status = 'pending' AND decided_at IS NULL AND rejection_reason IS NULL)
						OR (status = 'approved' AND decided_at IS NOT NULL AND rejection_reason IS NULL)
						OR (status = 'rejected' AND decided_at IS NOT NULL AND rejection_reason IS NOT NULL)
					)
				) STRICT`,
				`CREATE UNIQUE INDEX assistant_actions_pending_payload_idx
					ON assistant_actions(conversation_id, kind, payload)
					WHERE status = 'pending'`,
				"CREATE INDEX assistant_actions_story_status_idx ON assistant_actions(story_id, status, created_at)",
				`CREATE TRIGGER assistant_actions_story_matches_conversation
				BEFORE INSERT ON assistant_actions
				WHEN COALESCE((SELECT story_id FROM assistant_conversations WHERE id = NEW.conversation_id), '') <> COALESCE(NEW.story_id, '')
				BEGIN
					SELECT RAISE(ABORT, '助手动作的 story_id 必须与会话一致');
				END`,
				`CREATE TRIGGER assistant_actions_identity_immutable
				BEFORE UPDATE ON assistant_actions
				WHEN NEW.id <> OLD.id
					OR NEW.conversation_id <> OLD.conversation_id
					OR COALESCE(NEW.story_id, '') <> COALESCE(OLD.story_id, '')
					OR NEW.kind <> OLD.kind
					OR NEW.summary <> OLD.summary
					OR NEW.payload <> OLD.payload
					OR NEW.created_at <> OLD.created_at
					OR OLD.status <> 'pending'
				BEGIN
					SELECT RAISE(ABORT, '助手动作的内容与归属不可修改');
				END`,
				`CREATE TABLE ledger_change_cards_next (
					id TEXT PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					source TEXT NOT NULL CHECK (source IN ('model', 'settler', 'player', 'import', 'assistant')),
					assistant_conversation_id TEXT
						REFERENCES assistant_conversations(id) ON DELETE SET NULL,
					source_node_id TEXT NOT NULL REFERENCES nodes(id),
					text TEXT NOT NULL,
					diffs TEXT NOT NULL,
					before TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'rolled_back')),
					rejection_reason TEXT,
					created_at TEXT NOT NULL,
					decided_at TEXT
				) STRICT`,
				`INSERT INTO ledger_change_cards_next
					(id, story_id, source, assistant_conversation_id, source_node_id, text, diffs, before, status, rejection_reason, created_at, decided_at)
				SELECT id, story_id, source, NULL, source_node_id, text, diffs, before, status, rejection_reason, created_at, decided_at
				FROM ledger_change_cards`,
				"DROP TABLE ledger_change_cards",
				"ALTER TABLE ledger_change_cards_next RENAME TO ledger_change_cards",
				"CREATE INDEX ledger_change_cards_story_idx ON ledger_change_cards(story_id, status)",
				"CREATE INDEX ledger_change_cards_assistant_idx ON ledger_change_cards(assistant_conversation_id)",
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
					OR COALESCE(NEW.assistant_conversation_id, '') <> COALESCE(OLD.assistant_conversation_id, '')
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
			version: 46,
			description: "助手上下文压缩记录：摘要、被省略的消息序号与压缩前后 token",
			statements: [
				`CREATE TABLE assistant_compactions (
					id TEXT PRIMARY KEY,
					conversation_id TEXT NOT NULL
						REFERENCES assistant_conversations(id) ON DELETE CASCADE,
					seq INTEGER NOT NULL CHECK (seq >= 1),
					summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
					omitted_message_ids TEXT NOT NULL,
					before_tokens INTEGER NOT NULL CHECK (before_tokens >= 0),
					after_tokens INTEGER NOT NULL CHECK (after_tokens >= 0),
					created_at TEXT NOT NULL,
					UNIQUE (conversation_id, seq)
				) STRICT`,
				`CREATE TRIGGER assistant_compactions_append_only_update
				BEFORE UPDATE ON assistant_compactions
				BEGIN
					SELECT RAISE(ABORT, '助手压缩记录只追加，不能修改');
				END`,
				// 会话删除时父行已经不存在，触发器放行；单独删除压缩记录仍然被拒绝。
				`CREATE TRIGGER assistant_compactions_append_only_delete
				BEFORE DELETE ON assistant_compactions
				WHEN EXISTS (
					SELECT 1 FROM assistant_conversations
					WHERE id = old.conversation_id
				)
				BEGIN
					SELECT RAISE(ABORT, '助手压缩记录只追加，不能删除');
				END`,
			],
		},
		{
			version: 47,
			description: "世界模型的表示方式：台账、实体档案或时序知识图谱",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN world_model TEXT NOT NULL
					DEFAULT 'ledger' CHECK (world_model IN ('ledger', 'wiki', 'temporal_graph'))`,
			],
		},
		{
			version: 48,
			description: "实体档案修订：只追加的正文版本，按当前路径取最新一版",
			statements: [
				`CREATE TABLE world_wiki_revisions (
					id INTEGER PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) > 0),
					node_id TEXT NOT NULL REFERENCES nodes(id),
					text TEXT NOT NULL CHECK (length(trim(text)) > 0),
					story_time_start TEXT,
					story_time_end TEXT,
					source TEXT NOT NULL CHECK (source IN ('model', 'settler', 'player', 'import')),
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX world_wiki_revisions_path_idx ON world_wiki_revisions(story_id, node_id)",
				`CREATE TRIGGER world_wiki_revisions_story_matches_node
				BEFORE INSERT ON world_wiki_revisions
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '实体档案修订的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER world_wiki_revisions_append_only_update
				BEFORE UPDATE ON world_wiki_revisions
				BEGIN
					SELECT RAISE(ABORT, '实体档案修订只追加，不能修改');
				END`,
				// 楼层仍然存在时拒绝删除；整段故事被清理后父行先消失，不会被挡住。
				`CREATE TRIGGER world_wiki_revisions_append_only_delete
				BEFORE DELETE ON world_wiki_revisions
				WHEN EXISTS (SELECT 1 FROM nodes WHERE id = old.node_id)
				BEGIN
					SELECT RAISE(ABORT, '实体档案修订只追加，不能删除');
				END`,
			],
		},
		{
			version: 49,
			description: "导演的组织方式：现有机制序列或剧情小品引擎",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN director_organization TEXT NOT NULL
					DEFAULT 'mechanisms' CHECK (director_organization IN ('mechanisms', 'bits'))`,
			],
		},
		{
			version: 50,
			description: "剧情小品的定义与按楼层缓存的条件判断",
			statements: [
				`CREATE TABLE story_director_bits (
					story_id TEXT NOT NULL REFERENCES stories(id),
					bit_id TEXT NOT NULL CHECK (length(trim(bit_id)) > 0),
					payload TEXT NOT NULL,
					source TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (story_id, bit_id)
				) STRICT`,
				"CREATE INDEX story_director_bits_story_idx ON story_director_bits(story_id)",
				`CREATE TABLE story_director_bit_judgments (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					fingerprint TEXT NOT NULL CHECK (length(trim(fingerprint)) > 0),
					judgments TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				`CREATE TRIGGER story_director_bit_judgments_story_matches_node
				BEFORE INSERT ON story_director_bit_judgments
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '剧情小品条件判断的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER story_director_bit_judgments_identity_immutable
				BEFORE UPDATE OF node_id, story_id ON story_director_bit_judgments
				BEGIN
					SELECT RAISE(ABORT, '剧情小品条件判断的楼层与故事不能修改');
				END`,
			],
		},
		{
			version: 51,
			description: "故事自带的封面与人物立绘（导入的角色卡图片）",
			statements: [
				`CREATE TABLE story_media (
					story_id TEXT NOT NULL REFERENCES stories(id),
					slot TEXT NOT NULL CHECK (slot IN ('cover', 'portrait')),
					name TEXT NOT NULL CHECK (length(trim(name)) > 0),
					file_name TEXT NOT NULL CHECK (length(trim(file_name)) > 0),
					media_type TEXT NOT NULL CHECK (length(trim(media_type)) > 0),
					byte_size INTEGER NOT NULL CHECK (byte_size > 0),
					created_at TEXT NOT NULL,
					PRIMARY KEY (story_id, slot, name)
				) STRICT`,
				"CREATE INDEX story_media_story_idx ON story_media(story_id)",
			],
		},
		{
			version: 52,
			description: "默认模板的段落排布（按易变性排布或旧顺序）",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN context_layout TEXT NOT NULL
					DEFAULT 'volatility'`,
			],
		},
		{
			version: 53,
			description: "场记记录与开关：每楼一次调用的节拍、状态、在场者与场次边界",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN scene_log_enabled INTEGER NOT NULL
					DEFAULT 0 CHECK (scene_log_enabled IN (0, 1))`,
				`CREATE TABLE scene_logs (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					beat TEXT NOT NULL CHECK (length(trim(beat)) > 0),
					present TEXT NOT NULL,
					scene_ends INTEGER NOT NULL CHECK (scene_ends IN (0, 1)),
					bits TEXT NOT NULL,
					conditions TEXT NOT NULL,
					states TEXT NOT NULL,
					quote_submitted INTEGER NOT NULL CHECK (quote_submitted >= 0),
					quote_verified INTEGER NOT NULL CHECK (
						quote_verified >= 0 AND quote_verified <= quote_submitted
					),
					repairs TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX scene_logs_story_idx ON scene_logs(story_id)",
				`CREATE TRIGGER scene_logs_story_matches_node
				BEFORE INSERT ON scene_logs
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '场记记录的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER scene_logs_identity_immutable
				BEFORE UPDATE OF node_id, story_id ON scene_logs
				BEGIN
					SELECT RAISE(ABORT, '场记记录的楼层与故事不能修改');
				END`,
			],
		},
		{
			version: 54,
			description:
				"场次归档：每场结束时一次调用产出的摘要、在场者、状态变化与线索",
			statements: [
				`CREATE TABLE scene_archives (
					end_node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					start_node_id TEXT NOT NULL REFERENCES nodes(id),
					floor_count INTEGER NOT NULL CHECK (floor_count > 0),
					boundary TEXT NOT NULL CHECK (boundary IN ('scene-ends', 'max-floors')),
					summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
					present TEXT NOT NULL,
					state_changes TEXT NOT NULL,
					clues_opened TEXT NOT NULL,
					clues_closed TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX scene_archives_story_idx ON scene_archives(story_id)",
				`CREATE TRIGGER scene_archives_story_matches_node
				BEFORE INSERT ON scene_archives
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.end_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '场次归档的 story_id 必须与结束楼层一致');
				END`,
				`CREATE TRIGGER scene_archives_start_matches_story
				BEFORE INSERT ON scene_archives
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.start_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '场次归档的起始楼层必须属于同一故事');
				END`,
				`CREATE TRIGGER scene_archives_identity_immutable
				BEFORE UPDATE OF end_node_id, story_id ON scene_archives
				BEGIN
					SELECT RAISE(ABORT, '场次归档的结束楼层与故事不能修改');
				END`,
			],
		},
		{
			version: 55,
			description: "导入体检：分型结果逐条保存，故事记录升级或原样两种导入模式",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN import_mode TEXT NOT NULL
					DEFAULT 'upgrade' CHECK (import_mode IN ('upgrade', 'raw'))`,
				`CREATE TABLE import_audit_entries (
					story_id TEXT NOT NULL REFERENCES stories(id),
					source TEXT NOT NULL CHECK (length(source) > 0),
					title TEXT NOT NULL,
					content TEXT NOT NULL,
					matches TEXT NOT NULL,
					rule_primary TEXT NOT NULL,
					kind TEXT NOT NULL,
					kind_source TEXT NOT NULL
						CHECK (kind_source IN ('rule', 'model', 'player')),
					constant INTEGER NOT NULL CHECK (constant IN (0, 1)),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					PRIMARY KEY (story_id, source)
				) STRICT`,
				`CREATE TRIGGER import_audit_entries_identity_immutable
				BEFORE UPDATE OF story_id, source ON import_audit_entries
				BEGIN
					SELECT RAISE(ABORT, '导入审计的故事与来源不能修改');
				END`,
			],
		},
		{
			version: 56,
			description:
				"导入体检：插件残留可以转成初始记忆，转换后不再进入每轮常驻集合",
			statements: [
				`ALTER TABLE import_audit_entries ADD COLUMN memory INTEGER NOT NULL
					DEFAULT 0 CHECK (memory IN (0, 1))`,
			],
		},
		{
			version: 57,
			description: "规则层：卡声明的检定与资源扣减",
			statements: [
				`CREATE TABLE story_rules (
					story_id TEXT NOT NULL REFERENCES stories(id),
					rule_id TEXT NOT NULL CHECK (length(rule_id) > 0),
					payload TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (story_id, rule_id)
				) STRICT`,
				`CREATE TRIGGER story_rules_identity_immutable
				BEFORE UPDATE OF story_id, rule_id ON story_rules
				BEGIN
					SELECT RAISE(ABORT, '规则声明的故事与 id 不能修改');
				END`,
			],
		},
		{
			version: 58,
			description: "导演的线：每个楼层保存线修改，沿路径累加",
			statements: [
				`CREATE TABLE director_lines (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					diffs TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX director_lines_story_idx ON director_lines(story_id)",
				`CREATE TRIGGER director_lines_story_matches_node
				BEFORE INSERT ON director_lines
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '线修改的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER director_lines_identity_immutable
				BEFORE UPDATE ON director_lines
				WHEN NEW.node_id <> OLD.node_id OR NEW.story_id <> OLD.story_id
				BEGIN
					SELECT RAISE(ABORT, '线修改的楼层与故事归属不可修改');
				END`,
			],
		},
		{
			version: 59,
			description: "章末清点：只追加的伏笔处理与下一章聚焦",
			statements: [
				`CREATE TABLE director_chapter_reviews (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					payload TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX director_chapter_reviews_story_idx ON director_chapter_reviews(story_id)",
				`CREATE TRIGGER director_chapter_reviews_story_matches_node
				BEFORE INSERT ON director_chapter_reviews
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '章末清点的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER director_chapter_reviews_append_only
				BEFORE UPDATE ON director_chapter_reviews
				BEGIN
					SELECT RAISE(ABORT, '章末清点记录只追加，不能修改');
				END`,
			],
		},
		{
			version: 60,
			description: "导演的组织方式允许线与动作引擎",
			statements: [
				`CREATE TABLE story_settings_next (
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
					updated_at TEXT NOT NULL,
					history_block_policy TEXT NOT NULL DEFAULT '{"mode":"default","overrides":{}}',
					gap_pass_enabled INTEGER NOT NULL DEFAULT 0 CHECK (gap_pass_enabled IN (0, 1)),
					gap_plan_seconds INTEGER NOT NULL DEFAULT 212 CHECK (gap_plan_seconds >= 0),
					turn_mode TEXT NOT NULL DEFAULT 'fast' CHECK (turn_mode IN ('fast', 'deep')),
					max_read_rounds INTEGER NOT NULL DEFAULT 3 CHECK (max_read_rounds >= 0),
					image_config TEXT,
					deep_max_tool_calls INTEGER NOT NULL DEFAULT 40 CHECK (deep_max_tool_calls BETWEEN 1 AND 200),
					deep_timeout_ms INTEGER NOT NULL DEFAULT 600000 CHECK (deep_timeout_ms BETWEEN 60000 AND 3600000),
					deep_context_token_limit INTEGER NOT NULL DEFAULT 48000 CHECK (deep_context_token_limit >= 1),
					deep_recent_tool_steps INTEGER NOT NULL DEFAULT 4 CHECK (deep_recent_tool_steps BETWEEN 1 AND 20),
					plugin_overrides TEXT NOT NULL DEFAULT '{}',
					world_model TEXT NOT NULL DEFAULT 'ledger' CHECK (world_model IN ('ledger', 'wiki', 'temporal_graph')),
					director_organization TEXT NOT NULL DEFAULT 'mechanisms' CHECK (director_organization IN ('mechanisms', 'bits', 'lines')),
					context_layout TEXT NOT NULL DEFAULT 'volatility',
					scene_log_enabled INTEGER NOT NULL DEFAULT 0 CHECK (scene_log_enabled IN (0, 1)),
					import_mode TEXT NOT NULL DEFAULT 'upgrade' CHECK (import_mode IN ('upgrade', 'raw'))
				) STRICT`,
				`INSERT INTO story_settings_next
					(story_id, card_name, character_prompt, persona, template_id, model,
					 budget_tokens, structured_output, temperature, max_tokens, reasoning,
					 viewpoint, director_config, updated_at, history_block_policy,
					 gap_pass_enabled, gap_plan_seconds, turn_mode, max_read_rounds,
					 image_config, deep_max_tool_calls, deep_timeout_ms,
					 deep_context_token_limit, deep_recent_tool_steps, plugin_overrides,
					 world_model, director_organization, context_layout,
					 scene_log_enabled, import_mode)
				SELECT story_id, card_name, character_prompt, persona, template_id, model,
					 budget_tokens, structured_output, temperature, max_tokens, reasoning,
					 viewpoint, director_config, updated_at, history_block_policy,
					 gap_pass_enabled, gap_plan_seconds, turn_mode, max_read_rounds,
					 image_config, deep_max_tool_calls, deep_timeout_ms,
					 deep_context_token_limit, deep_recent_tool_steps, plugin_overrides,
					 world_model, director_organization, context_layout,
					 scene_log_enabled, import_mode
				FROM story_settings`,
				"DROP TABLE story_settings",
				"ALTER TABLE story_settings_next RENAME TO story_settings",
			],
		},
		{
			version: 61,
			description: "场记记录增加场面卡",
			statements: ["ALTER TABLE scene_logs ADD COLUMN scene_card TEXT"],
		},
		{
			version: 62,
			description:
				"场面控制：玩家在场楼直接结束这一场、跳时间与调整节奏；场次归档允许玩家结束",
			statements: [
				`CREATE TABLE scene_archives_next (
					end_node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					start_node_id TEXT NOT NULL REFERENCES nodes(id),
					floor_count INTEGER NOT NULL CHECK (floor_count > 0),
					boundary TEXT NOT NULL CHECK (
						boundary IN ('scene-ends', 'max-floors', 'player-ends')
					),
					summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
					present TEXT NOT NULL,
					state_changes TEXT NOT NULL,
					clues_opened TEXT NOT NULL,
					clues_closed TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				`INSERT INTO scene_archives_next
					(end_node_id, story_id, start_node_id, floor_count, boundary, summary,
					 present, state_changes, clues_opened, clues_closed, created_at)
				SELECT end_node_id, story_id, start_node_id, floor_count, boundary, summary,
					 present, state_changes, clues_opened, clues_closed, created_at
				FROM scene_archives`,
				"DROP TABLE scene_archives",
				"ALTER TABLE scene_archives_next RENAME TO scene_archives",
				"CREATE INDEX scene_archives_story_idx ON scene_archives(story_id)",
				`CREATE TRIGGER scene_archives_story_matches_node
				BEFORE INSERT ON scene_archives
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.end_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '场次归档的 story_id 必须与结束楼层一致');
				END`,
				`CREATE TRIGGER scene_archives_start_matches_story
				BEFORE INSERT ON scene_archives
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.start_node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '场次归档的起始楼层必须属于同一故事');
				END`,
				`CREATE TRIGGER scene_archives_identity_immutable
				BEFORE UPDATE OF end_node_id, story_id ON scene_archives
				BEGIN
					SELECT RAISE(ABORT, '场次归档的结束楼层与故事不能修改');
				END`,
				`CREATE TABLE scene_controls (
					node_id TEXT NOT NULL REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					kind TEXT NOT NULL CHECK (kind IN ('end-scene', 'jump-time', 'pace')),
					payload TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (node_id, kind)
				) STRICT`,
				"CREATE INDEX scene_controls_story_idx ON scene_controls(story_id)",
				`CREATE TRIGGER scene_controls_story_matches_node
				BEFORE INSERT ON scene_controls
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '场面控制的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER scene_controls_identity_immutable
				BEFORE UPDATE OF node_id, story_id, kind ON scene_controls
				BEGIN
					SELECT RAISE(ABORT, '场面控制的楼层、故事与种类不能修改');
				END`,
			],
		},
		{
			version: 63,
			description: "场次归档增加人物档案与知情记录",
			statements: [
				"ALTER TABLE scene_archives ADD COLUMN profiles TEXT NOT NULL DEFAULT '[]'",
				"ALTER TABLE scene_archives ADD COLUMN informed TEXT NOT NULL DEFAULT '[]'",
			],
		},
		{
			version: 64,
			description: "故事蓝图：每个楼层保存蓝图修改，沿路径累加，分支各自成版本",
			statements: [
				`CREATE TABLE story_blueprints (
					node_id TEXT PRIMARY KEY REFERENCES nodes(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					source TEXT NOT NULL CHECK (source IN ('player', 'ai')),
					diffs TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX story_blueprints_story_idx ON story_blueprints(story_id)",
				`CREATE TRIGGER story_blueprints_story_matches_node
				BEFORE INSERT ON story_blueprints
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '蓝图修改的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER story_blueprints_append_only
				BEFORE UPDATE ON story_blueprints
				BEGIN
					SELECT RAISE(ABORT, '蓝图修改的记录只追加，不能修改');
				END`,
			],
		},
		{
			version: 65,
			description: "蓝图同一楼层保存多批修改，逐条接受建议时按批次追加",
			statements: [
				`CREATE TABLE story_blueprints_next (
					node_id TEXT NOT NULL REFERENCES nodes(id),
					seq INTEGER NOT NULL CHECK (seq >= 1),
					story_id TEXT NOT NULL REFERENCES stories(id),
					source TEXT NOT NULL CHECK (source IN ('player', 'ai')),
					diffs TEXT NOT NULL,
					created_at TEXT NOT NULL,
					PRIMARY KEY (node_id, seq)
				) STRICT`,
				`INSERT INTO story_blueprints_next (node_id, seq, story_id, source, diffs, created_at)
				SELECT node_id, 1, story_id, source, diffs, created_at FROM story_blueprints`,
				"DROP TABLE story_blueprints",
				"ALTER TABLE story_blueprints_next RENAME TO story_blueprints",
				"CREATE INDEX story_blueprints_story_idx ON story_blueprints(story_id)",
				`CREATE TRIGGER story_blueprints_story_matches_node
				BEFORE INSERT ON story_blueprints
				WHEN COALESCE((SELECT story_id FROM nodes WHERE id = NEW.node_id), '') <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '蓝图修改的 story_id 必须与所在楼层一致');
				END`,
				`CREATE TRIGGER story_blueprints_append_only
				BEFORE UPDATE ON story_blueprints
				BEGIN
					SELECT RAISE(ABORT, '蓝图修改的记录只追加，不能修改');
				END`,
			],
		},
		{
			version: 66,
			description: "蓝图建议请求与建议；生成时不写蓝图，玩家逐条接受",
			statements: [
				`CREATE TABLE blueprint_suggestion_requests (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					story_id TEXT NOT NULL REFERENCES stories(id),
					operation TEXT NOT NULL CHECK (operation IN (
						'complete', 'find-flaws', 'three-directions',
						'expand-volume', 'recent-update'
					)),
					note TEXT NOT NULL,
					status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
					created_at TEXT NOT NULL,
					finished_at TEXT,
					CHECK (
						(status = 'pending' AND finished_at IS NULL)
						OR (status = 'done' AND finished_at IS NOT NULL)
					)
				) STRICT`,
				`CREATE INDEX blueprint_suggestion_requests_story_status_idx
					ON blueprint_suggestion_requests(story_id, status, created_at)`,
				`CREATE TRIGGER blueprint_suggestion_requests_identity_immutable
				BEFORE UPDATE ON blueprint_suggestion_requests
				WHEN NEW.id <> OLD.id
					OR NEW.story_id <> OLD.story_id
					OR NEW.operation <> OLD.operation
					OR NEW.note <> OLD.note
					OR NEW.created_at <> OLD.created_at
					OR OLD.status <> 'pending'
				BEGIN
					SELECT RAISE(ABORT, '蓝图建议请求的内容与归属不可修改');
				END`,
				`CREATE TABLE blueprint_suggestions (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					request_id INTEGER NOT NULL
						REFERENCES blueprint_suggestion_requests(id),
					story_id TEXT NOT NULL REFERENCES stories(id),
					title TEXT NOT NULL,
					reason TEXT NOT NULL,
					diffs TEXT NOT NULL,
					status TEXT NOT NULL
						CHECK (status IN ('pending', 'accepted', 'rejected')),
					created_at TEXT NOT NULL,
					decided_at TEXT,
					CHECK (
						(status = 'pending' AND decided_at IS NULL)
						OR (status IN ('accepted', 'rejected') AND decided_at IS NOT NULL)
					)
				) STRICT`,
				`CREATE INDEX blueprint_suggestions_story_status_idx
					ON blueprint_suggestions(story_id, status, created_at)`,
				`CREATE INDEX blueprint_suggestions_request_idx
					ON blueprint_suggestions(request_id)`,
				`CREATE TRIGGER blueprint_suggestions_story_matches_request
				BEFORE INSERT ON blueprint_suggestions
				WHEN COALESCE(
					(SELECT story_id FROM blueprint_suggestion_requests WHERE id = NEW.request_id),
					''
				) <> NEW.story_id
				BEGIN
					SELECT RAISE(ABORT, '蓝图建议的 story_id 必须与请求一致');
				END`,
				`CREATE TRIGGER blueprint_suggestions_identity_immutable
				BEFORE UPDATE ON blueprint_suggestions
				WHEN NEW.id <> OLD.id
					OR NEW.request_id <> OLD.request_id
					OR NEW.story_id <> OLD.story_id
					OR NEW.title <> OLD.title
					OR NEW.reason <> OLD.reason
					OR NEW.diffs <> OLD.diffs
					OR NEW.created_at <> OLD.created_at
					OR OLD.status <> 'pending'
				BEGIN
					SELECT RAISE(ABORT, '蓝图建议的内容与归属不可修改');
				END`,
			],
		},
		{
			version: 67,
			description: "蓝图剧透设置与卡导入的默认蓝图",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN blueprint_spoilers TEXT NOT NULL
					DEFAULT 'show' CHECK (blueprint_spoilers IN ('show', 'hide'))`,
				`CREATE TABLE story_blueprint_baselines (
					story_id TEXT PRIMARY KEY REFERENCES stories(id),
					entries TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
			],
		},
		{
			version: 68,
			description: "功能开关的档位与故事级覆盖",
			statements: [
				`ALTER TABLE story_settings ADD COLUMN feature_tier TEXT NOT NULL
					DEFAULT 'standard'
					CHECK (feature_tier IN ('lite', 'standard', 'immersive'))`,
				`ALTER TABLE story_settings ADD COLUMN feature_switches TEXT NOT NULL
					DEFAULT '{}'`,
			],
		},
		{
			version: 69,
			description: "玩家撤回的剧情线",
			statements: [
				`CREATE TABLE director_muted_lines (
					story_id TEXT NOT NULL REFERENCES stories(id),
					line_id TEXT NOT NULL,
					node_id TEXT,
					created_at TEXT NOT NULL,
					PRIMARY KEY (story_id, line_id)
				) STRICT`,
			],
		},
		{
			version: 70,
			description: "玩家的直接修改、记录的逐字出处与被拒绝的写入",
			statements: [
				`CREATE TABLE player_edits (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					story_id TEXT NOT NULL REFERENCES stories(id),
					node_id TEXT,
					kind TEXT NOT NULL,
					target TEXT NOT NULL,
					value TEXT,
					locked INTEGER NOT NULL DEFAULT 0,
					disabled INTEGER NOT NULL DEFAULT 0,
					source TEXT NOT NULL,
					note TEXT,
					created_at TEXT NOT NULL
				) STRICT`,
				"CREATE INDEX player_edits_lookup ON player_edits (story_id, kind, target)",
				`CREATE TABLE memory_event_quotes (
					event_id TEXT PRIMARY KEY,
					story_id TEXT NOT NULL REFERENCES stories(id),
					quote TEXT NOT NULL
				) STRICT`,
				`CREATE TABLE memory_rejections (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					story_id TEXT NOT NULL REFERENCES stories(id),
					node_id TEXT,
					kind TEXT NOT NULL,
					text TEXT NOT NULL,
					reason TEXT NOT NULL,
					created_at TEXT NOT NULL
				) STRICT`,
				`CREATE TABLE story_kv (
					story_id TEXT NOT NULL REFERENCES stories(id),
					key TEXT NOT NULL,
					value TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					PRIMARY KEY (story_id, key)
				) STRICT`,
			],
		},
		{
			version: 71,
			description: "记录的逐字出处与记录本身一样只追加",
			statements: [
				`CREATE TRIGGER memory_event_quotes_immutable
				BEFORE UPDATE ON memory_event_quotes
				BEGIN
					SELECT RAISE(ABORT, '记录的出处不可修改');
				END`,
				`CREATE TRIGGER memory_event_quotes_no_delete
				BEFORE DELETE ON memory_event_quotes
				BEGIN
					SELECT RAISE(ABORT, '记录的出处不可删除');
				END`,
			],
		},
		{
			version: 72,
			description: "玩家的修改与被拒绝的记录只追加",
			statements: [
				`CREATE TRIGGER player_edits_immutable
				BEFORE UPDATE ON player_edits
				BEGIN
					SELECT RAISE(ABORT, '玩家的修改不可修改');
				END`,
				`CREATE TRIGGER player_edits_no_delete
				BEFORE DELETE ON player_edits
				BEGIN
					SELECT RAISE(ABORT, '玩家的修改不可删除');
				END`,
				`CREATE TRIGGER memory_rejections_immutable
				BEFORE UPDATE ON memory_rejections
				BEGIN
					SELECT RAISE(ABORT, '被拒绝的记录不可修改');
				END`,
				`CREATE TRIGGER memory_rejections_no_delete
				BEFORE DELETE ON memory_rejections
				BEGIN
					SELECT RAISE(ABORT, '被拒绝的记录不可删除');
				END`,
			],
		},
		{
			version: 73,
			description: "出图模板区分后端：comfyui 或 novelai",
			statements: [
				"ALTER TABLE image_workflows ADD COLUMN kind TEXT NOT NULL DEFAULT 'comfyui' CHECK (kind IN ('comfyui', 'novelai'))",
			],
		},
		{
			version: 74,
			description:
				"后台任务记下实际的模型调用次数与 token，检视器按它算每楼调用",
			statements: [
				"ALTER TABLE background_jobs ADD COLUMN llm_calls INTEGER NOT NULL DEFAULT 0 CHECK (llm_calls >= 0)",
				"ALTER TABLE background_jobs ADD COLUMN llm_tokens INTEGER NOT NULL DEFAULT 0 CHECK (llm_tokens >= 0)",
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

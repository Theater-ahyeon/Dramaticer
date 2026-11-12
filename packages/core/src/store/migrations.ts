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

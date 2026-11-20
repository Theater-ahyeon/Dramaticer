// StoryStore 的领域仓储：世界书、导入分型、预筛与规则（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import {
	type DramaticerRuleDeclaration,
	parseDramaticerRuleDeclarations,
} from "../../ledger/rules.js";
import {
	type ImportAuditEntry,
	type ImportAuditInjectionRule,
	type ImportEntryKind,
	type ImportEntryKindSource,
	type ImportEntryMatch,
	type NewImportAuditEntry,
	assertImportEntryKind,
	assertImportEntryKindSource,
	assertImportEntryMatches,
} from "../../memory/import-audit.js";
import type {
	LoreEntry,
	LorePrefilter,
	NewLoreEntryInput,
	NewLorePrefilterInput,
} from "../../memory/lore.js";
import { serializeJsonValue } from "../json-value.js";
import { StoreRepo } from "./base.js";
import {
	assertNonEmptyString,
	parseStoredNameArray,
	readBooleanColumn,
} from "./shared.js";

interface StoryRuleRow {
	readonly story_id: string;
	readonly rule_id: string;
	readonly payload: string;
	readonly created_at: string;
}

interface ImportAuditEntryRow {
	readonly story_id: string;
	readonly source: string;
	readonly title: string;
	readonly content: string;
	readonly matches: string;
	readonly rule_primary: string;
	readonly kind: string;
	readonly kind_source: string;
	readonly constant: number;
	readonly memory: number;
	readonly created_at: string;
	readonly updated_at: string;
}

interface LoreEntryRow {
	readonly id: string;
	readonly story_id: string;
	readonly entity_id: string | null;
	readonly name: string;
	readonly content: string;
	readonly constant: number;
	readonly keywords: string;
	readonly source: string;
	readonly created_at: string;
}

interface LorePrefilterRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly entry_ids: string;
	readonly created_at: string;
}

interface NormalisedImportAuditEntry {
	readonly source: string;
	readonly title: string;
	readonly content: string;
	readonly matches: readonly ImportEntryMatch[];
	readonly rulePrimary: ImportEntryKind;
	readonly constant: boolean;
	readonly createdAt: string;
}

interface NormalisedLoreEntry {
	readonly id: string;
	readonly storyId: string;
	readonly entityId: string | null;
	readonly name: string;
	readonly content: string;
	readonly constant: boolean;
	readonly keywords: readonly string[];
	readonly source: string;
	readonly createdAt: string;
}

function normalisePrefilterEntryIds(value: readonly string[]): string[] {
	if (!Array.isArray(value)) {
		throw new Error("世界书预筛的 entryIds 必须是数组");
	}
	const seen = new Set<string>();
	const entryIds: string[] = [];
	for (const [index, item] of value.entries()) {
		const label = `世界书预筛 entryIds[${index}]`;
		assertNonEmptyString(item, label);
		if (item !== item.trim()) {
			throw new Error(`${label} 不能包含首尾空白`);
		}
		if (seen.has(item)) {
			throw new Error(`${label} 重复：${item}`);
		}
		seen.add(item);
		entryIds.push(item);
	}
	return entryIds;
}

function rowToImportAuditEntry(row: ImportAuditEntryRow): ImportAuditEntry {
	const label = `导入审计 ${row.source}`;
	return {
		storyId: row.story_id,
		source: row.source,
		title: row.title,
		content: row.content,
		matches: assertImportEntryMatches(
			JSON.parse(row.matches) as unknown,
			`${label} 的命中类型`,
		),
		rulePrimary: assertImportEntryKind(row.rule_primary, `${label} 的规则判定`),
		kind: assertImportEntryKind(row.kind, `${label} 的生效类型`),
		kindSource: assertImportEntryKindSource(
			row.kind_source,
			`${label} 的类型来源`,
		),
		constant: readBooleanColumn(row.constant, `${label} 的 constant`),
		memory: readBooleanColumn(row.memory, `${label} 的 memory`),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToLoreEntry(row: LoreEntryRow): LoreEntry {
	return {
		id: row.id,
		storyId: row.story_id,
		entityId: row.entity_id,
		name: row.name,
		content: row.content,
		constant: row.constant === 1,
		keywords: parseStoredNameArray(
			row.keywords,
			`世界书条目 ${row.id} 的关键词`,
		),
		source: row.source,
		createdAt: row.created_at,
	};
}

function rowToLorePrefilter(row: LorePrefilterRow): LorePrefilter {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		entryIds: parseStoredNameArray(
			row.entry_ids,
			`世界书预筛 ${row.node_id} 的条目 id`,
		),
		createdAt: row.created_at,
	};
}

export class LoreRepo extends StoreRepo {
	/**
	 * 整批替换故事里的规则声明；同一个故事只有一份声明，重复导入以最新卡为准。
	 */
	replaceStoryRules(input: {
		readonly storyId: string;
		readonly rules: readonly DramaticerRuleDeclaration[];
		readonly createdAt?: string;
	}): number {
		assertNonEmptyString(input.storyId, "规则声明的 storyId");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const rules = parseDramaticerRuleDeclarations(
			input.rules,
			`故事 ${input.storyId} 的规则声明`,
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "规则声明的创建时间");
		this.db.transaction(() => {
			this.db
				.prepare("DELETE FROM story_rules WHERE story_id = ?")
				.run(input.storyId);
			const insert = this.db.prepare(
				`INSERT INTO story_rules (story_id, rule_id, payload, created_at)
				VALUES (?, ?, ?, ?)`,
			);
			for (const rule of rules) {
				insert.run(
					input.storyId,
					rule.id,
					serializeJsonValue(rule, `规则声明 ${rule.id}`),
					createdAt,
				);
			}
		})();
		return rules.length;
	}

	/** 读出故事的规则声明，按导入顺序；没有声明时返回空数组。 */
	listStoryRules(storyId: string): DramaticerRuleDeclaration[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				"SELECT * FROM story_rules WHERE story_id = ? ORDER BY rowid ASC",
			)
			.all(storyId) as StoryRuleRow[];
		return parseDramaticerRuleDeclarations(
			rows.map((row) => {
				try {
					return JSON.parse(row.payload) as unknown;
				} catch {
					throw new Error(`规则声明 ${row.rule_id} 的 payload 不是合法 JSON`);
				}
			}),
			`故事 ${storyId} 的规则声明`,
		);
	}

	/**
	 * 写入世界书条目。`(story_id, source)` 唯一：重复导入同一来源时跳过已有行，
	 * 返回值只包含本次真正写入的条目。
	 */
	insertLoreEntries(inputs: readonly NewLoreEntryInput[]): LoreEntry[] {
		if (!Array.isArray(inputs)) {
			throw new Error("世界书条目必须是数组");
		}
		if (inputs.length === 0) return [];
		const normalised = inputs.map((input, index) =>
			this.#normaliseLoreEntry(input, index),
		);
		const insert = this.db.prepare(
			`INSERT INTO lore_entries
				(id, story_id, entity_id, name, content, constant, keywords, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT DO NOTHING`,
		);
		const created: LoreEntry[] = [];
		this.db.transaction(() => {
			for (const entry of normalised) {
				const result = insert.run(
					entry.id,
					entry.storyId,
					entry.entityId,
					entry.name,
					entry.content,
					entry.constant ? 1 : 0,
					JSON.stringify(entry.keywords),
					entry.source,
					entry.createdAt,
				);
				if (result.changes === 0) continue;
				created.push({
					id: entry.id,
					storyId: entry.storyId,
					entityId: entry.entityId,
					name: entry.name,
					content: entry.content,
					constant: entry.constant,
					keywords: entry.keywords,
					source: entry.source,
					createdAt: entry.createdAt,
				});
			}
		})();
		return created;
	}

	/** 按导入顺序列出故事里全部世界书条目。 */
	listLoreEntries(storyId: string): LoreEntry[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM lore_entries
				WHERE story_id = ?
				ORDER BY row_id ASC`,
			)
			.all(storyId) as LoreEntryRow[];
		return rows.map(rowToLoreEntry);
	}

	/**
	 * 写入导入分型结果。同一（故事，来源）重复导入时更新标题、正文与规则判定：
	 * 规则判定的类型跟随新的规则结果，模型或玩家改过的类型保持不变。
	 */
	saveImportAuditEntries(
		storyId: string,
		entries: readonly NewImportAuditEntry[],
	): ImportAuditEntry[] {
		assertNonEmptyString(storyId, "导入审计的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		if (!Array.isArray(entries)) {
			throw new Error("导入审计的条目必须是数组");
		}
		if (entries.length === 0) return [];
		const updatedAt = new Date().toISOString();
		const normalised: NormalisedImportAuditEntry[] = [];
		const seen = new Set<string>();
		for (const [index, entry] of entries.entries()) {
			const next = this.#normaliseImportAuditEntry(entry, index, updatedAt);
			if (seen.has(next.source)) {
				throw new Error(`导入审计的 source 重复：${next.source}`);
			}
			seen.add(next.source);
			normalised.push(next);
		}
		const upsert = this.db.prepare(
			`INSERT INTO import_audit_entries
				(story_id, source, title, content, matches, rule_primary, kind,
				 kind_source, constant, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'rule', ?, ?, ?)
			ON CONFLICT(story_id, source) DO UPDATE SET
				title = excluded.title,
				content = excluded.content,
				matches = excluded.matches,
				rule_primary = excluded.rule_primary,
				kind = CASE
					WHEN import_audit_entries.kind_source = 'rule' THEN excluded.kind
					ELSE import_audit_entries.kind
				END,
				constant = excluded.constant,
				updated_at = excluded.updated_at`,
		);
		this.db.transaction(() => {
			for (const entry of normalised) {
				upsert.run(
					storyId,
					entry.source,
					entry.title,
					entry.content,
					JSON.stringify(entry.matches),
					entry.rulePrimary,
					entry.rulePrimary,
					entry.constant ? 1 : 0,
					entry.createdAt,
					updatedAt,
				);
			}
		})();
		const saved = new Map(
			this.listImportAuditEntries(storyId).map((entry) => [
				entry.source,
				entry,
			]),
		);
		return normalised.map((entry) => {
			const row = saved.get(entry.source);
			if (row === undefined) {
				throw new Error(`导入审计写入后读取失败：${entry.source}`);
			}
			return row;
		});
	}

	/** 按导入顺序列出故事里的分型结果。 */
	listImportAuditEntries(storyId: string): ImportAuditEntry[] {
		assertNonEmptyString(storyId, "导入审计的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM import_audit_entries
				WHERE story_id = ?
				ORDER BY rowid ASC`,
			)
			.all(storyId) as ImportAuditEntryRow[];
		return rows.map(rowToImportAuditEntry);
	}

	/**
	 * 修改一条导入条目的生效类型：`player` 是玩家手动指定，`model` 是后台模型建议；
	 * `rule` 表示撤销改动、回到程序规则判定的类型。规则判定本身不变，
	 * 因此之后重复导入时只有 `rule` 来源的类型会跟着新规则变化。
	 */
	setImportAuditEntryKind(
		storyId: string,
		source: string,
		kind: ImportEntryKind,
		kindSource: ImportEntryKindSource,
	): ImportAuditEntry {
		assertNonEmptyString(storyId, "导入审计的故事 id");
		assertNonEmptyString(source, "导入审计的 source");
		const resolvedKind = assertImportEntryKind(kind, "导入审计的生效类型");
		const resolvedSource = assertImportEntryKindSource(
			kindSource,
			"导入审计的类型来源",
		);
		const row = this.db
			.prepare(
				`SELECT * FROM import_audit_entries
				WHERE story_id = ? AND source = ?`,
			)
			.get(storyId, source) as ImportAuditEntryRow | undefined;
		if (row === undefined) {
			throw new Error(`导入审计条目不存在：${source}`);
		}
		if (
			resolvedSource === "rule" &&
			resolvedKind !== assertImportEntryKind(row.rule_primary)
		) {
			throw new Error(
				`回到规则判定时类型必须是 ${row.rule_primary}：${resolvedKind}`,
			);
		}
		const updatedAt = new Date().toISOString();
		this.db
			.prepare(
				`UPDATE import_audit_entries
				SET kind = ?, kind_source = ?, updated_at = ?
				WHERE story_id = ? AND source = ?`,
			)
			.run(resolvedKind, resolvedSource, updatedAt, storyId, source);
		return rowToImportAuditEntry({
			...row,
			kind: resolvedKind,
			kind_source: resolvedSource,
			updated_at: updatedAt,
		});
	}

	/**
	 * 逐轮的注入判定只读来源、生效类型与记忆标记；不必解析命中的规则。
	 */
	listImportAuditInjectionRules(storyId: string): ImportAuditInjectionRule[] {
		assertNonEmptyString(storyId, "导入审计的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT source, kind, memory FROM import_audit_entries
				WHERE story_id = ?
				ORDER BY rowid ASC`,
			)
			.all(storyId) as {
			readonly source: string;
			readonly kind: string;
			readonly memory: number;
		}[];
		return rows.map((row) => ({
			source: row.source,
			kind: assertImportEntryKind(
				row.kind,
				`导入审计 ${row.source} 的生效类型`,
			),
			memory: readBooleanColumn(row.memory, `导入审计 ${row.source} 的 memory`),
		}));
	}

	/**
	 * 把一条插件残留条目转成初始记忆，或撤销这次转换。
	 * 转换后审计行记 `memory = 1`，对应的 lore 条目改为非常驻：不再进入每轮的
	 * 常驻集合，只在关键词命中时按记忆注入。撤销时 lore 的常驻标记回到导入时的值。
	 */
	setImportAuditEntryMemory(
		storyId: string,
		source: string,
		memory: boolean,
	): ImportAuditEntry {
		assertNonEmptyString(storyId, "导入审计的故事 id");
		assertNonEmptyString(source, "导入审计的 source");
		if (typeof memory !== "boolean") {
			throw new Error("导入审计的 memory 必须是布尔值");
		}
		const row = this.db
			.prepare(
				`SELECT * FROM import_audit_entries
				WHERE story_id = ? AND source = ?`,
			)
			.get(storyId, source) as ImportAuditEntryRow | undefined;
		if (row === undefined) {
			throw new Error(`导入审计条目不存在：${source}`);
		}
		if (memory && row.kind !== "plugin-residue") {
			throw new Error(`只有插件残留条目可以转成初始记忆：${source}`);
		}
		const updatedAt = new Date().toISOString();
		const restoredConstant = readBooleanColumn(
			row.constant,
			`${source} 的 constant`,
		);
		this.db.transaction(() => {
			this.db
				.prepare(
					`UPDATE import_audit_entries
					SET memory = ?, updated_at = ?
					WHERE story_id = ? AND source = ?`,
				)
				.run(memory ? 1 : 0, updatedAt, storyId, source);
			this.db
				.prepare(
					`UPDATE lore_entries SET constant = ?
					WHERE story_id = ? AND source = ?`,
				)
				.run(memory ? 0 : Number(restoredConstant), storyId, source);
			this.store.clearContextPacks(storyId);
		})();
		return rowToImportAuditEntry({
			...row,
			memory: memory ? 1 : 0,
			updated_at: updatedAt,
		});
	}

	/** 把所有仍是插件残留的条目一次转成初始记忆；返回本次转换的条数。 */
	convertImportAuditPluginResidueToMemory(storyId: string): number {
		assertNonEmptyString(storyId, "导入审计的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT source FROM import_audit_entries
				WHERE story_id = ? AND kind = 'plugin-residue' AND memory = 0
				ORDER BY rowid ASC`,
			)
			.all(storyId) as { readonly source: string }[];
		if (rows.length === 0) return 0;
		const updatedAt = new Date().toISOString();
		this.db.transaction(() => {
			const markMemory = this.db.prepare(
				`UPDATE import_audit_entries SET memory = 1, updated_at = ?
				WHERE story_id = ? AND source = ?`,
			);
			const dropConstant = this.db.prepare(
				`UPDATE lore_entries SET constant = 0
				WHERE story_id = ? AND source = ?`,
			);
			for (const row of rows) {
				markMemory.run(updatedAt, storyId, row.source);
				dropConstant.run(storyId, row.source);
			}
			this.store.clearContextPacks(storyId);
		})();
		return rows.length;
	}

	/**
	 * 写入一个楼层的世界书预筛结果；同一楼层覆盖同一行。
	 * 条目 id 必须是非空字符串且不重复，所属故事必须与楼层一致。
	 */
	saveLorePrefilter(input: NewLorePrefilterInput): LorePrefilter {
		assertNonEmptyString(input.nodeId, "世界书预筛的楼层 id");
		assertNonEmptyString(input.storyId, "世界书预筛的 storyId");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`世界书预筛的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const entryIds = normalisePrefilterEntryIds(input.entryIds);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "世界书预筛的 createdAt");
		this.db
			.prepare(
				`INSERT INTO lore_prefilter (node_id, story_id, entry_ids, created_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					entry_ids = excluded.entry_ids,
					created_at = excluded.created_at`,
			)
			.run(input.nodeId, input.storyId, JSON.stringify(entryIds), createdAt);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			entryIds,
			createdAt,
		};
	}

	/** 读取一个楼层的预筛结果；没有记录时返回 null。 */
	getLorePrefilter(nodeId: string): LorePrefilter | null {
		assertNonEmptyString(nodeId, "世界书预筛的楼层 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM lore_prefilter WHERE node_id = ?")
			.get(nodeId) as LorePrefilterRow | undefined;
		return row === undefined ? null : rowToLorePrefilter(row);
	}

	#normaliseImportAuditEntry(
		input: NewImportAuditEntry,
		index: number,
		updatedAt: string,
	): NormalisedImportAuditEntry {
		const label = `导入审计[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.source, `${label} 的 source`);
		if (typeof input.title !== "string") {
			throw new Error(`${label} 的 title 必须是字符串`);
		}
		if (typeof input.content !== "string" || input.content.length === 0) {
			throw new Error(`${label} 的 content 必须是非空字符串`);
		}
		const matches = assertImportEntryMatches(
			input.matches,
			`${label} 的命中类型`,
		);
		const rulePrimary = assertImportEntryKind(
			input.rulePrimary,
			`${label} 的规则判定`,
		);
		if (!matches.some((match) => match.kind === rulePrimary)) {
			throw new Error(
				`${label} 的规则判定 ${rulePrimary} 必须出现在命中类型里`,
			);
		}
		if (typeof input.constant !== "boolean") {
			throw new Error(`${label} 的 constant 必须是布尔值`);
		}
		const createdAt = input.createdAt ?? updatedAt;
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			source: input.source,
			title: input.title,
			content: input.content,
			matches,
			rulePrimary,
			constant: input.constant,
			createdAt,
		};
	}

	#normaliseLoreEntry(
		input: NewLoreEntryInput,
		index: number,
	): NormalisedLoreEntry {
		const label = `世界书条目[${index}]`;
		if (input === null || typeof input !== "object" || Array.isArray(input)) {
			throw new Error(`${label} 必须是对象`);
		}
		assertNonEmptyString(input.storyId, `${label} 的 storyId`);
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		assertNonEmptyString(input.name, `${label} 的 name`);
		const name = input.name.trim();
		if (name.length === 0) {
			throw new Error(`${label} 的 name 不能是空字符串`);
		}
		if (typeof input.content !== "string") {
			throw new Error(`${label} 的 content 必须是字符串`);
		}
		const content = input.content.trim();
		if (content.length === 0) {
			throw new Error(`${label} 的 content 不能是空字符串`);
		}
		const constant = input.constant ?? false;
		if (typeof constant !== "boolean") {
			throw new Error(`${label} 的 constant 必须是布尔值`);
		}
		const keywords = input.keywords ?? [];
		if (!Array.isArray(keywords)) {
			throw new Error(`${label} 的 keywords 必须是字符串数组`);
		}
		const normalizedKeywords: string[] = [];
		for (const keyword of keywords) {
			if (typeof keyword !== "string") {
				throw new Error(`${label} 的 keywords 必须是字符串数组`);
			}
			const trimmed = keyword.trim();
			if (trimmed.length === 0) {
				throw new Error(`${label} 的 keywords 不能包含空字符串`);
			}
			normalizedKeywords.push(trimmed);
		}
		const entityId = input.entityId ?? null;
		if (entityId !== null) {
			assertNonEmptyString(entityId, `${label} 的 entityId`);
			const entity = this.store.getEntity(entityId);
			if (!entity) {
				throw new Error(`${label} 指向的实体不存在：${entityId}`);
			}
			if (entity.storyId !== input.storyId) {
				throw new Error(
					`${label} 的 storyId 与实体所属故事不一致：${input.storyId}`,
				);
			}
		}
		assertNonEmptyString(input.source, `${label} 的 source`);
		const id = input.id ?? randomUUID();
		assertNonEmptyString(id, `${label} 的 id`);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, `${label} 的 createdAt`);
		return {
			id,
			storyId: input.storyId,
			entityId,
			name,
			content,
			constant,
			keywords: normalizedKeywords,
			source: input.source,
			createdAt,
		};
	}
}

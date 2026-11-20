// StoryStore 的领域仓储：大纲（故事蓝图）与 AI 建议（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import {
	type BlueprintEntry,
	type BlueprintRollbackInput,
	type BlueprintVersion,
	type NewStoryBlueprintRecordInput,
	type StoryBlueprintRecord,
	applyBlueprintDiffs,
	assertBlueprintDiffs,
	assertBlueprintEntries,
	assertBlueprintSource,
	assertBlueprintWriteAllowed,
	planBlueprintRollback,
} from "../../blueprint/story-blueprint.js";
import {
	type AcceptBlueprintSuggestionInput,
	type BlueprintSuggestion,
	type BlueprintSuggestionAcceptance,
	type BlueprintSuggestionRequest,
	type BlueprintSuggestionRequestStatus,
	type BlueprintSuggestionStatus,
	MAX_BLUEPRINT_SUGGESTIONS,
	type NewBlueprintSuggestionInput,
	type NewBlueprintSuggestionRequestInput,
	type RejectBlueprintSuggestionInput,
	assertBlueprintSuggestionOperation,
	assertBlueprintSuggestionRequestStatus,
	assertBlueprintSuggestionStatus,
	assertStoredBlueprintSuggestion,
	filterLockedBlueprintDiffs,
	readBlueprintSuggestionNote,
} from "../../blueprint/suggestions.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface StoryBlueprintRow {
	readonly node_id: string;
	readonly seq: number;
	readonly story_id: string;
	readonly source: string;
	readonly diffs: string;
	readonly created_at: string;
}

interface StoryBlueprintSeqRow {
	readonly seq: number;
}

interface StoryBlueprintBaselineRow {
	readonly story_id: string;
	readonly entries: string;
	readonly created_at: string;
}

interface BlueprintSuggestionRequestRow {
	readonly id: number;
	readonly story_id: string;
	readonly operation: string;
	readonly note: string;
	readonly status: string;
	readonly created_at: string;
	readonly finished_at: string | null;
}

interface BlueprintSuggestionRow {
	readonly id: number;
	readonly request_id: number;
	readonly story_id: string;
	readonly title: string;
	readonly reason: string;
	readonly diffs: string;
	readonly status: string;
	readonly created_at: string;
	readonly decided_at: string | null;
}

export interface ListBlueprintSuggestionRequestsOptions {
	readonly storyId: string;
	readonly status?: BlueprintSuggestionRequestStatus;
}

export interface ListBlueprintSuggestionsOptions {
	readonly storyId: string;
	readonly requestId?: number;
	readonly status?: BlueprintSuggestionStatus;
}

export interface SaveBlueprintSuggestionsInput {
	readonly requestId: number;
	readonly suggestions: readonly NewBlueprintSuggestionInput[];
	readonly createdAt?: string;
}

function rowToStoryBlueprint(row: StoryBlueprintRow): StoryBlueprintRecord {
	return {
		nodeId: row.node_id,
		seq: row.seq,
		storyId: row.story_id,
		source: assertBlueprintSource(row.source, `楼层 ${row.node_id} 的蓝图来源`),
		diffs: assertBlueprintDiffs(
			JSON.parse(row.diffs) as unknown,
			`楼层 ${row.node_id} 的蓝图修改`,
		),
		createdAt: row.created_at,
	};
}

function assertSuggestionId(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} 必须是正整数`);
	}
}

function rowToBlueprintSuggestionRequest(
	row: BlueprintSuggestionRequestRow,
): BlueprintSuggestionRequest {
	return {
		id: row.id,
		storyId: row.story_id,
		operation: assertBlueprintSuggestionOperation(
			row.operation,
			`蓝图建议请求 ${row.id} 的操作`,
		),
		note: readBlueprintSuggestionNote(
			row.note,
			`蓝图建议请求 ${row.id} 的补充说明`,
		),
		status: assertBlueprintSuggestionRequestStatus(
			row.status,
			`蓝图建议请求 ${row.id} 的状态`,
		),
		createdAt: row.created_at,
		finishedAt: row.finished_at,
	};
}

function rowToBlueprintSuggestion(
	row: BlueprintSuggestionRow,
): BlueprintSuggestion {
	return {
		id: row.id,
		requestId: row.request_id,
		storyId: row.story_id,
		title: row.title,
		reason: row.reason,
		diffs: assertBlueprintDiffs(
			JSON.parse(row.diffs) as unknown,
			`蓝图建议 ${row.id} 的修改`,
		),
		status: assertBlueprintSuggestionStatus(
			row.status,
			`蓝图建议 ${row.id} 的状态`,
		),
		createdAt: row.created_at,
		decidedAt: row.decided_at,
	};
}

export class OutlineRepo extends StoreRepo {
	/**
	 * 追加一个楼层的蓝图修改；同一楼层可以有多批，`seq` 从 1 起递增。
	 * AI 来源的修改不能改动锁定的条目，校验在写入之前完成。
	 */
	saveStoryBlueprint(
		input: NewStoryBlueprintRecordInput,
	): StoryBlueprintRecord {
		assertNonEmptyString(input.nodeId, "蓝图修改的楼层 id");
		assertNonEmptyString(input.storyId, "蓝图修改的故事 id");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`蓝图修改的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const source = assertBlueprintSource(input.source, "蓝图修改的来源");
		const diffs = assertBlueprintDiffs(input.diffs, "蓝图修改的 diffs");
		if (diffs.length === 0) {
			throw new Error("蓝图修改的 diffs 至少要有一条");
		}
		const current = this.readBlueprintEntries(input.nodeId);
		assertBlueprintWriteAllowed(current, diffs, source, "蓝图修改");
		applyBlueprintDiffs(current, diffs);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "蓝图修改的创建时间");
		const next = this.db
			.prepare(
				"SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM story_blueprints WHERE node_id = ?",
			)
			.get(input.nodeId) as StoryBlueprintSeqRow;
		const seq = next.seq;
		this.db
			.prepare(
				`INSERT INTO story_blueprints (node_id, seq, story_id, source, diffs, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.nodeId,
				seq,
				input.storyId,
				source,
				JSON.stringify(diffs),
				createdAt,
			);
		return {
			nodeId: input.nodeId,
			seq,
			storyId: input.storyId,
			source,
			diffs,
			createdAt,
		};
	}

	/** 读取一个楼层的最后一批蓝图修改；没有记录时返回 null。 */
	getStoryBlueprintRecord(nodeId: string): StoryBlueprintRecord | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare(
				"SELECT * FROM story_blueprints WHERE node_id = ? ORDER BY seq DESC LIMIT 1",
			)
			.get(nodeId) as StoryBlueprintRow | undefined;
		return row === undefined ? null : rowToStoryBlueprint(row);
	}

	/** 一个楼层上的全部蓝图修改批次，按 `seq` 从旧到新。 */
	listStoryBlueprintRecords(nodeId: string): StoryBlueprintRecord[] {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare("SELECT * FROM story_blueprints WHERE node_id = ? ORDER BY seq")
			.all(nodeId) as StoryBlueprintRow[];
		return rows.map(rowToStoryBlueprint);
	}

	/**
	 * 替换卡随世界包带进来的默认蓝图。默认蓝图是故事级、与楼层无关的起点；
	 * 条目为空时删掉这一行。节点上的修改继续按路径累加在它之上。
	 */
	saveStoryBlueprintBaseline(
		storyId: string,
		entries: readonly BlueprintEntry[],
		createdAt?: string,
	): BlueprintEntry[] {
		assertNonEmptyString(storyId, "默认蓝图的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const validated = assertBlueprintEntries(entries, "默认蓝图").sort(
			(left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
		);
		if (validated.length === 0) {
			this.db
				.prepare("DELETE FROM story_blueprint_baselines WHERE story_id = ?")
				.run(storyId);
			return [];
		}
		const writtenAt = createdAt ?? new Date().toISOString();
		assertNonEmptyString(writtenAt, "默认蓝图的创建时间");
		this.db
			.prepare(
				`INSERT INTO story_blueprint_baselines (story_id, entries, created_at)
				VALUES (?, ?, ?)
				ON CONFLICT(story_id) DO UPDATE SET
					entries = excluded.entries,
					created_at = excluded.created_at`,
			)
			.run(storyId, JSON.stringify(validated), writtenAt);
		return validated;
	}

	/** 卡导入的默认蓝图；没有时是空蓝图。 */
	readStoryBlueprintBaseline(storyId: string): BlueprintEntry[] {
		assertNonEmptyString(storyId, "默认蓝图的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM story_blueprint_baselines WHERE story_id = ?")
			.get(storyId) as StoryBlueprintBaselineRow | undefined;
		if (row === undefined) return [];
		return assertBlueprintEntries(
			JSON.parse(row.entries) as unknown,
			`故事 ${storyId} 的默认蓝图`,
		);
	}

	/**
	 * 沿节点所在的路径按从旧到新的顺序列出每一版蓝图：每个楼层上的每一批
	 * 修改算一版，`entries` 是该批写完之后沿路径累加的结果。其他分支不参与。
	 */
	listBlueprintVersions(nodeId: string): BlueprintVersion[] {
		const node = this.store.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const rows = this.db
			.prepare(
				`WITH RECURSIVE chain(node_id, depth) AS (
					SELECT id, 0 FROM nodes WHERE id = ?
					UNION ALL
					SELECT nodes.parent_id, chain.depth + 1
					FROM nodes JOIN chain ON nodes.id = chain.node_id
					WHERE nodes.parent_id IS NOT NULL
				)
				SELECT story_blueprints.*
				FROM story_blueprints JOIN chain ON story_blueprints.node_id = chain.node_id
				ORDER BY chain.depth DESC, story_blueprints.seq ASC`,
			)
			.all(nodeId) as StoryBlueprintRow[];
		const versions: BlueprintVersion[] = [];
		let entries: readonly BlueprintEntry[] = this.readStoryBlueprintBaseline(
			node.storyId,
		);
		for (const row of rows) {
			const record = rowToStoryBlueprint(row);
			entries = applyBlueprintDiffs(entries, record.diffs);
			versions.push({
				nodeId: record.nodeId,
				seq: record.seq,
				source: record.source,
				diffs: record.diffs,
				createdAt: record.createdAt,
				entries,
			});
		}
		return versions;
	}

	/** 沿节点所在的路径累加蓝图修改；没有记录时是卡导入的默认蓝图。 */
	readBlueprintEntries(nodeId: string): BlueprintEntry[] {
		const versions = this.listBlueprintVersions(nodeId);
		const latest = versions[versions.length - 1];
		if (latest !== undefined) return [...latest.entries];
		const node = this.store.getNode(nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		return this.readStoryBlueprintBaseline(node.storyId);
	}

	/**
	 * 把某一版蓝图照原样写成目标楼层的新记录；回滚本身也是一次修改，
	 * 来源记为玩家，原版本楼层不动。指定 `versionSeq` 时回到该楼层的
	 * 某一批，省略时取最后一批。
	 */
	rollbackStoryBlueprint(input: BlueprintRollbackInput): StoryBlueprintRecord {
		assertNonEmptyString(input.nodeId, "蓝图回滚的楼层 id");
		assertNonEmptyString(input.storyId, "蓝图回滚的故事 id");
		assertNonEmptyString(input.versionNodeId, "蓝图回滚的版本楼层 id");
		if (
			input.versionSeq !== undefined &&
			(!Number.isInteger(input.versionSeq) || input.versionSeq < 1)
		) {
			throw new Error("蓝图回滚的批次序号必须是正整数");
		}
		const versionNode = this.store.getNode(input.versionNodeId);
		if (versionNode === null) {
			throw new Error(`楼层节点不存在：${input.versionNodeId}`);
		}
		if (versionNode.storyId !== input.storyId) {
			throw new Error(
				`蓝图回滚的版本楼层不属于故事 ${input.storyId}：${input.versionNodeId}`,
			);
		}
		const versions = this.listBlueprintVersions(input.versionNodeId).filter(
			(version) => version.nodeId === input.versionNodeId,
		);
		const target =
			input.versionSeq === undefined
				? versions[versions.length - 1]
				: versions.find((version) => version.seq === input.versionSeq);
		if (target === undefined) {
			throw new Error(
				input.versionSeq === undefined
					? `楼层 ${input.versionNodeId} 没有蓝图修改记录`
					: `楼层 ${input.versionNodeId} 没有第 ${input.versionSeq} 批蓝图修改记录`,
			);
		}
		const diffs = planBlueprintRollback(
			this.readBlueprintEntries(input.nodeId),
			target.entries,
		);
		if (diffs.length === 0) {
			throw new Error("当前蓝图已经是这一版，没有可回滚的修改");
		}
		return this.saveStoryBlueprint({
			nodeId: input.nodeId,
			storyId: input.storyId,
			source: "player",
			diffs,
			createdAt: input.createdAt,
		});
	}

	/**
	 * 登记一次蓝图建议请求；生成在后台间隙里进行。请求本身不写蓝图。
	 */
	createBlueprintSuggestionRequest(
		input: NewBlueprintSuggestionRequestInput,
	): BlueprintSuggestionRequest {
		assertNonEmptyString(input.storyId, "蓝图建议请求的故事 id");
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const operation = assertBlueprintSuggestionOperation(input.operation);
		const note = readBlueprintSuggestionNote(input.note ?? "");
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "蓝图建议请求的创建时间");
		const result = this.db
			.prepare(
				`INSERT INTO blueprint_suggestion_requests
					(story_id, operation, note, status, created_at, finished_at)
				VALUES (?, ?, ?, 'pending', ?, NULL)`,
			)
			.run(input.storyId, operation, note, createdAt);
		const request = this.getBlueprintSuggestionRequest(
			Number(result.lastInsertRowid),
		);
		if (request === null) {
			throw new Error("蓝图建议请求写入后读取失败");
		}
		return request;
	}

	getBlueprintSuggestionRequest(id: number): BlueprintSuggestionRequest | null {
		assertSuggestionId(id, "蓝图建议请求 id");
		const row = this.db
			.prepare("SELECT * FROM blueprint_suggestion_requests WHERE id = ?")
			.get(id) as BlueprintSuggestionRequestRow | undefined;
		return row === undefined ? null : rowToBlueprintSuggestionRequest(row);
	}

	listBlueprintSuggestionRequests(
		options: ListBlueprintSuggestionRequestsOptions,
	): BlueprintSuggestionRequest[] {
		assertNonEmptyString(options.storyId, "蓝图建议请求的故事 id");
		const where = ["story_id = ?"];
		const params: unknown[] = [options.storyId];
		if (options.status !== undefined) {
			assertBlueprintSuggestionRequestStatus(
				options.status,
				"蓝图建议请求的筛选状态",
			);
			where.push("status = ?");
			params.push(options.status);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM blueprint_suggestion_requests
				WHERE ${where.join(" AND ")}
				ORDER BY created_at, id`,
			)
			.all(...params) as BlueprintSuggestionRequestRow[];
		return rows.map(rowToBlueprintSuggestionRequest);
	}

	/** 最早一条等待生成的请求；后台任务一次只处理它。 */
	findPendingBlueprintSuggestionRequest(
		storyId: string,
	): BlueprintSuggestionRequest | null {
		assertNonEmptyString(storyId, "蓝图建议请求的故事 id");
		const row = this.db
			.prepare(
				`SELECT * FROM blueprint_suggestion_requests
				WHERE story_id = ? AND status = 'pending'
				ORDER BY created_at, id
				LIMIT 1`,
			)
			.get(storyId) as BlueprintSuggestionRequestRow | undefined;
		return row === undefined ? null : rowToBlueprintSuggestionRequest(row);
	}

	/** 一次请求的全部建议与请求状态在同一事务里写入。 */
	saveBlueprintSuggestions(
		input: SaveBlueprintSuggestionsInput,
	): BlueprintSuggestion[] {
		assertSuggestionId(input.requestId, "蓝图建议请求 id");
		const request = this.getBlueprintSuggestionRequest(input.requestId);
		if (request === null) {
			throw new Error(`蓝图建议请求不存在：${input.requestId}`);
		}
		if (request.status !== "pending") {
			throw new Error("这次蓝图建议请求已经生成过建议");
		}
		if (
			input.suggestions.length === 0 ||
			input.suggestions.length > MAX_BLUEPRINT_SUGGESTIONS
		) {
			throw new Error(
				`一次请求必须生成 1 到 ${MAX_BLUEPRINT_SUGGESTIONS} 条建议`,
			);
		}
		const suggestions = input.suggestions.map((suggestion, index) =>
			assertStoredBlueprintSuggestion(suggestion, `蓝图建议[${index}]`),
		);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "蓝图建议的创建时间");
		const insert = this.db.prepare(
			`INSERT INTO blueprint_suggestions
				(request_id, story_id, title, reason, diffs, status, created_at, decided_at)
			VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`,
		);
		this.db.transaction(() => {
			for (const suggestion of suggestions) {
				insert.run(
					request.id,
					request.storyId,
					suggestion.title,
					suggestion.reason,
					JSON.stringify(suggestion.diffs),
					createdAt,
				);
			}
			const finished = this.db
				.prepare(
					`UPDATE blueprint_suggestion_requests
					SET status = 'done', finished_at = ?
					WHERE id = ? AND status = 'pending'`,
				)
				.run(createdAt, request.id);
			if (finished.changes !== 1) {
				throw new Error(`蓝图建议请求 ${request.id} 的状态更新失败`);
			}
		})();
		return this.listBlueprintSuggestions({
			storyId: request.storyId,
			requestId: request.id,
		});
	}

	listBlueprintSuggestions(
		options: ListBlueprintSuggestionsOptions,
	): BlueprintSuggestion[] {
		assertNonEmptyString(options.storyId, "蓝图建议的故事 id");
		const where = ["story_id = ?"];
		const params: unknown[] = [options.storyId];
		if (options.requestId !== undefined) {
			assertSuggestionId(options.requestId, "蓝图建议请求 id");
			where.push("request_id = ?");
			params.push(options.requestId);
		}
		if (options.status !== undefined) {
			assertBlueprintSuggestionStatus(options.status, "蓝图建议的筛选状态");
			where.push("status = ?");
			params.push(options.status);
		}
		const rows = this.db
			.prepare(
				`SELECT * FROM blueprint_suggestions
				WHERE ${where.join(" AND ")}
				ORDER BY created_at, id`,
			)
			.all(...params) as BlueprintSuggestionRow[];
		return rows.map(rowToBlueprintSuggestion);
	}

	getBlueprintSuggestion(id: number): BlueprintSuggestion | null {
		assertSuggestionId(id, "蓝图建议 id");
		const row = this.db
			.prepare("SELECT * FROM blueprint_suggestions WHERE id = ?")
			.get(id) as BlueprintSuggestionRow | undefined;
		return row === undefined ? null : rowToBlueprintSuggestion(row);
	}

	/**
	 * 接受一条建议：按当前蓝图重新校验，跳过后来被锁定的条目，
	 * 用玩家来源写成一批蓝图修改，条目出处保持 AI。写入与状态更新
	 * 在同一事务里，任一步失败都不留下半条记录。
	 */
	acceptBlueprintSuggestion(
		input: AcceptBlueprintSuggestionInput,
	): BlueprintSuggestionAcceptance {
		assertSuggestionId(input.id, "蓝图建议 id");
		assertNonEmptyString(input.nodeId, "接受蓝图建议的楼层 id");
		const suggestion = this.getBlueprintSuggestion(input.id);
		if (suggestion === null) {
			throw new Error(`蓝图建议不存在：${input.id}`);
		}
		if (suggestion.status !== "pending") {
			throw new Error(`蓝图建议 ${input.id} 已经决定过，不能再接受`);
		}
		const node = this.store.getNode(input.nodeId);
		if (node === null) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== suggestion.storyId) {
			throw new Error(
				`楼层节点 ${input.nodeId} 不属于故事 ${suggestion.storyId}`,
			);
		}
		const current = this.readBlueprintEntries(input.nodeId);
		const diffs = filterLockedBlueprintDiffs(current, suggestion.diffs);
		if (diffs.length === 0) {
			throw new Error("这条建议的修改都命中了锁定条目");
		}
		applyBlueprintDiffs(current, diffs);
		const decidedAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(decidedAt, "蓝图建议的决定时间");
		return this.db.transaction((): BlueprintSuggestionAcceptance => {
			const record = this.saveStoryBlueprint({
				nodeId: input.nodeId,
				storyId: suggestion.storyId,
				source: "player",
				diffs,
				createdAt: decidedAt,
			});
			const updated = this.db
				.prepare(
					`UPDATE blueprint_suggestions
					SET status = 'accepted', decided_at = ?
					WHERE id = ? AND status = 'pending'`,
				)
				.run(decidedAt, suggestion.id);
			if (updated.changes !== 1) {
				throw new Error(`蓝图建议 ${suggestion.id} 的状态更新失败`);
			}
			const accepted = this.getBlueprintSuggestion(suggestion.id);
			if (accepted === null) {
				throw new Error(`蓝图建议 ${suggestion.id} 更新后读取失败`);
			}
			return { suggestion: accepted, record };
		})();
	}

	/** 拒绝只改建议状态，不写蓝图。 */
	rejectBlueprintSuggestion(
		input: RejectBlueprintSuggestionInput,
	): BlueprintSuggestion {
		assertSuggestionId(input.id, "蓝图建议 id");
		const suggestion = this.getBlueprintSuggestion(input.id);
		if (suggestion === null) {
			throw new Error(`蓝图建议不存在：${input.id}`);
		}
		if (suggestion.status !== "pending") {
			throw new Error(`蓝图建议 ${input.id} 已经决定过，不能再拒绝`);
		}
		const decidedAt = input.decidedAt ?? new Date().toISOString();
		assertNonEmptyString(decidedAt, "蓝图建议的决定时间");
		const updated = this.db
			.prepare(
				`UPDATE blueprint_suggestions
				SET status = 'rejected', decided_at = ?
				WHERE id = ? AND status = 'pending'`,
			)
			.run(decidedAt, suggestion.id);
		if (updated.changes !== 1) {
			throw new Error(`蓝图建议 ${suggestion.id} 的状态更新失败`);
		}
		const rejected = this.getBlueprintSuggestion(suggestion.id);
		if (rejected === null) {
			throw new Error(`蓝图建议 ${suggestion.id} 更新后读取失败`);
		}
		return rejected;
	}
}

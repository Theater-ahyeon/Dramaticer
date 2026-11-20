// StoryStore 的领域仓储：上下文包、回合 Trace 与运行（refactor/05）。
// 公开方法由 StoryStore 原样委托过来，签名不变；跨领域调用经 this.store。
import { randomUUID } from "node:crypto";
import { type TurnMode, isTurnMode } from "../../chat/mode.js";
import {
	type ContextPack,
	type NewContextPackInput,
	parseContextPackPayload,
	serializeContextPackPayload,
} from "../../context/pack-format.js";
import { isJsonObject } from "../../json.js";
import {
	type TurnRunEvent,
	type TurnRunEventInput,
	type TurnRunFinalStatus,
	type TurnRunRecord,
	assertTurnRunEventKind,
	isTurnRunFinalStatus,
	isTurnRunStatus,
} from "../../run-log.js";
import type { TurnTrace } from "../../trace.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface TraceRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly trace: string;
}

interface TurnRunRow {
	readonly run_id: string;
	readonly story_id: string;
	readonly user_node_id: string;
	readonly node_id: string | null;
	readonly mode: string;
	readonly status: string;
	readonly started_at: string;
	readonly finished_at: string | null;
}

interface TurnRunEventRow {
	readonly run_id: string;
	readonly seq: number;
	readonly kind: string;
	readonly payload: string;
	readonly created_at: string;
}

interface ContextPackRow {
	readonly node_id: string;
	readonly story_id: string;
	readonly payload: string;
	readonly created_at: string;
}

function toTurnRunRecord(row: TurnRunRow): TurnRunRecord {
	if (!isTurnMode(row.mode)) {
		throw new Error(`运行 ${row.run_id} 的回合模式不合法：${row.mode}`);
	}
	if (!isTurnRunStatus(row.status)) {
		throw new Error(`运行 ${row.run_id} 的状态不合法：${row.status}`);
	}
	return {
		runId: row.run_id,
		storyId: row.story_id,
		userNodeId: row.user_node_id,
		nodeId: row.node_id,
		mode: row.mode,
		status: row.status,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

function toTurnRunEvent(row: TurnRunEventRow): TurnRunEvent {
	assertTurnRunEventKind(
		row.kind,
		`运行 ${row.run_id} 的事件 ${row.seq} 的种类`,
	);
	const payload: unknown = JSON.parse(row.payload);
	if (!isJsonObject(payload)) {
		throw new Error(
			`运行 ${row.run_id} 的事件 ${row.seq} 的载荷不是 JSON 对象`,
		);
	}
	return {
		runId: row.run_id,
		seq: row.seq,
		kind: row.kind,
		payload,
		createdAt: row.created_at,
	};
}

function rowToContextPack(row: ContextPackRow): ContextPack {
	return {
		nodeId: row.node_id,
		storyId: row.story_id,
		payload: parseContextPackPayload(row.payload),
		createdAt: row.created_at,
	};
}

export class TurnsRepo extends StoreRepo {
	/**
	 * 写入玩家楼层的上下文包；同一楼层覆盖同一行。payload 必须是当前版本且
	 * 结构合法，所属故事必须与楼层一致。
	 */
	saveContextPack(input: NewContextPackInput): ContextPack {
		assertNonEmptyString(input.nodeId, "上下文包的楼层 id");
		assertNonEmptyString(input.storyId, "上下文包的 storyId");
		const node = this.store.getNode(input.nodeId);
		if (!node) {
			throw new Error(`楼层节点不存在：${input.nodeId}`);
		}
		if (node.storyId !== input.storyId) {
			throw new Error(
				`上下文包的 storyId 与楼层所属故事不一致：${input.storyId}`,
			);
		}
		const payload = serializeContextPackPayload(input.payload);
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "上下文包的 createdAt");
		this.db
			.prepare(
				`INSERT INTO context_packs (node_id, story_id, payload, created_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(node_id) DO UPDATE SET
					payload = excluded.payload,
					created_at = excluded.created_at`,
			)
			.run(input.nodeId, input.storyId, payload, createdAt);
		return {
			nodeId: input.nodeId,
			storyId: input.storyId,
			payload: input.payload,
			createdAt,
		};
	}

	/** 读取玩家楼层的上下文包；没有记录时返回 null。 */
	getContextPack(nodeId: string): ContextPack | null {
		assertNonEmptyString(nodeId, "上下文包的楼层 id");
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT * FROM context_packs WHERE node_id = ?")
			.get(nodeId) as ContextPackRow | undefined;
		return row === undefined ? null : rowToContextPack(row);
	}

	/**
	 * 删除故事里缓存的上下文包。导入模式或世界书注入集合变化后，旧包里的
	 * 世界书段已经过时，重生成时必须重新组装。
	 */
	clearContextPacks(storyId: string): number {
		assertNonEmptyString(storyId, "上下文包的故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const result = this.db
			.prepare("DELETE FROM context_packs WHERE story_id = ?")
			.run(storyId);
		return result.changes;
	}

	/** 保存一轮生成的 Trace；一个楼层只能写一次。 */
	saveTurnTrace(trace: TurnTrace): void {
		assertNonEmptyString(trace.nodeId, "Trace 的 nodeId");
		assertNonEmptyString(trace.storyId, "Trace 的 storyId");
		assertNonEmptyString(trace.createdAt, "Trace 的 createdAt");
		const node = this.store.getNode(trace.nodeId);
		if (!node) {
			throw new Error(`Trace 指向的楼层节点不存在：${trace.nodeId}`);
		}
		if (node.storyId !== trace.storyId) {
			throw new Error(
				`Trace 的 storyId 与楼层节点所属故事不一致：${trace.storyId}`,
			);
		}
		if (node.parentId !== trace.parentNodeId) {
			throw new Error(
				`Trace 的 parentNodeId 与楼层节点的父节点不一致：${trace.nodeId}`,
			);
		}
		const existing = this.db
			.prepare("SELECT node_id FROM traces WHERE node_id = ?")
			.get(trace.nodeId) as { node_id: string } | undefined;
		if (existing) {
			throw new Error(`楼层 ${trace.nodeId} 已经写过 Trace`);
		}
		this.db
			.prepare(
				`INSERT INTO traces (node_id, story_id, trace, created_at)
				VALUES (?, ?, ?, ?)`,
			)
			.run(trace.nodeId, trace.storyId, JSON.stringify(trace), trace.createdAt);
	}

	getTurnTrace(nodeId: string): TurnTrace | null {
		if (!this.store.getNode(nodeId)) {
			throw new Error(`楼层节点不存在：${nodeId}`);
		}
		const row = this.db
			.prepare("SELECT node_id, story_id, trace FROM traces WHERE node_id = ?")
			.get(nodeId) as TraceRow | undefined;
		if (row === undefined) return null;
		const parsed: unknown = JSON.parse(row.trace);
		if (
			!isJsonObject(parsed) ||
			parsed.nodeId !== row.node_id ||
			parsed.storyId !== row.story_id
		) {
			throw new Error(`楼层 ${nodeId} 的 Trace 记录与楼层不一致`);
		}
		const trace = parsed as unknown as TurnTrace;
		// v40 之前的 Trace 没有 run 段，读回时补成 null；规划写法早期没有 schedule。
		return {
			...trace,
			run: trace.run ?? null,
			...(trace.plan === undefined
				? {}
				: { plan: { ...trace.plan, schedule: trace.plan.schedule ?? [] } }),
		};
	}

	/** 为一次深回合运行建行；用户楼层必须存在且属于该故事。 */
	startTurnRun(input: {
		readonly runId?: string;
		readonly storyId: string;
		readonly userNodeId: string;
		readonly mode: TurnMode;
		readonly startedAt?: string;
	}): TurnRunRecord {
		assertNonEmptyString(input.storyId, "故事 id");
		assertNonEmptyString(input.userNodeId, "用户楼层 id");
		if (!isTurnMode(input.mode)) {
			throw new Error(`回合模式不合法：${String(input.mode)}`);
		}
		if (!this.store.getStory(input.storyId)) {
			throw new Error(`故事不存在：${input.storyId}`);
		}
		const userNode = this.store.getNode(input.userNodeId);
		if (!userNode) {
			throw new Error(`用户楼层不存在：${input.userNodeId}`);
		}
		if (userNode.storyId !== input.storyId) {
			throw new Error(
				`用户楼层 ${userNode.id} 属于另一个故事 ${userNode.storyId}`,
			);
		}
		if (userNode.role !== "user") {
			throw new Error(
				`运行必须以用户楼层为输入：${userNode.id} 的角色是 ${userNode.role}`,
			);
		}
		const runId = input.runId ?? randomUUID();
		assertNonEmptyString(runId, "运行 id");
		const startedAt = input.startedAt ?? new Date().toISOString();
		assertNonEmptyString(startedAt, "运行开始时间");
		if (this.getTurnRun(runId) !== null) {
			throw new Error(`运行已存在：${runId}`);
		}
		this.db
			.prepare(
				`INSERT INTO turn_runs
				(run_id, story_id, user_node_id, node_id, mode, status, started_at)
				VALUES (?, ?, ?, NULL, ?, 'running', ?)`,
			)
			.run(runId, input.storyId, input.userNodeId, input.mode, startedAt);
		const run = this.getTurnRun(runId);
		if (run === null) {
			throw new Error(`运行写入后读取失败：${runId}`);
		}
		return run;
	}

	getTurnRun(runId: string): TurnRunRecord | null {
		assertNonEmptyString(runId, "运行 id");
		const row = this.db
			.prepare(
				`SELECT run_id, story_id, user_node_id, node_id, mode, status,
					started_at, finished_at
				FROM turn_runs WHERE run_id = ?`,
			)
			.get(runId) as TurnRunRow | undefined;
		return row === undefined ? null : toTurnRunRecord(row);
	}

	/** 按助手楼层找运行；快回合与非生成楼层返回 null。 */
	getTurnRunForNode(nodeId: string): TurnRunRecord | null {
		assertNonEmptyString(nodeId, "楼层 id");
		const row = this.db
			.prepare(
				`SELECT run_id, story_id, user_node_id, node_id, mode, status,
					started_at, finished_at
				FROM turn_runs WHERE node_id = ?`,
			)
			.get(nodeId) as TurnRunRow | undefined;
		return row === undefined ? null : toTurnRunRecord(row);
	}

	/** 一个故事的运行记录，最新的在前。 */
	listTurnRuns(storyId: string): TurnRunRecord[] {
		assertNonEmptyString(storyId, "故事 id");
		if (!this.store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT run_id, story_id, user_node_id, node_id, mode, status,
					started_at, finished_at
				FROM turn_runs WHERE story_id = ?
				ORDER BY started_at DESC, run_id DESC`,
			)
			.all(storyId) as TurnRunRow[];
		return rows.map(toTurnRunRecord);
	}

	/** 追加一条事件；序号由存储层按运行内最大值加一。 */
	appendTurnRunEvent(input: {
		readonly runId: string;
		readonly kind: TurnRunEventInput["kind"];
		readonly payload: TurnRunEventInput["payload"];
		readonly createdAt?: string;
	}): TurnRunEvent {
		assertNonEmptyString(input.runId, "运行 id");
		assertTurnRunEventKind(input.kind, "运行事件种类");
		if (!isJsonObject(input.payload)) {
			throw new Error("运行事件载荷必须是 JSON 对象");
		}
		const createdAt = input.createdAt ?? new Date().toISOString();
		assertNonEmptyString(createdAt, "运行事件时间");
		const run = this.getTurnRun(input.runId);
		if (run === null) {
			throw new Error(`运行不存在：${input.runId}`);
		}
		if (run.status !== "running") {
			throw new Error(
				`运行 ${input.runId} 的状态是 ${run.status}，不能再追加事件`,
			);
		}
		this.db
			.prepare(
				`INSERT INTO turn_run_events (run_id, seq, kind, payload, created_at)
				SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?
				FROM turn_run_events WHERE run_id = ?`,
			)
			.run(
				input.runId,
				input.kind,
				JSON.stringify(input.payload),
				createdAt,
				input.runId,
			);
		const row = this.db
			.prepare(
				`SELECT run_id, seq, kind, payload, created_at
				FROM turn_run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 1`,
			)
			.get(input.runId) as TurnRunEventRow | undefined;
		if (row === undefined) {
			throw new Error(`运行事件写入后读取失败：${input.runId}`);
		}
		return toTurnRunEvent(row);
	}

	listTurnRunEvents(runId: string): TurnRunEvent[] {
		assertNonEmptyString(runId, "运行 id");
		if (this.getTurnRun(runId) === null) {
			throw new Error(`运行不存在：${runId}`);
		}
		const rows = this.db
			.prepare(
				`SELECT run_id, seq, kind, payload, created_at
				FROM turn_run_events WHERE run_id = ? ORDER BY seq ASC`,
			)
			.all(runId) as TurnRunEventRow[];
		return rows.map(toTurnRunEvent);
	}

	countTurnRunEvents(runId: string): number {
		assertNonEmptyString(runId, "运行 id");
		const row = this.db
			.prepare("SELECT COUNT(*) AS count FROM turn_run_events WHERE run_id = ?")
			.get(runId) as { readonly count: number };
		return row.count;
	}

	/** 结束一次运行；助手楼层只在提交后写进来。 */
	finishTurnRun(input: {
		readonly runId: string;
		readonly status: TurnRunFinalStatus;
		readonly nodeId?: string | null;
		readonly finishedAt?: string;
	}): TurnRunRecord {
		assertNonEmptyString(input.runId, "运行 id");
		if (!isTurnRunFinalStatus(input.status)) {
			throw new Error(`运行结束状态不合法：${String(input.status)}`);
		}
		const run = this.getTurnRun(input.runId);
		if (run === null) {
			throw new Error(`运行不存在：${input.runId}`);
		}
		if (run.status !== "running") {
			throw new Error(
				`运行 ${input.runId} 的状态是 ${run.status}，不能重复结束`,
			);
		}
		const nodeId = input.nodeId ?? null;
		if (nodeId !== null) {
			assertNonEmptyString(nodeId, "助手楼层 id");
			const node = this.store.getNode(nodeId);
			if (!node) {
				throw new Error(`助手楼层不存在：${nodeId}`);
			}
			if (node.storyId !== run.storyId) {
				throw new Error(`助手楼层 ${nodeId} 属于另一个故事 ${node.storyId}`);
			}
			if (node.role !== "assistant") {
				throw new Error(
					`运行只能提交助手楼层：${nodeId} 的角色是 ${node.role}`,
				);
			}
		}
		const finishedAt = input.finishedAt ?? new Date().toISOString();
		assertNonEmptyString(finishedAt, "运行结束时间");
		const info = this.db
			.prepare(
				`UPDATE turn_runs SET status = ?, node_id = COALESCE(?, node_id),
					finished_at = ?
				WHERE run_id = ? AND status = 'running'`,
			)
			.run(input.status, nodeId, finishedAt, input.runId);
		if (info.changes !== 1) {
			throw new Error(`运行 ${input.runId} 已经结束`);
		}
		const finished = this.getTurnRun(input.runId);
		if (finished === null) {
			throw new Error(`运行结束后读取失败：${input.runId}`);
		}
		return finished;
	}

	/** 启动时把上一个进程留下的 running 行标为 interrupted；事件原样保留。 */
	markInterruptedTurnRuns(finishedAt?: string): number {
		const value = finishedAt ?? new Date().toISOString();
		assertNonEmptyString(value, "运行结束时间");
		const info = this.db
			.prepare(
				`UPDATE turn_runs SET status = 'interrupted', finished_at = ?
				WHERE status = 'running'`,
			)
			.run(value);
		return info.changes;
	}
}

// StoryStore 的领域仓储：沙箱拒绝记录（v5 §7）。
// 允许名单与检测结果存在故事的 kv 上；这里只负责追加与读取拒绝事件。
import {
	type SandboxRejection,
	type SandboxRejectionKind,
	isSandboxRejectionKind,
} from "../../sandbox/rejections.js";
import { StoreRepo } from "./base.js";
import { assertNonEmptyString } from "./shared.js";

interface SandboxRejectionRow {
	readonly id: number;
	readonly story_id: string;
	readonly node_id: string | null;
	readonly renderer: string;
	readonly kind: string;
	readonly target: string;
	readonly reason: string;
	readonly created_at: string;
}

function rowToRejection(row: SandboxRejectionRow): SandboxRejection {
	if (!isSandboxRejectionKind(row.kind)) {
		throw new Error(`沙箱拒绝记录 ${row.id} 的类型不合法：${row.kind}`);
	}
	return {
		id: Number(row.id),
		storyId: row.story_id,
		nodeId: row.node_id,
		renderer: row.renderer,
		kind: row.kind as SandboxRejectionKind,
		target: row.target,
		reason: row.reason,
		createdAt: row.created_at,
	};
}

function assertRecordText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

export class SandboxRepo extends StoreRepo {
	recordSandboxRejection(input: {
		readonly storyId: string;
		readonly nodeId: string | null;
		readonly renderer: string;
		readonly kind: SandboxRejectionKind;
		readonly target: string;
		readonly reason: string;
	}): SandboxRejection {
		assertNonEmptyString(input.storyId, "storyId");
		if (!isSandboxRejectionKind(input.kind)) {
			throw new Error(`沙箱拒绝类型不合法：${String(input.kind)}`);
		}
		const renderer = assertRecordText(input.renderer, "renderer");
		const target = assertRecordText(input.target, "target");
		const reason = assertRecordText(input.reason, "reason");
		const createdAt = new Date().toISOString();
		const result = this.db
			.prepare(
				`INSERT INTO sandbox_rejections
					(story_id, node_id, renderer, kind, target, reason, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.storyId,
				input.nodeId,
				renderer,
				input.kind,
				target,
				reason,
				createdAt,
			);
		return {
			id: Number(result.lastInsertRowid),
			storyId: input.storyId,
			nodeId: input.nodeId,
			renderer,
			kind: input.kind,
			target,
			reason,
			createdAt,
		};
	}

	/** 最近的记录在前；检视器只要看最近这么多条。 */
	listSandboxRejections(
		storyId: string,
		limit = 50,
	): readonly SandboxRejection[] {
		if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
			throw new Error(
				`沙箱拒绝记录的条数必须在 1 到 200 之间，实际为 ${String(limit)}`,
			);
		}
		const rows = this.db
			.prepare(
				`SELECT id, story_id, node_id, renderer, kind, target, reason, created_at
				FROM sandbox_rejections WHERE story_id = ? ORDER BY id DESC LIMIT ?`,
			)
			.all(storyId, limit) as SandboxRejectionRow[];
		return rows.map(rowToRejection);
	}
}

import {
	type JsonObject,
	type LedgerRepair,
	PendingLedgerView,
	type PendingLedgerWrite,
	type StateDiff,
	type StoryStore,
	isJsonObject,
	mvuLedgerPath,
} from "@dramaticer/core";
import { type SnapshotDiff, diffSnapshots } from "../state-diff.js";
import type {
	MvuObjectSchemaNode,
	MvuRootOptions,
	MvuState,
} from "./schema.js";
import {
	type MvuPatchOperation,
	type MvuPatchRejection,
	applyMvuPatch,
} from "./update.js";

export const ST_MVU_PLUGIN_ID = "st-mvu";

/** 变量写入在插件 Trace 里的目标；与代码插件 `ledger-write` 的记录口径一致。 */
export const ST_MVU_LEDGER_TARGET = "mvu";

export interface MvuLedgerTraceEntry {
	readonly plugin: typeof ST_MVU_PLUGIN_ID;
	readonly action: "ledger-write";
	readonly target: typeof ST_MVU_LEDGER_TARGET;
	readonly outcome: "accepted" | "rejected";
	/** 变量路径，不含 `mvu` 前缀；无法确定时为 null。 */
	readonly path: readonly string[] | null;
	readonly reason: string | null;
}

export interface MvuLedgerSessionOptions {
	readonly store: StoryStore;
	readonly nodeId: string;
	/** initvar 或已保存的结构；台账没有 `mvu` 子树时这份数据作为初始值写入。 */
	readonly state: MvuState;
	readonly onTrace?: (entry: MvuLedgerTraceEntry) => void;
}

export interface MvuLedgerApplyResult {
	/** 应用成功的补丁操作数；被拒绝的操作没有写入。 */
	readonly applied: number;
	readonly rejected: readonly MvuPatchRejection[];
	/** 交给待结算视图的写入；提交前读取就能看到。 */
	readonly writes: readonly PendingLedgerWrite[];
	readonly trace: readonly MvuLedgerTraceEntry[];
}

export interface MvuLedgerCommitResult {
	readonly accepted: readonly StateDiff[];
	/** 写入被结算器拒绝时转成的删除修复记录。 */
	readonly repairs: readonly LedgerRepair[];
	readonly trace: readonly MvuLedgerTraceEntry[];
}

/**
 * MVU 变量与台账 `mvu` 命名空间之间的会话：读台账、算补丁、先进入待结算视图，
 * 提交后以台账为准。变量不另存一份，持久事实只有台账。
 */
export class MvuLedgerSession {
	private schema: MvuObjectSchemaNode;
	private readonly options: MvuRootOptions;
	private readonly view: PendingLedgerView;

	private constructor(
		view: PendingLedgerView,
		state: MvuState,
		private readonly onTrace:
			| ((entry: MvuLedgerTraceEntry) => void)
			| undefined,
	) {
		this.view = view;
		this.schema = state.schema;
		this.options = state.options;
	}

	/**
	 * 在当前楼层打开会话。台账没有 `mvu` 子树时，把初始变量的整份数据
	 * 作为待结算写入，提交后它才成为台账事实。
	 */
	static open(options: MvuLedgerSessionOptions): MvuLedgerSession {
		const view = PendingLedgerView.open(options.store, options.nodeId, ["mvu"]);
		if (view.read() === undefined) {
			const initial = diffSnapshots({}, options.state.data).map(toWrite);
			const outcome = view.stage(initial, "settler");
			if (outcome.rejected.length > 0) {
				const first = outcome.rejected[0];
				throw new Error(
					`初始变量无法写入台账：${first?.path.join(".") ?? "-"}：${first?.reason ?? "未知原因"}`,
				);
			}
		}
		return new MvuLedgerSession(view, options.state, options.onTrace);
	}

	/** 待结算值：台账快照叠加尚未提交的写入。脚本读到自己刚写下的值。 */
	read(): JsonObject {
		const value = this.view.read();
		if (value === undefined) return {};
		if (!isJsonObject(value)) {
			throw new Error("台账 mvu 子树必须是对象");
		}
		return value;
	}

	pending(): readonly PendingLedgerWrite[] {
		return this.view.pending();
	}

	/** 执行一批 JSONPatch；每条操作单独校验，失败只拒绝该条。 */
	apply(operations: readonly MvuPatchOperation[]): MvuLedgerApplyResult {
		const before = this.read();
		const result = applyMvuPatch(
			{ data: before, schema: this.schema, options: this.options },
			operations,
		);
		const writes = diffSnapshots(before, result.data).map(toWrite);
		const outcome = this.view.stage(writes, "settler");
		this.schema = result.schema;
		const trace: MvuLedgerTraceEntry[] = [
			...outcome.rejected.map(
				(rejection): MvuLedgerTraceEntry => ({
					plugin: ST_MVU_PLUGIN_ID,
					action: "ledger-write",
					target: ST_MVU_LEDGER_TARGET,
					outcome: "rejected",
					path: rejection.path.slice(1),
					reason: rejection.reason,
				}),
			),
			...result.rejected.map(
				(rejection): MvuLedgerTraceEntry => ({
					plugin: ST_MVU_PLUGIN_ID,
					action: "ledger-write",
					target: ST_MVU_LEDGER_TARGET,
					outcome: "rejected",
					path: pointerSegments(rejection.operation.path),
					reason: rejection.reason,
				}),
			),
		];
		for (const entry of trace) this.onTrace?.(entry);
		return {
			applied: result.applied,
			rejected: result.rejected,
			writes: outcome.accepted,
			trace,
		};
	}

	/** 提交待结算写入；此后读取直接来自台账。 */
	commit(options: {
		readonly storyId: string;
		readonly source?: "settler" | "import";
	}): MvuLedgerCommitResult {
		const result = this.view.commit({
			storyId: options.storyId,
			source: options.source ?? "settler",
		});
		const trace: MvuLedgerTraceEntry[] = [
			...result.accepted.map(
				(diff): MvuLedgerTraceEntry => ({
					plugin: ST_MVU_PLUGIN_ID,
					action: "ledger-write",
					target: ST_MVU_LEDGER_TARGET,
					outcome: "accepted",
					path: diff.path.slice(1),
					reason: diff.reason,
				}),
			),
			...result.rejected.map(
				(rejection): MvuLedgerTraceEntry => ({
					plugin: ST_MVU_PLUGIN_ID,
					action: "ledger-write",
					target: ST_MVU_LEDGER_TARGET,
					outcome: "rejected",
					path: rejection.path.slice(1),
					reason: rejection.reason,
				}),
			),
		];
		for (const entry of trace) this.onTrace?.(entry);
		return {
			accepted: result.accepted,
			repairs: result.rejected.map((rejection) => ({
				path: rejection.path,
				action: "delete",
				reason: `结算器拒绝了这条变量写入：${rejection.reason}`,
			})),
			trace,
		};
	}
}

function toWrite(diff: SnapshotDiff): PendingLedgerWrite {
	return diff.op === "set"
		? {
				path: mvuLedgerPath(diff.path),
				op: "set",
				value: diff.value,
			}
		: { path: mvuLedgerPath(diff.path), op: "delete" };
}

/** JSON Pointer 与 MVU 的路径写法相同；只用于 Trace 里展示变量路径。 */
function pointerSegments(pointer: string): readonly string[] | null {
	if (pointer.length === 0 || pointer === "/") return null;
	const segments = pointer
		.split("/")
		.slice(1)
		.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
	return segments.length === 0 ? null : segments;
}

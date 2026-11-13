import {
	type JsonObject,
	type JsonValue,
	assertJsonValue,
	isJsonObject,
} from "../json.js";
import { applyDiffEntriesTo } from "../state.js";
import type { StoryStore } from "../store/story-store.js";
import type { NewStateDiff, StateDiff, StateDiffOp } from "../timeline.js";
import { readLedger } from "./read.js";
import { type LedgerDiffInput, validateLedgerDiff } from "./schema.js";
import type { LedgerSource } from "./schema.js";

/** 插件提交的一条台账写入；路径是完整的台账路径。 */
export interface PendingLedgerWrite {
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	readonly value?: JsonValue;
	readonly reason?: string | null;
}

export interface PendingLedgerRejection {
	readonly path: readonly string[];
	readonly reason: string;
}

/**
 * 结算器的同一套校验结果：合法的收下，非法的逐条拒绝并给出原因。
 * 拒绝条目不会再写入台账。
 */
export interface PendingLedgerOutcome {
	readonly accepted: readonly PendingLedgerWrite[];
	readonly rejected: readonly PendingLedgerRejection[];
}

export interface PendingLedgerCommit {
	readonly accepted: readonly StateDiff[];
	readonly rejected: readonly PendingLedgerRejection[];
}

/**
 * 插件内临时视图：打开时读台账快照，写入先留在这里，读取时叠加在快照上；
 * 提交后重新从台账读取。持久事实只在台账里，这里只有尚未提交的写入。
 *
 * 打开时可以限定前缀（例如 `["mvu"]`）：路径不在前缀之下的写入被拒绝，
 * 读取返回该前缀下的子树，与 `readLedger(store, nodeId, prefix)` 一致。
 */
export class PendingLedgerView {
	private base: JsonValue | undefined;
	private stagedWrites: PendingLedgerWrite[] = [];

	private constructor(
		private readonly store: StoryStore,
		private readonly nodeId: string,
		private readonly prefix: readonly string[] | undefined,
	) {
		this.base = readLedger(store, nodeId, prefix);
	}

	static open(
		store: StoryStore,
		nodeId: string,
		prefix?: readonly string[],
	): PendingLedgerView {
		return new PendingLedgerView(
			store,
			nodeId,
			prefix === undefined ? undefined : [...prefix],
		);
	}

	/** 待结算值：台账快照叠加尚未提交的写入。 */
	read(): JsonValue | undefined {
		if (this.stagedWrites.length === 0) return this.base;
		const root: JsonObject = isJsonObject(this.base) ? this.base : {};
		const relative = this.stagedWrites.map((write) => ({
			path:
				this.prefix === undefined
					? write.path
					: write.path.slice(this.prefix.length),
			op: write.op,
			value: write.value,
		}));
		return applyDiffEntriesTo(root, relative);
	}

	/** 尚未提交的写入，按提交顺序。 */
	pending(): readonly PendingLedgerWrite[] {
		return this.stagedWrites.map((write) => ({ ...write }));
	}

	/** 按结算器的校验收下写入；非法条目逐条拒绝，合法规格保留。 */
	stage(
		writes: readonly PendingLedgerWrite[],
		source: LedgerSource,
	): PendingLedgerOutcome {
		const accepted: PendingLedgerWrite[] = [];
		const rejected: PendingLedgerRejection[] = [];
		for (const [index, write] of writes.entries()) {
			try {
				const normalised = this.normaliseWrite(write, source, index);
				this.stagedWrites.push(normalised);
				accepted.push(normalised);
			} catch (error) {
				rejected.push({
					path: Array.isArray(write.path) ? [...write.path] : [],
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}
		return { accepted, rejected };
	}

	/** 把尚未提交的写入交给台账；提交后读取以台账为准。 */
	commit(options: {
		readonly storyId: string;
		readonly source: LedgerSource;
	}): PendingLedgerCommit {
		const rejected: PendingLedgerRejection[] = [];
		const writes: PendingLedgerWrite[] = [];
		for (const [index, write] of this.stagedWrites.entries()) {
			try {
				writes.push(this.normaliseWrite(write, options.source, index));
			} catch (error) {
				rejected.push({
					path: Array.isArray(write.path) ? [...write.path] : [],
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}
		const inserts: NewStateDiff[] = writes.map((write) =>
			write.op === "set"
				? {
						storyId: options.storyId,
						nodeId: this.nodeId,
						path: write.path,
						op: "set",
						value: write.value,
						reason: write.reason ?? null,
						source: options.source,
					}
				: {
						storyId: options.storyId,
						nodeId: this.nodeId,
						path: write.path,
						op: "delete",
						reason: write.reason ?? null,
						source: options.source,
					},
		);
		const accepted =
			inserts.length === 0 ? [] : this.store.appendStateDiffs(inserts);
		this.stagedWrites = [];
		this.base = readLedger(this.store, this.nodeId, this.prefix);
		return { accepted, rejected };
	}

	private normaliseWrite(
		write: PendingLedgerWrite,
		source: LedgerSource,
		index: number,
	): PendingLedgerWrite {
		const label = `写入[${index}]`;
		const path = readWritePath(write.path, label);
		if (
			this.prefix !== undefined &&
			(path.length <= this.prefix.length ||
				!this.prefix.every((segment, position) => path[position] === segment))
		) {
			throw new Error(
				`${label} 的路径 ${JSON.stringify(path)} 不在前缀 ${JSON.stringify(this.prefix)} 之下`,
			);
		}
		if (write.op !== "set" && write.op !== "delete") {
			throw new Error(`${label} 的 op 只能是 set 或 delete`);
		}
		if (write.op === "delete" && write.value !== undefined) {
			throw new Error(`${label} 的 delete 不能带 value`);
		}
		if (write.op === "set") {
			assertJsonValue(write.value, `${label} 的值`);
		}
		const input: LedgerDiffInput = {
			path,
			op: write.op,
			...(write.op === "set" ? { value: write.value } : {}),
			source,
		};
		validateLedgerDiff(input);
		return {
			path,
			op: write.op,
			...(write.op === "set" ? { value: write.value } : {}),
			reason: write.reason ?? null,
		};
	}
}

function readWritePath(
	value: readonly string[],
	label: string,
): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 的 path 必须是字符串组成的非空数组`);
	}
	for (const [index, segment] of value.entries()) {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`${label} 的 path[${index}] 必须是非空字符串`);
		}
	}
	return [...value];
}

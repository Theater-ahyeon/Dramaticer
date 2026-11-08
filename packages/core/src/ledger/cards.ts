import { createHash } from "node:crypto";
import {
	type JsonObject,
	assertJsonValue,
	assertPlainObject,
	isJsonObject,
	rejectUnknownKeys,
} from "../json.js";
import { readStateValue } from "../state.js";
import type { StoryStore } from "../store/story-store.js";
import type { NewStateDiff, StateDiffOp } from "../timeline.js";
import { readLedger } from "./read.js";
import { type LedgerSource, validateLedgerDiff } from "./schema.js";
import { userWillStableId } from "./user-will.js";

export const LEDGER_CHANGE_CARD_STATUSES = [
	"pending",
	"approved",
	"rejected",
	"rolled_back",
] as const;
export type LedgerChangeCardStatus =
	(typeof LEDGER_CHANGE_CARD_STATUSES)[number];

/** 变更卡操作失败的原因；调用方据此区分“不存在”和“状态不允许”。 */
export type LedgerChangeCardErrorCode = "not_found" | "invalid_status";

export class LedgerChangeCardError extends Error {
	readonly code: LedgerChangeCardErrorCode;

	constructor(code: LedgerChangeCardErrorCode, message: string) {
		super(message);
		this.name = "LedgerChangeCardError";
		this.code = code;
	}
}

/** `userWill` 台账路径的第一段。 */
const USER_WILL_NAMESPACE = "userWill";

const DIFF_KEYS = ["path", "op", "value"] as const;
const BEFORE_KEYS = ["path", "existed", "value"] as const;

/** 变更卡里的一条台账修改；批准时按它写入。 */
export interface LedgerChangeCardDiff {
	readonly path: readonly string[];
	readonly op: StateDiffOp;
	/** op 为 set 时的值；delete 时不出现。 */
	readonly value?: unknown;
}

/** 批准前该路径上的原值，回滚时用它恢复。 */
export interface LedgerBeforeEntry {
	readonly path: readonly string[];
	readonly existed: boolean;
	/** existed 为 true 时的原值。 */
	readonly value?: unknown;
}

export interface LedgerChangeCard {
	readonly id: string;
	readonly storyId: string;
	/** 卡片来源：玩家提出、结算冲突、正文模型提案。 */
	readonly source: LedgerSource;
	readonly sourceNodeId: string;
	readonly text: string;
	readonly diffs: readonly LedgerChangeCardDiff[];
	readonly before: readonly LedgerBeforeEntry[];
	readonly status: LedgerChangeCardStatus;
	/** 草案被拒绝时的原因；其余情况为 null。 */
	readonly rejectionReason: string | null;
	readonly createdAt: string;
	readonly decidedAt: string | null;
}

export interface NewLedgerChangeCardInput {
	readonly id: string;
	readonly storyId: string;
	readonly source: LedgerSource;
	readonly sourceNodeId: string;
	readonly text: string;
	readonly diffs: readonly LedgerChangeCardDiff[];
	readonly before: readonly LedgerBeforeEntry[];
	readonly status: LedgerChangeCardStatus;
	readonly rejectionReason?: string | null;
	readonly createdAt?: string;
	readonly decidedAt?: string | null;
}

export function isLedgerChangeCardStatus(
	value: unknown,
): value is LedgerChangeCardStatus {
	return (
		typeof value === "string" &&
		(LEDGER_CHANGE_CARD_STATUSES as readonly string[]).includes(value)
	);
}

/**
 * 变更卡 id：全部组成部分规范化后取摘要，同样的内容永远得到同一个 id，
 * 后台任务重跑不会产生重复卡片。
 */
export function ledgerChangeCardId(parts: readonly string[]): string {
	const digest = createHash("sha256")
		.update(parts.join("\u0000"))
		.digest("hex");
	return `card-${digest.slice(0, 16)}`;
}

/** 校验一条变更卡修改；写库前与批准前都用同一套台账规则。 */
export function assertLedgerChangeCardDiff(
	value: unknown,
	label: string,
): LedgerChangeCardDiff {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, DIFF_KEYS, label);
	const path = readPath(record.path, `${label}.path`);
	const op = record.op;
	if (op !== "set" && op !== "delete") {
		throw new Error(`${label}.op 只能是 set 或 delete，收到 ${String(op)}`);
	}
	if (op === "delete") {
		if (Object.hasOwn(record, "value")) {
			throw new Error(`${label} 的 delete 不能带 value`);
		}
		validateLedgerDiff({ path, op, source: "player" });
		return { path, op };
	}
	if (!Object.hasOwn(record, "value")) {
		throw new Error(`${label} 的 set 必须带 value`);
	}
	validateLedgerDiff({ path, op, value: record.value, source: "player" });
	return { path, op, value: record.value };
}

export function assertLedgerChangeCardDiffs(
	value: unknown,
	label: string,
): LedgerChangeCardDiff[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	return value.map((item, index) =>
		assertLedgerChangeCardDiff(item, `${label}[${index}]`),
	);
}

/**
 * 校验批准前的原值记录：与 diffs 一一对应，路径序列必须相同；
 * 不存在过的路径不能带 value。
 */
export function assertLedgerBeforeEntries(
	value: unknown,
	diffs: readonly LedgerChangeCardDiff[],
	label: string,
): LedgerBeforeEntry[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	if (value.length !== diffs.length) {
		throw new Error(
			`${label} 的条数必须与 diffs 相同：${value.length} 与 ${diffs.length}`,
		);
	}
	return value.map((item, index) => {
		const itemLabel = `${label}[${index}]`;
		const record = assertPlainObject(item, itemLabel);
		rejectUnknownKeys(record, BEFORE_KEYS, itemLabel);
		const path = readPath(record.path, `${itemLabel}.path`);
		const expected = diffs[index] as LedgerChangeCardDiff;
		if (JSON.stringify(path) !== JSON.stringify(expected.path)) {
			throw new Error(
				`${itemLabel}.path 必须与 diffs[${index}].path 相同：${path
					.map((segment) => JSON.stringify(segment))
					.join(".")}`,
			);
		}
		if (typeof record.existed !== "boolean") {
			throw new Error(`${itemLabel}.existed 必须是布尔值`);
		}
		if (!record.existed) {
			if (Object.hasOwn(record, "value")) {
				throw new Error(`${itemLabel} 不存在过的路径不能带 value`);
			}
			return { path, existed: false };
		}
		if (!Object.hasOwn(record, "value")) {
			throw new Error(`${itemLabel} 存在过的路径必须带原值 value`);
		}
		assertJsonValue(record.value, `${itemLabel}.value`);
		return { path, existed: true, value: record.value };
	});
}

/** 从台账快照读出某条修改的原值，作为变更卡的 before 记录。 */
export function readBeforeEntry(
	state: JsonObject,
	path: readonly string[],
): LedgerBeforeEntry {
	const value = readStateValue(state, path);
	if (value === undefined) return { path: [...path], existed: false };
	return { path: [...path], existed: true, value };
}

export interface ChangeCardDecisionOptions {
	/** 决定时间；缺省用当前时间。 */
	readonly decidedAt?: string;
}

/**
 * 批准变更卡：把 diffs 写成 `source` 为 `player` 的事实；玩家提出的卡片同时
 * 把同一段话作为纠正记入用户意志，结算冲突转来的卡片只写事实。只有待定卡
 * 可以批准，重复批准直接抛错。
 */
export async function approveLedgerChangeCard(
	store: StoryStore,
	cardId: string,
	options: ChangeCardDecisionOptions = {},
): Promise<LedgerChangeCard> {
	return store.runInTransaction(() => {
		const card = requirePendingCard(store, cardId, "批准");
		const head = requireHead(store, card.storyId, "批准");
		const decidedAt = resolveDecidedAt(options);
		const writes: NewStateDiff[] = card.diffs.map((diff) =>
			cardDiffToFact(store, card, head.id, diff, `变更卡 ${card.id}`),
		);
		if (card.source === "player") {
			const willId = userWillStableId(card.text);
			if (!hasUserWill(store, head.id, willId)) {
				const path = [USER_WILL_NAMESPACE, willId];
				const value = {
					kind: "correction",
					text: card.text,
					sourceNodeId: card.sourceNodeId,
					createdAt: decidedAt,
				};
				validateLedgerDiff({ path, op: "set", value, source: "player" });
				writes.push({
					storyId: card.storyId,
					nodeId: head.id,
					path,
					op: "set",
					value,
					source: "player",
					reason: `变更卡 ${card.id} 的玩家意志`,
				});
			}
		}
		if (writes.length > 0) store.appendStateDiffs(writes);
		return store.updateLedgerChangeCardStatus(cardId, "approved", decidedAt);
	});
}

/** 拒绝变更卡：只改状态，不写台账。 */
export async function rejectLedgerChangeCard(
	store: StoryStore,
	cardId: string,
	options: ChangeCardDecisionOptions = {},
): Promise<LedgerChangeCard> {
	return store.runInTransaction(() => {
		requirePendingCard(store, cardId, "拒绝");
		return store.updateLedgerChangeCardStatus(
			cardId,
			"rejected",
			resolveDecidedAt(options),
		);
	});
}

/**
 * 回滚已批准的变更卡：按 before 追加反向 diff 恢复原值，原事实保留在
 * 变更历史里。已经回滚过的卡片不能再次回滚。
 */
export async function rollbackLedgerChangeCard(
	store: StoryStore,
	cardId: string,
	options: ChangeCardDecisionOptions = {},
): Promise<LedgerChangeCard> {
	return store.runInTransaction(() => {
		const card = requireCard(store, cardId);
		if (card.status !== "approved") {
			throw new LedgerChangeCardError(
				"invalid_status",
				`变更卡 ${cardId} 的状态是 ${card.status}，只有已批准的卡片可以回滚`,
			);
		}
		const head = requireHead(store, card.storyId, "回滚");
		const writes: NewStateDiff[] = card.before.map((entry) => {
			const common = {
				storyId: card.storyId,
				nodeId: head.id,
				path: [...entry.path],
				source: "player",
				reason: `变更卡 ${card.id} 的回滚`,
			};
			if (!entry.existed) return { ...common, op: "delete" };
			validateLedgerDiff({
				path: entry.path,
				op: "set",
				value: entry.value,
				source: "player",
			});
			return { ...common, op: "set", value: entry.value };
		});
		if (writes.length > 0) store.appendStateDiffs(writes);
		return store.updateLedgerChangeCardStatus(
			cardId,
			"rolled_back",
			resolveDecidedAt(options),
		);
	});
}

/** 读取一张变更卡；不存在时抛错。 */
export function requireCard(
	store: Pick<StoryStore, "getLedgerChangeCard">,
	cardId: string,
): LedgerChangeCard {
	const card = store.getLedgerChangeCard(cardId);
	if (card === null) {
		throw new LedgerChangeCardError("not_found", `变更卡不存在：${cardId}`);
	}
	return card;
}

function requirePendingCard(
	store: Pick<StoryStore, "getLedgerChangeCard">,
	cardId: string,
	action: string,
): LedgerChangeCard {
	const card = requireCard(store, cardId);
	if (card.status !== "pending") {
		throw new LedgerChangeCardError(
			"invalid_status",
			`变更卡 ${cardId} 的状态是 ${card.status}，只有待定卡可以${action}`,
		);
	}
	return card;
}

function requireHead(store: StoryStore, storyId: string, action: string) {
	const head = store.getHead(storyId);
	if (head === null) {
		throw new Error(`故事 ${storyId} 还没有楼层，不能${action}变更卡`);
	}
	return head;
}

function resolveDecidedAt(options: ChangeCardDecisionOptions): string {
	const decidedAt = options.decidedAt ?? new Date().toISOString();
	if (typeof decidedAt !== "string" || decidedAt.length === 0) {
		throw new Error("变更卡的决定时间必须是非空字符串");
	}
	return decidedAt;
}

function cardDiffToFact(
	store: StoryStore,
	card: LedgerChangeCard,
	nodeId: string,
	diff: LedgerChangeCardDiff,
	reason: string,
): NewStateDiff {
	assertLedgerChangeCardDiff(diff, `变更卡 ${card.id} 的修改`);
	const common = {
		storyId: card.storyId,
		nodeId,
		path: [...diff.path],
		source: "player",
		reason,
	};
	if (diff.op === "delete") return { ...common, op: "delete" };
	return { ...common, op: "set", value: diff.value };
}

function hasUserWill(
	store: StoryStore,
	nodeId: string,
	willId: string,
): boolean {
	const value = readLedger(store, nodeId, [USER_WILL_NAMESPACE]);
	return isJsonObject(value) && Object.hasOwn(value, willId);
}

function readPath(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是字符串组成的非空数组`);
	}
	const path: string[] = [];
	for (const [index, segment] of value.entries()) {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`${label}[${index}] 必须是非空字符串`);
		}
		path.push(segment);
	}
	return path;
}

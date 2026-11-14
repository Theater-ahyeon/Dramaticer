import { createHash } from "node:crypto";
import { parseContextCondition } from "../context/condition.js";
import type { ContextCondition } from "../context/template.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import { isLedgerNamespace } from "../ledger/schema.js";

export const DIRECTOR_BIT_CONDITION_KINDS = ["text", "ledger"] as const;

export type DirectorBitConditionKind =
	(typeof DIRECTOR_BIT_CONDITION_KINDS)[number];

/** 自然语言条件：由后台批量判断，结果按楼层缓存。 */
export interface DirectorBitTextCondition {
	readonly kind: "text";
	readonly text: string;
}

/** 台账查询：条件语言与模板的 `when` 相同，只允许台账命名空间。 */
export interface DirectorBitLedgerCondition {
	readonly kind: "ledger";
	readonly query: ContextCondition;
}

export type DirectorBitCondition =
	| DirectorBitTextCondition
	| DirectorBitLedgerCondition;

/**
 * 剧情小品：导演的唯一对象。`bits` 引擎按优先级、冷却、顺序约束、
 * 可否重复与兜底选出一条建议。
 */
export interface DirectorBit {
	/** 故事内唯一。 */
	readonly id: string;
	/** 兜底小品没有条件，总是可以参与选择。 */
	readonly condition: DirectorBitCondition | null;
	readonly instruction: string;
	readonly priority: number;
	/** 再次触发前至少隔多少个楼层；0 表示没有冷却。 */
	readonly cooldown: number;
	/** 顺序约束：排在另一个小品第一次触发之后。 */
	readonly after: string | null;
	/** 同一路径上是否允许再次触发。 */
	readonly repeatable: boolean;
	/** 没有其他小品命中时使用；与其他兜底小品比较优先级。 */
	readonly fallback: boolean;
}

export interface DirectorBitJudgment {
	readonly id: string;
	readonly matched: boolean;
	readonly reason: string;
}

export interface DirectorBitJudgments {
	readonly storyId: string;
	readonly nodeId: string;
	/** 条件正文的指纹；小品改动后旧判断不再复用。 */
	readonly fingerprint: string;
	readonly judgments: readonly DirectorBitJudgment[];
	readonly createdAt: string;
}

export interface NewDirectorBitJudgmentsInput {
	readonly storyId: string;
	readonly nodeId: string;
	readonly fingerprint: string;
	readonly judgments: readonly DirectorBitJudgment[];
	readonly createdAt?: string;
}

export interface ReplaceDirectorBitsInput {
	readonly storyId: string;
	readonly bits: readonly DirectorBit[];
	readonly source?: string;
	readonly createdAt?: string;
}

/** 没有可用小品时写入决策记录的名字。 */
export const DIRECTOR_BIT_RECORD_NAME = "bits";

const BIT_KEYS = [
	"id",
	"condition",
	"instruction",
	"priority",
	"cooldown",
	"after",
	"repeatable",
	"fallback",
];

const TEXT_CONDITION_KEYS = ["kind", "text"];
const LEDGER_CONDITION_KEYS = ["kind", "query"];

/**
 * 解析卡的 `extensions.dramaticer.bits`。未知字段、重复 id、空字符串、
 * 非法条件、悬空的顺序引用与顺序环都在这里拒绝，错误信息带 JSON 路径。
 */
export function parseDirectorBitDefinitions(
	value: unknown,
	path: string,
): DirectorBit[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const ids = new Set<string>();
	const bits = value.map((item, index) => {
		const bitPath = `${path}[${index}]`;
		const bit = parseDirectorBit(item, bitPath);
		if (ids.has(bit.id)) {
			throw new Error(`${bitPath}.id 重复：${bit.id}`);
		}
		ids.add(bit.id);
		return bit;
	});
	assertOrderingReferences(bits, path);
	assertNoOrderingCycles(bits, path);
	return bits;
}

function parseDirectorBit(value: unknown, path: string): DirectorBit {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, BIT_KEYS, path);
	const id = readNonEmptyString(object.id, `${path}.id`);
	const instruction = readNonEmptyString(
		object.instruction,
		`${path}.instruction`,
	);
	const priority = object.priority ?? 0;
	if (typeof priority !== "number" || !Number.isFinite(priority)) {
		throw new Error(`${path}.priority 必须是有限数字`);
	}
	const cooldown = object.cooldown ?? 0;
	if (
		typeof cooldown !== "number" ||
		!Number.isInteger(cooldown) ||
		cooldown < 0
	) {
		throw new Error(`${path}.cooldown 必须是非负整数`);
	}
	const after =
		object.after === undefined || object.after === null
			? null
			: readNonEmptyString(object.after, `${path}.after`);
	const repeatable = object.repeatable ?? true;
	if (typeof repeatable !== "boolean") {
		throw new Error(`${path}.repeatable 必须是布尔值`);
	}
	const fallback = object.fallback ?? false;
	if (typeof fallback !== "boolean") {
		throw new Error(`${path}.fallback 必须是布尔值`);
	}
	const condition = parseCondition(
		object.condition,
		`${path}.condition`,
		fallback,
	);
	return {
		id,
		condition,
		instruction,
		priority,
		cooldown,
		after,
		repeatable,
		fallback,
	};
}

function parseCondition(
	value: unknown,
	path: string,
	fallback: boolean,
): DirectorBitCondition | null {
	if (value === undefined || value === null) {
		if (!fallback) {
			throw new Error(`${path} 必须提供；兜底小品才可以省略条件`);
		}
		return null;
	}
	if (fallback) {
		throw new Error(`${path} 在兜底小品里必须省略`);
	}
	const object = assertPlainObject(value, path);
	const kind = object.kind;
	if (kind === "text") {
		rejectUnknownKeys(object, TEXT_CONDITION_KEYS, path);
		return {
			kind: "text",
			text: readNonEmptyString(object.text, `${path}.text`),
		};
	}
	if (kind === "ledger") {
		rejectUnknownKeys(object, LEDGER_CONDITION_KEYS, path);
		return {
			kind: "ledger",
			query: parseLedgerQuery(object.query, `${path}.query`),
		};
	}
	throw new Error(`${path}.kind 必须是 text 或 ledger`);
}

function parseLedgerQuery(value: unknown, path: string): ContextCondition {
	const query = parseContextCondition(value, path, { allowSwitch: false });
	assertLedgerPaths(query, path);
	return query;
}

function assertLedgerPaths(condition: ContextCondition, path: string): void {
	switch (condition.kind) {
		case "state": {
			const namespace = condition.path[0];
			if (namespace === undefined || !isLedgerNamespace(namespace)) {
				throw new Error(
					`${path}.path[0] 必须是台账命名空间：${String(namespace)}`,
				);
			}
			return;
		}
		case "all":
		case "any":
			condition.conditions.forEach((item, index) =>
				assertLedgerPaths(item, `${path}.conditions[${index}]`),
			);
			return;
		case "not":
			assertLedgerPaths(condition.condition, `${path}.condition`);
			return;
		case "switch":
			throw new Error(`${path} 不能是 switch 条件`);
	}
}

function assertOrderingReferences(
	bits: readonly DirectorBit[],
	path: string,
): void {
	const ids = new Set(bits.map((bit) => bit.id));
	bits.forEach((bit, index) => {
		if (bit.after === null) return;
		if (bit.after === bit.id) {
			throw new Error(`${path}[${index}].after 不能指向自己：${bit.id}`);
		}
		if (!ids.has(bit.after)) {
			throw new Error(`${path}[${index}].after 指向不存在的小品：${bit.after}`);
		}
	});
}

function assertNoOrderingCycles(
	bits: readonly DirectorBit[],
	path: string,
): void {
	const byId = new Map(bits.map((bit) => [bit.id, bit] as const));
	const visiting = new Set<string>();
	const done = new Set<string>();
	const visit = (id: string): void => {
		if (done.has(id)) return;
		if (visiting.has(id)) {
			throw new Error(`${path} 的顺序约束形成环：${id}`);
		}
		visiting.add(id);
		const bit = byId.get(id);
		if (bit?.after !== null && bit?.after !== undefined) {
			visit(bit.after);
		}
		visiting.delete(id);
		done.add(id);
	};
	for (const bit of bits) {
		visit(bit.id);
	}
}

/** 自然语言条件的指纹：小品改动后旧判断不再复用。 */
export function directorBitTextFingerprint(
	bits: readonly DirectorBit[],
): string {
	const textBits = bits
		.filter(
			(bit): bit is DirectorBit & { condition: DirectorBitTextCondition } =>
				bit.condition?.kind === "text",
		)
		.map((bit) => ({ id: bit.id, text: bit.condition.text }));
	return createHash("sha256")
		.update(JSON.stringify(textBits))
		.digest("hex")
		.slice(0, 16);
}

/** 判断本条记录里选中的小品；旧记录或机制型记录返回 null。 */
export function readSelectedDirectorBit(
	signals: Readonly<Record<string, unknown>>,
): string | null {
	if (signals.organization !== "bits") return null;
	const selected = signals.selected;
	return typeof selected === "string" && selected.length > 0 ? selected : null;
}

export function assertDirectorBitJudgments(
	value: unknown,
	path: string,
): DirectorBitJudgment[] {
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const ids = new Set<string>();
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const object = assertPlainObject(item, itemPath);
		rejectUnknownKeys(object, ["id", "matched", "reason"], itemPath);
		const id = readNonEmptyString(object.id, `${itemPath}.id`);
		if (ids.has(id)) {
			throw new Error(`${itemPath}.id 重复：${id}`);
		}
		ids.add(id);
		if (typeof object.matched !== "boolean") {
			throw new Error(`${itemPath}.matched 必须是布尔值`);
		}
		const reason = readNonEmptyString(object.reason, `${itemPath}.reason`);
		return { id, matched: object.matched, reason };
	});
}

function readNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new Error(`${path} 必须是字符串`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${path} 不能是空字符串`);
	}
	return trimmed;
}

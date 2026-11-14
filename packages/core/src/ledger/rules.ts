import {
	type JsonObject,
	type JsonValue,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import { readStateValue } from "../state.js";
import { mvuLedgerPath } from "./schema.js";

/** 检定用的骰子面数；难度是 d20 的目标点数。 */
export const RULE_CHECK_DIE = 20;

/** 规则结果在台账里的路径：`rule.<id>.result`。 */
export const RULE_RESULT_FIELD = "result";

export interface DramaticerRuleResource {
	/** 资源在卡变量里的路径；执行时映射到 `mvu.<路径>`。 */
	readonly path: readonly string[];
	/** 每次检定消耗的数量。 */
	readonly cost: number;
}

/** 卡在 `extensions.dramaticer.rules` 里声明的检定。 */
export interface DramaticerRuleDeclaration {
	readonly id: string;
	/** 用途说明，例如“剑术检定”。 */
	readonly label: string;
	/** 检定的目标，例如“剑术”。 */
	readonly target: string;
	/** d20 的目标点数，掷出大于等于它的点数算成功。 */
	readonly difficulty: number;
	readonly resource: DramaticerRuleResource | null;
}

export interface RuleCheckLedgerWrite {
	readonly path: readonly string[];
	readonly value: JsonValue;
}

export interface RuleCheckResourceChange {
	readonly path: readonly string[];
	readonly cost: number;
	readonly before: number;
	readonly after: number;
}

export interface RuleCheckOutcome {
	readonly ruleId: string;
	readonly label: string;
	readonly target: string;
	readonly roll: number;
	readonly difficulty: number;
	readonly success: boolean;
	readonly resource: RuleCheckResourceChange | null;
	/** 需要写入台账的条目：资源余量（如果有）与这次检定的结果。 */
	readonly writes: readonly RuleCheckLedgerWrite[];
}

export interface RuleCheckOptions {
	/** 当前台账快照，用来读资源余量。 */
	readonly snapshot: JsonObject;
	/** 骰点；省略时随机取 1 到 20。测试与回放显式传入。 */
	readonly roll?: number;
}

const RULE_KEYS = ["id", "label", "target", "difficulty", "resource"] as const;
const RESOURCE_KEYS = ["path", "cost"] as const;

/** 台账里规则结果的路径；结果字段固定为 `result`。 */
export function ruleResultLedgerPath(ruleId: string): string[] {
	return ["rule", ruleId, RULE_RESULT_FIELD];
}

/**
 * 解析卡的规则声明。未知字段、空字符串、重复 id、越界难度与非法资源都抛错，
 * 错误信息带 `extensions.dramaticer.rules[...]` 路径。
 */
export function parseDramaticerRuleDeclarations(
	value: unknown,
	label = "extensions.dramaticer.rules",
): DramaticerRuleDeclaration[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	const seen = new Set<string>();
	return value.map((item, index) => {
		const path = `${label}[${index}]`;
		const rule = parseRule(item, path);
		if (seen.has(rule.id)) {
			throw new Error(`${path}.id 重复：${rule.id}`);
		}
		seen.add(rule.id);
		return rule;
	});
}

function parseRule(value: unknown, path: string): DramaticerRuleDeclaration {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, RULE_KEYS, path);
	const id = readNonEmptyString(object.id, `${path}.id`);
	const label = readNonEmptyString(object.label, `${path}.label`);
	const target = readNonEmptyString(object.target, `${path}.target`);
	const difficulty = object.difficulty;
	if (
		typeof difficulty !== "number" ||
		!Number.isInteger(difficulty) ||
		difficulty < 1 ||
		difficulty > RULE_CHECK_DIE
	) {
		throw new Error(
			`${path}.difficulty 必须是 1 到 ${RULE_CHECK_DIE} 之间的整数，收到 ${JSON.stringify(difficulty)}`,
		);
	}
	const resource =
		object.resource === undefined || object.resource === null
			? null
			: parseResource(object.resource, `${path}.resource`);
	return { id, label, target, difficulty, resource };
}

function parseResource(value: unknown, path: string): DramaticerRuleResource {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, RESOURCE_KEYS, path);
	if (!Array.isArray(object.path) || object.path.length === 0) {
		throw new Error(`${path}.path 必须是非空字符串数组`);
	}
	const resourcePath = object.path.map((segment, index) => {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(
				`${path}.path[${index}] 必须是非空字符串，收到 ${JSON.stringify(segment)}`,
			);
		}
		return segment;
	});
	const cost = object.cost;
	if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1) {
		throw new Error(`${path}.cost 必须是正整数，收到 ${JSON.stringify(cost)}`);
	}
	return { path: resourcePath, cost };
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

/**
 * 由程序执行一次检定：掷 d20，成功与否与资源扣减都由这里决定。
 * 资源不足、路径不存在或当前值不是数字时直接抛错并指出字段。
 */
export function executeRuleCheck(
	rule: DramaticerRuleDeclaration,
	options: RuleCheckOptions,
): RuleCheckOutcome {
	const roll = options.roll ?? Math.floor(Math.random() * RULE_CHECK_DIE) + 1;
	if (!Number.isInteger(roll) || roll < 1 || roll > RULE_CHECK_DIE) {
		throw new Error(
			`规则 ${rule.id} 的 roll 必须是 1 到 ${RULE_CHECK_DIE} 之间的整数，收到 ${JSON.stringify(roll)}`,
		);
	}
	const success = roll >= rule.difficulty;
	const writes: RuleCheckLedgerWrite[] = [];
	let resource: RuleCheckResourceChange | null = null;
	if (rule.resource !== null) {
		const ledgerPath = mvuLedgerPath(rule.resource.path);
		const current = readStateValue(options.snapshot, ledgerPath);
		if (typeof current !== "number" || !Number.isFinite(current)) {
			throw new Error(
				`规则 ${rule.id} 的资源 ${rule.resource.path.join(".")} 当前值不是数字：${JSON.stringify(current)}`,
			);
		}
		if (current < rule.resource.cost) {
			throw new Error(
				`规则 ${rule.id} 的资源 ${rule.resource.path.join(".")} 不足：当前 ${current}，需要 ${rule.resource.cost}`,
			);
		}
		const after = current - rule.resource.cost;
		resource = {
			path: rule.resource.path,
			cost: rule.resource.cost,
			before: current,
			after,
		};
		writes.push({ path: ledgerPath, value: after });
	}
	writes.push({
		path: ruleResultLedgerPath(rule.id),
		value: { roll, difficulty: rule.difficulty, success },
	});
	return {
		ruleId: rule.id,
		label: rule.label,
		target: rule.target,
		roll,
		difficulty: rule.difficulty,
		success,
		resource,
		writes,
	};
}

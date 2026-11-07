import type { LlmRole } from "../llm/types.js";

/** 内置默认模板的 id；故事设置把 templateId 指向它表示不使用库里的模板。 */
export const DEFAULT_CONTEXT_TEMPLATE_ID = "dramaticer-default";

/** DESIGN §9 的 harness 槽位。 */
export const CONTEXT_SLOT_NAMES = [
	"lore",
	"character",
	"persona",
	"summary",
	"state",
	"memory",
	"history",
	"director",
	"protocol",
] as const;

export type ContextSlotName = (typeof CONTEXT_SLOT_NAMES)[number];

const SLOT_NAMES: ReadonlySet<string> = new Set(CONTEXT_SLOT_NAMES);

export function isContextSlotName(value: unknown): value is ContextSlotName {
	return typeof value === "string" && SLOT_NAMES.has(value);
}

/** 组装器输出、也是 LlmRequest 直接消费的一条消息。 */
export interface ContextMessage {
	readonly role: LlmRole;
	readonly content: string;
}

/**
 * 条件段的条件。模板是结构化数据，条件也必须能用数据表达。
 * 开关未设置时按 false 处理。
 */
export type ContextCondition =
	| {
			readonly kind: "switch";
			readonly name: string;
			/** 期望的开关值，默认 true。 */
			readonly equals?: boolean;
	  }
	| {
			readonly kind: "state";
			readonly path: readonly string[];
			readonly op: "exists" | "equals" | "truthy";
			/** op 为 equals 时的比较值。 */
			readonly value?: unknown;
	  }
	| {
			readonly kind: "all";
			readonly conditions: readonly ContextCondition[];
	  }
	| {
			readonly kind: "any";
			readonly conditions: readonly ContextCondition[];
	  }
	| {
			readonly kind: "not";
			readonly condition: ContextCondition;
	  };

export interface ContextConditionFacts {
	readonly switches: Readonly<Record<string, boolean>>;
	readonly state: unknown;
}

interface ContextSegmentBase {
	readonly id: string;
	/** 预算裁剪优先级，数值越大越先保留，默认 0。 */
	readonly priority?: number;
	/** 条件不满足时整段跳过，不调用槽位提供者。 */
	readonly when?: ContextCondition;
}

export interface ContextStaticSegment extends ContextSegmentBase {
	readonly kind: "static";
	readonly text: string;
}

export interface ContextSlotSegment extends ContextSegmentBase {
	readonly kind: "slot";
	readonly slot: ContextSlotName;
}

export type ContextSegment = ContextStaticSegment | ContextSlotSegment;

/** 有序的上下文模板。输出顺序始终等于这里的顺序。 */
export interface ContextTemplate {
	readonly id: string;
	readonly segments: readonly ContextSegment[];
}

export function assertContextTemplate(template: ContextTemplate): void {
	if (typeof template.id !== "string" || template.id.length === 0) {
		throw new Error("上下文模板的 id 必须是非空字符串");
	}
	if (!Array.isArray(template.segments)) {
		throw new Error(`上下文模板 ${template.id} 的 segments 必须是数组`);
	}
	const ids = new Set<string>();
	for (const segment of template.segments) {
		if (typeof segment.id !== "string" || segment.id.length === 0) {
			throw new Error(`上下文模板 ${template.id} 里的片段 id 必须是非空字符串`);
		}
		if (ids.has(segment.id)) {
			throw new Error(
				`上下文模板 ${template.id} 里的片段 id 重复：${segment.id}`,
			);
		}
		ids.add(segment.id);
		if (segment.priority !== undefined && !Number.isFinite(segment.priority)) {
			throw new Error(`上下文片段 ${segment.id} 的 priority 必须是有限数字`);
		}
		if (segment.kind === "static") {
			if (typeof segment.text !== "string" || segment.text.length === 0) {
				throw new Error(`上下文片段 ${segment.id} 的静态文本必须是非空字符串`);
			}
		} else if (!isContextSlotName(segment.slot)) {
			throw new Error(
				`上下文片段 ${segment.id} 的槽位不合法：${String(segment.slot)}`,
			);
		}
	}
}

/** 求值一个条件。未知的条件类型直接抛错，避免模板写错后静默不出现。 */
export function evaluateContextCondition(
	condition: ContextCondition,
	facts: ContextConditionFacts,
): boolean {
	switch (condition.kind) {
		case "switch": {
			if (typeof condition.name !== "string" || condition.name.length === 0) {
				throw new Error("switch 条件的 name 必须是非空字符串");
			}
			const expected = condition.equals ?? true;
			return (facts.switches[condition.name] ?? false) === expected;
		}
		case "state": {
			const value = resolveStatePath(facts.state, condition.path);
			if (condition.op === "exists") return value !== undefined;
			if (condition.op === "truthy") return isTruthyStateValue(value);
			return jsonEquals(value, condition.value);
		}
		case "all":
			return condition.conditions.every((item) =>
				evaluateContextCondition(item, facts),
			);
		case "any":
			return condition.conditions.some((item) =>
				evaluateContextCondition(item, facts),
			);
		case "not":
			return !evaluateContextCondition(condition.condition, facts);
		default:
			throw new Error(`未知的条件类型：${String(condition)}`);
	}
}

function resolveStatePath(state: unknown, path: readonly string[]): unknown {
	if (!Array.isArray(path) || path.length === 0) {
		throw new Error("state 条件的 path 必须是非空字符串数组");
	}
	let current = state;
	for (const key of path) {
		if (typeof key !== "string" || key.length === 0) {
			throw new Error("state 条件的 path 必须是非空字符串数组");
		}
		if (Array.isArray(current)) {
			const index = Number(key);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) {
				return undefined;
			}
			current = current[index];
		} else if (typeof current === "object" && current !== null) {
			if (!Object.hasOwn(current, key)) return undefined;
			current = (current as Record<string, unknown>)[key];
		} else {
			return undefined;
		}
	}
	return current;
}

function isTruthyStateValue(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
	if (typeof value === "string") return value.length > 0;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object" && value !== null) {
		return Object.keys(value).length > 0;
	}
	return false;
}

function jsonEquals(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (
		typeof left !== "object" ||
		left === null ||
		typeof right !== "object" ||
		right === null
	) {
		return false;
	}
	const leftIsArray = Array.isArray(left);
	if (leftIsArray !== Array.isArray(right)) return false;
	if (leftIsArray && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((item, index) => jsonEquals(item, right[index]))
		);
	}
	const leftObject = left as Record<string, unknown>;
	const rightObject = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftObject);
	if (leftKeys.length !== Object.keys(rightObject).length) return false;
	return leftKeys.every(
		(key) =>
			Object.hasOwn(rightObject, key) &&
			jsonEquals(leftObject[key], rightObject[key]),
	);
}

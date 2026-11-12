import { assertDeepMaxToolCalls, assertDeepTimeoutMs } from "../chat/mode.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { LlmRole } from "../llm/types.js";
import {
	DEEP_TURN_TOOLS,
	NOTE_READ_TOOL_NAME,
	NOTE_WRITE_TOOL_NAME,
} from "../tools/index.js";

/** 内置默认模板的 id；故事设置把 templateId 指向它表示不使用库里的模板。 */
export const DEFAULT_CONTEXT_TEMPLATE_ID = "dramaticer-default";

/** DESIGN §9 的 harness 槽位。 */
import { type ContextSlotName, isContextSlotName } from "./slot-names.js";
export {
	CONTEXT_SLOT_NAMES,
	type ContextSlotName,
	isContextSlotName,
} from "./slot-names.js";

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

/**
 * 模板附带的深回合配置。缺省的字段回落到故事设置与默认值；
 * 规划方式按 DESIGN §18 暂缓，这里没有计划方式字段。
 */
export interface ContextTemplateDeepTurn {
	/** 放开的工具名；缺省为注册表里的全部工具。 */
	readonly tools?: readonly string[];
	/** 工具调用总次数上限；缺省沿用故事设置。 */
	readonly maxToolCalls?: number;
	/** 运行时长上限（毫秒）；缺省沿用故事设置。 */
	readonly maxDurationMs?: number;
	/** 是否放开导演手记；默认 true。 */
	readonly notesEnabled?: boolean;
}

/** 有序的上下文模板。输出顺序始终等于这里的顺序。 */
export interface ContextTemplate {
	readonly id: string;
	readonly segments: readonly ContextSegment[];
	readonly deepTurn?: ContextTemplateDeepTurn;
}

/** 写作契约片段固定使用的 id；契约始终是模板最后一个段落。 */
export const WRITING_CONTRACT_SEGMENT_ID = "protocol";

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
		if (segment.when !== undefined) {
			assertContextCondition(segment.when, `上下文片段 ${segment.id} 的 when`);
		}
	}
	const protocolIndex = template.segments.findIndex(
		(segment) => segment.id === WRITING_CONTRACT_SEGMENT_ID,
	);
	const lastIndex = template.segments.length - 1;
	if (protocolIndex !== -1 && protocolIndex !== lastIndex) {
		throw new Error(
			`上下文模板 ${template.id} 的 protocol 写作契约片段必须是最后一个片段：当前在第 ${protocolIndex + 1} 个，后面还有 ${lastIndex - protocolIndex} 个片段`,
		);
	}
	if (template.deepTurn !== undefined) {
		assertContextTemplateDeepTurn(template.deepTurn, template.id);
	}
}

/**
 * 校验模板的深回合配置：保存、导入与运行前的模板校验都走这里，
 * 拼错的工具名与越界上限立即拒绝，运行时不静默忽略。
 */
export function assertContextTemplateDeepTurn(
	value: unknown,
	templateId: string,
): void {
	const label = `上下文模板 ${templateId} 的 deepTurn`;
	const config = assertPlainObject(value, label);
	rejectUnknownKeys(
		config,
		["tools", "maxToolCalls", "maxDurationMs", "notesEnabled"],
		label,
	);
	if (config.tools !== undefined) {
		if (!Array.isArray(config.tools)) {
			throw new Error(`${label}.tools 必须是数组`);
		}
		const seen = new Set<string>();
		for (const [index, name] of config.tools.entries()) {
			if (typeof name !== "string" || name.trim().length === 0) {
				throw new Error(`${label}.tools[${index}] 必须是非空字符串`);
			}
			if (!DEEP_TURN_TOOLS.tools.some((tool) => tool.name === name)) {
				throw new Error(`${label}.tools[${index}] 是未知工具：${name}`);
			}
			if (seen.has(name)) {
				throw new Error(`${label}.tools[${index}] 重复的工具名：${name}`);
			}
			seen.add(name);
		}
	}
	if (config.maxToolCalls !== undefined) {
		assertDeepMaxToolCalls(config.maxToolCalls, `${label}.maxToolCalls`);
	}
	if (config.maxDurationMs !== undefined) {
		assertDeepTimeoutMs(config.maxDurationMs, `${label}.maxDurationMs`);
	}
	if (
		config.notesEnabled !== undefined &&
		typeof config.notesEnabled !== "boolean"
	) {
		throw new Error(`${label}.notesEnabled 必须是布尔值`);
	}
	if (config.notesEnabled === false && Array.isArray(config.tools)) {
		const enabledNote = config.tools.find(
			(name) => name === NOTE_READ_TOOL_NAME || name === NOTE_WRITE_TOOL_NAME,
		);
		if (enabledNote !== undefined) {
			throw new Error(
				`${label}.tools 不能在 notesEnabled 为 false 时包含 ${String(enabledNote)}`,
			);
		}
	}
}

/** 校验模板里的条件；写错的条件在组装阶段才抛错，保存模板时提前拒绝。 */
export function assertContextCondition(
	condition: ContextCondition,
	label = "上下文条件",
): void {
	if (typeof condition !== "object" || condition === null) {
		throw new Error(`${label} 必须是对象`);
	}
	switch (condition.kind) {
		case "switch": {
			if (
				typeof condition.name !== "string" ||
				condition.name.trim().length === 0
			) {
				throw new Error(`${label} 的 switch.name 必须是非空字符串`);
			}
			if (
				condition.equals !== undefined &&
				typeof condition.equals !== "boolean"
			) {
				throw new Error(`${label} 的 switch.equals 必须是布尔值`);
			}
			return;
		}
		case "state": {
			if (
				!Array.isArray(condition.path) ||
				condition.path.length === 0 ||
				condition.path.some(
					(segment) =>
						typeof segment !== "string" || segment.trim().length === 0,
				)
			) {
				throw new Error(`${label} 的 state.path 必须是非空的字符串数组`);
			}
			if (
				condition.op !== "exists" &&
				condition.op !== "equals" &&
				condition.op !== "truthy"
			) {
				throw new Error(`${label} 的 state.op 必须是 exists、equals 或 truthy`);
			}
			return;
		}
		case "all":
		case "any": {
			if (!Array.isArray(condition.conditions)) {
				throw new Error(`${label} 的 ${condition.kind}.conditions 必须是数组`);
			}
			condition.conditions.forEach((item, index) => {
				assertContextCondition(item, `${label} 的第 ${index + 1} 个子条件`);
			});
			return;
		}
		case "not": {
			assertContextCondition(condition.condition, `${label} 的 not 子条件`);
			return;
		}
		default:
			throw new Error(`未知的条件类型：${String(condition)}`);
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

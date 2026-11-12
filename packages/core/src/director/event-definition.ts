import { parseContextCondition } from "../context/condition.js";
import type { ContextCondition } from "../context/template.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";

export interface DramaticerEventDefinition {
	/** 故事内唯一；事件池以它作为 `source_id`。 */
	readonly id: string;
	readonly text: string;
	readonly preconditions: ContextCondition | null;
	readonly cooldown: number;
	readonly enabled: boolean;
}

const EVENT_KEYS = ["id", "text", "preconditions", "cooldown", "enabled"];

/**
 * 解析事件定义数组。卡扩展与声明式插件共用这个入口，重复 id、空字符串与
 * 非法条件都抛错并指出 JSON 路径。
 */
export function parseDramaticerEventDefinitions(
	value: unknown,
	path: string,
): DramaticerEventDefinition[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const ids = new Set<string>();
	return value.map((item, index) => {
		const eventPath = `${path}[${index}]`;
		const event = parseEvent(item, eventPath);
		if (ids.has(event.id)) {
			throw new Error(`${eventPath}.id 重复：${event.id}`);
		}
		ids.add(event.id);
		return event;
	});
}

function parseEvent(value: unknown, path: string): DramaticerEventDefinition {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, EVENT_KEYS, path);
	const id = readNonEmptyString(object.id, `${path}.id`);
	const text = readNonEmptyString(object.text, `${path}.text`);
	const preconditions =
		object.preconditions === undefined || object.preconditions === null
			? null
			: parseContextCondition(object.preconditions, `${path}.preconditions`, {
					allowSwitch: false,
				});
	const cooldown = object.cooldown ?? 0;
	if (
		typeof cooldown !== "number" ||
		!Number.isInteger(cooldown) ||
		cooldown < 0
	) {
		throw new Error(`${path}.cooldown 必须是非负整数`);
	}
	const enabled = object.enabled ?? true;
	if (typeof enabled !== "boolean") {
		throw new Error(`${path}.enabled 必须是布尔值`);
	}
	return {
		id,
		text,
		preconditions,
		cooldown,
		enabled,
	};
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

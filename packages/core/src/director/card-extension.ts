import { parseContextCondition } from "../context/condition.js";
import type { ContextCondition } from "../context/template.js";
import { normalizeEntityName } from "../entity.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import { type DirectorArc, parseDirectorPlan } from "./plan.js";

export interface DramaticerEventDefinition {
	/** 故事内唯一；事件池以它作为 `source_id`。 */
	readonly id: string;
	readonly text: string;
	readonly preconditions: ContextCondition | null;
	readonly cooldown: number;
	readonly enabled: boolean;
}

export interface DramaticerNpcAgendaDefinition {
	/** NPC 的名称或别名，导入时解析成实体。 */
	readonly npc: string;
	readonly goal: string;
	readonly everyChapters: number;
	readonly importance: number;
}

export interface DramaticerCardExtension {
	readonly events: readonly DramaticerEventDefinition[];
	readonly npcAgendas: readonly DramaticerNpcAgendaDefinition[];
	/** 弧线、序列与节拍，字段与 `DirectorPlan` 相同。 */
	readonly arcs: readonly DirectorArc[];
}

const EMPTY_EXTENSION: DramaticerCardExtension = {
	events: [],
	npcAgendas: [],
	arcs: [],
};

const EVENT_KEYS = ["id", "text", "preconditions", "cooldown", "enabled"];
const AGENDA_KEYS = ["npc", "goal", "everyChapters", "importance"];

/**
 * 解析卡的 `extensions.dramaticer`。没有这个字段时返回空扩展；有了就必须完全合法，
 * 未知字段、类型不符、空字符串、非法条件与重复 id 都抛错。
 */
export function parseDramaticerCardExtension(
	value: unknown,
): DramaticerCardExtension {
	if (value === undefined || value === null) return EMPTY_EXTENSION;
	const root = assertPlainObject(value, "extensions.dramaticer");
	rejectUnknownKeys(
		root,
		["events", "npcAgendas", "arcs"],
		"extensions.dramaticer",
	);

	const events = parseArray(
		root.events,
		"extensions.dramaticer.events",
		(item, path) => parseEvent(item, path),
	);
	const ids = new Set<string>();
	events.forEach((event, index) => {
		if (ids.has(event.id)) {
			throw new Error(
				`extensions.dramaticer.events[${index}].id 重复：${event.id}`,
			);
		}
		ids.add(event.id);
	});
	const npcAgendas = parseArray(
		root.npcAgendas,
		"extensions.dramaticer.npcAgendas",
		(item, path) => parseAgenda(item, path),
	);
	const { arcs } = parseDirectorPlan(
		{ arcs: root.arcs ?? [] },
		"extensions.dramaticer",
	);
	return { events, npcAgendas, arcs };
}

function parseArray<T>(
	value: unknown,
	path: string,
	parseItem: (item: unknown, path: string) => T,
): T[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	return value.map((item, index) => parseItem(item, `${path}[${index}]`));
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

function parseAgenda(
	value: unknown,
	path: string,
): DramaticerNpcAgendaDefinition {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, AGENDA_KEYS, path);
	const npc = readNonEmptyString(object.npc, `${path}.npc`);
	if (normalizeEntityName(npc).length === 0) {
		throw new Error(`${path}.npc 去掉标点与空白后为空`);
	}
	const goal = readNonEmptyString(object.goal, `${path}.goal`);
	const everyChapters = object.everyChapters ?? 1;
	if (
		typeof everyChapters !== "number" ||
		!Number.isInteger(everyChapters) ||
		everyChapters < 1
	) {
		throw new Error(`${path}.everyChapters 必须是正整数`);
	}
	const importance = object.importance ?? 0.5;
	if (
		typeof importance !== "number" ||
		!Number.isFinite(importance) ||
		importance < 0 ||
		importance > 1
	) {
		throw new Error(`${path}.importance 必须是 0 到 1 之间的数字`);
	}
	return {
		npc,
		goal,
		everyChapters: everyChapters as number,
		importance,
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

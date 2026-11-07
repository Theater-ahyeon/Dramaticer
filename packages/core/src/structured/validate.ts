import { type JsonValue, isJsonObject } from "../json.js";
import type { StateDiffOp } from "../timeline.js";
import type {
	AcceptedPlotNote,
	AcceptedStateUpdate,
	StructuredPayloadName,
	StructuredPayloadValidation,
} from "./types.js";

const STATE_UPDATE_FIELDS: Record<string, true> = {
	path: true,
	op: true,
	value: true,
	reason: true,
};

const PLOT_NOTE_FIELDS: Record<string, true> = { text: true };

/**
 * 应用状态变更时会把路径逐级写进普通对象，这几个名字会污染原型链。
 */
const RESERVED_PATH_SEGMENTS: readonly string[] = [
	"__proto__",
	"constructor",
	"prototype",
];

/** 两种传输方式共用的校验器：函数调用的参数对象与文本标签里的 JSON 都走这里。 */
export function validateStructuredPayload(
	name: StructuredPayloadName,
	value: unknown,
): StructuredPayloadValidation {
	if (!isJsonObject(value)) {
		return { ok: false, reason: `${name} 必须是 JSON 对象` };
	}
	return name === "state_update"
		? validateStateUpdate(value)
		: validatePlotNote(value);
}

function unknownFieldProblems(
	input: Record<string, JsonValue>,
	allowed: Record<string, true>,
): string[] {
	return Object.keys(input)
		.filter((key) => !Object.hasOwn(allowed, key))
		.map((key) => `未知字段 ${key}`);
}

function validateStateUpdate(
	input: Record<string, JsonValue>,
): StructuredPayloadValidation {
	const problems = unknownFieldProblems(input, STATE_UPDATE_FIELDS);
	const path = readPath(input.path, problems);
	const op = readOp(input.op, problems);

	let value: unknown = null;
	if (op === "set") {
		if (!Object.hasOwn(input, "value")) {
			problems.push("op 为 set 时必须有 value");
		} else {
			value = input.value;
		}
	} else if (op === "delete" && Object.hasOwn(input, "value")) {
		problems.push("op 为 delete 时不能带 value");
	}

	const reason = readReason(input.reason, problems);

	if (problems.length > 0 || path === null || op === null) {
		return { ok: false, reason: problems.join("；") };
	}
	const update: AcceptedStateUpdate = { path, op, value, reason };
	return { ok: true, payload: { name: "state_update", value: update } };
}

function validatePlotNote(
	input: Record<string, JsonValue>,
): StructuredPayloadValidation {
	const problems = unknownFieldProblems(input, PLOT_NOTE_FIELDS);
	let text = "";
	if (typeof input.text !== "string") {
		problems.push("text 必须是字符串");
	} else {
		text = input.text.trim();
		if (text.length === 0) problems.push("text 不能为空");
	}
	if (problems.length > 0) {
		return { ok: false, reason: problems.join("；") };
	}
	const note: AcceptedPlotNote = { text };
	return { ok: true, payload: { name: "plot_note", value: note } };
}

function readPath(
	input: JsonValue | undefined,
	problems: string[],
): readonly string[] | null {
	if (input === undefined) {
		problems.push("path 不能为空");
		return null;
	}
	if (!Array.isArray(input)) {
		problems.push("path 必须是字符串数组");
		return null;
	}
	if (input.length === 0) {
		problems.push("path 不能为空");
		return null;
	}
	let ok = true;
	const segments: string[] = [];
	for (const [index, item] of input.entries()) {
		if (typeof item !== "string") {
			problems.push(`path[${index}] 必须是字符串`);
			ok = false;
			continue;
		}
		const segment = item.trim();
		if (segment.length === 0) {
			problems.push(`path[${index}] 不能为空`);
			ok = false;
			continue;
		}
		if (RESERVED_PATH_SEGMENTS.includes(segment)) {
			problems.push(`path[${index}] 不能使用保留名 ${segment}`);
			ok = false;
			continue;
		}
		segments.push(segment);
	}
	return ok ? segments : null;
}

function readOp(
	input: JsonValue | undefined,
	problems: string[],
): StateDiffOp | null {
	if (input === "set" || input === "delete") return input;
	problems.push(`op 必须是 set 或 delete，收到 ${describe(input)}`);
	return null;
}

function readReason(
	input: JsonValue | undefined,
	problems: string[],
): string | null {
	if (input === undefined || input === null) return null;
	if (typeof input !== "string") {
		problems.push("reason 必须是字符串或 null");
		return null;
	}
	const text = input.trim();
	return text.length === 0 ? null : text;
}

function describe(value: unknown): string {
	if (value === undefined) return "缺失";
	if (typeof value === "string") return `"${value}"`;
	if (typeof value === "object" && value !== null) {
		return Array.isArray(value) ? "数组" : "对象";
	}
	return String(value);
}

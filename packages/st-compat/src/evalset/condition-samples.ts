import { readFile } from "node:fs/promises";
import {
	type DirectorBit,
	type JsonObject,
	assertJsonValue,
	assertPlainObject,
	isJsonObject,
	parseDirectorBitDefinitions,
	rejectUnknownKeys,
} from "@dramaticer/core";

/** 条件判断样本里的一层原文；楼层顺序就是路径顺序。 */
export interface DirectorConditionFloor {
	readonly role: "user" | "assistant";
	readonly raw: string;
}

/**
 * 固定条件样本：一条小品条件、它看到的楼层与台账状态，以及人工标注的期望结果。
 * 期望结果不是模型输出，准确率的分母就是样本总数。
 */
export interface DirectorConditionSample {
	readonly id: string;
	readonly bit: DirectorBit;
	readonly floors: readonly DirectorConditionFloor[];
	readonly state: JsonObject;
	readonly expected: boolean;
}

const SAMPLE_KEYS = ["id", "bit", "floors", "state", "expected"];
const FLOOR_KEYS = ["role", "raw"];

/** 严格解析条件样本文件；未知字段、重复 id 与非法楼层都在这里拒绝。 */
export function parseDirectorConditionSamples(
	value: unknown,
	path: string,
): DirectorConditionSample[] {
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const ids = new Set<string>();
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const object = assertPlainObject(item, itemPath);
		rejectUnknownKeys(object, SAMPLE_KEYS, itemPath);
		if (typeof object.id !== "string" || object.id.trim().length === 0) {
			throw new Error(`${itemPath}.id 必须是非空字符串`);
		}
		const id = object.id.trim();
		if (ids.has(id)) {
			throw new Error(`${itemPath}.id 重复：${id}`);
		}
		ids.add(id);
		const bits = parseDirectorBitDefinitions([object.bit], `${itemPath}.bit`);
		const bit = bits[0];
		if (bit === undefined) {
			throw new Error(`${itemPath}.bit 解析后为空`);
		}
		const floors = parseFloors(object.floors, `${itemPath}.floors`);
		let state: JsonObject = {};
		if (object.state !== undefined) {
			assertJsonValue(object.state, `${itemPath}.state`);
			state = assertPlainObject(
				object.state,
				`${itemPath}.state`,
			) as JsonObject;
		}
		if (typeof object.expected !== "boolean") {
			throw new Error(`${itemPath}.expected 必须是布尔值`);
		}
		return { id, bit, floors, state, expected: object.expected };
	});
}

function parseFloors(
	value: unknown,
	path: string,
): readonly DirectorConditionFloor[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${path} 必须是非空数组`);
	}
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const object = assertPlainObject(item, itemPath);
		rejectUnknownKeys(object, FLOOR_KEYS, itemPath);
		if (object.role !== "user" && object.role !== "assistant") {
			throw new Error(`${itemPath}.role 必须是 user 或 assistant`);
		}
		if (typeof object.raw !== "string" || object.raw.trim().length === 0) {
			throw new Error(`${itemPath}.raw 必须是非空字符串`);
		}
		return { role: object.role, raw: object.raw };
	});
}

export async function readDirectorConditionSampleFile(
	filePath: string,
): Promise<DirectorConditionSample[]> {
	const raw = await readFile(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`${filePath} 不是合法的 JSON`);
	}
	return parseDirectorConditionSamples(parsed, filePath);
}

/** 把样本里的台账状态展开成楼层 diff；对象递归、叶子写成 set。 */
export function flattenConditionState(
	value: unknown,
	prefix: readonly string[],
	out: { readonly path: string[]; readonly value: unknown }[],
): void {
	if (isJsonObject(value)) {
		for (const [key, child] of Object.entries(value)) {
			flattenConditionState(child, [...prefix, key], out);
		}
		return;
	}
	out.push({ path: [...prefix], value });
}

import {
	type JsonObject,
	type JsonValue,
	isJsonObject,
} from "@dramaticer/core";
import {
	MVU_UNSAFE_KEYS,
	type MvuObjectSchemaNode,
	type MvuRootOptions,
	type MvuSchemaNode,
	type MvuState,
	buildMvuNode,
	cloneMvuSchema,
	isMvuValueWithDescription,
	validateMvuSchemaValue,
} from "./schema.js";

export const MVU_PATCH_OPS = [
	"replace",
	"delta",
	"insert",
	"add",
	"remove",
	"move",
] as const;

export type MvuPatchOp = (typeof MVU_PATCH_OPS)[number];

export interface MvuPatchOperation {
	readonly op: MvuPatchOp;
	readonly path: string;
	readonly from?: string;
	readonly value?: JsonValue;
}

export interface MvuParsedUpdate {
	readonly analysis: string | null;
	readonly operations: readonly MvuPatchOperation[];
	readonly issues: readonly string[];
}

export interface MvuPatchRejection {
	readonly index: number;
	readonly operation: MvuPatchOperation;
	readonly reason: string;
}

export interface MvuPatchResult extends MvuState {
	readonly applied: number;
	readonly rejected: readonly MvuPatchRejection[];
}

/** 从消息里取出所有 `<UpdateVariable>` 块里的 JSONPatch。 */
export function parseMvuUpdate(text: string): MvuParsedUpdate {
	const blocks = [
		...text.matchAll(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi),
	];
	if (blocks.length === 0) {
		return {
			analysis: null,
			operations: [],
			issues: ["没有找到 <UpdateVariable> 块"],
		};
	}
	const first = blocks[0]?.[1] ?? "";
	const analysis = readAnalysis(first);
	const operations: MvuPatchOperation[] = [];
	const issues: string[] = [];
	for (const [blockIndex, block] of blocks.entries()) {
		const label = `第 ${blockIndex + 1} 个 <UpdateVariable>`;
		const patches = [
			...(block[1] ?? "").matchAll(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/gi),
		];
		if (patches.length === 0) {
			issues.push(`${label} 缺少 <JSONPatch> 段`);
			continue;
		}
		for (const [patchIndex, patch] of patches.entries()) {
			issues.push(
				...readPatchOperations(
					patch[1] ?? "",
					`${label} 第 ${patchIndex + 1} 个 <JSONPatch>`,
					operations,
				),
			);
		}
	}
	return { analysis, operations, issues };
}

function readAnalysis(block: string): string | null {
	const match = /<Analysis>([\s\S]*?)<\/Analysis>/i.exec(block);
	const content = match?.[1]?.trim() ?? "";
	return content.length > 0 ? content : null;
}

function readPatchOperations(
	content: string,
	label: string,
	operations: MvuPatchOperation[],
): string[] {
	const issues: string[] = [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripCodeFence(content));
	} catch (error) {
		return [
			`${label} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
		];
	}
	if (!Array.isArray(parsed)) {
		return [`${label} 必须是操作数组`];
	}
	for (const [index, item] of parsed.entries()) {
		const itemLabel = `${label} 第 ${index + 1} 条操作`;
		if (!isJsonObject(item)) {
			issues.push(`${itemLabel} 必须是对象`);
			continue;
		}
		const op = item.op;
		if (typeof op !== "string" || !isMvuPatchOp(op)) {
			issues.push(`${itemLabel} 的操作 ${String(op)} 不受支持`);
			continue;
		}
		const path = item.path;
		if (typeof path !== "string" || !path.startsWith("/")) {
			issues.push(`${itemLabel} 的 path 必须是以 / 开头的字符串`);
			continue;
		}
		if (op === "move") {
			const from = item.from;
			if (typeof from !== "string" || !from.startsWith("/")) {
				issues.push(`${itemLabel} 的 from 必须是以 / 开头的字符串`);
				continue;
			}
			operations.push({ op, path, from });
			continue;
		}
		if (op !== "remove" && !Object.hasOwn(item, "value")) {
			issues.push(`${itemLabel} 缺少 value`);
			continue;
		}
		operations.push(
			Object.hasOwn(item, "value")
				? { op, path, value: item.value as JsonValue }
				: { op, path },
		);
	}
	return issues;
}

function isMvuPatchOp(value: string): value is MvuPatchOp {
	return (MVU_PATCH_OPS as readonly string[]).includes(value);
}

function stripCodeFence(content: string): string {
	const trimmed = content.trim();
	const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/.exec(trimmed);
	return fenced?.[1]?.trim() ?? trimmed;
}

/**
 * 按顺序执行补丁。每条操作先复制状态，执行并在副本上校验结构；
 * 失败只拒绝这一条，前面的结果保留。
 */
export function applyMvuPatch(
	state: MvuState,
	operations: readonly MvuPatchOperation[],
): MvuPatchResult {
	let data = cloneJson(state.data) as JsonObject;
	let schema = cloneMvuSchema(state.schema);
	const rejected: MvuPatchRejection[] = [];
	let applied = 0;
	for (const [index, operation] of operations.entries()) {
		const nextData = cloneJson(data) as JsonObject;
		const nextSchema = cloneMvuSchema(schema);
		try {
			applyOperation(nextData, nextSchema, state.options, operation);
			const issues = validateMvuSchemaValue(nextSchema, nextData);
			if (issues.length > 0) {
				throw new Error(issues.join("；"));
			}
			data = nextData;
			schema = nextSchema;
			applied += 1;
		} catch (error) {
			rejected.push({
				index,
				operation,
				reason: `${operation.path}: ${errorMessage(error)}`,
			});
		}
	}
	return {
		data,
		schema,
		options: state.options,
		applied,
		rejected,
	};
}

function applyOperation(
	data: JsonObject,
	schema: MvuObjectSchemaNode,
	options: MvuRootOptions,
	operation: MvuPatchOperation,
): void {
	if (operation.op === "move") {
		if (operation.from === undefined) {
			throw new Error("move 缺少 from");
		}
		applyMove(data, schema, options, operation.from, operation.path);
		return;
	}
	const segments = parsePointer(operation.path);
	if (segments.length === 0) {
		throw new Error("不支持根路径操作");
	}
	switch (operation.op) {
		case "replace":
			applyReplace(
				data,
				schema,
				options,
				segments,
				requireValue(operation, "replace"),
			);
			return;
		case "delta":
			applyDelta(data, operation.value, segments);
			return;
		case "insert":
		case "add":
			applyInsert(
				data,
				schema,
				options,
				segments,
				requireValue(operation, operation.op),
			);
			return;
		case "remove":
			applyRemove(data, schema, segments);
			return;
		default:
			throw new Error(`未知操作 ${String(operation.op)}`);
	}
}

function requireValue(operation: MvuPatchOperation, label: string): JsonValue {
	if (!Object.hasOwn(operation, "value")) {
		throw new Error(`${label} 缺少 value`);
	}
	return operation.value as JsonValue;
}

function applyReplace(
	data: JsonObject,
	schema: MvuObjectSchemaNode,
	options: MvuRootOptions,
	segments: readonly string[],
	value: JsonValue,
): void {
	const { parent, key } = resolveParent(data, segments);
	const target = readChild(parent, key);
	const targetSchema = schemaForPath(schema, segments);
	const next = prepareReplacement(target, targetSchema, value, options, key);
	writeChild(parent, key, next);
	updateSchemaAtPath(schema, segments, next);
}

function prepareReplacement(
	target: JsonValue,
	targetSchema: MvuSchemaNode | null,
	value: JsonValue,
	options: MvuRootOptions,
	label: string,
): JsonValue {
	if (isMvuValueWithDescription(target)) {
		const valueSchema =
			targetSchema?.type === "array" ? targetSchema.elementType : targetSchema;
		const coerced = coerceValue(valueSchema, value, label);
		return options.strictSet ? coerced : [coerced, target[1]];
	}
	return coerceValue(targetSchema, value, label);
}

function applyDelta(
	data: JsonObject,
	value: JsonValue | undefined,
	segments: readonly string[],
): void {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error("delta 的 value 必须是数字");
	}
	const { parent, key } = resolveParent(data, segments);
	const target = readChild(parent, key);
	if (isMvuValueWithDescription(target)) {
		if (typeof target[0] !== "number") {
			throw new Error("delta 只能用于数字");
		}
		writeChild(parent, key, [target[0] + value, target[1]]);
		return;
	}
	if (typeof target !== "number") {
		throw new Error("delta 只能用于数字");
	}
	writeChild(parent, key, target + value);
}

function applyInsert(
	data: JsonObject,
	schema: MvuObjectSchemaNode,
	options: MvuRootOptions,
	segments: readonly string[],
	value: JsonValue,
): void {
	const { parent, key } = resolveParent(data, segments);
	if (isMvuValueWithDescription(parent)) {
		throw new Error("对 [值, 说明] 做结构操作必须显式定位到下标");
	}
	const parentSchema = schemaForPath(schema, segments.slice(0, -1));
	if (parentSchema === null) {
		throw new Error("找不到上级的变量结构");
	}
	if (Array.isArray(parent)) {
		insertIntoArray(parent, parentSchema, options, key, value);
		return;
	}
	if (isJsonObject(parent)) {
		insertIntoObject(parent, parentSchema, options, key, value);
		return;
	}
	throw new Error(`路径段 ${key} 的上级不是对象或数组`);
}

function insertIntoArray(
	parent: JsonValue[],
	parentSchema: MvuSchemaNode,
	options: MvuRootOptions,
	key: string,
	value: JsonValue,
): void {
	if (parentSchema.type !== "array") {
		throw new Error("上级结构不是数组");
	}
	if (!parentSchema.extensible) {
		throw new Error("数组结构已锁定，不能增删元素");
	}
	const templated = applyTemplate(parentSchema.template, value, options);
	const built = buildMvuNode(templated, false);
	if (parentSchema.elementType.type !== "any") {
		const issues = validateMvuSchemaValue(parentSchema.elementType, built.data);
		if (issues.length > 0) {
			throw new Error(issues.join("；"));
		}
	}
	if (key === "-") {
		parent.push(built.data);
		return;
	}
	const index = parseArrayIndex(key, parent.length, true);
	parent.splice(index, 0, built.data);
}

function insertIntoObject(
	parent: JsonObject,
	parentSchema: MvuSchemaNode,
	options: MvuRootOptions,
	key: string,
	value: JsonValue,
): void {
	if (parentSchema.type !== "object") {
		throw new Error("上级结构不是对象");
	}
	const exists = Object.hasOwn(parent, key);
	if (!exists && !parentSchema.extensible) {
		throw new Error(`对象结构已锁定，不能新增键 ${key}`);
	}
	const templated = applyTemplate(parentSchema.template, value, options);
	const built = buildMvuNode(templated, false);
	const previous = parentSchema.properties[key];
	built.schema.required = previous?.required ?? false;
	parent[key] = built.data;
	parentSchema.properties[key] = built.schema;
}

function applyRemove(
	data: JsonObject,
	schema: MvuObjectSchemaNode,
	segments: readonly string[],
): void {
	const { parent, key } = resolveParent(data, segments);
	if (isMvuValueWithDescription(parent)) {
		throw new Error("对 [值, 说明] 做结构操作必须显式定位到下标");
	}
	const parentSchema = schemaForPath(schema, segments.slice(0, -1));
	if (parentSchema === null) {
		throw new Error("找不到上级的变量结构");
	}
	if (Array.isArray(parent)) {
		if (parentSchema.type !== "array") {
			throw new Error("上级结构不是数组");
		}
		if (!parentSchema.extensible) {
			throw new Error("数组结构已锁定，不能增删元素");
		}
		const index = parseArrayIndex(key, parent.length, false);
		parent.splice(index, 1);
		return;
	}
	if (isJsonObject(parent)) {
		if (parentSchema.type !== "object") {
			throw new Error("上级结构不是对象");
		}
		if (!Object.hasOwn(parent, key)) {
			throw new Error(`路径段 ${key} 不存在`);
		}
		if (!parentSchema.extensible) {
			throw new Error(`对象结构已锁定，不能删除键 ${key}`);
		}
		if (parentSchema.properties[key]?.required === true) {
			throw new Error(`键 ${key} 是必填项`);
		}
		delete parent[key];
		delete parentSchema.properties[key];
		return;
	}
	throw new Error(`路径段 ${key} 的上级不是对象或数组`);
}

function applyMove(
	data: JsonObject,
	schema: MvuObjectSchemaNode,
	options: MvuRootOptions,
	from: string,
	to: string,
): void {
	const source = parsePointer(from);
	const target = parsePointer(to);
	if (source.length === 0 || target.length === 0) {
		throw new Error("move 不支持根路径");
	}
	if (isPathPrefix(source, target)) {
		throw new Error("move 的目标不能在源路径之下");
	}
	const { parent, key } = resolveParent(data, source);
	const value = cloneJson(readChild(parent, key));
	applyRemove(data, schema, source);
	applyInsert(data, schema, options, target, value);
}

function isPathPrefix(
	prefix: readonly string[],
	value: readonly string[],
): boolean {
	if (prefix.length >= value.length) return false;
	return prefix.every((segment, index) => segment === value[index]);
}

function updateSchemaAtPath(
	schema: MvuObjectSchemaNode,
	segments: readonly string[],
	value: JsonValue,
): void {
	const previous = schemaForPath(schema, segments);
	const built = buildMvuNode(value, false);
	built.schema.required = previous?.required;
	setSchemaAtPath(schema, segments, 0, built.schema);
}

function setSchemaAtPath(
	node: MvuSchemaNode,
	segments: readonly string[],
	index: number,
	next: MvuSchemaNode,
): void {
	if (index >= segments.length) return;
	const segment = segments[index] as string;
	const last = index === segments.length - 1;
	if (node.type === "object") {
		if (last) {
			node.properties[segment] = next;
			return;
		}
		const child = node.properties[segment];
		if (child === undefined) {
			throw new Error(`找不到路径段 ${segment} 的变量结构`);
		}
		setSchemaAtPath(child, segments, index + 1, next);
		return;
	}
	if (node.type === "array") {
		if (last) {
			node.elementType = next;
			return;
		}
		setSchemaAtPath(node.elementType, segments, index + 1, next);
		return;
	}
	throw new Error(`路径段 ${segment} 的上级没有子结构`);
}

function schemaForPath(
	schema: MvuObjectSchemaNode,
	segments: readonly string[],
): MvuSchemaNode | null {
	let node: MvuSchemaNode = schema;
	for (const segment of segments) {
		if (node.type === "object") {
			const child: MvuSchemaNode | undefined = node.properties[segment];
			if (child === undefined) return null;
			node = child;
			continue;
		}
		if (node.type === "array") {
			node = node.elementType;
			continue;
		}
		return null;
	}
	return node;
}

function resolveParent(
	root: JsonObject,
	segments: readonly string[],
): { parent: JsonValue; key: string } {
	let current: JsonValue = root;
	for (const segment of segments.slice(0, -1)) {
		current = readChild(current, segment);
	}
	const key = segments.at(-1);
	if (key === undefined) {
		throw new Error("路径不能为空");
	}
	return { parent: current, key };
}

function readChild(container: JsonValue, key: string): JsonValue {
	if (Array.isArray(container)) {
		const index = parseArrayIndex(key, container.length, false);
		return container[index] as JsonValue;
	}
	if (isJsonObject(container)) {
		if (!Object.hasOwn(container, key)) {
			throw new Error(`路径段 ${key} 不存在`);
		}
		return container[key] as JsonValue;
	}
	throw new Error(`路径段 ${key} 的上级不是对象或数组`);
}

function writeChild(parent: JsonValue, key: string, value: JsonValue): void {
	if (Array.isArray(parent)) {
		parent[parseArrayIndex(key, parent.length, false)] = value;
		return;
	}
	if (isJsonObject(parent)) {
		parent[key] = value;
		return;
	}
	throw new Error("写入目标不是对象或数组");
}

function parseArrayIndex(
	key: string,
	length: number,
	allowEnd: boolean,
): number {
	if (!/^\d+$/.test(key)) {
		throw new Error(`数组下标 ${key} 必须是数字`);
	}
	const index = Number(key);
	if (
		!Number.isSafeInteger(index) ||
		(allowEnd ? index > length : index >= length)
	) {
		throw new Error(`数组下标 ${key} 越界`);
	}
	return index;
}

function parsePointer(pointer: string): string[] {
	if (!pointer.startsWith("/")) {
		throw new Error(`路径 ${JSON.stringify(pointer)} 必须以 / 开头`);
	}
	const segments = pointer
		.slice(1)
		.split("/")
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
	for (const segment of segments) {
		if (MVU_UNSAFE_KEYS.includes(segment)) {
			throw new Error(`路径不能使用键 ${segment}`);
		}
	}
	return segments;
}

function applyTemplate(
	template: JsonValue | undefined,
	value: JsonValue,
	options: MvuRootOptions,
): JsonValue {
	if (template === undefined) return value;
	if (Array.isArray(template)) {
		const templateArray = template.map(cloneJson);
		if (Array.isArray(value)) {
			if (options.concatTemplateArray) {
				return [...value.map(cloneJson), ...templateArray];
			}
			const length = Math.max(value.length, templateArray.length);
			return Array.from({ length }, (_, index) =>
				index < value.length
					? cloneJson(value[index] as JsonValue)
					: cloneJson(templateArray[index] as JsonValue),
			);
		}
		if (isJsonObject(value) || value === null) return value;
		return options.strictTemplate
			? value
			: [cloneJson(value), ...templateArray];
	}
	if (isJsonObject(template) && isJsonObject(value)) {
		return deepMerge(template, value);
	}
	return value;
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
	const merged = cloneJson(base) as JsonObject;
	for (const [key, value] of Object.entries(override)) {
		if (MVU_UNSAFE_KEYS.includes(key)) {
			throw new Error(`模板不能使用键 ${key}`);
		}
		const previous = merged[key];
		merged[key] =
			isJsonObject(previous) && isJsonObject(value)
				? deepMerge(previous, value)
				: cloneJson(value);
	}
	return merged;
}

function coerceValue(
	schema: MvuSchemaNode | null,
	value: JsonValue,
	label: string,
): JsonValue {
	if (schema === null || schema.type === "any") return value;
	switch (schema.type) {
		case "number":
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value === "string" && value.trim().length > 0) {
				const parsed = Number(value);
				if (Number.isFinite(parsed)) return parsed;
			}
			throw new Error(`${label} 必须是 number`);
		case "boolean":
			if (typeof value === "boolean") return value;
			if (value === "true") return true;
			if (value === "false") return false;
			throw new Error(`${label} 必须是 boolean`);
		case "string":
			if (typeof value === "string") return value;
			throw new Error(`${label} 必须是 string`);
		case "object":
			if (isJsonObject(value)) return value;
			throw new Error(`${label} 必须是 object`);
		case "array":
			if (Array.isArray(value)) return value;
			throw new Error(`${label} 必须是 array`);
	}
}

function cloneJson(value: JsonValue): JsonValue {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(cloneJson);
	const cloned: JsonObject = {};
	for (const [key, child] of Object.entries(value)) {
		cloned[key] = cloneJson(child);
	}
	return cloned;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

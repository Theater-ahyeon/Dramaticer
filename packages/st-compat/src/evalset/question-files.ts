import { readFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "@dramaticer/core";

export type QuestionKind = "state" | "event";

/** 检索评测只需要题目和证据，状态题、事件题共用这一份结构。 */
export interface RetrievalQuestion {
	readonly id: string;
	readonly story: string;
	readonly askAtNode: string;
	readonly question: string;
	readonly answer: string;
	readonly evidenceNodes: readonly string[];
	readonly kind: QuestionKind;
	/** 状态题的完整状态路径；事件题没有这个字段 */
	readonly path?: readonly string[];
}

export function sanitizeFileName(value: string): string {
	return value.replace(/[\\/:*?"<>|]/g, "_");
}

export function storyIdOf(file: {
	readonly character?: string;
	readonly target: string;
}): string {
	return file.character ?? path.basename(file.target).replace(/\.jsonl$/i, "");
}

export async function readQuestionFile(
	filePath: string,
	kind: QuestionKind,
): Promise<RetrievalQuestion[]> {
	const text = await readFile(filePath, "utf8");
	const questions: RetrievalQuestion[] = [];
	const firstLineById = new Map<string, number>();
	const lines = text.split(/\r?\n/);
	lines.forEach((line, index) => {
		if (line.trim() === "") return;
		const lineNumber = index + 1;
		const label = `${filePath}:${lineNumber}`;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`${label} 不是合法的 JSON`);
		}
		const question = parseQuestion(value, label, kind);
		const firstLine = firstLineById.get(question.id);
		if (firstLine !== undefined) {
			throw new Error(
				`${label} 的 id ${question.id} 与 ${filePath}:${firstLine} 重复`,
			);
		}
		firstLineById.set(question.id, lineNumber);
		questions.push(question);
	});
	return questions;
}

/**
 * 按题目 id 的哈希抽取固定数量的题目，顺序保持输入顺序。
 * 同一份题目连续运行会得到相同的样本，便于复现人工抽查结果。
 */
export function sampleDeterministic<T extends { readonly id: string }>(
	items: readonly T[],
	count: number,
): T[] {
	if (count <= 0) return [];
	if (count >= items.length) return [...items];
	const ranked = items
		.map((item, index) => ({
			item,
			index,
			hash: hashQuestionId(item.id),
		}))
		.sort((left, right) => {
			if (left.hash !== right.hash) return left.hash - right.hash;
			const byId = left.item.id.localeCompare(right.item.id);
			return byId !== 0 ? byId : left.index - right.index;
		});
	const chosen = new Set(ranked.slice(0, count).map((entry) => entry.index));
	return items.filter((_, index) => chosen.has(index));
}

function hashQuestionId(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

function parseQuestion(
	value: unknown,
	label: string,
	kind: QuestionKind,
): RetrievalQuestion {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const declaredKind = requireString(value.kind, `${label} 的 kind`);
	if (declaredKind !== kind) {
		throw new Error(`${label} 的 kind 是 ${declaredKind}，期望 ${kind}`);
	}
	if (!Array.isArray(value.evidenceNodes) || value.evidenceNodes.length === 0) {
		throw new Error(`${label} 的 evidenceNodes 必须是非空数组`);
	}
	const path =
		kind === "state" ? readPath(value.path, `${label} 的 path`) : undefined;
	return {
		id: requireString(value.id, `${label} 的 id`),
		story: requireString(value.story, `${label} 的 story`),
		askAtNode: requireString(value.askAtNode, `${label} 的 askAtNode`),
		question: requireString(value.question, `${label} 的 question`),
		answer: readAnswer(value.answer, `${label} 的 answer`),
		evidenceNodes: value.evidenceNodes.map((node, index) =>
			requireString(node, `${label} 的 evidenceNodes[${index}]`),
		),
		kind,
		...(path === undefined ? {} : { path }),
	};
}

function readPath(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是非空数组`);
	}
	return value.map((part, index) => requireString(part, `${label}[${index}]`));
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

/** 状态题的答案可能是数字或布尔值，统一转成文本供比较。 */
function readAnswer(value: unknown, label: string): string {
	if (typeof value === "string") {
		if (value.length === 0) throw new Error(`${label} 必须是非空字符串`);
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	throw new Error(`${label} 必须是字符串、数字或布尔值`);
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../json.js";

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
	const lines = text.split(/\r?\n/);
	lines.forEach((line, index) => {
		if (line.trim() === "") return;
		const label = `${filePath}:${index + 1}`;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`${label} 不是合法的 JSON`);
		}
		questions.push(parseQuestion(value, label, kind));
	});
	return questions;
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
	};
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

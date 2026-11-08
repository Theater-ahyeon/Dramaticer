import { readFile } from "node:fs/promises";
import { isJsonObject } from "@dramaticer/core";

/** LongMemEval 的五类记忆题；编造回忆题是拒答题里的一个子集，用 `fabricated` 标注。 */
export type MemoryQuestionCategory =
	| "extraction"
	| "cross_segment"
	| "temporal"
	| "update"
	| "abstention";

export const MEMORY_QUESTION_CATEGORIES: readonly MemoryQuestionCategory[] = [
	"extraction",
	"cross_segment",
	"temporal",
	"update",
	"abstention",
];

export interface MemoryQuestion {
	readonly id: string;
	readonly story: string;
	/** 题目在哪个楼层被提问；上下文在该楼层组装。 */
	readonly askAtNode: string;
	readonly question: string;
	/** 参考答案。拒答与编造题的答案写成明确的否认或“没有记录”。 */
	readonly answer: string;
	readonly evidenceNodes: readonly string[];
	readonly category: MemoryQuestionCategory;
	/** 问题问的是从未发生的人、事、物；肯定描述即计为编造。 */
	readonly fabricated: boolean;
}

const ALLOWED_KEYS = [
	"id",
	"story",
	"askAtNode",
	"question",
	"answer",
	"evidenceNodes",
	"category",
	"kind",
	"fabricated",
] as const;

const CATEGORY_LABELS: Readonly<Record<MemoryQuestionCategory, string>> = {
	extraction: "信息抽取",
	cross_segment: "跨段推理",
	temporal: "时间推理",
	update: "知识更新",
	abstention: "拒答",
};

export function memoryQuestionCategoryLabel(
	category: MemoryQuestionCategory,
): string {
	return CATEGORY_LABELS[category];
}

/** 记忆题文件名与状态题、事件题保持同一套命名。 */
export function memoryQuestionFileName(story: string): string {
	const safe = story.replace(/[\\/:*?"<>|]/g, "_");
	return `memory-${safe}.jsonl`;
}

export async function readMemoryQuestionFile(
	filePath: string,
): Promise<MemoryQuestion[]> {
	const text = await readFile(filePath, "utf8");
	const questions: MemoryQuestion[] = [];
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
		const question = parseMemoryQuestion(value, label);
		const firstLine = firstLineById.get(question.id);
		if (firstLine !== undefined) {
			throw new Error(
				`${label} 的 id ${question.id} 与 ${filePath}:${firstLine} 重复`,
			);
		}
		firstLineById.set(question.id, lineNumber);
		questions.push(question);
	});
	if (questions.length === 0) {
		throw new Error(`${filePath} 没有任何记忆题`);
	}
	return questions;
}

export function parseMemoryQuestion(
	value: unknown,
	label: string,
): MemoryQuestion {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	for (const key of Object.keys(value)) {
		if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
			throw new Error(`${label} 有未知字段 ${key}`);
		}
	}
	const kind = requireString(value.kind, `${label} 的 kind`);
	if (kind !== "memory") {
		throw new Error(`${label} 的 kind 是 ${kind}，期望 memory`);
	}
	const category = requireString(value.category, `${label} 的 category`);
	if (!isMemoryQuestionCategory(category)) {
		throw new Error(
			`${label} 的 category 是 ${category}，只允许 ${MEMORY_QUESTION_CATEGORIES.join("、")}`,
		);
	}
	if (!Array.isArray(value.evidenceNodes) || value.evidenceNodes.length === 0) {
		throw new Error(`${label} 的 evidenceNodes 必须是非空数组`);
	}
	const evidenceNodes = value.evidenceNodes.map((node, index) =>
		requireString(node, `${label} 的 evidenceNodes[${index}]`),
	);
	const duplicated = evidenceNodes.find(
		(node, index) => evidenceNodes.indexOf(node) !== index,
	);
	if (duplicated !== undefined) {
		throw new Error(`${label} 的 evidenceNodes 重复了楼层 ${duplicated}`);
	}
	const fabricated = value.fabricated;
	if (fabricated !== undefined && typeof fabricated !== "boolean") {
		throw new Error(`${label} 的 fabricated 必须是布尔值`);
	}
	return {
		id: requireString(value.id, `${label} 的 id`),
		story: requireString(value.story, `${label} 的 story`),
		askAtNode: requireString(value.askAtNode, `${label} 的 askAtNode`),
		question: requireString(value.question, `${label} 的 question`),
		answer: requireString(value.answer, `${label} 的 answer`),
		evidenceNodes,
		category,
		fabricated: fabricated === true,
	};
}

export function isMemoryQuestionCategory(
	value: string,
): value is MemoryQuestionCategory {
	return (MEMORY_QUESTION_CATEGORIES as readonly string[]).includes(value);
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

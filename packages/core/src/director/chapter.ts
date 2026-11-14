import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import {
	type DirectorLineDiff,
	type DirectorLineRecord,
	type DirectorLineState,
	MAX_DIRECTOR_LINE_ID_CHARS,
} from "./lines.js";

/** 章末对每条旧伏笔的处理：带到下一章，或者作废。 */
export const DIRECTOR_CHAPTER_PROMISE_DISPOSITIONS = [
	"carry",
	"retire",
] as const;

export type DirectorChapterPromiseDisposition =
	(typeof DIRECTOR_CHAPTER_PROMISE_DISPOSITIONS)[number];

export const DIRECTOR_CHAPTER_PROMISE_DISPOSITION_LABELS: Record<
	DirectorChapterPromiseDisposition,
	string
> = {
	carry: "带到下一章",
	retire: "作废",
};

/** 下一章聚焦的线至少与至多几条。 */
export const MIN_CHAPTER_FOCUS_LINES = 2;
export const MAX_CHAPTER_FOCUS_LINES = 3;

export interface DirectorChapterPromiseDecision {
	readonly lineId: string;
	readonly disposition: DirectorChapterPromiseDisposition;
}

/** 章末清点的内容：旧伏笔的逐条处理与下一章聚焦的线。 */
export interface DirectorChapterReviewPayload {
	readonly promises: readonly DirectorChapterPromiseDecision[];
	readonly focus: readonly string[];
}

/** 一个楼层的章末清点记录；只追加，不覆盖。 */
export interface DirectorChapterReview {
	readonly nodeId: string;
	readonly storyId: string;
	readonly payload: DirectorChapterReviewPayload;
	readonly createdAt: string;
}

export interface NewDirectorChapterReviewInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly payload: DirectorChapterReviewPayload;
	readonly createdAt?: string;
}

/** 一次章级规划要写的两个部分：线修改与章末清点；两者同一事务写入。 */
export interface NewDirectorChapterPlanInput {
	readonly nodeId: string;
	readonly storyId: string;
	/** 可以为空：这一章没有线需要改动时只写清点。 */
	readonly diffs: readonly DirectorLineDiff[];
	readonly review: DirectorChapterReviewPayload;
	readonly createdAt?: string;
}

export interface DirectorChapterPlanRecord {
	/** 没有线修改时为 null。 */
	readonly lines: DirectorLineRecord | null;
	readonly review: DirectorChapterReview;
}

export function isDirectorChapterPromiseDisposition(
	value: unknown,
): value is DirectorChapterPromiseDisposition {
	return (
		typeof value === "string" &&
		(DIRECTOR_CHAPTER_PROMISE_DISPOSITIONS as readonly string[]).includes(value)
	);
}

function readLineId(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const id = value.trim();
	if (id.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	if (id.length > MAX_DIRECTOR_LINE_ID_CHARS) {
		throw new Error(`${label} 不能超过 ${MAX_DIRECTOR_LINE_ID_CHARS} 字`);
	}
	return id;
}

/** 校验章末清点的形状；与当前线是否对得上由 `assertChapterReviewMatchesLines` 检查。 */
export function assertDirectorChapterReviewPayload(
	value: unknown,
	label = "章末清点",
): DirectorChapterReviewPayload {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, ["promises", "focus"], label);
	const promises = record.promises;
	if (!Array.isArray(promises)) {
		throw new Error(`${label}.promises 必须是数组`);
	}
	const seen = new Set<string>();
	const parsedPromises = promises.map(
		(item, index): DirectorChapterPromiseDecision => {
			const path = `${label}.promises[${index}]`;
			const decision = assertPlainObject(item, path);
			rejectUnknownKeys(decision, ["lineId", "disposition"], path);
			const lineId = readLineId(decision.lineId, `${path}.lineId`);
			if (seen.has(lineId)) {
				throw new Error(`${path}.lineId 与前面的伏笔重复：${lineId}`);
			}
			seen.add(lineId);
			if (!isDirectorChapterPromiseDisposition(decision.disposition)) {
				throw new Error(
					`${path}.disposition 只能是 ${DIRECTOR_CHAPTER_PROMISE_DISPOSITIONS.join("、")}，收到 ${JSON.stringify(decision.disposition)}`,
				);
			}
			return { lineId, disposition: decision.disposition };
		},
	);
	const focus = record.focus;
	if (!Array.isArray(focus)) {
		throw new Error(`${label}.focus 必须是数组`);
	}
	if (
		focus.length < MIN_CHAPTER_FOCUS_LINES ||
		focus.length > MAX_CHAPTER_FOCUS_LINES
	) {
		throw new Error(
			`${label}.focus 必须是 ${MIN_CHAPTER_FOCUS_LINES} 到 ${MAX_CHAPTER_FOCUS_LINES} 条线`,
		);
	}
	const focusIds = new Set<string>();
	const parsedFocus = focus.map((item, index) => {
		const lineId = readLineId(item, `${label}.focus[${index}]`);
		if (focusIds.has(lineId)) {
			throw new Error(`${label}.focus[${index}] 与前面的线重复：${lineId}`);
		}
		focusIds.add(lineId);
		return lineId;
	});
	return { promises: parsedPromises, focus: parsedFocus };
}

/**
 * 章末清点必须逐条处理当前路径上的全部伏笔，聚焦的线必须存在，
 * 作废的伏笔不能同时成为下一章的焦点。
 */
export function assertChapterReviewMatchesLines(
	payload: DirectorChapterReviewPayload,
	states: readonly DirectorLineState[],
	label = "章末清点",
): void {
	const known = new Set(states.map((state) => state.line.id));
	const openPromises = new Set(
		states
			.filter((state) => state.line.kind === "promise")
			.map((state) => state.line.id),
	);
	const covered = new Set<string>();
	const retired = new Set<string>();
	for (const decision of payload.promises) {
		if (!known.has(decision.lineId)) {
			throw new Error(
				`${label}.promises 引用了当前路径上不存在的线：${decision.lineId}`,
			);
		}
		if (!openPromises.has(decision.lineId)) {
			throw new Error(
				`${label}.promises 里的线不是未兑现的伏笔：${decision.lineId}`,
			);
		}
		covered.add(decision.lineId);
		if (decision.disposition === "retire") retired.add(decision.lineId);
	}
	for (const lineId of openPromises) {
		if (!covered.has(lineId)) {
			throw new Error(`${label}.promises 没有给出伏笔的处理：${lineId}`);
		}
	}
	for (const lineId of payload.focus) {
		if (!known.has(lineId)) {
			throw new Error(`${label}.focus 引用了当前路径上不存在的线：${lineId}`);
		}
		if (retired.has(lineId)) {
			throw new Error(
				`${label}.focus 不能聚焦同一份清点里作废的伏笔：${lineId}`,
			);
		}
	}
}

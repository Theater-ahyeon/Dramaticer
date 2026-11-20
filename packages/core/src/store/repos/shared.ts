// StoryStore 各领域共用的行类型、转换与校验（refactor/05 从 story-store.ts 拆出）。
import { assertPlainObject, rejectUnknownKeys } from "../../json.js";
import type { ChunkStrategy } from "../../retrieval/chunk-text.js";
import type { StoryTime } from "../../timeline.js";

export interface StoryStoreOpenOptions {
	/** 向量维度；必须与数据库中已有的 chunk_vectors 表一致。 */
	readonly embeddingDimensions?: number;
	/** 分块策略；缺省按父子分块建立索引。 */
	readonly chunkStrategy?: ChunkStrategy;
}

export function assertNonEmptyString(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
}

export function optionalTrimmedString(
	value: unknown,
	label: string,
): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串或 null`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${label} 不能是空字符串`);
	}
	return trimmed;
}

export function readBooleanColumn(value: number, label: string): boolean {
	if (value === 0) return false;
	if (value === 1) return true;
	throw new Error(`${label} 必须是 0 或 1：${String(value)}`);
}

/** 起止都为空的 storyTime 与未指定等价，统一存成 NULL。 */
export function normaliseStoryTime(
	value: unknown,
	label: string,
): StoryTime | null {
	if (value === undefined || value === null) return null;
	const record = assertPlainObject(value, `${label} 的 storyTime`);
	rejectUnknownKeys(record, ["start", "end"], `${label} 的 storyTime`);
	const start = normaliseStoryTimeBound(
		record.start,
		`${label} 的 storyTime.start`,
	);
	const end = normaliseStoryTimeBound(record.end, `${label} 的 storyTime.end`);
	if (start === null && end === null) return null;
	return { start, end };
}

export function normaliseStoryTimeBound(
	value: unknown,
	label: string,
): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串或 null`);
	}
	return value;
}

export function parseStoredNameArray(value: string, label: string): string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		throw new Error(`${label}不是字符串数组`);
	}
	return parsed.map((item) => {
		if (typeof item !== "string" || item.length === 0) {
			throw new Error(`${label}不是字符串数组`);
		}
		return item;
	});
}

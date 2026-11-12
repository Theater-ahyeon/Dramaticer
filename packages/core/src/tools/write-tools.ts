import {
	assertPlainObject,
	rejectUnknownKeys,
	type JsonValue,
} from "../json.js";
import { validateLedgerDiff } from "../ledger/schema.js";
import type { StoryTime } from "../timeline.js";
import type { DeepToolDefinition } from "./registry.js";

export const LEDGER_WRITE_TOOL_NAME = "ledger_write";

/** 单次调用最多提交的台账条目。 */
export const MAX_LEDGER_WRITE_DIFFS = 20;

const LEDGER_WRITE_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		diffs: {
			type: "array",
			minItems: 1,
			maxItems: MAX_LEDGER_WRITE_DIFFS,
			description: `要写入的台账事实，最多 ${MAX_LEDGER_WRITE_DIFFS} 条；提交楼层时才写入`,
			items: {
				type: "object",
				properties: {
					path: {
						type: "array",
						items: { type: "string", minLength: 1 },
						minItems: 1,
						description:
							'台账路径，例如 ["character","卫宫","status"] 或 ["clue","井底匕首","status"]',
					},
					value: {
						description: "新值，形状由路径对应的命名空间决定",
					},
					storyTime: {
						type: ["object", "null"],
						properties: {
							start: { type: ["string", "null"] },
							end: { type: ["string", "null"] },
						},
						additionalProperties: false,
						description: "事实成立的故事内时间段，可以省略",
					},
					confidence: {
						type: ["number", "null"],
						minimum: 0,
						maximum: 1,
						description: "置信度 0 到 1，可以省略",
					},
				},
				required: ["path", "value"],
				additionalProperties: false,
			},
		},
	},
	required: ["diffs"],
	additionalProperties: false,
};

/** 待提交的台账写入；提交前只存在于运行内存。 */
export interface LedgerWriteProposal {
	readonly path: readonly string[];
	readonly value: JsonValue;
	readonly storyTime: StoryTime | null;
	readonly confidence: number | null;
}

export interface LedgerWriteRejection {
	/** 在 diffs 数组里的下标。 */
	readonly index: number;
	readonly reason: string;
}

export interface LedgerWriteValidation {
	readonly accepted: readonly LedgerWriteProposal[];
	readonly rejected: readonly LedgerWriteRejection[];
}

export interface LedgerWriteOutcome extends LedgerWriteValidation {
	/** 直接作为工具结果返回给模型的文本。 */
	readonly content: string;
	/** 有非法条目时为 false，让模型看到错误结果并修正。 */
	readonly ok: boolean;
	/** 有非法条目时的汇总原因；全部合法时为 null。 */
	readonly error: string | null;
}

/**
 * 逐条校验模型提交的台账写入。整体形状不合法时抛出，交给执行器写成
 * 工具错误；单条不合法时只拒绝该条，其余条目照常进入待提交集合。
 */
export function validateLedgerWriteArguments(
	value: unknown,
): LedgerWriteValidation {
	const args = assertPlainObject(value, "ledger_write 的参数");
	rejectUnknownKeys(args, ["diffs"], "ledger_write 的参数");
	if (!Array.isArray(args.diffs)) {
		throw new Error("ledger_write.diffs 必须是数组");
	}
	if (args.diffs.length === 0) {
		throw new Error("ledger_write.diffs 至少要有一条");
	}
	if (args.diffs.length > MAX_LEDGER_WRITE_DIFFS) {
		throw new Error(
			`ledger_write.diffs 最多 ${MAX_LEDGER_WRITE_DIFFS} 条，收到 ${args.diffs.length} 条`,
		);
	}
	const accepted: LedgerWriteProposal[] = [];
	const rejected: LedgerWriteRejection[] = [];
	for (const [index, raw] of args.diffs.entries()) {
		try {
			accepted.push(validateOne(raw, index));
		} catch (error) {
			rejected.push({
				index,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { accepted, rejected };
}

function validateOne(raw: unknown, index: number): LedgerWriteProposal {
	const label = `ledger_write.diffs[${index}]`;
	const entry = assertPlainObject(raw, label);
	rejectUnknownKeys(entry, ["path", "value", "storyTime", "confidence"], label);
	if (!Object.hasOwn(entry, "value")) {
		throw new Error(`${label}.value 缺失`);
	}
	if (!Array.isArray(entry.path)) {
		throw new Error(`${label}.path 必须是字符串数组`);
	}
	const path = entry.path as readonly string[];
	validateLedgerDiff({
		path,
		op: "set",
		value: entry.value,
		storyTime: entry.storyTime as StoryTime | null | undefined,
		confidence: entry.confidence as number | null | undefined,
	});
	return {
		path,
		value: entry.value as JsonValue,
		storyTime: (entry.storyTime as StoryTime | null | undefined) ?? null,
		confidence: typeof entry.confidence === "number" ? entry.confidence : null,
	};
}

/** 执行 ledger_write：不碰数据库，只把合法条目交给调用方暂存。 */
export function executeLedgerWriteTool(value: unknown): LedgerWriteOutcome {
	const validation = validateLedgerWriteArguments(value);
	const { accepted, rejected } = validation;
	if (rejected.length === 0) {
		return {
			...validation,
			content: `已收集 ${accepted.length} 条台账写入，提交楼层时统一校验并写入。`,
			ok: true,
			error: null,
		};
	}
	const details = rejected
		.map((item) => `- 第 ${item.index + 1} 条：${item.reason}`)
		.join("\n");
	return {
		...validation,
		content: `已收集 ${accepted.length} 条台账写入；以下 ${rejected.length} 条不合法，请修正后重试：\n${details}`,
		ok: false,
		error: `${rejected.length} 条台账写入不合法`,
	};
}

export const LEDGER_WRITE_TOOL: DeepToolDefinition = {
	name: LEDGER_WRITE_TOOL_NAME,
	description:
		"提交台账写入。合法条目先收集，楼层提交时统一校验写入；非法条目会作为工具错误返回。",
	parameters: LEDGER_WRITE_SCHEMA,
	permission: "propose",
	progressLabel: "整理台账……",
};

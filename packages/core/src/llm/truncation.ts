import type {
	LlmContinuationOptions,
	LlmResult,
	LlmTruncationReason,
} from "./types.js";

export const DEFAULT_TRUNCATION_TERMINATORS = "。！？!?…」』】）)]}\"'”’";

export interface DetectTruncationOptions {
	readonly expectedTags?: readonly string[];
	readonly terminators?: string;
	readonly detectAbruptEnd?: boolean;
}

/**
 * 同时检出全部截断原因，按 length、unclosed_tag、abrupt_end 的固定顺序返回。
 * 用来把一轮生成的全部截断写进 Trace。
 */
export function detectTruncations(
	result: Pick<LlmResult, "text" | "stopReason">,
	options: DetectTruncationOptions = {},
): LlmTruncationReason[] {
	const reasons: LlmTruncationReason[] = [];
	if (result.stopReason === "length") reasons.push("length");
	const text = result.text;
	const unclosedTag = (options.expectedTags ?? []).some((tag) =>
		hasUnclosedTag(text, tag),
	);
	if (
		unclosedTag ||
		(options.expectedTags !== undefined &&
			text.lastIndexOf("<") > text.lastIndexOf(">"))
	) {
		reasons.push("unclosed_tag");
	}
	if (options.detectAbruptEnd === true && isAbruptEnd(text, options)) {
		reasons.push("abrupt_end");
	}
	return reasons;
}

/** 按结束原因、未闭合标签与句尾判断内容是否被截断；返回优先检查到的第一个原因。 */
export function detectTruncation(
	result: Pick<LlmResult, "text" | "stopReason">,
	options: DetectTruncationOptions = {},
): LlmTruncationReason | null {
	return detectTruncations(result, options)[0] ?? null;
}

export interface ResolvedContinuationOptions {
	readonly maxRounds: number;
	readonly continueOn: readonly LlmTruncationReason[];
	readonly expectedTags: readonly string[] | undefined;
	readonly terminators: string;
	readonly detectAbruptEnd: boolean;
}

export function resolveContinuationOptions(
	options: LlmContinuationOptions | undefined,
): ResolvedContinuationOptions {
	const maxRounds = options?.maxRounds ?? 1;
	if (!Number.isInteger(maxRounds) || maxRounds < 0) {
		throw new Error("continuation.maxRounds 必须是非负整数");
	}
	const continueOn = options?.continueOn ?? ["length"];
	for (const reason of continueOn) {
		if (!isTruncationReason(reason)) {
			throw new Error(`未知的截断原因：${String(reason)}`);
		}
	}
	return {
		maxRounds,
		continueOn,
		expectedTags: options?.expectedTags,
		terminators: options?.terminators ?? DEFAULT_TRUNCATION_TERMINATORS,
		detectAbruptEnd: options?.detectAbruptEnd ?? false,
	};
}

function isTruncationReason(value: unknown): value is LlmTruncationReason {
	return (
		value === "length" || value === "unclosed_tag" || value === "abrupt_end"
	);
}

function hasUnclosedTag(text: string, tag: string): boolean {
	const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const opens = text.match(new RegExp(`<${escaped}(?=[\\s/>])`, "g"));
	const closes = text.match(new RegExp(`</${escaped}\\s*>`, "g"));
	return (opens?.length ?? 0) > (closes?.length ?? 0);
}

/** 生成被切断在标签中间时，最后一个 `<` 没有对应的 `>`。 */
function hasIncompleteAngleTag(text: string): boolean {
	return text.lastIndexOf("<") > text.lastIndexOf(">");
}

function isAbruptEnd(text: string, options: DetectTruncationOptions): boolean {
	const trimmed = text.trimEnd();
	if (trimmed.length === 0) return false;
	const last = trimmed.at(-1);
	if (last === undefined) return false;
	const terminators = options.terminators ?? DEFAULT_TRUNCATION_TERMINATORS;
	return !terminators.includes(last);
}

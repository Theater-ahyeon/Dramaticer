import { defaultBlockTypeRegistry } from "../plugins/block-types.js";
import { type TokenEstimator, createTokenEstimator } from "../tokens.js";
import { parseBlocks } from "./parser.js";
import {
	type BlockContextStrategy,
	type BlockTypeDefinition,
	type BlockTypeRegistry,
	type ParsedBlock,
	assertBlockContextStrategy,
	createBlockTypeRegistry,
} from "./types.js";
import { renderContextView } from "./view.js";

/** `default` 在更早楼层省略显示类块；`full` 与改动前的历史渲染逐字节一致。 */
export const HISTORY_BLOCK_POLICY_MODES = ["default", "full"] as const;

export type HistoryBlockPolicyMode =
	(typeof HISTORY_BLOCK_POLICY_MODES)[number];

export interface HistoryBlockPolicy {
	readonly mode: HistoryBlockPolicyMode;
	/** 按块类型名覆盖上下文策略；优先于 `default` 的省略列表与块类型自带策略。 */
	readonly overrides: Readonly<Record<string, BlockContextStrategy>>;
}

export const DEFAULT_HISTORY_BLOCK_POLICY: HistoryBlockPolicy = Object.freeze({
	mode: "default",
	overrides: Object.freeze({}),
});

export const DEFAULT_RECENT_RAW_FLOORS = 1;

/** `default` 策略在更早楼层整段省略的显示类块，见 DESIGN §6。 */
export const DEFAULT_HISTORY_OMITTED_BLOCK_NAMES: readonly string[] =
	Object.freeze(["选项", "状态栏", "变量更新", "分析", "图片"]);

export function isHistoryBlockPolicyMode(
	value: unknown,
): value is HistoryBlockPolicyMode {
	return value === "default" || value === "full";
}

/** 校验策略对象；`overrides` 里的 `compress` 尚未实现，直接拒绝。 */
export function assertHistoryBlockPolicy(
	policy: unknown,
	label = "历史块策略",
): asserts policy is HistoryBlockPolicy {
	if (typeof policy !== "object" || policy === null) {
		throw new Error(`${label} 必须是对象`);
	}
	const record = policy as Record<string, unknown>;
	if (!isHistoryBlockPolicyMode(record.mode)) {
		throw new Error(
			`${label} 的 mode 必须是 default 或 full，实际为 ${String(record.mode)}`,
		);
	}
	const overrides = record.overrides;
	if (typeof overrides !== "object" || overrides === null) {
		throw new Error(`${label} 的 overrides 必须是对象`);
	}
	for (const [name, strategy] of Object.entries(overrides)) {
		if (name.length === 0) {
			throw new Error(`${label} 的 overrides 不能有空块类型名`);
		}
		try {
			assertBlockContextStrategy(strategy as BlockContextStrategy, name);
		} catch (error) {
			throw new Error(
				`${label} 的 overrides.${name} 不合法：${(error as Error).message}`,
			);
		}
		if ((strategy as BlockContextStrategy).kind === "compress") {
			throw new Error(
				`${label} 的 overrides.${name} 使用了尚未实现的 compress`,
			);
		}
	}
}

export interface HistoryViewFloor {
	readonly raw: string;
	/** 当前楼层距离尾部的深度，0 表示最新一层。 */
	readonly depth: number;
}

export interface HistoryViewOmission {
	readonly blockType: string;
	/** 被整段省略的原文总字符数（含标签）。 */
	readonly characters: number;
	readonly tokens: number;
}

/** 写进 Trace 的历史视图统计。 */
export interface HistoryViewTrace {
	readonly policy: HistoryBlockPolicyMode;
	readonly recentRawFloors: number;
	/** 没有省略时为空；按省略字符数从多到少排序。 */
	readonly omitted: readonly HistoryViewOmission[];
}

export interface HistoryViewOptions {
	readonly policy?: HistoryBlockPolicy;
	readonly recentRawFloors?: number;
	readonly estimator?: TokenEstimator;
	readonly types?: readonly BlockTypeDefinition[];
	readonly registry?: BlockTypeRegistry;
}

export interface HistoryViewResult {
	/** 与输入楼层一一对应的 prompt 视图。 */
	readonly texts: readonly string[];
	readonly trace: HistoryViewTrace;
}

/** 围栏代码块在 `default` 下按原文保留；未闭合的围栏一直延伸到楼层结尾。 */
const FENCED_CODE = /```[\s\S]*?(?:```|$)/g;

/**
 * 把楼层历史渲染成 prompt 视图：`default` 在更早楼层省略显示类块，
 * 最近 `recentRawFloors` 楼仍按块类型自带策略渲染（思考、写入块照旧不进入 prompt），
 * 但不套用显示类省略。原文不受影响。
 */
export function renderHistoryView(
	floors: readonly HistoryViewFloor[],
	options: HistoryViewOptions = {},
): HistoryViewResult {
	const policy = options.policy ?? DEFAULT_HISTORY_BLOCK_POLICY;
	assertHistoryBlockPolicy(policy);
	const recentRawFloors = options.recentRawFloors ?? DEFAULT_RECENT_RAW_FLOORS;
	if (!Number.isInteger(recentRawFloors) || recentRawFloors < 0) {
		throw new Error("最近保留原文的楼数必须是非负整数");
	}
	const estimator = options.estimator ?? createTokenEstimator();
	const registry =
		options.registry ??
		(options.types
			? createBlockTypeRegistry(options.types)
			: defaultBlockTypeRegistry());
	const defaultMode = policy.mode === "default";
	const omitted = new Map<string, { characters: number; tokens: number }>();

	const renderChunk = (text: string, depth: number): string =>
		renderContextView(parseBlocks(text, { registry }), {
			depth,
			resolveStrategy: (block) =>
				effectiveStrategy(
					block,
					policy,
					defaultMode && depth >= recentRawFloors,
				),
			onOmit: (block) => {
				// 省略的是整段标签文本，统计要把标签本身也算进去。
				const text = `<${block.name}>${block.raw}</${block.name}>`;
				const current = omitted.get(block.name) ?? {
					characters: 0,
					tokens: 0,
				};
				current.characters += text.length;
				current.tokens += estimator(text);
				omitted.set(block.name, current);
			},
		});

	const texts = floors.map((floor) => {
		if (!defaultMode) return renderChunk(floor.raw, floor.depth);
		let text = "";
		let last = 0;
		for (const match of floor.raw.matchAll(FENCED_CODE)) {
			const start = match.index;
			text += renderChunk(floor.raw.slice(last, start), floor.depth);
			text += match[0];
			last = start + match[0].length;
		}
		return text + renderChunk(floor.raw.slice(last), floor.depth);
	});

	return {
		texts,
		trace: {
			policy: policy.mode,
			recentRawFloors,
			omitted: [...omitted.entries()]
				.map(([blockType, stat]) => ({ blockType, ...stat }))
				.sort(
					(left, right) =>
						right.characters - left.characters ||
						left.blockType.localeCompare(right.blockType),
				),
		},
	};
}

function effectiveStrategy(
	block: ParsedBlock,
	policy: HistoryBlockPolicy,
	defaultMode: boolean,
): BlockContextStrategy {
	// 未闭合块按原文保留，避免把只写了一半的正文吞掉。
	if (!block.complete) return { kind: "keep" };
	const override = policy.overrides[block.name];
	if (override !== undefined) return override;
	if (defaultMode && DEFAULT_HISTORY_OMITTED_BLOCK_NAMES.includes(block.name)) {
		return { kind: "drop" };
	}
	return block.type.context;
}

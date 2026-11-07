import type { StateDiffOp } from "../timeline.js";

/** 显示策略：原生组件、沙箱 iframe 里的 HTML 模板，或者不显示。 */
export type BlockDisplayStrategy =
	| { readonly kind: "native"; readonly component: string }
	| { readonly kind: "html"; readonly template: string }
	| { readonly kind: "hidden" };

/** 上下文策略：块内容进入 prompt 的方式。压缩的具体实现留给后续任务。 */
export type BlockContextStrategy =
	| { readonly kind: "keep" }
	| { readonly kind: "drop" }
	| { readonly kind: "keep-depth"; readonly depth: number }
	| { readonly kind: "compress" };

/** 语义策略的输出：状态变更或剧情笔记。 */
export type BlockSemanticEffect =
	| {
			readonly kind: "state";
			readonly path: readonly string[];
			readonly op: StateDiffOp;
			readonly value: unknown;
	  }
	| { readonly kind: "note"; readonly text: string };

/** 语义策略：把已闭合的块映射成 harness 更新。 */
export type BlockSemanticsStrategy =
	| { readonly kind: "none" }
	| {
			readonly kind: "handler";
			readonly apply: (block: ParsedBlock) => readonly BlockSemanticEffect[];
	  };

export interface ParsedText {
	readonly kind: "text";
	readonly text: string;
}

export interface ParsedBlock {
	readonly kind: "block";
	readonly name: string;
	readonly type: BlockTypeDefinition;
	/** 输入结束时仍未闭合的块为 false。 */
	readonly complete: boolean;
	readonly content: readonly ParsedContent[];
	/** 块内原文，等于 content 拼接后的结果。 */
	readonly raw: string;
}

export type ParsedContent = ParsedText | ParsedBlock;

export interface BlockTypeDefinition {
	/** 标签名，例如 `thinking`、`选项`。 */
	readonly name: string;
	readonly display: BlockDisplayStrategy;
	readonly context: BlockContextStrategy;
	readonly semantics: BlockSemanticsStrategy;
}

export interface BlockTypeRegistry {
	get(name: string): BlockTypeDefinition | null;
	readonly names: readonly string[];
}

function assertBlockName(name: string): void {
	if (typeof name !== "string" || name.length === 0) {
		throw new Error("块类型名必须是非空字符串");
	}
	if (/[<>/\s]/.test(name)) {
		throw new Error(`块类型名不能包含 '<'、'>'、'/' 或空白：${name}`);
	}
}

function assertDisplayStrategy(
	display: BlockDisplayStrategy,
	name: string,
): void {
	if (display.kind === "native") {
		if (display.component.length === 0) {
			throw new Error(`块类型 ${name} 的 native 组件名不能为空`);
		}
		return;
	}
	if (display.kind === "html") {
		if (display.template.length === 0) {
			throw new Error(`块类型 ${name} 的 html 模板不能为空`);
		}
		return;
	}
	if (display.kind !== "hidden") {
		throw new Error(`块类型 ${name} 的显示策略未知：${String(display)}`);
	}
}

function assertContextStrategy(
	context: BlockContextStrategy,
	name: string,
): void {
	if (context.kind === "keep-depth") {
		if (!Number.isInteger(context.depth) || context.depth < 1) {
			throw new Error(`块类型 ${name} 的 keep-depth 深度必须是正整数`);
		}
		return;
	}
	if (
		context.kind !== "keep" &&
		context.kind !== "drop" &&
		context.kind !== "compress"
	) {
		throw new Error(`块类型 ${name} 的上下文策略未知：${String(context)}`);
	}
}

function assertSemanticsStrategy(
	semantics: BlockSemanticsStrategy,
	name: string,
): void {
	if (semantics.kind === "handler") {
		if (typeof semantics.apply !== "function") {
			throw new Error(`块类型 ${name} 的语义处理器必须是函数`);
		}
		return;
	}
	if (semantics.kind !== "none") {
		throw new Error(`块类型 ${name} 的语义策略未知：${String(semantics)}`);
	}
}

/** 创建一个注册表；重名、非法名称或非法策略在创建时就抛错。 */
export function createBlockTypeRegistry(
	types: readonly BlockTypeDefinition[],
): BlockTypeRegistry {
	const byName = new Map<string, BlockTypeDefinition>();
	for (const type of types) {
		assertBlockName(type.name);
		if (byName.has(type.name)) {
			throw new Error(`块类型重复注册：${type.name}`);
		}
		assertDisplayStrategy(type.display, type.name);
		assertContextStrategy(type.context, type.name);
		assertSemanticsStrategy(type.semantics, type.name);
		byName.set(type.name, type);
	}
	return {
		get(name: string): BlockTypeDefinition | null {
			return byName.get(name) ?? null;
		},
		names: [...byName.keys()],
	};
}

/** DESIGN §6 的原生协议块与 §11 的写入类文本标签。策略的处理器在后续任务里接入。 */
export const DEFAULT_BLOCK_TYPES: readonly BlockTypeDefinition[] = [
	{
		name: "thinking",
		display: { kind: "hidden" },
		context: { kind: "drop" },
		semantics: { kind: "none" },
	},
	{
		name: "选项",
		display: { kind: "native", component: "options" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	},
	{
		name: "页眉",
		display: { kind: "native", component: "header" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	},
	{
		name: "悄悄话",
		display: { kind: "native", component: "whisper" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	},
	{
		name: "旁白",
		display: { kind: "native", component: "narration" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	},
	{
		name: "备忘",
		display: { kind: "native", component: "memo" },
		context: { kind: "keep" },
		semantics: { kind: "none" },
	},
	{
		name: "state_update",
		display: { kind: "hidden" },
		context: { kind: "drop" },
		semantics: { kind: "none" },
	},
	{
		name: "plot_note",
		display: { kind: "hidden" },
		context: { kind: "drop" },
		semantics: { kind: "none" },
	},
];

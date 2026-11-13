/**
 * 世界书与预设条目内容开头的 `@@` 装饰器。
 * 语义以 ST-Prompt-Template 的文档为准：装饰器只在内容最前面连续出现，
 * 未知装饰器行整行丢弃并记录，`@@@` 开头的行是普通内容，按原文保留。
 */

export const ST_EJS_DECORATOR_NAMES = [
	"activate",
	"dont_activate",
	"message_formatting",
	"generate_before",
	"generate_after",
	"render_before",
	"render_after",
	"dont_preload",
	"preload",
	"only_preload",
	"initial_variables",
	"always_enabled",
	"private",
	"if",
	"iframe",
	"preprocessing",
] as const;

export type StEjsDecoratorName = (typeof ST_EJS_DECORATOR_NAMES)[number];

export interface StEjsDecorator {
	readonly name: StEjsDecoratorName;
	/** `@@if` 的表达式；没有参数的装饰器为 null。 */
	readonly argument: string | null;
	readonly raw: string;
	/** 在原内容里的行号，从 1 开始。 */
	readonly line: number;
}

export interface StEjsDecoratorParse {
	readonly decorators: readonly StEjsDecorator[];
	/** 去掉装饰器行之后的正文。 */
	readonly content: string;
	/** 被丢弃的未知装饰器行。 */
	readonly discarded: readonly string[];
}

export class StEjsDecoratorError extends Error {
	readonly expression: string | null;

	constructor(
		message: string,
		expression: string | null = null,
		cause?: unknown,
	) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "StEjsDecoratorError";
		this.expression = expression;
	}
}

const DECORATOR_LINE = /^@@([a-z_]+)(?:[ \t]+(.*))?$/;

function isDecoratorName(value: string): value is StEjsDecoratorName {
	return (ST_EJS_DECORATOR_NAMES as readonly string[]).includes(value);
}

/** 解析内容开头的装饰器块；正文原样返回。 */
export function parseStEjsDecorators(text: string): StEjsDecoratorParse {
	if (typeof text !== "string") {
		throw new StEjsDecoratorError("装饰器输入必须是字符串");
	}
	if (!text.startsWith("@@")) {
		return { decorators: [], content: text, discarded: [] };
	}
	const lines = text.split("\n");
	const decorators: StEjsDecorator[] = [];
	const discarded: string[] = [];
	let index = 0;
	while (index < lines.length) {
		const raw = lines[index] as string;
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (!line.startsWith("@@") || line.startsWith("@@@")) break;
		const match = DECORATOR_LINE.exec(line);
		const name = match?.[1];
		if (name === undefined || !isDecoratorName(name)) {
			discarded.push(line);
			index += 1;
			continue;
		}
		const argument = match?.[2]?.trim() ?? "";
		if (name === "if" && argument.length === 0) {
			throw new StEjsDecoratorError(
				`第 ${index + 1} 行的 @@if 缺少表达式`,
				null,
			);
		}
		decorators.push({
			name,
			argument: argument.length === 0 ? null : argument,
			raw: line,
			line: index + 1,
		});
		index += 1;
	}
	return {
		decorators,
		content: lines.slice(index).join("\n"),
		discarded,
	};
}

export function hasStEjsDecorator(
	decorators: readonly StEjsDecorator[],
	name: StEjsDecoratorName,
): boolean {
	return decorators.some((decorator) => decorator.name === name);
}

export function readStEjsDecoratorArgument(
	decorators: readonly StEjsDecorator[],
	name: StEjsDecoratorName,
): string | null {
	return (
		decorators.find((decorator) => decorator.name === name)?.argument ?? null
	);
}

/**
 * `@@if` 的表达式在模板的同一批局部变量里求值。表达式是原始 JavaScript，
 * 与模板本身一样由调用方的执行隔离负责。
 */
export function evaluateStEjsDecoratorCondition(
	expression: string,
	locals: Record<string, unknown> = {},
): unknown {
	if (typeof expression !== "string" || expression.trim().length === 0) {
		throw new StEjsDecoratorError("@@if 需要非空表达式", expression);
	}
	try {
		const evaluate = new Function(
			"__locals",
			`with (__locals) { return (${expression}); }`,
		);
		return evaluate(locals);
	} catch (error) {
		throw new StEjsDecoratorError(
			`@@if 表达式求值失败：${error instanceof Error ? error.message : String(error)}`,
			expression,
			error,
		);
	}
}

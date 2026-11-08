import { type JsonObject, isJsonObject } from "../json.js";
import type { LlmToolDefinition } from "../llm/types.js";

/** 文本协议的工具调用：正文里的 `<tool name="…">{json}</tool>`。 */
export interface TextToolCall {
	readonly name: string;
	/** 解析成功时的参数对象；解析失败时为 null。 */
	readonly arguments: JsonObject | null;
	/** 参数无法使用时的原因；成功时为 null。 */
	readonly error: string | null;
}

export interface TextToolCallExtraction {
	readonly body: string;
	readonly calls: readonly TextToolCall[];
}

function textToolCallPattern(): RegExp {
	return /<tool\s+name="([^"]+)"\s*>([\s\S]*?)<\/tool>/g;
}

/**
 * 文本协议下发给模型的工具说明。工具调用是传输层约定，不进入正文；
 * 明确写出可以不调用工具（I13）。
 */
export function renderToolProtocol(
	tools: readonly LlmToolDefinition[],
): string {
	const lines = [
		"## 工具调用",
		"需要工具时，在正文里单独写一段：",
		'<tool name="工具名">{"参数名": 参数值}</tool>',
		"标签里必须是一个完整的 JSON 对象；调用结果会在下一条消息里返回，标签本身不会出现在正文里。",
		"不需要工具时照常写正文，也可以不调用任何工具。",
		"",
		"可用工具：",
	];
	for (const tool of tools) {
		lines.push(`- ${tool.name}：${tool.description}`);
		lines.push(`  参数 JSON Schema：${JSON.stringify(tool.parameters)}`);
	}
	return lines.join("\n");
}

/** 取出正文里的全部工具调用，并返回去掉调用片段后的正文。 */
export function extractTextToolCalls(text: string): TextToolCallExtraction {
	const calls: TextToolCall[] = [];
	const body = text.replace(
		textToolCallPattern(),
		(_match, name: string, payload: string) => {
			calls.push(parseTextToolCall(name, payload));
			return "";
		},
	);
	return { body: cleanBody(body), calls };
}

function parseTextToolCall(name: string, payload: string): TextToolCall {
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch (error) {
		return {
			name,
			arguments: null,
			error: `参数不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!isJsonObject(parsed)) {
		return { name, arguments: null, error: "参数必须是 JSON 对象" };
	}
	return { name, arguments: parsed, error: null };
}

function cleanBody(body: string): string {
	return body
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * 流式输出里隐藏工具调用片段：完整的调用直接丢掉，
 * 末尾可能是调用开头的片段先留住，等下一段增量到达再判定。
 */
export class TextToolStreamFilter {
	#buffer = "";

	push(delta: string): string {
		this.#buffer += delta;
		return this.#drain(false);
	}

	finish(): string {
		return this.#drain(true);
	}

	#drain(final: boolean): string {
		let emitted = "";
		for (;;) {
			const start = this.#buffer.indexOf("<tool");
			if (start === -1) {
				if (final) {
					emitted += this.#buffer;
					this.#buffer = "";
					return emitted;
				}
				const hold = partialTagLength(this.#buffer);
				emitted += this.#buffer.slice(0, this.#buffer.length - hold);
				this.#buffer = this.#buffer.slice(this.#buffer.length - hold);
				return emitted;
			}
			if (start > 0) {
				emitted += this.#buffer.slice(0, start);
				this.#buffer = this.#buffer.slice(start);
			}
			const match = matchToolCallAtStart(this.#buffer);
			if (match === null) {
				if (final || this.#buffer.includes("</tool>")) {
					emitted += this.#buffer;
					this.#buffer = "";
				}
				return emitted;
			}
			this.#buffer = this.#buffer.slice(match.length);
		}
	}
}

const TOOL_TAG = "<tool";

function partialTagLength(buffer: string): number {
	for (
		let length = Math.min(TOOL_TAG.length, buffer.length);
		length > 0;
		length--
	) {
		if (buffer.endsWith(TOOL_TAG.slice(0, length))) return length;
	}
	return 0;
}

function matchToolCallAtStart(text: string): RegExpExecArray | null {
	const match = textToolCallPattern().exec(text);
	return match !== null && match.index === 0 ? match : null;
}

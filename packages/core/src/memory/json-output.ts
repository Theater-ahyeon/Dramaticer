/**
 * 解析后台模型输出的 JSON 数组：允许整体包在 Markdown 代码块里，
 * 其余情况一律按原文解析。标签用于拼出带来源的错误信息。
 */
export function parseJsonOutputArray(text: string, label: string): unknown[] {
	if (typeof text !== "string") {
		throw new Error(`${label}必须是字符串`);
	}
	const body = stripCodeFence(text.trim());
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (error) {
		throw new Error(`${label}不是合法 JSON`, { cause: error });
	}
	if (!Array.isArray(parsed)) {
		throw new Error(`${label}必须是 JSON 数组`);
	}
	return parsed;
}

/**
 * 解析后台模型输出的 JSON 对象：允许整体包在 Markdown 代码块里。
 */
export function parseJsonOutputObject(
	text: string,
	label: string,
): Record<string, unknown> {
	if (typeof text !== "string") {
		throw new Error(`${label}必须是字符串`);
	}
	const body = stripCodeFence(text.trim());
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (error) {
		throw new Error(`${label}不是合法 JSON`, { cause: error });
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${label}必须是 JSON 对象`);
	}
	return parsed as Record<string, unknown>;
}

function stripCodeFence(text: string): string {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ?? text;
}

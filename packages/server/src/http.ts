import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiErrorCode, ApiErrorResponse } from "@dramaticer/protocol";

/** 路由里抛出的错误；统一转换成 `{error:{code,message,details?}}`。 */
export class HttpError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode;
	readonly details: unknown;

	constructor(
		status: number,
		code: ApiErrorCode,
		message: string,
		details?: unknown,
	) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export function sendJson(
	res: ServerResponse,
	status: number,
	body: unknown,
	headers: Readonly<Record<string, string>> = {},
): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(payload),
		"X-Content-Type-Options": "nosniff",
		...headers,
	});
	res.end(payload);
}

export function sendError(
	res: ServerResponse,
	status: number,
	code: ApiErrorCode,
	message: string,
	details?: unknown,
): void {
	const body: ApiErrorResponse =
		details === undefined
			? { error: { code, message } }
			: { error: { code, message, details } };
	sendJson(res, status, body);
}

export function sendEmpty(
	res: ServerResponse,
	status: number,
	headers: Readonly<Record<string, string>> = {},
): void {
	res.writeHead(status, headers);
	res.end();
}

/**
 * 读完整个请求体再判断是否超限：直接截断会让客户端先收到连接错误，
 * 看不到 413。超限的部分丢弃，内存占用不随请求体增长。
 */
export async function readJsonBody(
	req: IncomingMessage,
	limitBytes: number,
): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk)
			? chunk
			: Buffer.from(chunk as Uint8Array);
		size += buffer.length;
		if (size <= limitBytes) chunks.push(buffer);
	}
	if (size > limitBytes) {
		throw new HttpError(
			413,
			"payload_too_large",
			`请求体超过 ${limitBytes} 字节上限`,
			{ limitBytes, size },
		);
	}
	if (size === 0) {
		throw new HttpError(400, "bad_request", "请求体不能为空");
	}
	const text = Buffer.concat(chunks).toString("utf8");
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new HttpError(400, "bad_request", "请求体不是合法 JSON");
	}
}

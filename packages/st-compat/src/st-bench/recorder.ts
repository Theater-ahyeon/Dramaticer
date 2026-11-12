import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import {
	type IncomingMessage,
	type ServerResponse,
	createServer,
} from "node:http";
import path from "node:path";
import { type JsonValue, isJsonObject } from "@dramaticer/core";

const SENSITIVE_HEADERS: Record<string, true> = {
	authorization: true,
	"proxy-authorization": true,
	"x-api-key": true,
	"api-key": true,
	apikey: true,
	"x-goog-api-key": true,
	cookie: true,
	"set-cookie": true,
};

const SENSITIVE_QUERY_KEYS: Record<string, true> = {
	key: true,
	api_key: true,
	apikey: true,
	token: true,
};

/** 桩响应里的固定文本，用来让 ST 认为生成已经结束。 */
export const RECORD_ONLY_STUB_TEXT = "[dramaticer-st-bench record-only]";

/** 录制期间允许出现的请求体上限；超过时返回 413 并记录数量，不缓存正文。 */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

export interface PromptRecordSummary {
	readonly seq: number;
	readonly at: string;
	readonly method: string;
	readonly path: string;
	readonly model: string | null;
	readonly stream: boolean;
	readonly messageCount: number | null;
	readonly bodyBytes: number;
	/** 相对录制目录的请求文件路径；请求体超限时为 null。 */
	readonly file: string | null;
}

export interface PromptRecord extends PromptRecordSummary {
	readonly headers: Readonly<Record<string, string>>;
	readonly query: Readonly<Record<string, string>>;
	readonly body: JsonValue | null;
}

export interface PromptRecorderOptions {
	/** 录制目录；请求正文、索引都写在这里。 */
	readonly dir: string;
	readonly host?: string;
	/** 0 表示由系统分配端口。 */
	readonly port?: number;
	readonly stubModel?: string;
	readonly maxBodyBytes?: number;
	/** 达到指定请求数后自动停止；测试与单次录制使用。 */
	readonly maxRequests?: number;
	/** 只录制满足条件的请求；默认录制全部 POST。 */
	readonly shouldRecord?: (request: {
		readonly method: string;
		readonly path: string;
	}) => boolean;
}

export interface PromptRecorder {
	readonly url: string;
	readonly host: string;
	readonly port: number;
	readonly dir: string;
	readonly records: readonly PromptRecordSummary[];
	/** 服务端关闭后完成；达到 maxRequests 自动关闭时也用它等待。 */
	readonly closed: Promise<void>;
	close(): Promise<void>;
}

export function isPromptRecordingPath(pathname: string): boolean {
	return (
		pathname.endsWith("/chat/completions") || pathname.endsWith("/completions")
	);
}

/**
 * 启动只录制、不回源的 OpenAI 兼容服务。它不持有任何模型客户端：
 * 生成请求一律返回固定桩，因此不会消耗额度（I14）。
 */
export async function startPromptRecorder(
	options: PromptRecorderOptions,
): Promise<PromptRecorder> {
	const host = options.host ?? "127.0.0.1";
	const stubModel = options.stubModel ?? "dramaticer-record-only";
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
	const requestsDir = path.join(options.dir, "requests");
	const indexFile = path.join(options.dir, "index.jsonl");
	await mkdir(requestsDir, { recursive: true });
	await writeFile(indexFile, "", { flag: "a" });

	const records: PromptRecordSummary[] = [];
	const writeErrors: unknown[] = [];
	let nextSeq = 0;
	let ignoredRequests = 0;
	let closing = false;
	const closed = Promise.withResolvers<void>();
	const pendingWrites = new Set<Promise<void>>();
	const shouldRecord =
		options.shouldRecord ?? ((request) => request.method === "POST");
	const onMaxRequests = options.maxRequests;

	const track = (work: Promise<void>): void => {
		pendingWrites.add(work);
		work
			.catch((error: unknown) => {
				writeErrors.push(error);
			})
			.finally(() => {
				pendingWrites.delete(work);
			});
	};

	const server = createServer((request, response) => {
		handleRequest(request, response).catch((error: unknown) => {
			writeErrors.push(error);
			if (!response.headersSent) {
				sendJson(response, 500, {
					error: { message: "录制服务处理请求失败" },
				});
			} else {
				response.destroy();
			}
		});
	});

	async function handleRequest(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		const method = request.method ?? "GET";
		const url = new URL(request.url ?? "/", `http://${host}`);
		const pathname = url.pathname;

		if (method === "OPTIONS") {
			writeCorsHeaders(response);
			response.writeHead(204).end();
			return;
		}
		if (method === "GET" && (pathname === "/health" || pathname === "/")) {
			sendJson(response, 200, {
				ok: true,
				recorder: true,
				records: records.length,
				ignoredRequests,
			});
			return;
		}
		if (method === "GET" && pathname.endsWith("/models")) {
			sendJson(response, 200, {
				object: "list",
				data: [
					{
						id: stubModel,
						object: "model",
						created: 0,
						owned_by: "dramaticer-st-bench",
					},
				],
			});
			return;
		}
		if (!shouldRecord({ method, path: pathname })) {
			ignoredRequests += 1;
			sendJson(response, 404, {
				error: { message: `录制服务不处理 ${method} ${pathname}` },
			});
			return;
		}

		const read = await readBody(request, maxBodyBytes);
		const seq = nextSeq;
		nextSeq += 1;
		const at = new Date().toISOString();
		const parsed = read.text === null ? null : parseJsonValue(read.text);
		const summary: PromptRecordSummary = {
			seq,
			at,
			method,
			path: pathname,
			model: readModel(parsed),
			stream: readStream(parsed),
			messageCount: readMessageCount(parsed),
			bodyBytes: read.bytes,
			file: read.truncated
				? null
				: path.posix.join("requests", `${String(seq).padStart(5, "0")}.json`),
		};
		records.push(summary);
		if (summary.file !== null) {
			const record: PromptRecord = {
				...summary,
				headers: redactHeaders(request.headers),
				query: redactQuery(url.searchParams),
				body: parsed,
			};
			const recordFile = path.join(options.dir, summary.file);
			track(
				(async () => {
					await writeFile(
						recordFile,
						`${JSON.stringify(record, null, "\t")}\n`,
					);
					await appendFile(indexFile, `${JSON.stringify(summary)}\n`);
				})(),
			);
		} else {
			track(
				(async () => {
					await appendFile(indexFile, `${JSON.stringify(summary)}\n`);
				})(),
			);
		}

		if (read.truncated) {
			sendJson(response, 413, {
				error: {
					message: `请求体超过 ${maxBodyBytes} 字节，录制服务没有缓存正文`,
				},
			});
			return;
		}
		if (summary.stream) {
			sendStubStream(response, stubModel);
		} else {
			sendStubCompletion(response, stubModel);
		}
		if (onMaxRequests !== undefined && records.length >= onMaxRequests) {
			await close();
		}
	}

	function close(): Promise<void> {
		if (closing) return Promise.resolve();
		closing = true;
		const { promise, resolve } = Promise.withResolvers<void>();
		server.close(() => {
			server.closeAllConnections();
			closed.resolve();
			resolve();
		});
		server.closeIdleConnections();
		return promise;
	}

	const listening = Promise.withResolvers<void>();
	server.once("error", listening.reject);
	server.listen(options.port ?? 0, host, () => {
		server.off("error", listening.reject);
		listening.resolve();
	});
	await listening.promise;
	const address = server.address();
	if (address === null || typeof address === "string") {
		await close();
		throw new Error("录制服务没有取得端口");
	}

	return {
		url: `http://${host}:${address.port}`,
		host,
		port: address.port,
		dir: options.dir,
		records,
		closed: closed.promise,
		async close() {
			await close();
			while (pendingWrites.size > 0) {
				await Promise.allSettled([...pendingWrites]);
			}
			if (writeErrors.length > 0) {
				throw new AggregateError(writeErrors, "录制服务写入失败");
			}
		},
	};
}

interface ReadBodyResult {
	readonly text: string | null;
	readonly bytes: number;
	readonly truncated: boolean;
}

async function readBody(
	request: IncomingMessage,
	maxBytes: number,
): Promise<ReadBodyResult> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	let truncated = false;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > maxBytes) {
			truncated = true;
			continue;
		}
		chunks.push(buffer);
	}
	if (truncated) return { text: null, bytes, truncated: true };
	return {
		text: Buffer.concat(chunks).toString("utf8"),
		bytes,
		truncated: false,
	};
}

function parseJsonValue(text: string): JsonValue | null {
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed as JsonValue;
	} catch {
		return null;
	}
}

function readModel(body: JsonValue | null): string | null {
	if (!isJsonObject(body)) return null;
	const model = body.model;
	return typeof model === "string" ? model : null;
}

function readStream(body: JsonValue | null): boolean {
	if (!isJsonObject(body)) return false;
	return body.stream === true;
}

function readMessageCount(body: JsonValue | null): number | null {
	if (!isJsonObject(body)) return null;
	const messages = body.messages;
	return Array.isArray(messages) ? messages.length : null;
}

export function redactHeaders(
	headers: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
	const redacted: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		const key = name.toLowerCase();
		if (value === undefined) continue;
		redacted[key] =
			SENSITIVE_HEADERS[key] === true
				? "<redacted>"
				: Array.isArray(value)
					? value.join(", ")
					: value;
	}
	return redacted;
}

function redactQuery(params: URLSearchParams): Record<string, string> {
	const query: Record<string, string> = {};
	for (const [key, value] of params) {
		query[key] =
			SENSITIVE_QUERY_KEYS[key.toLowerCase()] === true ? "<redacted>" : value;
	}
	return query;
}

function writeCorsHeaders(response: ServerResponse): void {
	response.setHeader("access-control-allow-origin", "*");
	response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
	response.setHeader("access-control-allow-headers", "*");
}

function sendJson(
	response: ServerResponse,
	status: number,
	payload: unknown,
): void {
	if (response.headersSent) {
		response.destroy();
		return;
	}
	writeCorsHeaders(response);
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(payload));
}

function sendStubCompletion(response: ServerResponse, model: string): void {
	writeCorsHeaders(response);
	response.writeHead(200, { "content-type": "application/json" });
	response.end(
		JSON.stringify({
			id: "chatcmpl-record-only",
			object: "chat.completion",
			created: 0,
			model,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: RECORD_ONLY_STUB_TEXT },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			},
		}),
	);
}

function sendStubStream(response: ServerResponse, model: string): void {
	writeCorsHeaders(response);
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const base = {
		id: `chatcmpl-${randomUUID()}`,
		object: "chat.completion.chunk",
		created: 0,
		model,
	};
	response.write(
		`data: ${JSON.stringify({
			...base,
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: "" },
					finish_reason: null,
				},
			],
		})}\n\n`,
	);
	response.write(
		`data: ${JSON.stringify({
			...base,
			choices: [
				{
					index: 0,
					delta: { content: RECORD_ONLY_STUB_TEXT },
					finish_reason: null,
				},
			],
		})}\n\n`,
	);
	response.write(
		`data: ${JSON.stringify({
			...base,
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		})}\n\n`,
	);
	response.end("data: [DONE]\n\n");
}

/** 读取录制目录里的索引；用于比对工具与报告，不进入产品运行时。 */
export async function readPromptRecordIndex(
	dir: string,
): Promise<readonly PromptRecordSummary[]> {
	const text = await readFile(path.join(dir, "index.jsonl"), "utf8");
	return text
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as PromptRecordSummary);
}

export function readPromptRecordFile(
	dir: string,
	summary: PromptRecordSummary,
): Promise<PromptRecord> {
	if (summary.file === null) {
		throw new Error(`第 ${summary.seq} 条请求没有缓存正文`);
	}
	return readFile(path.join(dir, summary.file), "utf8").then(
		(text) => JSON.parse(text) as PromptRecord,
	);
}

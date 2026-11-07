import http from "node:http";
import type { AddressInfo } from "node:net";
import { StoryStore, getCoreVersion, isJsonObject } from "@dramaticer/core";
import {
	type SessionStore,
	assertBindAllowed,
	buildSessionCookie,
	createSessionStore,
	isAllowedOrigin,
	isUnsafeMethod,
	readSessionToken,
	verifyPassword,
} from "./auth.js";
import {
	HttpError,
	readJsonBody,
	sendEmpty,
	sendError,
	sendJson,
} from "./http.js";
import { resolveStaticFile, serveStaticFile } from "./static-files.js";

/** 角色卡以 base64 JSON 上传，这个上限要能装下一张卡。 */
export const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;

export interface StartServerOptions {
	readonly dbPath: string;
	readonly webRoot: string;
	readonly host: string;
	readonly port: number;
	readonly password: string | null;
	readonly maxJsonBodyBytes?: number;
	readonly log?: (line: string) => void;
}

export interface RunningServer {
	readonly origin: string;
	readonly store: StoryStore;
	close(): Promise<void>;
}

interface HandlerOptions {
	readonly store: StoryStore;
	readonly webRoot: string;
	readonly password: string | null;
	readonly sessions: SessionStore;
	readonly maxJsonBodyBytes: number;
	readonly log: (line: string) => void;
}

export async function startServer(
	options: StartServerOptions,
): Promise<RunningServer> {
	const password =
		options.password === null || options.password.length === 0
			? null
			: options.password;
	assertBindAllowed(options.host, password);
	const store = StoryStore.open(options.dbPath);
	const log = options.log ?? ((line: string) => console.log(line));
	const server = http.createServer(
		createRequestHandler({
			store,
			webRoot: options.webRoot,
			password,
			sessions: createSessionStore(),
			maxJsonBodyBytes: options.maxJsonBodyBytes ?? MAX_JSON_BODY_BYTES,
			log,
		}),
	);
	try {
		await listen(server, options.port, options.host);
	} catch (error) {
		store.close();
		throw error;
	}
	const address = server.address() as AddressInfo;
	const origin = `http://${formatHost(address.address)}:${address.port}`;
	let closed = false;
	return {
		origin,
		store,
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			const finished = Promise.withResolvers<void>();
			server.close((error) =>
				error ? finished.reject(error) : finished.resolve(),
			);
			server.closeAllConnections();
			await finished.promise;
			store.close();
		},
	};
}

function createRequestHandler(options: HandlerOptions): http.RequestListener {
	return (req, res) => {
		const startedAt = Date.now();
		handleRequest(req, res, options)
			.catch((error: unknown) => {
				if (res.headersSent) {
					res.destroy();
					return;
				}
				if (error instanceof HttpError) {
					sendError(
						res,
						error.status,
						error.code,
						error.message,
						error.details,
					);
					return;
				}
				options.log(
					`错误：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
				);
				sendError(res, 500, "internal", "服务器内部错误");
			})
			.finally(() => {
				const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
				options.log(
					`${req.method ?? "?"} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`,
				);
			});
	};
}

async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	options: HandlerOptions,
): Promise<void> {
	const method = req.method ?? "GET";
	if (
		isUnsafeMethod(method) &&
		!isAllowedOrigin(req.headers.origin, req.headers.host)
	) {
		throw new HttpError(403, "forbidden", "请求来源不被允许");
	}
	const url = parseRequestUrl(req, options.log);
	if (url.pathname === "/api/health") {
		requireMethod(method, ["GET"]);
		sendJson(res, 200, {
			status: "ok",
			version: getCoreVersion(),
			schemaVersion: options.store.getSchemaVersion(),
		});
		return;
	}
	if (url.pathname === "/api/login") {
		requireMethod(method, ["POST"]);
		if (options.password === null) {
			throw new HttpError(400, "bad_request", "服务没有设置访问密码");
		}
		const body = await readJsonBody(req, options.maxJsonBodyBytes);
		if (
			!isJsonObject(body) ||
			typeof body.password !== "string" ||
			body.password.length === 0
		) {
			throw new HttpError(400, "bad_request", "请求体缺少字符串字段 password", {
				path: "password",
			});
		}
		if (!verifyPassword(body.password, options.password)) {
			throw new HttpError(401, "unauthorized", "密码错误");
		}
		const token = options.sessions.create();
		sendEmpty(res, 204, { "Set-Cookie": buildSessionCookie(token) });
		return;
	}
	if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
		if (options.password !== null && !hasSession(req, options.sessions)) {
			throw new HttpError(401, "unauthorized", "需要先登录");
		}
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	if (method !== "GET" && method !== "HEAD") {
		throw new HttpError(405, "bad_request", `不支持的请求方法：${method}`);
	}
	const file = await resolveStaticFile(options.webRoot, url.pathname);
	if (file === null) {
		throw new HttpError(404, "not_found", "没有找到文件");
	}
	await serveStaticFile(res, file, method === "HEAD");
}

function parseRequestUrl(
	req: http.IncomingMessage,
	log: (line: string) => void,
): URL {
	try {
		return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	} catch {
		log(`无效的请求路径：${req.method ?? "?"}`);
		throw new HttpError(400, "bad_request", "请求路径不合法");
	}
}

function requireMethod(method: string, allowed: readonly string[]): void {
	if (!allowed.includes(method)) {
		throw new HttpError(405, "bad_request", `不支持的请求方法：${method}`);
	}
}

function hasSession(
	req: http.IncomingMessage,
	sessions: SessionStore,
): boolean {
	const token = readSessionToken(req.headers.cookie);
	return token !== null && sessions.has(token);
}

function listen(
	server: http.Server,
	port: number,
	host: string,
): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const onError = (error: Error): void => {
		server.off("listening", onListening);
		reject(error);
	};
	const onListening = (): void => {
		server.off("error", onError);
		resolve();
	};
	server.once("error", onError);
	server.once("listening", onListening);
	server.listen(port, host);
	return promise;
}

function formatHost(host: string): string {
	return host.includes(":") ? `[${host}]` : host;
}

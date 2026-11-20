import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
	AssistantDocsIndex,
	type AssistantSearchClient,
	type ImagesConfig,
	type LlmChannel,
	type LlmChannelConfig,
	type LlmChannelsConfig,
	StoryStore,
	createLlmChannel,
	emptyImagesConfig,
	getCoreVersion,
	isJsonObject,
	loadChannelsConfig,
	loadImagesConfig,
	readChannelWarnings,
} from "@dramaticer/core";
import { AssistantRuntimeManager } from "./assistant-runtime.js";
import {
	AssistantCompactionCoordinator,
	AssistantRunCoordinator,
} from "./assistant.js";
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
	type BackgroundRegistryFactory,
	BackgroundScheduler,
} from "./background.js";
import { repoRoot } from "./config.js";
import {
	HttpError,
	readJsonBody,
	sendEmpty,
	sendError,
	sendJson,
} from "./http.js";
import { handleApiRequest } from "./routes.js";
import {
	type RuntimeClientFactory,
	type RuntimeEmbedderFactory,
	StoryRuntimeManager,
} from "./runtime.js";
import { SSE_HEARTBEAT_MS } from "./sse.js";
import { resolveStaticFile, serveStaticFile } from "./static-files.js";
import { TurnCoordinator, TurnRunRegistry } from "./turns.js";

/** 角色卡以 base64 JSON 上传，这个上限要能装下一张卡。 */
export const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;

/** 渠道配置来源；模型客户端与 embedding 客户端都可以在测试里替换。 */
export interface ServerChannelsOptions {
	/** 渠道配置文件路径；渠道管理接口需要它才能读写。 */
	readonly path?: string;
	readonly load?: () => Promise<LlmChannelsConfig>;
	/** 解析 `${VAR}` 与报告密钥是否已设置时使用的环境变量。 */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** 设置页保存的密钥写到这个 env 文件；不设置时只能手动编辑 .env。 */
	readonly envFile?: string;
	/** 获取模型列表用；测试注入假实现。 */
	readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	readonly createClient?: RuntimeClientFactory;
	readonly createEmbedder?: RuntimeEmbedderFactory;
	/** 渠道体检用的适配器；测试注入假通道。 */
	readonly createChannel?: (config: LlmChannelConfig) => LlmChannel;
	readonly createBackgroundRegistry?: BackgroundRegistryFactory;
}

/** 生图配置文件来源；文件不存在时生图功能关闭。 */
export interface ServerImagesOptions {
	readonly path: string;
	/** 解析 `${VAR}` 使用的环境变量。 */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** 生成文件目录；默认是数据库文件同目录的 `images/`。 */
	readonly mediaDir?: string;
}

export interface StartServerOptions {
	readonly dbPath: string;
	readonly webRoot: string;
	readonly host: string;
	readonly port: number;
	readonly password: string | null;
	readonly maxJsonBodyBytes?: number;
	/** 不设置时不提供对话接口。 */
	readonly channels?: ServerChannelsOptions;
	/** 不设置时生图接口没有 provider，workflow 列表仍可读。 */
	readonly images?: ServerImagesOptions;
	/** 内置文档目录；默认是仓库根目录的 `docs/`，缺失或为空时启动失败。 */
	readonly docsRoot?: string;
	/** 显式开启资料员联网搜索；不设置时不注册 web_search。 */
	readonly assistantSearch?: AssistantSearchClient | null;
	readonly heartbeatMs?: number;
	readonly now?: () => number;
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
	readonly runtime: StoryRuntimeManager | null;
	readonly assistantRuntime: AssistantRuntimeManager | null;
	readonly assistantRuns: AssistantRunCoordinator;
	readonly assistantCompactions: AssistantCompactionCoordinator;
	readonly docsIndex: AssistantDocsIndex;
	readonly assistantSearch: AssistantSearchClient | null;
	readonly turns: TurnCoordinator;
	readonly runs: TurnRunRegistry;
	readonly scheduler: BackgroundScheduler | null;
	readonly channelsPath: string | null;
	readonly channelsEnv: Record<string, string | undefined>;
	readonly envFile: string | null;
	readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	readonly imagesPath: string | null;
	readonly imagesEnv: Readonly<Record<string, string | undefined>>;
	readonly imagesConfig: ImagesConfig;
	readonly imagesMediaDir: string;
	readonly createChannel: (config: LlmChannelConfig) => LlmChannel;
	readonly heartbeatMs: number;
	readonly now?: () => number;
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
	const log = options.log ?? ((line: string) => console.log(line));
	const docsIndex = await AssistantDocsIndex.load(
		options.docsRoot ?? path.join(repoRoot, "docs"),
	);
	const assistantSearch = options.assistantSearch ?? null;
	const channels = options.channels ?? null;
	const images = options.images ?? null;
	// 设置页保存的密钥要立即生效，所以环境变量用一份可写的表；测试传入的表复制一份再改。
	const channelsEnv: Record<string, string | undefined> =
		channels?.env === undefined ? process.env : { ...channels.env };
	const loadConfig =
		channels === null ? null : resolveChannelsLoader(channels, channelsEnv);
	// 新装环境还没有渠道文件时照常启动，由设置页的向导创建；文件写错了仍然启动失败。
	const channelsFileMissing =
		channels !== null &&
		channels.load === undefined &&
		channels.path !== undefined &&
		!existsSync(channels.path);
	if (channelsFileMissing) {
		log("还没有配置模型渠道：在「设置 · 模型与渠道」里添加");
	}
	const initialConfig =
		loadConfig === null || channelsFileMissing ? null : await loadConfig();
	if (initialConfig !== null) {
		for (const warning of readChannelWarnings(initialConfig)) {
			log(`渠道配置提醒：${warning}`);
		}
	}
	const imagesEnv = images?.env ?? channelsEnv;
	const imagesConfig =
		images === null
			? emptyImagesConfig()
			: await loadImagesConfig(images.path, imagesEnv);
	const imagesMediaDir =
		images?.mediaDir ?? path.join(path.dirname(options.dbPath), "images");
	const embeddingDimensions =
		initialConfig?.embeddings.get("default")?.dimensions;
	const store = StoryStore.open(
		options.dbPath,
		embeddingDimensions === undefined ? {} : { embeddingDimensions },
	);
	// 上一个进程在执行中途退出时留下的 running 行不在 drain 的候选里，先退回待办。
	store.requeueRunningBackgroundJobs();
	store.requeueRunningNodeImages();
	// 上一次进程留下的深回合运行没有结束，保留事件并标为中断。
	store.markInterruptedTurnRuns();
	// 助手运行不在进程里排队：上一次进程留下的 running 直接标为中断。
	store.markInterruptedAssistantConversations();
	const runtime =
		channels === null || loadConfig === null
			? null
			: new StoryRuntimeManager({
					store,
					loadConfig,
					createClient: channels.createClient,
					createEmbedder: channels.createEmbedder,
				});
	const assistantRuntime =
		channels === null || loadConfig === null
			? null
			: new AssistantRuntimeManager({
					loadConfig,
					createClient: channels.createClient,
					createEmbedder: channels.createEmbedder,
				});
	const assistantRuns = new AssistantRunCoordinator();
	const assistantCompactions = new AssistantCompactionCoordinator();
	const turns = new TurnCoordinator();
	const runs = new TurnRunRegistry();
	const scheduler =
		runtime === null
			? null
			: new BackgroundScheduler({
					store,
					runtime,
					...(channels?.createBackgroundRegistry === undefined
						? {}
						: { createRegistry: channels.createBackgroundRegistry }),
					illustrate:
						images === null
							? undefined
							: { config: imagesConfig, mediaDir: imagesMediaDir },
					log,
					...(options.now === undefined ? {} : { now: options.now }),
				});
	const server = http.createServer(
		createRequestHandler({
			store,
			webRoot: options.webRoot,
			password,
			sessions: createSessionStore(),
			maxJsonBodyBytes: options.maxJsonBodyBytes ?? MAX_JSON_BODY_BYTES,
			runtime,
			assistantRuntime,
			assistantRuns,
			assistantCompactions,
			docsIndex,
			assistantSearch,
			turns,
			runs,
			scheduler,
			channelsPath: channels?.path ?? null,
			channelsEnv,
			envFile: channels?.envFile ?? null,
			...(channels?.fetch === undefined ? {} : { fetch: channels.fetch }),
			imagesPath: images?.path ?? null,
			imagesEnv,
			imagesConfig,
			imagesMediaDir,
			createChannel: channels?.createChannel ?? createLlmChannel,
			heartbeatMs: options.heartbeatMs ?? SSE_HEARTBEAT_MS,
			now: options.now,
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
			await turns.abortAll();
			await assistantRuns.abortAll();
			await scheduler?.close();
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
		await handleApiRequest(req, res, url, method, {
			store: options.store,
			maxJsonBodyBytes: options.maxJsonBodyBytes,
			runtime: options.runtime,
			assistantRuntime: options.assistantRuntime,
			assistantRuns: options.assistantRuns,
			assistantCompactions: options.assistantCompactions,
			docsIndex: options.docsIndex,
			assistantSearch: options.assistantSearch,
			turns: options.turns,
			runs: options.runs,
			scheduler: options.scheduler,
			channelsPath: options.channelsPath,
			channelsEnv: options.channelsEnv,
			envFile: options.envFile,
			...(options.fetch === undefined ? {} : { fetch: options.fetch }),
			imagesPath: options.imagesPath,
			imagesEnv: options.imagesEnv,
			imagesConfig: options.imagesConfig,
			imagesMediaDir: options.imagesMediaDir,
			createChannel: options.createChannel,
			log: options.log,
			heartbeatMs: options.heartbeatMs,
			now: options.now,
		});
		return;
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

function resolveChannelsLoader(
	options: ServerChannelsOptions,
	env: Readonly<Record<string, string | undefined>>,
): () => Promise<LlmChannelsConfig> {
	if (options.load !== undefined) return options.load;
	const path = options.path;
	if (path === undefined) {
		throw new Error("channels 需要 path 或 load");
	}
	return () => loadChannelsConfig(path, env);
}

function formatHost(host: string): string {
	return host.includes(":") ? `[${host}]` : host;
}

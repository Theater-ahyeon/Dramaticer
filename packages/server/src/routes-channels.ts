// server 路由：渠道配置、渠道体检与助手读取的渠道快照（refactor/06 从 routes.ts 拆出）。
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type AssistantChannelsSnapshot,
	type JsonObject,
	LLM_MODEL_ROLE_NAMES,
	type LlmChannelsConfig,
	type LlmModelProbe,
	type LlmModelRole,
	applyChannelsUpdate,
	parseChannelsConfig,
	probeChannel,
	readChannelWarnings,
	readChannelsKeyRefs,
	resolveModelForRole,
	setModelProbeInText,
	validateRoleModelFamilies,
} from "@dramaticer/core";
import type {
	ChannelProbeResult,
	ChannelUpdateInput,
	ChannelsUpdateRequest,
	ChannelsView,
	EmbeddingUpdateInput,
	ModelUpdateInput,
} from "@dramaticer/protocol";
import { ENV_NAME_PATTERN, assertEnvValue, upsertEnvFile } from "./env-file.js";
import { HttpError, sendJson } from "./http.js";
import {
	assertKnownKeys,
	fieldError,
	readObjectBody,
	requireMethod,
	requireObject,
	requireText,
} from "./routes-common.js";
import type { ApiRouteOptions } from "./routes.js";

export async function handleChannels(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	requireMethod(method, ["GET", "PUT"]);
	if (options.channelsPath === null) {
		throw new HttpError(
			404,
			"not_found",
			"服务没有配置渠道文件，渠道管理接口不可用",
		);
	}
	const filePath = options.channelsPath;
	if (method === "GET") {
		const text = await readChannelsText(filePath);
		// 新装环境还没有渠道文件：返回空视图，由设置页的向导创建。
		if (text.trim().length === 0) {
			sendJson(res, 200, emptyChannelsView());
			return;
		}
		const config = parseChannelsText(text, options, filePath);
		sendJson(res, 200, buildChannelsView(text, config, options));
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	const update = readChannelsUpdate(body, options.channelsEnv);
	const existing = await readChannelsText(filePath);
	const text = existing.trim().length === 0 ? EMPTY_CHANNELS_YAML : existing;
	let candidate: string;
	try {
		candidate = applyChannelsUpdate(text, update, filePath);
	} catch (error) {
		throw configError(error, filePath);
	}
	const config = parseChannelsText(candidate, options, filePath);
	assertChannelsUsable(config);
	await writeChannelsText(filePath, candidate);
	sendJson(res, 200, buildChannelsView(candidate, config, options));
}

/** 助手批准渠道动作时复用同一套解析、校验与写文件路径。 */
export async function applyChannelsActionPayload(
	payload: JsonObject,
	options: ApiRouteOptions,
): Promise<void> {
	if (options.channelsPath === null) {
		throw new HttpError(
			404,
			"not_found",
			"服务没有配置渠道文件，渠道动作无法批准",
		);
	}
	const filePath = options.channelsPath;
	const update = readChannelsUpdate(
		payload as unknown as Record<string, unknown>,
		options.channelsEnv,
	);
	const text = await readChannelsText(filePath);
	let candidate: string;
	try {
		candidate = applyChannelsUpdate(text, update, filePath);
	} catch (error) {
		throw configError(error, filePath);
	}
	const config = parseChannelsText(candidate, options, filePath);
	assertChannelsUsable(config);
	await writeChannelsText(filePath, candidate);
}

export async function handleChannelProbe(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	if (options.channelsPath === null) {
		throw new HttpError(
			404,
			"not_found",
			"服务没有配置渠道文件，渠道管理接口不可用",
		);
	}
	const filePath = options.channelsPath;
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["alias", "role", "channel"]);
	const text = await readChannelsText(filePath);
	const config = parseChannelsText(text, options, filePath);
	const alias = probeAlias(config, body);
	const model = config.models.get(alias);
	if (model === undefined) {
		throw fieldError("alias", `没有模型 ${alias}`);
	}
	const channelId =
		body.channel === undefined
			? model.channels[0]
			: requireText(body.channel, "channel");
	if (channelId === undefined) {
		throw fieldError("channel", `模型 ${alias} 没有配置渠道`);
	}
	if (!model.channels.includes(channelId)) {
		throw fieldError("channel", `模型 ${alias} 没有配置渠道 ${channelId}`);
	}
	const channelConfig = config.channels.get(channelId);
	if (channelConfig === undefined) {
		throw fieldError("channel", `没有渠道 ${channelId}`);
	}
	let probe: LlmModelProbe;
	try {
		probe = await probeChannel({
			channel: options.createChannel(channelConfig),
			model: {
				id: model.id,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
			},
			...(options.now === undefined ? {} : { now: options.now }),
		});
	} catch (error) {
		throw new HttpError(
			400,
			"bad_request",
			`渠道体检失败：${error instanceof Error ? error.message : String(error)}`,
			{ path: "alias" },
		);
	}
	let candidate: string;
	try {
		candidate = setModelProbeInText(text, alias, probe, filePath);
	} catch (error) {
		throw configError(error, filePath);
	}
	await writeChannelsText(filePath, candidate);
	const result: ChannelProbeResult = { alias, channel: channelId, probe };
	sendJson(res, 200, result);
}

/** 体检目标：直接给模型别名，或给岗位、取它当前生效的模型。 */
export function probeAlias(
	config: LlmChannelsConfig,
	body: Readonly<Record<string, unknown>>,
): string {
	if (body.role === undefined) return requireText(body.alias, "alias");
	if (body.alias !== undefined) {
		throw fieldError("role", "alias 与 role 只能给一个");
	}
	const role = requireText(body.role, "role");
	if (!(LLM_MODEL_ROLE_NAMES as readonly string[]).includes(role)) {
		throw fieldError("role", `不是已知岗位：${role}`);
	}
	try {
		return resolveModelForRole(config, role as LlmModelRole);
	} catch (error) {
		throw fieldError(
			"role",
			error instanceof Error ? error.message : String(error),
		);
	}
}

const EMPTY_CHANNELS_YAML = "channels: {}\nmodels: {}\nroles: {}\n";

function emptyChannelsView(): ChannelsView {
	return {
		channels: [],
		models: [],
		embeddings: [],
		roles: Object.fromEntries(
			LLM_MODEL_ROLE_NAMES.map((role) => [role, null]),
		) as Record<LlmModelRole, string | null>,
		configuredRoles: {},
		warnings: [],
	};
}

/** 读渠道配置文本；文件不存在时返回空字符串（新装环境）。 */
export async function readChannelsText(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return "";
		}
		throw new HttpError(
			400,
			"bad_request",
			`读取渠道配置失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function writeChannelsText(
	filePath: string,
	text: string,
): Promise<void> {
	const tempPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		await writeFile(tempPath, text, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => undefined);
		throw new HttpError(
			500,
			"internal",
			`写入渠道配置失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function parseChannelsText(
	text: string,
	options: ApiRouteOptions,
	filePath: string,
): LlmChannelsConfig {
	try {
		return parseChannelsConfig(text, options.channelsEnv, filePath);
	} catch (error) {
		throw configError(error, filePath);
	}
}

/**
 * 评测裁判与正文同家族只影响评测的公正，不影响游玩；只接一家供应商的玩家必然同家族，
 * 所以保存时只提醒、不拒绝。评测命令自己仍按严格规则检查。
 */
function familyWarning(config: LlmChannelsConfig): string | null {
	try {
		validateRoleModelFamilies(config);
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `${message}。只影响评测是否公正，不影响游玩`;
	}
}

export function assertChannelsUsable(config: LlmChannelsConfig): void {
	for (const role of LLM_MODEL_ROLE_NAMES) {
		try {
			resolveModelForRole(config, role);
		} catch (error) {
			throw fieldError(
				`roles.${role}`,
				error instanceof Error ? error.message : String(error),
			);
		}
	}
}

export function configError(error: unknown, filePath: string): HttpError {
	if (error instanceof HttpError) return error;
	const message = error instanceof Error ? error.message : String(error);
	const prefix = `${filePath}.`;
	if (!message.startsWith(prefix)) {
		return new HttpError(400, "bad_request", message);
	}
	const match = /^\S+/.exec(message.slice(prefix.length));
	if (match === null) {
		return new HttpError(400, "bad_request", message);
	}
	return fieldError(match[0], message);
}

export function buildChannelsView(
	text: string,
	config: LlmChannelsConfig,
	options: ApiRouteOptions,
): ChannelsView {
	const refs = readChannelsKeyRefs(
		text,
		options.channelsPath ?? "channels.yaml",
	);
	const env = options.channelsEnv;
	return {
		channels: [...config.channels.values()].map((channel) => {
			const envName = refs.channels.get(channel.id) ?? null;
			return {
				id: channel.id,
				api: channel.api,
				baseUrl: channel.baseUrl,
				apiKeyEnv: envName,
				apiKeySet: envName === null ? true : (env[envName] ?? "").length > 0,
				requestsPerMinute: channel.requestsPerMinute,
				maxRetries: channel.maxRetries,
				retryBaseDelayMs: channel.retryBaseDelayMs,
				timeoutMs: channel.timeoutMs,
			};
		}),
		models: [...config.models.values()].map((model) => ({
			alias: model.alias,
			id: model.id,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			reasoning: model.reasoning,
			enabled: model.enabled,
			channels: [...model.channels],
			probe: model.probe,
			fallback: model.fallback ?? null,
		})),
		embeddings: [...config.embeddings.values()].map((embedding) => {
			const envName = refs.embeddings.get(embedding.id) ?? null;
			return {
				id: embedding.id,
				api: embedding.api,
				baseUrl: embedding.baseUrl,
				apiKeyEnv: envName,
				apiKeySet: envName === null ? true : (env[envName] ?? "").length > 0,
				model: embedding.model,
				dimensions: embedding.dimensions,
				batchSize: embedding.batchSize,
				requestsPerMinute: embedding.requestsPerMinute,
				maxRetries: embedding.maxRetries,
				retryBaseDelayMs: embedding.retryBaseDelayMs,
				timeoutMs: embedding.timeoutMs,
			};
		}),
		roles: Object.fromEntries(
			LLM_MODEL_ROLE_NAMES.map((role) => {
				try {
					return [role, resolveModelForRole(config, role)];
				} catch {
					return [role, config.roles.get(role) ?? null];
				}
			}),
		) as Record<LlmModelRole, string | null>,
		configuredRoles: Object.fromEntries(config.roles.entries()) as Partial<
			Record<LlmModelRole, string>
		>,
		warnings: [
			...readChannelWarnings(config),
			...(familyWarning(config) === null
				? []
				: [familyWarning(config) as string]),
		],
	};
}

/** 设置向导读取渠道：只返回非敏感字段，密钥值不进入工具结果。 */
export async function readAssistantChannelsSnapshot(
	options: ApiRouteOptions,
): Promise<AssistantChannelsSnapshot> {
	if (options.channelsPath === null) {
		throw new HttpError(
			404,
			"not_found",
			"服务没有配置渠道文件，渠道读取不可用",
		);
	}
	const filePath = options.channelsPath;
	const text = await readChannelsText(filePath);
	const config = parseChannelsText(text, options, filePath);
	const refs = readChannelsKeyRefs(text, filePath);
	const env = options.channelsEnv;
	return {
		channels: [...config.channels.values()].map((channel) => {
			const envName = refs.channels.get(channel.id) ?? null;
			return {
				id: channel.id,
				api: channel.api,
				baseUrl: channel.baseUrl,
				apiKeyEnv: envName,
				apiKeySet: envName === null ? true : (env[envName] ?? "").length > 0,
				requestsPerMinute: channel.requestsPerMinute,
				maxRetries: channel.maxRetries,
				retryBaseDelayMs: channel.retryBaseDelayMs,
				timeoutMs: channel.timeoutMs,
			};
		}),
		models: [...config.models.values()].map((model) => ({
			alias: model.alias,
			id: model.id,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			reasoning: model.reasoning,
			enabled: model.enabled,
			channels: [...model.channels],
		})),
		embeddings: [...config.embeddings.values()].map((embedding) => {
			const envName = refs.embeddings.get(embedding.id) ?? null;
			return {
				id: embedding.id,
				api: embedding.api,
				baseUrl: embedding.baseUrl,
				apiKeyEnv: envName,
				apiKeySet: envName === null ? true : (env[envName] ?? "").length > 0,
				model: embedding.model,
				dimensions: embedding.dimensions,
				batchSize: embedding.batchSize,
				requestsPerMinute: embedding.requestsPerMinute,
				maxRetries: embedding.maxRetries,
				retryBaseDelayMs: embedding.retryBaseDelayMs,
				timeoutMs: embedding.timeoutMs,
			};
		}),
		roles: Object.fromEntries(
			LLM_MODEL_ROLE_NAMES.map((role) => {
				try {
					return [role, resolveModelForRole(config, role)];
				} catch {
					return [role, config.roles.get(role) ?? null];
				}
			}),
		) as Record<string, string | null>,
		configuredRoles: Object.fromEntries(config.roles.entries()),
	};
}

export const CHANNEL_UPDATE_KEYS = [
	"api",
	"baseUrl",
	"apiKeyEnv",
	"requestsPerMinute",
	"maxRetries",
	"retryBaseDelayMs",
	"timeoutMs",
] as const;

export const MODEL_UPDATE_KEYS = [
	"id",
	"contextWindow",
	"maxTokens",
	"reasoning",
	"enabled",
	"channels",
] as const;

export const EMBEDDING_UPDATE_KEYS = [
	"api",
	"baseUrl",
	"apiKeyEnv",
	"model",
	"dimensions",
	"batchSize",
	"requestsPerMinute",
	"maxRetries",
	"retryBaseDelayMs",
	"timeoutMs",
] as const;

export function readChannelsUpdate(
	body: Record<string, unknown>,
	env: Readonly<Record<string, string | undefined>>,
): ChannelsUpdateRequest {
	assertKnownKeys(body, ["channels", "models", "embeddings", "roles"]);
	const channels = readUpdateSection(body.channels, "channels", (value, path) =>
		readChannelUpdate(value, path, env),
	);
	const models = readUpdateSection(body.models, "models", (value, path) =>
		readModelUpdate(value, path, env),
	);
	const embeddings = readUpdateSection(
		body.embeddings,
		"embeddings",
		(value, path) => readEmbeddingUpdate(value, path, env),
	);
	const roles = readRolesUpdate(body.roles, models);
	for (const [alias, model] of Object.entries(models)) {
		const seen = new Set<string>();
		for (const channelId of model.channels) {
			if (!(channelId in channels)) {
				throw fieldError(
					`models.${alias}.channels`,
					`模型 ${alias} 引用了不存在的渠道 ${channelId}`,
				);
			}
			if (seen.has(channelId)) {
				throw fieldError(
					`models.${alias}.channels`,
					`模型 ${alias} 重复引用了渠道 ${channelId}`,
				);
			}
			seen.add(channelId);
		}
	}
	return { channels, models, embeddings, roles };
}

export function readUpdateSection<T>(
	value: unknown,
	path: string,
	readEntry: (value: unknown, path: string) => T,
): Record<string, T> {
	const raw = requireObject(value, path);
	const result: Record<string, T> = {};
	for (const [id, entry] of Object.entries(raw)) {
		if (id.trim().length === 0) {
			throw fieldError(path, `${path} 里的名字不能为空`);
		}
		result[id] = readEntry(entry, `${path}.${id}`);
	}
	return result;
}

export function readChannelUpdate(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): ChannelUpdateInput {
	const raw = requireObject(value, path);
	assertKnownKeys(raw, CHANNEL_UPDATE_KEYS, path);
	const api = raw.api;
	if (
		api !== "openai-completions" &&
		api !== "google-generative-ai" &&
		api !== "google-vertex"
	) {
		throw fieldError(
			`${path}.api`,
			`${path}.api 只能是 openai-completions、google-generative-ai 或 google-vertex`,
		);
	}
	return {
		api,
		baseUrl: requireEnvText(raw.baseUrl, `${path}.baseUrl`, env),
		apiKeyEnv: readEnvName(raw.apiKeyEnv, `${path}.apiKeyEnv`, env),
		requestsPerMinute: requireInteger(
			raw.requestsPerMinute,
			`${path}.requestsPerMinute`,
			0,
		),
		maxRetries: requireInteger(raw.maxRetries, `${path}.maxRetries`, 0),
		retryBaseDelayMs: requireInteger(
			raw.retryBaseDelayMs,
			`${path}.retryBaseDelayMs`,
			0,
		),
		timeoutMs: requireInteger(raw.timeoutMs, `${path}.timeoutMs`, 1),
	};
}

export function readModelUpdate(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): ModelUpdateInput {
	const raw = requireObject(value, path);
	assertKnownKeys(raw, MODEL_UPDATE_KEYS, path);
	const rawChannels = raw.channels;
	if (!Array.isArray(rawChannels) || rawChannels.length === 0) {
		throw fieldError(`${path}.channels`, `${path}.channels 必须是非空数组`);
	}
	const channels: string[] = [];
	for (const item of rawChannels) {
		if (typeof item !== "string" || item.trim().length === 0) {
			throw fieldError(`${path}.channels`, `${path}.channels 里只能写渠道 id`);
		}
		channels.push(item.trim());
	}
	const reasoning = raw.reasoning;
	if (typeof reasoning !== "boolean") {
		throw fieldError(`${path}.reasoning`, `${path}.reasoning 必须是布尔值`);
	}
	const enabled = raw.enabled;
	if (typeof enabled !== "boolean") {
		throw fieldError(`${path}.enabled`, `${path}.enabled 必须是布尔值`);
	}
	return {
		id: requireEnvText(raw.id, `${path}.id`, env),
		contextWindow: requireInteger(
			raw.contextWindow,
			`${path}.contextWindow`,
			1,
		),
		maxTokens: requireInteger(raw.maxTokens, `${path}.maxTokens`, 1),
		reasoning,
		enabled,
		channels,
	};
}

export function readEmbeddingUpdate(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): EmbeddingUpdateInput {
	const raw = requireObject(value, path);
	assertKnownKeys(raw, EMBEDDING_UPDATE_KEYS, path);
	if (raw.api !== "openai-embeddings") {
		throw fieldError(`${path}.api`, `${path}.api 只能是 openai-embeddings`);
	}
	return {
		api: "openai-embeddings",
		baseUrl: requireEnvText(raw.baseUrl, `${path}.baseUrl`, env),
		apiKeyEnv: readEnvName(raw.apiKeyEnv, `${path}.apiKeyEnv`, env),
		model: requireEnvText(raw.model, `${path}.model`, env),
		dimensions: requireInteger(raw.dimensions, `${path}.dimensions`, 1),
		batchSize: requireInteger(raw.batchSize, `${path}.batchSize`, 1),
		requestsPerMinute: requireInteger(
			raw.requestsPerMinute,
			`${path}.requestsPerMinute`,
			0,
		),
		maxRetries: requireInteger(raw.maxRetries, `${path}.maxRetries`, 0),
		retryBaseDelayMs: requireInteger(
			raw.retryBaseDelayMs,
			`${path}.retryBaseDelayMs`,
			0,
		),
		timeoutMs: requireInteger(raw.timeoutMs, `${path}.timeoutMs`, 1),
	};
}

export function readRolesUpdate(
	value: unknown,
	models: Readonly<Record<string, ModelUpdateInput>>,
): Readonly<Partial<Record<LlmModelRole, string>>> {
	const raw = value === undefined ? {} : requireObject(value, "roles");
	const roles: Partial<Record<LlmModelRole, string>> = {};
	for (const [name, aliasValue] of Object.entries(raw)) {
		if (!(LLM_MODEL_ROLE_NAMES as readonly string[]).includes(name)) {
			throw fieldError(
				`roles.${name}`,
				`roles.${name} 不是已知角色，只能是 ${LLM_MODEL_ROLE_NAMES.join("、")}`,
			);
		}
		const alias = requireText(aliasValue, `roles.${name}`);
		const model = models[alias];
		if (model === undefined) {
			throw fieldError(
				`roles.${name}`,
				`roles.${name} 引用了不存在的模型 ${alias}`,
			);
		}
		if (!model.enabled) {
			throw fieldError(
				`roles.${name}`,
				`roles.${name} 指向的模型 ${alias} 已经被停用`,
			);
		}
		roles[name as LlmModelRole] = alias;
	}
	return roles;
}

export function readEnvName(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): string {
	if (typeof value !== "string") {
		throw fieldError(path, `${path} 必须是字符串`);
	}
	const name = value.trim();
	if (name.length === 0) return "";
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
		throw fieldError(path, `${path} 只接受环境变量名，不接受密钥值`);
	}
	if (env[name] === undefined) {
		throw fieldError(path, `${path} 引用的环境变量 ${name} 没有设置`);
	}
	return name;
}

export function requireEnvText(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): string {
	const text = requireText(value, path);
	for (const match of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
		const name = match[1] as string;
		if (env[name] === undefined) {
			throw fieldError(path, `${path} 引用的环境变量 ${name} 没有设置`);
		}
	}
	return text;
}

export function requireInteger(
	value: unknown,
	path: string,
	minimum: number,
): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < minimum
	) {
		throw fieldError(path, `${path} 必须是不小于 ${minimum} 的整数`);
	}
	return value;
}

/**
 * `POST /api/channels/keys`：保存一个密钥到服务端读取的 env 文件并立即生效。
 * 响应只说明已设置，永远不回传密钥值。
 */
export async function handleChannelKey(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	if (options.envFile === null) {
		throw new HttpError(
			404,
			"not_found",
			"服务没有配置密钥文件，只能手动在 .env 里填写",
		);
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["name", "value"]);
	const name = requireText(body.name, "name");
	if (!ENV_NAME_PATTERN.test(name)) {
		throw fieldError("name", "名字只能是大写字母、数字与下划线，以字母开头");
	}
	if (typeof body.value !== "string" || body.value.trim().length === 0) {
		throw fieldError("value", "密钥不能为空");
	}
	const value = body.value.trim();
	try {
		assertEnvValue(value);
	} catch (error) {
		throw fieldError(
			"value",
			error instanceof Error ? error.message : String(error),
		);
	}
	await upsertEnvFile(options.envFile, name, value);
	options.channelsEnv[name] = value;
	sendJson(res, 200, { name, set: true });
}

const MODEL_LIST_TIMEOUT_MS = 15_000;

/**
 * `POST /api/channels/models`：用给定地址与已保存的密钥向供应商要模型列表，
 * 供设置页的向导选择。只读，不改配置。
 */
export async function handleChannelModelList(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["api", "baseUrl", "apiKeyEnv"]);
	const api = requireText(body.api, "api");
	if (api !== "openai-completions" && api !== "google-generative-ai") {
		throw fieldError(
			"api",
			"只有 OpenAI 兼容与 Gemini 接口支持自动获取模型列表",
		);
	}
	const baseUrl = requireText(body.baseUrl, "baseUrl").replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw fieldError("baseUrl", "地址不是合法的 URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw fieldError("baseUrl", "地址只能是 http 或 https");
	}
	const envName = requireText(body.apiKeyEnv, "apiKeyEnv");
	const key = options.channelsEnv[envName];
	if (key === undefined || key.length === 0) {
		throw fieldError("apiKeyEnv", `密钥 ${envName} 还没有设置`);
	}
	const headers: Record<string, string> =
		api === "google-generative-ai"
			? { "x-goog-api-key": key }
			: { Authorization: `Bearer ${key}` };
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
	let response: Response;
	try {
		response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
			headers,
			signal: controller.signal,
		});
	} catch (error) {
		throw new HttpError(
			502,
			"upstream_error",
			controller.signal.aborted
				? "获取模型列表超时"
				: `连不上 ${parsed.host}：${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) {
		throw new HttpError(
			502,
			"upstream_error",
			response.status === 401 || response.status === 403
				? "密钥被拒绝（401/403），请检查密钥是否正确"
				: `获取模型列表失败：${parsed.host} 返回 ${response.status}`,
		);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new HttpError(502, "upstream_error", "模型列表不是 JSON");
	}
	sendJson(res, 200, { models: readModelIds(payload) });
}

/** OpenAI 格式 `{data:[{id}]}`；Gemini 格式 `{models:[{name:"models/x"}]}`。 */
function readModelIds(payload: unknown): string[] {
	const ids = new Set<string>();
	if (typeof payload === "object" && payload !== null) {
		const record = payload as Record<string, unknown>;
		const list = Array.isArray(record.data)
			? record.data
			: Array.isArray(record.models)
				? record.models
				: [];
		for (const item of list) {
			if (typeof item !== "object" || item === null) continue;
			const entry = item as Record<string, unknown>;
			const id =
				typeof entry.id === "string"
					? entry.id
					: typeof entry.name === "string"
						? entry.name.replace(/^models\//, "")
						: null;
			if (id !== null && id.length > 0) ids.add(id);
		}
	}
	return [...ids].sort();
}

import { readFile, writeFile } from "node:fs/promises";
import { parseDocument, parse as parseYaml } from "yaml";
import {
	interpolateEnvRefs as interpolate,
	parseApiKeyRef as parseApiKey,
} from "../env-ref.js";
import { isJsonObject } from "../json.js";

export type LlmChannelApi =
	| "openai-completions"
	| "google-generative-ai"
	| "google-vertex";

export type LlmProbeSupport = "supported" | "unsupported" | "unknown";

export type LlmProbeStreaming = "streaming" | "buffered" | "unknown";

/** 渠道体检的结果，写在模型配置的 probe 字段里。 */
export interface LlmModelProbe {
	readonly probedAt: string;
	readonly channel: string;
	readonly modelId: string;
	readonly streaming: LlmProbeStreaming;
	readonly functionCalling: LlmProbeSupport;
	readonly thinking: LlmProbeSupport;
	readonly prefill: LlmProbeSupport;
	readonly usage: LlmProbeSupport;
	readonly cacheStats: LlmProbeSupport;
	/** 结构化输出优先使用的传输方式。 */
	readonly structuredOutput: "function-call" | "text-tags";
	readonly notes: readonly string[];
}

export interface LlmChannelConfig {
	readonly id: string;
	readonly api: LlmChannelApi;
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

/** 工具调用的传输方式：原生函数调用，或正文里的 `<tool>` 文本协议。 */
export const LLM_TOOL_TRANSPORTS = ["native", "text"] as const;

export type LlmToolTransport = (typeof LLM_TOOL_TRANSPORTS)[number];

export function isToolTransport(value: unknown): value is LlmToolTransport {
	return (
		typeof value === "string" &&
		(LLM_TOOL_TRANSPORTS as readonly string[]).includes(value)
	);
}

export function assertToolTransport(
	value: unknown,
	label = "工具传输方式",
): LlmToolTransport {
	if (!isToolTransport(value)) {
		throw new Error(`${label}只能是 native、text：${String(value)}`);
	}
	return value;
}

/** 模型对工具调用传输的显式配置；没有配置时按体检结果选择默认值。 */
export interface LlmModelToolsConfig {
	readonly transport: LlmToolTransport;
}

export interface LlmModelConfig {
	readonly alias: string;
	readonly id: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly reasoning: boolean;
	/** 停用的模型不能被选为故事模型或角色目标。 */
	readonly enabled: boolean;
	/** 渠道 id，按优先级从高到低。 */
	readonly channels: readonly string[];
	/** 显式配置的工具传输；没有配置时为 null，由体检结果决定。 */
	readonly tools: LlmModelToolsConfig | null;
	/** 上次渠道体检的结果；没有跑过时为 null。 */
	readonly probe: LlmModelProbe | null;
}

/** 按岗位区分的模型角色。 */
export const LLM_MODEL_ROLE_NAMES = [
	"writer",
	"settler",
	"planner",
	"judge",
] as const;

export type LlmModelRole = (typeof LLM_MODEL_ROLE_NAMES)[number];

export interface LlmChannelsConfig {
	readonly channels: ReadonlyMap<string, LlmChannelConfig>;
	readonly models: ReadonlyMap<string, LlmModelConfig>;
	/** 角色名到模型别名的映射；没有配置的角色走缺省回落。 */
	readonly roles: ReadonlyMap<LlmModelRole, string>;
	readonly embeddings: ReadonlyMap<string, EmbeddingProviderConfig>;
	/** 重排序渠道；没有配置时为 null。 */
	readonly reranker: RerankerProviderConfig | null;
}

export type EmbeddingApi = "openai-embeddings";

export interface EmbeddingProviderConfig {
	readonly id: string;
	readonly api: EmbeddingApi;
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
	readonly dimensions: number;
	readonly batchSize: number;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

export type RerankerApi = "openai-rerank";

/** 重排序渠道；`enabled` 默认关闭，评测确认有提升后再打开。 */
export interface RerankerProviderConfig {
	readonly id: string;
	readonly api: RerankerApi;
	readonly enabled: boolean;
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
	readonly batchSize: number;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

const DEFAULT_REQUESTS_PER_MINUTE = 30;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_RERANK_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 131_072;
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * 读取渠道配置。字符串里的 `${VAR}` 在解析时替换成环境变量，
 * apiKey 必须写成这种引用，避免密钥写进可提交的配置文件。
 */
export async function loadChannelsConfig(
	filePath: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<LlmChannelsConfig> {
	let text: string;
	try {
		text = await readFile(filePath, "utf8");
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			throw new Error(
				`没有找到渠道配置 ${filePath}；可以复制仓库根目录的 channels.example.yaml`,
				{ cause: error },
			);
		}
		throw error;
	}
	return parseChannelsConfig(text, env, filePath);
}

/** 没有指定模型时选默认别名：优先 `main`，其次配置里唯一启用的模型。 */
export function pickDefaultModelAlias(
	config: LlmChannelsConfig,
	preferred = "main",
): string {
	const enabled = [...config.models.values()].filter((model) => model.enabled);
	if (enabled.length === 0) {
		throw new Error("渠道配置里没有启用的模型");
	}
	if (config.models.get(preferred)?.enabled === true) return preferred;
	if (enabled.length === 1) {
		return (enabled[0] as LlmModelConfig).alias;
	}
	throw new Error(
		`渠道配置里有多个启用的模型，请指定模型：${enabled
			.map((model) => model.alias)
			.join("、")}`,
	);
}

const ROLE_FALLBACK_ALIASES: Readonly<Record<LlmModelRole, string>> = {
	writer: "main",
	settler: "background",
	planner: "background",
	judge: "background",
};

/**
 * 按角色取模型别名。没有配置的角色回落到 `main`（writer）或
 * `background`（其余角色）；回落目标不存在或模型已停用时直接抛错。
 */
export function resolveModelForRole(
	config: LlmChannelsConfig,
	role: LlmModelRole,
): string {
	const configured = config.roles.get(role);
	const alias = configured ?? ROLE_FALLBACK_ALIASES[role];
	const model = config.models.get(alias);
	if (model === undefined) {
		if (configured !== undefined) {
			throw new Error(`角色 ${role} 指向的模型 ${alias} 不存在`);
		}
		throw new Error(`角色 ${role} 没有配置模型，回落的 ${alias} 模型也不存在`);
	}
	if (!model.enabled) {
		throw new Error(`角色 ${role} 指向的模型 ${alias} 已经被停用`);
	}
	return alias;
}

/**
 * 工具传输的生效值：显式配置优先；没有配置时由渠道体检决定，
 * 体检报告函数调用不支持就走文本协议，其余（含没跑过体检）走原生函数调用。
 */
export function resolveToolTransport(model: LlmModelConfig): LlmToolTransport {
	if (model.tools !== null) return model.tools.transport;
	return model.probe?.functionCalling === "unsupported" ? "text" : "native";
}

/** 故事设置没有保存过时使用的输出上限：不超过 4,096 token。 */
export const DEFAULT_OUTPUT_MAX_TOKENS = 4_096;

/**
 * 故事设置 `maxTokens` 的缺省值：4,096 与模型在渠道配置里声明的
 * 输出上限取小；模型不在配置里时抛错。
 */
export function resolveDefaultMaxTokens(
	config: LlmChannelsConfig,
	modelAlias: string,
): number {
	const model = config.models.get(modelAlias);
	if (model === undefined) {
		throw new Error(`没有配置模型 ${modelAlias}`);
	}
	return Math.min(DEFAULT_OUTPUT_MAX_TOKENS, model.maxTokens);
}

const MODEL_FAMILY_KEYWORDS: readonly (readonly [string, readonly string[]])[] =
	[
		["gemini", ["gemini", "gemma"]],
		["deepseek", ["deepseek"]],
		["gpt", ["gpt"]],
		["claude", ["claude"]],
		["qwen", ["qwen"]],
		["kimi", ["kimi"]],
		["glm", ["glm"]],
		["llama", ["llama"]],
		["mistral", ["mistral"]],
		["grok", ["grok"]],
	];

/**
 * 从模型名映射家族，用来判断裁判与写作是否来自同一家族。
 * 映射不到时返回完整模型名，按名称逐字比较。
 */
export function modelFamily(modelId: string): string {
	const lowered = modelId.toLowerCase();
	for (const [family, keywords] of MODEL_FAMILY_KEYWORDS) {
		if (keywords.some((keyword) => lowered.includes(keyword))) return family;
	}
	return modelId.trim();
}

/**
 * 创建路由前校验：评测裁判与写作必须来自不同模型家族。
 * 两个角色都取实际生效的模型（含缺省回落）；任一角色没有可用模型时跳过。
 */
export function validateRoleModelFamilies(config: LlmChannelsConfig): void {
	const judgeAlias =
		config.roles.get("judge") ??
		(config.models.has("background") ? "background" : null);
	const writerAlias =
		config.roles.get("writer") ?? (config.models.has("main") ? "main" : null);
	if (judgeAlias === null || writerAlias === null) return;
	const judgeModel = config.models.get(judgeAlias);
	const writerModel = config.models.get(writerAlias);
	if (judgeModel === undefined || writerModel === undefined) {
		throw new Error("渠道配置里的角色引用了不存在的模型");
	}
	const judgeFamily = modelFamily(judgeModel.id);
	if (judgeFamily !== modelFamily(writerModel.id)) return;
	throw new Error(
		`角色 judge 与 writer 必须使用不同的模型家族：judge 用 ${judgeAlias}（${judgeModel.id}），writer 用 ${writerAlias}（${writerModel.id}），两者都属于 ${judgeFamily} 家族`,
	);
}

export function parseChannelsConfig(
	text: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
	label = "channels.yaml",
): LlmChannelsConfig {
	const root = parseYaml(text);
	if (!isJsonObject(root)) {
		throw new Error(`${label} 的顶层必须是对象`);
	}
	const rawChannels = requireObject(root.channels, `${label}.channels`);
	const rawModels = requireObject(root.models, `${label}.models`);
	const channels = new Map<string, LlmChannelConfig>();
	for (const [id, value] of Object.entries(rawChannels)) {
		channels.set(id, parseChannel(id, value, env, `${label}.channels.${id}`));
	}
	if (channels.size === 0) {
		throw new Error(`${label}.channels 不能为空`);
	}
	const models = new Map<string, LlmModelConfig>();
	for (const [alias, value] of Object.entries(rawModels)) {
		models.set(
			alias,
			parseModel(alias, value, channels, env, `${label}.models.${alias}`),
		);
	}
	if (models.size === 0) {
		throw new Error(`${label}.models 不能为空`);
	}
	const roles = parseRoles(root.roles, models, label);
	const rawEmbeddings =
		root.embeddings === undefined
			? {}
			: requireObject(root.embeddings, `${label}.embeddings`);
	const embeddings = new Map<string, EmbeddingProviderConfig>();
	for (const [alias, value] of Object.entries(rawEmbeddings)) {
		embeddings.set(
			alias,
			parseEmbedding(alias, value, env, `${label}.embeddings.${alias}`),
		);
	}
	const reranker =
		root.reranker === undefined
			? null
			: parseReranker(root.reranker, env, `${label}.reranker`);
	return { channels, models, roles, embeddings, reranker };
}

function parseRoles(
	value: unknown,
	models: ReadonlyMap<string, LlmModelConfig>,
	label: string,
): ReadonlyMap<LlmModelRole, string> {
	if (value === undefined) return new Map();
	const raw = requireObject(value, `${label}.roles`);
	const roles = new Map<LlmModelRole, string>();
	for (const [name, alias] of Object.entries(raw)) {
		if (!LLM_MODEL_ROLE_NAMES.includes(name as LlmModelRole)) {
			throw new Error(
				`${label}.roles.${name} 不是已知角色，只能是 ${LLM_MODEL_ROLE_NAMES.join("、")}`,
			);
		}
		const modelAlias = requireString(alias, `${label}.roles.${name}`);
		if (!models.has(modelAlias)) {
			throw new Error(
				`${label}.roles.${name} 引用了不存在的模型 ${modelAlias}`,
			);
		}
		roles.set(name as LlmModelRole, modelAlias);
	}
	return roles;
}

function parseChannel(
	id: string,
	value: unknown,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): LlmChannelConfig {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const api = parseApi(value.api, `${label}.api`);
	const baseUrl = interpolate(
		requireString(value.baseUrl, `${label}.baseUrl`),
		env,
		`${label}.baseUrl`,
	);
	if (baseUrl.trim().length === 0) {
		throw new Error(`${label}.baseUrl 不能为空`);
	}
	const rawApiKey = requireString(value.apiKey, `${label}.apiKey`);
	const apiKey = parseApiKey(rawApiKey, env, `${label}.apiKey`);
	return {
		id,
		api,
		baseUrl,
		apiKey,
		requestsPerMinute: optionalInt(
			value.requestsPerMinute,
			`${label}.requestsPerMinute`,
			DEFAULT_REQUESTS_PER_MINUTE,
			0,
		),
		maxRetries: optionalInt(
			value.maxRetries,
			`${label}.maxRetries`,
			DEFAULT_MAX_RETRIES,
			0,
		),
		retryBaseDelayMs: optionalInt(
			value.retryBaseDelayMs,
			`${label}.retryBaseDelayMs`,
			DEFAULT_RETRY_BASE_DELAY_MS,
			0,
		),
		timeoutMs: optionalInt(
			value.timeoutMs,
			`${label}.timeoutMs`,
			DEFAULT_TIMEOUT_MS,
			1,
		),
	};
}

function parseEmbedding(
	id: string,
	value: unknown,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): EmbeddingProviderConfig {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const api = value.api === undefined ? "openai-embeddings" : value.api;
	if (api !== "openai-embeddings") {
		throw new Error(`${label}.api 只能是 openai-embeddings`);
	}
	const baseUrl = interpolate(
		requireString(value.baseUrl, `${label}.baseUrl`),
		env,
		`${label}.baseUrl`,
	);
	if (baseUrl.trim().length === 0) {
		throw new Error(`${label}.baseUrl 不能为空`);
	}
	const model = interpolate(
		requireString(value.model, `${label}.model`),
		env,
		`${label}.model`,
	);
	if (model.trim().length === 0) {
		throw new Error(`${label}.model 不能为空`);
	}
	return {
		id,
		api,
		baseUrl,
		apiKey: parseApiKey(
			requireString(value.apiKey, `${label}.apiKey`),
			env,
			`${label}.apiKey`,
		),
		model,
		dimensions: requirePositiveInt(value.dimensions, `${label}.dimensions`),
		batchSize: optionalInt(value.batchSize, `${label}.batchSize`, 32, 1),
		requestsPerMinute: optionalInt(
			value.requestsPerMinute,
			`${label}.requestsPerMinute`,
			DEFAULT_REQUESTS_PER_MINUTE,
			0,
		),
		maxRetries: optionalInt(
			value.maxRetries,
			`${label}.maxRetries`,
			DEFAULT_MAX_RETRIES,
			0,
		),
		retryBaseDelayMs: optionalInt(
			value.retryBaseDelayMs,
			`${label}.retryBaseDelayMs`,
			DEFAULT_RETRY_BASE_DELAY_MS,
			0,
		),
		timeoutMs: optionalInt(
			value.timeoutMs,
			`${label}.timeoutMs`,
			DEFAULT_TIMEOUT_MS,
			1,
		),
	};
}

function parseReranker(
	value: unknown,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): RerankerProviderConfig {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const api = value.api === undefined ? "openai-rerank" : value.api;
	if (api !== "openai-rerank") {
		throw new Error(`${label}.api 只能是 openai-rerank`);
	}
	const baseUrl = interpolate(
		requireString(value.baseUrl, `${label}.baseUrl`),
		env,
		`${label}.baseUrl`,
	);
	if (baseUrl.trim().length === 0) {
		throw new Error(`${label}.baseUrl 不能为空`);
	}
	const model = interpolate(
		requireString(value.model, `${label}.model`),
		env,
		`${label}.model`,
	);
	if (model.trim().length === 0) {
		throw new Error(`${label}.model 不能为空`);
	}
	return {
		id: "reranker",
		api,
		enabled:
			value.enabled === undefined
				? false
				: requireBoolean(value.enabled, `${label}.enabled`),
		baseUrl,
		apiKey: parseApiKey(
			requireString(value.apiKey, `${label}.apiKey`),
			env,
			`${label}.apiKey`,
		),
		model,
		batchSize: optionalInt(value.batchSize, `${label}.batchSize`, 32, 1),
		requestsPerMinute: optionalInt(
			value.requestsPerMinute,
			`${label}.requestsPerMinute`,
			DEFAULT_REQUESTS_PER_MINUTE,
			0,
		),
		maxRetries: optionalInt(
			value.maxRetries,
			`${label}.maxRetries`,
			DEFAULT_MAX_RETRIES,
			0,
		),
		retryBaseDelayMs: optionalInt(
			value.retryBaseDelayMs,
			`${label}.retryBaseDelayMs`,
			DEFAULT_RETRY_BASE_DELAY_MS,
			0,
		),
		timeoutMs: optionalInt(
			value.timeoutMs,
			`${label}.timeoutMs`,
			DEFAULT_RERANK_TIMEOUT_MS,
			1,
		),
	};
}

function parseModel(
	alias: string,
	value: unknown,
	channels: ReadonlyMap<string, LlmChannelConfig>,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): LlmModelConfig {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const id = interpolate(
		requireString(value.id, `${label}.id`),
		env,
		`${label}.id`,
	);
	if (id.trim().length === 0) {
		throw new Error(`${label}.id 不能为空`);
	}
	const rawChannels = value.channels;
	if (!Array.isArray(rawChannels) || rawChannels.length === 0) {
		throw new Error(`${label}.channels 必须是非空数组`);
	}
	const selected: string[] = [];
	for (const item of rawChannels) {
		if (typeof item !== "string" || item.length === 0) {
			throw new Error(`${label}.channels 里只能写渠道 id`);
		}
		if (!channels.has(item)) {
			throw new Error(`${label}.channels 引用了不存在的渠道 ${item}`);
		}
		if (selected.includes(item)) {
			throw new Error(`${label}.channels 重复引用了渠道 ${item}`);
		}
		selected.push(item);
	}
	return {
		alias,
		id,
		contextWindow: optionalInt(
			value.contextWindow,
			`${label}.contextWindow`,
			DEFAULT_CONTEXT_WINDOW,
			1,
		),
		maxTokens: optionalInt(
			value.maxTokens,
			`${label}.maxTokens`,
			DEFAULT_MAX_TOKENS,
			1,
		),
		reasoning:
			value.reasoning === undefined
				? true
				: requireBoolean(value.reasoning, `${label}.reasoning`),
		enabled:
			value.enabled === undefined
				? true
				: requireBoolean(value.enabled, `${label}.enabled`),
		channels: selected,
		tools: parseModelTools(value.tools, `${label}.tools`),
		probe: parseProbe(value.probe, `${label}.probe`),
	};
}

function parseModelTools(
	value: unknown,
	label: string,
): LlmModelToolsConfig | null {
	if (value === undefined) return null;
	const raw = requireObject(value, label);
	if (raw.transport === undefined) {
		throw new Error(`${label}.transport 只能是 native、text`);
	}
	return {
		transport: requireEnum(
			raw.transport,
			`${label}.transport`,
			LLM_TOOL_TRANSPORTS,
		),
	};
}

function parseApi(value: unknown, label: string): LlmChannelApi {
	if (value === undefined) return "openai-completions";
	if (
		value === "openai-completions" ||
		value === "google-generative-ai" ||
		value === "google-vertex"
	) {
		return value;
	}
	throw new Error(
		`${label} 只能是 openai-completions、google-generative-ai 或 google-vertex`,
	);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	return value;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	return value;
}

function requireBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`${label} 必须是布尔值`);
	}
	return value;
}

function optionalInt(
	value: unknown,
	label: string,
	fallback: number,
	minimum: number,
): number {
	if (value === undefined) return fallback;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < minimum
	) {
		throw new Error(`${label} 必须是不小于 ${minimum} 的整数`);
	}
	return value;
}

function requirePositiveInt(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} 必须是正整数`);
	}
	return value;
}

const PROBE_SUPPORT_VALUES = ["supported", "unsupported", "unknown"] as const;
const PROBE_STREAMING_VALUES = ["streaming", "buffered", "unknown"] as const;
const PROBE_STRUCTURED_OUTPUT_VALUES = ["function-call", "text-tags"] as const;

function requireEnum<T extends string>(
	value: unknown,
	label: string,
	allowed: readonly T[],
): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(`${label} 只能是 ${allowed.join("、")}`);
	}
	return value as T;
}

function parseProbe(value: unknown, label: string): LlmModelProbe | null {
	if (value === undefined) return null;
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const rawNotes = value.notes;
	if (!Array.isArray(rawNotes)) {
		throw new Error(`${label}.notes 必须是字符串数组`);
	}
	const notes: string[] = [];
	for (const note of rawNotes) {
		if (typeof note !== "string") {
			throw new Error(`${label}.notes 必须是字符串数组`);
		}
		notes.push(note);
	}
	return {
		probedAt: requireString(value.probedAt, `${label}.probedAt`),
		channel: requireString(value.channel, `${label}.channel`),
		modelId: requireString(value.modelId, `${label}.modelId`),
		streaming: requireEnum(
			value.streaming,
			`${label}.streaming`,
			PROBE_STREAMING_VALUES,
		),
		functionCalling: requireEnum(
			value.functionCalling,
			`${label}.functionCalling`,
			PROBE_SUPPORT_VALUES,
		),
		thinking: requireEnum(
			value.thinking,
			`${label}.thinking`,
			PROBE_SUPPORT_VALUES,
		),
		prefill: requireEnum(
			value.prefill,
			`${label}.prefill`,
			PROBE_SUPPORT_VALUES,
		),
		usage: requireEnum(value.usage, `${label}.usage`, PROBE_SUPPORT_VALUES),
		cacheStats: requireEnum(
			value.cacheStats,
			`${label}.cacheStats`,
			PROBE_SUPPORT_VALUES,
		),
		structuredOutput: requireEnum(
			value.structuredOutput,
			`${label}.structuredOutput`,
			PROBE_STRUCTURED_OUTPUT_VALUES,
		),
		notes,
	};
}

/**
 * 把体检结果写回模型的 probe 字段。
 *
 * 用 YAML Document 修改，保留文件里的注释与 `${VAR}` 引用原文。
 */
export async function writeModelProbe(
	filePath: string,
	alias: string,
	probe: LlmModelProbe,
): Promise<void> {
	const text = await readFile(filePath, "utf8");
	await writeFile(
		filePath,
		setModelProbeInText(text, alias, probe, filePath),
		"utf8",
	);
}

/** 在 YAML 文本里写入体检结果；文件读写留给调用方。 */
export function setModelProbeInText(
	text: string,
	alias: string,
	probe: LlmModelProbe,
	label = "channels.yaml",
): string {
	const document = parseDocument(text);
	if (document.errors.length > 0) {
		throw new Error(`${label} 不是合法的 YAML：${document.errors[0].message}`);
	}
	if (!document.hasIn(["models", alias])) {
		throw new Error(`渠道配置里没有模型 ${alias}`);
	}
	document.setIn(["models", alias, "probe"], {
		probedAt: probe.probedAt,
		channel: probe.channel,
		modelId: probe.modelId,
		streaming: probe.streaming,
		functionCalling: probe.functionCalling,
		thinking: probe.thinking,
		prefill: probe.prefill,
		usage: probe.usage,
		cacheStats: probe.cacheStats,
		structuredOutput: probe.structuredOutput,
		notes: [...probe.notes],
	});
	return document.toString();
}

/** 渠道配置里 apiKey 引用的环境变量名，按渠道与 embedding 分开。 */
export interface ChannelsKeyRefs {
	readonly channels: ReadonlyMap<string, string | null>;
	readonly embeddings: ReadonlyMap<string, string | null>;
}

/**
 * 读出 `apiKey` 里 `${VAR}` 引用的变量名。
 *
 * 只有解析成功的配置才会走到这里；返回 null 表示没有写引用（空密钥）。
 */
export function readChannelsKeyRefs(
	text: string,
	label = "channels.yaml",
): ChannelsKeyRefs {
	const root = parseYaml(text);
	if (!isJsonObject(root)) {
		throw new Error(`${label} 的顶层必须是对象`);
	}
	const channels = new Map<string, string | null>();
	if (root.channels !== undefined) {
		const raw = requireObject(root.channels, `${label}.channels`);
		for (const [id, value] of Object.entries(raw)) {
			channels.set(id, keyRefOf(value, `${label}.channels.${id}`));
		}
	}
	const embeddings = new Map<string, string | null>();
	if (root.embeddings !== undefined) {
		const raw = requireObject(root.embeddings, `${label}.embeddings`);
		for (const [id, value] of Object.entries(raw)) {
			embeddings.set(id, keyRefOf(value, `${label}.embeddings.${id}`));
		}
	}
	return { channels, embeddings };
}

function keyRefOf(value: unknown, label: string): string | null {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const key = value.apiKey;
	if (key === undefined) return null;
	if (typeof key !== "string") {
		throw new Error(`${label}.apiKey 必须是字符串`);
	}
	const trimmed = key.trim();
	if (trimmed.length === 0) return null;
	const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(trimmed);
	return match === null ? null : (match[1] as string);
}

/** PUT /api/channels 写入的一个渠道。 */
export interface ChannelYamlInput {
	readonly api: LlmChannelApi;
	readonly baseUrl: string;
	/** 环境变量名；空字符串表示不需要密钥。保存时写成 `${变量名}`。 */
	readonly apiKeyEnv: string;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

/** PUT /api/channels 写入的一个模型；`tools` 与 `probe` 保留原值。 */
export interface ModelYamlInput {
	readonly id: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly reasoning: boolean;
	readonly enabled: boolean;
	/** 渠道 id，按优先级从高到低。 */
	readonly channels: readonly string[];
}

/** PUT /api/channels 写入的一个 embedding 提供方。 */
export interface EmbeddingYamlInput {
	readonly api: "openai-embeddings";
	readonly baseUrl: string;
	readonly apiKeyEnv: string;
	readonly model: string;
	readonly dimensions: number;
	readonly batchSize: number;
	readonly requestsPerMinute: number;
	readonly maxRetries: number;
	readonly retryBaseDelayMs: number;
	readonly timeoutMs: number;
}

/** 渠道配置的整份替换；键是渠道 id、模型别名与 embedding id。 */
export interface ChannelsYamlUpdate {
	readonly channels: Readonly<Record<string, ChannelYamlInput>>;
	readonly models: Readonly<Record<string, ModelYamlInput>>;
	readonly embeddings: Readonly<Record<string, EmbeddingYamlInput>>;
	readonly roles: Readonly<Partial<Record<LlmModelRole, string>>>;
}

/**
 * 按更新内容改写渠道配置文本。
 *
 * 只改请求里出现的字段：模型的 `tools` 与 `probe`、其它未知字段、
 * 以及未触及行的注释都保留。校验与写文件由调用方负责。
 */
export function applyChannelsUpdate(
	text: string,
	update: ChannelsYamlUpdate,
	label = "channels.yaml",
): string {
	const document = parseDocument(text);
	if (document.errors.length > 0) {
		throw new Error(`${label} 不是合法的 YAML：${document.errors[0].message}`);
	}
	const root = document.toJS();
	for (const id of yamlSectionKeys(root, "channels", label)) {
		if (!(id in update.channels)) document.deleteIn(["channels", id]);
	}
	for (const [id, input] of Object.entries(update.channels)) {
		document.setIn(["channels", id, "api"], input.api);
		document.setIn(["channels", id, "baseUrl"], input.baseUrl);
		document.setIn(["channels", id, "apiKey"], apiKeyRef(input.apiKeyEnv));
		document.setIn(
			["channels", id, "requestsPerMinute"],
			input.requestsPerMinute,
		);
		document.setIn(["channels", id, "maxRetries"], input.maxRetries);
		document.setIn(
			["channels", id, "retryBaseDelayMs"],
			input.retryBaseDelayMs,
		);
		document.setIn(["channels", id, "timeoutMs"], input.timeoutMs);
	}
	for (const alias of yamlSectionKeys(root, "models", label)) {
		if (!(alias in update.models)) document.deleteIn(["models", alias]);
	}
	for (const [alias, input] of Object.entries(update.models)) {
		document.setIn(["models", alias, "id"], input.id);
		document.setIn(["models", alias, "contextWindow"], input.contextWindow);
		document.setIn(["models", alias, "maxTokens"], input.maxTokens);
		document.setIn(["models", alias, "reasoning"], input.reasoning);
		document.setIn(["models", alias, "channels"], [...input.channels]);
		if (input.enabled) {
			document.deleteIn(["models", alias, "enabled"]);
		} else {
			document.setIn(["models", alias, "enabled"], false);
		}
	}
	for (const id of yamlSectionKeys(root, "embeddings", label)) {
		if (!(id in update.embeddings)) document.deleteIn(["embeddings", id]);
	}
	for (const [id, input] of Object.entries(update.embeddings)) {
		document.setIn(["embeddings", id, "api"], input.api);
		document.setIn(["embeddings", id, "baseUrl"], input.baseUrl);
		document.setIn(["embeddings", id, "apiKey"], apiKeyRef(input.apiKeyEnv));
		document.setIn(["embeddings", id, "model"], input.model);
		document.setIn(["embeddings", id, "dimensions"], input.dimensions);
		document.setIn(["embeddings", id, "batchSize"], input.batchSize);
		document.setIn(
			["embeddings", id, "requestsPerMinute"],
			input.requestsPerMinute,
		);
		document.setIn(["embeddings", id, "maxRetries"], input.maxRetries);
		document.setIn(
			["embeddings", id, "retryBaseDelayMs"],
			input.retryBaseDelayMs,
		);
		document.setIn(["embeddings", id, "timeoutMs"], input.timeoutMs);
	}
	for (const name of yamlSectionKeys(root, "roles", label)) {
		if (!(name in update.roles)) document.deleteIn(["roles", name]);
	}
	for (const [name, alias] of Object.entries(update.roles)) {
		document.setIn(["roles", name], alias);
	}
	return document.toString();
}

function yamlSectionKeys(
	root: unknown,
	section: string,
	label: string,
): string[] {
	if (!isJsonObject(root)) {
		throw new Error(`${label} 的顶层必须是对象`);
	}
	const value = root[section];
	if (value === undefined) return [];
	return Object.keys(requireObject(value, `${label}.${section}`));
}

function apiKeyRef(envName: string): string {
	return envName.length === 0 ? "" : `\${${envName}}`;
}

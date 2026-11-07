import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { isJsonObject } from "../json.js";

export type LlmChannelApi = "openai-completions" | "google-generative-ai";

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

export interface LlmModelConfig {
	readonly alias: string;
	readonly id: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly reasoning: boolean;
	/** 渠道 id，按优先级从高到低。 */
	readonly channels: readonly string[];
}

export interface LlmChannelsConfig {
	readonly channels: ReadonlyMap<string, LlmChannelConfig>;
	readonly models: ReadonlyMap<string, LlmModelConfig>;
}

const DEFAULT_REQUESTS_PER_MINUTE = 30;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 300_000;
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
	return { channels, models };
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
		channels: selected,
	};
}

function parseApi(value: unknown, label: string): LlmChannelApi {
	if (value === undefined) return "openai-completions";
	if (value === "openai-completions" || value === "google-generative-ai") {
		return value;
	}
	throw new Error(`${label} 只能是 openai-completions 或 google-generative-ai`);
}

function parseApiKey(
	value: string,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) return "";
	if (!/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(trimmed)) {
		throw new Error(`${label} 必须写成 \${环境变量名} 的引用`);
	}
	return interpolate(trimmed, env, label);
}

function interpolate(
	value: string,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): string {
	return value.replace(
		/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
		(_match, name: string) => {
			const resolved = env[name];
			if (resolved === undefined) {
				throw new Error(`${label} 引用的环境变量 ${name} 没有设置`);
			}
			return resolved;
		},
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

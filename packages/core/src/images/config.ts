import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { interpolateEnvRefs, parseApiKeyRef } from "../env-ref.js";
import { isJsonObject, rejectUnknownKeys } from "../json.js";

export const IMAGE_PROVIDER_APIS = ["comfyui", "novelai"] as const;

export type ImageProviderApi = (typeof IMAGE_PROVIDER_APIS)[number];

/** `images.yaml` 配置的 ComfyUI 后端；`apiKey` 只保存解析后的值，不写回文件。 */
export interface ComfyUiProviderConfig {
	readonly id: string;
	readonly api: "comfyui";
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly timeoutMs: number;
	readonly pollIntervalMs: number;
}

/** `images.yaml` 配置的 NovelAI 后端；`apiKey` 是 NovelAI 的持久令牌（pst- 开头）。 */
export interface NovelAiProviderConfig {
	readonly id: string;
	readonly api: "novelai";
	/** 默认官方地址；也可以填兼容的中转地址。 */
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly timeoutMs: number;
	/** 本地队列的每分钟请求上限；默认 10。 */
	readonly maxRequestsPerMinute: number;
}

export type ImageProviderConfig = ComfyUiProviderConfig | NovelAiProviderConfig;

export interface ImagesConfig {
	readonly providers: ReadonlyMap<string, ImageProviderConfig>;
}

export const NOVELAI_DEFAULT_BASE_URL = "https://image.novelai.net";
export const NOVELAI_DEFAULT_MAX_REQUESTS_PER_MINUTE = 10;
const NOVELAI_DEFAULT_TIMEOUT_MS = 120_000;

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

const PROVIDER_KEYS = [
	"api",
	"baseUrl",
	"apiKey",
	"timeoutMs",
	"pollIntervalMs",
	"maxRequestsPerMinute",
];

/** 没有 `images.yaml` 时的配置：生图功能关闭。 */
export function emptyImagesConfig(): ImagesConfig {
	return { providers: new Map() };
}

/**
 * 读取生图配置。文件不存在时返回空配置，不阻止服务启动；
 * `${VAR}` 在解析时替换成环境变量。
 */
export async function loadImagesConfig(
	filePath: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ImagesConfig> {
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
			return emptyImagesConfig();
		}
		throw error;
	}
	return parseImagesConfig(text, env, filePath);
}

export function parseImagesConfig(
	text: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
	label = "images.yaml",
): ImagesConfig {
	const root = parseYaml(text);
	if (!isJsonObject(root)) {
		throw new Error(`${label} 的顶层必须是对象`);
	}
	rejectUnknownKeys(root, ["providers"], label);
	const rawProviders = root.providers;
	if (!isJsonObject(rawProviders)) {
		throw new Error(`${label}.providers 必须是对象`);
	}
	const providers = new Map<string, ImageProviderConfig>();
	for (const [id, value] of Object.entries(rawProviders)) {
		providers.set(
			id,
			parseProvider(id, value, env, `${label}.providers.${id}`),
		);
	}
	return { providers };
}

function parseProvider(
	id: string,
	value: unknown,
	env: Readonly<Record<string, string | undefined>>,
	label: string,
): ImageProviderConfig {
	if (id.trim().length === 0) {
		throw new Error(`${label} 的 provider id 不能为空`);
	}
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	rejectUnknownKeys(value, PROVIDER_KEYS, label);
	const api = value.api;
	if (api === "novelai") {
		const baseUrl = interpolateEnvRefs(
			value.baseUrl === undefined
				? NOVELAI_DEFAULT_BASE_URL
				: requireString(value.baseUrl, `${label}.baseUrl`),
			env,
			`${label}.baseUrl`,
		);
		assertHttpUrl(baseUrl, `${label}.baseUrl`);
		if (value.pollIntervalMs !== undefined) {
			throw new Error(`${label}.pollIntervalMs 只对 comfyui 有效`);
		}
		const apiKey = parseApiKeyRef(
			requireString(value.apiKey, `${label}.apiKey`),
			env,
			`${label}.apiKey`,
		);
		return {
			id,
			api,
			baseUrl,
			apiKey,
			timeoutMs: optionalPositiveInt(
				value.timeoutMs,
				`${label}.timeoutMs`,
				NOVELAI_DEFAULT_TIMEOUT_MS,
			),
			maxRequestsPerMinute: optionalPositiveInt(
				value.maxRequestsPerMinute,
				`${label}.maxRequestsPerMinute`,
				NOVELAI_DEFAULT_MAX_REQUESTS_PER_MINUTE,
			),
		};
	}
	if (api !== "comfyui") {
		throw new Error(`${label}.api 只能是 ${IMAGE_PROVIDER_APIS.join("、")}`);
	}
	if (value.maxRequestsPerMinute !== undefined) {
		throw new Error(`${label}.maxRequestsPerMinute 只对 novelai 有效`);
	}
	const baseUrl = interpolateEnvRefs(
		requireString(value.baseUrl, `${label}.baseUrl`),
		env,
		`${label}.baseUrl`,
	);
	assertHttpUrl(baseUrl, `${label}.baseUrl`);
	return {
		id,
		api,
		baseUrl,
		apiKey: parseApiKeyRef(
			requireString(value.apiKey, `${label}.apiKey`),
			env,
			`${label}.apiKey`,
		),
		timeoutMs: optionalPositiveInt(
			value.timeoutMs,
			`${label}.timeoutMs`,
			DEFAULT_TIMEOUT_MS,
		),
		pollIntervalMs: optionalPositiveInt(
			value.pollIntervalMs,
			`${label}.pollIntervalMs`,
			DEFAULT_POLL_INTERVAL_MS,
		),
	};
}

function assertHttpUrl(value: string, label: string): void {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label} 必须是合法的 URL`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`${label} 只能是 http 或 https 地址`);
	}
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	return value;
}

function optionalPositiveInt(
	value: unknown,
	label: string,
	fallback: number,
): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} 必须是正整数`);
	}
	return value;
}

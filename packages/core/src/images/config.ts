import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { interpolateEnvRefs, parseApiKeyRef } from "../env-ref.js";
import { isJsonObject, rejectUnknownKeys } from "../json.js";

export const IMAGE_PROVIDER_APIS = ["comfyui"] as const;

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

export interface ImagesConfig {
	readonly providers: ReadonlyMap<string, ComfyUiProviderConfig>;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

const PROVIDER_KEYS = [
	"api",
	"baseUrl",
	"apiKey",
	"timeoutMs",
	"pollIntervalMs",
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
	const providers = new Map<string, ComfyUiProviderConfig>();
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
): ComfyUiProviderConfig {
	if (id.trim().length === 0) {
		throw new Error(`${label} 的 provider id 不能为空`);
	}
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	rejectUnknownKeys(value, PROVIDER_KEYS, label);
	const api = value.api;
	if (api !== "comfyui") {
		throw new Error(`${label}.api 只能是 comfyui`);
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

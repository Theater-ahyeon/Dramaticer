import { isJsonObject } from "../json.js";
import type { ComfyUiProviderConfig } from "./config.js";
import {
	type ComfyUiSlots,
	type ComfyUiWorkflow,
	assertComfyUiSlots,
} from "./slots.js";

export type ComfyUiFetch = (
	url: string,
	init?: RequestInit,
) => Promise<Response>;

export interface ComfyUiGenerateInput {
	readonly workflow: ComfyUiWorkflow;
	readonly slots: ComfyUiSlots;
	readonly prompt: string;
	readonly negativePrompt: string | null;
	readonly seed: number;
	readonly width: number | null;
	readonly height: number | null;
}

export interface ComfyUiGeneratedImage {
	readonly promptId: string;
	readonly fileName: string;
	readonly mediaType: string;
	readonly bytes: Uint8Array;
}

export interface ComfyUiClientOptions {
	readonly fetch: ComfyUiFetch;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly now?: () => number;
}

export interface ComfyUiClient {
	generate(input: ComfyUiGenerateInput): Promise<ComfyUiGeneratedImage>;
}

interface HistoryImage {
	readonly filename: string;
	readonly subfolder: string;
	readonly type: string;
}

/**
 * 按插槽改写 workflow 的 `inputs`，提交 `/prompt`，轮询 `/history/<id>`，
 * 再从 `/view` 下载第一张图。客户端本身不重试，重试由后台任务负责。
 */
export function createComfyUiClient(
	provider: ComfyUiProviderConfig,
	options: ComfyUiClientOptions,
): ComfyUiClient {
	const baseUrl = provider.baseUrl.replace(/\/+$/, "");
	const sleep =
		options.sleep ??
		((ms: number) => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, ms);
			return promise;
		});
	const now = options.now ?? Date.now;
	const deadline = now() + provider.timeoutMs;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (provider.apiKey.length > 0) {
		headers.Authorization = `Bearer ${provider.apiKey}`;
	}
	const assertTimeLeft = (
		action: string,
		promptId: string | null = null,
	): void => {
		if (now() >= deadline) {
			throw new Error(
				`ComfyUI ${action}超时（总时长 ${provider.timeoutMs} 毫秒）${promptId === null ? "" : `（prompt ${promptId}）`}`,
			);
		}
	};
	const requestJson = async (
		url: string,
		init: RequestInit,
		promptId: string | null,
	): Promise<unknown> => {
		const response = await options.fetch(url, init);
		if (!response.ok) {
			const snippet = (await response.text()).slice(0, 200);
			throw new Error(
				`ComfyUI 请求失败：${url} 返回 ${response.status}${snippet.length === 0 ? "" : `（${snippet}）`}${promptId === null ? "" : `（prompt ${promptId}）`}`,
			);
		}
		try {
			return await response.json();
		} catch {
			throw new Error(
				`ComfyUI 返回的不是 JSON：${url}${promptId === null ? "" : `（prompt ${promptId}）`}`,
			);
		}
	};

	return {
		async generate(input) {
			const workflow = structuredClone(input.workflow) as ComfyUiWorkflow;
			const slots = assertComfyUiSlots(workflow, input.slots);
			workflow[slots.positive.nodeId].inputs[slots.positive.input] =
				input.prompt;
			if (slots.negative !== null && input.negativePrompt !== null) {
				workflow[slots.negative.nodeId].inputs[slots.negative.input] =
					input.negativePrompt;
			}
			workflow[slots.seed.nodeId].inputs[slots.seed.input] = input.seed;
			if (slots.width !== null && input.width !== null) {
				workflow[slots.width.nodeId].inputs[slots.width.input] = input.width;
			}
			if (slots.height !== null && input.height !== null) {
				workflow[slots.height.nodeId].inputs[slots.height.input] = input.height;
			}
			assertTimeLeft("提交");
			const submitted = await requestJson(
				`${baseUrl}/prompt`,
				{
					method: "POST",
					headers,
					body: JSON.stringify({ prompt: workflow }),
				},
				null,
			);
			if (
				!isJsonObject(submitted) ||
				typeof submitted.prompt_id !== "string" ||
				submitted.prompt_id.length === 0
			) {
				throw new Error("ComfyUI 提交响应里没有 prompt_id");
			}
			const promptId = submitted.prompt_id;
			let image: HistoryImage | null = null;
			while (image === null) {
				assertTimeLeft("等待", promptId);
				const history = await requestJson(
					`${baseUrl}/history/${encodeURIComponent(promptId)}`,
					{ method: "GET", headers },
					promptId,
				);
				if (!isJsonObject(history)) {
					throw new Error(`ComfyUI 历史响应不是对象（prompt ${promptId}）`);
				}
				const record = history[promptId];
				if (isJsonObject(record)) {
					if (
						isJsonObject(record.status) &&
						record.status.status_str === "error"
					) {
						throw new Error(`ComfyUI 历史里记录了错误（prompt ${promptId}）`);
					}
					if (Object.hasOwn(record, "outputs")) {
						image = findOutputImage(record.outputs, promptId);
						if (image === null) {
							throw new Error(
								`ComfyUI 历史里没有图片输出（prompt ${promptId}）`,
							);
						}
						break;
					}
				}
				const remaining = deadline - now();
				if (remaining <= 0) {
					throw new Error(
						`ComfyUI 等待超时（总时长 ${provider.timeoutMs} 毫秒，prompt ${promptId}）`,
					);
				}
				await sleep(Math.min(provider.pollIntervalMs, remaining));
			}
			assertTimeLeft(`下载 ${image.filename}`, promptId);
			const query = new URLSearchParams({
				filename: image.filename,
				subfolder: image.subfolder,
				type: image.type,
			});
			const response = await options.fetch(`${baseUrl}/view?${query}`, {
				method: "GET",
			});
			if (!response.ok) {
				throw new Error(
					`ComfyUI 下载图片失败：返回 ${response.status}（prompt ${promptId}）`,
				);
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.byteLength === 0) {
				throw new Error(`ComfyUI 下载的图片为空（prompt ${promptId}）`);
			}
			const headerType = response.headers.get("content-type");
			return {
				promptId,
				fileName: image.filename,
				mediaType: mediaTypeOf(headerType, image.filename),
				bytes,
			};
		},
	};
}

function findOutputImage(
	outputs: unknown,
	promptId: string,
): HistoryImage | null {
	if (!isJsonObject(outputs)) {
		throw new Error(`ComfyUI 历史的 outputs 不是对象（prompt ${promptId}）`);
	}
	for (const output of Object.values(outputs)) {
		if (!isJsonObject(output)) continue;
		const images = output.images;
		if (!Array.isArray(images)) continue;
		for (const image of images) {
			if (!isJsonObject(image)) {
				throw new Error(
					`ComfyUI 历史的 images 条目不是对象（prompt ${promptId}）`,
				);
			}
			const filename = image.filename;
			const subfolder = image.subfolder ?? "";
			const type = image.type ?? "output";
			if (typeof filename !== "string" || filename.length === 0) {
				throw new Error(
					`ComfyUI 历史的图片缺少 filename（prompt ${promptId}）`,
				);
			}
			if (typeof subfolder !== "string" || typeof type !== "string") {
				throw new Error(
					`ComfyUI 历史的图片路径字段不合法（prompt ${promptId}）`,
				);
			}
			return { filename, subfolder, type };
		}
	}
	return null;
}

function mediaTypeOf(header: string | null, filename: string): string {
	if (header !== null) {
		const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
		if (type.startsWith("image/")) return type;
	}
	const lower = filename.toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".gif")) return "image/gif";
	return "application/octet-stream";
}

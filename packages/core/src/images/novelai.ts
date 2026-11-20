import type { NovelAiProviderConfig } from "./config.js";
import type { NovelAiParameters } from "./novelai-params.js";
import { extractFirstZipEntry } from "./zip.js";

export type NovelAiFetch = (
	url: string,
	init?: RequestInit,
) => Promise<Response>;

export interface NovelAiGenerateInput {
	readonly parameters: NovelAiParameters;
	readonly prompt: string;
	readonly negativePrompt: string | null;
	readonly seed: number;
}

export interface NovelAiGeneratedImage {
	readonly promptId: string;
	readonly fileName: string;
	readonly mediaType: string;
	readonly bytes: Uint8Array;
}

function joinTags(...parts: readonly (string | null)[]): string {
	return parts
		.map((part) => (part ?? "").trim())
		.filter((part) => part.length > 0)
		.join(", ");
}

/** V4.5 与更早模型的常数不同；与 NovelAI 网页端的「多样性增强」一致。 */
function skipCfgAboveSigma(parameters: NovelAiParameters): number | null {
	if (!parameters.varietyBoost) return null;
	const ratio = (parameters.width * parameters.height) / 1011712;
	const magic = parameters.model.includes("nai-diffusion-4-5") ? 58 : 19;
	return Math.sqrt(ratio) * magic;
}

/** 组装 NovelAI `/ai/generate-image` 的请求体；V3 与 V4 的提示词字段都填。 */
export function buildNovelAiRequestBody(
	input: NovelAiGenerateInput,
): Record<string, unknown> {
	const { parameters } = input;
	const prompt = joinTags(input.prompt, parameters.qualityTags);
	const negative = joinTags(parameters.negativeTags, input.negativePrompt);
	return {
		action: "generate",
		input: prompt,
		model: parameters.model,
		parameters: {
			params_version: 3,
			prefer_brownian: true,
			negative_prompt: negative,
			width: parameters.width,
			height: parameters.height,
			scale: parameters.scale,
			seed: input.seed,
			sampler: parameters.sampler,
			noise_schedule: parameters.noiseSchedule,
			steps: parameters.steps,
			n_samples: 1,
			ucPreset: 0,
			qualityToggle: false,
			add_original_image: false,
			controlnet_strength: 1,
			deliberate_euler_ancestral_bug: false,
			dynamic_thresholding: false,
			legacy: false,
			legacy_v3_extend: false,
			sm: parameters.sm,
			sm_dyn: parameters.smDyn,
			uncond_scale: 1,
			skip_cfg_above_sigma: skipCfgAboveSigma(parameters),
			use_coords: false,
			characterPrompts: [],
			reference_image_multiple: [],
			reference_information_extracted_multiple: [],
			reference_strength_multiple: [],
			v4_prompt: {
				caption: { base_caption: prompt, char_captions: [] },
				use_coords: false,
				use_order: true,
			},
			v4_negative_prompt: {
				caption: { base_caption: negative, char_captions: [] },
			},
		},
	};
}

function isPng(bytes: Uint8Array): boolean {
	return (
		bytes.length > 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	);
}

/**
 * NovelAI 客户端：一次请求出一张图。官方接口返回 zip（内含 PNG），
 * 部分中转直接返回图片，两种都接受。客户端本身不重试，重试由后台任务负责。
 */
export function createNovelAiClient(
	provider: NovelAiProviderConfig,
	options: { readonly fetch: NovelAiFetch },
) {
	const url = `${provider.baseUrl.replace(/\/+$/, "")}/ai/generate-image`;
	return {
		async generate(
			input: NovelAiGenerateInput,
		): Promise<NovelAiGeneratedImage> {
			if (provider.apiKey.length === 0) {
				throw new Error("NovelAI 没有配置 apiKey");
			}
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), provider.timeoutMs);
			let response: Response;
			try {
				response = await options.fetch(url, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${provider.apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(buildNovelAiRequestBody(input)),
					signal: controller.signal,
				});
			} catch (error) {
				if (controller.signal.aborted) {
					throw new Error(`NovelAI 请求超时（${provider.timeoutMs} 毫秒）`);
				}
				throw error;
			} finally {
				clearTimeout(timer);
			}
			if (!response.ok) {
				const snippet = (await response.text()).slice(0, 200);
				throw new Error(
					`NovelAI 请求失败：返回 ${response.status}${snippet.length === 0 ? "" : `（${snippet}）`}`,
				);
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.length === 0) throw new Error("NovelAI 返回为空");
			const type =
				response.headers
					.get("content-type")
					?.split(";")[0]
					?.trim()
					.toLowerCase() ?? "";
			if (type.startsWith("image/") || isPng(bytes)) {
				return {
					promptId: `novelai-${input.seed}`,
					fileName: "image.png",
					mediaType: type.startsWith("image/") ? type : "image/png",
					bytes,
				};
			}
			const entry = extractFirstZipEntry(bytes, ".png");
			if (entry === null) throw new Error("NovelAI 返回的压缩包里没有 PNG");
			return {
				promptId: `novelai-${input.seed}`,
				fileName: entry.name,
				mediaType: "image/png",
				bytes: entry.bytes,
			};
		},
	};
}

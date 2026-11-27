import type { NovelAiProviderConfig } from "./config.js";
import {
	DEFAULT_NOVELAI_PARAMETERS,
	NOVELAI_UC_PRESET_VALUES,
	type NovelAiNegativePreset,
	type NovelAiParameters,
} from "./novelai-params.js";
import { extractFirstZipEntry } from "./zip.js";

export type NovelAiFetch = (
	url: string,
	init?: RequestInit,
) => Promise<Response>;

/** 画面整理给出的一个人物；坐标为空时由 AI 排位置。 */
export interface NovelAiCharacterPrompt {
	readonly prompt: string;
	readonly negativePrompt: string;
	readonly center: { readonly x: number; readonly y: number } | null;
}

export interface NovelAiGenerateInput {
	readonly parameters: NovelAiParameters;
	readonly prompt: string;
	readonly negativePrompt: string | null;
	readonly seed: number;
	readonly characters?: readonly NovelAiCharacterPrompt[];
}

export interface NovelAiGeneratedImage {
	readonly promptId: string;
	readonly fileName: string;
	readonly mediaType: string;
	readonly bytes: Uint8Array;
}

export const NOVELAI_MODEL_FAMILIES = ["v3", "v4", "v5"] as const;

export type NovelAiModelFamily = (typeof NOVELAI_MODEL_FAMILIES)[number];

/** 按模型 id 判断请求体族；自定义 id 里带 4 / 5 的同样认。 */
export function detectNovelAiFamily(model: string): NovelAiModelFamily {
	const id = model.toLowerCase();
	if (id.includes("nai-diffusion-5")) return "v5";
	if (id.includes("nai-diffusion-4")) return "v4";
	return "v3";
}

/** V5 的 Medium 档把模型换成带 `-medium` 的版本；已带后缀时不重复。 */
export function resolveNovelAiModel(parameters: NovelAiParameters): string {
	if (
		detectNovelAiFamily(parameters.model) !== "v5" ||
		!parameters.mediumTier ||
		parameters.model.endsWith("-medium")
	) {
		return parameters.model;
	}
	return `${parameters.model}-medium`;
}

const PRESET_NEGATIVE_TAGS: Readonly<
	Record<Exclude<NovelAiNegativePreset, "none">, string>
> = {
	heavy:
		"lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
	light:
		"lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::",
	human_focus:
		"lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
	furry_focus:
		"{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic",
};

/** V5 的 `tag_hint_uc_preset` 数值；关闭时写 0。 */
const UC_PRESET_HINTS: Readonly<Record<NovelAiNegativePreset, number>> = {
	none: 0,
	heavy: 2,
	light: 3,
	human_focus: 4,
	furry_focus: 5,
};

const DEFAULT_CENTER = { x: 0.5, y: 0.5 } as const;

function joinTags(...parts: readonly (string | null)[]): string {
	return parts
		.map((part) => (part ?? "").trim())
		.filter((part) => part.length > 0)
		.join(", ");
}

function presetTags(preset: NovelAiNegativePreset): string {
	return preset === "none" ? "" : PRESET_NEGATIVE_TAGS[preset];
}

/** V4.5 与更早模型的常数不同；与 NovelAI 网页端的「多样性增强」一致。 */
function skipCfgAboveSigma(
	parameters: NovelAiParameters,
	model: string,
): number | null {
	if (!parameters.varietyBoost) return null;
	const ratio = (parameters.width * parameters.height) / 1011712;
	const magic = model.includes("nai-diffusion-4-5") ? 58 : 19;
	return Math.sqrt(ratio) * magic;
}

interface LaidOutCharacter {
	readonly prompt: string;
	readonly negativePrompt: string;
	readonly center: { readonly x: number; readonly y: number };
}

function characterLayout(
	characters: readonly NovelAiCharacterPrompt[],
	useCoords: boolean,
): readonly LaidOutCharacter[] {
	return characters.map((character) => ({
		...character,
		center:
			useCoords && character.center !== null
				? character.center
				: DEFAULT_CENTER,
	}));
}

function structuredCharacters(characters: readonly LaidOutCharacter[]): {
	readonly charCaptions: readonly {
		readonly char_caption: string;
		readonly centers: readonly { readonly x: number; readonly y: number }[];
	}[];
	readonly negativeCaptions: readonly {
		readonly char_caption: string;
		readonly centers: readonly { readonly x: number; readonly y: number }[];
	}[];
	readonly prompts: readonly {
		readonly prompt: string;
		readonly uc: string;
		readonly center: { readonly x: number; readonly y: number };
		readonly enabled: true;
	}[];
} {
	return {
		charCaptions: characters.map((character) => ({
			char_caption: character.prompt,
			centers: [character.center],
		})),
		negativeCaptions: characters.map((character) => ({
			char_caption: character.negativePrompt,
			centers: [character.center],
		})),
		prompts: characters.map((character) => ({
			prompt: character.prompt,
			uc: character.negativePrompt,
			center: character.center,
			enabled: true,
		})),
	};
}

/**
 * 组装 NovelAI `/ai/generate-image` 的请求体。V3 用扁平提示词；V4.x 与 V5
 * 用 `v4_prompt` 多人物结构。V5 不发旧参考数组与 `skip_cfg_above_sigma`，
 * 默认也不发噪点表。
 */
export function buildNovelAiRequestBody(
	input: NovelAiGenerateInput,
): Record<string, unknown> {
	const { parameters } = input;
	const family = detectNovelAiFamily(parameters.model);
	const model = resolveNovelAiModel(parameters);
	const characters = input.characters ?? [];
	const useCoords =
		family !== "v3" &&
		parameters.useCoords &&
		characters.some((character) => character.center !== null);
	const layout = characterLayout(characters, useCoords);
	const structured = structuredCharacters(layout);
	const basePrompt = joinTags(input.prompt, parameters.qualityTags);
	const baseNegative = joinTags(
		presetTags(parameters.negativePreset),
		parameters.negativeTags,
		input.negativePrompt,
	);
	const base = {
		prefer_brownian: true,
		negative_prompt: baseNegative,
		width: parameters.width,
		height: parameters.height,
		scale: parameters.scale,
		seed: input.seed,
		sampler: parameters.sampler,
		steps: parameters.steps,
		n_samples: 1,
		ucPreset: NOVELAI_UC_PRESET_VALUES[parameters.negativePreset],
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
	};

	if (family === "v5") {
		const parametersV5: Record<string, unknown> = {
			...base,
			params_version: 4,
			use_coords: useCoords,
			characterPrompts: structured.prompts,
			straight_alpha: parameters.straightAlpha,
			tag_hint_qt: parameters.tagHintQt ? 1 : 0,
			tag_hint_uc_preset: parameters.tagHintUcPreset
				? UC_PRESET_HINTS[parameters.negativePreset]
				: 0,
			v4_prompt: {
				caption: {
					base_caption: basePrompt,
					char_captions: structured.charCaptions,
				},
				use_coords: useCoords,
				use_order: true,
			},
			v4_negative_prompt: {
				caption: {
					base_caption: baseNegative,
					char_captions: structured.negativeCaptions,
				},
				legacy_uc: false,
			},
		};
		if (parameters.noiseSchedule !== DEFAULT_NOVELAI_PARAMETERS.noiseSchedule) {
			parametersV5.noise_schedule = parameters.noiseSchedule;
		}
		return {
			action: "generate",
			input: basePrompt,
			model,
			parameters: parametersV5,
		};
	}

	const input3 = joinTags(
		basePrompt,
		...characters.map((character) => character.prompt),
	);
	const negative3 = joinTags(
		baseNegative,
		...characters.map((character) => character.negativePrompt),
	);
	if (family === "v3") {
		return {
			action: "generate",
			input: input3,
			model,
			parameters: {
				...base,
				params_version: 3,
				negative_prompt: negative3,
				noise_schedule: parameters.noiseSchedule,
				skip_cfg_above_sigma: skipCfgAboveSigma(parameters, model),
				use_coords: false,
			},
		};
	}
	return {
		action: "generate",
		input: basePrompt,
		model,
		parameters: {
			...base,
			params_version: 3,
			noise_schedule: parameters.noiseSchedule,
			skip_cfg_above_sigma: skipCfgAboveSigma(parameters, model),
			use_coords: useCoords,
			characterPrompts: structured.prompts,
			reference_image_multiple: [],
			reference_information_extracted_multiple: [],
			reference_strength_multiple: [],
			v4_prompt: {
				caption: {
					base_caption: basePrompt,
					char_captions: structured.charCaptions,
				},
				use_coords: useCoords,
				use_order: true,
			},
			v4_negative_prompt: {
				caption: {
					base_caption: baseNegative,
					char_captions: structured.negativeCaptions,
				},
				legacy_uc: false,
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

function retryAfterMs(response: Response, current: number): number | null {
	const raw = response.headers.get("retry-after");
	if (raw === null) return null;
	const text = raw.trim();
	if (text.length === 0) return null;
	const seconds = Number(text);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.ceil(seconds * 1_000);
	}
	const date = Date.parse(text);
	if (Number.isNaN(date)) return null;
	return Math.max(0, date - current);
}

export interface NovelAiClientOptions {
	readonly fetch: NovelAiFetch;
	/** 测试注入；默认真实等待。 */
	readonly sleep?: (ms: number) => Promise<void>;
	readonly now?: () => number;
	/** 每分钟请求上限；默认取 provider 配置，provider 未配置时为 10。 */
	readonly maxRequestsPerMinute?: number;
	/** 429 之后最多再试几次；默认 3 次。 */
	readonly maxRetries?: number;
	/** 429 没有 `Retry-After` 时的首次退避；之后翻倍。 */
	readonly retryBaseDelayMs?: number;
}

interface RequestQueue {
	run<T>(task: () => Promise<T>): Promise<T>;
}

function createRequestQueue(): RequestQueue {
	let tail: Promise<unknown> = Promise.resolve();
	return {
		run<T>(task: () => Promise<T>): Promise<T> {
			const next = tail.then(task, task);
			tail = next.then(
				() => undefined,
				() => undefined,
			);
			return next;
		},
	};
}

function createRateLimiter(options: {
	readonly maxRequestsPerMinute: number;
	readonly sleep: (ms: number) => Promise<void>;
	readonly now: () => number;
}): () => Promise<void> {
	const max = Math.max(1, Math.floor(options.maxRequestsPerMinute));
	const timestamps: number[] = [];
	return async (): Promise<void> => {
		while (true) {
			const current = options.now();
			const cutoff = current - 60_000;
			while (timestamps.length > 0 && (timestamps[0] as number) <= cutoff) {
				timestamps.shift();
			}
			if (timestamps.length < max) {
				timestamps.push(current);
				return;
			}
			const wait = (timestamps[0] as number) + 60_000 - current + 1;
			await options.sleep(wait);
		}
	};
}

/**
 * NovelAI 客户端：一次请求出一张图。官方接口返回 zip（内含 PNG），
 * 部分中转直接返回图片，两种都接受。同一 provider 的请求串行，
 * 按每分钟上限排队；429 按 `Retry-After` 或指数退避重试。
 */
export function createNovelAiClient(
	provider: NovelAiProviderConfig,
	options: NovelAiClientOptions,
) {
	const url = `${provider.baseUrl.replace(/\/+$/, "")}/ai/generate-image`;
	const sleep =
		options.sleep ??
		((ms: number) => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, ms);
			return promise;
		});
	const now = options.now ?? (() => Date.now());
	const queue = createRequestQueue();
	const acquire = createRateLimiter({
		maxRequestsPerMinute:
			options.maxRequestsPerMinute ?? provider.maxRequestsPerMinute,
		sleep,
		now,
	});
	const maxRetries = Math.max(0, options.maxRetries ?? 3);
	const retryBaseDelayMs = Math.max(1, options.retryBaseDelayMs ?? 1_000);

	const send = async (input: NovelAiGenerateInput): Promise<Response> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), provider.timeoutMs);
		try {
			return await options.fetch(url, {
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
	};

	return {
		async generate(
			input: NovelAiGenerateInput,
		): Promise<NovelAiGeneratedImage> {
			if (provider.apiKey.length === 0) {
				throw new Error("NovelAI 没有配置 apiKey");
			}
			return queue.run(async () => {
				for (let attempt = 0; ; attempt += 1) {
					await acquire();
					const response = await send(input);
					if (response.status === 429 && attempt < maxRetries) {
						const delay =
							retryAfterMs(response, now()) ?? retryBaseDelayMs * 2 ** attempt;
						await response.text();
						await sleep(delay);
						continue;
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
					if (entry === null) {
						throw new Error("NovelAI 返回的压缩包里没有 PNG");
					}
					return {
						promptId: `novelai-${input.seed}`,
						fileName: entry.name,
						mediaType: "image/png",
						bytes: entry.bytes,
					};
				}
			});
		},
	};
}

import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_NOVELAI_PARAMETERS,
	ILLUSTRATE_JOB_KIND,
	NOVELAI_DEFAULT_BASE_URL,
	assertNovelAiParameters,
	buildNovelAiRequestBody,
	createDefaultImageClientFactory,
	createIllustrateHandler,
	createNovelAiClient,
	extractFirstZipEntry,
	parseImagesConfig,
	resolveImageProvider,
	saveNovelAiTemplate,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);

/** 合成单文件 zip：method 0 存储，8 deflate。 */
function zipOf(name: string, data: Uint8Array, method: 0 | 8): Uint8Array {
	const body = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
	const nameBytes = new TextEncoder().encode(name);
	const local = new Uint8Array(30 + nameBytes.length);
	const lv = new DataView(local.buffer);
	lv.setUint32(0, 0x04034b50, true);
	lv.setUint16(8, method, true);
	lv.setUint32(18, body.length, true);
	lv.setUint32(22, data.length, true);
	lv.setUint16(26, nameBytes.length, true);
	local.set(nameBytes, 30);
	const central = new Uint8Array(46 + nameBytes.length);
	const cv = new DataView(central.buffer);
	cv.setUint32(0, 0x02014b50, true);
	cv.setUint16(10, method, true);
	cv.setUint32(20, body.length, true);
	cv.setUint32(24, data.length, true);
	cv.setUint16(28, nameBytes.length, true);
	cv.setUint32(42, 0, true);
	central.set(nameBytes, 46);
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, 1, true);
	ev.setUint16(10, 1, true);
	ev.setUint32(12, central.length, true);
	ev.setUint32(16, local.length + body.length, true);
	const out = new Uint8Array(local.length + body.length + central.length + 22);
	out.set(local, 0);
	out.set(body, local.length);
	out.set(central, local.length + body.length);
	out.set(eocd, local.length + body.length + central.length);
	return out;
}

const CONFIG = `providers:
  nai:
    api: novelai
    apiKey: \${NAI_KEY}
  comfy:
    api: comfyui
    baseUrl: http://127.0.0.1:8188
    apiKey: ""
`;

describe("NovelAI 配置与参数", () => {
	it("novelai 后端默认官方地址，密钥从环境变量读取", () => {
		const config = parseImagesConfig(CONFIG, { NAI_KEY: "pst-test" });
		const nai = config.providers.get("nai");
		expect(nai).toMatchObject({
			api: "novelai",
			baseUrl: NOVELAI_DEFAULT_BASE_URL,
			apiKey: "pst-test",
		});
		expect(resolveImageProvider(config, undefined, "novelai").id).toBe("nai");
		expect(resolveImageProvider(config, undefined, "comfyui").id).toBe("comfy");
	});

	it("参数缺省取默认值，尺寸必须是 64 的倍数，拒绝未知字段", () => {
		expect(assertNovelAiParameters({})).toEqual(DEFAULT_NOVELAI_PARAMETERS);
		expect(assertNovelAiParameters({ model: "nai-diffusion-3" })).toMatchObject(
			{
				model: "nai-diffusion-3",
				mediumTier: false,
				negativePreset: "heavy",
				fixedSeed: null,
				useCoords: false,
				straightAlpha: false,
			},
		);
		expect(() => assertNovelAiParameters({ width: 1000 })).toThrow("64 的倍数");
		expect(() => assertNovelAiParameters({ cfg: 1 })).toThrow("cfg");
		expect(() =>
			assertNovelAiParameters({ negativePreset: "extreme" }),
		).toThrow("negativePreset");
		expect(() => assertNovelAiParameters({ fixedSeed: -1 })).toThrow(
			"fixedSeed",
		);
	});
});

const CHARACTERS = [
	{
		prompt: "red hair, blue eyes",
		negativePrompt: "hat",
		center: { x: 0.2, y: 0.3 },
	},
	{
		prompt: "silver hair",
		negativePrompt: "",
		center: null,
	},
] as const;

interface BodyCharacterPrompt {
	readonly prompt: string;
	readonly uc: string;
	readonly center: { readonly x: number; readonly y: number };
	readonly enabled: boolean;
}

interface BodyCaption {
	readonly base_caption: string;
	readonly char_captions: readonly {
		readonly char_caption: string;
		readonly centers: readonly { readonly x: number; readonly y: number }[];
	}[];
}

interface BodyParameters {
	readonly params_version: number;
	readonly negative_prompt: string;
	readonly seed: number;
	readonly ucPreset: number;
	readonly use_coords: boolean;
	readonly sm: boolean;
	readonly sm_dyn: boolean;
	readonly skip_cfg_above_sigma?: number | null;
	readonly noise_schedule?: string;
	readonly straight_alpha?: boolean;
	readonly tag_hint_qt?: number;
	readonly tag_hint_uc_preset?: number;
	readonly characterPrompts?: readonly BodyCharacterPrompt[];
	readonly reference_image_multiple?: readonly unknown[];
	readonly v4_prompt?: {
		readonly caption: BodyCaption;
		readonly use_coords: boolean;
		readonly use_order: boolean;
	};
	readonly v4_negative_prompt?: {
		readonly caption: BodyCaption;
		readonly legacy_uc: boolean;
	};
}

function bodyOf(
	parameters: Partial<typeof DEFAULT_NOVELAI_PARAMETERS>,
	extra: {
		readonly prompt?: string;
		readonly negativePrompt?: string | null;
		readonly seed?: number;
		readonly characters?: typeof CHARACTERS;
	} = {},
): { input: string; model: string; parameters: BodyParameters } {
	return buildNovelAiRequestBody({
		parameters: { ...DEFAULT_NOVELAI_PARAMETERS, ...parameters },
		prompt: extra.prompt ?? "1girl",
		negativePrompt: extra.negativePrompt ?? "blurry",
		seed: extra.seed ?? 42,
		characters: extra.characters ?? CHARACTERS,
	}) as { input: string; model: string; parameters: BodyParameters };
}

describe("NovelAI 三套请求体", () => {
	it("V3 把人物提示词拼回扁平字段，不发 v4 结构与 characterPrompts", () => {
		const body = bodyOf({
			model: "nai-diffusion-3",
			qualityTags: "",
			negativeTags: "",
			negativePreset: "none",
		});
		expect(body.input).toBe("1girl, red hair, blue eyes, silver hair");
		expect(body.parameters.params_version).toBe(3);
		expect(body.parameters.negative_prompt).toBe("blurry, hat");
		expect(body.parameters.ucPreset).toBe(4);
		expect(body.parameters.v4_prompt).toBeUndefined();
		expect(body.parameters.v4_negative_prompt).toBeUndefined();
		expect(body.parameters.characterPrompts).toBeUndefined();
		expect(body.parameters.use_coords).toBe(false);
		expect(body.parameters.sm).toBe(false);
		expect(body.parameters.sm_dyn).toBe(false);
		expect(body.parameters.skip_cfg_above_sigma).toBeNull();
		expect(body.parameters.noise_schedule).toBe("karras");
	});

	it("V4.x 用多人物 caption、坐标与人物级负面，并按尺寸算 skip_cfg", () => {
		const body = bodyOf({
			model: "nai-diffusion-4-5-full",
			qualityTags: "best quality",
			negativeTags: "lowres",
			negativePreset: "light",
			useCoords: true,
			varietyBoost: true,
		});
		expect(body.model).toBe("nai-diffusion-4-5-full");
		expect(body.parameters.params_version).toBe(3);
		expect(body.parameters.ucPreset).toBe(1);
		expect(body.parameters.negative_prompt).toContain("sepia");
		expect(body.parameters.negative_prompt).toContain("lowres, blurry");
		expect(body.parameters.v4_prompt).toEqual({
			caption: {
				base_caption: "1girl, best quality",
				char_captions: [
					{
						char_caption: "red hair, blue eyes",
						centers: [{ x: 0.2, y: 0.3 }],
					},
					{ char_caption: "silver hair", centers: [{ x: 0.5, y: 0.5 }] },
				],
			},
			use_coords: true,
			use_order: true,
		});
		expect(body.parameters.v4_negative_prompt).toMatchObject({
			caption: {
				char_captions: [
					{ char_caption: "hat", centers: [{ x: 0.2, y: 0.3 }] },
					{ char_caption: "", centers: [{ x: 0.5, y: 0.5 }] },
				],
			},
			legacy_uc: false,
		});
		expect(body.parameters.characterPrompts).toEqual([
			{
				prompt: "red hair, blue eyes",
				uc: "hat",
				center: { x: 0.2, y: 0.3 },
				enabled: true,
			},
			{
				prompt: "silver hair",
				uc: "",
				center: { x: 0.5, y: 0.5 },
				enabled: true,
			},
		]);
		expect(body.parameters.reference_image_multiple).toEqual([]);
		expect(body.parameters.skip_cfg_above_sigma as number).toBeGreaterThan(0);
		expect(body.parameters.noise_schedule).toBe("karras");
	});

	it("关闭坐标时 use_coords 为假，人物仍带默认中心点", () => {
		const body = bodyOf({
			model: "nai-diffusion-4-5-full",
			useCoords: false,
			negativePreset: "none",
			qualityTags: "",
			negativeTags: "",
		});
		expect(body.parameters.use_coords).toBe(false);
		expect(body.parameters.v4_prompt).toMatchObject({
			use_coords: false,
		});
		const caption = body.parameters.v4_prompt?.caption;
		expect(caption?.char_captions[0]).toMatchObject({
			char_caption: "red hair, blue eyes",
			centers: [{ x: 0.5, y: 0.5 }],
		});
		expect(caption?.char_captions[1]).toMatchObject({
			char_caption: "silver hair",
			centers: [{ x: 0.5, y: 0.5 }],
		});
	});

	it("V5 用 params_version 4，Medium 档换模型，去掉 skip_cfg、旧参考数组与默认噪点表", () => {
		const body = bodyOf({
			model: "nai-diffusion-5-full",
			mediumTier: true,
			negativePreset: "human_focus",
			useCoords: true,
			straightAlpha: true,
			tagHintQt: true,
			tagHintUcPreset: true,
			qualityTags: "",
			negativeTags: "",
		});
		expect(body.model).toBe("nai-diffusion-5-full-medium");
		expect(body.parameters.params_version).toBe(4);
		expect(body.parameters.ucPreset).toBe(3);
		expect(body.parameters.straight_alpha).toBe(true);
		expect(body.parameters.tag_hint_qt).toBe(1);
		expect(body.parameters.tag_hint_uc_preset).toBe(4);
		expect(body.parameters.negative_prompt).toContain("@_@");
		expect("skip_cfg_above_sigma" in body.parameters).toBe(false);
		expect("reference_image_multiple" in body.parameters).toBe(false);
		expect("reference_information_extracted_multiple" in body.parameters).toBe(
			false,
		);
		expect("reference_strength_multiple" in body.parameters).toBe(false);
		expect("noise_schedule" in body.parameters).toBe(false);
		expect(body.parameters.v4_prompt).toEqual({
			caption: {
				base_caption: "1girl",
				char_captions: [
					{
						char_caption: "red hair, blue eyes",
						centers: [{ x: 0.2, y: 0.3 }],
					},
					{ char_caption: "silver hair", centers: [{ x: 0.5, y: 0.5 }] },
				],
			},
			use_coords: true,
			use_order: true,
		});
		expect(body.parameters.v4_negative_prompt).toMatchObject({
			legacy_uc: false,
		});
		expect(body.parameters.characterPrompts).toHaveLength(2);
	});

	it("V5 只在显式改成非默认噪点表时发送 noise_schedule，已带 medium 不重复拼", () => {
		const body = bodyOf({
			model: "nai-diffusion-5-curated-medium",
			mediumTier: true,
			noiseSchedule: "exponential",
			negativePreset: "none",
		});
		expect(body.model).toBe("nai-diffusion-5-curated-medium");
		expect(body.parameters.noise_schedule).toBe("exponential");
	});
});

describe("zip 解包", () => {
	it("存储与 deflate 两种方式都能取出 PNG", () => {
		for (const method of [0, 8] as const) {
			const entry = extractFirstZipEntry(
				zipOf("image_0.png", PNG, method),
				".png",
			);
			expect(entry?.name).toBe("image_0.png");
			expect([...(entry?.bytes ?? [])]).toEqual([...PNG]);
		}
		expect(extractFirstZipEntry(PNG, ".png")).toBeNull();
	});
});

describe("NovelAI 客户端与模板", () => {
	it("用模板参数请求，返回 zip 里的 PNG；模板与后端不匹配时报错", async () => {
		const config = parseImagesConfig(CONFIG, { NAI_KEY: "pst-test" });
		const { store } = openTempStore();
		const template = saveNovelAiTemplate(store, config, {
			name: "竖图",
			parameters: { steps: 23 },
		});
		expect(template).toMatchObject({
			kind: "novelai",
			provider: "nai",
			slots: null,
		});
		expect(store.getImageWorkflow(template.id)?.payload).toMatchObject({
			steps: 23,
		});
		const calls: { url: string; init?: RequestInit }[] = [];
		const factory = createDefaultImageClientFactory({
			fetch: async (url, init) => {
				calls.push({ url, ...(init === undefined ? {} : { init }) });
				return new Response(zipOf("image_0.png", PNG, 8), {
					headers: { "content-type": "application/zip" },
				});
			},
		});
		const nai = config.providers.get("nai");
		if (nai === undefined) throw new Error("缺少 nai");
		const image = await factory(nai).generate({
			template,
			prompt: "1girl",
			negativePrompt: null,
			seed: 7,
			width: null,
			height: null,
		});
		expect(image.mediaType).toBe("image/png");
		expect([...image.bytes]).toEqual([...PNG]);
		expect(calls[0]?.url).toBe(`${NOVELAI_DEFAULT_BASE_URL}/ai/generate-image`);
		const headers = calls[0]?.init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer pst-test");
		const sent = JSON.parse(String(calls[0]?.init?.body)) as {
			parameters: { steps: number };
		};
		expect(sent.parameters.steps).toBe(23);
		const comfy = config.providers.get("comfy");
		if (comfy === undefined) throw new Error("缺少 comfy");
		expect(() =>
			factory(comfy).generate({
				template,
				prompt: "x",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).toThrow("不能用 ComfyUI");
	});

	it("接口返回错误时带上状态码", async () => {
		const config = parseImagesConfig(CONFIG, { NAI_KEY: "pst-test" });
		const { store } = openTempStore();
		const template = saveNovelAiTemplate(store, config, { name: "t" });
		const nai = config.providers.get("nai");
		if (nai === undefined) throw new Error("缺少 nai");
		const factory = createDefaultImageClientFactory({
			fetch: async () => new Response("Unauthorized", { status: 401 }),
		});
		await expect(
			factory(nai).generate({
				template,
				prompt: "x",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).rejects.toThrow("401");
	});
});

function fakeClock(): {
	readonly now: () => number;
	readonly sleep: (ms: number) => Promise<void>;
	readonly sleeps: number[];
} {
	let current = 1_000_000;
	const sleeps: number[] = [];
	return {
		now: () => current,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			current += ms;
		},
		sleeps,
	};
}

function pngBytes(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

const NAI_PROVIDER = {
	id: "nai",
	api: "novelai" as const,
	baseUrl: "http://127.0.0.1:9999",
	apiKey: "pst-test",
	timeoutMs: 5_000,
	maxRequestsPerMinute: 60,
};

const NAI_INPUT = {
	parameters: {
		...DEFAULT_NOVELAI_PARAMETERS,
		negativePreset: "none" as const,
	},
	prompt: "1girl",
	negativePrompt: null,
	seed: 7,
};

describe("NovelAI 429 退避与本地每分钟上限", () => {
	it("先两次 429（带与不带 Retry-After）后成功，退避时间递增", async () => {
		const clock = fakeClock();
		let calls = 0;
		const client = createNovelAiClient(NAI_PROVIDER, {
			fetch: async () => {
				calls += 1;
				if (calls === 1) {
					return new Response("slow down", {
						status: 429,
						headers: { "retry-after": "1" },
					});
				}
				if (calls === 2) return new Response("slow down", { status: 429 });
				return new Response(pngBytes(2, 2), {
					headers: { "content-type": "image/png" },
				});
			},
			sleep: clock.sleep,
			now: clock.now,
			maxRequestsPerMinute: 60,
			maxRetries: 3,
			retryBaseDelayMs: 1_000,
		});
		const image = await client.generate(NAI_INPUT);
		expect(calls).toBe(3);
		expect(clock.sleeps).toEqual([1_000, 2_000]);
		expect([...image.bytes]).toEqual([...pngBytes(2, 2)]);
	});

	it("连续耗尽重试次数才抛错", async () => {
		const clock = fakeClock();
		let calls = 0;
		const client = createNovelAiClient(NAI_PROVIDER, {
			fetch: async () => {
				calls += 1;
				return new Response("slow down", { status: 429 });
			},
			sleep: clock.sleep,
			now: clock.now,
			maxRequestsPerMinute: 60,
			maxRetries: 2,
			retryBaseDelayMs: 1_000,
		});
		await expect(client.generate(NAI_INPUT)).rejects.toThrow("429");
		expect(calls).toBe(3);
	});

	it("超过每分钟上限时排队等待下一分钟", async () => {
		const clock = fakeClock();
		let calls = 0;
		const client = createNovelAiClient(NAI_PROVIDER, {
			fetch: async () => {
				calls += 1;
				return new Response(pngBytes(2, 2), {
					headers: { "content-type": "image/png" },
				});
			},
			sleep: clock.sleep,
			now: clock.now,
			maxRequestsPerMinute: 2,
		});
		await client.generate(NAI_INPUT);
		await client.generate(NAI_INPUT);
		await client.generate(NAI_INPUT);
		expect(calls).toBe(3);
		expect(clock.sleeps).toEqual([60_001]);
	});
});

describe("出图任务接入整理结果与固定 seed", () => {
	it("队列优先使用模板 fixedSeed，并把多人物提示词传给客户端", async () => {
		const config = parseImagesConfig(CONFIG, { NAI_KEY: "pst-test" });
		const { store, path } = openTempStore();
		const workflow = saveNovelAiTemplate(store, config, {
			name: "固定 seed",
			parameters: { model: "nai-diffusion-5-full", fixedSeed: 4242 },
		});
		store.createStory({ id: "s1", title: "出图" });
		const node = store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "雨夜的车站。",
		});
		const organizerResult = {
			images: [
				{
					insertAfterParagraph: 0,
					title: "雨夜",
					scene: "雨夜的车站",
					composition: "wide shot",
					characters: [
						{
							name: "林雪",
							angle: "front" as const,
							body: "upper" as const,
							exposure: "clothed" as const,
							outfitName: null,
							action: null,
							negative: null,
							center: { x: 0.2, y: 0.3 },
						},
					],
					negativePrompt: null,
				},
			],
			expanded: [
				{
					insertAfterParagraph: 0,
					title: "雨夜",
					prompt: "rain, red hair",
					negativePrompt: "bad hands",
					characters: [
						{
							name: "林雪",
							prompt: "red hair",
							negative: "hat",
							center: { x: 0.2, y: 0.3 },
							outfitId: null,
						},
					],
				},
			],
		};
		const image = store.insertNodeImage({
			storyId: "s1",
			nodeId: node.id,
			request: { scene: "雨夜的车站" },
			workflowId: workflow.id,
			seed: 7,
			prompt: "rain, red hair",
			negativePrompt: "bad hands",
			organizerResult,
		});
		let capturedSeed = -1;
		let capturedCharacters: readonly unknown[] = [];
		const handler = createIllustrateHandler({
			config,
			mediaDir: join(path, "..", "images"),
			createClient: () => ({
				async generate(input) {
					capturedSeed = input.seed;
					capturedCharacters = input.characters ?? [];
					return {
						promptId: "p",
						fileName: "a.png",
						mediaType: "image/png",
						bytes: pngBytes(2, 2),
					};
				},
			}),
		});
		await handler({
			store,
			client: {
				async complete() {
					throw new Error("出图任务不调用文本模型");
				},
			},
			job: {
				id: 1,
				storyId: "s1",
				nodeId: null,
				kind: ILLUSTRATE_JOB_KIND,
				status: "running",
				attempts: 1,
				lastError: null,
				createdAt: new Date(0).toISOString(),
				startedAt: null,
				finishedAt: null,
			},
		});
		expect(capturedSeed).toBe(4242);
		expect(capturedCharacters).toEqual([
			{
				prompt: "red hair",
				negativePrompt: "hat",
				center: { x: 0.2, y: 0.3 },
			},
		]);
		expect(store.getNodeImage(image.id)?.status).toBe("done");
	});
});

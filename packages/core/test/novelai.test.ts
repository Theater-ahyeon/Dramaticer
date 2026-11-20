import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_NOVELAI_PARAMETERS,
	NOVELAI_DEFAULT_BASE_URL,
	assertNovelAiParameters,
	buildNovelAiRequestBody,
	createDefaultImageClientFactory,
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
		expect(() => assertNovelAiParameters({ width: 1000 })).toThrow("64 的倍数");
		expect(() => assertNovelAiParameters({ cfg: 1 })).toThrow("cfg");
	});

	it("请求体同时填 V3 与 V4 的提示词，画质与负面标签拼在两头", () => {
		const body = buildNovelAiRequestBody({
			parameters: {
				...DEFAULT_NOVELAI_PARAMETERS,
				qualityTags: "best quality",
				negativeTags: "lowres",
			},
			prompt: "1girl, snow",
			negativePrompt: "blurry",
			seed: 42,
		}) as { input: string; parameters: Record<string, unknown> };
		expect(body.input).toBe("1girl, snow, best quality");
		expect(body.parameters.negative_prompt).toBe("lowres, blurry");
		expect(body.parameters.seed).toBe(42);
		expect(body.parameters.v4_prompt).toEqual({
			caption: { base_caption: "1girl, snow, best quality", char_captions: [] },
			use_coords: false,
			use_order: true,
		});
		expect(body.parameters.skip_cfg_above_sigma).toBeNull();
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

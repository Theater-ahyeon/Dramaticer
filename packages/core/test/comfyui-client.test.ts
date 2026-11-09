import { describe, expect, it } from "vitest";
import {
	type ComfyUiFetch,
	type ComfyUiProviderConfig,
	type ComfyUiSlots,
	type ComfyUiWorkflow,
	createComfyUiClient,
	parseComfyUiWorkflow,
} from "../src/index.js";

const provider: ComfyUiProviderConfig = {
	id: "comfy",
	api: "comfyui",
	baseUrl: "http://127.0.0.1:8188/",
	apiKey: "",
	timeoutMs: 5_000,
	pollIntervalMs: 10,
};

function workflow(): ComfyUiWorkflow {
	return parseComfyUiWorkflow({
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: 1,
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: 512, height: 512 },
		},
		"6": { class_type: "CLIPTextEncode", inputs: { text: "原始正向" } },
		"7": { class_type: "CLIPTextEncode", inputs: { text: "原始负向" } },
	});
}

const slots: ComfyUiSlots = {
	positive: { nodeId: "6", input: "text" },
	negative: { nodeId: "7", input: "text" },
	seed: { nodeId: "3", input: "seed" },
	width: { nodeId: "5", input: "width" },
	height: { nodeId: "5", input: "height" },
};

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("createComfyUiClient", () => {
	it("提交、轮询、下载并改写插槽，但不修改传入的 workflow", async () => {
		const requests: { url: string; init: RequestInit | undefined }[] = [];
		let historyCalls = 0;
		const fakeFetch: ComfyUiFetch = async (url, init) => {
			requests.push({ url, init });
			if (url.endsWith("/prompt")) return json({ prompt_id: "p1" });
			if (url.includes("/history/p1")) {
				historyCalls += 1;
				if (historyCalls === 1) return json({});
				return json({
					p1: {
						status: { status_str: "success" },
						outputs: {
							"9": {
								images: [{ filename: "a.png", subfolder: "", type: "output" }],
							},
						},
					},
				});
			}
			if (url.includes("/view?")) {
				return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
					status: 200,
					headers: { "Content-Type": "image/png" },
				});
			}
			throw new Error(`未预期的请求：${url}`);
		};
		const original = workflow();
		const client = createComfyUiClient(provider, {
			fetch: fakeFetch,
			sleep: async () => {},
		});
		const image = await client.generate({
			workflow: original,
			slots,
			prompt: "一只猫",
			negativePrompt: "低质量",
			seed: 99,
			width: 640,
			height: 480,
		});
		expect(image.promptId).toBe("p1");
		expect(image.fileName).toBe("a.png");
		expect(image.mediaType).toBe("image/png");
		expect(Array.from(image.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
		const post = requests.find((request) => request.url.endsWith("/prompt"));
		expect(post?.init?.method).toBe("POST");
		const body = JSON.parse(String(post?.init?.body)) as {
			prompt: ComfyUiWorkflow;
		};
		expect(body.prompt["6"]?.inputs.text).toBe("一只猫");
		expect(body.prompt["7"]?.inputs.text).toBe("低质量");
		expect(body.prompt["3"]?.inputs.seed).toBe(99);
		expect(body.prompt["5"]?.inputs.width).toBe(640);
		expect(body.prompt["5"]?.inputs.height).toBe(480);
		expect(original["6"]?.inputs.text).toBe("原始正向");
	});

	it("历史记录错误与空输出都抛出并带 prompt id", async () => {
		const errorClient = createComfyUiClient(provider, {
			fetch: async (url) => {
				if (url.endsWith("/prompt")) return json({ prompt_id: "p2" });
				if (url.includes("/history/p2")) {
					return json({ p2: { status: { status_str: "error" } } });
				}
				throw new Error(`未预期的请求：${url}`);
			},
			sleep: async () => {},
		});
		await expect(
			errorClient.generate({
				workflow: workflow(),
				slots,
				prompt: "p",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).rejects.toThrow(/错误.*p2/);

		const emptyClient = createComfyUiClient(provider, {
			fetch: async (url) => {
				if (url.endsWith("/prompt")) return json({ prompt_id: "p3" });
				if (url.includes("/history/p3")) {
					return json({
						p3: { status: { status_str: "success" }, outputs: {} },
					});
				}
				throw new Error(`未预期的请求：${url}`);
			},
			sleep: async () => {},
		});
		await expect(
			emptyClient.generate({
				workflow: workflow(),
				slots,
				prompt: "p",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).rejects.toThrow(/没有图片输出.*p3/);
	});

	it("非 2xx、缺少 prompt_id 与下载失败都抛出", async () => {
		const postFailure = createComfyUiClient(provider, {
			fetch: async () => new Response("bad", { status: 500 }),
			sleep: async () => {},
		});
		await expect(
			postFailure.generate({
				workflow: workflow(),
				slots,
				prompt: "p",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).rejects.toThrow(/500/);

		const missingId = createComfyUiClient(provider, {
			fetch: async () => json({}),
			sleep: async () => {},
		});
		await expect(
			missingId.generate({
				workflow: workflow(),
				slots,
				prompt: "p",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).rejects.toThrow(/prompt_id/);

		const historyFailure = createComfyUiClient(provider, {
			fetch: async (url) => {
				if (url.endsWith("/prompt")) return json({ prompt_id: "p4" });
				return new Response("boom", { status: 502 });
			},
			sleep: async () => {},
		});
		await expect(
			historyFailure.generate({
				workflow: workflow(),
				slots,
				prompt: "p",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).rejects.toThrow(/502.*p4/);

		const downloadFailure = createComfyUiClient(provider, {
			fetch: async (url) => {
				if (url.endsWith("/prompt")) return json({ prompt_id: "p5" });
				if (url.includes("/history/p5")) {
					return json({
						p5: {
							outputs: {
								"9": { images: [{ filename: "a.png", type: "output" }] },
							},
						},
					});
				}
				return new Response("missing", { status: 404 });
			},
			sleep: async () => {},
		});
		await expect(
			downloadFailure.generate({
				workflow: workflow(),
				slots,
				prompt: "p",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).rejects.toThrow(/下载图片失败.*404.*p5/);
	});

	it("总超时按注入的时钟计算，并保留 prompt id", async () => {
		let clock = 0;
		const client = createComfyUiClient(
			{ ...provider, timeoutMs: 30, pollIntervalMs: 10 },
			{
				fetch: async (url) => {
					if (url.endsWith("/prompt")) return json({ prompt_id: "p6" });
					return json({});
				},
				now: () => clock,
				sleep: async (ms) => {
					clock += ms;
				},
			},
		);
		await expect(
			client.generate({
				workflow: workflow(),
				slots,
				prompt: "p",
				negativePrompt: null,
				seed: 1,
				width: null,
				height: null,
			}),
		).rejects.toThrow(/超时.*p6/);
	});
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_NOVELAI_PARAMETERS,
	NOVELAI_DEFAULT_BASE_URL,
	createNovelAiClient,
	loadDotEnvIfPresent,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
// 与其它 live 用例一致：只有显式打开开关才跑，CI 上不碰网络。
const enabled = process.env.DRAMATICER_LIVE === "1";

/** 真实 NovelAI 只在这个文件里访问；开关没打开时整组跳过。 */
describe.skipIf(!enabled)("NovelAI 生图（真实渠道）", () => {
	it("用令牌生成一张 PNG", async () => {
		loadDotEnvIfPresent(path.join(repoRoot, ".env"));
		const apiKey = (process.env.NOVELAI_API_KEY ?? "").trim();
		if (apiKey.length === 0) {
			throw new Error("没有 NOVELAI_API_KEY，无法访问真实 NovelAI");
		}
		const client = createNovelAiClient(
			{
				id: "novelai-live",
				api: "novelai",
				baseUrl: NOVELAI_DEFAULT_BASE_URL,
				apiKey,
				timeoutMs: 180_000,
				maxRequestsPerMinute: 10,
			},
			{ fetch: (url, init) => fetch(url, init) },
		);
		const image = await client.generate({
			parameters: {
				...DEFAULT_NOVELAI_PARAMETERS,
				model: "nai-diffusion-4-5-full",
				width: 512,
				height: 768,
				steps: 1,
				negativePreset: "none",
			},
			prompt: "1girl, solo",
			negativePrompt: null,
			seed: 20261127,
		});
		expect(image.mediaType).toBe("image/png");
		expect([...image.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
	}, 240_000);
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_NOVELAI_PARAMETERS,
	NOVELAI_DEFAULT_BASE_URL,
	createNovelAiClient,
	loadDotEnv,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
loadDotEnv(path.join(repoRoot, ".env"));
const apiKey = (process.env.NOVELAI_API_KEY ?? "").trim();

/** 真实 NovelAI 只在这个文件里访问；没有令牌时整组跳过。 */
describe.skipIf(apiKey.length === 0)("NovelAI 生图（真实渠道）", () => {
	it.skipIf(apiKey.length === 0)(
		"用令牌生成一张 PNG",
		async () => {
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
		},
		240_000,
	);
});

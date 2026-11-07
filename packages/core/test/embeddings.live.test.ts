import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	createEmbeddingClient,
	loadChannelsConfig,
	loadDotEnv,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const enabled = process.env.DRAMATICER_LIVE === "1";

describe.skipIf(!enabled)("embedding 渠道（真实渠道）", () => {
	it("bge-m3 返回配置维度的向量", async () => {
		loadDotEnv(path.join(repoRoot, ".env"));
		const config = await loadChannelsConfig(
			path.join(repoRoot, "data", "channels.yaml"),
		);
		const client = createEmbeddingClient(config);
		const vectors = await client.embed(["山门在夜色里缓缓打开。"]);
		expect(vectors).toHaveLength(1);
		expect(vectors[0]).toHaveLength(client.dimensions);
		expect(client.dimensions).toBe(1024);
		expect(vectors[0]?.every((value) => Number.isFinite(value))).toBe(true);
	}, 60_000);
});

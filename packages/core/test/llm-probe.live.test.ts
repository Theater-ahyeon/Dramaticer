import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	createLlmChannel,
	loadChannelsConfig,
	loadDotEnv,
	probeChannel,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const enabled = process.env.DRAMATICER_LIVE === "1";

describe.skipIf(!enabled)("渠道体检（真实渠道）", () => {
	it("probe 正文渠道", async () => {
		loadDotEnv(path.join(repoRoot, ".env"));
		const config = await loadChannelsConfig(
			path.join(repoRoot, "data", "channels.yaml"),
		);
		const model = config.models.get("main");
		if (model === undefined) throw new Error("渠道配置里没有模型 main");
		const channelId = model.channels[0];
		const channel = config.channels.get(channelId);
		if (channel === undefined) {
			throw new Error(`渠道配置里没有渠道 ${channelId}`);
		}
		const probe = await probeChannel({
			channel: createLlmChannel(channel),
			model: {
				id: model.id,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
			},
		});
		console.log(JSON.stringify(probe, null, 2));
		expect(probe.streaming).not.toBe("unknown");
		expect(probe.usage).toBe("supported");
	}, 240_000);
});

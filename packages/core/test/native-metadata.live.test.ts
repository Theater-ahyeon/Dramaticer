import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type LlmToolDefinition,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
} from "../src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const enabled = process.env.DRAMATICER_DEEP_LIVE === "1";

const LEDGER_TOOL: LlmToolDefinition = {
	name: "ledger_read",
	description: "读取当前故事的台账。参数是空对象。",
	parameters: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
};

describe.skipIf(!enabled)("深回合原生元数据（真实中转渠道）", () => {
	it("两轮工具调用在回放原生内容后仍能完成", async () => {
		loadDotEnv(path.join(repoRoot, ".env"));
		const config = await loadChannelsConfig(
			path.join(repoRoot, "data", "channels.yaml"),
		);
		const client = createLlmClient(config, {
			defaultModel: "main-fallback",
			cacheDir: null,
		});
		const first = await client.complete({
			messages: [
				{
					role: "user",
					content:
						"请先调用 ledger_read 工具一次，参数是空对象。不要直接回答，等工具结果回来再写一句话。",
				},
			],
			tools: [LEDGER_TOOL],
			maxTokens: 512,
		});
		expect(first.toolCalls.length).toBeGreaterThan(0);
		const call = first.toolCalls[0];
		if (call === undefined) {
			throw new Error("第一轮没有返回工具调用");
		}

		const second = await client.complete({
			messages: [
				{
					role: "user",
					content:
						"请先调用 ledger_read 工具一次，参数是空对象。不要直接回答，等工具结果回来再写一句话。",
				},
				{
					role: "assistant",
					content: first.text,
					toolCalls: first.toolCalls,
					...(first.native === undefined ? {} : { native: first.native }),
				},
				{
					role: "tool",
					toolCallId: call.id,
					toolName: call.name,
					content: "台账为空。",
				},
			],
			tools: [LEDGER_TOOL],
			maxTokens: 512,
		});
		expect(second.text.trim().length).toBeGreaterThan(0);
	}, 240_000);
});

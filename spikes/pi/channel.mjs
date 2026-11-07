import { readFileSync } from "node:fs";
import {
	createModels,
	createProvider,
	envApiKeyAuth,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const envPath = new URL("../../.env", import.meta.url);

function readEnvFile() {
	const values = new Map();
	for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
		if (match) values.set(match[1], match[2]);
	}
	return values;
}

/** 从 .env 读取 `DRAMATICER_<prefix>_BASE_URL`、`_MODEL`、`_API_KEY`，并把密钥放进环境变量。 */
export function loadChannel(prefix) {
	const values = readEnvFile();
	const required = (name) => {
		const value = values.get(name);
		if (!value) throw new Error(`${name} 在 .env 里缺失`);
		return value;
	};
	const baseUrl = required(`DRAMATICER_${prefix}_BASE_URL`);
	const modelId = required(`DRAMATICER_${prefix}_MODEL`);
	const apiKeyName = `DRAMATICER_${prefix}_API_KEY`;
	process.env[apiKeyName] = required(apiKeyName);
	return { baseUrl, modelId, apiKeyName };
}

/**
 * 把渠道包装成一个只有单个模型的 pi provider。模型 id 原样透传，不解析前缀。
 */
export function createChannelProvider(channel, options = {}) {
	const model = {
		id: channel.modelId,
		name: channel.modelId,
		api: "openai-completions",
		provider: "dramaticer-channel",
		baseUrl: channel.baseUrl,
		reasoning: options.reasoning ?? true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		...(options.compat ? { compat: options.compat } : {}),
	};
	const provider = createProvider({
		id: "dramaticer-channel",
		name: "Dramaticer 渠道",
		auth: { apiKey: envApiKeyAuth("Dramaticer 渠道", [channel.apiKeyName]) },
		models: [model],
		api: openAICompletionsApi(),
	});
	const models = createModels();
	models.setProvider(provider);
	return { models, model };
}

export function textOf(message) {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

export function thinkingOf(message) {
	return message.content
		.filter((block) => block.type === "thinking")
		.map((block) => block.thinking)
		.join("");
}

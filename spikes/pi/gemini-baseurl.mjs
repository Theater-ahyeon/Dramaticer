import { createModels, createProvider } from "@earendil-works/pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { textOf } from "./channel.mjs";

const baseUrl = process.env.GCLI2API_BASE_URL ?? "http://127.0.0.1:7861";
const modelId = process.env.GCLI2API_MODEL ?? "gemini-2.5-flash";

const model = {
	id: modelId,
	name: modelId,
	api: "google-generative-ai",
	provider: "gcli2api",
	baseUrl,
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1048576,
	maxTokens: 8192,
};
const provider = createProvider({
	id: "gcli2api",
	name: "gcli2api",
	auth: {
		apiKey: {
			name: "gcli2api",
			resolve: async () => ({ auth: { apiKey: "spike" } }),
		},
	},
	models: [model],
	api: googleGenerativeAIApi(),
});
const models = createModels();
models.setProvider(provider);

let reachable = false;
try {
	const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
	reachable = true;
	console.log("服务状态:", response.status);
} catch (error) {
	console.log(
		"服务状态: 无法连接",
		baseUrl,
		error.cause?.code ?? error.message,
	);
}

let requestedUrl = null;
const originalFetch = globalThis.fetch;
// 只观察实际发出的请求地址，随后仍用原 fetch 发真实请求。
globalThis.fetch = (input, init) => {
	requestedUrl = typeof input === "string" ? input : input.url;
	return originalFetch(input, init);
};
let responseText = "";
let message;
try {
	const stream = models.streamSimple(
		model,
		{
			messages: [
				{ role: "user", content: "只回复 OK。", timestamp: Date.now() },
			],
		},
		{ reasoning: "off", maxTokens: 64 },
	);
	for await (const event of stream) {
		if (event.type === "text_delta") responseText += event.delta;
	}
	message = await stream.result();
} finally {
	globalThis.fetch = originalFetch;
}

console.log(
	"result:",
	JSON.stringify(
		{
			reachable,
			baseUrl,
			requestedUrl,
			modelId,
			stopReason: message.stopReason,
			errorMessage: message.errorMessage ?? null,
			text: textOf(message).slice(0, 120) || responseText.slice(0, 120),
		},
		null,
		2,
	),
);

if (!reachable) {
	const honored = requestedUrl?.startsWith(baseUrl) ?? false;
	console.log(
		honored
			? `SKIP: gcli2api 没有在运行；已确认适配器把请求发往自定义 baseUrl（${requestedUrl}），端到端验证留给服务可用时重跑`
			: "SKIP: gcli2api 没有在运行；没有观察到请求地址",
	);
} else if (message.stopReason === "stop") {
	console.log("PASS: Gemini 原生适配器用自定义 baseUrl 指向 gcli2api 成功");
} else {
	console.error("FAIL:", message.errorMessage ?? message.stopReason);
	process.exitCode = 1;
}

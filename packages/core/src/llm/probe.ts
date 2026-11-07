import { isJsonObject } from "../json.js";
import type {
	LlmModelProbe,
	LlmProbeStreaming,
	LlmProbeSupport,
} from "./channels.js";
import type {
	LlmChannel,
	LlmModelInfo,
	LlmProviderRequest,
	LlmProviderResult,
	LlmToolDefinition,
} from "./types.js";

const STREAMING_PROMPT = "请用一句话介绍你自己，只输出正文。";

const FUNCTION_PROMPT =
	"请调用 dramaticer_probe 工具，参数 value 设为 ok。不要用文字回答。";

const FUNCTION_TOOL: LlmToolDefinition = {
	name: "dramaticer_probe",
	description: "渠道体检用的测试工具，调用时把 value 设为 ok。",
	parameters: {
		type: "object",
		properties: {
			value: { type: "string" },
		},
		required: ["value"],
		additionalProperties: false,
	},
};

const PREFILL_PROMPT =
	'请只输出一个 JSON 对象：{"probe":"prefill-ok"}，不要输出任何其他内容。';

const CACHE_FILLER = Array.from(
	{ length: 240 },
	(_, index) =>
		`缓存检查第 ${index + 1} 行：这一段固定文本用于让提供方的前缀缓存有足够的长度。`,
).join("\n");

export interface ProbeChannelOptions {
	readonly channel: LlmChannel;
	readonly model: LlmModelInfo;
	readonly now?: () => number;
	readonly signal?: AbortSignal;
}

interface CallObservation {
	readonly result: LlmProviderResult;
	readonly textDeltas: number;
	readonly reasoningChars: number;
	readonly firstTextAt: number | null;
	readonly startedAt: number;
	readonly finishedAt: number;
}

/**
 * 对一个渠道做一组真实请求，记录它支持哪些能力。
 *
 * 流式、思考与用量由同一次请求判断；函数调用、预填充各用一次请求；
 * 缓存统计用两次相同的大前缀请求，只看第二次是否报告命中缓存。
 */
export async function probeChannel(
	options: ProbeChannelOptions,
): Promise<LlmModelProbe> {
	const now = options.now ?? Date.now;
	const notes: string[] = [];

	const streaming = await probeStreaming(options, now, notes);
	const functionCalling = await probeFunctionCalling(options, notes);
	const prefill = await probePrefill(options, notes);
	const cacheStats = await probeCacheStats(options, now, notes);

	return {
		probedAt: new Date(now()).toISOString(),
		channel: options.channel.id,
		modelId: options.model.id,
		streaming: streaming.streaming,
		functionCalling,
		thinking: streaming.thinking,
		prefill,
		usage: streaming.usage,
		cacheStats,
		structuredOutput:
			functionCalling === "supported" ? "function-call" : "text-tags",
		notes,
	};
}

async function probeStreaming(
	options: ProbeChannelOptions,
	now: () => number,
	notes: string[],
): Promise<{
	readonly streaming: LlmProbeStreaming;
	readonly thinking: LlmProbeSupport;
	readonly usage: LlmProbeSupport;
}> {
	let observation: CallObservation;
	try {
		observation = await runCall(
			options.channel,
			{
				model: options.model,
				messages: [{ role: "user", content: STREAMING_PROMPT }],
				temperature: 0,
				maxTokens: 800,
				reasoning: "low",
				signal: options.signal,
			},
			now,
		);
	} catch (error) {
		notes.push(`流式检查失败：${describeError(error)}`);
		return { streaming: "unknown", thinking: "unknown", usage: "unknown" };
	}
	const { result } = observation;
	if (result.stopReason === "error") {
		notes.push(
			`流式检查失败：${result.errorMessage ?? result.finishReason ?? "未知错误"}`,
		);
		return { streaming: "unknown", thinking: "unknown", usage: "unknown" };
	}

	const firstTextMs =
		observation.firstTextAt === null
			? null
			: observation.firstTextAt - observation.startedAt;
	const totalMs = observation.finishedAt - observation.startedAt;
	notes.push(
		`正文增量 ${observation.textDeltas} 个，首个增量 ${
			firstTextMs === null ? "未到达" : `${firstTextMs} 毫秒`
		}，完成 ${totalMs} 毫秒`,
	);

	let streaming: LlmProbeStreaming;
	if (observation.textDeltas >= 2) {
		streaming = "streaming";
	} else if (result.text.length > 0) {
		streaming = "buffered";
		notes.push("正文只在结束时到达，按假流式处理");
	} else {
		streaming = "unknown";
	}

	const thinkingChars = Math.max(
		observation.reasoningChars,
		result.reasoning.length,
	);
	if (thinkingChars > 0) {
		notes.push(`思考内容 ${thinkingChars} 个字符`);
	}
	const thinking: LlmProbeSupport =
		thinkingChars > 0 ? "supported" : "unsupported";
	if (thinking === "unsupported") {
		notes.push("没有收到思考内容");
	}

	const usage: LlmProbeSupport =
		result.usage.promptTokens !== null && result.usage.completionTokens !== null
			? "supported"
			: "unsupported";
	if (usage === "unsupported") {
		notes.push("响应没有同时报告输入与输出 token");
	}

	return { streaming, thinking, usage };
}

async function probeFunctionCalling(
	options: ProbeChannelOptions,
	notes: string[],
): Promise<LlmProbeSupport> {
	let observation: CallObservation;
	try {
		observation = await runCall(
			options.channel,
			{
				model: options.model,
				messages: [{ role: "user", content: FUNCTION_PROMPT }],
				tools: [FUNCTION_TOOL],
				temperature: 0,
				maxTokens: 800,
				reasoning: "off",
				signal: options.signal,
			},
			options.now ?? Date.now,
		);
	} catch (error) {
		const message = describeError(error);
		notes.push(`函数调用检查失败：${message}`);
		return isToolRejection(message) ? "unsupported" : "unknown";
	}
	const { result } = observation;
	if (result.stopReason === "error") {
		const message = result.errorMessage ?? result.finishReason ?? "未知错误";
		notes.push(`函数调用检查失败：${message}`);
		return isToolRejection(message) ? "unsupported" : "unknown";
	}
	const called = result.toolCalls.some(
		(call) => call.name === FUNCTION_TOOL.name,
	);
	notes.push(
		called
			? `模型返回了 ${FUNCTION_TOOL.name} 工具调用`
			: "模型没有返回工具调用",
	);
	return called ? "supported" : "unsupported";
}

async function probePrefill(
	options: ProbeChannelOptions,
	notes: string[],
): Promise<LlmProbeSupport> {
	let observation: CallObservation;
	try {
		observation = await runCall(
			options.channel,
			{
				model: options.model,
				messages: [
					{ role: "user", content: PREFILL_PROMPT },
					{ role: "assistant", content: "{" },
				],
				temperature: 0,
				maxTokens: 400,
				reasoning: "off",
				signal: options.signal,
			},
			options.now ?? Date.now,
		);
	} catch (error) {
		const message = describeError(error);
		notes.push(`预填充检查失败：${message}`);
		return "unknown";
	}
	const { result } = observation;
	if (result.stopReason === "error") {
		const message = result.errorMessage ?? result.finishReason ?? "未知错误";
		notes.push(`预填充检查失败：${message}`);
		return "unknown";
	}
	const text = result.text.trim();
	if (text.length === 0) {
		notes.push("预填充后的续写为空");
		return "unknown";
	}
	if (text.startsWith("{")) {
		notes.push("预填充没有生效：模型重新输出了完整的 JSON 对象");
		return "unsupported";
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(`{${text}`);
	} catch {
		parsed = undefined;
	}
	if (isJsonObject(parsed) && parsed.probe === "prefill-ok") {
		notes.push("预填充生效：续写从助手消息的结尾开始");
		return "supported";
	}
	notes.push(`预填充结果无法判定：${truncate(text)}`);
	return "unknown";
}

async function probeCacheStats(
	options: ProbeChannelOptions,
	now: () => number,
	notes: string[],
): Promise<LlmProbeSupport> {
	const request: LlmProviderRequest = {
		model: options.model,
		messages: [
			{ role: "system", content: CACHE_FILLER },
			{ role: "user", content: "只回复 OK。" },
		],
		temperature: 0,
		maxTokens: 8,
		reasoning: "off",
		signal: options.signal,
	};
	let first: CallObservation;
	let second: CallObservation;
	try {
		first = await runCall(options.channel, request, now);
		second = await runCall(options.channel, request, now);
	} catch (error) {
		notes.push(`缓存统计检查失败：${describeError(error)}`);
		return "unknown";
	}
	if (
		first.result.stopReason === "error" ||
		second.result.stopReason === "error"
	) {
		notes.push("缓存统计检查失败：请求没有成功完成");
		return "unknown";
	}
	const cachedTokens = second.result.usage.cachedTokens;
	if (cachedTokens !== null && cachedTokens > 0) {
		notes.push(`第二次相同请求命中缓存 ${cachedTokens} 个 token`);
		return "supported";
	}
	notes.push("两次相同请求都没有报告缓存命中的 token");
	return "unsupported";
}

async function runCall(
	channel: LlmChannel,
	request: LlmProviderRequest,
	now: () => number,
): Promise<CallObservation> {
	const startedAt = now();
	let textDeltas = 0;
	let reasoningChars = 0;
	let firstTextAt: number | null = null;
	const stream = channel.stream(request);
	for await (const event of stream) {
		const at = now();
		if (event.type === "text_delta") {
			textDeltas += 1;
			firstTextAt ??= at;
		} else {
			reasoningChars += event.delta.length;
		}
	}
	const result = await stream.result();
	return {
		result,
		textDeltas,
		reasoningChars,
		firstTextAt,
		startedAt,
		finishedAt: now(),
	};
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isToolRejection(message: string): boolean {
	return (
		/tool|function/i.test(message) &&
		/support|allow|invalid|unknown/i.test(message)
	);
}

function truncate(text: string): string {
	return text.length <= 40 ? text : `${text.slice(0, 40)}…`;
}

import {
	createChannelProvider,
	loadChannel,
	textOf,
	thinkingOf,
} from "./channel.mjs";

const channel = loadChannel("MAIN");
const { models, model } = createChannelProvider(channel);

async function streamText() {
	const startedAt = performance.now();
	let firstEventAt = null;
	let firstThinkingDeltaAt = null;
	let firstDeltaAt = null;
	let textDeltas = 0;
	let thinkingDeltas = 0;
	const stream = models.streamSimple(
		model,
		{
			messages: [
				{
					role: "user",
					content: "用三句话讲一个关于灯塔的故事，直接开始正文。",
					timestamp: Date.now(),
				},
			],
		},
		{ reasoning: "low", maxTokens: 512 },
	);
	for await (const event of stream) {
		if (firstEventAt === null) firstEventAt = performance.now();
		if (event.type === "thinking_delta") {
			thinkingDeltas += 1;
			if (firstThinkingDeltaAt === null)
				firstThinkingDeltaAt = performance.now();
		}
		if (event.type === "text_delta") {
			textDeltas += 1;
			if (firstDeltaAt === null) firstDeltaAt = performance.now();
		}
	}
	const message = await stream.result();
	const finishedAt = performance.now();
	return {
		stopReason: message.stopReason,
		errorMessage: message.errorMessage ?? null,
		provider: message.provider,
		responseModel: message.responseModel ?? null,
		textChars: textOf(message).length,
		thinkingChars: thinkingOf(message).length,
		textDeltas,
		thinkingDeltas,
		firstEventMs:
			firstEventAt === null ? null : Math.round(firstEventAt - startedAt),
		firstThinkingDeltaMs:
			firstThinkingDeltaAt === null
				? null
				: Math.round(firstThinkingDeltaAt - startedAt),
		firstTextDeltaMs:
			firstDeltaAt === null ? null : Math.round(firstDeltaAt - startedAt),
		totalMs: Math.round(finishedAt - startedAt),
		usage: message.usage,
		preview: textOf(message).slice(0, 80),
	};
}

async function toolCall() {
	const stream = models.stream(
		model,
		{
			systemPrompt: "你是一个测试助手。必须使用提供的工具回答。",
			messages: [
				{
					role: "user",
					content:
						"查询 Asia/Shanghai 的当前时间。请调用 get_time 工具，不要直接回答。",
					timestamp: Date.now(),
				},
			],
			tools: [
				{
					name: "get_time",
					description: "查询指定时区的当前时间",
					parameters: {
						type: "object",
						properties: {
							timezone: { type: "string", description: "IANA 时区名" },
						},
						required: ["timezone"],
					},
				},
			],
		},
		{
			reasoningEffort: "low",
			maxTokens: 512,
			toolChoice: { type: "function", function: { name: "get_time" } },
		},
	);
	let toolCallEvent = null;
	for await (const event of stream) {
		if (event.type === "toolcall_end") toolCallEvent = event.toolCall;
	}
	const message = await stream.result();
	return {
		stopReason: message.stopReason,
		errorMessage: message.errorMessage ?? null,
		toolCall: toolCallEvent
			? { name: toolCallEvent.name, arguments: toolCallEvent.arguments }
			: null,
		contentTypes: message.content.map((block) => block.type),
	};
}

const text = await streamText();
console.log("stream:", JSON.stringify(text, null, 2));
const tool = await toolCall();
console.log("tool:", JSON.stringify(tool, null, 2));

const failures = [];
if (text.stopReason !== "stop")
	failures.push(`流式结束原因是 ${text.stopReason}`);
if (text.textDeltas < 2)
	failures.push(`流式只收到 ${text.textDeltas} 个 text_delta`);
if (text.textChars === 0) failures.push("流式没有正文");
if (tool.stopReason !== "toolUse")
	failures.push(`函数调用结束原因是 ${tool.stopReason}`);
if (!tool.toolCall) failures.push("没有收到工具调用");

if (failures.length > 0) {
	console.error("FAIL:", failures.join("；"));
	process.exitCode = 1;
} else {
	console.log("PASS: 流式、思考内容与函数调用全部可用");
}

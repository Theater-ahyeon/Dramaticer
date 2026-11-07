import {
	createChannelProvider,
	loadChannel,
	textOf,
	thinkingOf,
} from "./channel.mjs";

const channel = loadChannel("MAIN");
const { models, model } = createChannelProvider(channel);

const controller = new AbortController();
let textDeltas = 0;
const stream = models.streamSimple(
	model,
	{
		messages: [
			{
				role: "user",
				content: "写一个至少一千字的科幻短篇，直接开始正文。",
				timestamp: Date.now(),
			},
		],
	},
	{ reasoning: "off", maxTokens: 4096, signal: controller.signal },
);
for await (const event of stream) {
	if (event.type === "text_delta") {
		textDeltas += 1;
		if (textDeltas === 3) controller.abort();
	}
}
const partial = await stream.result();
const partialText = textOf(partial);

const context = {
	messages: [
		{
			role: "user",
			content: "写一个至少一千字的科幻短篇，直接开始正文。",
			timestamp: Date.now(),
		},
		partial,
		{
			role: "user",
			content: "从中断的地方接着写，不要重复已经写过的内容。",
			timestamp: Date.now(),
		},
	],
};
const continuation = await models.completeSimple(model, context, {
	reasoning: "off",
	maxTokens: 4096,
});
const continuationText = textOf(continuation);

console.log(
	"abort:",
	JSON.stringify(
		{
			stopReason: partial.stopReason,
			errorMessage: partial.errorMessage ?? null,
			textChars: partialText.length,
			thinkingChars: thinkingOf(partial).length,
			textDeltasBeforeAbort: textDeltas,
			contentTypes: partial.content.map((block) => block.type),
			usage: {
				input: partial.usage.input,
				output: partial.usage.output,
				reasoning: partial.usage.reasoning ?? null,
			},
			preview: partialText.slice(0, 80),
		},
		null,
		2,
	),
);
console.log(
	"continue:",
	JSON.stringify(
		{
			stopReason: continuation.stopReason,
			errorMessage: continuation.errorMessage ?? null,
			textChars: continuationText.length,
			preview: continuationText.slice(0, 80),
		},
		null,
		2,
	),
);

const failures = [];
if (partial.stopReason !== "aborted")
	failures.push(`中止后的结束原因是 ${partial.stopReason}`);
if (partialText.length === 0) failures.push("中止后没有保留部分正文");
if (continuation.stopReason !== "stop")
	failures.push(`续写的结束原因是 ${continuation.stopReason}`);
if (continuationText.length === 0) failures.push("续写没有正文");

if (failures.length > 0) {
	console.error("FAIL:", failures.join("；"));
	process.exitCode = 1;
} else {
	console.log("PASS: 中止后保留部分正文，附带部分内容的上下文可以续写");
}

import { Agent } from "@earendil-works/pi-agent-core";
import { createChannelProvider, loadChannel, textOf } from "./channel.mjs";

const channel = loadChannel("MAIN");
const { models, model } = createChannelProvider(channel);

async function checkPrepareRequest() {
	const nonce = `HOOK-${Date.now()}`;
	let prepareCalls = 0;
	let assistantMessage = null;
	const agent = new Agent({
		initialState: {
			model,
			systemPrompt: "你是测试助手。",
			messages: [],
			thinkingLevel: "off",
		},
		streamFn: models.streamSimple.bind(models),
		identity: { attribution: null },
		prepareRequest: async ({ context }) => {
			prepareCalls += 1;
			return {
				context: {
					...context,
					messages: [
						{
							role: "user",
							content: `只回复这个字符串本身，不要标点或解释：${nonce}`,
							timestamp: Date.now(),
						},
					],
				},
			};
		},
	});
	agent.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			assistantMessage = event.message;
		}
	});
	await agent.prompt("这条 prompt 必须被 prepareRequest 替换掉。");
	const text = assistantMessage ? textOf(assistantMessage).trim() : "";
	return {
		prepareCalls,
		stopReason: assistantMessage?.stopReason ?? null,
		responseText: text,
		injectedNonce: nonce,
		noncePresent: text.includes(nonce),
	};
}

async function checkToolHooks() {
	const toolCalls = [];
	let payloadCount = 0;
	let prepareRequestCalls = 0;
	let finishTurnCalls = 0;
	let beforeToolCallCalls = 0;
	let finishTurnMessage = null;
	const eventTypes = [];
	const toolResultMessages = [];
	const agent = new Agent({
		initialState: {
			model,
			systemPrompt: "你是测试助手，必须使用提供的工具。",
			messages: [],
			thinkingLevel: "off",
			tools: [
				{
					name: "echo_note",
					label: "回显备注",
					description: "回显一段备注文本",
					parameters: {
						type: "object",
						properties: { text: { type: "string" } },
						required: ["text"],
					},
					execute: async () => {
						throw new Error("被阻止的工具不应该执行");
					},
				},
			],
		},
		// 强制函数调用，避免模型自由选择是否使用工具。
		streamFn: (requestModel, context, options) =>
			models.stream(requestModel, context, {
				...options,
				toolChoice: { type: "function", function: { name: "echo_note" } },
				maxTokens: 512,
			}),
		identity: { attribution: null },
		onPayload: () => {
			payloadCount += 1;
		},
		prepareRequest: async () => {
			prepareRequestCalls += 1;
		},
		beforeToolCall: async ({ toolCall, args }) => {
			beforeToolCallCalls += 1;
			toolCalls.push({ name: toolCall.name, args });
			return { block: true, reason: "spike 阻止了工具执行" };
		},
		finishTurn: async ({ message }) => {
			finishTurnCalls += 1;
			finishTurnMessage = message;
			return { action: "end" };
		},
	});
	agent.subscribe((event) => {
		eventTypes.push(event.type);
		if (event.type === "message_end" && event.message.role === "toolResult") {
			toolResultMessages.push(event.message);
		}
	});
	await agent.prompt("请调用 echo_note 工具，参数 text 为 hello。");
	return {
		payloadCount,
		prepareCalls: prepareRequestCalls,
		beforeToolCallCalls,
		finishTurnCalls,
		finishTurnStopReason: finishTurnMessage?.stopReason ?? null,
		toolCalls,
		eventTypes,
		toolResultCount: toolResultMessages.length,
		toolResultIsError: toolResultMessages[0]?.isError ?? null,
		transcriptRoles: agent.state.messages.map((message) => message.role),
		lastAssistantText: (() => {
			const messages = agent.state.messages.filter(
				(message) => message.role === "assistant",
			);
			return messages.length > 0
				? textOf(messages[messages.length - 1]).slice(0, 60)
				: null;
		})(),
	};
}

const prepare = await checkPrepareRequest();
console.log("prepareRequest:", JSON.stringify(prepare, null, 2));
const hooks = await checkToolHooks();
console.log("toolHooks:", JSON.stringify(hooks, null, 2));

const failures = [];
if (prepare.prepareCalls !== 1)
	failures.push(`prepareRequest 被调用 ${prepare.prepareCalls} 次`);
if (!prepare.noncePresent)
	failures.push("prepareRequest 注入的上下文没有进入请求");
if (hooks.payloadCount !== 1)
	failures.push(`工具被阻止并结束后仍发出 ${hooks.payloadCount} 次请求`);
if (hooks.prepareCalls !== 1)
	failures.push(`prepareRequest 被调用 ${hooks.prepareCalls} 次`);
if (hooks.beforeToolCallCalls !== 1)
	failures.push(`beforeToolCall 被调用 ${hooks.beforeToolCallCalls} 次`);
if (hooks.finishTurnCalls !== 1)
	failures.push(`finishTurn 被调用 ${hooks.finishTurnCalls} 次`);
if (hooks.toolCalls[0]?.args?.text !== "hello")
	failures.push("beforeToolCall 没有收到校验后的参数");
if (hooks.toolResultIsError !== true)
	failures.push("被阻止的工具没有产生错误结果");

if (failures.length > 0) {
	console.error("FAIL:", failures.join("；"));
	process.exitCode = 1;
} else {
	console.log(
		"PASS: prepareRequest、beforeToolCall、finishTurn 三个钩子按预期工作",
	);
}

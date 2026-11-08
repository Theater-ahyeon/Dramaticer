import { createServer } from "node:http";

const WRITER_PATH = "/writer/v1/chat/completions";
const BACKGROUND_PATH = "/background/v1/chat/completions";

function textOf(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			typeof part === "object" && part !== null && "text" in part
				? String(part.text)
				: "",
		)
		.join("");
}

function systemText(body) {
	return body.messages
		.filter(
			(message) => message.role === "system" || message.role === "developer",
		)
		.map((message) => textOf(message.content))
		.join("\n");
}

function lastUserText(body) {
	const message = [...body.messages]
		.reverse()
		.find((item) => item.role === "user");
	return message === undefined ? "" : textOf(message.content);
}

function hasToolResult(body) {
	return body.messages.some((message) => message.role === "tool");
}

function sseChunk(payload) {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

function baseChunk(id) {
	return {
		id,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: "fake-model",
	};
}

function streamText(res, chunks) {
	res.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const id = `chatcmpl-${Date.now()}`;
	res.write(
		sseChunk({
			...baseChunk(id),
			choices: [
				{ index: 0, delta: { role: "assistant" }, finish_reason: null },
			],
		}),
	);
	for (const delta of chunks) {
		res.write(
			sseChunk({
				...baseChunk(id),
				choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
			}),
		);
	}
	res.write(
		sseChunk({
			...baseChunk(id),
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		}),
	);
	res.write(
		sseChunk({
			...baseChunk(id),
			choices: [],
			usage: {
				prompt_tokens: 120,
				completion_tokens: 40,
				total_tokens: 160,
				completion_tokens_details: { reasoning_tokens: 8 },
			},
		}),
	);
	res.write("data: [DONE]\n\n");
	res.end();
}

function splitForStream(text) {
	const chunks = [];
	const size = Math.max(1, Math.ceil(text.length / 4));
	for (let index = 0; index < text.length; index += size) {
		chunks.push(text.slice(index, index + size));
	}
	return chunks.length === 0 ? [""] : chunks;
}

const writerAttempts = new Map();

function writerText(userText) {
	const attempt = (writerAttempts.get(userText) ?? 0) + 1;
	writerAttempts.set(userText, attempt);
	return [
		`${userText}——第${attempt}次回应。`,
		"",
		"<thinking>门后的脚步停顿了一下。</thinking>",
		"",
		"风从门缝里灌进来，灯影摇了一下。",
		"",
		"<选项>推门进去",
		"原地等待</选项>",
		"<状态栏>体力：100",
		"地点：门厅</状态栏>",
		'<state_update>{"path":["character","林雪","status"],"op":"set","value":"警觉","reason":"听到门后的脚步"}</state_update>',
		'<state_update>{"path":["clue","门后的脚步","status"],"op":"set","value":"open"}</state_update>',
		'<state_update>{"path":["clue","门后的脚步","text"],"op":"set","value":"门后的脚步是谁"}</state_update>',
		'<plot_note>{"text":"门后的脚步是谁"}</plot_note>',
	].join("\n");
}

function candidateActions(attempt) {
	return JSON.stringify({
		actions: [
			`候选行动一（${attempt}）`,
			"候选行动二",
			"候选行动三",
			"候选行动四",
		],
		sceneChange: "场景变化：天色转暗",
	});
}

const openingBatches = new Map();

function openingCandidates(storyKey) {
	const batch = (openingBatches.get(storyKey) ?? 0) + 1;
	openingBatches.set(storyKey, batch);
	return JSON.stringify({
		candidates: [
			`第${batch}批候选：门厅里的灯灭了。`,
			`第${batch}批候选：雨声盖住了脚步。`,
			`第${batch}批候选：有人在门外叫你的名字。`,
		],
	});
}

function openingPack() {
	return JSON.stringify({
		place: "旧宅门厅",
		time: "雨夜",
		participants: [{ name: "林雪", wants: "确认门外是谁" }],
		conflict: "门后的脚步越来越近",
		directions: ["推门", "退到楼梯", "熄灯等待"],
	});
}

function directorPlan() {
	return JSON.stringify({
		arcs: [
			{
				id: "e2e-arc",
				title: "旧宅之夜",
				throughLine: "林雪必须在旧宅里找出脚步声的来源",
				difficulty: 0.5,
				redLines: [],
				sequences: [
					{
						id: "e2e-sequence",
						title: "门厅",
						beats: [
							{
								id: "e2e-beat",
								goal: "让林雪确认门外的人",
								entrySigns: ["脚步声停下"],
								fitPoints: ["门后的脚步", "熄灭的灯"],
							},
						],
					},
				],
			},
		],
	});
}

function eventBatch(userContent) {
	const ids = [
		...userContent.matchAll(/<楼层 id="([^"]+)" role="assistant">/g),
	].map((match) => match[1]);
	return JSON.stringify(
		ids.map((nodeId, index) => ({
			nodeId,
			events: [
				{
					text: `门被推开（${index + 1}）`,
					participants: ["林雪"],
					knowers: ["*"],
					importance: 0.6,
					storyTime: "雨夜",
					location: "门厅",
				},
			],
		})),
	);
}

function backgroundResponse(body) {
	const system = systemText(body);
	if (system.includes("你是故事台账的结算器")) return "[]";
	if (system.includes("你是故事记忆抽取器")) {
		return eventBatch(
			body.messages
				.filter((message) => message.role === "user")
				.map((message) => textOf(message.content))
				.join("\n"),
		);
	}
	if (system.includes("你是故事摘要器")) {
		return "章节摘要：林雪在门厅听见门后的脚步。";
	}
	if (system.includes("你是 NPC 议程推进器")) return "[]";
	if (system.includes("你是故事的现场分析师")) {
		return "现场：林雪站在门边，警惕门后的脚步声。";
	}
	if (system.includes("你是故事的用户意志记录员")) return "[]";
	if (system.includes("你是故事台账的修订记录员")) return "[]";
	if (system.includes("你是故事的导演规划器")) return directorPlan();
	if (system.includes("正在为玩家的下一次输入准备选项")) {
		return candidateActions(Date.now());
	}
	if (system.includes("你是故事的开场作者")) {
		return openingCandidates(lastUserText(body));
	}
	if (system.includes("你是故事的开局导演")) return openingPack();
	return "[]";
}

export async function startFakeChannel(options = {}) {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;
	const server = createServer((req, res) => {
		if (req.method !== "POST") {
			res.writeHead(404);
			res.end();
			return;
		}
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			if (req.url === WRITER_PATH) {
				const userText = lastUserText(body);
				if (userText.includes("读取状态") && !hasToolResult(body)) {
					streamText(res, splitForStream('<tool name="state_get">{}</tool>'));
					return;
				}
				streamText(res, splitForStream(writerText(userText)));
				return;
			}
			if (req.url === BACKGROUND_PATH) {
				streamText(res, splitForStream(backgroundResponse(body)));
				return;
			}
			res.writeHead(404);
			res.end();
		});
	});
	await new Promise((resolve) => server.listen(port, host, resolve));
	const address = server.address();
	const actualPort =
		typeof address === "object" && address ? address.port : port;
	return {
		port: actualPort,
		baseUrl: `http://${host}:${actualPort}`,
		close: () =>
			new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

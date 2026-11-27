import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const WRITER_PATH = "/writer/v1/chat/completions";
const BACKGROUND_PATH = "/background/v1/chat/completions";
const COMFY_PREFIX = "/comfy";
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value;
	}
	return table;
})();

function crc32(bytes) {
	let value = -1;
	for (const byte of bytes)
		value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
	return (value ^ -1) >>> 0;
}

function pngChunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const payload = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(payload));
	return Buffer.concat([length, payload, crc]);
}

/** 每次生成把正向提示词编进宽度，测试能确认后端收到的就是玩家改过的文本。 */
function promptWidth(prompt) {
	let hash = 2166136261;
	for (let index = 0; index < prompt.length; index += 1) {
		hash = Math.imul(hash ^ prompt.charCodeAt(index), 16777619);
	}
	return 40 + ((hash >>> 0) % 400);
}

function generatedPng(generation, prompt) {
	const width = promptWidth(prompt);
	const height = 60 + (generation % 400);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 0;
	const raw = Buffer.alloc((width + 1) * height);
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

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

function streamText(res, chunks, delayMs = 0) {
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
	const finish = () => {
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
	};
	let index = 0;
	const writeNext = () => {
		if (index >= chunks.length) {
			finish();
			return;
		}
		const delta = chunks[index];
		index += 1;
		res.write(
			sseChunk({
				...baseChunk(id),
				choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
			}),
		);
		if (delayMs > 0) {
			setTimeout(writeNext, delayMs);
			return;
		}
		writeNext();
	};
	writeNext();
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

const SIMULATED_USER_MESSAGES = [
	"我沿着走廊慢慢往前走，在第二扇门前停下。",
	"我问他：你在这栋房子里住了多久？",
	"我不太相信他的话，盯着他的眼睛看。",
	"我转身回到门厅，把灯芯拨亮一些。",
	"我提起昨晚的雨声，问他有没有听见。",
	"我把手按在门把上，决定先不开门。",
];

let simulatedUserTurns = 0;

function simulatedUserReply() {
	simulatedUserTurns += 1;
	return JSON.stringify({
		message:
			SIMULATED_USER_MESSAGES[
				(simulatedUserTurns - 1) % SIMULATED_USER_MESSAGES.length
			],
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

/** 每楼的局面更新（场记）：按提示词里要的部分作答。 */
function sceneLog(system) {
	return JSON.stringify({
		beat: "试探",
		states: [],
		present: ["林雪"],
		sceneEnds: false,
		...(system.includes("- sceneCard：")
			? {
					sceneCard: {
						present: [{ who: "林雪", want: "确认门外是谁" }],
						change: "门外的人现身",
					},
				}
			: {}),
		...(system.includes("- options：")
			? {
					options: [`候选行动一（${Date.now()}）`, "候选行动二", "候选行动三"],
				}
			: {}),
		...(system.includes("- events：")
			? {
					events: [
						{
							text: "门被推开",
							participants: ["林雪"],
							knowers: ["*"],
							importance: 0.6,
							storyTime: "雨夜",
							location: "门厅",
						},
					],
				}
			: {}),
		...(system.includes("- will：") ? { will: [] } : {}),
	});
}

const canonAttempts = new Map();

/** 原著逐章抽取：按提示词里的块返回事件、话术与实体增量。 */
function canonExtraction(body) {
	const user = lastUserText(body);
	const book = /<原著>([\s\S]*?)<\/原著>/.exec(user)?.[1] ?? "";
	const chapter = /<本章 序号="(\d+)" 标题="([^"]*)">/.exec(user);
	const block = /<块 段落="(\d+)-(\d+)">\n([\s\S]*?)\n<\/块>/.exec(user);
	const start = Number(block?.[1] ?? "1");
	const end = Number(block?.[2] ?? "1");
	const text = block?.[3] ?? "";
	const key = `${book}:${chapter?.[1] ?? "0"}:${start}-${end}`;
	const attempt = (canonAttempts.get(key) ?? 0) + 1;
	canonAttempts.set(key, attempt);
	// 旧信这一章第一次故意给出不在原文里的人，用来验证失败块单独重跑。
	if (attempt === 1 && text.includes("山门勿归")) {
		return JSON.stringify({
			events: [
				{
					title: "不合格的事件",
					summary: "参与人物不在本块原文。",
					digest: "第一句。第二句。第三句。",
					participants: ["不存在的人"],
					location: null,
					time: null,
					paragraphStart: start,
					paragraphEnd: end,
					isInterlude: false,
				},
			],
			voices: [],
			facts: [],
		});
	}
	const name = ["少年", "守门人", "师父", "林言"].find((item) =>
		text.includes(item),
	);
	const isInterlude = (chapter?.[2] ?? "").includes("番外");
	return JSON.stringify({
		events: [
			{
				title: `原著事件 ${start}`,
				summary: `第 ${start} 段的事件。`,
				digest: "第一句。第二句。第三句。",
				participants: name === undefined ? [] : [name],
				location: "山门",
				time: "清晨",
				paragraphStart: start,
				paragraphEnd: end,
				isInterlude,
			},
		],
		voices:
			name === undefined
				? []
				: [{ character: name, kind: "thought", text: "这是合成的心声。" }],
		facts:
			name === undefined
				? []
				: [{ name, aliases: [], kind: "人物", fact: "合成的人物事实。" }],
	});
}

/** 全书汇编：别名合并、关键转折与实体页。 */
function canonCompile(body) {
	const system = systemText(body);
	const user = lastUserText(body);
	if (system.includes("人物与别名合并器")) {
		return JSON.stringify({ merges: [] });
	}
	if (system.includes("时间线编者")) {
		const ids = [...user.matchAll(/- \[(\d+)\] /g)].map((match) =>
			Number(match[1]),
		);
		const last = ids.at(-1);
		return JSON.stringify({
			turningPoints: last === undefined ? [] : [last],
		});
	}
	const blocks = [
		...user.matchAll(
			/<实体 名="([^"]+)" 类别="[^"]*" 首章="(\d+)" 末章="(\d+)">([\s\S]*?)<\/实体>/g,
		),
	];
	return JSON.stringify({
		entities: blocks.map((block) => {
			const name = block[1] ?? "";
			const chapters = new Set();
			for (const entry of (block[4] ?? "").matchAll(/\[第 (\d+) 章\]/g)) {
				chapters.add(Number(entry[1]));
			}
			return {
				name,
				lead: `${name}的合成简介，山门故事里的一个人。`,
				entries: [...chapters]
					.sort((left, right) => left - right)
					.map((chapter) => ({
						chapter,
						text: `到第 ${chapter} 章时关于${name}的合成底色。`,
					})),
			};
		}),
	});
}

function imageOrganizer(body) {
	const user = lastUserText(body);
	if (user.includes("整理失败")) return "not json";
	return JSON.stringify({
		images: [
			{
				insertAfterParagraph: 1,
				title: "门厅的灯",
				scene: "林雪站在门厅，手提一盏灯，雨声贴着窗。",
				composition: "wide shot；cinematic lighting",
				characters: [
					{
						name: "林雪",
						angle: "front",
						body: "upper",
						exposure: "clothed",
						outfitName: "深蓝校服",
						action: "holding a lantern；warm light",
						negative: "bad hands",
						center: { x: 0.5, y: 0.5 },
					},
				],
				negativePrompt: "blurry",
			},
		],
	});
}

function backgroundResponse(body) {
	const system = systemText(body);
	if (system.includes("你是画面整理师")) return imageOrganizer(body);
	if (system.includes("你是原著的事件抽取器")) return canonExtraction(body);
	if (system.includes("你是原著的人物与别名合并器")) return canonCompile(body);
	if (system.includes("你是原著的时间线编者")) return canonCompile(body);
	if (system.includes("你是原著的人物页编者")) return canonCompile(body);
	if (system.includes("你是故事的场记")) return sceneLog(system);
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
	if (system.includes("你在模拟一位玩文字角色扮演游戏的玩家")) {
		return simulatedUserReply();
	}
	return "[]";
}

export async function startFakeChannel(options = {}) {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;
	// 流式响应的间隔让界面有机会把中间状态画出来；0 表示尽快发完。
	const streamDelayMs = options.streamDelayMs ?? 0;
	let comfyGeneration = 0;
	const comfyJobs = new Map();
	const server = createServer((req, res) => {
		// 设置页向导获取模型列表时请求 `/models`。
		if (req.method === "GET" && req.url?.endsWith("/v1/models")) {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({ data: [{ id: "fake-writer" }, { id: "fake-alt" }] }),
			);
			return;
		}
		// 出图用的小型 ComfyUI：提交即完成，按生成序号返回不同尺寸的 PNG。
		if (req.url === `${COMFY_PREFIX}/prompt` && req.method === "POST") {
			const chunks = [];
			req.on("data", (chunk) => chunks.push(chunk));
			req.on("end", () => {
				comfyGeneration += 1;
				let positive = "";
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					positive = body.prompt?.["6"]?.inputs?.text ?? "";
				} catch {
					positive = "";
				}
				comfyJobs.set(comfyGeneration, { positive });
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({ prompt_id: `fake-prompt-${comfyGeneration}` }),
				);
			});
			return;
		}
		if (
			req.method === "GET" &&
			req.url?.startsWith(`${COMFY_PREFIX}/history/`)
		) {
			const promptId = req.url.slice(`${COMFY_PREFIX}/history/`.length);
			const generation = Number(promptId.replace("fake-prompt-", "")) || 1;
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					[promptId]: {
						outputs: {
							9: {
								images: [
									{
										filename: `fake-${generation}.png`,
										subfolder: "",
										type: "output",
									},
								],
							},
						},
					},
				}),
			);
			return;
		}
		if (req.method === "GET" && req.url?.startsWith(`${COMFY_PREFIX}/view?`)) {
			const query = new URL(req.url, "http://127.0.0.1");
			const match = /fake-(\d+)\.png/.exec(
				query.searchParams.get("filename") ?? "",
			);
			const generation = match === null ? 1 : Number(match[1]);
			const job = comfyJobs.get(generation);
			const bytes = generatedPng(generation, job?.positive ?? "");
			res.writeHead(200, {
				"Content-Type": "image/png",
				"Content-Length": bytes.length,
			});
			res.end(bytes);
			return;
		}
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
				if (systemText(body).includes("上下文压缩器")) {
					streamText(
						res,
						splitForStream("上下文摘要：较早的排障结论与台账路径。"),
					);
					return;
				}
				if (systemText(body).includes("你是 Dramaticer 的应用内助手")) {
					const slow = userText.includes("慢速");
					const reply = slow
						? "慢速助手的完整回答：抽屉关闭后运行仍然继续。"
						: `助手回答：${userText}`;
					streamText(res, splitForStream(reply), slow ? 500 : 0);
					return;
				}
				if (
					body.messages.some((message) =>
						textOf(message.content).includes("深回合草稿"),
					)
				) {
					const reply = hasToolResult(body)
						? '<tool name="commit_draft">{}</tool>'
						: '<tool name="draft_write">{"text":"草稿：门在风里响了一声。"}</tool>';
					setTimeout(() => streamText(res, splitForStream(reply)), 1_200);
					return;
				}
				if (systemText(body).includes("你在修订一段已经写好的剧情正文")) {
					streamText(res, splitForStream("改过的这一段。"));
					return;
				}
				if (userText.includes("读取状态") && !hasToolResult(body)) {
					streamText(res, splitForStream('<tool name="state_get">{}</tool>'));
					return;
				}
				streamText(res, splitForStream(writerText(userText)), streamDelayMs);
				return;
			}
			if (req.url === BACKGROUND_PATH) {
				streamText(
					res,
					splitForStream(backgroundResponse(body)),
					streamDelayMs,
				);
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

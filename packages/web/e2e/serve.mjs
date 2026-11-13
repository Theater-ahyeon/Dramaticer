import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startFakeChannel } from "./fake-channel.mjs";

const root = join(import.meta.dirname, "..", "..", "..");
const workDir = join(root, ".devloop", "scratch", "e2e", "work");
const dbPath = join(workDir, "e2e.db");
const appPort = Number(process.env.E2E_APP_PORT ?? 4517);

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const fake = await startFakeChannel();
const channelsPath = join(workDir, "channels.yaml");
writeFileSync(
	channelsPath,
	`channels:
  writer:
    baseUrl: ${fake.baseUrl}/writer/v1
    apiKey: \${E2E_FAKE_KEY}
    requestsPerMinute: 0
    maxRetries: 0
  background:
    baseUrl: ${fake.baseUrl}/background/v1
    apiKey: \${E2E_FAKE_KEY}
    requestsPerMinute: 0
    maxRetries: 0
models:
  writer-model:
    id: fake-writer
    channels: [writer]
    maxTokens: 4096
    tools:
      transport: text
  background-model:
    id: fake-background
    channels: [background]
    maxTokens: 32768
roles:
  writer: writer-model
  settler: background-model
  planner: background-model
  judge: background-model
`,
	"utf8",
);

const core = await import(
	pathToFileURL(join(root, "packages", "core", "dist", "index.js")).href
);
const store = core.StoryStore.open(dbPath);
store.createStory({ id: "e2e-pagination", title: "路径分页" });
let parentId = null;
for (let index = 1; index <= 130; index += 1) {
	const role = index % 2 === 1 ? "user" : "assistant";
	const node = store.appendNode({
		storyId: "e2e-pagination",
		parentId,
		role,
		raw: `楼层-${index}-${role}`,
	});
	parentId = node.id;
}
store.close();

const seedStore = core.StoryStore.open(dbPath);
seedStore.createStory({ id: "e2e-assistant-context", title: "助手上下文" });
const seedRoot = seedStore.appendNode({
	storyId: "e2e-assistant-context",
	parentId: null,
	role: "system",
	raw: "你是故事引擎。",
});
seedStore.appendNode({
	storyId: "e2e-assistant-context",
	parentId: seedRoot.id,
	role: "user",
	raw: "我推开古老的山门。",
});
const seedConversation = seedStore.createAssistantConversation({
	id: "e2e-assistant-context-conversation",
	storyId: "e2e-assistant-context",
	skill: "troubleshoot",
	title: "上下文压缩测试",
	contextBudget: 2_000,
	compactionThreshold: 0.8,
});
for (let index = 1; index <= 12; index += 1) {
	seedStore.appendAssistantMessage({
		conversationId: seedConversation.id,
		role: index % 2 === 1 ? "user" : "assistant",
		text: `第 ${index} 条消息：门厅里的脚步声与台账路径的排障记录。`,
	});
}
for (const project of ["mobile", "desktop"]) {
	const storyId = `e2e-assistant-review-${project}`;
	const conversationId = `${storyId}-conversation`;
	seedStore.createStory({ id: storyId, title: `助手审阅 ${project}` });
	const root = seedStore.appendNode({
		storyId,
		parentId: null,
		role: "user",
		raw: "我推开古老的山门。",
	});
	const head = seedStore.appendNode({
		storyId,
		parentId: root.id,
		role: "assistant",
		raw: "门后是一条向下的石阶。",
	});
	const conversation = seedStore.createAssistantConversation({
		id: conversationId,
		storyId,
		skill: "setup_wizard",
		title: "审阅会话",
		permission: "confirm",
	});
	seedStore.createAssistantAction({
		conversationId: conversation.id,
		kind: "settings",
		summary: "把输出预算改成 1024",
		payload: { maxTokens: 1024 },
	});
	seedStore.createAssistantAction({
		conversationId: conversation.id,
		kind: "settings",
		summary: "模板还没准备好的修改",
		payload: { templateId: "missing-template" },
	});
	seedStore.createAssistantAction({
		conversationId: conversation.id,
		kind: "channels",
		summary: "换渠道模型",
		payload: {
			channels: {
				main: {
					api: "openai-completions",
					baseUrl: "http://127.0.0.1:9/v1",
					apiKeyEnv: "E2E_SECRET_ENV",
					requestsPerMinute: 10,
					maxRetries: 1,
					retryBaseDelayMs: 100,
					timeoutMs: 1_000,
				},
			},
			models: {
				writer: {
					id: "review-model",
					channels: ["main"],
					contextWindow: 8_000,
					maxTokens: 1_000,
					reasoning: false,
				},
			},
			embeddings: {},
			roles: { writer: "writer" },
		},
	});
	seedStore.createAssistantAction({
		conversationId: conversation.id,
		kind: "lore",
		summary: "加一条世界书",
		payload: { entries: [{ name: "山门", content: "山门常年关闭。" }] },
	});
	seedStore.createAssistantAction({
		conversationId: conversation.id,
		kind: "director_plan",
		summary: "换一条弧线",
		payload: {
			plan: {
				arcs: [
					{
						id: "arc-1",
						title: "入山",
						throughLine: "她必须在山门与旧友之间做决定。",
						difficulty: 0.4,
						redLines: ["不让角色凭空白给"],
						sequences: [
							{
								id: "seq-1",
								title: "第一夜",
								beats: [
									{
										id: "beat-1",
										goal: "让玩家看到山门在夜里换了一副面孔。",
										entrySigns: ["石阶起雾"],
										fitPoints: ["她熟悉山路"],
									},
								],
							},
						],
					},
				],
			},
		},
	});
	seedStore.createAssistantAction({
		conversationId: conversation.id,
		kind: "card",
		summary: "改人物提示",
		payload: { characterPrompt: "新的提示" },
	});
	seedStore.createAssistantAction({
		conversationId: conversation.id,
		kind: "image_config",
		summary: "打开自动出图",
		payload: {
			imageConfig: {
				mode: "auto",
				workflowId: "wf-1",
				maxPerFloor: 1,
				minFloorsBetween: 3,
			},
		},
	});
	seedStore.insertLedgerChangeCard({
		id: `${storyId}-card`,
		storyId,
		source: "assistant",
		assistantConversationId: conversation.id,
		sourceNodeId: head.id,
		text: "把凛的所在地改成屋顶",
		diffs: [
			{ path: ["character", "凛", "location"], op: "set", value: "屋顶" },
		],
		before: [
			{
				path: ["character", "凛", "location"],
				existed: true,
				value: "走廊",
			},
		],
		status: "pending",
	});
}
seedStore.close();

const serverModule = await import(
	pathToFileURL(join(root, "packages", "server", "dist", "index.js")).href
);
const running = await serverModule.startServer({
	dbPath,
	webRoot: join(root, "packages", "web", "dist"),
	host: "127.0.0.1",
	port: appPort,
	password: "e2e-password",
	channels: {
		path: channelsPath,
		env: { E2E_FAKE_KEY: "e2e-key" },
	},
	log: (line) => console.log(`[e2e] ${line}`),
});

console.log(`[e2e] ready at ${running.origin} (fake ${fake.baseUrl})`);

let closing = false;
async function shutdown() {
	if (closing) return;
	closing = true;
	await running.close();
	await fake.close();
	process.exit(0);
}

process.on("SIGTERM", () => {
	void shutdown();
});
process.on("SIGINT", () => {
	void shutdown();
});

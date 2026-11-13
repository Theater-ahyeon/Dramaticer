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

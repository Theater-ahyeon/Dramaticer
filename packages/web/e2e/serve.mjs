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

const fake = await startFakeChannel({
	streamDelayMs: Number(process.env.E2E_FAKE_STREAM_DELAY_MS ?? "0"),
});
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
// 连载页的固定样本：两场已归档、一次玩家跳时间、一场还在进行，
// 章末清点落在 serial-a4；楼层时间远在过去，前情提要默认展开。
const serialStoryId = "e2e-serial";
seedStore.createStory({ id: serialStoryId, title: "连载视图" });
const serialFloor = (id, parentId, role, raw) => {
	seedStore.appendNode({
		id,
		storyId: serialStoryId,
		parentId,
		role,
		raw,
		createdAt: "2020-01-01T00:00:00.000Z",
	});
	return id;
};
serialFloor("serial-a1", null, "assistant", "门厅里只剩一盏灯。");
serialFloor("serial-u1", "serial-a1", "user", "我走进门厅。");
serialFloor("serial-a2", "serial-u1", "assistant", "林雪抬头看你。");
serialFloor("serial-u2", "serial-a2", "user", "我问她那封信。");
serialFloor("serial-a3", "serial-u2", "assistant", "她把信推回桌面。");
serialFloor("serial-u3", "serial-a3", "user", "我收下信。");
serialFloor("serial-a4", "serial-u3", "assistant", "灯忽然灭了。");
serialFloor("serial-u4", "serial-a4", "user", "我摸黑往前走。");
serialFloor("serial-a5", "serial-u4", "assistant", "楼梯上传来脚步声。");
const saveSerialLog = (nodeId, present, sceneEnds) => {
	seedStore.saveSceneLog({
		nodeId,
		storyId: serialStoryId,
		beat: "试探",
		present,
		sceneEnds,
		sceneCard: null,
		bits: [],
		conditions: [],
		states: [],
		quotes: { submitted: 0, verified: 0 },
		repairs: [],
	});
};
saveSerialLog("serial-a2", ["林雪", "阿宁", "你"], true);
saveSerialLog("serial-a4", ["林雪"], true);
saveSerialLog("serial-a5", ["林雪", "你"], false);
seedStore.saveSceneArchive({
	endNodeId: "serial-a2",
	storyId: serialStoryId,
	startNodeId: "serial-a1",
	floorCount: 2,
	boundary: "scene-ends",
	summary: "林雪在门厅试探你，阿宁在旁边翻信。",
	present: ["林雪", "阿宁", "你"],
	profiles: [
		{
			who: "林雪",
			want: "看清你的来意",
			hide: "她也怕那封信",
			speech: "别装了。",
			unresolved: "那封信还没有交出去",
		},
		{
			who: "阿宁",
			want: "把信读完了再走",
			hide: null,
			speech: null,
			unresolved: null,
		},
	],
	informed: [],
	stateChanges: [{ path: ["scene", "current", "place"], change: "留在门厅" }],
	cluesOpened: [],
	cluesClosed: [],
});
seedStore.saveSceneArchive({
	endNodeId: "serial-a4",
	storyId: serialStoryId,
	startNodeId: "serial-a3",
	floorCount: 2,
	boundary: "scene-ends",
	summary: "林雪把信推回桌面，灯忽然灭了。",
	present: ["林雪"],
	profiles: [
		{
			who: "林雪",
			want: "让你自己决定要不要收下信",
			hide: null,
			speech: null,
			unresolved: "信在她手上还是在你手上",
		},
	],
	informed: [],
	stateChanges: [
		{ path: ["scene", "current", "place"], change: "从天台看着你" },
	],
	cluesOpened: [],
	cluesClosed: [],
});
seedStore.appendStateDiffs([
	{
		storyId: serialStoryId,
		nodeId: "serial-a2",
		path: ["scene", "current", "place"],
		op: "set",
		value: "门厅",
		source: "settler",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a2",
		path: ["time", "current"],
		op: "set",
		value: "第一天夜里",
		source: "settler",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a3",
		path: ["time", "current"],
		op: "set",
		value: "第二天清晨",
		source: "player",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a4",
		path: ["scene", "current", "place"],
		op: "set",
		value: "天台",
		source: "settler",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a2",
		path: ["character", "林雪", "tier"],
		op: "set",
		value: "lead",
		source: "settler",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a2",
		path: ["character", "林雪", "status"],
		op: "set",
		value: "平静",
		source: "settler",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a2",
		path: ["character", "林雪", "location"],
		op: "set",
		value: "门厅",
		source: "settler",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a2",
		path: ["character", "阿宁", "tier"],
		op: "set",
		value: "minor",
		source: "settler",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a2",
		path: ["relation", "林雪", "你", "type"],
		op: "set",
		value: "旧识",
		source: "settler",
	},
	{
		storyId: serialStoryId,
		nodeId: "serial-a2",
		path: ["relation", "林雪", "你", "stage"],
		op: "set",
		value: "试探",
		source: "settler",
	},
]);
seedStore.saveDirectorLines({
	nodeId: "serial-a3",
	storyId: serialStoryId,
	diffs: [
		{
			action: "set",
			line: {
				id: "serial-l1",
				kind: "main",
				who: "林雪",
				want: "让玩家说出信从哪里来",
				obstacle: "玩家还在躲",
				countdown: null,
				preparations: [],
			},
		},
		{
			action: "set",
			line: {
				id: "serial-l2",
				kind: "promise",
				who: "阿宁",
				want: "读完那封信",
				obstacle: "信被收走了",
				countdown: null,
				preparations: [],
			},
		},
	],
});
seedStore.saveDirectorChapterReview({
	nodeId: "serial-a4",
	storyId: serialStoryId,
	payload: {
		promises: [{ lineId: "serial-l2", disposition: "carry" }],
		focus: ["serial-l1", "serial-l2"],
	},
});

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

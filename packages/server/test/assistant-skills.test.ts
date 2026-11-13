import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	LlmCallOptions,
	LlmChannelsConfig,
	LlmRequest,
	LlmResult,
	LlmStream,
	LlmStreamEvent,
	LlmStreamingClient,
	LlmToolCall,
} from "@dramaticer/core";
import type {
	ApiErrorResponse,
	AssistantConversationView,
	AssistantSkillListView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

const TROUBLESHOOT_TOOLS = [
	"explain_node",
	"run_log_read",
	"ledger_read",
	"director_read",
	"memory_search",
	"state_get",
].sort();

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-assistant-skills-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

function writeWebRoot(dir: string): string {
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	return webRoot;
}

function writeDocs(root: string): void {
	mkdirSync(join(root, "dev", "reports"), { recursive: true });
	writeFileSync(
		join(root, "DESIGN.md"),
		"# 设计\n\n## 记忆\n\n门禁会在每次提交前运行。\n",
	);
	writeFileSync(
		join(root, "dev", "TASKS.md"),
		"# 任务清单\n\n## H-T04 排障与使用指南技能\n\ndocs_search 返回路径、标题与片段。\n",
	);
	writeFileSync(join(root, "dev", "HUMAN.md"), "# 人类事项\n\n没有记录。\n");
	writeFileSync(
		join(root, "dev", "reports", "R3.md"),
		"# R3 报告\n\n快回合延迟。\n",
	);
}

function fakeConfig(): LlmChannelsConfig {
	return {
		channels: new Map([
			[
				"fake",
				{
					id: "fake",
					api: "openai-completions",
					baseUrl: "http://127.0.0.1:9",
					apiKey: "",
					requestsPerMinute: 0,
					maxRetries: 0,
					retryBaseDelayMs: 0,
					timeoutMs: 1_000,
				},
			],
		]),
		models: new Map([
			[
				"main",
				{
					alias: "main",
					id: "fake-model",
					contextWindow: 8_192,
					maxTokens: 1_024,
					reasoning: false,
					enabled: true,
					channels: ["fake"],
					tools: null,
					probe: null,
				},
			],
		]),
		roles: new Map(),
		embeddings: new Map(),
	};
}

interface FakeReply {
	readonly text: string;
	readonly toolCalls?: readonly LlmToolCall[];
}

class ScriptedClient implements LlmStreamingClient {
	readonly requests: LlmRequest[] = [];
	readonly #replies: FakeReply[];

	constructor(replies: readonly FakeReply[]) {
		this.#replies = [...replies];
	}

	async complete(): Promise<LlmResult> {
		throw new Error("助手运行不应该调用 complete");
	}

	stream(request: LlmRequest, _options?: LlmCallOptions): LlmStream {
		this.requests.push(request);
		const reply = this.#replies.shift();
		if (reply === undefined) {
			throw new Error("测试没有准备这一轮回复");
		}
		const events: LlmStreamEvent[] = [];
		for (const char of reply.text) {
			events.push({ type: "text_delta", delta: char });
		}
		const result: LlmResult = {
			text: reply.text,
			reasoning: "",
			toolCalls: reply.toolCalls ?? [],
			finishReason: (reply.toolCalls ?? []).length > 0 ? "tool_calls" : "stop",
			stopReason: (reply.toolCalls ?? []).length > 0 ? "toolUse" : "stop",
			model: "fake-model",
			channel: "fake",
			usage: {
				promptTokens: 10,
				completionTokens: 5,
				totalTokens: 15,
				reasoningTokens: 0,
				cachedTokens: 0,
			},
			raw: null,
			cached: false,
			attempts: 1,
			rounds: 1,
			truncation: null,
			continuation: null,
		};
		let index = 0;
		return {
			[Symbol.asyncIterator]() {
				return this;
			},
			async next(): Promise<IteratorResult<LlmStreamEvent>> {
				const signal = request.signal;
				if (signal?.aborted) throw signal.reason;
				if (index < events.length) {
					const event = events[index] as LlmStreamEvent;
					index += 1;
					return { done: false, value: event };
				}
				return { done: true, value: undefined };
			},
			async result(): Promise<LlmResult> {
				return result;
			},
		};
	}
}

async function startTestServer(options: {
	readonly docsRoot?: string;
	readonly client?: LlmStreamingClient;
}): Promise<RunningServer> {
	const dir = tempDir();
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot: writeWebRoot(dir),
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
		heartbeatMs: 20,
		...(options.docsRoot === undefined ? {} : { docsRoot: options.docsRoot }),
		...(options.client === undefined
			? {}
			: {
					channels: {
						load: async () => fakeConfig(),
						createClient: () => options.client as LlmStreamingClient,
					},
				}),
	});
	onTestFinished(() => running.close());
	return running;
}

function request(
	origin: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	});
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "POST", body: JSON.stringify(body) });
}

async function createConversation(
	origin: string,
	body: unknown,
): Promise<AssistantConversationView> {
	const response = await post(origin, "/api/assistant/conversations", body);
	expect(response.status).toBe(201);
	return (await response.json()) as AssistantConversationView;
}

describe("助手技能接口", () => {
	it("列出已注册技能，拒绝未注册技能", async () => {
		const running = await startTestServer({});
		const list = await request(running.origin, "/api/assistant/skills");
		expect(list.status).toBe(200);
		const body = (await list.json()) as AssistantSkillListView;
		expect(body.skills.map((skill) => skill.id)).toEqual([
			"troubleshoot",
			"guide",
			"ledger_revision",
			"strategy",
		]);
		expect(body.skills[0]?.name).toBe("排障");
		expect(body.skills[0]?.defaultPermission).toBe("confirm");
		expect([...(body.skills[0]?.tools ?? [])].sort()).toEqual(
			TROUBLESHOOT_TOOLS,
		);
		expect(body.skills[1]?.tools).toContain("docs_search");
		expect(body.skills[2]?.tools).toContain("propose_ledger_change");
		expect(body.skills[3]?.tools).toContain("propose_director_plan");

		const unregistered = await post(
			running.origin,
			"/api/assistant/conversations",
			{ skill: "research" },
		);
		expect(unregistered.status).toBe(400);
		expect(
			((await unregistered.json()) as ApiErrorResponse).error.details,
		).toEqual({
			path: "skill",
		});

		const conversation = await createConversation(running.origin, {
			skill: "guide",
		});
		const badPatch = await request(
			running.origin,
			`/api/assistant/conversations/${conversation.id}`,
			{ method: "PATCH", body: JSON.stringify({ skill: "research" }) },
		);
		expect(badPatch.status).toBe(400);
		const patched = await request(
			running.origin,
			`/api/assistant/conversations/${conversation.id}`,
			{ method: "PATCH", body: JSON.stringify({ skill: "troubleshoot" }) },
		);
		expect(patched.status).toBe(200);
		expect(((await patched.json()) as AssistantConversationView).skill).toBe(
			"troubleshoot",
		);
	});

	it("文档目录缺失或没有可读文件时启动失败", async () => {
		const dir = tempDir();
		const missing = join(dir, "missing-docs");
		await expect(startTestServer({ docsRoot: missing })).rejects.toThrow(
			new RegExp(`文档目录不存在：${escapeRegExp(missing)}`),
		);

		const empty = join(dir, "empty-docs");
		mkdirSync(join(empty, "dev", "reports"), { recursive: true });
		await expect(startTestServer({ docsRoot: empty })).rejects.toThrow(
			/文档目录下没有可读文档/,
		);
	});
});

describe("助手技能运行", () => {
	it("使用指南按白名单提供工具并执行 docs_search", async () => {
		const docsRoot = join(tempDir(), "docs");
		writeDocs(docsRoot);
		const client = new ScriptedClient([
			{
				text: "",
				toolCalls: [
					{ id: "call-1", name: "docs_search", arguments: { query: "门禁" } },
				],
			},
			{ text: "依据 DESIGN.md「设计 > 记忆」，门禁在提交前运行。" },
		]);
		const running = await startTestServer({ docsRoot, client });
		const conversation = await createConversation(running.origin, {
			skill: "guide",
		});
		const response = await post(
			running.origin,
			`/api/assistant/conversations/${conversation.id}/messages`,
			{ text: "门禁怎么用？" },
		);
		expect(response.status).toBe(200);
		const stream = await response.text();
		expect(stream).toContain("assistant.tool.result");
		expect(stream).toContain("DESIGN.md");
		expect(stream).toContain("assistant.completed");

		const first = client.requests[0];
		expect(first?.messages[0]?.content).toContain("docs_search");
		expect(first?.tools?.map((tool) => tool.name)).toEqual([
			"settings_read",
			"template_read",
			"plugin_list",
			"docs_search",
		]);
		const toolMessage = running.store
			.getAssistantMessages(conversation.id)
			.find((message) => message.role === "tool");
		expect(toolMessage?.toolName).toBe("docs_search");
		expect(JSON.stringify(toolMessage?.toolResult)).toContain("DESIGN.md");
	});

	it("排障会话只提供六个只读工具并使用技能说明", async () => {
		const client = new ScriptedClient([
			{ text: "楼层 n-1 没有运行日志，这个字段没有记录。" },
		]);
		const running = await startTestServer({ client });
		running.store.createStory({ id: "story-1", title: "测试故事" });
		const conversation = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "troubleshoot",
		});
		const response = await post(
			running.origin,
			`/api/assistant/conversations/${conversation.id}/messages`,
			{ text: "这一楼为什么忘了剑冢？" },
		);
		expect(response.status).toBe(200);
		await response.text();
		const first = client.requests[0];
		expect(first?.messages[0]?.content).toContain("修正建议");
		expect(first?.messages[0]?.content).toContain("没有记录");
		expect((first?.tools ?? []).map((tool) => tool.name).sort()).toEqual(
			TROUBLESHOOT_TOOLS,
		);
	});

	it("台账修订会话通过接口生成待批准卡，不改楼层", async () => {
		const client = new ScriptedClient([
			{
				text: "",
				toolCalls: [
					{
						id: "call-1",
						name: "propose_ledger_change",
						arguments: {
							diffs: [
								{
									path: ["relation", "甲", "乙", "affectionInner"],
									op: "set",
									value: "亲近",
								},
							],
							explanation: "她刚刚主动出手救人。",
						},
					},
				],
			},
			{ text: "已经生成待批准的变更卡。" },
		]);
		const running = await startTestServer({ client });
		running.store.createStory({ id: "story-1", title: "测试故事" });
		const root = running.store.appendNode({
			id: "n-root",
			storyId: "story-1",
			parentId: null,
			role: "system",
			raw: "你是故事引擎。",
		});
		running.store.appendNode({
			id: "n-user",
			storyId: "story-1",
			parentId: root.id,
			role: "user",
			raw: "我看向她。",
		});
		running.store.appendStateDiffs([
			{
				storyId: "story-1",
				nodeId: "n-user",
				path: ["relation", "甲", "乙", "affectionInner"],
				op: "set",
				value: "冷淡",
				source: "model",
			},
		]);
		const conversation = await createConversation(running.origin, {
			storyId: "story-1",
			skill: "ledger_revision",
		});
		const response = await post(
			running.origin,
			`/api/assistant/conversations/${conversation.id}/messages`,
			{ text: "把好感度改成亲近。" },
		);
		expect(response.status).toBe(200);
		const stream = await response.text();
		expect(stream).toContain("assistant.completed");
		const cards = running.store.listLedgerChangeCards("story-1", {
			status: "pending",
		});
		expect(cards).toHaveLength(1);
		expect(cards[0]?.source).toBe("assistant");
		expect(cards[0]?.assistantConversationId).toBe(conversation.id);
		expect(running.store.getPathToNode("n-user")).toHaveLength(2);
		expect(running.store.getHead("story-1")?.id).toBe("n-user");
		expect(
			running.store.getAssistantMessages(conversation.id).length,
		).toBeGreaterThan(0);
	});
});

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

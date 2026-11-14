import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type BackgroundJob,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type NewImportAuditEntry,
	StoryStore,
	buildImportKindUserContent,
	createImportKindSuggestionHandler,
	importKindSuggestionsNeedRun,
	parseImportKindSuggestions,
} from "../src/index.js";

function openStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-import-kind-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	store.createStory({ id: "s1", title: "山门" });
	return store;
}

function unknownEntry(index: number): NewImportAuditEntry {
	return {
		source: `world-info:旧世:${index}`,
		title: `附录${index}`,
		content: `第 ${index} 节：那一年的冬天格外漫长。\n人们把粮食藏进地窖。`,
		matches: [{ kind: "unknown", rules: ["no-rule"] }],
		rulePrimary: "unknown",
		constant: false,
	};
}

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: {
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
		},
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function createFakeClient(replies: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmClient = {
		async complete(request) {
			requests.push(request);
			const reply = replies[requests.length - 1];
			if (reply === undefined) throw new Error("假客户端没有更多回复");
			return llmResult(reply);
		},
	};
	return { client, requests };
}

function job(): BackgroundJob {
	return {
		id: 1,
		storyId: "s1",
		nodeId: null,
		kind: "import_kind",
		status: "running",
		attempts: 1,
		lastError: null,
		createdAt: "2026-11-14T00:00:00.000Z",
		startedAt: null,
		finishedAt: null,
	};
}

describe("未识别条目的类型建议", () => {
	it("只有规则判成 unknown 的条目需要建议，模型与玩家的判定不再触发", () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [unknownEntry(0), unknownEntry(1)]);
		expect(importKindSuggestionsNeedRun(store, "s1")).toBe(true);

		store.setImportAuditEntryKind(
			"s1",
			"world-info:旧世:0",
			"writing",
			"player",
		);
		expect(importKindSuggestionsNeedRun(store, "s1")).toBe(true);

		store.setImportAuditEntryKind("s1", "world-info:旧世:1", "event", "model");
		expect(importKindSuggestionsNeedRun(store, "s1")).toBe(false);
	});

	it("把模型建议写成 model 来源，玩家改过的条目保持不动", async () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [
			unknownEntry(0),
			unknownEntry(1),
			unknownEntry(2),
		]);
		store.setImportAuditEntryKind(
			"s1",
			"world-info:旧世:2",
			"options",
			"player",
		);
		const { client, requests } = createFakeClient([
			JSON.stringify({
				entries: [
					{ source: "world-info:旧世:0", kind: "writing" },
					{ source: "world-info:旧世:1", kind: "entity" },
				],
			}),
		]);

		await createImportKindSuggestionHandler()({
			store,
			client,
			job: job(),
		});

		expect(requests).toHaveLength(1);
		const entries = new Map(
			store
				.listImportAuditEntries("s1")
				.map((entry) => [entry.source, entry] as const),
		);
		expect(entries.get("world-info:旧世:0")).toMatchObject({
			kind: "writing",
			kindSource: "model",
			rulePrimary: "unknown",
		});
		expect(entries.get("world-info:旧世:1")).toMatchObject({
			kind: "entity",
			kindSource: "model",
		});
		expect(entries.get("world-info:旧世:2")).toMatchObject({
			kind: "options",
			kindSource: "player",
		});
		expect(importKindSuggestionsNeedRun(store, "s1")).toBe(false);
	});

	it("按批次发请求，每批只带本批条目", async () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [unknownEntry(0), unknownEntry(1)]);
		const { client, requests } = createFakeClient([
			JSON.stringify({
				entries: [{ source: "world-info:旧世:0", kind: "writing" }],
			}),
			JSON.stringify({
				entries: [{ source: "world-info:旧世:1", kind: "writing" }],
			}),
		]);

		await createImportKindSuggestionHandler({ batchSize: 1 })({
			store,
			client,
			job: job(),
		});

		expect(requests).toHaveLength(2);
		expect(requests[0]?.messages.at(-1)?.content).toContain(
			"world-info:旧世:0",
		);
		expect(requests[0]?.messages.at(-1)?.content).not.toContain(
			"world-info:旧世:1",
		);
		expect(
			store
				.listImportAuditEntries("s1")
				.filter((entry) => entry.kindSource === "model"),
		).toHaveLength(2);
	});

	it("模型给出本批之外的来源或重复条目时整批拒绝，不写任何建议", async () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [unknownEntry(0)]);
		const { client } = createFakeClient([
			JSON.stringify({
				entries: [{ source: "world-info:旧世:9", kind: "writing" }],
			}),
		]);

		await expect(
			createImportKindSuggestionHandler()({ store, client, job: job() }),
		).rejects.toThrow(/不在本批条目里/);
		expect(store.listImportAuditEntries("s1")[0]).toMatchObject({
			kind: "unknown",
			kindSource: "rule",
		});
	});

	it("响应必须是合法类型，不能出现未知字段", () => {
		expect(() =>
			parseImportKindSuggestions(
				JSON.stringify({
					entries: [{ source: "a", kind: "writing", why: "看起来像" }],
				}),
				["a"],
			),
		).toThrow(/未知字段/);
		expect(() =>
			parseImportKindSuggestions(
				JSON.stringify({ entries: [{ source: "a", kind: "nonsense" }] }),
				["a"],
			),
		).toThrow(/不合法/);
		expect(
			parseImportKindSuggestions(JSON.stringify({ entries: [] }), ["a"]),
		).toEqual([]);
	});

	it("送进提示词的正文按上限截断，原文不变", () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [
			{
				...unknownEntry(0),
				content: "长".repeat(1_000),
			},
		]);
		const [entry] = store.listImportAuditEntries("s1");
		if (entry === undefined) throw new Error("审计条目没有写入");
		const content = buildImportKindUserContent([entry]);
		const parsed = JSON.parse(content) as {
			entries: { content: string }[];
		};
		expect([...(parsed.entries[0]?.content ?? "")].length).toBe(800);
		expect(store.listImportAuditEntries("s1")[0]?.content).toHaveLength(1_000);
	});
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import { parsePresetJson } from "../src/preset.js";
import { runStBenchCli } from "../src/st-bench/cli.js";
import {
	type BenchmarkSampling,
	compareRequests,
	normalizeAssembledRequest,
	normalizeRecordedBody,
	parseComparisonDiffLine,
	summarizeComparisons,
} from "../src/st-bench/compare.js";
import { assembleFaithfulRequest } from "../src/st-bench/faithful.js";
import { combinationId } from "../src/st-bench/plan.js";
import { stBenchPaths } from "../src/st-bench/sandbox.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const PRESET = {
	temperature: 0.8,
	top_p: 0.9,
	openai_max_tokens: 256,
	frequency_penalty: 0.1,
	presence_penalty: 0.2,
	assistant_prefill: "As {{char}},",
	prompts: [
		{
			identifier: "main",
			name: "Main",
			content: "You are {{char}} talking to {{user}}.",
			role: "system",
			system_prompt: true,
		},
		{
			identifier: "charDescription",
			name: "Description",
			content: "",
			marker: true,
			system_prompt: true,
		},
		{
			identifier: "chatHistory",
			name: "History",
			content: "",
			marker: true,
			system_prompt: true,
		},
		{
			identifier: "depthNote",
			name: "Depth note",
			content: "Remember the rule.",
			role: "system",
			system_prompt: true,
			injection_position: 1,
			injection_depth: 1,
		},
		{
			identifier: "post",
			name: "Post",
			content: "Write the next line.",
			role: "assistant",
			system_prompt: false,
		},
	],
	prompt_order: [
		{
			character_id: 100000,
			order: [
				{ identifier: "main", enabled: true },
				{ identifier: "charDescription", enabled: true },
				{ identifier: "chatHistory", enabled: true },
				{ identifier: "depthNote", enabled: true },
				{ identifier: "post", enabled: true },
			],
		},
	],
};

const BASE_ORDER = PRESET.prompt_order[0]?.order ?? [];

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "Alice",
		description: "a witch",
		personality: "calm",
		scenario: "a tower",
		first_mes: "",
		mes_example: "",
		creator_notes: "",
		system_prompt: "",
		post_history_instructions: "",
		alternate_greetings: [],
		tags: [],
		creator: "",
		character_version: "",
		extensions: {},
	},
};

const CHAT = [
	{ role: "user" as const, content: "hello" },
	{ role: "assistant" as const, content: "hi" },
	{ role: "user" as const, content: "again" },
];

describe("请求规范化与逐条比对", () => {
	it("同一份请求的覆盖率为 100%，没有差异", () => {
		const normalized = normalizeRecordedBody({
			model: "ignored-model",
			stream: true,
			messages: [
				{ role: "system", content: "系统" },
				{ role: "user", content: "你好" },
			],
			temperature: 0.7,
			top_p: 0.9,
			max_tokens: 128,
			frequency_penalty: 0,
			presence_penalty: 0,
		});
		const comparison = compareRequests(
			{ combinationId: "combo", seq: 0 },
			normalized,
			normalized,
			[],
		);
		expect(comparison.messageCoverage).toBe(1);
		expect(comparison.matchedMessages).toBe(2);
		expect(comparison.matchedSamplingFields).toBe(5);
		expect(comparison.diffs).toEqual([]);
		expect(comparison.expectedHash).toBe(comparison.actualHash);
	});

	it("角色、正文与采样参数的差异逐条给出路径和原因", () => {
		const expected = normalizeRecordedBody({
			messages: [
				{ role: "system", content: "系统" },
				{ role: "user", content: "你好" },
				{ role: "assistant", content: "回答" },
			],
			temperature: 0.7,
			top_p: 0.9,
			max_tokens: 128,
			top_k: 40,
		});
		const actual = normalizeAssembledRequest({
			messages: [
				{ role: "system", content: "系统" },
				{ role: "assistant", content: "你好" },
			],
			sampling: {
				temperature: 0.8,
				topP: 0.9,
				maxTokens: 128,
				frequencyPenalty: null,
				presencePenalty: null,
			},
		});
		const comparison = compareRequests(
			{ combinationId: "combo", seq: 3 },
			expected,
			actual,
			[{ feature: "world-info", detail: "worldInfoBefore" }],
		);
		expect(comparison.matchedMessages).toBe(1);
		expect(comparison.messageCoverage).toBeCloseTo(1 / 3);
		expect(comparison.diffs.map((diff) => [diff.path, diff.reason])).toEqual([
			["messages[1]", "role-mismatch"],
			["messages[2]", "message-missing"],
			["sampling.temperature", "sampling-mismatch"],
			["features.world-info", "unsupported-feature"],
			["sampling.top_k", "unsupported-feature"],
		]);
		expect(
			comparison.diffs.every((diff) => !diff.detail.includes("你好")),
		).toBe(true);
	});

	it("非法角色直接抛错", () => {
		expect(() =>
			normalizeRecordedBody({
				messages: [{ role: "tool", content: "x" }],
			}),
		).toThrow(/role/);
	});
});

describe("忠实模式组装", () => {
	it("只映射预设条目、角色卡字段、聊天历史、深度注入与预填充", async () => {
		const assembly = await assembleFaithfulRequest({
			preset: parsePresetJson(JSON.stringify(PRESET)),
			character: parseCharacterCardJson(JSON.stringify(CARD)),
			chat: CHAT,
			userName: "Bob",
		});
		expect(assembly.unsupported).toEqual([]);
		expect(assembly.request.messages).toEqual([
			{ role: "system", content: "You are Alice talking to Bob." },
			{ role: "system", content: "a witch" },
			{ role: "system", content: "[Start a new Chat]" },
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
			{ role: "system", content: "Remember the rule." },
			{ role: "user", content: "again" },
			{ role: "assistant", content: "Write the next line." },
			{ role: "assistant", content: "As Alice," },
		]);
		expect(assembly.request.sampling).toEqual<BenchmarkSampling>({
			temperature: 0.8,
			topP: 0.9,
			maxTokens: 256,
			frequencyPenalty: 0.1,
			presencePenalty: 0.2,
		});
		const text = assembly.request.messages
			.map((message) => message.content)
			.join("\n");
		expect(text).not.toContain("写作契约");
	});

	it("使用 ST OpenAI 连接的全局顺序组 100001", async () => {
		const preset = {
			...PRESET,
			prompts: [
				...PRESET.prompts,
				{
					identifier: "groupOnly",
					name: "Group only",
					content: "group text",
					role: "user",
					system_prompt: false,
				},
			],
			prompt_order: [
				{ character_id: 100000, order: BASE_ORDER },
				{
					character_id: 100001,
					order: [
						{ identifier: "main", enabled: true },
						{ identifier: "groupOnly", enabled: true },
						{ identifier: "chatHistory", enabled: false },
					],
				},
			],
		};
		const assembly = await assembleFaithfulRequest({
			preset: parsePresetJson(JSON.stringify(preset)),
			character: parseCharacterCardJson(JSON.stringify(CARD)),
			chat: CHAT,
			userName: "Bob",
		});
		expect(assembly.request.messages).toEqual([
			{ role: "system", content: "You are Alice talking to Bob." },
			{ role: "user", content: "group text" },
			{ role: "assistant", content: "As Alice," },
		]);
	});

	it("无法表达的功能逐条记入不支持，不把半成品放进消息", async () => {
		const preset = {
			...PRESET,
			squash_system_messages: true,
			prompts: [
				...PRESET.prompts,
				{
					identifier: "macroPrompt",
					name: "Macro",
					content: "Roll {{random}}.",
					role: "system",
					system_prompt: true,
				},
				{
					identifier: "worldInfoBefore",
					name: "World info",
					content: "",
					marker: true,
					system_prompt: true,
				},
				{
					identifier: "absolute",
					name: "Absolute",
					content: "Absolute note.",
					role: "system",
					system_prompt: true,
					injection_position: 2,
				},
				{
					identifier: "unknownMarker",
					name: "Unknown",
					content: "",
					marker: true,
					system_prompt: true,
				},
			],
			prompt_order: [
				{
					character_id: 100000,
					order: [
						...BASE_ORDER,
						{ identifier: "macroPrompt", enabled: true },
						{ identifier: "worldInfoBefore", enabled: true },
						{ identifier: "absolute", enabled: true },
						{ identifier: "unknownMarker", enabled: true },
					],
				},
			],
		};
		const card = {
			...CARD,
			data: {
				...CARD.data,
				system_prompt: "card system",
				post_history_instructions: "card post",
				character_book: { entries: [] },
			},
		};
		const assembly = await assembleFaithfulRequest({
			preset: parsePresetJson(JSON.stringify(preset)),
			character: parseCharacterCardJson(JSON.stringify(card)),
			chat: CHAT,
			userName: "Bob",
		});
		const features = assembly.unsupported.map((item) => item.feature);
		expect(features).toEqual(
			expect.arrayContaining([
				"squash-system-messages",
				"macro",
				"world-info",
				"injection-position",
				"marker",
				"character-system-prompt",
				"character-post-history",
				"character-lorebook",
			]),
		);
		const text = assembly.request.messages
			.map((message) => message.content)
			.join("\n");
		expect(text).not.toContain("Roll");
		expect(text).not.toContain("Absolute note");
		expect(text).not.toContain("card system");
		expect(text).not.toContain("card post");
	});
});

interface SandboxFixture {
	readonly repoRoot: string;
	readonly sandboxDir: string;
	readonly batchDir: string;
	readonly requestFile: string;
}

async function createSandboxFixture(): Promise<SandboxFixture> {
	const repoRoot = await mkdtemp(path.join(TEST_DIR, ".tmp-st-compare-"));
	onTestFinished(async () => {
		await rm(repoRoot, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	});
	const paths = stBenchPaths(repoRoot);
	const sandboxDir = path.join(paths.sandboxDir, "st");
	const dataRoot = path.join(sandboxDir, "data", "default-user");
	await mkdir(path.join(dataRoot, "OpenAI Settings"), { recursive: true });
	await mkdir(path.join(dataRoot, "characters"), { recursive: true });
	await mkdir(path.join(dataRoot, "chats", "Alice"), { recursive: true });
	await writeFile(
		path.join(dataRoot, "OpenAI Settings", "Test.json"),
		`${JSON.stringify(PRESET)}\n`,
	);
	await writeFile(
		path.join(dataRoot, "characters", "Alice.json"),
		`${JSON.stringify(CARD)}\n`,
	);
	const header = {
		chat_metadata: {},
		user_name: "Bob",
		character_name: "Alice",
	};
	await writeFile(
		path.join(dataRoot, "chats", "Alice", "chat.jsonl"),
		`${[
			JSON.stringify(header),
			JSON.stringify({ name: "Bob", is_user: true, mes: "hello" }),
			JSON.stringify({ name: "Alice", is_user: false, mes: "hi" }),
			JSON.stringify({ name: "Bob", is_user: true, mes: "again" }),
			"",
		].join("\n")}`,
	);
	const chatId = "Alice/chat.jsonl";
	const batchDir = path.join(paths.sandboxDir, "runs", "batch");
	await mkdir(path.join(batchDir, "requests"), { recursive: true });
	const combination = combinationId("Test", "Alice", chatId);
	await writeFile(
		path.join(batchDir, "manifest.jsonl"),
		`${[
			JSON.stringify({
				combinationId: combination,
				preset: "Test",
				character: "Alice",
				chat: chatId,
				floor: 3,
				seqStart: 0,
				seqEnd: 0,
				startedAt: "2026-11-12T00:00:00.000Z",
				finishedAt: "2026-11-12T00:00:01.000Z",
				status: "completed",
			}),
			"",
		].join("\n")}`,
	);
	const assembly = await assembleFaithfulRequest({
		preset: parsePresetJson(JSON.stringify(PRESET)),
		character: parseCharacterCardJson(JSON.stringify(CARD)),
		chat: CHAT,
		userName: "Bob",
	});
	const body = {
		model: "stub",
		stream: true,
		messages: assembly.request.messages,
		temperature: assembly.request.sampling.temperature,
		top_p: assembly.request.sampling.topP,
		max_tokens: assembly.request.sampling.maxTokens,
		frequency_penalty: assembly.request.sampling.frequencyPenalty,
		presence_penalty: assembly.request.sampling.presencePenalty,
	};
	const requestFile = path.join(batchDir, "requests", "00000.json");
	await writeFile(
		requestFile,
		`${JSON.stringify({ seq: 0, file: "requests/00000.json", body })}\n`,
	);
	await writeFile(
		path.join(batchDir, "index.jsonl"),
		`${JSON.stringify({ seq: 0, file: "requests/00000.json" })}\n`,
	);
	return { repoRoot, sandboxDir, batchDir, requestFile };
}

describe("批次比对", () => {
	it("读取 completed 行与录制序号，写出不含正文的报告", async () => {
		const fixture = await createSandboxFixture();
		const logs: string[] = [];
		await runStBenchCli(
			[
				"compare",
				"--sandbox",
				fixture.sandboxDir,
				"--batch",
				"batch",
				"--limit",
				"1",
			],
			{ repoRoot: fixture.repoRoot, log: (message) => logs.push(message) },
		);
		const report = await readFile(
			path.join(fixture.batchDir, "compare", "report.md"),
			"utf8",
		);
		expect(report).toContain("消息覆盖率：100.00%");
		expect(report).toContain("片段历史：3/3 楼进入录制请求");
		expect(report).toContain("包含 3/3 楼，完整");
		expect(report).not.toContain("You are Alice");
		expect(report).not.toContain("a witch");
		expect(report).not.toContain("hello");
		const diffs = await readFile(
			path.join(fixture.batchDir, "compare", "diffs.jsonl"),
			"utf8",
		);
		expect(diffs).toBe("");
		expect(logs.some((line) => line.includes("比对结束"))).toBe(true);

		const record = JSON.parse(await readFile(fixture.requestFile, "utf8"));
		record.body.messages[0].content = "different prompt";
		await writeFile(fixture.requestFile, `${JSON.stringify(record)}\n`);
		await runStBenchCli(
			["compare", "--sandbox", fixture.sandboxDir, "--batch", "batch"],
			{ repoRoot: fixture.repoRoot, log: () => undefined },
		);
		const updated = await readFile(
			path.join(fixture.batchDir, "compare", "report.md"),
			"utf8",
		);
		expect(updated).toContain("content-mismatch");
		expect(updated).not.toContain("different prompt");
		const diffLines = (
			await readFile(
				path.join(fixture.batchDir, "compare", "diffs.jsonl"),
				"utf8",
			)
		)
			.split("\n")
			.filter((line) => line !== "");
		expect(diffLines.length).toBeGreaterThan(0);
		const parsed = parseComparisonDiffLine(diffLines[0] as string, "差异行");
		expect(parsed.path).toBe("messages[0].content");
		expect(parsed.reason).toBe("content-mismatch");
	});

	it("汇总覆盖率与采样参数一致数", () => {
		const request = normalizeRecordedBody({
			messages: [{ role: "user", content: "x" }],
			temperature: 1,
			top_p: null,
			max_tokens: null,
			frequency_penalty: null,
			presence_penalty: null,
		});
		const summary = summarizeComparisons([
			compareRequests({ combinationId: "a", seq: 0 }, request, request, []),
		]);
		expect(summary.requests).toBe(1);
		expect(summary.messageCoverage).toBe(1);
		expect(summary.comparedSamplingFields).toBe(1);
		expect(summary.matchedSamplingFields).toBe(1);
	});
});

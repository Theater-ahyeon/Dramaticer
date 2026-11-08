import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmChannelsConfig,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore,
	createBackgroundJobRegistry,
	createDefaultContextTemplate,
	createEventStream,
	createStandardChatProviders,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { runPlaytestCli } from "../src/evalset/playtest-cli.js";
import {
	type PlaytestOptions,
	type PlaytestRecord,
	parsePlaytestJsonl,
	runPlaytest,
	serializePlaytestRecord,
} from "../src/evalset/playtest.js";
import { runProbeReportCli } from "../src/evalset/probe-report-cli.js";
import {
	type PlaytestProbeRecord,
	buildProbeQuestion,
	parseProbeJudgeOutput,
	renderProbeReport,
	selectProbeFact,
	summarizePlaytestProbes,
} from "../src/evalset/probe.js";

const STORY_ID = "probe-story";
const CARD_PROMPT = "你扮演山神，用冷静的旁观者口吻叙述。";
const TURN_TEXT = "山风穿过石阶。";
const PROBE_ANSWER = "山门在东方。";

const USAGE: LlmUsage = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
});

function makeDir(): string {
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-probe-"));
	createdDirs.push(dir);
	return dir;
}

function makeResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: text.length === 0 ? null : { text, reasoning: "" },
	};
}

interface RecordedWriter {
	readonly client: LlmStreamingClient;
	readonly turnRequests: LlmRequest[];
	readonly probeRequests: LlmRequest[];
}

function createWriter(): RecordedWriter {
	const turnRequests: LlmRequest[] = [];
	const probeRequests: LlmRequest[] = [];
	return {
		turnRequests,
		probeRequests,
		client: {
			async complete(request) {
				probeRequests.push(request);
				return makeResult(PROBE_ANSWER);
			},
			stream(request) {
				turnRequests.push(request);
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: TURN_TEXT });
					return makeResult(TURN_TEXT);
				});
			},
		},
	};
}

interface RecordedJudge {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
}

function createJudge(
	outputs: readonly string[] | ((call: number) => string),
): RecordedJudge {
	const requests: LlmRequest[] = [];
	let call = 0;
	const next = (): string => {
		call += 1;
		return typeof outputs === "function"
			? outputs(call)
			: (outputs[call - 1] ?? outputs.at(-1) ?? "{}");
	};
	return {
		requests,
		client: {
			async complete(request) {
				requests.push(request);
				return makeResult(next());
			},
			stream(request) {
				requests.push(request);
				const text = next();
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: text });
					return makeResult(text);
				});
			},
		},
	};
}

function createUser(): LlmStreamingClient {
	let call = 0;
	return {
		async complete() {
			call += 1;
			return makeResult(
				JSON.stringify({ message: `第 ${call} 轮：我向前走。` }),
			);
		},
		stream() {
			call += 1;
			const text = JSON.stringify({ message: `第 ${call} 轮：我向前走。` });
			return createEventStream(async (emit) => {
				emit({ type: "text_delta", delta: text });
				return makeResult(text);
			});
		},
	};
}

/** 建一条 25 楼的故事，并在早期楼层写入一条台账事实。 */
function seedLongStory(store: StoryStore): void {
	store.createStory({ id: STORY_ID, title: "探针测试" });
	store.updateStorySettings(STORY_ID, { characterPrompt: CARD_PROMPT });
	let parentId: string | null = null;
	for (let index = 0; index < 25; index += 1) {
		const node = store.appendNode({
			id: `seed-${index}`,
			storyId: STORY_ID,
			parentId,
			role: index % 2 === 0 ? "assistant" : "user",
			raw: `第 ${index + 1} 楼`,
		});
		parentId = node.id;
	}
	store.appendStateDiffs([
		{
			storyId: STORY_ID,
			nodeId: "seed-1",
			path: ["character", "卫宫", "location"],
			op: "set",
			value: "山门",
			source: "model",
		},
		{
			storyId: STORY_ID,
			nodeId: "seed-1",
			path: ["userWill", "w1"],
			op: "set",
			value: {
				kind: "preference",
				text: "玩家想看雪",
				sourceNodeId: "seed-1",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			source: "settler",
		},
		{
			storyId: STORY_ID,
			nodeId: "seed-24",
			path: ["scene", "current", "atmosphere"],
			op: "set",
			value: "夜里起雾",
			source: "model",
		},
	]);
}

function openStore(dir: string): StoryStore {
	const store = StoryStore.open(path.join(dir, "story.db"));
	seedLongStory(store);
	return store;
}

function playtestOptions(
	store: StoryStore,
	overrides: Partial<PlaytestOptions> = {},
): PlaytestOptions {
	return {
		store,
		storyId: STORY_ID,
		rounds: 1,
		profile: "native",
		seed: 3,
		assistant: { client: createWriter().client, model: "main" },
		user: { client: createUser(), model: "background" },
		turn: {
			template: createDefaultContextTemplate({ structuredOutput: "text-tags" }),
			providers: createStandardChatProviders({
				store,
				characterPrompt: CARD_PROMPT,
				directorConfig: DEFAULT_DIRECTOR_CONFIG,
			}),
			budgetTokens: 4_000,
			structuredOutput: "text-tags",
			toolTransport: "native",
			maxTokens: 512,
			temperature: 0.8,
			reasoning: "low",
		},
		onRecord: () => undefined,
		...overrides,
	};
}

function probeEvery(
	judge: RecordedJudge,
	overrides: { every?: number; minAgeFloors?: number } = {},
) {
	return {
		every: overrides.every ?? 1,
		minAgeFloors: overrides.minAgeFloors ?? 20,
		judge: { client: judge.client, model: "judge" },
	};
}

function doneProbe(record: PlaytestRecord | undefined): PlaytestProbeRecord {
	if (record === undefined) throw new Error("没有这一轮的记录");
	if (record.probe === null) throw new Error("这一轮没有探针记录");
	return record.probe;
}

describe("一致性探针", () => {
	it("只选出至少 20 楼之前、可以出题的文本事实", () => {
		const dir = makeDir();
		const store = openStore(dir);
		const head = store.getHead(STORY_ID);
		if (head === null) throw new Error("没有 head");
		const fact = selectProbeFact(store, head.id, 20, () => 0);
		if (fact === null) throw new Error("没有选出探针事实");
		expect(fact.path).toEqual(["character", "卫宫", "location"]);
		expect(fact.nodeId).toBe("seed-1");
		expect(fact.ageFloors).toBe(23);
		expect(buildProbeQuestion(fact)).toContain("所在位置");
		expect(buildProbeQuestion(fact)).not.toContain("山门");
		expect(selectProbeFact(store, head.id, 100, () => 0)).toBeNull();
		store.close();
	});

	it("严格解析裁判输出", () => {
		expect(
			parseProbeJudgeOutput('{"consistent":true,"reason":"符合"}'),
		).toEqual({ verdict: "consistent", reason: "符合" });
		expect(
			parseProbeJudgeOutput('{"consistent":false,"reason":"矛盾"}'),
		).toEqual({ verdict: "contradicted", reason: "矛盾" });
		expect(
			parseProbeJudgeOutput('{"consistent":"unknown","reason":"看不清"}'),
		).toEqual({ verdict: "unknown", reason: "看不清" });
		expect(
			parseProbeJudgeOutput('{"consistent":true,"reason":"符合","extra":1}'),
		).toBeNull();
		expect(parseProbeJudgeOutput('{"consistent":true}')).toBeNull();
		expect(
			parseProbeJudgeOutput('{"consistent":"maybe","reason":"x"}'),
		).toBeNull();
		expect(parseProbeJudgeOutput("```json\n{}\n```")).toBeNull();
	});

	it("探针不写楼层、不改 head，回答与裁判各自调用一次", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const judge = createJudge([
			JSON.stringify({ consistent: true, reason: "台账写明山门" }),
		]);
		const records: PlaytestRecord[] = [];
		const options = playtestOptions(store, {
			assistant: { client: writer.client, model: "main" },
			probes: probeEvery(judge),
			onRecord: (record) => {
				records.push(record);
			},
		});
		await runPlaytest(options);
		expect(records).toHaveLength(1);
		expect(records[0]?.storyId).toBe(STORY_ID);
		const probe = doneProbe(records[0]);
		expect(probe.status).toBe("done");
		expect(probe.verdict).toBe("consistent");
		expect(probe.judgeAttempts).toBe(1);
		expect(writer.probeRequests).toHaveLength(1);
		expect(judge.requests).toHaveLength(1);
		const messages = writer.probeRequests[0]?.messages ?? [];
		expect(messages.at(-1)?.role).toBe("user");
		expect(messages.at(-1)?.content).toContain("请回忆");
		expect(judge.requests[0]?.messages[0]?.content).toContain("一致性裁判");
		expect(judge.requests[0]?.messages[1]?.content).toContain(PROBE_ANSWER);
		expect(store.getPathToHead(STORY_ID)).toHaveLength(27);
		const first = records[0];
		if (first === undefined || first.status !== "done") {
			throw new Error("第一轮没有完成");
		}
		expect(store.getHead(STORY_ID)?.id).toBe(first.nodeId);
		store.close();
	}, 30_000);

	it("裁判输出非法 JSON 时重试，第三次合法后记录判定", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const judge = createJudge([
			"不是 JSON",
			'{"consistent":true}',
			JSON.stringify({ consistent: false, reason: "与台账不符" }),
		]);
		const records: PlaytestRecord[] = [];
		await runPlaytest(
			playtestOptions(store, {
				assistant: { client: writer.client, model: "main" },
				probes: probeEvery(judge),
				onRecord: (record) => {
					records.push(record);
				},
			}),
		);
		const probe = doneProbe(records[0]);
		expect(probe.status).toBe("done");
		expect(probe.verdict).toBe("contradicted");
		expect(probe.judgeAttempts).toBe(3);
		expect(judge.requests).toHaveLength(3);
		store.close();
	}, 30_000);

	it("裁判连续三次非法时探针失败，试玩继续", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const judge = createJudge(["{}"]);
		const records: PlaytestRecord[] = [];
		const result = await runPlaytest(
			playtestOptions(store, {
				rounds: 2,
				assistant: { client: writer.client, model: "main" },
				probes: probeEvery(judge),
				onRecord: (record) => {
					records.push(record);
				},
			}),
		);
		expect(result.failures).toBe(0);
		expect(records).toHaveLength(2);
		for (const record of records) {
			expect(record.status).toBe("done");
			const probe = doneProbe(record);
			expect(probe.status).toBe("failed");
			expect(probe.judgeAttempts).toBe(3);
			expect(probe.verdict).toBeNull();
			expect(probe.error).toContain("连续 3 次");
		}
		store.close();
	}, 30_000);

	it("没有足够早的事实时不调用裁判，记 skipped", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const judge = createJudge([]);
		const records: PlaytestRecord[] = [];
		await runPlaytest(
			playtestOptions(store, {
				assistant: { client: writer.client, model: "main" },
				probes: probeEvery(judge, { minAgeFloors: 200 }),
				onRecord: (record) => {
					records.push(record);
				},
			}),
		);
		const probe = doneProbe(records[0]);
		expect(probe.status).toBe("skipped");
		expect(probe.fact).toBeNull();
		expect(writer.probeRequests).toHaveLength(0);
		expect(judge.requests).toHaveLength(0);
		store.close();
	}, 30_000);

	it("按故事汇总矛盾率，unknown 与失败单列", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const judge = createJudge([
			JSON.stringify({ consistent: true, reason: "符合" }),
			JSON.stringify({ consistent: false, reason: "矛盾" }),
			"坏输出",
			"坏输出",
			"坏输出",
			JSON.stringify({ consistent: "unknown", reason: "看不清" }),
		]);
		const records: PlaytestRecord[] = [];
		const result = await runPlaytest(
			playtestOptions(store, {
				rounds: 4,
				assistant: { client: writer.client, model: "main" },
				probes: probeEvery(judge),
				onRecord: (record) => {
					records.push(record);
				},
			}),
		);
		expect(result.failures).toBe(0);
		const summaries = summarizePlaytestProbes(records);
		expect(summaries).toHaveLength(1);
		const summary = summaries[0];
		expect(summary?.storyId).toBe(STORY_ID);
		expect(summary?.attempted).toBe(4);
		expect(summary?.consistent).toBe(1);
		expect(summary?.contradicted).toBe(1);
		expect(summary?.unknown).toBe(1);
		expect(summary?.failed).toBe(1);
		expect(summary?.skipped).toBe(0);
		expect(summary?.contradictionRate).toBe(0.5);
		expect(summary?.samples.map((sample) => sample.round)).toEqual([
			1, 2, 3, 4,
		]);
		store.close();
	}, 30_000);

	it("报告分开私有版与统计版，重复生成逐字节一致", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		const writer = createWriter();
		const judge = createJudge([
			JSON.stringify({ consistent: true, reason: "符合" }),
			JSON.stringify({ consistent: false, reason: "矛盾" }),
		]);
		const records: PlaytestRecord[] = [];
		await runPlaytest(
			playtestOptions(store, {
				rounds: 2,
				assistant: { client: writer.client, model: "main" },
				probes: probeEvery(judge),
				onRecord: (record) => {
					records.push(record);
				},
			}),
		);
		const jsonl = records.map(serializePlaytestRecord).join("");
		const files = new Map<string, string>();
		const dependencies = {
			log: () => undefined,
			readText: async () => jsonl,
			writeText: async (filePath: string, text: string) => {
				files.set(filePath, text);
			},
		};
		await runProbeReportCli(
			[
				"--input",
				"records.jsonl",
				"--private-out",
				"p.md",
				"--public-out",
				"s.md",
			],
			dependencies,
		);
		await runProbeReportCli(
			[
				"--input",
				"records.jsonl",
				"--private-out",
				"p2.md",
				"--public-out",
				"s2.md",
			],
			dependencies,
		);
		const privateReport = files.get("p.md") ?? "";
		const publicReport = files.get("s.md") ?? "";
		expect(privateReport).toContain(STORY_ID);
		expect(privateReport).toContain("山门");
		expect(privateReport).toContain(PROBE_ANSWER);
		expect(privateReport).toContain("50.0%");
		expect(privateReport).not.toContain("故事 1");
		expect(publicReport).not.toContain(STORY_ID);
		expect(publicReport).not.toContain("山门");
		expect(publicReport).not.toContain("请回忆");
		expect(publicReport).toContain("故事 1");
		expect(publicReport).toContain("50.0%");
		expect(reportOf(records, true)).toBe(privateReport);
		expect(reportOf(records, false)).toBe(publicReport);
		expect(files.get("p2.md")).toBe(privateReport);
		expect(files.get("s2.md")).toBe(publicReport);
		store.close();
	}, 30_000);

	it("CLI 的探针参数接线：默认不探、显式开启时写进记录", async () => {
		const dir = makeDir();
		const store = openStore(dir);
		store.close();
		const dbPath = path.join(dir, "story.db");
		const outPath = path.join(dir, "playtest.jsonl");
		const writer = createWriter();
		const judge = createJudge([
			JSON.stringify({ consistent: true, reason: "符合" }),
		]);
		const user = createUser();
		const clientFor = (alias: string): LlmStreamingClient => {
			if (alias === "main") return writer.client;
			return {
				async complete(request) {
					const system = request.messages[0]?.content ?? "";
					return system.includes("一致性裁判")
						? judge.client.complete(request)
						: user.complete(request);
				},
				stream(request) {
					return user.stream(request);
				},
			};
		};
		const config = fakeConfig();
		const dependencies = {
			loadEnv: () => undefined,
			loadConfig: async () => config,
			createClient: (_config: LlmChannelsConfig, alias: string) =>
				clientFor(alias),
			registry: createBackgroundJobRegistry({}),
			log: () => undefined,
		};
		const baseArgs = [
			"--db",
			dbPath,
			"--story",
			STORY_ID,
			"--model",
			"main",
			"--out",
			outPath,
		];
		await runPlaytestCli(
			[
				...baseArgs,
				"--rounds",
				"1",
				"--probe-every",
				"1",
				"--judge-model",
				"background",
			],
			dependencies,
		);
		const records = parsePlaytestJsonl(readFileSync(outPath, "utf8"));
		expect(records).toHaveLength(1);
		const cliProbe = doneProbe(records[0]);
		expect(cliProbe.status, cliProbe.error ?? undefined).toBe("done");
		expect(judge.requests).toHaveLength(1);
		expect(writer.probeRequests).toHaveLength(1);

		await runPlaytestCli(
			[...baseArgs, "--rounds", "1", "--probe-every", "0"],
			dependencies,
		);
		const disabled = parsePlaytestJsonl(readFileSync(outPath, "utf8"));
		expect(disabled[0]?.probe).toBeNull();
	}, 30_000);
});

function reportOf(
	records: readonly PlaytestRecord[],
	privateDetails: boolean,
): string {
	return renderProbeReport(summarizePlaytestProbes(records), {
		privateDetails,
	});
}

function fakeConfig(): LlmChannelsConfig {
	const channel = (id: string) => ({
		id,
		api: "openai-completions" as const,
		baseUrl: "http://127.0.0.1:1234",
		apiKey: "",
		requestsPerMinute: 0,
		maxRetries: 0,
		retryBaseDelayMs: 0,
		timeoutMs: 1_000,
	});
	const model = (alias: string) => ({
		alias,
		id: "fake-model",
		channels: [alias],
		contextWindow: 8_192,
		maxTokens: 1_024,
		reasoning: true,
		tools: null,
		probe: null,
	});
	return {
		channels: new Map([
			["main", channel("main")],
			["background", channel("background")],
		]),
		models: new Map([
			["main", model("main")],
			["background", model("background")],
		]),
		roles: new Map(),
		embeddings: new Map(),
	};
}

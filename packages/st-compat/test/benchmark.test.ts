import { createHash } from "node:crypto";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type LlmUsage,
	StoryStore,
	createDefaultContextTemplate,
	createEventStream,
	createStandardChatSlots,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import { runBenchmarkCli } from "../src/evalset/benchmark-cli.js";
import {
	buildBenchmarkFiles,
	importBenchmark,
	parseBranchPoints,
	validateBenchmark,
	validateBenchmarkStructure,
	writeBenchmark,
} from "../src/evalset/benchmark.js";
import { runPlaytest } from "../src/evalset/playtest.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const benchmarkDir = path.join(repoRoot, "benchmarks");
const STORY_ID = "benchmark-mist-harbor";

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

function makeDir(prefix: string): string {
	const dir = mkdtempSync(path.join(import.meta.dirname, prefix));
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
		continuation: null,
	};
}

function createAssistant(text: string): {
	readonly client: LlmStreamingClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const result = makeResult(text);
	return {
		requests,
		client: {
			async complete() {
				return result;
			},
			stream(request) {
				requests.push(request);
				return createEventStream(async (emit) => {
					emit({ type: "text_delta", delta: text });
					return result;
				});
			},
		},
	};
}

function createUser(): {
	readonly client: {
		complete(request: LlmRequest): Promise<LlmResult>;
	};
} {
	let round = 0;
	return {
		client: {
			async complete() {
				round += 1;
				return makeResult(
					JSON.stringify({ message: `第 ${round} 次：我沿着石阶往上走。` }),
				);
			},
		},
	};
}

function copyBenchmark(): string {
	const dir = makeDir(".tmp-benchmark-copy-");
	cpSync(benchmarkDir, dir, { recursive: true });
	return dir;
}

function editFile(
	rootDir: string,
	relativePath: string,
	edit: (text: string) => string,
): void {
	const filePath = path.join(rootDir, relativePath);
	writeFileSync(filePath, edit(readFileSync(filePath, "utf8")), "utf8");
}

describe("公开合成基准", () => {
	it("生成结果确定，清单哈希与内容一致", () => {
		const first = buildBenchmarkFiles();
		const second = buildBenchmarkFiles();
		expect([...second.entries()]).toEqual([...first.entries()]);
		const manifest = JSON.parse(first.get("manifest.json") ?? "");
		expect(manifest.version).toBe(1);
		expect(manifest.seed).toBe(1);
		expect(manifest.stories).toHaveLength(3);
		expect(manifest.files).toHaveLength(first.size - 1);
		for (const file of manifest.files) {
			const content = first.get(file.path);
			expect(content).toBeTypeOf("string");
			expect(
				createHash("sha256")
					.update(content ?? "", "utf8")
					.digest("hex"),
			).toBe(file.sha256);
		}
	});

	it("重复生成到两个目录得到逐字节相同的文件", async () => {
		const left = makeDir(".tmp-benchmark-left-");
		const right = makeDir(".tmp-benchmark-right-");
		const files = buildBenchmarkFiles();
		await writeBenchmark(left);
		await writeBenchmark(right);
		for (const relativePath of files.keys()) {
			expect(readFileSync(path.join(right, relativePath), "utf8")).toBe(
				readFileSync(path.join(left, relativePath), "utf8"),
			);
		}
	}, 60_000);

	it("仓库里的基准通过校验，题目与证据结构齐全", async () => {
		const scratch = makeDir(".tmp-benchmark-scratch-");
		const result = await validateBenchmark(benchmarkDir, {
			scratchDir: scratch,
		});
		expect(result).toEqual({
			stories: 3,
			messages: 1440,
			memoryQuestions: 33,
			probeQuestions: 14,
			branchPoints: 9,
		});
	}, 120_000);

	it("证据楼层不在主路径上时校验失败", async () => {
		const dir = copyBenchmark();
		editFile(dir, "questions/memory-mist-harbor.jsonl", (text) =>
			text.replace(
				'"evidenceNodes":["benchmark-mist-harbor:m6:s0"]',
				'"evidenceNodes":["benchmark-mist-harbor:m600:s0"]',
			),
		);
		await expect(
			validateBenchmarkStructure(dir, {
				scratchDir: makeDir(".tmp-benchmark-scratch-"),
			}),
		).rejects.toThrow("证据楼层不在");
	}, 120_000);

	it("题目 id 重复时校验失败", async () => {
		const dir = copyBenchmark();
		editFile(dir, "questions/memory-mist-harbor.jsonl", (text) => {
			const lines = text.trimEnd().split("\n");
			const first = JSON.parse(lines[0] ?? "");
			const second = JSON.parse(lines[1] ?? "");
			second.id = first.id;
			lines[1] = JSON.stringify(second);
			return `${lines.join("\n")}\n`;
		});
		await expect(
			validateBenchmarkStructure(dir, {
				scratchDir: makeDir(".tmp-benchmark-scratch-"),
			}),
		).rejects.toThrow("重复");
	}, 120_000);

	it("提问楼层不晚于证据楼层时校验失败", async () => {
		const dir = copyBenchmark();
		editFile(dir, "questions/memory-mist-harbor.jsonl", (text) => {
			const lines = text.trimEnd().split("\n");
			const question = JSON.parse(lines[0] ?? "");
			question.askAtNode = question.evidenceNodes[0];
			lines[0] = JSON.stringify(question);
			return `${lines.join("\n")}\n`;
		});
		await expect(
			validateBenchmarkStructure(dir, {
				scratchDir: makeDir(".tmp-benchmark-scratch-"),
			}),
		).rejects.toThrow("不晚于证据楼层");
	}, 120_000);

	it("分支点重复使用同一楼层时校验失败", async () => {
		const dir = copyBenchmark();
		editFile(dir, "branch-points.jsonl", (text) => {
			const points = text
				.trimEnd()
				.split("\n")
				.map((line) => JSON.parse(line));
			points[1].nodeId = points[0].nodeId;
			return `${points.map((point) => JSON.stringify(point)).join("\n")}\n`;
		});
		await expect(
			validateBenchmarkStructure(dir, {
				scratchDir: makeDir(".tmp-benchmark-scratch-"),
			}),
		).rejects.toThrow("同一楼层");
	}, 120_000);

	it("出现私有路径标记时校验失败", async () => {
		const dir = copyBenchmark();
		const marker = ["eval", "private"].join("-");
		editFile(dir, "branch-points.jsonl", (text) =>
			text.replace(
				'"nextUserText":"我把潮汐钟的指针拨回标准时间，看看会发生什么。"',
				`"nextUserText":"我把潮汐钟的指针拨回标准时间，看看 ${marker} 里的记录。"`,
			),
		);
		await expect(
			validateBenchmarkStructure(dir, {
				scratchDir: makeDir(".tmp-benchmark-scratch-"),
			}),
		).rejects.toThrow("私有评测目录");
	}, 60_000);

	it("导入基准故事后可以跑试玩", async () => {
		const dir = makeDir(".tmp-benchmark-play-");
		const store = StoryStore.open(path.join(dir, "benchmark.db"));
		try {
			const imported = await importBenchmark(store, {
				rootDir: benchmarkDir,
				storyIds: [STORY_ID],
			});
			expect(imported.stories).toEqual([
				{ storyId: STORY_ID, title: "雾港灯塔", nodeCount: 480 },
			]);
			const settings = store.getStorySettings(STORY_ID);
			expect(settings.characterPrompt).not.toBeNull();
			expect(settings.templateId).not.toBeNull();
			const templateRecord = store.getContextTemplate(
				settings.templateId ?? "",
			);
			expect(templateRecord).not.toBeNull();

			const assistant = createAssistant(
				"雾里传来一短一长的汽笛。我合上记录簿。",
			);
			const user = createUser();
			const records = await runPlaytest({
				store,
				storyId: STORY_ID,
				rounds: 2,
				profile: "native",
				seed: 1,
				assistant: { client: assistant.client, model: "main" },
				user: { client: user.client, model: "background" },
				turn: {
					template:
						templateRecord?.template ??
						createDefaultContextTemplate({
							structuredOutput: "text-tags",
						}),
					providers: (
						await createStandardChatSlots({
							store,
							characterPrompt: settings.characterPrompt ?? "",
							directorConfig: DEFAULT_DIRECTOR_CONFIG,
						})
					).providers,
					budgetTokens: 4_000,
					structuredOutput: "text-tags",
					toolTransport: "native",
					maxTokens: 512,
					temperature: 0.8,
					reasoning: "low",
				},
				onRecord: () => undefined,
			});
			expect(records.failures).toBe(0);
			expect(records.records).toHaveLength(2);
			expect(store.getPathToHead(STORY_ID)).toHaveLength(484);
		} finally {
			store.close();
		}
	}, 120_000);

	it("命令行可以生成并校验一份独立基准", async () => {
		const dir = makeDir(".tmp-benchmark-cli-");
		const scratch = makeDir(".tmp-benchmark-scratch-");
		const generated = await runBenchmarkCli(["--generate", "--root", dir], {
			log: () => undefined,
		});
		expect(generated.action).toBe("generate");
		const validated = await runBenchmarkCli(
			["--validate", "--root", dir, "--scratch", scratch],
			{ log: () => undefined },
		);
		expect(validated.validation?.messages).toBe(1440);
		await expect(
			runBenchmarkCli(["--unknown"], { log: () => undefined }),
		).rejects.toThrow("未知参数");
	}, 120_000);

	it("分支点按故事与深度解析", () => {
		const points = parseBranchPoints(
			readFileSync(path.join(benchmarkDir, "branch-points.jsonl"), "utf8"),
		);
		const mist = points.filter((point) => point.story === STORY_ID);
		expect(mist).toHaveLength(3);
		expect(mist.map((point) => point.nodeId)).toContain(
			"benchmark-mist-harbor:m298:s0",
		);
	});
});

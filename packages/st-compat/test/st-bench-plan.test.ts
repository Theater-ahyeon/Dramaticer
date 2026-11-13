import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { runStBenchCli } from "../src/st-bench/cli.js";
import {
	RUN_MANIFEST_FILE,
	type SandboxCombination,
	type SandboxRunEntry,
	appendSandboxRunEntry,
	assertBatchName,
	discoverSandboxInputs,
	findSandboxRunEntryBySeq,
	latestSandboxRunEntries,
	planSandboxCombinations,
	readSandboxRunManifest,
	writeSandboxPlan,
} from "../src/st-bench/plan.js";
import { stBenchPaths } from "../src/st-bench/sandbox.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(TEST_DIR, ".tmp-st-plan-"));
	onTestFinished(async () => {
		await rm(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	});
	return dir;
}

interface SandboxFixture {
	readonly repoRoot: string;
	readonly privateRoot: string;
	readonly sandboxDir: string;
	readonly dataRoot: string;
}

async function createSandboxFixture(): Promise<SandboxFixture> {
	const repoRoot = await makeTempDir();
	const paths = stBenchPaths(repoRoot);
	const sandboxDir = path.join(paths.sandboxDir, "st");
	const dataRoot = path.join(sandboxDir, "data", "default-user");
	await mkdir(path.join(dataRoot, "OpenAI Settings"), { recursive: true });
	await mkdir(path.join(dataRoot, "characters", "card-a"), { recursive: true });
	await mkdir(path.join(dataRoot, "chats", "alice"), { recursive: true });
	await mkdir(path.join(dataRoot, "chats", "bob"), { recursive: true });

	await writeFile(path.join(dataRoot, "OpenAI Settings", "Beta.json"), "{}\n");
	await writeFile(path.join(dataRoot, "OpenAI Settings", "Alpha.json"), "{}\n");
	await writeFile(path.join(dataRoot, "OpenAI Settings", "Gamma.json"), "{}\n");
	await writeFile(path.join(dataRoot, "OpenAI Settings", "notes.txt"), "x\n");

	await writeFile(path.join(dataRoot, "characters", "card-a.png"), "png\n");
	await writeFile(path.join(dataRoot, "characters", "card-b.json"), "{}\n");
	await writeFile(path.join(dataRoot, "characters", "notes.txt"), "x\n");
	await writeFile(
		path.join(dataRoot, "characters", "card-a", "portrait.png"),
		"png\n",
	);

	const metadata = JSON.stringify({
		chat_metadata: { integrity: "fixture" },
		user_name: "user",
		character_name: "card-a",
	});
	await writeFile(
		path.join(dataRoot, "chats", "alice", "chat-one.jsonl"),
		[
			metadata,
			JSON.stringify({ name: "user", is_user: true, mes: "hi" }),
			JSON.stringify({ name: "card-a", is_user: false, mes: "hello" }),
			JSON.stringify({ name: "user", is_user: true, mes: "again" }),
			"",
		].join("\n"),
	);
	await writeFile(
		path.join(dataRoot, "chats", "bob", "chat-two.jsonl"),
		`${JSON.stringify({ name: "card-b", is_user: false, mes: "one" })}\n${JSON.stringify({ name: "user", is_user: true, mes: "two" })}`,
	);
	await writeFile(
		path.join(dataRoot, "chats", "bob", "chat metadata.json"),
		"{}\n",
	);
	await writeFile(
		path.join(dataRoot, "chats", "bob", "chat-two.jsonl.bak"),
		"x\n",
	);
	await writeFile(
		path.join(dataRoot, "chats", "bob", `bench-${"b".repeat(32)}.jsonl`),
		`${JSON.stringify({ name: "card-b", is_user: false, mes: "copy" })}\n`,
	);

	return {
		repoRoot,
		privateRoot: paths.privateRoot,
		sandboxDir,
		dataRoot,
	};
}

function runEntry(
	combination: SandboxCombination,
	status: SandboxRunEntry["status"],
	overrides: Partial<SandboxRunEntry> = {},
): SandboxRunEntry {
	return {
		...combination,
		seqStart: null,
		seqEnd: null,
		startedAt: null,
		finishedAt: null,
		status,
		...overrides,
	};
}

describe("沙箱输入发现", () => {
	it("读出预设、角色卡与聊天片段，并忽略目录、附属文件与驱动副本", async () => {
		const fixture = await createSandboxFixture();
		const inputs = await discoverSandboxInputs({ dataRoot: fixture.dataRoot });

		expect(inputs.presets).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(inputs.characters).toEqual(["card-a", "card-b"]);
		expect(inputs.chats).toEqual([
			{ id: "alice/chat-one.jsonl", floor: 3 },
			{ id: "bob/chat-two.jsonl", floor: 2 },
		]);
	});

	it("缺少任何一类输入时直接报错", async () => {
		const fixture = await createSandboxFixture();
		await rm(path.join(fixture.dataRoot, "chats"), {
			recursive: true,
			force: true,
		});
		await mkdir(path.join(fixture.dataRoot, "chats"), { recursive: true });
		await expect(
			discoverSandboxInputs({ dataRoot: fixture.dataRoot }),
		).rejects.toThrow("聊天片段");
	});
});

describe("组合计划", () => {
	it("同一份数据得到逐项相同的组合，且每个输入至少出现一次", async () => {
		const fixture = await createSandboxFixture();
		const inputs = await discoverSandboxInputs({ dataRoot: fixture.dataRoot });
		const first = planSandboxCombinations(inputs);
		const second = planSandboxCombinations(
			await discoverSandboxInputs({ dataRoot: fixture.dataRoot }),
		);

		expect(first).toEqual(second);
		expect(first).toHaveLength(3);
		expect(new Set(first.map((item) => item.combinationId)).size).toBe(
			first.length,
		);
		expect(new Set(first.map((item) => item.preset))).toEqual(
			new Set(inputs.presets),
		);
		expect(new Set(first.map((item) => item.character))).toEqual(
			new Set(inputs.characters),
		);
		expect(new Set(first.map((item) => item.chat))).toEqual(
			new Set(inputs.chats.map((chat) => chat.id)),
		);
		expect(first[0]).toMatchObject({
			preset: "Alpha",
			character: "card-a",
			chat: "alice/chat-one.jsonl",
			floor: 3,
		});
	});

	it("上限只截取计划前缀，非法上限直接报错", async () => {
		const fixture = await createSandboxFixture();
		const inputs = await discoverSandboxInputs({ dataRoot: fixture.dataRoot });
		const full = planSandboxCombinations(inputs);
		const limited = planSandboxCombinations(inputs, { limit: 2 });

		expect(limited).toEqual(full.slice(0, 2));
		expect(() => planSandboxCombinations(inputs, { limit: 0 })).toThrow(
			"正整数",
		);
	});
});

describe("run 清单与断点续跑", () => {
	it("首次写入全部为 pending，再次运行不新增行", async () => {
		const fixture = await createSandboxFixture();
		const inputs = await discoverSandboxInputs({ dataRoot: fixture.dataRoot });
		const combinations = planSandboxCombinations(inputs);
		const batchDir = path.join(
			stBenchPaths(fixture.repoRoot).sandboxDir,
			"runs",
			"batch-1",
		);

		const first = await writeSandboxPlan({
			batchDir,
			privateRoot: fixture.privateRoot,
			combinations,
		});
		expect(first).toEqual({
			total: 3,
			created: 3,
			completed: 0,
			pending: 0,
			retried: 0,
		});
		const entries = await readSandboxRunManifest(batchDir);
		expect(entries.map((entry) => entry.status)).toEqual([
			"pending",
			"pending",
			"pending",
		]);
		expect(entries.map((entry) => entry.seqStart)).toEqual([null, null, null]);

		const second = await writeSandboxPlan({
			batchDir,
			privateRoot: fixture.privateRoot,
			combinations,
		});
		expect(second).toEqual({
			total: 3,
			created: 0,
			completed: 0,
			pending: 3,
			retried: 0,
		});
		expect(
			(await readFile(path.join(batchDir, RUN_MANIFEST_FILE), "utf8"))
				.split("\n")
				.filter((line) => line.trim() !== ""),
		).toHaveLength(3);
	});

	it("完成过的组合跳过，中断与失败的组合补一条 pending 重试", async () => {
		const fixture = await createSandboxFixture();
		const inputs = await discoverSandboxInputs({ dataRoot: fixture.dataRoot });
		const combinations = planSandboxCombinations(inputs);
		const batchDir = path.join(
			stBenchPaths(fixture.repoRoot).sandboxDir,
			"runs",
			"batch-2",
		);
		const privateRoot = fixture.privateRoot;
		await writeSandboxPlan({ batchDir, privateRoot, combinations });
		const [first, second, third] = combinations;
		if (first === undefined || second === undefined || third === undefined) {
			throw new Error("fixture 组合数量不足");
		}

		await appendSandboxRunEntry({
			batchDir,
			privateRoot,
			entry: runEntry(first, "running", {
				startedAt: "2026-11-12T00:00:00.000Z",
			}),
		});
		await appendSandboxRunEntry({
			batchDir,
			privateRoot,
			entry: runEntry(first, "completed", {
				startedAt: "2026-11-12T00:00:00.000Z",
				finishedAt: "2026-11-12T00:00:01.000Z",
				seqStart: 0,
				seqEnd: 1,
			}),
		});
		await appendSandboxRunEntry({
			batchDir,
			privateRoot,
			entry: runEntry(second, "failed", {
				startedAt: "2026-11-12T00:00:02.000Z",
				finishedAt: "2026-11-12T00:00:03.000Z",
				reason: "首页没有就绪",
			}),
		});

		const resumed = await writeSandboxPlan({
			batchDir,
			privateRoot,
			combinations,
		});
		expect(resumed).toEqual({
			total: 3,
			created: 0,
			completed: 1,
			pending: 1,
			retried: 1,
		});
		const latest = latestSandboxRunEntries(
			await readSandboxRunManifest(batchDir),
		);
		expect(latest.get(first.combinationId)?.status).toBe("completed");
		const retriedEntry = latest.get(second.combinationId);
		expect(retriedEntry).toMatchObject({
			status: "pending",
			seqStart: null,
		});
		expect(retriedEntry).not.toHaveProperty("reason");
		expect(latest.get(third.combinationId)?.status).toBe("pending");
	});

	it("录制序号范围能对应回组合", async () => {
		const fixture = await createSandboxFixture();
		const inputs = await discoverSandboxInputs({ dataRoot: fixture.dataRoot });
		const combinations = planSandboxCombinations(inputs);
		const batchDir = path.join(
			stBenchPaths(fixture.repoRoot).sandboxDir,
			"runs",
			"batch-3",
		);
		const privateRoot = fixture.privateRoot;
		await writeSandboxPlan({ batchDir, privateRoot, combinations });
		const [first, second] = combinations;
		if (first === undefined || second === undefined) {
			throw new Error("fixture 组合数量不足");
		}
		for (const [combination, seqStart, seqEnd] of [
			[first, 0, 1],
			[second, 2, 2],
		] as const) {
			await appendSandboxRunEntry({
				batchDir,
				privateRoot,
				entry: runEntry(combination, "completed", {
					startedAt: "2026-11-12T00:00:00.000Z",
					finishedAt: "2026-11-12T00:00:01.000Z",
					seqStart,
					seqEnd,
				}),
			});
		}

		const entries = await readSandboxRunManifest(batchDir);
		expect(findSandboxRunEntryBySeq(entries, 0)?.combinationId).toBe(
			first.combinationId,
		);
		expect(findSandboxRunEntryBySeq(entries, 1)?.combinationId).toBe(
			first.combinationId,
		);
		expect(findSandboxRunEntryBySeq(entries, 2)?.combinationId).toBe(
			second.combinationId,
		);
		expect(findSandboxRunEntryBySeq(entries, 3)).toBeNull();
		expect(() => findSandboxRunEntryBySeq(entries, -1)).toThrow("非负整数");
	});

	it("批次目录必须在私有根目录内部，批次名不能带路径", async () => {
		const fixture = await createSandboxFixture();
		const inputs = await discoverSandboxInputs({ dataRoot: fixture.dataRoot });
		const combinations = planSandboxCombinations(inputs);
		const outside = path.join(fixture.repoRoot, "outside");

		await expect(
			writeSandboxPlan({
				batchDir: outside,
				privateRoot: fixture.privateRoot,
				combinations,
			}),
		).rejects.toThrow("私有根目录");
		expect(() => assertBatchName("../escape")).toThrow("批次名");
		expect(() => assertBatchName("..")).toThrow("批次名");
		expect(assertBatchName("batch.1")).toBe("batch.1");
	});

	it("清单里的非法行直接报错", async () => {
		const fixture = await createSandboxFixture();
		const batchDir = path.join(
			stBenchPaths(fixture.repoRoot).sandboxDir,
			"runs",
			"batch-4",
		);
		await mkdir(batchDir, { recursive: true });
		await writeFile(path.join(batchDir, RUN_MANIFEST_FILE), "{not json}\n");

		await expect(readSandboxRunManifest(batchDir)).rejects.toThrow(
			"不是合法 JSON",
		);
	});
});

describe("st-bench plan", () => {
	it("写出清单并只打印统计数字", async () => {
		const fixture = await createSandboxFixture();
		const logs: string[] = [];
		const options = {
			repoRoot: fixture.repoRoot,
			log: (message: string) => logs.push(message),
		};

		await runStBenchCli(
			["plan", "--sandbox", fixture.sandboxDir, "--batch", "cli-batch"],
			options,
		);
		const output = logs.join("\n");
		expect(output).toContain("预设 3 个");
		expect(output).toContain("角色卡 2 个");
		expect(output).toContain("聊天片段 2 个");
		expect(output).toContain("组合 3 个：新建 3");
		expect(output).not.toContain("Alpha");
		expect(output).not.toContain("chat-one");

		const batchDir = path.join(
			stBenchPaths(fixture.repoRoot).sandboxDir,
			"runs",
			"cli-batch",
		);
		expect(await readSandboxRunManifest(batchDir)).toHaveLength(3);

		logs.length = 0;
		await runStBenchCli(
			["plan", "--sandbox", fixture.sandboxDir, "--batch", "cli-batch"],
			options,
		);
		expect(logs.join("\n")).toContain("已完成 0，待跑 3");
	});

	it("拒绝私有根目录外的沙箱", async () => {
		const fixture = await createSandboxFixture();
		const outside = path.join(fixture.repoRoot, "outside-st");
		await mkdir(outside, { recursive: true });

		await expect(
			runStBenchCli(["plan", "--sandbox", outside, "--batch", "cli-batch"], {
				repoRoot: fixture.repoRoot,
				log: () => {},
			}),
		).rejects.toThrow("私有根目录");
	});
});

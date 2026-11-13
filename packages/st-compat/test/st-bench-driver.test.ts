import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	driveSandboxBatch,
	prepareSandboxChat,
	sanitizeSandboxPresets,
} from "../src/st-bench/driver.js";
import {
	type SandboxCombination,
	appendSandboxRunEntry,
	discoverSandboxInputs,
	planSandboxCombinations,
	writeSandboxPlan,
} from "../src/st-bench/plan.js";
import { stBenchPaths } from "../src/st-bench/sandbox.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(TEST_DIR, ".tmp-st-driver-"));
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
	await mkdir(path.join(dataRoot, "characters"), { recursive: true });
	await mkdir(path.join(dataRoot, "chats", "alice"), { recursive: true });
	await writeFile(path.join(dataRoot, "OpenAI Settings", "Alpha.json"), "{}\n");
	await writeFile(path.join(dataRoot, "characters", "card-a.png"), "png\n");
	await writeFile(path.join(dataRoot, "characters", "card-b.png"), "png\n");
	await writeFile(
		path.join(dataRoot, "chats", "alice", "chat-one.jsonl"),
		`${JSON.stringify({ chat_metadata: {} })}\n${JSON.stringify({ name: "user", is_user: true, mes: "hi" })}\n`,
	);
	return { repoRoot, privateRoot: paths.privateRoot, sandboxDir, dataRoot };
}

function combination(
	overrides: Partial<SandboxCombination> = {},
): SandboxCombination {
	return {
		combinationId: "a".repeat(32),
		preset: "Alpha",
		character: "card-a",
		chat: "alice/chat-one.jsonl",
		floor: 1,
		...overrides,
	};
}

describe("沙箱片段准备", () => {
	it("把片段复制到角色卡自己的对话目录，原片段不变", async () => {
		const { dataRoot } = await createSandboxFixture();
		const prepared = await prepareSandboxChat({
			dataRoot,
			combination: combination(),
		});

		expect(prepared.chatName).toBe(`bench-${"a".repeat(32)}`);
		expect(prepared.file).toBe(
			path.join(dataRoot, "chats", "card-a", `bench-${"a".repeat(32)}.jsonl`),
		);
		expect(await readFile(prepared.file, "utf8")).toBe(
			await readFile(
				path.join(dataRoot, "chats", "alice", "chat-one.jsonl"),
				"utf8",
			),
		);
	});

	it("拒绝越界片段路径与带分隔符的角色卡名", async () => {
		const { dataRoot } = await createSandboxFixture();
		for (const chat of [
			"../outside.jsonl",
			"alice/../../outside.jsonl",
			path.join(dataRoot, "chats", "alice", "chat-one.jsonl"),
			"",
		]) {
			await expect(
				prepareSandboxChat({ dataRoot, combination: combination({ chat }) }),
			).rejects.toThrow(/聊天片段路径不合法|不在沙箱 chats 目录/);
		}
		for (const character of ["cards/card-a", "cards\\card-a", ""]) {
			await expect(
				prepareSandboxChat({
					dataRoot,
					combination: combination({ character }),
				}),
			).rejects.toThrow(/角色卡文件名不合法/);
		}
	});
});

describe("预设连接字段", () => {
	it("端点、代理与凭据改写成录制服务，提示词与生成参数保持原样", async () => {
		const { dataRoot } = await createSandboxFixture();
		const presetFile = path.join(dataRoot, "OpenAI Settings", "Remote.json");
		const promptOrder = [
			{
				character_id: 100000,
				order: [{ identifier: "chatHistory", enabled: true }],
			},
		];
		await writeFile(
			presetFile,
			JSON.stringify({
				chat_completion_source: "openai",
				custom_url: "https://example.com/v1",
				custom_model: "real-model",
				reverse_proxy: "https://example.org/proxy",
				proxy_password: "secret-value",
				custom_include_headers: '{"Authorization":"Bearer secret"}',
				prompt_order: promptOrder,
				temperature: 0.7,
			}),
		);

		const result = await sanitizeSandboxPresets({
			dataRoot,
			endpointUrl: "http://127.0.0.1:8130/v1",
			stubModel: "stub-model",
		});

		expect(result).toEqual({ total: 2, changed: 2 });
		const preset = JSON.parse(await readFile(presetFile, "utf8")) as Record<
			string,
			unknown
		>;
		expect(preset.chat_completion_source).toBe("custom");
		expect(preset.custom_url).toBe("http://127.0.0.1:8130/v1");
		expect(preset.custom_model).toBe("stub-model");
		expect(preset.reverse_proxy).toBe("");
		expect(preset.proxy_password).toBe("");
		expect(preset.custom_include_headers).toBe("");
		expect(preset.prompt_order).toEqual(promptOrder);
		expect(preset.temperature).toBe(0.7);
		const text = await readFile(presetFile, "utf8");
		expect(text).not.toContain("example.com");
		expect(text).not.toContain("secret-value");
	});

	it("拒绝不是 JSON 对象的预设", async () => {
		const { dataRoot } = await createSandboxFixture();
		await writeFile(
			path.join(dataRoot, "OpenAI Settings", "Broken.json"),
			"[]\n",
		);

		await expect(
			sanitizeSandboxPresets({
				dataRoot,
				endpointUrl: "http://127.0.0.1:8130/v1",
				stubModel: "stub-model",
			}),
		).rejects.toThrow(/不是 JSON 对象/);
	});
});

describe("沙箱驱动", () => {
	it("已完成组合全部跳过，不再启动录制与沙箱 ST", async () => {
		const { privateRoot, sandboxDir, dataRoot } = await createSandboxFixture();
		const inputs = await discoverSandboxInputs({ dataRoot });
		const combinations = planSandboxCombinations(inputs);
		const batchDir = path.join(privateRoot, "st-sandbox", "runs", "skip-test");
		await writeSandboxPlan({ batchDir, privateRoot, combinations });
		for (const item of combinations) {
			await appendSandboxRunEntry({
				batchDir,
				privateRoot,
				entry: {
					...item,
					seqStart: 0,
					seqEnd: 0,
					startedAt: "2026-11-12T00:00:00.000Z",
					finishedAt: "2026-11-12T00:00:01.000Z",
					status: "completed",
				},
			});
		}

		const messages: string[] = [];
		const result = await driveSandboxBatch({
			sandboxDir,
			privateRoot,
			batchDir,
			log: (message) => messages.push(message),
		});

		expect(result.total).toBe(combinations.length);
		expect(result.completed).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.skipped).toBe(combinations.length);
		expect(messages.join("\n")).toContain("已完成");
	});

	it("拒绝私有根目录之外的沙箱与批次目录", async () => {
		const { privateRoot, sandboxDir } = await createSandboxFixture();
		const root = await makeTempDir();
		await expect(
			driveSandboxBatch({
				sandboxDir: path.join(root, "outside"),
				privateRoot,
				batchDir: path.join(privateRoot, "st-sandbox", "runs", "x"),
			}),
		).rejects.toThrow(/沙箱目录必须在私有根目录/);
		await expect(
			driveSandboxBatch({
				sandboxDir,
				privateRoot,
				batchDir: path.join(root, "outside-batch"),
			}),
		).rejects.toThrow(/批次目录必须在私有根目录/);
	});
});

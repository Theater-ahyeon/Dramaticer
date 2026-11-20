import { describe, expect, it } from "vitest";
import {
	LlmAllChannelsFailedError,
	type LlmRequest,
	type LlmResult,
	type LlmStreamingClient,
	type StoryStore,
	createEventStream,
	createFallbackClient,
	parseChannelsConfig,
	readBackgroundHealth,
	readChannelWarnings,
	summarizeBackgroundError,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

// refactor/03：后台岗位的保底、配置警告与失败可见。全部离线，不发请求。

function result(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		stopReason: "stop",
		usage: { inputTokens: 1, outputTokens: 1 },
	} as unknown as LlmResult;
}

const exhausted = () =>
	new LlmAllChannelsFailedError("deepseek/v4", [
		{ channel: "bg", error: new Error("402 insufficient_balance") },
	]);

function fakeClient(
	name: string,
	behaviour: "ok" | "exhausted" | "bad",
	calls: { name: string; model: string | undefined }[],
): LlmStreamingClient {
	const run = async (request: LlmRequest): Promise<LlmResult> => {
		calls.push({ name, model: request.model });
		if (behaviour === "exhausted") throw exhausted();
		if (behaviour === "bad") throw new Error("请求参数错误");
		return result(`${name} 写的`);
	};
	return {
		complete: run,
		stream: (request) =>
			createEventStream(async (emit) => {
				const done = await run(request);
				emit({ type: "text", text: done.text } as never);
				return done;
			}),
	};
}

const request: LlmRequest = {
	model: "background",
	messages: [{ role: "user", content: "结算这一楼" }],
} as LlmRequest;

describe("后台保底客户端", () => {
	it("主模型所有渠道都失败时改用保底，并去掉点名的主模型别名", async () => {
		const calls: { name: string; model: string | undefined }[] = [];
		const fallen: string[] = [];
		const client = createFallbackClient({
			primary: fakeClient("主", "exhausted", calls),
			fallback: fakeClient("保底", "ok", calls),
			onFallback: (error) => fallen.push(error.message),
		});
		const done = await client.complete(request);
		expect(done.text).toBe("保底 写的");
		expect(calls).toEqual([
			{ name: "主", model: "background" },
			{ name: "保底", model: undefined },
		]);
		expect(fallen[0]).toContain("402");
	});

	it("主模型正常时不碰保底；其它错误照常抛出", async () => {
		const calls: { name: string; model: string | undefined }[] = [];
		const ok = createFallbackClient({
			primary: fakeClient("主", "ok", calls),
			fallback: fakeClient("保底", "ok", calls),
		});
		expect((await ok.complete(request)).text).toBe("主 写的");
		const bad = createFallbackClient({
			primary: fakeClient("主", "bad", calls),
			fallback: fakeClient("保底", "ok", calls),
		});
		await expect(bad.complete(request)).rejects.toThrow("请求参数错误");
		expect(calls.map((call) => call.name)).toEqual(["主", "主"]);
	});

	it("流式请求还没推送内容时也会切到保底", async () => {
		const calls: { name: string; model: string | undefined }[] = [];
		const client = createFallbackClient({
			primary: fakeClient("主", "exhausted", calls),
			fallback: fakeClient("保底", "ok", calls),
		});
		const stream = client.stream(request);
		const texts: string[] = [];
		for await (const event of stream) {
			texts.push((event as { text?: string }).text ?? "");
		}
		expect(texts).toEqual(["保底 写的"]);
		expect((await stream.result()).text).toBe("保底 写的");
	});
});

const yaml = (backgroundExtra: string, fallbackChannel: string) => `
channels:
  bg:
    api: openai-completions
    baseUrl: http://127.0.0.1:9/bg
    apiKey: \${FAKE_KEY}
  other:
    api: openai-completions
    baseUrl: http://127.0.0.1:9/other
    apiKey: \${FAKE_KEY}
models:
  main:
    id: writer-x
    channels: [bg]
  background:
    id: deepseek/v4
    channels: [bg]
${backgroundExtra}
  bg-fallback:
    id: qwen/q3
    channels: [${fallbackChannel}]
roles:
  writer: main
  judge: bg-fallback
`;

describe("渠道配置警告", () => {
	it("保底和主模型共用渠道时提醒", () => {
		const config = parseChannelsConfig(
			yaml("    fallback: bg-fallback", "bg"),
			{ FAKE_KEY: "test" },
		);
		const warnings = readChannelWarnings(config);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("共用渠道 bg");
	});

	it("保底走另一家时没有警告", () => {
		const config = parseChannelsConfig(
			yaml("    fallback: bg-fallback", "other"),
			{ FAKE_KEY: "test" },
		);
		expect(readChannelWarnings(config)).toEqual([]);
	});

	it("后台模型没有保底时提醒", () => {
		const config = parseChannelsConfig(yaml("", "other"), { FAKE_KEY: "test" });
		const warnings = readChannelWarnings(config);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("后台模型 background 没有配置保底");
	});

	it("fallback 指向不存在的模型或自己时启动失败", () => {
		expect(() =>
			parseChannelsConfig(yaml("    fallback: nope", "other"), {
				FAKE_KEY: "test",
			}),
		).toThrow("引用了不存在的模型 nope");
		expect(() =>
			parseChannelsConfig(yaml("    fallback: background", "other"), {
				FAKE_KEY: "test",
			}),
		).toThrow("不能指向自己");
	});
});

function failJob(store: StoryStore, kind: string, error: string): void {
	const [job] = store.enqueueStoryBackgroundJobs({
		storyId: "s1",
		kinds: [kind],
	});
	if (job === undefined) throw new Error("任务没有入队");
	store.startBackgroundJob(job.id);
	store.failBackgroundJob(job.id, { error, maxAttempts: 1 });
}

function passJob(store: StoryStore, kind: string): void {
	const [job] = store.enqueueStoryBackgroundJobs({
		storyId: "s1",
		kinds: [kind],
	});
	if (job === undefined) throw new Error("任务没有入队");
	store.startBackgroundJob(job.id);
	store.finishBackgroundJob(job.id);
}

const channelError =
	"模型 deepseek/v4 的所有渠道都失败了：bg：402 insufficient_balance coding_plan_exhausted";

describe("后台是否暂停", () => {
	it("连续三条渠道失败就暂停，带模型、渠道与错误摘要；成功一条就恢复", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		expect(readBackgroundHealth(store, "s1").paused).toBe(false);

		failJob(store, "a", channelError);
		await new Promise((resolve) => setTimeout(resolve, 5));
		failJob(store, "b", channelError);
		expect(readBackgroundHealth(store, "s1")).toMatchObject({
			paused: false,
			failures: 2,
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		failJob(store, "c", channelError);
		const paused = readBackgroundHealth(store, "s1");
		expect(paused).toMatchObject({
			paused: true,
			failures: 3,
			kind: "c",
			model: "deepseek/v4",
			channel: "bg",
		});
		expect(paused.error).toContain("402");

		await new Promise((resolve) => setTimeout(resolve, 5));
		passJob(store, "d");
		expect(readBackgroundHealth(store, "s1").paused).toBe(false);
	});

	it("不是渠道失败的错误不算暂停", async () => {
		const { store } = openTempStore();
		store.createStory({ id: "s1", title: "测试" });
		for (const kind of ["a", "b", "c"]) {
			failJob(store, kind, "解析 JSON 失败");
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(readBackgroundHealth(store, "s1").paused).toBe(false);
	});

	it("错误摘要截短并去掉像密钥的长串", () => {
		const summary = summarizeBackgroundError(
			`401 bad key sk-abcdefghijklmnopqrstuvwxyz0123 ${"很长".repeat(100)}`,
		);
		expect(summary).not.toContain("sk-abcdef");
		expect(summary.length).toBeLessThanOrEqual(121);
	});
});

import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "../src/api/client";

interface FetchCall {
	readonly url: string;
	readonly init: RequestInit;
}

function clientFor(response: () => Response): {
	client: ApiClient;
	calls: FetchCall[];
} {
	const calls: FetchCall[] = [];
	const client = new ApiClient({
		fetch: async (url, init) => {
			calls.push({ url, init });
			return response();
		},
	});
	return { client, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function sseResponse(text: string): Response {
	return new Response(text, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

function readBody(init: RequestInit): unknown {
	if (typeof init.body !== "string") {
		throw new Error("请求体不是字符串");
	}
	return JSON.parse(init.body) as unknown;
}

describe("ApiClient", () => {
	it("登录使用 cookie 凭据与 JSON 请求体", async () => {
		const { client, calls } = clientFor(
			() => new Response(null, { status: 204 }),
		);
		await client.login("secret");
		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (call === undefined) throw new Error("缺少请求");
		expect(call.url).toBe("/api/login");
		expect(call.init.method).toBe("POST");
		expect(call.init.credentials).toBe("include");
		expect(readBody(call.init)).toEqual({ password: "secret" });
	});

	it("路径接口按参数拼查询串并对 id 编码", async () => {
		const { client, calls } = clientFor(() =>
			jsonResponse({
				storyId: "s 1",
				headNodeId: "n2",
				nodes: [],
				hasMore: false,
			}),
		);
		await client.getPath("s 1", { nodeId: "n2", limit: 60, before: "n0" });
		const call = calls[0];
		if (call === undefined) throw new Error("缺少请求");
		expect(call.url).toBe(
			"/api/stories/s%201/path?nodeId=n2&limit=60&before=n0",
		);
	});

	it("变更卡动作对 id 编码并使用 POST", async () => {
		const { client, calls } = clientFor(() => jsonResponse({}));
		await client.decideProposal("card/1", "rollback");
		const call = calls[0];
		if (call === undefined) throw new Error("缺少请求");
		expect(call.url).toBe("/api/proposals/card%2F1/rollback");
		expect(call.init.method).toBe("POST");
	});

	it("服务端错误转成 ApiError 并保留字段路径", async () => {
		const { client } = clientFor(() =>
			jsonResponse(
				{
					error: {
						code: "bad_request",
						message: "limit 必须在 1 到 200 之间",
						details: { path: "limit" },
					},
				},
				400,
			),
		);
		const error = await client.listStories().catch((value: unknown) => value);
		if (!(error instanceof ApiError)) throw new Error("没有抛出 ApiError");
		expect(error.status).toBe(400);
		expect(error.body.code).toBe("bad_request");
		expect(error.body.details).toEqual({ path: "limit" });
	});

	it("非 JSON 错误响应保留状态码", async () => {
		const { client } = clientFor(() => new Response("oops", { status: 500 }));
		await expect(client.listStories()).rejects.toMatchObject({
			status: 500,
			message: "请求失败（HTTP 500）",
		});
	});

	it("回合流解析事件、带上 mode 与 intensity 和 signal", async () => {
		const { client, calls } = clientFor(() =>
			sseResponse(
				'event: text.delta\ndata: {"delta":"甲"}\n\n' +
					'event: turn.completed\ndata: {"storyId":"s1"}\n\n',
			),
		);
		const controller = new AbortController();
		const events = [];
		for await (const event of client.streamTurn(
			"s1",
			{ text: "继续", mode: "fast", intensity: "natural" },
			controller.signal,
		)) {
			events.push(event);
		}
		expect(events.map((event) => event.event)).toEqual([
			"text.delta",
			"turn.completed",
		]);
		const call = calls[0];
		if (call === undefined) throw new Error("缺少请求");
		expect(call.url).toBe("/api/stories/s1/turns");
		expect(call.init.signal).toBe(controller.signal);
		expect(readBody(call.init)).toEqual({
			text: "继续",
			mode: "fast",
			intensity: "natural",
		});
	});

	it("turn.error 事件抛 ApiError", async () => {
		const { client } = clientFor(() =>
			sseResponse(
				'event: text.delta\ndata: {"delta":"甲"}\n\n' +
					'event: turn.error\ndata: {"code":"unauthorized","message":"需要先登录"}\n\n',
			),
		);
		const iterator = client.streamTurn("s1", { text: "继续" });
		const first = await iterator.next();
		if (first.done === true) throw new Error("流提前结束");
		expect(first.value.event).toBe("text.delta");
		const error = await iterator.next().catch((value: unknown) => value);
		if (!(error instanceof ApiError)) throw new Error("没有抛出 ApiError");
		expect(error.body).toEqual({
			code: "unauthorized",
			message: "需要先登录",
		});
	});

	it("重新生成不发请求体", async () => {
		const { client, calls } = clientFor(() =>
			sseResponse(
				'event: turn.started\ndata: {"storyId":"s1","userNodeId":"n1"}\n\n',
			),
		);
		const iterator = client.streamRegenerate("n1");
		await iterator.next();
		const call = calls[0];
		if (call === undefined) throw new Error("缺少请求");
		expect(call.url).toBe("/api/nodes/n1/regenerate");
		expect(call.init.body).toBeUndefined();
	});

	it("渠道接口读取、整份更新与体检走固定路径", async () => {
		const { client, calls } = clientFor(() => jsonResponse({}));
		await client.getChannels();
		await client.updateChannels({
			channels: {},
			models: {},
			embeddings: {},
			roles: { writer: "main" },
		});
		await client.probeChannel({ alias: "main" });
		expect(calls.map((call) => [call.init.method, call.url])).toEqual([
			["GET", "/api/channels"],
			["PUT", "/api/channels"],
			["POST", "/api/channels/probe"],
		]);
		const updateCall = calls[1];
		const probeCall = calls[2];
		if (updateCall === undefined || probeCall === undefined) {
			throw new Error("缺少渠道请求");
		}
		expect(readBody(updateCall.init)).toEqual({
			channels: {},
			models: {},
			embeddings: {},
			roles: { writer: "main" },
		});
		expect(readBody(probeCall.init)).toEqual({ alias: "main" });
	});

	it("导入体检读取与逐条调整对来源编码", async () => {
		const { client, calls } = clientFor(() => jsonResponse({}));
		await client.getImportAudit("s 1");
		await client.updateImportAuditEntry("s 1", "world:旧宅:门厅", {
			kind: "common",
		});
		await client.updateImportAuditEntry("s 1", "world:旧宅:门厅", {
			kind: "entity",
			kindSource: "rule",
		});
		expect(calls.map((call) => [call.init.method, call.url])).toEqual([
			["GET", "/api/stories/s%201/import-audit"],
			[
				"PATCH",
				"/api/stories/s%201/import-audit/entries/world%3A%E6%97%A7%E5%AE%85%3A%E9%97%A8%E5%8E%85",
			],
			[
				"PATCH",
				"/api/stories/s%201/import-audit/entries/world%3A%E6%97%A7%E5%AE%85%3A%E9%97%A8%E5%8E%85",
			],
		]);
		const patchCall = calls[1];
		if (patchCall === undefined) throw new Error("缺少调整请求");
		expect(readBody(patchCall.init)).toEqual({ kind: "common" });
		const restoreCall = calls[2];
		if (restoreCall === undefined) throw new Error("缺少恢复请求");
		expect(readBody(restoreCall.init)).toEqual({
			kind: "entity",
			kindSource: "rule",
		});
	});

	it("中止信号按原样向上传递", async () => {
		const controller = new AbortController();
		const client = new ApiClient({
			fetch: (_url, init) => {
				const { promise, reject } = Promise.withResolvers<Response>();
				init.signal?.addEventListener("abort", () => {
					reject(new DOMException("aborted", "AbortError"));
				});
				return promise;
			},
		});
		const iterator = client.streamTurn(
			"s1",
			{ text: "继续" },
			controller.signal,
		);
		const next = iterator.next();
		controller.abort();
		await expect(next).rejects.toMatchObject({ name: "AbortError" });
	});
});

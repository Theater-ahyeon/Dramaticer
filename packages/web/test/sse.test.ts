import { describe, expect, it } from "vitest";
import { type SseEvent, SseParseError, parseSseStream } from "../src/api/sse";

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

async function collect(
	stream: ReadableStream<Uint8Array>,
): Promise<SseEvent[]> {
	const events: SseEvent[] = [];
	for await (const event of parseSseStream(stream)) events.push(event);
	return events;
}

describe("parseSseStream", () => {
	it("跨分块拼接事件名与 JSON", async () => {
		const events = await collect(
			streamOf([
				'event: turn.started\ndata: {"storyId":"s1",',
				'"userNodeId":"n1"}\n\n',
				'event: text.delta\ndata: {"delta":"你好"}\n\n',
			]),
		);
		expect(events).toEqual([
			{
				event: "turn.started",
				data: { storyId: "s1", userNodeId: "n1" },
			},
			{ event: "text.delta", data: { delta: "你好" } },
		]);
	});

	it("一个分块里有多条事件", async () => {
		const events = await collect(
			streamOf([
				'event: text.delta\ndata: {"delta":"甲"}\n\n' +
					'event: thinking.delta\ndata: {"delta":"乙"}\n\n' +
					'event: tool.call\ndata: {"name":"read","ok":true}\n\n',
			]),
		);
		expect(events.map((event) => event.event)).toEqual([
			"text.delta",
			"thinking.delta",
			"tool.call",
		]);
	});

	it("忽略注释、id 与 retry 字段", async () => {
		const events = await collect(
			streamOf([
				": keep-alive\n\n",
				'id: 7\nretry: 100\n: 注释\nevent: text.delta\ndata: {"delta":"a"}\n\n',
			]),
		);
		expect(events).toEqual([{ event: "text.delta", data: { delta: "a" } }]);
	});

	it("多行 data 用换行连接后解析", async () => {
		const events = await collect(
			streamOf(['event: text.delta\ndata: {"delta":\ndata: "换了行"}\n\n']),
		);
		expect(events).toEqual([
			{ event: "text.delta", data: { delta: "换了行" } },
		]);
	});

	it("\\r\\n 落在分块边界时仍是一条事件", async () => {
		const events = await collect(
			streamOf(["event: text.delta\r", '\ndata: {"delta":"x"}\r\n\r\n']),
		);
		expect(events).toEqual([{ event: "text.delta", data: { delta: "x" } }]);
	});

	it("错误事件按原样交给调用方", async () => {
		const events = await collect(
			streamOf([
				'event: turn.error\ndata: {"code":"internal","message":"boom"}\n\n',
			]),
		);
		expect(events).toEqual([
			{ event: "turn.error", data: { code: "internal", message: "boom" } },
		]);
	});

	it("未知事件被忽略", async () => {
		const events = await collect(streamOf(["event: heartbeat\ndata: {}\n\n"]));
		expect(events).toEqual([]);
	});

	it("非法 JSON 抛 SseParseError 并指出事件名", async () => {
		const stream = streamOf(["event: text.delta\ndata: not-json\n\n"]);
		await expect(collect(stream)).rejects.toThrow(SseParseError);
		await expect(
			collect(streamOf(["event: text.delta\ndata: not-json\n\n"])),
		).rejects.toThrow(/text\.delta/);
	});
});

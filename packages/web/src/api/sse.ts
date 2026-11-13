import { SSE_EVENT_NAMES, type SseEvent } from "@dramaticer/protocol";

export type { SseEvent };

const KNOWN_EVENTS: ReadonlySet<string> = new Set(
	Object.values(SSE_EVENT_NAMES),
);

export class SseParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SseParseError";
	}
}

/** 未按事件名收窄的 SSE 事件；调用方自己按白名单解释载荷。 */
export interface RawSseEvent {
	readonly event: string;
	readonly data: unknown;
}

/**
 * 把 fetch 的响应体按 SSE 规范切成事件。分块边界可以在任意位置，
 * 解析器自己保留没读完的一行与没分发完的事件。
 */
export async function* parseSseStream(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
	for await (const event of parseNamedSseStream(stream, KNOWN_EVENTS)) {
		yield event as SseEvent;
	}
}

/** 按给定事件名白名单解析；白名单以外的事件与空 data 直接跳过。 */
export async function* parseNamedSseStream(
	stream: ReadableStream<Uint8Array>,
	knownEvents: ReadonlySet<string>,
): AsyncGenerator<RawSseEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let eventName: string | null = null;
	let dataLines: string[] = [];

	const dispatch = (): RawSseEvent | null => {
		const name = eventName;
		const data = dataLines.join("\n");
		eventName = null;
		dataLines = [];
		if (name === null || data.length === 0) return null;
		if (!knownEvents.has(name)) return null;
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new SseParseError(
				`SSE 事件 ${name} 的数据不是合法 JSON：${reason}`,
			);
		}
		return { event: name, data: parsed };
	};

	const handleLine = (line: string): RawSseEvent | null => {
		if (line.length === 0) return dispatch();
		if (line.startsWith(":")) return null;
		const separator = line.indexOf(":");
		const field = separator < 0 ? line : line.slice(0, separator);
		let value = separator < 0 ? "" : line.slice(separator + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "event") {
			eventName = value;
		} else if (field === "data") {
			dataLines.push(value);
		}
		return null;
	};

	const drainLines = (final: boolean): RawSseEvent[] => {
		const events: RawSseEvent[] = [];
		while (true) {
			let end = -1;
			for (let index = 0; index < buffer.length; index += 1) {
				const char = buffer[index];
				if (char !== "\n" && char !== "\r") continue;
				// 块边界可能落在 "\r\n" 中间，等下一个块再判断。
				if (char === "\r" && index + 1 === buffer.length && !final) {
					end = -2;
					break;
				}
				end = index;
				break;
			}
			if (end === -1) break;
			if (end === -2) break;
			const char = buffer[end];
			const line = buffer.slice(0, end);
			let next = end + 1;
			if (char === "\r" && buffer[end + 1] === "\n") next = end + 2;
			buffer = buffer.slice(next);
			const event = handleLine(line);
			if (event !== null) events.push(event);
		}
		if (final && buffer.length > 0) {
			const line = buffer;
			buffer = "";
			const event = handleLine(line);
			if (event !== null) events.push(event);
		}
		return events;
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			for (const event of drainLines(false)) yield event;
		}
		buffer += decoder.decode();
		for (const event of drainLines(true)) yield event;
	} finally {
		reader.releaseLock();
	}
}

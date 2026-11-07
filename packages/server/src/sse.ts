import type { ServerResponse } from "node:http";
import type { SseEventMap, SseEventName } from "@dramaticer/protocol";

/** 回合进行中每 15 秒发一条注释，防止代理提前断开。 */
export const SSE_HEARTBEAT_MS = 15_000;

export interface SseStream {
	send<N extends SseEventName>(event: N, data: SseEventMap[N]): void;
	comment(text: string): void;
	close(): void;
	readonly closed: boolean;
}

/** 把响应切换成 `text/event-stream`，之后的写入都是一帧事件。 */
export function createSseStream(res: ServerResponse): SseStream {
	res.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});
	res.flushHeaders();
	let closed = false;
	const writable = (): boolean => !closed && !res.writableEnded;
	return {
		get closed(): boolean {
			return !writable();
		},
		send(event, data) {
			if (!writable()) return;
			res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		},
		comment(text) {
			if (!writable()) return;
			res.write(`: ${text}\n\n`);
		},
		close() {
			if (closed) return;
			closed = true;
			if (!res.writableEnded) res.end();
		},
	};
}

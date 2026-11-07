import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StChatEntry, StChatHeader, StChatMessage } from "../src/index.js";
import { parseChatJsonl, parseChatJsonlFile } from "../src/index.js";

const fixturePath = fileURLToPath(
	new URL("./fixtures/chat-sample.jsonl", import.meta.url),
);

async function* chunked(
	text: string,
	sizes: readonly number[],
): AsyncGenerator<string> {
	let offset = 0;
	let sizeIndex = 0;
	while (offset < text.length) {
		const size = sizes[sizeIndex % sizes.length] ?? text.length;
		yield text.slice(offset, offset + size);
		offset += size;
		sizeIndex += 1;
	}
}

async function collect(
	entries: AsyncIterable<StChatEntry>,
): Promise<StChatEntry[]> {
	const result: StChatEntry[] = [];
	for await (const entry of entries) result.push(entry);
	return result;
}

function headerOf(entries: readonly StChatEntry[]): StChatHeader {
	const first = entries[0];
	if (first?.kind !== "header") throw new Error("第一条不是头部");
	return first.header;
}

function messagesOf(entries: readonly StChatEntry[]): StChatMessage[] {
	return entries.flatMap((entry) =>
		entry.kind === "message" ? [entry.message] : [],
	);
}

describe("parseChatJsonl", () => {
	it("解析文件并保留头部原文", async () => {
		const entries = await collect(parseChatJsonlFile(fixturePath));
		const header = headerOf(entries);
		expect(header.characterName).toBe("测试角色");
		expect(header.userName).toBe("测试用户");
		expect(header.chatMetadata).toEqual({
			note_prompt: "备注",
			variables: { hp: 1 },
		});
		expect(header.raw.header_extra).toBe("保留");
		expect(messagesOf(entries)).toHaveLength(3);
	});

	it("解析 swipe、当前正文、推理和 MVU 变量", async () => {
		const [, messageEntry] = await collect(parseChatJsonlFile(fixturePath));
		if (messageEntry?.kind !== "message") throw new Error("第二条不是消息");
		const message = messageEntry.message;
		expect(message.index).toBe(0);
		expect(message.name).toBe("测试角色");
		expect(message.isUser).toBe(false);
		expect(message.isSystem).toBe(false);
		expect(message.sendDate).toBe("2026-01-01T00:00:00.000Z");
		expect(message.swipes.map((swipe) => swipe.text)).toEqual([
			"第一条 swipe",
			"第二条 swipe",
		]);
		expect(message.swipeId).toBe(1);
		expect(message.text).toBe("第二条 swipe 的正文");
		expect(message.variables).toEqual({ stat_data: { hp: 12 } });
		expect(message.swipes[0]?.info).toEqual({
			send_date: "2026-01-01T00:00:01.000Z",
			extra: { reasoning: "第一次推理" },
		});
		expect(message.swipes[1]?.variables).toEqual({ stat_data: { hp: 12 } });
		expect(message.reasoning).toBe("当前推理");
		expect(message.raw.unknown_message_field).toEqual({ keep: true });
	});

	it("缺失字段取默认值，数字时间戳保留", async () => {
		const entries = await collect(parseChatJsonlFile(fixturePath));
		const messages = messagesOf(entries);
		expect(messages[1]).toMatchObject({
			index: 1,
			name: "测试用户",
			isUser: true,
			isSystem: false,
			sendDate: 1767225600,
			text: "用户输入",
			swipes: [],
			swipeId: null,
			reasoning: null,
			variables: {},
		});
		expect(messages[2]).toMatchObject({
			name: "系统",
			isUser: false,
			isSystem: true,
			sendDate: null,
			text: "系统提示",
		});
	});

	it("任意切分的输入与一次性解析结果一致", async () => {
		const text = await readFile(fixturePath, "utf8");
		const whole = await collect(parseChatJsonl([text]));
		const split = await collect(
			parseChatJsonl(chunked(text, [1, 2, 3, 5, 7, 11, 13])),
		);
		expect(split).toEqual(whole);
	});

	it("处理 CRLF 换行", async () => {
		const text = (await readFile(fixturePath, "utf8")).replaceAll("\n", "\r\n");
		const crlf = await collect(parseChatJsonl(chunked(text, [4, 9, 2])));
		const lf = await collect(
			parseChatJsonl(chunked(text.replaceAll("\r\n", "\n"), [64])),
		);
		expect(crlf).toEqual(lf);
	});

	it("解析超过 100 KB 的单行", async () => {
		const longText = "长".repeat(150_000);
		const source = `${JSON.stringify({ character_name: "角色" })}\n${JSON.stringify(
			{
				name: "角色",
				mes: longText,
				is_user: false,
			},
		)}\n${JSON.stringify({ name: "用户", mes: "结尾", is_user: true })}\n`;
		const entries = await collect(parseChatJsonl(chunked(source, [8191, 137])));
		const messages = messagesOf(entries);
		expect(messages).toHaveLength(2);
		expect(messages[0]?.text).toBe(longText);
		expect(messages[1]?.text).toBe("结尾");
	});

	it("最后一行没有换行符也能解析", async () => {
		const source =
			'{"character_name":"角色"}\n{"name":"用户","mes":"末行","is_user":true}';
		const entries = await collect(parseChatJsonl(chunked(source, [3, 5])));
		expect(messagesOf(entries).map((message) => message.text)).toEqual([
			"末行",
		]);
	});

	it("非法 JSON 报告行号", async () => {
		await expect(
			collect(parseChatJsonl(['{"character_name":"角色"}\n{oops}\n'])),
		).rejects.toThrow("第 2 行不是合法 JSON");
	});

	it("非对象行被拒绝", async () => {
		await expect(collect(parseChatJsonl(["[1,2]\n"]))).rejects.toThrow(
			"第 1 行不是 JSON 对象",
		);
	});

	it("swipe_id 越界或不是整数时拒绝解析", async () => {
		const header = JSON.stringify({ character_name: "角色" });
		const outOfRange = `${header}\n${JSON.stringify({
			mes: "正文",
			swipes: ["一", "二"],
			swipe_id: 2,
		})}`;
		await expect(collect(parseChatJsonl([outOfRange]))).rejects.toThrow(
			"swipe_id 2 超出范围（共 2 个 swipe）",
		);
		const fractional = `${header}\n${JSON.stringify({
			mes: "正文",
			swipes: ["一"],
			swipe_id: 1.5,
		})}`;
		await expect(collect(parseChatJsonl([fractional]))).rejects.toThrow(
			"swipe_id 必须是非负整数",
		);
	});

	it("空输入被拒绝", async () => {
		await expect(collect(parseChatJsonl([]))).rejects.toThrow("缺少头部");
	});
});

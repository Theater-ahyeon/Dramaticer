import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	exportChatDocument,
	exportChatFile,
	exportChatJsonl,
	importChatFileToStore,
	importChatToStore,
	parseChatDocument,
	parseChatDocumentFile,
	parseChatJsonl,
	serializeChatJsonl,
	writeChatJsonlFile,
} from "../src/index.js";
import { snapshotAt } from "./store-replay.js";

const samplePath = fileURLToPath(
	new URL("./fixtures/chat-sample.jsonl", import.meta.url),
);
const importPath = fileURLToPath(
	new URL("./fixtures/chat-import.jsonl", import.meta.url),
);

function openStore(): StoryStore {
	const store = StoryStore.open(":memory:");
	onTestFinished(() => store.close());
	return store;
}

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(
		join(dirname(fileURLToPath(import.meta.url)), ".tmp-chat-export-"),
	);
	onTestFinished(async () => {
		await rm(dir, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 50,
		});
	});
	return dir;
}

describe("parseChatDocument 与序列化", () => {
	it("序列化后逐字节等于原文件，未知字段全部保留", async () => {
		const text = await readFile(samplePath, "utf8");
		const document = await parseChatDocument([text]);
		expect(document.header.raw).toMatchObject({
			header_extra: "保留",
			chat_metadata: { note_prompt: "备注", variables: { hp: 1 } },
		});
		expect(document.messages[0]?.raw).toMatchObject({
			unknown_message_field: { keep: true },
			swipe_info: [
				{ extra: { reasoning: "第一次推理" } },
				{ extra: { reasoning: "第二次推理" } },
			],
		});
		expect(serializeChatJsonl(document)).toBe(text);
		expect(await parseChatDocument([serializeChatJsonl(document)])).toEqual(
			document,
		);
	});

	it("写入文件后可以按文档重新解析", async () => {
		const dir = await tempDir();
		const path = join(dir, "chat.jsonl");
		const document = await parseChatDocumentFile(importPath);
		await writeChatJsonlFile(path, document);
		expect(await parseChatDocumentFile(path)).toEqual(document);
	});
});

describe("importChatToStore 的源文档", () => {
	it("返回的文档与解析结果一致", async () => {
		const store = openStore();
		const document = await parseChatDocumentFile(samplePath);
		const imported = await importChatFileToStore(store, samplePath, {
			storyId: "story-doc",
		});
		expect(imported.document).toEqual(document);
	});
});

describe("exportChatDocument", () => {
	it("带源文档时导出与导入原文一致，原文不变", async () => {
		const store = openStore();
		const imported = await importChatFileToStore(store, samplePath, {
			storyId: "story-roundtrip",
		});
		const exported = exportChatDocument(store, {
			storyId: "story-roundtrip",
			source: imported.document,
		});
		expect(exported).toEqual(imported.document);
		expect(serializeChatJsonl(exported)).toBe(
			serializeChatJsonl(imported.document),
		);
		expect(store.getNode("story-roundtrip:m0:s1")?.raw).toBe(
			imported.document.messages[0]?.text,
		);
	});

	it("不带源文档时按 store 生成消息、swipe 与变量快照", async () => {
		const store = openStore();
		await importChatFileToStore(store, importPath, {
			storyId: "story-store",
		});
		const exported = exportChatDocument(store, { storyId: "story-store" });
		expect(exported.header.characterName).toBe("角色");
		expect(exported.header.userName).toBe("User");
		expect(exported.messages.map((message) => message.text)).toEqual([
			"开场",
			"攻击",
			"当前二",
			"无变量更新",
			"收尾",
		]);
		expect(exported.messages[2]?.swipes.map((swipe) => swipe.text)).toEqual([
			"分支一",
			"当前二",
		]);
		expect(exported.messages[2]?.swipeId).toBe(1);
		expect(exported.messages[0]?.variables).toEqual({
			stat_data: { hp: 100, mood: "平静" },
			flags: [],
		});
		expect(exported.messages[2]?.swipes[0]?.variables).toEqual({
			stat_data: { hp: 95 },
			flags: ["战斗"],
		});
		expect(exported.messages[2]?.swipes[1]?.variables).toEqual({
			stat_data: { hp: 80, mood: "受伤" },
			flags: ["战斗"],
			loot: { item: "剑", n: 2 },
		});
	});

	it("重新导入导出的记录后楼层、swipe 与状态快照不变", async () => {
		const store = openStore();
		await importChatFileToStore(store, importPath, { storyId: "first" });
		const exported = exportChatJsonl(store, { storyId: "first" });

		const roundTrip = openStore();
		const imported = await importChatToStore(
			roundTrip,
			parseChatJsonl([exported]),
			{ storyId: "roundtrip" },
		);

		expect(imported.mainPathNodeIds).toEqual([
			"roundtrip:m0:s0",
			"roundtrip:m1:s0",
			"roundtrip:m2:s1",
			"roundtrip:m3:s0",
			"roundtrip:m4:s0",
		]);
		expect(snapshotAt(roundTrip, "roundtrip:m0:s0")).toEqual(
			snapshotAt(store, "first:m0:s0"),
		);
		expect(snapshotAt(roundTrip, "roundtrip:m2:s0")).toEqual(
			snapshotAt(store, "first:m2:s0"),
		);
		expect(snapshotAt(roundTrip, "roundtrip:m2:s1")).toEqual(
			snapshotAt(store, "first:m2:s1"),
		);
		expect(snapshotAt(roundTrip, "roundtrip:m4:s0")).toEqual(
			snapshotAt(store, "first:m4:s0"),
		);
	});

	it("store 里新增的 mvu 事实会进入导出的变量快照", async () => {
		const store = openStore();
		await importChatFileToStore(store, importPath, { storyId: "story-live" });
		store.appendStateDiff({
			storyId: "story-live",
			nodeId: "story-live:m4:s0",
			path: ["mvu", "stat_data", "hp"],
			op: "set",
			value: 5,
			source: "settler",
		});
		const exported = exportChatDocument(store, { storyId: "story-live" });
		expect(exported.messages[4]?.variables).toMatchObject({
			stat_data: { hp: 5 },
		});
	});

	it("导出文件可以重新解析", async () => {
		const store = openStore();
		await importChatFileToStore(store, importPath, { storyId: "story-file" });
		const dir = await tempDir();
		const path = join(dir, "exported.jsonl");
		await exportChatFile(store, path, { storyId: "story-file" });
		const document = await parseChatDocumentFile(path);
		expect(document.header.characterName).toBe("角色");
		expect(document.messages.map((message) => message.text)).toEqual([
			"开场",
			"攻击",
			"当前二",
			"无变量更新",
			"收尾",
		]);
	});

	it("未知故事与空故事直接报错", async () => {
		const store = openStore();
		expect(() => exportChatDocument(store, { storyId: "missing" })).toThrow(
			"故事不存在",
		);
		store.createStory({ id: "empty", title: "空故事" });
		expect(() => exportChatDocument(store, { storyId: "empty" })).toThrow(
			"故事还没有楼层",
		);
	});
});

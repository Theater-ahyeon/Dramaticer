import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { StoryStore } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { runChatCli } from "../src/chat/cli.js";

const enabled = process.env.DRAMATICER_LIVE === "1";
const cardPath = join(import.meta.dirname, "fixtures", "chat-card.json");

describe.skipIf(!enabled)("dramaticer chat（真实渠道）", () => {
	it("连续三轮对话，每轮都有楼层与 Trace", async () => {
		const dbPath = join(
			mkdtempSync(join(import.meta.dirname, ".tmp-chat-live-")),
			"story.db",
		);
		onTestFinished(() => {
			rmSync(dirname(dbPath), { recursive: true, force: true, maxRetries: 5 });
		});
		const userMessages = [
			"我推开山门，雨水顺着斗笠往下淌。",
			"我问他：山里出了什么事？",
			"我决定跟着他往山上走。",
		];
		const logs: string[] = [];
		for (const userText of userMessages) {
			const result = await runChatCli(
				[
					"chat",
					"--story",
					"live-s1",
					"--card",
					cardPath,
					"--user",
					userText,
					"--db",
					dbPath,
					"--model",
					"main",
				],
				{
					log: (message) => {
						logs.push(message);
						console.log(message);
					},
				},
			);
			expect(result.node.role).toBe("assistant");
			expect(result.node.raw.trim().length).toBeGreaterThan(0);
			expect(result.trace.llm.channel).not.toBeNull();
			expect(result.trace.timing.durationMs).toBeGreaterThan(0);
			expect(
				result.trace.context.entries.find(
					(entry) => entry.segmentId === "history",
				)?.status,
			).toBe("included");
		}

		const store = StoryStore.open(dbPath);
		try {
			const nodes = store.getPathToNode(
				store.getLatestNode("live-s1")?.id ?? "",
			);
			expect(nodes.map((node) => node.role)).toEqual([
				"assistant",
				"user",
				"assistant",
				"user",
				"assistant",
				"user",
				"assistant",
			]);
			for (const node of nodes
				.slice(1)
				.filter((item) => item.role === "assistant")) {
				expect(store.getTurnTrace(node.id)).not.toBeNull();
			}
		} finally {
			store.close();
		}
		expect(logs.filter((line) => line.startsWith("楼层 "))).toHaveLength(3);
	}, 300_000);
});

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeChat } from "../src/health/chat-health.js";

const fixturePath = fileURLToPath(
	new URL("./fixtures/health-chat.jsonl", import.meta.url),
);

describe("analyzeChat", () => {
	it("统计楼层、角色、字节分类和 diff", async () => {
		const stats = await analyzeChat(fixturePath);
		expect(stats.characterName).toBe("测试角色");
		expect(stats.messageCount).toBe(5);
		expect(stats.roleCounts).toEqual({ user: 2, assistant: 3, system: 0 });
		expect(stats.swipeCount).toBe(3);
		expect(stats.extraSwipeCount).toBe(0);
		expect(stats.bodyBytes).toBe(2 + 16 + 4 + 16 + 16);
		expect(stats.swipeBodyBytes).toBe(16 + 16 + 16);
		expect(stats.variablesBytes).toBe(
			Buffer.byteLength('[{"hp":10}]', "utf8") +
				Buffer.byteLength('[{"hp":10}]', "utf8") +
				Buffer.byteLength('[{"hp":8}]', "utf8") +
				Buffer.byteLength('[{"hp":6}]', "utf8"),
		);
		expect(stats.otherBytes).toBe(
			stats.rawBytes - stats.bodyBytes - stats.variablesBytes,
		);
		expect(stats.snapshotBytes).toBe(9 + 9 + 8 + 8);
		expect(stats.allSnapshotBytes).toBe(9 + 9 + 8 + 8);
		expect(stats.diffCount).toBe(3);
		expect(stats.diffBytes).toBeGreaterThan(0);
		expect(stats.fieldBytes[0]?.field).toBe("hash_sheets");
		expect(stats.headerBytes).toBeGreaterThan(0);
	});

	it("只配对连续的助手回复", async () => {
		const stats = await analyzeChat(fixturePath);
		expect(stats.assistantReplyCount).toBe(3);
		expect(stats.duplication.pairs).toHaveLength(2);
		expect(stats.duplication.pairs[0]).toMatchObject({
			fromFloor: 2,
			toFloor: 4,
		});
		expect(stats.duplication.pairs[1]).toMatchObject({
			fromFloor: 4,
			toFloor: 5,
		});
		expect(stats.duplication.pairs.every((pair) => pair.similarity === 1)).toBe(
			true,
		);
	});

	it("token 估算可以替换", async () => {
		const stats = await analyzeChat(fixturePath, {
			tokenEstimator: () => 1,
		});
		expect(stats.bodyTokens).toBe(stats.messageCount);
		expect(stats.swipeBodyTokens).toBe(stats.swipeCount);
		expect(stats.variablesTokens).toBe(4);
	});
});

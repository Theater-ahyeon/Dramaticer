import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { runChatCli } from "../src/chat/cli.js";

const enabled = process.env.DRAMATICER_LIVE === "1";
const turns = Number(process.env.DRAMATICER_DEEP_TURNS ?? "6");
const cardPath = join(import.meta.dirname, "fixtures", "chat-card.json");

const PLAYER_TURNS = [
	"我推开山门，雨水顺着斗笠往下淌。",
	"我环顾四周，记下墙上刻的字。",
	"我问山神：山里出了什么事？",
	"我把湿透的外袍脱下来，搭在门边的石狮上。",
	"我沿着廊下往深处走，脚步声很轻。",
	"我在第二道门前停下，听门后的动静。",
	"我伸手推门。",
	"我退回到院子里，抬头看雨。",
];

describe.skipIf(!enabled)("dramaticer chat 深度写法（真实渠道）", () => {
	it(`${turns} 轮深度回合：工具调用率与失败率`, async () => {
		const dbPath = join(
			mkdtempSync(join(import.meta.dirname, ".tmp-deep-live-")),
			"story.db",
		);
		onTestFinished(() => {
			rmSync(dirname(dbPath), { recursive: true, force: true, maxRetries: 5 });
		});

		const summary = { turns: 0, failed: 0, toolTurns: 0, calls: 0 };
		const toolNames = new Set<string>();
		const failures: string[] = [];
		for (let index = 0; index < turns; index += 1) {
			try {
				const result = await runChatCli(
					[
						"chat",
						"--story",
						"live-deep",
						"--card",
						cardPath,
						"--user",
						PLAYER_TURNS[index % PLAYER_TURNS.length] as string,
						"--db",
						dbPath,
						"--mode",
						"deep",
					],
					{ log: (message) => console.log(message) },
				);
				expect(result.trace.turnMode).toBe("deep");
				expect(result.node.raw.trim().length).toBeGreaterThan(0);
				summary.turns += 1;
				const calls = result.trace.tools.calls;
				if (calls.length > 0) summary.toolTurns += 1;
				summary.calls += calls.length;
				for (const call of calls) toolNames.add(call.name);
			} catch (error) {
				summary.failed += 1;
				failures.push(`第 ${index + 1} 轮：${String(error)}`);
				console.error(failures.at(-1));
			}
		}

		console.log(
			`深度写法真实渠道：${JSON.stringify(summary)} 工具：${[...toolNames].join("、") || "无"}`,
		);
		for (const line of failures) console.log(line);
		expect(summary.turns).toBe(turns);
		expect(summary.toolTurns).toBeGreaterThan(0);
		expect(summary.failed / turns).toBeLessThan(0.23);
	}, 900_000);
});

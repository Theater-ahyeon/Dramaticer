import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	StoryStore,
	formatRerollRates,
	readRerollRates,
	runStatsCli,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

// refactor/04：每百楼带原因重写率；只读偏好记录与楼层树，报告不含原文。

/** 一条主线 n 楼（玩家、回复交替），返回回复楼层 id。 */
function seedLine(store: StoryStore, floors: number): string[] {
	store.createStory({ id: "s1", title: "重写率" });
	const assistants: string[] = [];
	let parent: string | null = null;
	for (let floor = 1; floor <= floors; floor += 1) {
		const user = store.appendNode({
			id: `u${floor}`,
			storyId: "s1",
			parentId: parent,
			role: "user",
			raw: `第 ${floor} 句私密原文`,
		});
		const reply = store.appendNode({
			id: `a${floor}`,
			storyId: "s1",
			parentId: user.id,
			role: "assistant",
			raw: `第 ${floor} 楼私密原文`,
		});
		assistants.push(reply.id);
		parent = reply.id;
	}
	return assistants;
}

function reroll(store: StoryStore, abandoned: string, reason?: string): void {
	store.recordPreference({
		storyId: "s1",
		nodeId: abandoned,
		kind: "swipe",
		payload: {
			abandonedNodeId: abandoned,
			acceptedNodeId: abandoned,
			...(reason === undefined ? {} : { reason }),
		},
	});
}

describe("每百楼带原因重写率", () => {
	it("按原因分开，1–10 楼与之后分两段，算出每百楼次数", () => {
		const { store } = openTempStore();
		const replies = seedLine(store, 20);
		reroll(store, replies[0] as string, "too-short");
		reroll(store, replies[1] as string, "too-short");
		reroll(store, replies[2] as string);
		reroll(store, replies[14] as string, "avoid-line");

		const report = readRerollRates(store, "s1");
		expect(report.early).toEqual({ floors: 10, rerolls: 3, perHundred: 30 });
		expect(report.late).toEqual({ floors: 10, rerolls: 1, perHundred: 10 });
		expect(report.total).toEqual({ floors: 20, rerolls: 4, perHundred: 20 });
		const byReason = new Map(report.reasons.map((row) => [row.reason, row]));
		expect(byReason.get("too-short")).toMatchObject({ early: 2, late: 0 });
		expect(byReason.get("none")).toMatchObject({
			label: "未选原因",
			early: 1,
			late: 0,
		});
		expect(byReason.get("avoid-line")).toMatchObject({ early: 0, late: 1 });
		expect(report.reasons.at(-1)?.reason).toBe("none");
		expect(report.interference.directorOff.avoidLine).toBe(1);
	});

	it("没有楼层时全部为零，文本报告不含楼层原文", () => {
		const { store } = openTempStore();
		const replies = seedLine(store, 3);
		reroll(store, replies[0] as string, "format");
		const text = formatRerollRates(readRerollRates(store, "s1"));
		expect(text).toContain("每百楼");
		expect(text).toContain("格式乱");
		expect(text).not.toContain("私密原文");

		const empty = openTempStore().store;
		empty.createStory({ id: "s1", title: "空" });
		expect(readRerollRates(empty, "s1").total).toEqual({
			floors: 0,
			rerolls: 0,
			perHundred: 0,
		});
	});
});

describe("dramaticer stats rerolls", () => {
	it("只读数据库，按故事输出 JSON；参数错误给出用法", async () => {
		const dir = mkdtempSync(join(tmpdir(), "stats-cli-"));
		try {
			const dbPath = join(dir, "story.db");
			const store = StoryStore.open(dbPath);
			seedLine(store, 2);
			reroll(store, "a1", "off-character");
			store.close();

			const lines: string[] = [];
			const reports = await runStatsCli(
				["stats", "rerolls", "--db", dbPath, "--json"],
				{ log: (line) => lines.push(line) },
			);
			expect(reports).toHaveLength(1);
			const parsed = JSON.parse(lines[0] as string) as {
				storyId: string;
				total: { rerolls: number };
			}[];
			expect(parsed[0]).toMatchObject({ storyId: "s1", total: { rerolls: 1 } });
			expect(lines[0]).not.toContain("私密原文");

			await expect(
				runStatsCli(["stats", "rerolls", "--story", "s1"]),
			).rejects.toThrow("--db");
			await expect(
				runStatsCli(["stats", "rerolls", "--db", join(dir, "missing.db")]),
			).rejects.toThrow("数据库不存在");
		} finally {
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
		}
	});
});

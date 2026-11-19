import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type DirectorLine, REROLL_REASON_WILLS } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-director-undo-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startTestServer(): Promise<RunningServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return running;
}

const LINE: DirectorLine = {
	id: "line-1",
	kind: "main",
	who: "卫宫",
	want: "阻止仪式",
	obstacle: "时间只剩一夜",
	countdown: null,
	preparations: ["她先去了钟楼"],
};

function seedStory(running: RunningServer): void {
	running.store.createStory({ id: "s1", title: "撤回接口测试" });
	running.store.appendNode({
		id: "n0",
		storyId: "s1",
		parentId: null,
		role: "assistant",
		raw: "开场。",
	});
	running.store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: "n0",
		role: "user",
		raw: "按推进。",
	});
	running.store.appendNode({
		id: "a1",
		storyId: "s1",
		parentId: "u1",
		role: "assistant",
		raw: "钟声提前响了。",
	});
	running.store.saveDirectorLines({
		nodeId: "n0",
		storyId: "s1",
		diffs: [{ action: "set", line: LINE }],
	});
	running.store.saveDirectorDecision({
		nodeId: "u1",
		storyId: "s1",
		directive: "接球。",
		mechanisms: [{ name: "action", triggered: true, reason: "接球" }],
		signals: { organization: "lines", action: "catch", lineId: LINE.id },
	});
}

describe("导演撤回与干扰统计接口", () => {
	it("撤回静音那条线并记进偏好，恢复后解除静音", async () => {
		const running = await startTestServer();
		seedStory(running);

		const undone = await fetch(
			`${running.origin}/api/stories/s1/director/undo`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nodeId: "a1" }),
			},
		);
		expect(undone.status).toBe(200);
		const view = (await undone.json()) as {
			readonly mutedLineId: string;
			readonly muted: readonly { readonly lineId: string }[];
		};
		expect(view.mutedLineId).toBe(LINE.id);
		expect(view.muted.map((item) => item.lineId)).toEqual([LINE.id]);
		const wills = running.store.getStateDiffs("a1");
		expect(
			wills.some((diff) => {
				if (diff.path[0] !== "userWill") return false;
				const value = diff.value;
				return (
					typeof value === "object" &&
					value !== null &&
					"text" in value &&
					value.text === REROLL_REASON_WILLS["avoid-line"]
				);
			}),
		).toBe(true);

		const restored = await fetch(
			`${running.origin}/api/stories/s1/director/muted/${LINE.id}`,
			{ method: "DELETE" },
		);
		expect(restored.status).toBe(200);
		expect(running.store.listMutedDirectorLines("s1")).toEqual([]);
	});

	it("统计接口按导演开关分组给出次数与比例", async () => {
		const running = await startTestServer();
		seedStory(running);
		running.store.appendNode({
			id: "a2",
			storyId: "s1",
			parentId: "n0",
			role: "assistant",
			raw: "另一条分支。",
		});
		running.store.recordPreference({
			storyId: "s1",
			nodeId: "a1",
			kind: "swipe",
			payload: {
				abandonedNodeId: "a1",
				acceptedNodeId: "a1",
				reason: "ignored-instruction",
			},
		});
		running.store.recordPreference({
			storyId: "s1",
			nodeId: "a2",
			kind: "swipe",
			payload: {
				abandonedNodeId: "a2",
				acceptedNodeId: "a2",
				reason: "avoid-line",
			},
		});

		const response = await fetch(
			`${running.origin}/api/stories/s1/director/stats`,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			storyId: "s1",
			directorOn: {
				floors: 1,
				ignoredInstruction: 1,
				avoidLine: 0,
				ratio: 1,
			},
			directorOff: {
				floors: 2,
				ignoredInstruction: 0,
				avoidLine: 1,
				ratio: 0.5,
			},
		});
	});

	it("没有对应剧情线的安排不能撤回", async () => {
		const running = await startTestServer();
		running.store.createStory({ id: "s1", title: "没有安排" });
		running.store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});

		const response = await fetch(
			`${running.origin}/api/stories/s1/director/undo`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nodeId: "n0" }),
			},
		);
		expect(response.status).toBe(400);
	});
});

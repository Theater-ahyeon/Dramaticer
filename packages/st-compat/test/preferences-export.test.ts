import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { StoryStore, type TimelineNode } from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { runPreferencesCli } from "../src/preferences/cli.js";
import {
	exportPreferences,
	preferencesFileBase,
} from "../src/preferences/export.js";

function openTempStore(): { store: StoryStore; dbPath: string; root: string } {
	const root = mkdtempSync(join(import.meta.dirname, ".tmp-preferences-"));
	const dbPath = join(root, "story.db");
	const store = StoryStore.open(dbPath);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(dbPath), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	return { store, dbPath, root };
}

function seedStory(
	store: StoryStore,
	storyId: string,
	optionText: string | null,
): { user: TimelineNode; assistant: TimelineNode } {
	store.createStory({ id: storyId, title: `故事 ${storyId}` });
	const user = store.appendNode({
		id: `${storyId}-user`,
		storyId,
		parentId: null,
		role: "user",
		raw: "我走进山洞。",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	const options =
		optionText === null
			? ""
			: `\n<选项>${optionText.replaceAll("|", "\n")}</选项>`;
	const assistant = store.appendNode({
		id: `${storyId}-reply`,
		storyId,
		parentId: user.id,
		role: "assistant",
		raw: `洞里很暗。${options}`,
		createdAt: "2026-01-01T00:00:01.000Z",
	});
	return { user, assistant };
}

function readLines(filePath: string): Record<string, unknown>[] {
	const text = readFileSync(filePath, "utf8");
	return text
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("偏好导出", () => {
	it("按故事写出事件与回复对，选择按未选中的选项配对", () => {
		const { store, root } = openTempStore();
		const first = seedStory(store, "story-a", "点火把|继续走|回头");
		store.recordPreference({
			storyId: "story-a",
			nodeId: first.assistant.id,
			kind: "choice",
			payload: { choiceText: "点火把" },
			createdAt: "2026-01-01T00:00:02.000Z",
		});
		const swiped = store.swipeNode(
			first.assistant.id,
			"火把亮起，洞里有一尊石像。",
		);
		store.editNode(first.user.id, "我轻轻走进山洞。");

		const other = seedStory(store, "story-b", null);
		store.swipeNode(other.assistant.id, "另一条回复。");
		store.createStory({ id: "story-empty", title: "没有记录的故事" });

		const outDir = join(root, "out");
		const result = exportPreferences(store, { outDir });

		expect(result.stories.map((story) => story.storyId)).toEqual([
			"story-a",
			"story-b",
		]);
		const storyA = result.stories[0];
		expect(storyA?.kindCounts).toEqual({
			swipe: 1,
			choice: 1,
			card_decision: 0,
			edit: 1,
		});
		expect(storyA?.pairCount).toBe(3);
		expect(storyA?.unpairedChoices).toBe(0);
		expect(result.eventCount).toBe(4);
		expect(result.pairCount).toBe(4);

		const events = readLines(join(outDir, "story-a.events.jsonl"));
		expect(events.map((event) => event.kind)).toEqual([
			"choice",
			"swipe",
			"edit",
		]);
		expect(events[1]?.nodeId).toBe(swiped.id);

		const pairs = readLines(join(outDir, "story-a.pairs.jsonl"));
		expect(
			pairs.map((pair) => ({
				kind: pair.kind,
				accepted: pair.accepted,
				abandoned: pair.abandoned,
			})),
		).toEqual([
			{
				kind: "choice",
				accepted: { nodeId: null, text: "点火把" },
				abandoned: { nodeId: null, text: "继续走" },
			},
			{
				kind: "choice",
				accepted: { nodeId: null, text: "点火把" },
				abandoned: { nodeId: null, text: "回头" },
			},
			{
				kind: "reroll",
				accepted: { nodeId: swiped.id, text: "火把亮起，洞里有一尊石像。" },
				abandoned: {
					nodeId: first.assistant.id,
					text: "洞里很暗。\n<选项>点火把\n继续走\n回头</选项>",
				},
			},
		]);

		expect(readdirSync(outDir).sort()).toEqual([
			"index.json",
			"story-a.events.jsonl",
			"story-a.pairs.jsonl",
			"story-b.events.jsonl",
			"story-b.pairs.jsonl",
		]);
		const index = JSON.parse(
			readFileSync(join(outDir, "index.json"), "utf8"),
		) as {
			readonly eventCount: number;
			readonly pairCount: number;
			readonly stories: readonly { readonly storyId: string }[];
		};
		expect(index.eventCount).toBe(4);
		expect(index.pairCount).toBe(4);
		expect(index.stories.map((story) => story.storyId)).toEqual([
			"story-a",
			"story-b",
		]);
	});

	it("重复导出逐字节一致，只导出指定故事", () => {
		const { store, root } = openTempStore();
		const first = seedStory(store, "story-a", "点火把|回头");
		store.recordPreference({
			storyId: "story-a",
			nodeId: first.assistant.id,
			kind: "choice",
			payload: { choiceText: "回头" },
			createdAt: "2026-01-01T00:00:02.000Z",
		});
		const other = seedStory(store, "story-b", null);
		store.swipeNode(other.assistant.id, "另一条回复。");

		const firstDir = join(root, "first");
		const secondDir = join(root, "second");
		exportPreferences(store, { outDir: firstDir });
		exportPreferences(store, { outDir: secondDir });
		for (const file of readdirSync(firstDir)) {
			expect(readFileSync(join(secondDir, file), "utf8")).toBe(
				readFileSync(join(firstDir, file), "utf8"),
			);
		}

		const selected = exportPreferences(store, {
			outDir: join(root, "selected"),
			story: "story-b",
		});
		expect(selected.stories.map((story) => story.storyId)).toEqual(["story-b"]);
		expect(readdirSync(join(root, "selected")).sort()).toEqual([
			"index.json",
			"story-b.events.jsonl",
			"story-b.pairs.jsonl",
		]);
	});

	it("选择正文不在选项块里时计入未配对，不生成样本", () => {
		const { store, root } = openTempStore();
		const seeded = seedStory(store, "story-c", "点火把|回头");
		store.recordPreference({
			storyId: "story-c",
			nodeId: seeded.assistant.id,
			kind: "choice",
			payload: { choiceText: "跳进水里" },
			createdAt: "2026-01-01T00:00:02.000Z",
		});

		const result = exportPreferences(store, { outDir: join(root, "out") });
		expect(result.stories[0]?.pairCount).toBe(0);
		expect(result.stories[0]?.unpairedChoices).toBe(1);
		expect(result.unpairedChoices).toBe(1);
	});

	it("两个故事导出到同一个文件名时拒绝覆盖", () => {
		const { store, root } = openTempStore();
		store.createStory({ id: "a/b", title: "斜杠故事" });
		store.createStory({ id: "a_b", title: "下划线故事" });
		expect(preferencesFileBase("a/b")).toBe("a_b");
		expect(() =>
			exportPreferences(store, { outDir: join(root, "out") }),
		).toThrow(/a_b\.jsonl/);
	});

	it("命令行写出私有导出并打印计数", async () => {
		const { store, dbPath, root } = openTempStore();
		const seeded = seedStory(store, "story-cli", "点火把|回头");
		store.recordPreference({
			storyId: "story-cli",
			nodeId: seeded.assistant.id,
			kind: "choice",
			payload: { choiceText: "点火把" },
			createdAt: "2026-01-01T00:00:02.000Z",
		});
		store.close();

		const messages: string[] = [];
		const outDir = join(root, "cli-out");
		const result = await runPreferencesCli(
			["export", "--db", dbPath, "--out", outDir],
			{ log: (message) => messages.push(message) },
		);
		expect(result.eventCount).toBe(1);
		expect(result.pairCount).toBe(1);
		expect(messages.join("\n")).toContain("1 组回复对");
		expect(messages.join("\n")).not.toContain("点火把");
		expect(statSync(join(outDir, "story-cli.pairs.jsonl")).isFile()).toBe(true);
		await expect(runPreferencesCli(["bogus", "--db", dbPath])).rejects.toThrow(
			/用法：/,
		);
	});
});

import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { describe, expect, it, onTestFinished } from "vitest";
import { StoryStore, chunkText, chunkTextByParent } from "../src/index.js";
import { MIGRATIONS, applyMigrations } from "../src/store/migrations.js";
import { openTempStore } from "./temp-store.js";

describe("运行时分块与 BM25 索引", () => {
	it("appendNode 在同一事务里写入与父子分块一致的块", () => {
		const { store } = openTempStore();
		store.createStory({ id: "分块故事", title: "分块" });
		const raw = `${"甲".repeat(700)}\n${"乙".repeat(700)}`;
		const node = store.appendNode({
			id: "n-long",
			storyId: "分块故事",
			parentId: null,
			role: "assistant",
			raw,
		});
		expect(store.countChunksForNode(node.id)).toBe(
			chunkTextByParent(raw).length,
		);
		expect(store.countChunkParentsForNode(node.id)).toBe(2);
		expect(store.getSchemaVersion()).toBe(
			MIGRATIONS[MIGRATIONS.length - 1]?.version,
		);
	});

	it("beforeNodeId 只检索祖先路径，排除自身与其他分支", () => {
		const { store } = openTempStore();
		store.createStory({ id: "分支故事", title: "分支" });
		const root = store.appendNode({
			id: "n-root",
			storyId: "分支故事",
			parentId: null,
			role: "system",
			raw: "青铜匕首藏在井底。",
		});
		const user = store.appendNode({
			id: "n-user",
			storyId: "分支故事",
			parentId: root.id,
			role: "user",
			raw: "我用绳子把它吊上来。",
		});
		const left = store.appendNode({
			id: "n-left",
			storyId: "分支故事",
			parentId: user.id,
			role: "assistant",
			raw: "左分支提到青铜匕首。",
		});
		const right = store.appendNode({
			id: "n-right",
			storyId: "分支故事",
			parentId: user.id,
			role: "assistant",
			raw: "右分支也有青铜匕首。",
		});

		expect(
			store
				.searchChunks("青铜匕首", {
					storyId: "分支故事",
					beforeNodeId: left.id,
				})
				.map((match) => match.nodeId),
		).toEqual([root.id]);
		expect(
			store.searchChunks("青铜匕首", {
				storyId: "分支故事",
				beforeNodeId: root.id,
			}),
		).toEqual([]);
		const all = store
			.searchChunks("青铜匕首", { storyId: "分支故事" })
			.map((match) => match.nodeId);
		expect(new Set(all)).toEqual(new Set([root.id, left.id, right.id]));
	});

	it("全角文本与带标点查询能命中", () => {
		const { store } = openTempStore();
		store.createStory({ id: "全角故事", title: "全角" });
		store.appendNode({
			id: "n-full",
			storyId: "全角故事",
			parentId: null,
			role: "assistant",
			raw: "代号 ＢＭ２５ 暗器，勿动。",
		});
		const matches = store.searchChunks("BM25，暗器！", {
			storyId: "全角故事",
		});
		expect(matches.map((match) => match.nodeId)).toEqual(["n-full"]);
	});

	it("同一楼层的多个块只占一个结果位次", () => {
		const { store } = openTempStore();
		store.createStory({ id: "重复故事", title: "重复" });
		const raw = `独门暗器${"甲".repeat(400)}独门暗器${"乙".repeat(100)}`;
		const node = store.appendNode({
			id: "n-repeat",
			storyId: "重复故事",
			parentId: null,
			role: "assistant",
			raw,
		});
		expect(store.countChunksForNode(node.id)).toBe(2);
		const matches = store.searchChunks("独门暗器", { storyId: "重复故事" });
		expect(matches).toHaveLength(1);
		expect(matches[0]?.nodeId).toBe(node.id);
	});

	it("检索命中返回父段文本，同一父段多个小块只占一个位次", () => {
		const { store } = openTempStore();
		store.createStory({ id: "父段故事", title: "父段" });
		const raw = `${"甲".repeat(700)}\n${"乙".repeat(700)}`;
		const node = store.appendNode({
			id: "n-parent",
			storyId: "父段故事",
			parentId: null,
			role: "assistant",
			raw,
		});
		expect(store.countChunkParentsForNode(node.id)).toBe(2);
		const matches = store.searchChunks("乙乙乙", { storyId: "父段故事" });
		expect(matches).toHaveLength(1);
		expect(matches[0]?.parentOrdinal).toBe(1);
		expect(matches[0]?.parentText).toBe("乙".repeat(700));
	});

	it("单个段落超过父段上限时父段退化为整楼", () => {
		const { store } = openTempStore();
		store.createStory({ id: "整楼故事", title: "整楼" });
		const raw = `${"甲".repeat(1300)}\n${"乙".repeat(50)}`;
		const node = store.appendNode({
			id: "n-floor",
			storyId: "整楼故事",
			parentId: null,
			role: "assistant",
			raw,
		});
		expect(store.countChunkParentsForNode(node.id)).toBe(1);
		const matches = store.searchChunks("乙乙乙", { storyId: "整楼故事" });
		expect(matches).toHaveLength(1);
		expect(matches[0]?.parentOrdinal).toBe(0);
		expect(matches[0]?.parentText).toBe(raw);
	});

	it("固定窗口策略与父子分块之前的块数和命中形状一致", () => {
		const { store } = openTempStore({ chunkStrategy: "fixed" });
		store.createStory({ id: "旧策略", title: "旧策略" });
		const raw = `${"甲".repeat(700)}\n${"乙".repeat(700)}`;
		const node = store.appendNode({
			id: "n-fixed",
			storyId: "旧策略",
			parentId: null,
			role: "assistant",
			raw,
		});
		expect(store.countChunksForNode(node.id)).toBe(chunkText(raw).length);
		expect(store.countChunkParentsForNode(node.id)).toBe(0);
		const matches = store.searchChunks("乙乙乙", { storyId: "旧策略" });
		expect(matches).toHaveLength(1);
		expect(matches[0]?.parentOrdinal).toBeNull();
		expect(matches[0]?.parentText).toBeNull();
	});

	it("迁移后回填旧楼层，重复打开不产生重复块", () => {
		const dir = mkdtempSync(join(import.meta.dirname, ".tmp-chunks-"));
		const path = join(dir, "story.db");
		onTestFinished(() =>
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 }),
		);
		const text = "乙".repeat(900);
		const raw = new Database(path);
		applyMigrations(raw, MIGRATIONS.slice(0, 9));
		raw
			.prepare("INSERT INTO stories (id, title, created_at) VALUES (?, ?, ?)")
			.run("旧故事", "旧故事", "2026-01-01T00:00:00.000Z");
		raw
			.prepare(
				`INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at)
				VALUES (?, ?, NULL, 'assistant', ?, ?)`,
			)
			.run("旧楼层", "旧故事", text, "2026-01-01T00:00:00.000Z");
		raw.close();

		const expected = chunkTextByParent(text).length;
		const store = StoryStore.open(path);
		try {
			expect(store.getSchemaVersion()).toBe(
				MIGRATIONS[MIGRATIONS.length - 1]?.version,
			);
			expect(store.countChunksForNode("旧楼层")).toBe(expected);
			expect(store.countChunkParentsForNode("旧楼层")).toBe(1);
		} finally {
			store.close();
		}

		const reopened = StoryStore.open(path);
		try {
			expect(reopened.countChunksForNode("旧楼层")).toBe(expected);
			expect(
				reopened.searchChunks("乙乙乙", { storyId: "旧故事" }),
			).toHaveLength(1);
		} finally {
			reopened.close();
		}
	});

	it("迁移清空旧块与向量，并把 embedding 任务退回待执行", () => {
		const dir = mkdtempSync(join(import.meta.dirname, ".tmp-chunk-v35-"));
		const path = join(dir, "story.db");
		onTestFinished(() =>
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 }),
		);
		const text = "乙".repeat(900);
		const raw = new Database(path);
		sqliteVec.load(raw);
		applyMigrations(raw, MIGRATIONS.slice(0, 34));
		raw
			.prepare("INSERT INTO stories (id, title, created_at) VALUES (?, ?, ?)")
			.run("迁移故事", "迁移", "2026-01-01T00:00:00.000Z");
		raw
			.prepare(
				`INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at)
				VALUES (?, ?, NULL, 'assistant', ?, ?)`,
			)
			.run("迁移楼层", "迁移故事", text, "2026-01-01T00:00:00.000Z");
		raw
			.prepare(
				"INSERT INTO chunks (id, story_id, node_id, ordinal, text) VALUES (1, ?, ?, 0, ?)",
			)
			.run("迁移故事", "迁移楼层", text);
		raw
			.prepare(
				"INSERT INTO chunks_fts (rowid, text, node_id, story_id) VALUES (1, ?, ?, ?)",
			)
			.run(text, "迁移楼层", "迁移故事");
		raw
			.prepare(
				"INSERT INTO chunk_vectors (chunk_id, story_id, node_id, embedding) VALUES (?, ?, ?, ?)",
			)
			.run(
				BigInt(1),
				"迁移故事",
				"迁移楼层",
				Buffer.from(new Float32Array(1024).buffer),
			);
		raw
			.prepare(
				`INSERT INTO background_jobs
					(story_id, node_id, kind, status, attempts, created_at, started_at, finished_at)
				VALUES (?, ?, 'embeddings', 'done', 1, ?, ?, ?)`,
			)
			.run(
				"迁移故事",
				"迁移楼层",
				"2026-01-01T00:00:00.000Z",
				"2026-01-01T00:00:01.000Z",
				"2026-01-01T00:00:02.000Z",
			);
		raw.close();

		const store = StoryStore.open(path);
		try {
			expect(store.getSchemaVersion()).toBe(35);
			expect(store.countChunksForNode("迁移楼层")).toBe(
				chunkTextByParent(text).length,
			);
			expect(store.countChunkVectorsForNode("迁移楼层")).toBe(0);
			expect(
				store.searchVectors(new Array(1024).fill(0), {
					storyId: "迁移故事",
				}),
			).toEqual([]);
			const job = store.getBackgroundJob(1);
			expect(job?.status).toBe("pending");
			expect(job?.attempts).toBe(0);
			expect(job?.startedAt).toBeNull();
			expect(job?.finishedAt).toBeNull();
		} finally {
			store.close();
		}
	});

	it("缺失故事、缺失楼层与跨故事的 beforeNodeId 抛错", () => {
		const { store } = openTempStore();
		store.createStory({ id: "甲故事", title: "甲" });
		store.createStory({ id: "乙故事", title: "乙" });
		const node = store.appendNode({
			id: "n-甲",
			storyId: "甲故事",
			parentId: null,
			role: "assistant",
			raw: "甲故事的正文。",
		});
		expect(() => store.searchChunks("甲故事", { storyId: "不存在" })).toThrow(
			"故事不存在：不存在",
		);
		expect(() =>
			store.searchChunks("甲故事", {
				storyId: "乙故事",
				beforeNodeId: node.id,
			}),
		).toThrow("属于另一个故事");
		expect(() => store.countChunksForNode("不存在")).toThrow(
			"楼层节点不存在：不存在",
		);
	});
});

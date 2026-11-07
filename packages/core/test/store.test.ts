import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	LATEST_SCHEMA_VERSION,
	StoryStore,
	type TimelineNode,
} from "../src/index.js";
import { applyMigrations } from "../src/store/migrations.js";

function tempDbPath(): string {
	return join(
		mkdtempSync(join(import.meta.dirname, ".tmp-store-")),
		"story.db",
	);
}

function removeDbDir(path: string): void {
	rmSync(dirname(path), {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 50,
	});
}

function openTempStore(): { store: StoryStore; path: string } {
	const path = tempDbPath();
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		removeDbDir(path);
	});
	return { store, path };
}

function seedStory(store: StoryStore): {
	root: TimelineNode;
	user: TimelineNode;
	assistant: TimelineNode;
	swipe: TimelineNode;
} {
	store.createStory({ id: "story-1", title: "测试故事" });
	const root = store.appendNode({
		id: "n-root",
		storyId: "story-1",
		parentId: null,
		role: "system",
		raw: "你是故事引擎。",
	});
	const user = store.appendNode({
		id: "n-user",
		storyId: "story-1",
		parentId: root.id,
		role: "user",
		raw: "我推开古老的山门。",
	});
	const assistant = store.appendNode({
		id: "n-assistant",
		storyId: "story-1",
		parentId: user.id,
		role: "assistant",
		raw: "银色的麒麟守着门后的 dragon 雕像。",
	});
	const swipe = store.appendNode({
		id: "n-swipe",
		storyId: "story-1",
		parentId: user.id,
		role: "assistant",
		raw: "门后是一片寂静的庭院。",
	});
	return { root, user, assistant, swipe };
}

describe("schema 与迁移", () => {
	it("建库后 schema 版本是最新版本，重新打开不会重复迁移", () => {
		const { store, path } = openTempStore();
		expect(store.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
		seedStory(store);

		const reopened = StoryStore.open(path);
		expect(reopened.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
		expect(reopened.getStory("story-1")?.title).toBe("测试故事");
		reopened.close();
	});

	it("拒绝打开版本高于代码的数据库", () => {
		const path = tempDbPath();
		onTestFinished(() => removeDbDir(path));
		const raw = new Database(path);
		raw.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`);
		raw.close();
		expect(() => StoryStore.open(path)).toThrow(/高于当前代码支持的版本/);
	});

	it("迁移列表的版本号不是从 1 连续递增时抛错", () => {
		const { store, path } = openTempStore();
		const raw = new Database(path);
		expect(() =>
			applyMigrations(raw, [
				{ version: 1, description: "第一版", statements: [] },
				{ version: 3, description: "第三版", statements: [] },
			]),
		).toThrow(/第 2 项的版本号必须是 2，实际为 3/);
		raw.close();
		expect(store.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
	});
});

describe("事务", () => {
	it("回调跨越异步边界，失败时回滚，成功后写入可见", async () => {
		const { store } = openTempStore();

		await expect(
			store.runInTransaction(async () => {
				store.createStory({ id: "story-tx", title: "事务故事" });
				await Promise.resolve();
				throw new Error("中途失败");
			}),
		).rejects.toThrow("中途失败");
		expect(store.getStory("story-tx")).toBeNull();

		await store.runInTransaction(async () => {
			store.createStory({ id: "story-tx", title: "事务故事" });
		});
		expect(store.getStory("story-tx")?.title).toBe("事务故事");
	});
});

describe("楼层树", () => {
	it("按路径从根读到节点，兄弟节点不在路径里", () => {
		const { store } = openTempStore();
		const { root, user, assistant, swipe } = seedStory(store);

		expect(store.getPathToNode(assistant.id).map((node) => node.id)).toEqual([
			root.id,
			user.id,
			assistant.id,
		]);
		expect(store.getPathToNode(swipe.id).map((node) => node.id)).toEqual([
			root.id,
			user.id,
			swipe.id,
		]);
		expect(store.getPathToNode(root.id).map((node) => node.id)).toEqual([
			root.id,
		]);
	});

	it("拒绝不存在或跨故事的父节点", () => {
		const { store } = openTempStore();
		const { assistant } = seedStory(store);
		store.createStory({ id: "story-2", title: "另一个故事" });

		expect(() =>
			store.appendNode({
				storyId: "story-2",
				parentId: assistant.id,
				role: "user",
				raw: "跨故事",
			}),
		).toThrow(/属于另一个故事/);

		expect(() =>
			store.appendNode({
				storyId: "story-1",
				parentId: "missing-node",
				role: "user",
				raw: "悬空父节点",
			}),
		).toThrow(/父节点不存在/);

		expect(() =>
			store.appendNode({
				storyId: "missing-story",
				parentId: null,
				role: "user",
				raw: "悬空故事",
			}),
		).toThrow(/故事不存在/);
	});

	it("读取不存在的楼层时抛错", () => {
		const { store } = openTempStore();
		expect(() => store.getPathToNode("nope")).toThrow(/楼层节点不存在/);
	});

	it("重复的楼层 id 与故事 id 被拒绝", () => {
		const { store } = openTempStore();
		const { root } = seedStory(store);
		expect(() =>
			store.appendNode({
				id: root.id,
				storyId: "story-1",
				parentId: null,
				role: "user",
				raw: "重复",
			}),
		).toThrow(/楼层节点已存在/);
		expect(() => store.createStory({ id: "story-1", title: "重复" })).toThrow(
			/故事已存在/,
		);
	});
});

describe("状态 diff", () => {
	it("按路径顺序返回 diff，包含嵌套路径与删除操作", () => {
		const { store } = openTempStore();
		const { root, user, assistant, swipe } = seedStory(store);

		store.appendStateDiff({
			storyId: "story-1",
			nodeId: root.id,
			path: ["时间"],
			op: "set",
			value: "黎明",
			source: "import",
		});
		store.appendStateDiffs([
			{
				storyId: "story-1",
				nodeId: user.id,
				path: ["角色", "卫宫", "好感度"],
				op: "set",
				value: 10,
				reason: "初次见面",
				source: "import",
			},
			{
				storyId: "story-1",
				nodeId: user.id,
				path: ["角色", "卫宫", "心情"],
				op: "set",
				value: { label: "平静", tags: ["a", 1, null] },
				source: "import",
			},
		]);
		store.appendStateDiffs([
			{
				storyId: "story-1",
				nodeId: assistant.id,
				path: ["角色", "卫宫", "好感度"],
				op: "set",
				value: 20,
				source: "model",
			},
			{
				storyId: "story-1",
				nodeId: assistant.id,
				path: ["角色", "卫宫", "心情"],
				op: "delete",
				source: "model",
			},
		]);

		const diffs = store.getStateDiffsAlongPath(assistant.id);
		expect(
			diffs.map((diff) => [diff.nodeId, diff.path.join("."), diff.op]),
		).toEqual([
			[root.id, "时间", "set"],
			[user.id, "角色.卫宫.好感度", "set"],
			[user.id, "角色.卫宫.心情", "set"],
			[assistant.id, "角色.卫宫.好感度", "set"],
			[assistant.id, "角色.卫宫.心情", "delete"],
		]);
		expect(diffs.map((diff) => diff.ordinal)).toEqual([0, 0, 1, 0, 1]);
		expect(diffs[1]?.value).toBe(10);
		expect(diffs[1]?.reason).toBe("初次见面");
		expect(diffs[2]?.value).toEqual({
			label: "平静",
			tags: ["a", 1, null],
		});
		expect(diffs[4]?.value).toBeNull();
		expect(store.getStateDiffsAlongPath(swipe.id)).toHaveLength(3);
		expect(store.getStateDiffs(swipe.id)).toEqual([]);
	});

	it("一批 diff 中任何一条非法都不会写入", () => {
		const { store } = openTempStore();
		const { user } = seedStory(store);
		expect(() =>
			store.appendStateDiffs([
				{
					storyId: "story-1",
					nodeId: user.id,
					path: ["生命"],
					op: "set",
					value: 100,
					source: "model",
				},
				{
					storyId: "story-1",
					nodeId: user.id,
					path: ["生命"],
					op: "set",
					value: Number.NaN,
					source: "model",
				},
			]),
		).toThrow(/不是有限数字/);
		expect(store.getStateDiffs(user.id)).toEqual([]);
	});

	it("拒绝非法路径、不匹配的故事、delete 携带 value", () => {
		const { store } = openTempStore();
		const { user } = seedStory(store);
		store.createStory({ id: "story-2", title: "另一个故事" });

		expect(() =>
			store.appendStateDiff({
				storyId: "story-1",
				nodeId: user.id,
				path: [],
				op: "set",
				value: 1,
				source: "model",
			}),
		).toThrow(/path 必须是非空字符串组成的非空数组/);

		expect(() =>
			store.appendStateDiff({
				storyId: "story-2",
				nodeId: user.id,
				path: ["生命"],
				op: "set",
				value: 1,
				source: "model",
			}),
		).toThrow(/storyId 与楼层节点所属故事不一致/);

		expect(() =>
			store.appendStateDiff({
				storyId: "story-1",
				nodeId: user.id,
				path: ["生命"],
				op: "delete",
				value: 1,
				source: "model",
			} as never),
		).toThrow(/不能携带 value/);

		expect(() =>
			store.appendStateDiff({
				storyId: "story-1",
				nodeId: "missing",
				path: ["生命"],
				op: "set",
				value: 1,
				source: "model",
			}),
		).toThrow(/楼层节点不存在/);
	});

	it("读取不存在的楼层的 diff 时抛错", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(() => store.getStateDiffs("missing")).toThrow(
			/楼层节点不存在：missing/,
		);
	});

	it("存储里的 path 不是非空字符串数组时抛错", () => {
		const { store, path } = openTempStore();
		const { user } = seedStory(store);
		const raw = new Database(path);
		const insert = raw.prepare(
			`INSERT INTO state_diffs (story_id, node_id, ordinal, path, op, value, source, created_at)
			VALUES (?, ?, ?, ?, 'set', '1', 'import', '2026-11-06T00:00:00.000Z')`,
		);
		insert.run("story-1", user.id, 0, "[]");
		expect(() => store.getStateDiffs(user.id)).toThrow(
			/状态 diff 1 的 path 必须是非空字符串组成的非空数组/,
		);

		raw.prepare("DELETE FROM state_diffs").run();
		insert.run("story-1", user.id, 0, '["生命", 3]');
		expect(() => store.getStateDiffs(user.id)).toThrow(
			/状态 diff 1 的 path 必须是非空字符串组成的非空数组/,
		);
		raw.close();
	});
});

describe("原文不可修改", () => {
	it("数据库层面拒绝 UPDATE 楼层原文", () => {
		const { store, path } = openTempStore();
		const { assistant } = seedStory(store);

		const raw = new Database(path);
		expect(() =>
			raw
				.prepare("UPDATE nodes SET raw = ? WHERE id = ?")
				.run("篡改后的正文", assistant.id),
		).toThrow(/原文不可修改/);
		raw.close();

		expect(store.getNode(assistant.id)?.raw).toBe(
			"银色的麒麟守着门后的 dragon 雕像。",
		);
	});
});

describe("全文检索", () => {
	it("能检索中文与英文，并可按故事过滤", () => {
		const { store } = openTempStore();
		const { assistant, user } = seedStory(store);
		store.createStory({ id: "story-2", title: "第二个故事" });
		store.appendNode({
			storyId: "story-2",
			parentId: null,
			role: "assistant",
			raw: "山门之外有 dragon 的鳞片。",
		});

		const chinese = store.searchNodeText("古老的山门");
		expect(chinese.map((match) => match.nodeId)).toContain(user.id);
		expect(chinese[0]?.snippet).toContain("[古老的山门]");

		const english = store.searchNodeText("dragon", { storyId: "story-1" });
		expect(english.map((match) => match.nodeId)).toEqual([assistant.id]);

		const filtered = store.searchNodeText("dragon", { storyId: "story-2" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.storyId).toBe("story-2");

		const limited = store.searchNodeText("dragon", { limit: 1 });
		expect(limited).toHaveLength(1);
	});

	it("查询里的引号按字面处理", () => {
		const { store } = openTempStore();
		store.createStory({ id: "story-1", title: "测试故事" });
		const node = store.appendNode({
			storyId: "story-1",
			parentId: null,
			role: "assistant",
			raw: '他说"你好"之后离开。',
		});
		const matches = store.searchNodeText('他说"你好"');
		expect(matches.map((match) => match.nodeId)).toContain(node.id);
	});

	it("少于三个字符或非法条数时抛错", () => {
		const { store } = openTempStore();
		seedStory(store);
		expect(() => store.searchNodeText("山门")).toThrow(/至少需要 3 个字符/);
		expect(() => store.searchNodeText("古老的山门", { limit: 0 })).toThrow(
			/1 到 1000/,
		);
		expect(() => store.searchNodeText("古老的山门", { limit: 2.5 })).toThrow(
			/1 到 1000/,
		);
	});
});

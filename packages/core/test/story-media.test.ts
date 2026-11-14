import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { StoryStore } from "../src/index.js";

function openStore() {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-media-"));
	const store = StoryStore.open(join(dir, "story.db"));
	onTestFinished(() => {
		store.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	store.createStory({ id: "story-1", title: "山门" });
	return store;
}

const cover = {
	slot: "cover" as const,
	name: "cover",
	fileName: "story-media/abc/def.png",
	mediaType: "image/png",
	byteSize: 128,
};

describe("故事媒体存储", () => {
	it("写入、读取与清空封面和立绘", () => {
		const store = openStore();
		const saved = store.insertStoryMedia("story-1", cover);
		expect(saved.slot).toBe("cover");
		expect(saved.byteSize).toBe(128);
		store.insertStoryMedia("story-1", {
			slot: "portrait",
			name: "云裳",
			fileName: cover.fileName,
			mediaType: "image/png",
			byteSize: 128,
		});

		expect(store.getStoryMedia("story-1", "cover", "cover")).toEqual(saved);
		expect(
			store.listStoryMedia("story-1").map((record) => record.name),
		).toEqual(["cover", "云裳"]);
		expect(store.listStoryMedia("story-1", "portrait")).toHaveLength(1);

		expect(store.clearStoryMedia("story-1")).toBe(2);
		expect(store.getStoryMedia("story-1", "cover", "cover")).toBeNull();
	});

	it("同一位置同名重复写入覆盖文件引用", () => {
		const store = openStore();
		store.insertStoryMedia("story-1", cover);
		const replaced = store.insertStoryMedia("story-1", {
			...cover,
			fileName: "story-media/abc/other.png",
			byteSize: 256,
		});
		expect(replaced.fileName).toBe("story-media/abc/other.png");
		expect(replaced.byteSize).toBe(256);
		expect(store.listStoryMedia("story-1", "cover")).toHaveLength(1);
	});

	it("故事不存在或输入不合法时拒绝", () => {
		const store = openStore();
		expect(() => store.insertStoryMedia("missing", cover)).toThrow(
			/故事不存在/,
		);
		expect(() =>
			store.insertStoryMedia("story-1", {
				...cover,
				fileName: "../escape.png",
			}),
		).toThrow(/相对路径/);
		expect(() =>
			store.insertStoryMedia("story-1", {
				...cover,
				fileName: "story-media/abc\\def.png",
			}),
		).toThrow(/相对路径/);
		expect(() =>
			store.insertStoryMedia("story-1", { ...cover, byteSize: 0 }),
		).toThrow(/正整数/);
		expect(() =>
			store.getStoryMedia("story-1", "avatar" as unknown as "cover", "cover"),
		).toThrow(/位置不合法/);
	});
});

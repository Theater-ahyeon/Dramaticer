import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";
import { StoryStore } from "../src/index.js";

/** 在测试目录下开一个临时数据库，测试结束自动关闭并删除。 */
export function openTempStore(): { store: StoryStore; path: string } {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-chat-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	return { store, path };
}

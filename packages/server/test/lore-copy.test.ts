import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

interface TestServer {
	readonly running: RunningServer;
	readonly dir: string;
}

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-lore-copy-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startTestServer(): Promise<TestServer> {
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
	return { running, dir };
}

async function request(
	origin: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	});
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "POST", body: JSON.stringify(body) });
}

function patch(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, {
		method: "PATCH",
		body: JSON.stringify(body),
	});
}

const cardData = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "云裳",
		description: "青云宗剑修",
		first_mes: "山门外的风很冷。",
		character_book: {
			name: "云裳的世界",
			entries: [
				{
					id: 1,
					keys: ["剑冢"],
					comment: "剑冢",
					content: "山后埋着历代断剑。",
					enabled: true,
				},
				{
					id: 2,
					keys: [],
					comment: "山门规矩",
					content: "入门先立誓，剑不离身。",
					enabled: true,
					constant: true,
				},
			],
		},
	},
};

interface LoreCopyEntry {
	readonly id: string;
	readonly source: string;
	readonly name: string;
	readonly content: string;
	readonly constant: boolean;
	readonly keywords: readonly string[];
	readonly kind: string;
	readonly edited: boolean;
	readonly disabled: boolean;
	readonly locked: boolean;
}

interface LoreCopyView {
	readonly entries: readonly LoreCopyEntry[];
}

interface PreviewView {
	readonly id: string;
	readonly kind: string;
	readonly constant: boolean;
	readonly keywords: readonly string[];
	readonly condition: string;
	readonly hit: boolean;
	readonly reason: string;
}

interface HistoryView {
	readonly edits: readonly {
		readonly id: number;
		readonly value: unknown;
		readonly source: string;
		readonly disabled: boolean;
	}[];
}

async function seedStory(
	running: RunningServer,
	storyId: string,
): Promise<void> {
	const created = await post(running.origin, "/api/stories", {
		id: storyId,
		title: storyId,
	});
	expect(created.status).toBe(201);
	const imported = await post(
		running.origin,
		`/api/stories/${storyId}/import`,
		{ card: { format: "json", data: JSON.stringify(cardData) } },
	);
	expect(imported.status).toBe(200);
}

async function loreCopy(
	running: RunningServer,
	storyId: string,
): Promise<LoreCopyView> {
	const response = await request(
		running.origin,
		`/api/stories/${storyId}/lore-copy`,
	);
	expect(response.status).toBe(200);
	return (await response.json()) as LoreCopyView;
}

function findEntry(view: LoreCopyView, name: string): LoreCopyEntry {
	const entry = view.entries.find((candidate) => candidate.name === name);
	if (entry === undefined) throw new Error(`没有找到设定条目：${name}`);
	return entry;
}

async function history(
	running: RunningServer,
	storyId: string,
	entryId: string,
): Promise<HistoryView> {
	const response = await request(
		running.origin,
		`/api/stories/${storyId}/memory/history?kind=lore&target=${encodeURIComponent(entryId)}`,
	);
	expect(response.status).toBe(200);
	return (await response.json()) as HistoryView;
}

describe("设定的故事副本", () => {
	it("改内容、类型与启停只影响这个故事的副本，卡与原条目不动", async () => {
		const { running } = await startTestServer();
		await seedStory(running, "story-1");
		await seedStory(running, "story-2");
		const before = await loreCopy(running, "story-1");
		const otherBefore = await loreCopy(running, "story-2");
		const entry = findEntry(before, "剑冢");
		const other = findEntry(otherBefore, "剑冢");

		const kindResponse = await patch(
			running.origin,
			`/api/stories/story-1/import-audit/entries/${encodeURIComponent(entry.source)}`,
			{ kind: "rule", kindSource: "player" },
		);
		expect(kindResponse.status).toBe(200);

		const saved = await post(
			running.origin,
			`/api/stories/story-1/lore-copy/${encodeURIComponent(entry.id)}`,
			{
				name: "断剑冢",
				content: "山后埋着历代断剑，剑灵仍在。",
				constant: true,
				keywords: ["断剑"],
			},
		);
		expect(saved.status).toBe(200);

		const edited = findEntry(await loreCopy(running, "story-1"), "断剑冢");
		expect(edited.content).toBe("山后埋着历代断剑，剑灵仍在。");
		expect(edited.constant).toBe(true);
		expect(edited.keywords).toEqual(["断剑"]);
		expect(edited.kind).toBe("rule");
		expect(edited.edited).toBe(true);
		expect(edited.locked).toBe(true);

		const untouched = findEntry(await loreCopy(running, "story-2"), "剑冢");
		expect(untouched.id).toBe(other.id);
		expect(untouched.content).toBe("山后埋着历代断剑。");
		expect(untouched.constant).toBe(false);
		expect(untouched.keywords).toEqual(["剑冢"]);
		expect(untouched.kind).toBe(other.kind);
		expect(untouched.edited).toBe(false);

		const stored = running.store
			.listLoreEntries("story-1")
			.find((item) => item.id === entry.id);
		expect(stored?.name).toBe("剑冢");
		expect(stored?.content).toBe("山后埋着历代断剑。");
		const cardResponse = await request(
			running.origin,
			"/api/stories/story-1/card",
		);
		expect(cardResponse.status).toBe(200);
		const card = (await cardResponse.json()) as {
			card: { name: string; version: string } | null;
		};
		expect(card.card?.name).toBe("云裳");
		expect(card.card?.version).toMatch(/^[0-9a-f]{16}$/);

		const disabled = await post(
			running.origin,
			`/api/stories/story-1/lore-copy/${encodeURIComponent(entry.id)}`,
			{ disabled: true },
		);
		expect(disabled.status).toBe(200);
		expect(
			findEntry(await loreCopy(running, "story-1"), "断剑冢").disabled,
		).toBe(true);
	});

	it("恢复原卡后内容复原，修改历史仍在并且可以回滚", async () => {
		const { running } = await startTestServer();
		await seedStory(running, "story-1");
		const entry = findEntry(await loreCopy(running, "story-1"), "剑冢");

		const saved = await post(
			running.origin,
			`/api/stories/story-1/lore-copy/${encodeURIComponent(entry.id)}`,
			{ content: "山后埋着断剑，剑灵仍在。" },
		);
		expect(saved.status).toBe(200);
		const first = await history(running, "story-1", entry.id);
		expect(first.edits).toHaveLength(1);
		expect(first.edits[0]?.source).toBe("player");

		const restored = await post(
			running.origin,
			`/api/stories/story-1/lore-copy/${encodeURIComponent(entry.id)}`,
			{ restore: true },
		);
		expect(restored.status).toBe(200);
		const afterRestore = findEntry(await loreCopy(running, "story-1"), "剑冢");
		expect(afterRestore.content).toBe("山后埋着历代断剑。");
		expect(afterRestore.edited).toBe(false);

		const second = await history(running, "story-1", entry.id);
		expect(second.edits).toHaveLength(2);
		expect(second.edits[0]?.value).toMatchObject({
			content: "山后埋着断剑，剑灵仍在。",
		});
		expect(second.edits[1]?.source).toBe("restore");

		const editId = second.edits[0]?.id;
		if (editId === undefined) throw new Error("修改历史没有第一条记录");
		const rolled = await post(
			running.origin,
			"/api/stories/story-1/memory/rollback",
			{ editId },
		);
		expect(rolled.status).toBe(200);
		expect(findEntry(await loreCopy(running, "story-1"), "剑冢").content).toBe(
			"山后埋着断剑，剑灵仍在。",
		);

		const restoreAll = await post(
			running.origin,
			"/api/stories/story-1/lore-copy/restore",
			{},
		);
		expect(restoreAll.status).toBe(200);
		expect(findEntry(await loreCopy(running, "story-1"), "剑冢").content).toBe(
			"山后埋着历代断剑。",
		);
		const third = await history(running, "story-1", entry.id);
		expect(third.edits).toHaveLength(4);
		expect(third.edits.map((edit) => edit.source)).toEqual([
			"player",
			"restore",
			"player",
			"restore",
		]);
	});
});

describe("设定的注入预览", () => {
	it("给出类型、生效条件与当前是否命中，并跟随类型修改", async () => {
		const { running } = await startTestServer();
		await seedStory(running, "story-1");
		running.store.appendNode({
			storyId: "story-1",
			parentId: null,
			role: "assistant",
			raw: "开场：山门外的风很冷。",
		});
		running.store.appendNode({
			storyId: "story-1",
			parentId: running.store.getHead("story-1")?.id ?? null,
			role: "user",
			raw: "我去剑冢看看那些断剑。",
		});
		const entry = findEntry(await loreCopy(running, "story-1"), "剑冢");

		const previewResponse = await request(
			running.origin,
			`/api/stories/story-1/lore-copy/${encodeURIComponent(entry.id)}/preview`,
		);
		expect(previewResponse.status).toBe(200);
		const preview = (await previewResponse.json()) as PreviewView;
		expect(preview.id).toBe(entry.id);
		expect(preview.kind).toBe(entry.kind);
		expect(preview.constant).toBe(false);
		expect(preview.keywords).toEqual(["剑冢"]);
		expect(preview.condition.length).toBeGreaterThan(0);
		expect(preview.hit).toBe(true);
		expect(preview.reason.length).toBeGreaterThan(0);

		const constantEntry = findEntry(
			await loreCopy(running, "story-1"),
			"山门规矩",
		);
		await patch(
			running.origin,
			`/api/stories/story-1/import-audit/entries/${encodeURIComponent(constantEntry.source)}`,
			{ kind: "event", kindSource: "player" },
		);
		const eventPreviewResponse = await request(
			running.origin,
			`/api/stories/story-1/lore-copy/${encodeURIComponent(constantEntry.id)}/preview`,
		);
		expect(eventPreviewResponse.status).toBe(200);
		const eventPreview = (await eventPreviewResponse.json()) as PreviewView;
		expect(eventPreview.kind).toBe("event");
		expect(eventPreview.hit).toBe(false);

		await post(
			running.origin,
			`/api/stories/story-1/lore-copy/${encodeURIComponent(entry.id)}`,
			{ disabled: true },
		);
		const disabledResponse = await request(
			running.origin,
			`/api/stories/story-1/lore-copy/${encodeURIComponent(entry.id)}/preview`,
		);
		const disabledPreview = (await disabledResponse.json()) as PreviewView;
		expect(disabledPreview.hit).toBe(false);
		expect(disabledPreview.condition).toContain("停用");
	});
});

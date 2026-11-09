import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Page, expect } from "@playwright/test";

export const PASSWORD = "e2e-password";
export const DB_PATH = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	".devloop",
	"scratch",
	"e2e",
	"work",
	"e2e.db",
);

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "林雪",
		description: "旧宅的守夜人，习惯在门厅点一盏灯。",
		first_mes: "门外的雨下了一整夜。",
		character_book: {
			name: "旧宅",
			entries: [
				{
					id: 1,
					keys: ["门厅"],
					comment: "门厅",
					content: "门厅的灯总是亮着，直到有人敲门。",
					enabled: true,
				},
			],
		},
	},
};

export async function login(
	page: Page,
	password: string = PASSWORD,
): Promise<void> {
	// 服务端没有设置访问密码时接口不校验会话，登录页的表单也提交不了空密码。
	if (password === "") {
		await page.goto("/");
		await page.waitForURL("**/");
		return;
	}
	await page.goto("/login");
	await page.getByLabel("访问密码").fill(password);
	await page.getByRole("button", { name: "登录" }).click();
	await page.waitForURL("**/");
}

export async function createImportedStory(
	page: Page,
	title: string,
): Promise<string> {
	const id = `e2e-${randomUUID()}`;
	const created = await page.request.post("/api/stories", {
		data: { id, title },
	});
	expect(created.ok()).toBeTruthy();
	const imported = await page.request.post(`/api/stories/${id}/import`, {
		data: { card: { format: "json", data: JSON.stringify(CARD) } },
	});
	expect(imported.ok()).toBeTruthy();
	return id;
}

export async function openStoryTab(
	page: Page,
	storyId: string,
	tab: "chat" | "branches" | "ledger" | "director" | "settings" | "channels",
): Promise<void> {
	await page.goto(`/stories/${storyId}/${tab}`);
	await page.locator(".story-content").waitFor();
}

export async function sendTurn(
	page: Page,
	storyId: string,
	text: string,
): Promise<void> {
	const before = await pathNodeCount(page, storyId);
	const composer = page.getByLabel("玩家行动");
	await composer.fill(text);
	await composer.press("Enter");
	await expect
		.poll(() => pathNodeCount(page, storyId), { timeout: 30_000 })
		.toBeGreaterThan(before);
	await expect(page.locator(".composer-send")).toBeVisible({ timeout: 30_000 });
	await expect(
		page.locator(".floor-assistant").filter({ hasText: text }).last(),
	).toBeVisible({ timeout: 30_000 });
}

export function readPreferenceCounts(storyId: string): Map<string, number> {
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		const rows = db
			.prepare(
				"SELECT kind, COUNT(*) AS count FROM preference_events WHERE story_id = ? GROUP BY kind",
			)
			.all(storyId) as { kind: string; count: number }[];
		return new Map(rows.map((row) => [row.kind, Number(row.count)]));
	} finally {
		db.close();
	}
}

export function insertChangeCard(input: {
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly id: string;
	readonly text: string;
	readonly diffs: unknown;
	readonly before: unknown;
}): void {
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		db.prepare(
			`INSERT INTO ledger_change_cards
				(id, story_id, source, source_node_id, text, diffs, before, status, rejection_reason, created_at, decided_at)
			VALUES (?, ?, 'settler', ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
		).run(
			input.id,
			input.storyId,
			input.sourceNodeId,
			input.text,
			JSON.stringify(input.diffs),
			JSON.stringify(input.before),
			new Date().toISOString(),
		);
	} finally {
		db.close();
	}
}

export async function latestAssistantNodeId(page: Page, storyId: string) {
	const response = await page.request.get(`/api/stories/${storyId}/path`, {
		params: { limit: 200 },
	});
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as {
		nodes: readonly { id: string; role: string }[];
	};
	const assistant = [...body.nodes]
		.reverse()
		.find((node) => node.role === "assistant");
	expect(assistant).toBeDefined();
	return assistant?.id as string;
}

export async function pathNodeCount(
	page: Page,
	storyId: string,
): Promise<number> {
	const response = await page.request.get(`/api/stories/${storyId}/path`, {
		params: { limit: 200 },
	});
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as {
		nodes: readonly { id: string }[];
	};
	return body.nodes.length;
}

export async function totalNodeCount(
	page: Page,
	storyId: string,
): Promise<number> {
	const response = await page.request.get(`/api/stories/${storyId}/tree`);
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as {
		nodes: readonly { id: string }[];
	};
	return body.nodes.length;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	const scrollWidth = await page.evaluate(
		() => document.documentElement.scrollWidth,
	);
	expect(scrollWidth).toBeLessThanOrEqual(viewport?.width ?? 0);
}

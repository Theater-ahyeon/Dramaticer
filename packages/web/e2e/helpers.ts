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

/** 在故事页发一轮并等它写完。调用前页面要停在 `/stories/:id/play`。 */
export async function sendTurn(
	page: Page,
	storyId: string,
	text: string,
): Promise<void> {
	const before = await pathNodeCount(page, storyId);
	await page.locator(".say textarea").fill(text);
	await page.getByRole("button", { name: "发送" }).click();
	await expect
		.poll(() => pathNodeCount(page, storyId), { timeout: 30_000 })
		.toBeGreaterThan(before + 1);
	await expect(page.getByRole("button", { name: "停下" })).toHaveCount(0, {
		timeout: 30_000,
	});
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

/** 重 roll 记录的载荷；按写入顺序，最后一条是最近一次重 roll。 */
export function readSwipeReasons(
	storyId: string,
): readonly (string | undefined)[] {
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		const rows = db
			.prepare(
				"SELECT payload FROM preference_events WHERE story_id = ? AND kind = 'swipe' ORDER BY created_at ASC, rowid ASC",
			)
			.all(storyId) as { payload: string }[];
		return rows.map((row) => {
			const payload: unknown = JSON.parse(row.payload);
			if (typeof payload !== "object" || payload === null) return undefined;
			if (!("reason" in payload)) return undefined;
			return typeof payload.reason === "string" ? payload.reason : undefined;
		});
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

/** 路径上最后一条玩家楼层；导演决策记录写在这里。 */
export async function latestUserNodeId(
	page: Page,
	storyId: string,
): Promise<string> {
	const response = await page.request.get(`/api/stories/${storyId}/path`, {
		params: { limit: 200 },
	});
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as {
		nodes: readonly { id: string; role: string }[];
	};
	const user = [...body.nodes].reverse().find((node) => node.role === "user");
	expect(user).toBeDefined();
	return user?.id as string;
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

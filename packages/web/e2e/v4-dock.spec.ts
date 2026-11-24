import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type Page, expect, test } from "@playwright/test";
import { DB_PATH, expectNoHorizontalOverflow, login } from "./helpers";

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
					comment: "人物 · 门厅",
					content: "门厅的灯总是亮着，直到有人敲门。",
					enabled: true,
				},
			],
		},
	},
} as const;

/** 手机上停靠栏是底部抽屉，先从书页顶上的按钮打开；桌面上它一直在。 */
async function openDock(page: Page): Promise<void> {
	const opener = page.locator(".dockbtn");
	if (await opener.isVisible()) {
		await opener.click();
		await expect(page.locator(".dockwrap")).toHaveClass(/open/);
	}
}

async function createDockStory(page: Page, title: string): Promise<string> {
	const id = `e2e-dock-${randomUUID()}`;
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

interface LoreCopyView {
	readonly entries: readonly { readonly id: string; readonly name: string }[];
}

/** 第一楼：场次、状态、两条剧情线与一条伏笔、一次导演安排、一份上下文记录。 */
function seedDockStory(storyId: string, loreId: string): string {
	const nodeId = `${storyId}-head`;
	const createdAt = new Date().toISOString();
	const statusPath = JSON.stringify(["character", "老周", "status"]);
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		db.prepare(
			"INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at) VALUES (?, ?, NULL, 'assistant', ?, ?)",
		).run(
			nodeId,
			storyId,
			"门厅里只剩一盏灯。林雪把那封信推回桌面，说先别看。",
			createdAt,
		);
		db.prepare("UPDATE stories SET head_node_id = ? WHERE id = ?").run(
			nodeId,
			storyId,
		);
		db.prepare(
			`INSERT INTO scene_logs (node_id, story_id, beat, present, scene_ends, bits, conditions, states, quote_submitted, quote_verified, repairs, created_at, scene_card)
			 VALUES (?, ?, '试探', ?, 0, '[]', '[]', '[]', 0, 0, '[]', ?, ?)`,
		).run(
			nodeId,
			storyId,
			JSON.stringify(["林雪"]),
			createdAt,
			JSON.stringify({
				present: [{ who: "林雪", want: "确认门外是谁" }],
				change: "雨声停了",
			}),
		);
		db.prepare(
			`INSERT INTO state_diffs (story_id, node_id, ordinal, path, op, value, reason, source, created_at)
			 VALUES (?, ?, 0, ?, 'set', ?, '听到门后的脚步', 'settler', ?)`,
		).run(storyId, nodeId, statusPath, JSON.stringify("警觉"), createdAt);
		db.prepare(
			`INSERT INTO entities (id, story_id, kind, name, normalized_name, description, source, created_at)
			 VALUES (?, ?, 'character', ?, ?, ?, 'card', ?)`,
		).run(
			`${storyId}-laozhou`,
			storyId,
			"老周",
			"老周",
			"守夜的老邻居。",
			createdAt,
		);
		db.prepare(
			"INSERT INTO director_lines (node_id, story_id, diffs, created_at) VALUES (?, ?, ?, ?)",
		).run(
			nodeId,
			storyId,
			JSON.stringify([
				{
					action: "set",
					line: {
						id: "l1",
						kind: "main",
						who: "林雪",
						want: "找到那封信的寄件人",
						obstacle: "门外的脚步一直在等",
						countdown: 4,
						preparations: ["去码头问一次"],
					},
				},
				{
					action: "set",
					line: {
						id: "l2",
						kind: "opposition",
						who: "贺九",
						want: "把灯塔里的灯搬空",
						obstacle: "林雪整夜守着门厅",
						countdown: null,
						preparations: [],
					},
				},
				{
					action: "set",
					line: {
						id: "l3",
						kind: "promise",
						who: "阿蘅",
						want: "值更簿缺的那一页",
						obstacle: "被整整齐齐裁掉了",
						countdown: null,
						preparations: [],
					},
				},
			]),
			createdAt,
		);
		db.prepare(
			`INSERT INTO director_decisions (node_id, story_id, directive, mechanisms, signals, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run(
			nodeId,
			storyId,
			"把信推到桌下，等门外的人先开口",
			JSON.stringify([
				{
					name: "advance",
					triggered: true,
					reason: "这一场要确认门外的脚步",
				},
			]),
			JSON.stringify({ action: "catch", lineId: "l1" }),
			createdAt,
		);
		db.prepare(
			"INSERT INTO traces (node_id, story_id, trace, created_at) VALUES (?, ?, ?, ?)",
		).run(
			nodeId,
			storyId,
			JSON.stringify({
				storyId,
				nodeId,
				parentNodeId: null,
				templateId: "test",
				turnMode: "fast",
				profile: "native",
				createdAt,
				context: {
					budgetTokens: 4096,
					totalTokens: 260,
					entries: [
						{
							segmentId: "s-history",
							kind: "slot",
							slot: "history",
							source: "history",
							priority: 0,
							tokens: 120,
							status: "included",
							items: [
								{
									label: "第 1 楼原文",
									tokens: 120,
									source: { kind: "floor", nodeId, floorNo: 1 },
								},
							],
						},
						{
							segmentId: "s-state",
							kind: "slot",
							slot: "state",
							source: "state",
							priority: 0,
							tokens: 20,
							status: "included",
							items: [
								{
									label: "老周 · 状态",
									tokens: 20,
									source: {
										kind: "state",
										target: statusPath,
										label: "状态",
									},
								},
							],
						},
						{
							segmentId: "s-profile",
							kind: "slot",
							slot: "profile",
							source: "profile",
							priority: 0,
							tokens: 30,
							status: "included",
							items: [
								{
									label: "老周",
									tokens: 30,
									source: {
										kind: "wiki",
										id: `${storyId}-laozhou`,
										name: "老周",
									},
								},
							],
						},
						{
							segmentId: "s-lore",
							kind: "slot",
							slot: "lore",
							source: "lore",
							priority: 0,
							tokens: 90,
							status: "included",
							items: [
								{
									label: "门厅",
									tokens: 90,
									source: { kind: "lore", id: loreId, name: "门厅" },
								},
							],
						},
					],
				},
				llm: {
					model: "fake-model",
					channel: "fake-channel",
					stopReason: "stop",
					finishReason: "stop",
					truncations: [],
					usage: {
						promptTokens: 260,
						completionTokens: 40,
						totalTokens: 300,
						reasoningTokens: 0,
						cachedTokens: 0,
					},
					attempts: 1,
					rounds: 1,
					cached: false,
				},
				tools: {
					transport: "native",
					rounds: 0,
					maxRounds: 3,
					capped: false,
					calls: [],
					rejected: [],
				},
				structured: {
					mode: "text-tags",
					acceptedStateUpdates: 0,
					acceptedNotes: 0,
					issues: [],
				},
				timing: { firstTokenMs: 100, durationMs: 500 },
				deep: null,
				run: null,
			}),
			createdAt,
		);
	} finally {
		db.close();
	}
	return nodeId;
}

async function loreEntryId(page: Page, storyId: string): Promise<string> {
	const response = await page.request.get(`/api/stories/${storyId}/lore-copy`);
	expect(response.ok()).toBeTruthy();
	const view = (await response.json()) as LoreCopyView;
	const entry = view.entries[0];
	if (entry === undefined) throw new Error("导入的卡没有设定条目");
	return entry.id;
}

test.describe("故事页停靠栏：导演、记忆与上下文", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("剧情线能置顶与静音，导演安排能撤回，上下文每一条都能跳到修改处", async ({
		page,
	}) => {
		const stamp = Date.now();
		const title = `停靠栏 ${stamp}`;
		const storyId = await createDockStory(page, title);
		const loreId = await loreEntryId(page, storyId);
		const nodeId = seedDockStory(storyId, loreId);

		await page.goto(`/stories/${storyId}/play`);
		await openDock(page);
		const dock = page.locator("#dock");
		await expect(dock).toBeVisible();
		await expectNoHorizontalOverflow(page);

		// 导演一页：剧情线、伏笔与导演做过什么。
		const threads = dock.locator(".thread");
		const heJiu = threads.filter({
			has: page.locator("h3", { hasText: /^贺九想要/ }),
		});
		const linXue = threads.filter({
			has: page.locator("h3", { hasText: /^林雪想要/ }),
		});
		await expect(threads).toHaveCount(2);
		await expect(dock).toContainText("没收 1 / 上限");

		// 置顶：这条线排到最前，按钮变成取消置顶。
		await heJiu.getByRole("button", { name: "我想看这条" }).click();
		await expect(heJiu).toHaveClass(/pin/);
		await expect(threads.first()).toContainText("贺九");
		await expect(heJiu.getByRole("button", { name: "取消置顶" })).toBeVisible();

		// 静音：这一条变灰，可以恢复。
		await heJiu.getByRole("button", { name: "别再提了" }).click();
		await expect(heJiu).toHaveClass(/off/);
		await expect(heJiu.getByRole("button", { name: "恢复" })).toBeVisible();

		// 撤回导演安排：安排变成已撤回，它推的那条线被静音。
		const move = dock
			.locator(".rows > div")
			.filter({ hasText: "接球" })
			.first();
		await expect(move).toContainText("第 1 楼");
		await move.getByRole("button", { name: "撤回" }).click();
		await expect(
			dock.locator(".rows > div").filter({ hasText: "已撤回" }).first(),
		).toBeVisible();
		await expect(linXue).toHaveClass(/off/);
		await expectNoHorizontalOverflow(page);

		// 上下文：每一条带着自己的去向。
		await dock.getByRole("tab", { name: "上下文" }).click();
		await expect(dock).toContainText("本轮上下文");
		await expect(dock).not.toContainText("token");

		// 设定条目：跳到设定页并展开这一条。
		await dock.getByRole("button", { name: "设定", exact: true }).click();
		const loreLink = dock
			.locator(".ctxitems > div")
			.filter({ hasText: "门厅" })
			.getByRole("link", { name: "去修改 ›" });
		await expect(loreLink).toHaveAttribute(
			"href",
			new RegExp(`/lore\\?entry=${encodeURIComponent(loreId)}`),
		);
		await loreLink.click();
		await expect(page.locator('[data-view="lore"]')).toBeVisible();
		const entry = page.locator(`#entry-${loreId}`);
		await expect(entry.locator("textarea")).toHaveValue(
			"门厅的灯总是亮着，直到有人敲门。",
		);

		// 返回后看百科条目：跳到记忆页并选中老周这一页。
		await page.goto(`/stories/${storyId}/play`);
		await openDock(page);
		await page.locator("#dock").getByRole("tab", { name: "上下文" }).click();
		await page
			.locator("#dock")
			.getByRole("button", { name: "百科", exact: true })
			.click();
		const wikiLink = page
			.locator("#dock .ctxitems > div")
			.filter({ hasText: "老周" })
			.getByRole("link", { name: "去修改 ›" });
		await expect(wikiLink).toHaveAttribute("href", /memory\?tab=wiki&page=/);
		await wikiLink.click();
		await expect(page.locator('[data-view="memory"]')).toBeVisible();
		await expect(page.locator(".page h2")).toHaveText("老周");
		await expect(page.locator(".page")).toHaveClass(/is-focus/);

		// 状态：跳到记忆页的状态分页并标出那一行。
		await page.goto(`/stories/${storyId}/play`);
		await openDock(page);
		await page.locator("#dock").getByRole("tab", { name: "上下文" }).click();
		await page
			.locator("#dock")
			.getByRole("button", { name: "此刻局面", exact: true })
			.click();
		await page
			.locator("#dock .ctxitems > div")
			.filter({ hasText: "老周 · 状态" })
			.getByRole("link", { name: "去修改 ›" })
			.click();
		await expect(page.locator('[data-view="memory"]')).toBeVisible();
		await expect(page.locator(".tbl tbody tr.is-focus")).toContainText("警觉");

		// 原文：跳回故事页并翻到那一楼。
		await page.goto(`/stories/${storyId}/play`);
		await openDock(page);
		await page.locator("#dock").getByRole("tab", { name: "上下文" }).click();
		await page
			.locator("#dock")
			.getByRole("button", { name: "原文", exact: true })
			.click();
		await page
			.locator("#dock .ctxitems > div")
			.filter({ hasText: "第 1 楼原文" })
			.getByRole("link", { name: "去修改 ›" })
			.click();
		await expect(page).toHaveURL(
			new RegExp(`/play\\?node=${encodeURIComponent(nodeId)}`),
		);
		await expect(page.locator(`#floor-${nodeId}`)).toBeVisible();
		await expectNoHorizontalOverflow(page);
	});
});

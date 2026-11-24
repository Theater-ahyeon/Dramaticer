import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { DB_PATH, expectNoHorizontalOverflow, login } from "./helpers";

interface SeedResult {
	readonly storyId: string;
}

/** 一楼两楼、两个实体、一条带原文摘录的记录、一条秘密、一场摘要与一条状态。 */
function seedMemory(storyId: string): void {
	const createdAt = new Date().toISOString();
	const first = `${storyId}-n1`;
	const second = `${storyId}-n2`;
	const hero = `${storyId}-aheng`;
	const tower = `${storyId}-tower`;
	const secret = `${storyId}-secret`;
	const witness = `${storyId}-witness`;
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		db.prepare(
			"INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at) VALUES (?, ?, NULL, 'assistant', ?, ?)",
		).run(first, storyId, "阿蘅站在旧灯塔下，手里捏着一把钥匙。", createdAt);
		db.prepare(
			"INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at) VALUES (?, ?, ?, 'assistant', ?, ?)",
		).run(
			second,
			storyId,
			first,
			"她把钥匙交给魏临，没解释从哪里来。",
			createdAt,
		);
		db.prepare("UPDATE stories SET head_node_id = ? WHERE id = ?").run(
			second,
			storyId,
		);

		db.prepare(
			`INSERT INTO entities (id, story_id, kind, name, normalized_name, description, source, created_at)
			 VALUES (?, ?, 'character', '阿蘅', '阿蘅', ?, 'card', ?)`,
		).run(hero, storyId, "灯塔看守的女儿，常去旧灯塔等父亲的消息。", createdAt);
		db.prepare(
			`INSERT INTO entities (id, story_id, kind, name, normalized_name, description, source, created_at)
			 VALUES (?, ?, 'location', '旧灯塔', '旧灯塔', ?, 'card', ?)`,
		).run(tower, storyId, "雾港西角的石塔，四层。", createdAt);

		insertState(db, storyId, first, 0, "警觉");
		insertState(db, storyId, second, 0, "放松");

		db.prepare(
			`INSERT INTO memory_events
				(id, story_id, source_node_id, ordinal, participants, importance, knowers, text, created_at)
			 VALUES (?, ?, ?, 0, ?, 0.8, ?, ?, ?)`,
		).run(
			secret,
			storyId,
			first,
			JSON.stringify(["阿蘅"]),
			JSON.stringify(["阿蘅"]),
			"阿蘅把钥匙藏进灯塔",
			createdAt,
		);
		db.prepare(
			`INSERT INTO memory_events
				(id, story_id, source_node_id, ordinal, participants, importance, knowers, text, created_at)
			 VALUES (?, ?, ?, 0, ?, 0.2, '[]', ?, ?)`,
		).run(
			witness,
			storyId,
			second,
			JSON.stringify(["魏临"]),
			"魏临在码头值夜",
			createdAt,
		);
		db.prepare(
			"INSERT INTO memory_event_quotes (event_id, story_id, quote) VALUES (?, ?, ?)",
		).run(secret, storyId, "钥匙在灯塔顶层的灯座底下。");

		db.prepare(
			`INSERT INTO scene_archives
				(end_node_id, story_id, start_node_id, floor_count, boundary, summary,
				 present, state_changes, clues_opened, clues_closed, created_at)
			 VALUES (?, ?, ?, 2, 'scene-ends', ?, ?, ?, '[]', '[]', ?)`,
		).run(
			second,
			storyId,
			first,
			"阿蘅交出钥匙，魏临没有追问。",
			JSON.stringify(["阿蘅", "魏临"]),
			JSON.stringify([
				{ path: ["character", "阿蘅", "status"], change: "警觉变放松" },
			]),
			createdAt,
		);
	} finally {
		db.close();
	}
}

function insertState(
	db: DatabaseSync,
	storyId: string,
	nodeId: string,
	ordinal: number,
	value: string,
): void {
	db.prepare(
		`INSERT INTO state_diffs
			(story_id, node_id, ordinal, path, op, value, reason, source, created_at)
		 VALUES (?, ?, ?, ?, 'set', ?, '她听见了脚步声', 'settler', ?)`,
	).run(
		storyId,
		nodeId,
		ordinal,
		JSON.stringify(["character", "阿蘅", "status"]),
		JSON.stringify(value),
		new Date().toISOString(),
	);
}

async function createStory(page: Page, title: string): Promise<string> {
	const storyId = `e2e-v4-memory-${randomUUID()}`;
	const created = await page.request.post("/api/stories", {
		data: { id: storyId, title },
	});
	expect(created.ok()).toBeTruthy();
	seedMemory(storyId);
	const pref = await page.request.post(`/api/stories/${storyId}/memory/prefs`, {
		data: { text: "不要替我说话" },
	});
	expect(pref.ok()).toBeTruthy();
	return storyId;
}

async function editFloor(
	page: Page,
	locator: Locator,
	text: string,
): Promise<void> {
	await locator.click();
	await locator.fill(text);
	await page.locator("h1").click();
}

test.describe("新界面记忆页", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("五个分页都能就地修改，锁定后可撤销，百科链接与原文摘录可用", async ({
		page,
	}) => {
		const stamp = Date.now();
		const storyId = await createStory(page, `记忆页 ${stamp}`);
		await page.goto(`/stories/${storyId}/memory`);

		const memory = page.locator('[data-view="memory"]');
		await expect(memory).toBeVisible();
		await expect(memory.locator("h1")).toHaveText("记忆");

		// 百科：两页都在，点简介里的名字能跳到另一页。
		const pages = memory.locator(".plist");
		await expect(pages.getByRole("button", { name: /阿蘅/ })).toBeVisible();
		await expect(pages.getByRole("button", { name: /旧灯塔/ })).toBeVisible();
		await pages.getByRole("button", { name: /阿蘅/ }).click();
		await expect(memory.locator("article.page h2")).toHaveText("阿蘅");
		await memory.locator("article.page .lead a", { hasText: "旧灯塔" }).click();
		await expect(memory.locator("article.page h2")).toHaveText("旧灯塔");
		await pages.getByRole("button", { name: /阿蘅/ }).click();

		// 原文摘录默认收起，点一下展开。
		const quoted = memory
			.locator(".st")
			.filter({ hasText: "阿蘅把钥匙藏进灯塔" });
		await expect(quoted.locator(".raw")).toHaveCount(0);
		await quoted.getByRole("button", { name: "原文" }).click();
		await expect(quoted.locator(".raw")).toHaveText(
			"钥匙在灯塔顶层的灯座底下。",
		);

		// 就地改一句：锁定标记出现，提示条可以撤销。
		await editFloor(
			page,
			quoted.locator("p").first(),
			"阿蘅把钥匙藏进灯塔的灯座",
		);
		await expect(quoted.locator("p").first()).toHaveText(
			"阿蘅把钥匙藏进灯塔的灯座",
		);
		await expect(
			quoted.getByRole("button", { name: "已锁定" }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(quoted.locator(".pill", { hasText: "你改的" })).toBeVisible();
		await page.locator(".toast").getByRole("button", { name: "撤销" }).click();
		await expect(
			memory
				.locator(".st")
				.filter({ hasText: "阿蘅把钥匙藏进灯塔" })
				.locator("p")
				.first(),
		).toHaveText("阿蘅把钥匙藏进灯塔");

		// 状态：就地改一项，显示锁定，历史可以回到旧值。
		await memory
			.locator(".subtabs")
			.getByRole("button", { name: "此刻局面" })
			.click();
		const stateRow = memory
			.locator(".tbl tbody tr")
			.filter({ hasText: "status" })
			.first();
		const stateCell = stateRow.locator("td").nth(2);
		await editFloor(page, stateCell, "戒备");
		await expect(
			stateRow.locator(".pill", { hasText: "已锁定" }),
		).toBeVisible();
		await page.locator(".toast").getByRole("button", { name: "撤销" }).click();
		await expect(stateCell).toHaveText("放松");

		// 秘密：改正文后显示锁定。
		await memory
			.locator(".subtabs")
			.getByRole("button", { name: "秘密" })
			.click();
		const secretRow = memory.locator(".tbl tbody tr").first();
		await editFloor(
			page,
			secretRow.locator("td").first(),
			"阿蘅把钥匙藏在灯塔顶层",
		);
		await expect(
			secretRow.locator(".pill", { hasText: "已锁定" }),
		).toBeVisible();

		// 时间线：改摘要后显示锁定。
		await memory
			.locator(".subtabs")
			.getByRole("button", { name: "时间线" })
			.click();
		const scene = memory.locator(".spine details").first();
		await expect(scene).toHaveAttribute("open", "");
		await editFloor(page, scene.locator(".sum"), "阿蘅交出第二把钥匙。");
		await expect(scene.locator("summary")).toContainText("已锁定");

		// 偏好：改一句后显示锁定，提示条撤销能恢复原句。
		await memory
			.locator(".subtabs")
			.getByRole("button", { name: "偏好" })
			.click();
		const prefRow = memory.locator(".rows > div").first();
		await editFloor(page, prefRow.locator("span").first(), "别替我说话");
		await expect(prefRow.locator(".pill", { hasText: "已锁定" })).toBeVisible();
		await page.locator(".toast").getByRole("button", { name: "撤销" }).click();
		await expect(prefRow.locator("span").first()).toHaveText("不要替我说话");

		await expectNoHorizontalOverflow(page);
	});
});

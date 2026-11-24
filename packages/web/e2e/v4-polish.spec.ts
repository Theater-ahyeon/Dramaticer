import { randomUUID } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import {
	expectNoHorizontalOverflow,
	login,
	pathNodeCount,
	readPreferenceCounts,
	totalNodeCount,
} from "./helpers";

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

async function createStory(page: Page, storyId: string): Promise<void> {
	const created = await page.request.post("/api/stories", {
		data: { id: storyId, title: `全流程 ${storyId}` },
	});
	expect(created.ok()).toBeTruthy();
}

async function palette(page: Page, text: string): Promise<void> {
	await page.keyboard.press("Control+K");
	const input = page.locator(".pal input");
	await expect(input).toBeFocused();
	await input.fill(text);
	await expect(page.locator(".pal li").first()).toContainText(text);
	await page.keyboard.press("Enter");
	await expect(page.locator(".pal")).toHaveCount(0);
}

test.describe("命令面板与手机全流程", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("Ctrl K 跳转与执行动作，窄屏完成导入、推进、重写与改记忆", async ({
		page,
	}) => {
		const storyId = `e2e-polish-${randomUUID()}`;
		await createStory(page, storyId);

		// 导入：在窄屏上选卡、提交，并看到卡片自身的数量统计。
		await page.goto(`/stories/${storyId}/import`);
		await page.getByLabel("角色卡文件").setInputFiles({
			name: "lin-xue.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(CARD), "utf8"),
		});
		await page.getByRole("button", { name: "导入", exact: true }).click();
		await expect(page.locator(".import-result h2")).toHaveText("林雪");
		await expectNoHorizontalOverflow(page);

		// 命令面板：先跳到大纲，再回到故事页。
		await palette(page, "打开大纲");
		await expect(page.locator('[data-view="outline"]')).toBeVisible();
		await expect(page).toHaveURL(new RegExp(`/stories/${storyId}/outline$`));
		await palette(page, "继续写故事");
		await expect(page.locator('[data-view="play"]')).toBeVisible();
		await expect(page.locator(".cmp")).toBeVisible();

		const viewport = page.viewportSize();
		if (viewport !== null && viewport.width <= 760) {
			const rail = page.locator(".rail");
			await expect(rail.getByRole("link", { name: "故事" })).toBeVisible();
			const box = await rail.boundingBox();
			expect(box).not.toBeNull();
			expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(
				viewport.height - 80,
			);
		}

		// 命令面板执行动作：推进一步，正文与状态都落在这个故事上。
		const beforePush = await pathNodeCount(page, storyId);
		await palette(page, "推进一步");
		await expect
			.poll(() => pathNodeCount(page, storyId), { timeout: 60_000 })
			.toBeGreaterThan(beforePush);
		await expect(
			page.locator(".notes .fno").filter({ hasText: /^第 \d+ 楼$/ }),
		).toHaveCount(1, { timeout: 60_000 });

		// 手机输入台：写一句自己的行动并发送。
		const beforeSay = await pathNodeCount(page, storyId);
		await page.locator(".cmp textarea").fill("我推门进去，问门外的人是谁。");
		await page
			.locator(".cmp .say")
			.getByRole("button", { name: "发送" })
			.click();
		await expect
			.poll(() => pathNodeCount(page, storyId), { timeout: 60_000 })
			.toBeGreaterThan(beforeSay);
		await expectNoHorizontalOverflow(page);

		// 重写：选中原因后才发出请求，旧楼层留在树里。
		const beforeReroll = await totalNodeCount(page, storyId);
		const rewrite = page.getByRole("button", { name: "重写", exact: true });
		await expect(rewrite).toBeEnabled({ timeout: 60_000 });
		await rewrite.click();
		await expect(page.locator(".why")).toBeVisible();
		await page.locator(".why .chip", { hasText: "太短" }).click();
		await expect
			.poll(() => readPreferenceCounts(storyId).get("swipe") ?? 0, {
				timeout: 60_000,
			})
			.toBe(1);
		await expect
			.poll(() => totalNodeCount(page, storyId), { timeout: 60_000 })
			.toBeGreaterThan(beforeReroll);

		// 改记忆：这一轮记下的状态可以就地改，改完显示已锁定。
		await page.goto(`/stories/${storyId}/memory?tab=state`);
		const memory = page.locator('[data-view="memory"]');
		const stateRow = memory
			.locator(".tbl tbody tr")
			.filter({ hasText: "status" })
			.first();
		await expect(stateRow).toBeVisible();
		const cell = stateRow.locator("td").nth(2);
		await cell.click();
		await cell.fill("戒备");
		await memory.locator("h1").click();
		await expect(cell).toHaveText("戒备");
		await expect(
			stateRow.locator(".pill", { hasText: "已锁定" }),
		).toBeVisible();
		await expectNoHorizontalOverflow(page);
	});
});

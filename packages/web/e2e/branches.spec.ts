import { type Page, expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	login,
	openStoryTab,
	sendTurn,
	totalNodeCount,
} from "./helpers";

function assistantRow(page: Page, text: string) {
	return page
		.locator(".branch-row")
		.filter({ has: page.locator(".branch-role-assistant") })
		.filter({ hasText: text })
		.first()
		.locator(".branch-select");
}

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("编辑与改写新建分支，旧楼层保留，head 可以切换回去", async ({ page }) => {
	const storyId = await createImportedStory(page, "分支端到端");
	await openStoryTab(page, storyId, "chat");
	await sendTurn(page, storyId, "分支起点");
	await openStoryTab(page, storyId, "branches");
	await page.locator(".branch-select").first().waitFor();

	await assistantRow(page, "分支起点").click();
	await page.getByRole("button", { name: "编辑正文" }).click();
	await page.getByLabel("编辑后的正文").fill("编辑出来的新分支");
	await page.getByRole("button", { name: "保存编辑" }).click();
	await expect(
		page.locator(".branch-preview", { hasText: "编辑出来的新分支" }),
	).toBeVisible();
	const afterEdit = await totalNodeCount(page, storyId);

	await assistantRow(page, "分支起点").click();
	await page.getByRole("button", { name: "改写（新建分支）" }).click();
	await page.getByLabel("新分支的正文").fill("改写出来的分支");
	await page.getByRole("button", { name: "新建分支", exact: true }).click();
	await expect(
		page.locator(".branch-preview", { hasText: "改写出来的分支" }),
	).toBeVisible();
	await expect
		.poll(() => totalNodeCount(page, storyId))
		.toBeGreaterThan(afterEdit);

	await page
		.locator(".branch-row")
		.filter({ hasText: "编辑出来的新分支" })
		.first()
		.locator(".branch-select")
		.click();
	const rawBeforeSwitch = await page.locator(".branch-detail-raw").innerText();
	expect(rawBeforeSwitch).toContain("编辑出来的新分支");
	await page.getByRole("button", { name: "切换到此楼层" }).click();
	await page.getByRole("button", { name: "确认切换" }).click();
	await expect(page.locator(".branch-row-head .branch-preview")).toContainText(
		"编辑出来的新分支",
	);

	await assistantRow(page, "分支起点").click();
	await expect(page.locator(".branch-detail-raw")).toContainText("分支起点");
	await expect(page.locator(".branch-detail-raw")).not.toContainText(
		"编辑出来的新分支",
	);
	await expectNoHorizontalOverflow(page);
});

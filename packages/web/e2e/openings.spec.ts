import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	login,
	openStoryTab,
	pathNodeCount,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("开场候选自动出现，重新生成追加新一批，选中后成为根楼层", async ({
	page,
}) => {
	const storyId = await createImportedStory(page, "开场端到端");
	await openStoryTab(page, storyId, "chat");
	await expect(page.locator(".opening-candidate")).toHaveCount(3, {
		timeout: 30_000,
	});

	await page.getByRole("button", { name: "重新生成候选" }).click();
	await expect(page.locator(".opening-candidate")).toHaveCount(6, {
		timeout: 30_000,
	});
	await expect(page.locator(".opening-new")).toHaveCount(3);

	const chosen = page.locator(".opening-candidate").first();
	const chosenText = (await chosen.locator(".opening-raw").innerText()).trim();
	await chosen.getByRole("button", { name: "用这一条" }).click();
	await expect(page.locator(".opening-candidates")).toHaveCount(0);
	await expect(page.locator(".floor-assistant")).toContainText(chosenText);
	expect(await pathNodeCount(page, storyId)).toBe(1);
	await expectNoHorizontalOverflow(page);
});

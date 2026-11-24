import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("故事页向上加载更早楼层，最早楼层可以看到", async ({ page }) => {
	await page.goto("/stories/e2e-pagination/play");
	const floors = page.locator("#script article.flr");
	await floors.first().waitFor();
	const older = page.getByRole("button", { name: "更早的楼层" });
	await expect(older).toBeVisible();
	const initial = await floors.count();

	await older.click();
	await expect.poll(() => floors.count()).toBeGreaterThan(initial);
	// 一直往上翻到头，按钮消失，最早一楼出现。
	for (let round = 0; round < 10; round += 1) {
		if ((await older.count()) === 0) break;
		await older.click();
		await page.waitForTimeout(300);
	}
	await expect(older).toHaveCount(0, { timeout: 20_000 });
	await expect(page.getByText("楼层-1-user")).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

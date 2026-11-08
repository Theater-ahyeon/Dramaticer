import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("路径分页向上加载更早楼层，最早楼层可以滚动到", async ({ page }) => {
	await page.goto("/stories/e2e-pagination/chat");
	await page.locator(".floor").first().waitFor();
	const scroller = page.locator(".chat-scroll");
	await expect(page.locator(".chat-load-older")).toBeVisible();
	const initialHeight = await scroller.evaluate(
		(element) => element.scrollHeight,
	);

	const scrollToTop = () =>
		scroller.evaluate((element) => {
			element.scrollTop = 0;
			element.dispatchEvent(new Event("scroll", { bubbles: true }));
		});

	await scrollToTop();
	await expect
		.poll(
			async () =>
				(await scroller.evaluate((element) => element.scrollHeight)) >
				initialHeight,
		)
		.toBe(true);
	await expect(page.locator(".chat-load-older")).toBeVisible();
	const secondHeight = await scroller.evaluate(
		(element) => element.scrollHeight,
	);

	await scrollToTop();
	await expect(page.locator(".chat-load-older")).toHaveCount(0, {
		timeout: 20_000,
	});
	await expect
		.poll(
			async () =>
				(await scroller.evaluate((element) => element.scrollHeight)) >
				secondHeight,
		)
		.toBe(true);

	await scrollToTop();
	await expect(page.getByText("楼层-1-user")).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

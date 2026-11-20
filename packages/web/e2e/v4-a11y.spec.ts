import { type Locator, type Page, expect, test } from "@playwright/test";
import { createImportedStory, login } from "./helpers";

// 可访问性验收（ui-lite/06）：只用键盘走完主流程，每一步焦点都看得见；
// 系统要求减少动效时，页面上没有在跑的动画。

const committed = (page: Page) =>
	page.locator(".notes .fno").filter({ hasText: /^第 \d+ 楼$/ });

/** 一直按 Tab，直到目标拿到焦点；顺便确认焦点有可见的标记（描边或光圈）。 */
async function tabTo(page: Page, target: Locator, max = 150): Promise<void> {
	for (let i = 0; i < max; i++) {
		await page.keyboard.press("Tab");
		const focused = await target
			.evaluate((el) => el === document.activeElement)
			.catch(() => false);
		if (!focused) continue;
		const ring = await target.evaluate((el) => {
			const style = getComputedStyle(el);
			const outline =
				style.outlineStyle !== "none" &&
				Number.parseFloat(style.outlineWidth) > 0;
			return outline || style.boxShadow !== "none";
		});
		expect(ring, "拿到焦点的元素要有可见的焦点标记").toBe(true);
		return;
	}
	throw new Error(`按了 ${max} 次 Tab 也没走到目标`);
}

async function storyWithFloor(
	page: Page,
): Promise<{ id: string; title: string }> {
	const title = `键盘 ${Date.now()}`;
	const id = await createImportedStory(page, title);
	await page.goto(`/stories/${id}/play`);
	await page.getByRole("button", { name: /^推进/ }).click();
	await expect(committed(page)).toHaveCount(1, { timeout: 60_000 });
	return { id, title };
}

test.describe("可访问性", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("只用键盘：书架 → 故事 → 推进 → 重写 → 记忆页修改", async ({
		page,
	}, info) => {
		test.skip(info.project.name !== "desktop", "键盘流程只在桌面上验");
		test.setTimeout(180_000);
		const { id } = await storyWithFloor(page);

		// 书架：这个故事可能在「继续上次」，也可能在书架网格里（别的用例并行建的故事会更新），
		// 按链接地址找它，回车进入。封面上的链接不进 Tab 顺序，排除掉。
		await page.goto("/");
		await tabTo(
			page,
			page
				.locator(`a[href="/stories/${id}/play"]:not([tabindex="-1"])`)
				.first(),
		);
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/stories/${id}/play`));

		// 故事：推进一步。
		await tabTo(page, page.getByRole("button", { name: /^推进/ }));
		await page.keyboard.press("Enter");
		await expect(committed(page)).toHaveCount(2, { timeout: 60_000 });

		// 重写：选一个原因。
		await tabTo(
			page,
			page.locator(".acts").getByRole("button", { name: "重写" }),
		);
		await page.keyboard.press("Enter");
		await expect(page.locator(".why")).toBeVisible();
		const regenerated = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				response.url().endsWith("/regenerate"),
		);
		await tabTo(page, page.locator(".why .chip", { hasText: "太短" }));
		await page.keyboard.press("Enter");
		expect((await regenerated).ok()).toBe(true);

		// 记忆页：从导航进去，就地改一句并用回车提交。
		await tabTo(page, page.getByRole("link", { name: /记忆/ }).first());
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-view="memory"]')).toBeVisible();
		const line = page.locator("article.page .st p").first();
		await expect(line).toBeVisible();
		await tabTo(page, line);
		await page.keyboard.press("Enter");
		await expect(line).toHaveAttribute("contenteditable", "true");
		await page.keyboard.press("Control+A");
		await page.keyboard.type("林雪守在门厅");
		await page.keyboard.press("Enter");
		await expect(line).toHaveText("林雪守在门厅");
		await expect(
			page
				.locator("article.page .st")
				.filter({ hasText: "林雪守在门厅" })
				.locator(".pill", {
					hasText: "你改的",
				}),
		).toBeVisible();
	});

	test("减少动效时没有在跑的动画", async ({ page }) => {
		test.setTimeout(120_000);
		await page.emulateMedia({ reducedMotion: "reduce" });
		const id = await createImportedStory(page, `动效 ${Date.now()}`);
		await page.goto(`/stories/${id}/play`);

		const running = () =>
			page.evaluate(
				() =>
					document
						.getAnimations()
						.filter(
							(animation) =>
								animation.playState === "running" &&
								Number(animation.effect?.getComputedTiming().duration ?? 0) > 1,
						).length,
			);

		// 正在写的时候：光标、呼吸灯、按钮都不动。
		await page.getByRole("button", { name: /^推进/ }).click();
		await expect(page.locator(".writing")).toBeVisible();
		expect(await running()).toBe(0);
		await expect(committed(page)).toHaveCount(1, { timeout: 60_000 });

		// 换页与打开命令面板也一样。
		await page.getByRole("link", { name: /记忆/ }).first().click();
		await expect(page.locator('[data-view="memory"]')).toBeVisible();
		expect(await running()).toBe(0);
		await page.keyboard.press("Control+k");
		await expect(page.locator(".pal")).toBeVisible();
		expect(await running()).toBe(0);
	});
});

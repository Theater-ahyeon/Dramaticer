import { type Page, expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	login,
} from "./helpers";

/** 底部「开了 N 项」；token 估算挪到了检视器，这里只数开关。 */
async function enabledCount(page: Page): Promise<number> {
	const text = await page.locator(".total .num").textContent();
	return Number((text ?? "").replace(/[^\d]/g, ""));
}

test.describe("新界面设置页", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("档位一键切换一组开关，底部合计随开关变化，写作选项能改", async ({
		page,
	}) => {
		const storyId = await createImportedStory(page, `设置页 ${Date.now()}`);
		await page.goto(`/stories/${storyId}/prefs`);

		const prefs = page.locator('[data-view="prefs"]');
		await expect(prefs).toBeVisible();
		await expect(prefs.locator("h1")).toHaveText("设置");

		// 写作选项就在第一页，改一项后落定。
		const dials = page.locator("#dials");
		await expect(dials).toBeVisible();
		const person = dials.locator(".dial").filter({ hasText: "人称" });
		await person.getByRole("button", { name: "我" }).click();
		await expect(person.getByRole("button", { name: "我" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.reload();
		await expect(
			page
				.locator("#dials .dial")
				.filter({ hasText: "人称" })
				.getByRole("button", { name: "我" }),
		).toHaveAttribute("aria-pressed", "true");

		// 外观：固定成暗色后刷新仍然生效，改回跟随系统就去掉固定。
		const looks = page.getByRole("group", { name: "外观" });
		await looks.getByRole("button", { name: "暗" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await expect(
			page
				.getByRole("group", { name: "外观" })
				.getByRole("button", { name: "暗" }),
		).toHaveAttribute("aria-pressed", "true");
		await page
			.getByRole("group", { name: "外观" })
			.getByRole("button", { name: "跟随系统" })
			.click();
		await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);

		// 功能页：默认标准档。
		await page
			.locator(".subtabs")
			.getByRole("button", { name: "功能" })
			.click();
		const groups = page.locator("#groups");
		await expect(groups).toBeVisible();
		// 北极星指标（每百楼带原因重写率）在检视器里，不在设置页。
		await expect(page.locator("#groups #rerolls")).toHaveCount(0);
		await page.keyboard.press("Control+.");
		const rerolls = page
			.getByRole("dialog", { name: "检视器" })
			.locator("#rerolls");
		await expect(rerolls).toContainText("重写率");
		await expect(rerolls.locator("tbody tr")).toHaveCount(7);
		await expect(rerolls).toContainText("未选原因");
		await page.keyboard.press("Escape");
		const tier = page.locator(".vh .seg");
		await expect(tier.getByRole("button", { name: "标准" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		const scribe = page.getByRole("switch", { name: "场记" });
		await expect(scribe).toHaveAttribute("aria-checked", "true");
		const standardSum = await enabledCount(page);
		expect(standardSum).toBeGreaterThan(0);

		// 完整：一批开关被打开，合计变大。
		await tier.getByRole("button", { name: "完整" }).click();
		await expect(scribe).toHaveAttribute("aria-checked", "true");
		const prepare = page.getByRole("switch", { name: "提前备好" });
		await expect(prepare).toHaveAttribute("aria-checked", "true");
		const immersiveSum = await enabledCount(page);
		expect(immersiveSum).toBeGreaterThan(standardSum);

		// 轻量：同一批开关被关掉，合计变小。
		await tier.getByRole("button", { name: "轻量" }).click();
		await expect(scribe).toHaveAttribute("aria-checked", "false");
		await expect(prepare).toHaveAttribute("aria-checked", "false");
		const liteSum = await enabledCount(page);
		expect(liteSum).toBeLessThan(standardSum);

		const total = page.locator(".total");
		await expect(total).toContainText("开了");
		await expect(total).not.toContainText("token");

		// 逐项开关：关掉场记后少一项，刷新后保持。
		await tier.getByRole("button", { name: "标准" }).click();
		await expect(scribe).toHaveAttribute("aria-checked", "true");
		const beforeToggle = await enabledCount(page);
		await scribe.click();
		await expect(scribe).toHaveAttribute("aria-checked", "false");
		await expect.poll(() => enabledCount(page)).toBe(beforeToggle - 1);
		await page.reload();
		await page
			.locator(".subtabs")
			.getByRole("button", { name: "功能" })
			.click();
		await expect(page.getByRole("switch", { name: "场记" })).toHaveAttribute(
			"aria-checked",
			"false",
		);
		expect(await enabledCount(page)).toBe(beforeToggle - 1);

		// 合计贴在页面底部，窄屏也不横向溢出。
		const box = await page.locator(".total").boundingBox();
		expect(box).not.toBeNull();
		const viewport = page.viewportSize();
		expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
			viewport?.width ?? 0,
		);
		await expectNoHorizontalOverflow(page);
	});
});

import { type Page, expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	login,
} from "./helpers";

async function sumTokens(page: Page): Promise<number> {
	const text = await page.locator(".total b.num").textContent();
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

		// 功能页：默认均衡档。
		await page
			.locator(".subtabs")
			.getByRole("button", { name: "功能" })
			.click();
		const groups = page.locator("#groups");
		await expect(groups).toBeVisible();
		// 功能分页底部：北极星指标，每百楼带原因重写率（refactor/04）。
		const rerolls = page.locator("#rerolls");
		await expect(rerolls).toContainText("重写率");
		await expect(rerolls.locator("tbody tr")).toHaveCount(7);
		await expect(rerolls).toContainText("未选原因");
		const tier = page.locator(".vh .seg");
		await expect(tier.getByRole("button", { name: "均衡" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		const scribe = page.getByRole("switch", { name: "场记" });
		await expect(scribe).toHaveAttribute("aria-checked", "true");
		const standardSum = await sumTokens(page);
		expect(standardSum).toBeGreaterThan(0);

		// 全开：一批开关被打开，合计变大。
		await tier.getByRole("button", { name: "全开" }).click();
		await expect(scribe).toHaveAttribute("aria-checked", "true");
		const prepare = page.getByRole("switch", { name: "提前备好" });
		await expect(prepare).toHaveAttribute("aria-checked", "true");
		const immersiveSum = await sumTokens(page);
		expect(immersiveSum).toBeGreaterThan(standardSum);

		// 省：同一批开关被关掉，合计变小。
		await tier.getByRole("button", { name: "省" }).click();
		await expect(scribe).toHaveAttribute("aria-checked", "false");
		await expect(prepare).toHaveAttribute("aria-checked", "false");
		const liteSum = await sumTokens(page);
		expect(liteSum).toBeLessThan(standardSum);

		const total = page.locator(".total");
		await expect(total).toContainText("每轮后台约");
		await expect(total).toContainText("开了");

		// 逐项开关：关掉场记后合计少 600，刷新后保持。
		await tier.getByRole("button", { name: "均衡" }).click();
		await expect(scribe).toHaveAttribute("aria-checked", "true");
		const beforeToggle = await sumTokens(page);
		await scribe.click();
		await expect(scribe).toHaveAttribute("aria-checked", "false");
		await expect.poll(() => sumTokens(page)).toBe(beforeToggle - 600);
		await page.reload();
		await page
			.locator(".subtabs")
			.getByRole("button", { name: "功能" })
			.click();
		await expect(page.getByRole("switch", { name: "场记" })).toHaveAttribute(
			"aria-checked",
			"false",
		);
		expect(await sumTokens(page)).toBe(beforeToggle - 600);

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

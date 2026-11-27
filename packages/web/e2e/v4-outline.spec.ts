import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

test.describe("剧情走向页", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("核心问题与分卷带着状态与锁定，约束默认弱，AI 写的可以隐藏", async ({
		page,
	}, testInfo) => {
		const storyId = `e2e-outline-${testInfo.project.name}`;
		await page.goto(`/stories/${storyId}/outline`);

		const pageView = page.locator('[data-view="direction"]');
		await expect(pageView).toBeVisible();
		await expect(pageView.locator("h1")).toHaveText("剧情走向");

		// 约束默认弱。
		const tension = pageView.getByRole("group", { name: "剧情走向的约束" });
		await expect(tension.getByRole("button", { name: "弱" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// 总纲：核心问题、基调与不要发生。
		const wants = pageView.locator('[data-column="wants"]');
		await expect(wants).toContainText("这座灯塔，究竟为谁而亮？");
		await expect(wants).toContainText("潮湿、克制");
		await expect(wants).toContainText("第三卷之前，阿蘅不能出事");

		// 分卷与关键事件：玩家写的可以锁定，AI 写的标明出处。
		await expect(wants).toContainText("卷一 · 雾起");
		await expect(wants).toContainText("卷二 · 退潮");
		const playerMilestone = wants.locator('[data-id="milestone:m-player"]');
		await expect(playerMilestone).toContainText("在七号码头截下贺九的第一箱货");
		await expect(playerMilestone.locator(".lock")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(wants.locator('[data-id="milestone:m-ai"]')).toContainText(
			"AI 写的",
		);

		// 调整约束后刷新仍保留。
		await tension.getByRole("button", { name: "中" }).click();
		await expect
			.poll(async () => {
				const response = await page.request.get(
					`/api/stories/${storyId}/direction`,
				);
				return ((await response.json()) as { tension: string }).tension;
			})
			.toBe("medium");
		await page.reload();
		await expect(
			page
				.locator('[data-view="direction"]')
				.getByRole("group", { name: "剧情走向的约束" })
				.getByRole("button", { name: "中" }),
		).toHaveAttribute("aria-pressed", "true");

		// AI 写的部分可以对玩家隐藏，并告诉玩家藏了几条。
		await page.getByRole("button", { name: "隐藏 AI 写的" }).click();
		await expect(page.locator('[data-id="milestone:m-ai"]')).toHaveCount(0);
		await expect(
			page.locator('[data-view="direction"]').getByText("AI 另有 1 条已隐藏"),
		).toBeVisible();
		await page.reload();
		await expect(page.locator('[data-id="milestone:m-ai"]')).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "隐藏 AI 写的" }),
		).toHaveAttribute("aria-pressed", "true");

		await expectNoHorizontalOverflow(page);
	});
});

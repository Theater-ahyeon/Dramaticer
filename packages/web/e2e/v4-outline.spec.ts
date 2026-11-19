import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

test.describe("新界面大纲页", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("总纲与分卷带状态与锁定，约束默认弱，走不通时给三个选择，AI 写的可以隐藏", async ({
		page,
	}, testInfo) => {
		const storyId = `e2e-outline-${testInfo.project.name}`;
		await page.goto(`/stories/${storyId}/outline`);

		const outline = page.locator('[data-view="outline"]');
		await expect(outline).toBeVisible();
		await expect(outline.locator("h1")).toHaveText("大纲");

		// 约束默认弱。
		const tension = outline.getByRole("group", { name: "大纲约束" });
		await expect(tension.getByRole("button", { name: "弱" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// 总纲：核心问题、基调与不要发生。
		const premise = outline.locator(".premise");
		await expect(premise).toContainText("这座灯塔，究竟为谁而亮？");
		await expect(premise).toContainText("潮湿、克制");
		await expect(premise).toContainText("第三卷之前，阿蘅不能出事");

		// 分卷的关键事件，玩家写的可以锁定。
		const volumes = outline.locator(".vol");
		await expect(volumes).toHaveCount(2);
		const firstVolume = volumes.filter({ hasText: "卷一 · 雾起" });
		const playerMilestone = firstVolume
			.locator(".ms")
			.filter({ hasText: "在七号码头截下贺九的第一箱货" });
		await expect(playerMilestone).toContainText("你写的");
		await expect(playerMilestone.locator(".lock")).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// 走不通的里程碑给出三个选择。
		const lostMilestone = volumes
			.locator(".ms")
			.filter({ hasText: "在码头当众揭穿贺九" });
		await expect(lostMilestone).toContainText("走不通了");
		await expect(
			lostMilestone.getByRole("button", { name: "改大纲" }),
		).toBeVisible();
		await expect(
			lostMilestone.getByRole("button", { name: "把剧情拉回来" }),
		).toBeVisible();
		await expect(
			lostMilestone.getByRole("button", { name: "不要了" }),
		).toBeVisible();

		// AI 写的先显示出来，并标明出处。
		await expect(outline.locator(".ms.ai")).toHaveCount(1);
		await expect(outline.locator(".ms.ai")).toContainText(
			"阿蘅发现你一直没把报告的事告诉她",
		);

		// 调整约束后刷新仍保留。
		await tension.getByRole("button", { name: "中" }).click();
		await expect(page.locator(".toast")).toContainText("约束已调整");
		await page.reload();
		await expect(
			page
				.locator('[data-view="outline"]')
				.getByRole("group", { name: "大纲约束" })
				.getByRole("button", { name: "中" }),
		).toHaveAttribute("aria-pressed", "true");

		// AI 写的部分可以对玩家隐藏，并告诉玩家藏了几条。
		await page.getByRole("button", { name: "AI 写的先别给我看" }).click();
		await expect(page.locator(".ms.ai")).toHaveCount(0);
		await expect(
			page.locator('[data-view="outline"]').getByText("AI 还补了 1 条"),
		).toBeVisible();
		await page.reload();
		await expect(page.locator(".ms.ai")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "AI 写的先别给我看" }),
		).toHaveAttribute("aria-pressed", "true");

		await expectNoHorizontalOverflow(page);
	});
});

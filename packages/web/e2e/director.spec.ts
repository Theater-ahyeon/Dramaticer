import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	latestAssistantNodeId,
	login,
	openStoryTab,
	sendTurn,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("导演决策、候选行动、Trace、计划编辑与线索兑现", async ({ page }) => {
	const storyId = await createImportedStory(page, "导演端到端");
	// 这个用例看的是方案与序列引擎的导演面板（线索到期给出指令），不测让位：
	// 新故事默认是线与动作（ADR-0161），这里显式选旧引擎，并设成始终出手。
	const settings = await page.request.put(`/api/stories/${storyId}/settings`, {
		data: {
			directorOrganization: "mechanisms",
			featureSwitches: { director: "always" },
		},
	});
	expect(settings.ok()).toBeTruthy();
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/stories/${storyId}/openings?status=pending`,
				);
				const body: unknown = await response.json();
				return JSON.stringify(body).includes("批候选") ? 1 : 0;
			},
			{ timeout: 30_000 },
		)
		.toBe(1);

	await openStoryTab(page, storyId, "chat");
	await sendTurn(page, storyId, "读取状态");
	const assistantId = await latestAssistantNodeId(page, storyId);

	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/nodes/${assistantId}/actions`,
				);
				const body: unknown = await response.json();
				return JSON.stringify(body).includes("候选行动一") ? 1 : 0;
			},
			{ timeout: 30_000 },
		)
		.toBe(1);
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/stories/${storyId}/director/plan`,
				);
				const body: unknown = await response.json();
				return JSON.stringify(body).includes("e2e-arc") ? 1 : 0;
			},
			{ timeout: 30_000 },
		)
		.toBe(1);

	await openStoryTab(page, storyId, "director");
	await expect(page.locator(".candidate-action")).toHaveCount(5);
	await page.locator(".candidate-action").first().click();
	await page.waitForURL(`**/stories/${storyId}/chat`);
	await expect(page.getByLabel("玩家行动")).toHaveValue(/候选行动一/);

	await openStoryTab(page, storyId, "director");
	await page
		.locator(".branch-row")
		.filter({ has: page.locator(".branch-role-user") })
		.filter({ hasText: "读取状态" })
		.first()
		.locator(".branch-select")
		.click();
	await expect(page.locator(".director-directive")).toBeVisible();

	await page
		.locator(".branch-row")
		.filter({ has: page.locator(".branch-role-assistant") })
		.first()
		.locator(".branch-select")
		.click();
	const trace = page.locator('.director-section[aria-label="Trace"]');
	await expect(trace).toContainText("fake-model");
	await expect(trace).toContainText("快回合");
	await expect(trace).toContainText("state_get 成功");

	const arcTitle = page.locator(".plan-arc input").first();
	await expect(arcTitle).toHaveValue("旧宅之夜");
	await arcTitle.fill("旧宅之夜（改）");
	await page.getByRole("button", { name: "保存计划" }).click();
	await page.getByText("已保存", { exact: true }).waitFor();
	await page.reload();
	await expect(page.locator(".plan-arc input").first()).toHaveValue(
		"旧宅之夜（改）",
	);

	await expect(page.getByRole("button", { name: "兑现线索" })).toBeVisible();
	await page.getByRole("button", { name: "兑现线索" }).click();
	await expect(page.getByText("没有未兑现的线索。")).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

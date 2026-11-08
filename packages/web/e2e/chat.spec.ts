import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	login,
	openStoryTab,
	pathNodeCount,
	readPreferenceCounts,
	sendTurn,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("两轮对话、思考折叠、选项偏好、读取工具与重新生成", async ({ page }) => {
	const storyId = await createImportedStory(page, "聊天端到端");
	await openStoryTab(page, storyId, "chat");
	await expect(page.getByLabel("玩家行动")).toBeVisible();

	await sendTurn(page, storyId, "第一次行动");
	const thinking = page.locator(".block-thinking").last();
	await expect(thinking).toBeVisible();
	await expect(thinking).not.toHaveAttribute("open");
	await expect(page.locator(".block-status").last()).toContainText("体力：100");
	await expect(page.locator(".turn-summary")).toContainText("状态更新");

	await page
		.locator(".block-options button", { hasText: "推门进去" })
		.last()
		.click();
	await expect(page.getByLabel("玩家行动")).toHaveValue("推门进去");
	await expect
		.poll(() => readPreferenceCounts(storyId).get("choice") ?? 0)
		.toBe(1);

	await expect(page.locator(".candidate-action").first()).toBeVisible({
		timeout: 30_000,
	});

	await sendTurn(page, storyId, "推门进去");
	await sendTurn(page, storyId, "读取状态");
	await expect(page.locator(".floor-assistant").last()).toContainText(
		"读取状态",
	);

	const before = await pathNodeCount(page, storyId);
	await page
		.locator(".floor-assistant")
		.last()
		.getByRole("button", { name: "重新生成" })
		.click();
	await expect
		.poll(() => readPreferenceCounts(storyId).get("swipe") ?? 0, {
			timeout: 30_000,
		})
		.toBe(1);
	expect(await pathNodeCount(page, storyId)).toBe(before);

	await expectNoHorizontalOverflow(page);
});

test("故事锁定深回合时拒绝发送，玩家切回快回合后恢复", async ({ page }) => {
	const storyId = await createImportedStory(page, "模式开关");
	const locked = await page.request.put(`/api/stories/${storyId}/settings`, {
		data: { turnMode: "deep" },
	});
	expect(locked.ok()).toBeTruthy();

	await openStoryTab(page, storyId, "chat");
	await expect(page.getByLabel("回合模式")).toHaveValue("deep");
	await expect(page.getByRole("button", { name: "切回快回合" })).toBeVisible();

	const composer = page.getByLabel("玩家行动");
	await composer.fill("锁定深回合");
	await composer.press("Enter");
	await expect(page.locator(".error-notice")).toContainText("深回合");
	expect(await pathNodeCount(page, storyId)).toBe(0);

	await page.getByRole("button", { name: "切回快回合" }).click();
	await expect(page.getByLabel("回合模式")).toHaveValue("fast");
	const settings = await page.request.get(`/api/stories/${storyId}/settings`);
	const settingsBody: unknown = await settings.json();
	expect(settingsBody).toMatchObject({ turnMode: "fast" });

	await sendTurn(page, storyId, "切回快回合后的行动");
});

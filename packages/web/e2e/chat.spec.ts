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

test("故事锁定深回合后新会话默认深回合，玩家可以逐轮切回快回合", async ({
	page,
}) => {
	const storyId = await createImportedStory(page, "模式开关");
	const locked = await page.request.put(`/api/stories/${storyId}/settings`, {
		data: { turnMode: "deep" },
	});
	expect(locked.ok()).toBeTruthy();

	await openStoryTab(page, storyId, "chat");
	await expect(page.getByLabel("回合模式")).toHaveValue("deep");

	await sendTurn(page, storyId, "深回合里的行动");
	await sendTurn(page, storyId, "深回合里的第二轮");

	await page.getByLabel("回合模式").selectOption("fast");
	await expect(page.getByLabel("回合模式")).toHaveValue("fast");
	const settings = await page.request.get(`/api/stories/${storyId}/settings`);
	const settingsBody: unknown = await settings.json();
	expect(settingsBody).toMatchObject({ turnMode: "deep" });

	await sendTurn(page, storyId, "快回合里的行动");
});

test("深回合显示草稿、运行中追加要求与楼层运行时间线", async ({ page }) => {
	const storyId = await createImportedStory(page, "深回合草稿");
	await openStoryTab(page, storyId, "chat");
	await page.getByLabel("回合模式").selectOption("deep");
	await page.getByLabel("玩家行动").fill("深回合草稿：写下开场");
	await page.getByLabel("玩家行动").press("Enter");

	const steering = page.getByLabel("追加要求");
	await expect(steering).toBeVisible({ timeout: 15_000 });
	await steering.fill("让门外的脚步停下来");
	await steering.press("Enter");
	await expect(page.locator(".steering-list")).toContainText(
		"让门外的脚步停下来",
	);
	await expect(page.locator(".draft-panel")).toContainText(
		"草稿：门在风里响了一声。",
		{ timeout: 15_000 },
	);

	const lastFloor = page.locator(".floor-assistant").last();
	await expect(lastFloor).toContainText("草稿：门在风里响了一声。", {
		timeout: 30_000,
	});
	await expect(page.locator(".draft-panel")).toHaveCount(0);

	await lastFloor.getByRole("button", { name: "运行时间线" }).click();
	const timeline = page.locator(".run-timeline");
	await expect(timeline).toContainText("模型请求");
	await expect(timeline).toContainText("工具调用");
	await expect(timeline).toContainText("草稿替换");
	await expect(timeline).toContainText("草稿提交");
	await expect(timeline).toContainText("追加要求");
	await expectNoHorizontalOverflow(page);
});

import { type Page, expect, test } from "@playwright/test";
import {
	createImportedStory,
	login,
	openStoryTab,
	pathNodeCount,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

async function openDrawer(page: Page): Promise<void> {
	await page.locator(".assistant-open-button").click();
	await expect(page.locator(".assistant-drawer")).toBeVisible();
}

async function newConversation(page: Page): Promise<void> {
	await page.getByRole("button", { name: "新建会话" }).click();
	await expect(page.getByLabel("给助手的消息")).toBeVisible();
}

async function sendAssistantMessage(page: Page, text: string): Promise<void> {
	await page.getByLabel("给助手的消息").fill(text);
	await page.getByLabel("给助手的消息").press("Enter");
}

async function pathHead(page: Page, storyId: string): Promise<string | null> {
	const response = await page.request.get(`/api/stories/${storyId}/path`, {
		params: { limit: 200 },
	});
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as { headNodeId: string | null };
	return body.headNodeId;
}

test("打开、关闭后继续运行、路由切换与刷新后恢复会话", async ({ page }) => {
	const storyId = await createImportedStory(page, "助手抽屉");
	await openStoryTab(page, storyId, "chat");
	const nodesBefore = await pathNodeCount(page, storyId);
	const headBefore = await pathHead(page, storyId);

	await page.keyboard.press("Control+Shift+A");
	await expect(page.locator(".assistant-drawer")).toBeVisible();
	await expect(page.getByRole("button", { name: "关闭助手" })).toBeFocused();

	await newConversation(page);
	await sendAssistantMessage(page, "慢速回答第一次");
	await expect(page.locator(".assistant-controls")).toContainText("运行中");

	await page.keyboard.press("Escape");
	await expect(page.locator(".assistant-drawer")).toBeHidden();
	await expect(page.locator(".assistant-open-button")).toBeFocused();
	const badge = page.locator(".assistant-badge");
	await expect(badge).toContainText("助手运行中");

	await page.locator(".story-tabs").getByRole("link", { name: "台账" }).click();
	await expect(badge).toContainText("助手运行中");
	await expect(badge).not.toContainText("运行中", { timeout: 20_000 });

	await badge.click();
	await expect(page.locator(".assistant-drawer")).toBeVisible();
	await expect(page.locator(".assistant-messages")).toContainText(
		"慢速助手的完整回答",
	);

	await page.getByRole("button", { name: "关闭助手" }).click();
	await page.reload();
	await expect(page.locator(".assistant-badge")).toContainText("助手");
	await page.locator(".assistant-badge").click();
	await expect(page.locator(".assistant-drawer")).toBeVisible();
	await expect(page.locator(".assistant-conversation-list")).toContainText(
		"新会话",
	);
	await expect(page.locator(".assistant-messages")).toContainText(
		"慢速助手的完整回答",
	);

	expect(await pathNodeCount(page, storyId)).toBe(nodesBefore);
	expect(await pathHead(page, storyId)).toBe(headBefore);
});

test("刷新后从 status 与 after 续读正在运行的助手", async ({ page }) => {
	const storyId = await createImportedStory(page, "助手重连");
	await openStoryTab(page, storyId, "chat");
	await openDrawer(page);
	await newConversation(page);
	await sendAssistantMessage(page, "慢速回答重连");
	await expect(page.locator(".assistant-controls")).toContainText("运行中");

	await page.reload();
	await expect(page.locator(".assistant-badge")).toContainText("助手运行中", {
		timeout: 20_000,
	});
	await expect(page.locator(".assistant-badge")).not.toContainText("运行中", {
		timeout: 20_000,
	});
	await page.locator(".assistant-badge").click();
	await expect(page.locator(".assistant-messages")).toContainText(
		"慢速助手的完整回答",
	);
	await expect(page.locator(".assistant-message-assistant")).toHaveCount(1);
});

test("改名、搜索、删除与取消运行", async ({ page }) => {
	const storyId = await createImportedStory(page, "助手会话管理");
	await openStoryTab(page, storyId, "chat");
	await openDrawer(page);

	await newConversation(page);
	await page
		.locator(".assistant-conversation-actions")
		.getByRole("button", { name: "改名" })
		.click();
	await page.getByLabel("会话标题").fill("我的排障会话");
	await page.getByRole("button", { name: "保存" }).click();
	await expect(page.locator(".assistant-conversation-list")).toContainText(
		"我的排障会话",
	);

	await page.getByLabel("搜索会话").fill("我的排障");
	await page.getByRole("button", { name: "搜索" }).click();
	await expect(page.locator(".assistant-conversation-list")).toContainText(
		"我的排障会话",
	);

	await sendAssistantMessage(page, "慢速取消运行");
	await expect(page.locator(".assistant-controls")).toContainText("运行中");
	await page.getByRole("button", { name: "取消运行" }).click();
	await expect(page.locator(".assistant-controls")).toContainText("已取消", {
		timeout: 20_000,
	});

	await page
		.locator(".assistant-conversation-actions")
		.getByRole("button", { name: "删除" })
		.click();
	await page.getByRole("button", { name: "确定删除" }).click();
	await expect(page.locator(".assistant-conversation-list")).not.toContainText(
		"我的排障会话",
	);
});

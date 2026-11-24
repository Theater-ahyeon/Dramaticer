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
	// 助手挂在外壳上：任何页面都用同一个快捷键叫出来。
	await page.keyboard.press("Control+Shift+A");
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
	const badge = page.locator(".assistant-badge");
	await expect(badge).toContainText("助手运行中");

	await page.locator(".story-tabs").getByRole("link", { name: "台账" }).click();
	await expect(badge).toContainText("助手运行中");
	// 跑完之后状态徽标收起，从快捷键再打开。
	await expect(badge).toHaveCount(0, { timeout: 20_000 });

	await page.keyboard.press("Control+Shift+A");
	await expect(page.locator(".assistant-drawer")).toBeVisible();
	await expect(page.locator(".assistant-messages")).toContainText(
		"慢速助手的完整回答",
	);

	await page.getByRole("button", { name: "关闭助手" }).click();
	await page.reload();
	await page.keyboard.press("Control+Shift+A");
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
	await expect(page.locator(".assistant-badge")).toHaveCount(0, {
		timeout: 20_000,
	});
	await page.keyboard.press("Control+Shift+A");
	await expect(page.locator(".assistant-messages")).toContainText(
		"慢速助手的完整回答",
	);
	await expect(page.locator(".assistant-message-assistant")).toHaveCount(1);
});

test("用量环与手动压缩显示摘要与省略来源", async ({ page }) => {
	const storyId = "e2e-assistant-context";
	const conversationId = "e2e-assistant-context-conversation";
	await openStoryTab(page, storyId, "chat");
	await openDrawer(page);
	await page
		.locator(".assistant-conversation-open", { hasText: "上下文压缩测试" })
		.click();
	await expect(page.locator(".assistant-context")).toBeVisible();

	const before = await page.request.get(
		`/api/assistant/conversations/${conversationId}`,
	);
	expect(before.ok()).toBeTruthy();
	const beforeBody = (await before.json()) as {
		context: { used: number; budget: number };
	};
	await expect(page.locator(".assistant-context")).toContainText(
		`${beforeBody.context.used}/${beforeBody.context.budget}`,
	);

	await page.getByLabel("压缩要求").fill("保留排障结论");
	await page.getByRole("button", { name: "压缩上下文" }).click();
	await expect(page.locator(".assistant-compaction")).toContainText(
		"已压缩 2 条消息",
	);
	await expect(page.locator(".assistant-compaction")).toContainText(
		"上下文摘要",
	);

	const after = await page.request.get(
		`/api/assistant/conversations/${conversationId}`,
	);
	const afterBody = (await after.json()) as {
		compaction: { omittedMessageIds: number[]; summary: string };
		context: { used: number; budget: number };
	};
	expect(afterBody.compaction.omittedMessageIds).toEqual([1, 2]);
	expect(afterBody.compaction.summary).toContain("上下文摘要");
	await expect(page.locator(".assistant-context")).toContainText(
		`${afterBody.context.used}/${afterBody.context.budget}`,
	);
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

test("待确认面板审阅动作与台账卡并同步数量", async ({ page }) => {
	const storyId = `e2e-assistant-review-${test.info().project.name}`;
	await openStoryTab(page, storyId, "chat");
	await expect(page.locator(".assistant-badge-count")).toHaveText("8");

	await openDrawer(page);
	await page.getByRole("tab", { name: /待确认/ }).click();
	await expect(page.locator(".assistant-review-item")).toHaveCount(8);

	const channels = page.locator('.assistant-review-item[data-kind="channels"]');
	await expect(channels).toContainText("review-model");
	await expect(channels).toContainText("密钥已设置");
	await expect(channels).not.toContainText("E2E_SECRET_ENV");
	await expect(channels).not.toContainText("sk-");

	const ledger = page.locator('.assistant-review-item[data-kind="ledger"]');
	await expect(ledger).toContainText("character / 凛 / location");
	await expect(ledger).toContainText("走廊");
	await expect(ledger).toContainText("屋顶");

	const broken = page
		.locator(".assistant-review-item")
		.filter({ hasText: "模板还没准备好的修改" });
	await broken.getByRole("button", { name: "批准" }).click();
	await expect(broken.locator(".assistant-review-error")).toContainText(
		"模板不存在",
	);
	await expect(broken).toBeVisible();

	const settingsItem = page
		.locator(".assistant-review-item")
		.filter({ hasText: "把输出预算改成 1024" });
	await settingsItem.getByRole("button", { name: "批准" }).click();
	await expect(settingsItem).toHaveCount(0);

	const loreItem = page
		.locator(".assistant-review-item")
		.filter({ hasText: "加一条世界书" });
	await loreItem.getByRole("button", { name: "拒绝" }).click();
	await page.getByLabel("拒绝原因").fill("不需要这条世界书");
	await page.getByRole("button", { name: "确定拒绝" }).click();
	await expect(loreItem).toHaveCount(0);

	await ledger.getByRole("button", { name: "拒绝" }).click();
	await expect(ledger).toHaveCount(0);

	await expect(page.locator(".assistant-review-item")).toHaveCount(5);
	await page.getByRole("button", { name: "关闭助手" }).click();
	await expect(page.locator(".assistant-badge-count")).toHaveText("5");

	const settings = await page.request.get(`/api/stories/${storyId}/settings`);
	expect(settings.ok()).toBeTruthy();
	expect(((await settings.json()) as { maxTokens: number }).maxTokens).toBe(
		1024,
	);
	const actions = await page.request.get(
		`/api/assistant/actions?status=all&storyId=${storyId}`,
	);
	expect(actions.ok()).toBeTruthy();
	const actionsBody = (await actions.json()) as {
		actions: {
			summary: string;
			status: string;
			rejectionReason: string | null;
		}[];
	};
	const rejectedLore = actionsBody.actions.find(
		(action) => action.summary === "加一条世界书",
	);
	expect(rejectedLore?.status).toBe("rejected");
	expect(rejectedLore?.rejectionReason).toBe("不需要这条世界书");
	const proposals = await page.request.get(
		`/api/stories/${storyId}/proposals?status=rejected`,
	);
	expect(proposals.ok()).toBeTruthy();
	expect(
		((await proposals.json()) as { proposals: unknown[] }).proposals,
	).toHaveLength(1);
});

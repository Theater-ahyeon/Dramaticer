import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	login,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("故事设置保存后刷新仍在，模板复制后编辑并保存", async ({ page }) => {
	const storyId = await createImportedStory(page, "设置端到端");
	await page.goto(`/stories/${storyId}/prefs?tab=adv`);
	await expect(page.getByLabel("上下文预算 token")).toBeVisible();

	await page.getByLabel("上下文预算 token").fill("9000");
	const deepCalls = page.getByLabel("深回合工具调用上限");
	await deepCalls.fill("500");
	await page.getByRole("button", { name: "保存故事设置" }).click();
	await expect(page.locator(".settings-errors")).toContainText(
		"深回合工具调用上限",
	);
	await expect(page.locator(".settings-errors")).toContainText("1 到 200");
	await deepCalls.fill("30");
	await page.getByRole("button", { name: "保存故事设置" }).click();
	await page.getByText("已保存", { exact: true }).waitFor();
	await page.reload();
	await expect(page.getByLabel("上下文预算 token")).toHaveValue("9000");
	await expect(page.getByLabel("深回合工具调用上限")).toHaveValue("30");

	const templateName = `端到端模板-${randomUUID().slice(0, 8)}`;
	await page.getByLabel("新模板名称（复制用）").fill(templateName);
	await page.getByRole("button", { name: "复制为新模板并设为默认" }).click();
	await page.getByText("库里的模板").waitFor();
	const memoryTool = page.getByLabel(/memory_search/);
	await expect(memoryTool).toBeChecked();
	await memoryTool.uncheck();
	await page.getByLabel("工具调用上限（留空沿用故事设置）").fill("20");
	const protocolSegment = page
		.locator(".template-segment")
		.filter({ hasText: "protocol" })
		.first();
	await protocolSegment.getByLabel("静态文本").fill("写作契约：端到端模板。");
	await page.getByRole("button", { name: "保存模板" }).click();
	await page.getByText("已保存", { exact: true }).waitFor();
	await page.reload();
	await expect(page.locator(".template-preview")).toContainText(
		"写作契约：端到端模板。",
	);
	await expect(page.getByLabel(/memory_search/)).not.toBeChecked();
	await expect(page.getByLabel("工具调用上限（留空沿用故事设置）")).toHaveValue(
		"20",
	);
	await expectNoHorizontalOverflow(page);
});

test("渠道面板修改保存后刷新仍在，且不显示密钥值", async ({ page }) => {
	await page.goto("/settings");
	await page.getByText("高级配置", { exact: false }).click();
	await expect(
		page.getByRole("heading", { name: "渠道与模型岗位" }),
	).toBeVisible();

	const writerChannel = page
		.locator('section[aria-label="渠道"] .channel-card')
		.filter({
			has: page.getByRole("heading", { name: "writer", exact: true }),
		});
	await writerChannel.getByLabel("每分钟请求数").fill("12");
	await page.getByRole("button", { name: "保存渠道配置" }).click();
	await page.getByText("已保存", { exact: true }).waitFor();
	await page.reload();
	await page.getByText("高级配置", { exact: false }).click();
	await expect(
		page
			.locator('section[aria-label="渠道"] .channel-card')
			.filter({
				has: page.getByRole("heading", { name: "writer", exact: true }),
			})
			.getByLabel("每分钟请求数"),
	).toHaveValue("12");
	await expect(page.locator("body")).not.toContainText("e2e-key");
	await expectNoHorizontalOverflow(page);
});

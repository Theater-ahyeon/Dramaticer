import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChannelsUpdateRequest, ChannelsView } from "@dramaticer/protocol";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "沈渡",
		description: "渡口的摆渡人。",
		first_mes: "雾很大，船还是开了。",
	},
};

function toUpdate(view: ChannelsView): ChannelsUpdateRequest {
	return {
		channels: Object.fromEntries(
			view.channels.map((channel) => [
				channel.id,
				{
					api: channel.api,
					baseUrl: channel.baseUrl,
					apiKeyEnv: channel.apiKeyEnv ?? "",
					requestsPerMinute: channel.requestsPerMinute,
					maxRetries: channel.maxRetries,
					retryBaseDelayMs: channel.retryBaseDelayMs,
					timeoutMs: channel.timeoutMs,
				},
			]),
		),
		models: Object.fromEntries(
			view.models.map((model) => [
				model.alias,
				{
					id: model.id,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					reasoning: model.reasoning,
					enabled: model.enabled,
					channels: model.channels,
				},
			]),
		),
		embeddings: {},
		roles: view.configuredRoles,
	};
}

test("全局设置的连接向导：填地址与密钥、获取模型、保存并测试；密钥不出现在页面", async ({
	page,
}) => {
	const before = (await (
		await page.request.get("/api/channels")
	).json()) as ChannelsView;
	const writer = before.channels.find((channel) => channel.id === "writer");
	if (writer === undefined) throw new Error("e2e 渠道里缺少 writer");
	try {
		await page.goto("/settings");
		await expect(
			page.getByRole("heading", { name: "模型与渠道" }),
		).toBeVisible();
		await page.getByLabel("供应商").selectOption("custom");
		await page.getByLabel("接口地址").fill(writer.baseUrl);
		await page.getByLabel("API Key").fill("wizard-secret-key");
		await page.getByRole("button", { name: "获取模型列表" }).click();
		await expect(page.getByRole("status")).toContainText("共 2 个模型");
		await page.getByLabel("正文模型").fill("fake-writer");
		await page.getByRole("button", { name: "保存并测试" }).click();
		await expect(page.getByRole("status")).toContainText("已保存", {
			timeout: 30_000,
		});
		await expect(page.locator("body")).not.toContainText("wizard-secret-key");
		const after = (await (
			await page.request.get("/api/channels")
		).json()) as ChannelsView;
		expect(after.roles.writer).toBe("writer-fake-writer");
		const envText = readFileSync(
			join(
				import.meta.dirname,
				"..",
				"..",
				"..",
				".devloop",
				"scratch",
				"e2e",
				"work",
				".env",
			),
			"utf8",
		);
		expect(envText).toContain("wizard-secret-key");
		await expectNoHorizontalOverflow(page);
	} finally {
		await page.request.put("/api/channels", { data: toUpdate(before) });
	}
});

test("书架新建故事：导入角色卡后直接进故事页，标题取卡名", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "＋ 新建故事" }).click();
	const dialog = page.getByRole("form", { name: "新建故事" });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("角色卡文件").setInputFiles({
		name: "shendu.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(CARD)),
	});
	await expect(dialog).toContainText("shendu.json");
	await dialog.getByRole("button", { name: "开始" }).click();
	await page.waitForURL(/\/stories\/[^/]+\/play$/);
	await expect(page.getByRole("heading", { name: "沈渡" })).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test("书架新建故事：空白开局直接进故事页", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "＋ 新建故事" }).click();
	const dialog = page.getByRole("form", { name: "新建故事" });
	await dialog.getByRole("button", { name: "空白开局" }).click();
	await dialog.getByLabel("标题").fill("空白试写");
	await dialog.getByRole("button", { name: "开始" }).click();
	await page.waitForURL(/\/stories\/[^/]+\/play$/);
	await expect(page.getByRole("heading", { name: "空白试写" })).toBeVisible();
});

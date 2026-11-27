import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

const FIXTURES = join(
	import.meta.dirname,
	"..",
	"..",
	"core",
	"test",
	"fixtures",
);

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "叙述者",
		description: "只提供文风与规则的叙述者。",
		first_mes: "卡的开场白不应该替换原著开局。",
		character_book: {
			name: "文风",
			entries: [
				{
					id: 1,
					keys: ["文风"],
					comment: "文风守则",
					content: "文风：句子短，第二人称，禁止出现括号。",
					enabled: true,
					constant: true,
				},
			],
		},
	},
};

async function prepareCompiledBook(page: Page, title: string): Promise<void> {
	await page.goto("/canon");
	await expect(page.locator('[data-view="canon"]')).toBeVisible();
	await page.getByLabel("书名").fill(title);
	await page.locator('input[accept=".txt,text/plain"]').setInputFiles({
		name: "canon-sample.txt",
		mimeType: "text/plain",
		buffer: readFileSync(join(FIXTURES, "canon-sample.txt")),
	});
	await page.waitForURL(/\/canon\/[^/]+$/, { timeout: 30_000 });
	await expect(page.locator('[data-view="canonbook"]')).toBeVisible();
	const state = page.locator(".canon-extract-state");
	await page.getByRole("button", { name: "开始抽取" }).click();
	await expect(state.locator(".canon-status")).toHaveText("有失败章", {
		timeout: 30_000,
	});
	await page.getByRole("button", { name: /第二章 旧信/ }).click();
	await page.getByRole("button", { name: "重跑这一章" }).click();
	await expect(state.locator(".canon-status")).toHaveText("已完成", {
		timeout: 30_000,
	});
	await page.getByRole("button", { name: "全书汇编" }).click();
	await expect(page.locator(".canon-compile .canon-status")).toHaveText(
		"已汇编",
		{ timeout: 60_000 },
	);
}

async function openCanonDialog(page: Page, title: string): Promise<void> {
	await page.goto("/");
	await page.getByRole("button", { name: "＋ 新建故事" }).click();
	const dialog = page.getByRole("form", { name: "新建故事" });
	await expect(dialog).toBeVisible();
	await dialog
		.getByRole("group", { name: "开局方式" })
		.getByRole("button", { name: "从原著开局" })
		.click();
	await expect(dialog.getByLabel("原著")).toBeVisible();
	await expect(dialog.getByLabel("原著")).toContainText(title);
	await dialog.getByLabel("原著").selectOption({ label: title });
	await expect(dialog.getByLabel("开局事件")).toBeVisible();
	await expect
		.poll(async () => dialog.getByLabel("开局事件").locator("option").count())
		.toBeGreaterThan(1);
	await dialog.getByLabel("开局事件").selectOption({ index: 1 });
}

test.describe("从原著开局", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("扮演原著人物：人物不进 NPC 名册", async ({ page }, testInfo) => {
		const bookTitle = `原著开局人物 ${testInfo.project.name}`;
		await prepareCompiledBook(page, bookTitle);
		await openCanonDialog(page, bookTitle);
		const dialog = page.getByRole("form", { name: "新建故事" });
		await expect
			.poll(async () => dialog.getByLabel("扮演人物").locator("option").count())
			.toBeGreaterThan(1);
		await dialog.getByLabel("扮演人物").selectOption({ label: "少年" });
		await dialog.getByRole("button", { name: "开始" }).click();
		await page.waitForURL(/\/stories\/[^/]+\/play$/, { timeout: 30_000 });
		const play = page.locator('[data-view="play"]');
		await expect(play).toBeVisible();
		await expect(play).toContainText("原著事件");
		await expectNoHorizontalOverflow(page);

		const storyId = new URL(page.url()).pathname.split("/")[2] ?? "";
		await page.goto(`/stories/${storyId}/memory`);
		const memory = page.locator('[data-view="memory"]');
		await expect(memory).toBeVisible();
		const pages = memory.locator(".plist button");
		await expect(pages.filter({ hasText: "守门人" })).not.toHaveCount(0);
		await expect(pages.filter({ hasText: "少年" })).toHaveCount(0);
		await expectNoHorizontalOverflow(page);
	});

	test("自创人物加叠加角色卡：卡文风与原著人物同时生效", async ({
		page,
	}, testInfo) => {
		const bookTitle = `原著开局自创 ${testInfo.project.name}`;
		await prepareCompiledBook(page, bookTitle);
		await openCanonDialog(page, bookTitle);
		const dialog = page.getByRole("form", { name: "新建故事" });
		await dialog
			.getByRole("group", { name: "扮演身份" })
			.getByRole("button", { name: "自创人物" })
			.click();
		await dialog.getByLabel("扮演名字").fill("旅人");
		await dialog.getByLabel("人设（可选）").fill("从山下来的旅人。");
		await dialog.getByLabel("叠加角色卡文件").setInputFiles({
			name: "style-card.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(CARD), "utf8"),
		});
		await expect(dialog).toContainText("style-card.json");
		await dialog.getByRole("button", { name: "开始" }).click();
		await page.waitForURL(/\/stories\/[^/]+\/play$/, { timeout: 30_000 });
		const play = page.locator('[data-view="play"]');
		await expect(play).toBeVisible();
		await expect(play).toContainText("原著事件");
		await expect(play).not.toContainText("卡的开场白不应该替换原著开局");

		const storyId = new URL(page.url()).pathname.split("/")[2] ?? "";
		const settings = await page.request.get(`/api/stories/${storyId}/settings`);
		expect(settings.ok()).toBeTruthy();
		const settingsBody = (await settings.json()) as {
			readonly persona: string | null;
		};
		expect(settingsBody.persona ?? "").toContain("从山下来的旅人。");

		await page.goto(`/stories/${storyId}/lore`);
		const lore = page.locator('[data-view="lore"]');
		await expect(lore).toBeVisible();
		await expect(lore).toContainText("文风守则");
		await lore.getByRole("heading", { name: /文风守则/ }).click();
		await expect(lore.locator("textarea")).toHaveValue(/禁止出现括号/);

		await page.goto(`/stories/${storyId}/memory`);
		const memory = page.locator('[data-view="memory"]');
		await expect(memory).toBeVisible();
		const pages = memory.locator(".plist button");
		await expect(pages.filter({ hasText: "少年" })).not.toHaveCount(0);
		await expect(pages.filter({ hasText: "守门人" })).not.toHaveCount(0);
		await expectNoHorizontalOverflow(page);
	});
});

import { type Locator, type Page, expect, test } from "@playwright/test";
import { createImportedStory, login } from "./helpers";

// memory-v5/05：故事记事就地编辑、自动锁定、可撤销（回到旧版本）。

async function edit(page: Page, locator: Locator, text: string): Promise<void> {
	await locator.click();
	await locator.fill(text);
	await page.locator("h1").click();
}

async function openNotebook(page: Page, storyId: string): Promise<Locator> {
	await page.goto(`/stories/${storyId}/memory`);
	const memory = page.locator('[data-view="memory"]');
	await memory.locator(".plist button", { hasText: "林雪" }).first().click();
	const block = memory.getByRole("region", { name: "故事记事" });
	await expect(block).toBeVisible();
	return block;
}

const nowOf = (block: Locator) =>
	block
		.locator(".nbsec")
		.filter({ hasText: "现在" })
		.locator("[contenteditable]");

test.describe("故事记事", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("就地编辑：改「现在」后保存，刷新仍在", async ({ page }) => {
		const storyId = await createImportedStory(page, `记事编辑 ${Date.now()}`);
		const block = await openNotebook(page, storyId);
		await edit(page, nowOf(block), "林雪决定今晚守在门厅。");
		await page.reload();
		const again = await openNotebook(page, storyId);
		await expect(nowOf(again)).toHaveText("林雪决定今晚守在门厅。");
	});

	test("自动锁定：改过的节显示已锁定，可以解锁", async ({ page }) => {
		const storyId = await createImportedStory(page, `记事锁定 ${Date.now()}`);
		const block = await openNotebook(page, storyId);
		const lock = block
			.locator(".nbhead")
			.filter({ hasText: "现在" })
			.locator(".lock");
		await expect(lock).toHaveAttribute("aria-pressed", "false");
		await edit(page, nowOf(block), "林雪在等人。");
		await expect(lock).toHaveAttribute("aria-pressed", "true");
		await expect(lock).toHaveText("已锁定");
		await lock.click();
		await expect(lock).toHaveAttribute("aria-pressed", "false");
	});

	test("撤销：回到上一版，旧版本仍在版本列表里", async ({ page }) => {
		const storyId = await createImportedStory(page, `记事撤销 ${Date.now()}`);
		const block = await openNotebook(page, storyId);
		const before = (await nowOf(block).textContent()) ?? "";
		await edit(page, nowOf(block), "改过的一句。");
		await expect(nowOf(block)).toHaveText("改过的一句。");
		await block.getByRole("button", { name: "版本" }).click();
		const versions = block.locator(".nbversions li");
		await expect(versions).toHaveCount(2);
		await versions.nth(1).getByRole("button", { name: "回到这一版" }).click();
		await expect(nowOf(block)).toHaveText(before);
		await block.getByRole("button", { name: "版本" }).click();
		await expect(block.locator(".nbversions li")).toHaveCount(3);
	});
});

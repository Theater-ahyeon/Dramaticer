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

function fixture(name: string): Buffer {
	return readFileSync(join(FIXTURES, name));
}

async function upload(
	page: Page,
	title: string,
	name: string,
	buffer: Buffer,
): Promise<void> {
	await page.goto("/canon");
	await expect(page.locator('[data-view="canon"]')).toBeVisible();
	await page.getByLabel("书名").fill(title);
	await page.locator('input[type="file"]').setInputFiles({
		name,
		mimeType: "text/plain",
		buffer,
	});
	await page.waitForURL(/\/canon\/[^/]+$/, { timeout: 30_000 });
	await expect(page.locator('[data-view="canonbook"]')).toBeVisible();
}

test.describe("原著导入与分章", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("导入 UTF-8 小说后能改标题、合并、拆分并刷新保留", async ({
		page,
	}, testInfo) => {
		const title = `原著 UTF-8 ${testInfo.project.name}`;
		await upload(page, title, "canon-sample.txt", fixture("canon-sample.txt"));
		const pageView = page.locator('[data-view="canonbook"]');
		await expect(pageView.locator("h1")).toHaveText(title);
		await expect(pageView.locator(".canon-file")).toHaveText(
			"canon-sample.txt",
		);
		await expect(pageView.locator(".canon-ch")).toHaveCount(8);
		await expectNoHorizontalOverflow(page);

		// 第二篇文章带段落序号；正文里的「第三天」没有被切成一章。
		await page.getByRole("button", { name: /第一章 山门的清晨/ }).click();
		await expect(page.locator(".canon-paras li")).toHaveCount(3);
		await expect(page.locator(".canon-paras li").nth(1)).toContainText(
			"第三天，雨停了。",
		);

		// 改标题与类型，保存后刷新仍在。
		await page.getByLabel("章节标题").fill("第一章 e2e 改名");
		await page.getByLabel("章节类型").selectOption("extra");
		await page.getByRole("button", { name: "保存" }).click();
		await expect(
			page.getByRole("button", { name: /第一章 e2e 改名/ }),
		).toBeVisible();
		await page.reload();
		await expect(pageView.locator(".canon-ch")).toHaveCount(8);
		const renamed = page.getByRole("button", { name: /第一章 e2e 改名/ });
		await expect(renamed).toContainText("番外");
		await renamed.click();
		await expect(page.locator(".canon-paras li")).toHaveCount(3);

		// 与下一章合并：章数减一，段落并入。
		await page.getByRole("button", { name: "与下一章合并" }).click();
		await expect(pageView.locator(".canon-ch")).toHaveCount(7);
		await expect(page.locator(".canon-paras li")).toHaveCount(4);
		await page.reload();
		await expect(pageView.locator(".canon-ch")).toHaveCount(7);

		// 在第 1 段后拆分：章数加一，出现「（续）」。
		await page.getByRole("button", { name: /第一章 e2e 改名/ }).click();
		await page.getByLabel("拆分位置").fill("1");
		await page.getByRole("button", { name: "拆分", exact: true }).click();
		await expect(pageView.locator(".canon-ch")).toHaveCount(8);
		await expect(
			page.getByRole("button", { name: /第一章 e2e 改名（续）/ }),
		).toBeVisible();
		await page.reload();
		await expect(pageView.locator(".canon-ch")).toHaveCount(8);
		await expectNoHorizontalOverflow(page);
	});

	test("导入 GB18030 小说没有乱码", async ({ page }, testInfo) => {
		const title = `原著 GB ${testInfo.project.name}`;
		await upload(
			page,
			title,
			"canon-sample-gb18030.txt",
			fixture("canon-sample-gb18030.txt"),
		);
		const pageView = page.locator('[data-view="canonbook"]');
		await expect(pageView.locator("h1")).toHaveText(title);
		await expect(pageView.locator(".vh .label")).toContainText("gb18030");
		await expect(pageView.locator(".canon-ch")).toHaveCount(8);
		await expect(page.getByRole("button", { name: /序章 雨夜/ })).toBeVisible();
		await page.getByRole("button", { name: /序章 雨夜/ }).click();
		await expect(page.locator(".canon-paras li")).toHaveCount(1);
		await expect(page.locator(".canon-paras li").first()).toContainText(
			"山门外的雨下了整夜",
		);
		await expectNoHorizontalOverflow(page);
	});
});

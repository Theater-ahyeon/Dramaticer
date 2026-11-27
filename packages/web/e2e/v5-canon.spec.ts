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
	await page.locator('input[accept=".txt,text/plain"]').setInputFiles({
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

	test("预估、抽取进度、失败章重跑与结果查看", async ({ page }, testInfo) => {
		const title = `原著抽取 ${testInfo.project.name}`;
		await upload(page, title, "canon-sample.txt", fixture("canon-sample.txt"));
		const pageView = page.locator('[data-view="canonbook"]');
		const estimate = pageView.locator('section[aria-label="抽取预估与进度"]');
		await expect(estimate).toContainText("章数");
		await expect(estimate).toContainText("参考费率");
		await expect(estimate.locator("dl").first()).toContainText("8");

		await page.getByRole("button", { name: "开始抽取" }).click();
		const state = pageView.locator(".canon-extract-state");
		await expect(state.locator(".canon-status")).toHaveText("有失败章", {
			timeout: 30_000,
		});
		await expect(state).toContainText("7/8 章");
		await expect(state).toContainText("失败 1 章");

		// 失败章显示校验错误，重跑后补齐。
		await page.getByRole("button", { name: /第二章 旧信/ }).click();
		await expect(page.locator(".canon-chapter .v4err")).toContainText(
			"没有在本块原文出现",
		);
		await page.getByRole("button", { name: "重跑这一章" }).click();
		await expect(state.locator(".canon-status")).toHaveText("已完成", {
			timeout: 30_000,
		});
		await expect(state).toContainText("8/8 章");

		// 结果视图：事件、话术与章节锚点。
		await page.getByRole("tab", { name: "抽取结果" }).click();
		await expect(page.locator(".canon-events")).toContainText("原著事件");
		await expect(page.locator(".canon-events")).toContainText("第 3 章");
		await expect(page.locator(".canon-voices")).toContainText("想");

		// 番外标为插叙。
		await page.getByRole("button", { name: /番外 师父的茶/ }).click();
		await page.getByRole("tab", { name: "抽取结果" }).click();
		await expect(page.locator(".canon-events .canon-badge")).toHaveText("插叙");
		await expectNoHorizontalOverflow(page);
	});

	test("全书汇编、实体与世界索引、时间线、导出与导入不重抽", async ({
		page,
	}, testInfo) => {
		const title = `原著汇编 ${testInfo.project.name}`;
		await upload(page, title, "canon-sample.txt", fixture("canon-sample.txt"));
		const pageView = page.locator('[data-view="canonbook"]');
		const state = pageView.locator(".canon-extract-state");

		// 先完成抽取（旧信这一章第一次故意失败）。
		await page.getByRole("button", { name: "开始抽取" }).click();
		await expect(state.locator(".canon-status")).toHaveText("有失败章", {
			timeout: 30_000,
		});
		await page.getByRole("button", { name: /第二章 旧信/ }).click();
		await page.getByRole("button", { name: "重跑这一章" }).click();
		await expect(state.locator(".canon-status")).toHaveText("已完成", {
			timeout: 30_000,
		});

		// 全书汇编：合并别名、排时间线、生成实体页。
		await page.getByRole("button", { name: "全书汇编" }).click();
		const compileStatus = pageView.locator(".canon-compile .canon-status");
		await expect(compileStatus).toHaveText("已汇编", { timeout: 60_000 });
		await expect(pageView.locator(".canon-compile")).toContainText("个实体");

		// 人物与世界索引：按章节游标切片，早期不含后期出场的实体。
		await page.getByRole("tab", { name: "人物与世界索引" }).click();
		await expect(page.locator(".canon-worldindex")).toContainText("世界索引：");
		await expect(page.locator(".canon-worldindex")).toContainText("守门人——");
		await expect(page.locator(".canon-entities > li")).not.toHaveCount(0);
		await page.getByLabel("截至章节").fill("1");
		await expect(page.locator(".canon-worldindex")).not.toContainText("少年——");
		await page.getByLabel("截至章节").fill("8");
		await expect(page.locator(".canon-worldindex")).toContainText("少年——");
		await expectNoHorizontalOverflow(page);

		// 时间线：主线顺序、关键转折与插叙。
		await page.getByRole("tab", { name: "时间线" }).click();
		await expect(page.locator(".canon-timeline")).toContainText("主时间线");
		await expect(page.locator(".canon-timeline")).toContainText("关键转折");
		await expect(page.locator(".canon-timeline")).toContainText("插叙");

		// 导出：默认不勾选包含原文，包里没有段落字段。
		await expect(page.getByLabel("包含原文")).not.toBeChecked();
		const downloadPromise = page.waitForEvent("download");
		await page.getByRole("button", { name: "导出原著包" }).click();
		const download = await downloadPromise;
		const downloadedPath = await download.path();
		if (downloadedPath === null) throw new Error("没有拿到下载的原著包");
		const raw = readFileSync(downloadedPath, "utf8");
		expect(raw).not.toContain('"paragraphs"');
		expect(raw).not.toContain("山门外的雨下了整夜");
		const pkg = JSON.parse(raw) as {
			readonly entities: readonly { readonly name: string }[];
		};
		expect(pkg.entities.length).toBeGreaterThan(0);

		// 导入他人的原著包：直接是已汇编状态，不需要再抽取。
		await page.goto("/canon");
		await expect(page.locator('[data-view="canon"]')).toBeVisible();
		await page.locator('input[accept=".json,application/json"]').setInputFiles({
			name: "copy.canon.json",
			mimeType: "application/json",
			buffer: Buffer.from(raw, "utf8"),
		});
		await page.waitForURL(/\/canon\/[^/]+$/, { timeout: 30_000 });
		await expect(pageView.locator(".canon-compile .canon-status")).toHaveText(
			"已汇编",
		);
		await expect(pageView).toContainText("这本原著包不含原文");
		await expect(state.locator(".canon-status")).toHaveText("已完成");
		await expect(state).toContainText("0 次调用");
		await page.getByRole("tab", { name: "人物与世界索引" }).click();
		await expect(page.locator(".canon-entities > li")).not.toHaveCount(0);
		await expectNoHorizontalOverflow(page);
	});
});

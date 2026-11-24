import { expect, test } from "@playwright/test";
import { createImportedStory, login } from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("检视器与助手在故事、记事、设定页都能叫出；一级界面不出现 token 与耗时", async ({
	page,
}, testInfo) => {
	const storyId = await createImportedStory(page, "检视器");
	await page.goto(`/stories/${storyId}/play`);
	const floors = page.locator('#script article.flr[id^="floor-"]');
	await expect(floors).toHaveCount(1);
	await page.getByRole("button", { name: /^推进/ }).click();
	await expect(floors).toHaveCount(2, { timeout: 60_000 });

	// 一级界面：正文、输入台与停靠栏里都没有 token、缓存命中、耗时数字。
	await page.getByRole("button", { name: "写法与本轮设置" }).click();
	const firstLevel = await page.locator(".main").innerText();
	expect(firstLevel).not.toMatch(/token|缓存|等了 .* 秒|\d+(\.\d+)?k 入/i);

	// 检视器从输入台的「⋯」打开，数字都在这里。
	await page
		.locator(".meta")
		.getByRole("button", { name: "检视器", exact: true })
		.click();
	const inspector = page.getByRole("dialog", { name: "检视器" });
	await expect(inspector).toBeVisible();
	for (const name of ["本轮", "上下文", "后台任务", "拒收", "渠道体检"]) {
		await expect(inspector.getByRole("region", { name })).toBeVisible();
	}
	await expect(inspector.getByRole("region", { name: "本轮" })).toContainText(
		"输入",
	);
	await expect(inspector).toContainText("重写率");
	await expect(
		inspector.getByRole("region", { name: "后台任务" }),
	).toContainText("每楼调用");
	await page.keyboard.press("Escape");
	await expect(inspector).toHaveCount(0);

	// 记事页与设定页：快捷键叫出检视器与助手（手机上没有键盘快捷键的导航按钮，也走快捷键）。
	for (const view of ["memory", "lore"]) {
		await page.goto(`/stories/${storyId}/${view}`);
		await expect(page.locator(`[data-view="${view}"]`)).toBeVisible();
		if (testInfo.project.name === "desktop") {
			await page.getByRole("button", { name: "打开检视器" }).click();
		} else {
			await page.keyboard.press("Control+.");
		}
		await expect(inspector).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(inspector).toHaveCount(0);

		if (testInfo.project.name === "desktop") {
			await page.getByRole("button", { name: "打开助手" }).click();
		} else {
			await page.keyboard.press("Control+Shift+A");
		}
		await expect(page.locator(".assistant-drawer")).toBeVisible();
		await page.getByRole("button", { name: "关闭助手" }).click();
		await expect(page.locator(".assistant-drawer")).toBeHidden();
	}
});

import { type Page, expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	login,
	readPreferenceCounts,
	sendTurn,
} from "./helpers";

// 原「聊天」旧面板的覆盖面迁到故事页（ui-v2/05）：思考折叠、状态块、选项偏好、
// 读取工具、深度写法的运行中追加要求、检视器里的运行记录、场面控制。

const floors = (page: Page) =>
	page.locator('#script article.flr[id^="floor-"]');

test.describe("故事页：旧聊天页迁来的功能", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("思考折叠、状态块、选项记成偏好、读取工具", async ({ page }) => {
		const storyId = await createImportedStory(page, "故事页迁移");
		await page.goto(`/stories/${storyId}/play`);
		await expect(floors(page)).toHaveCount(1);

		await sendTurn(page, storyId, "第一次行动");
		const last = floors(page).last();
		const thinking = last.locator("details").first();
		await expect(thinking).toBeVisible();
		await expect(thinking).not.toHaveAttribute("open");
		await expect(last.locator(".statusline")).toContainText("体力");

		// 选项点一下直接发出去，同时记一条选择偏好。
		const count = await floors(page).count();
		await page.locator(".opts .chip", { hasText: "推门进去" }).click();
		await expect(floors(page)).toHaveCount(count + 1, { timeout: 60_000 });
		await expect
			.poll(() => readPreferenceCounts(storyId).get("choice") ?? 0)
			.toBe(1);

		await sendTurn(page, storyId, "读取状态");
		await expect(floors(page).last()).toContainText("读取状态");
		await expectNoHorizontalOverflow(page);
	});

	test("深度写法：故事锁定时默认选中，运行中能追加要求，检视器里看运行记录", async ({
		page,
	}) => {
		const storyId = await createImportedStory(page, "深度追加");
		const locked = await page.request.put(`/api/stories/${storyId}/settings`, {
			data: { turnMode: "deep" },
		});
		expect(locked.ok()).toBeTruthy();
		await page.goto(`/stories/${storyId}/play`);
		await page.getByRole("button", { name: "写法与本轮设置" }).click();
		await expect(
			page.getByRole("group", { name: "写法" }).getByRole("button", {
				name: "深度",
			}),
		).toHaveAttribute("aria-pressed", "true");

		const steers: unknown[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST" && request.url().includes("/steer")) {
				steers.push(request.postDataJSON());
			}
		});
		const input = page.locator(".say textarea");
		await input.fill("深回合草稿：写下开场");
		await page.getByRole("button", { name: "发送" }).click();
		await input.fill("让门外的脚步停下来");
		await page.getByRole("button", { name: "追加" }).click({ timeout: 15_000 });
		await expect.poll(() => steers.length).toBe(1);
		await expect(floors(page).last()).toContainText(
			"草稿：门在风里响了一声。",
			{ timeout: 30_000 },
		);

		await page.getByRole("button", { name: "检视器" }).first().click();
		const run = page.getByRole("region", { name: "运行记录" });
		await expect(run).toContainText("模型请求");
		await expect(run).toContainText("工具调用");
		await expect(run).toContainText("草稿提交");
		await expect(run).toContainText("追加要求");
	});

	test("场面控制：结束这一场、跳到某个时间", async ({ page }) => {
		const storyId = await createImportedStory(page, "场面控制");
		await page.goto(`/stories/${storyId}/play`);
		await sendTurn(page, storyId, "读取状态");

		const results: { scenes: { endNodeId: string | null }[] }[] = [];
		page.on("response", async (response) => {
			if (!response.url().includes("/scene-control")) return;
			results.push(await response.json());
		});
		await page.getByRole("button", { name: "写法与本轮设置" }).click();
		await page.getByRole("button", { name: "结束这一场" }).click();
		await expect.poll(() => results.length).toBe(1);
		expect(
			results[0]?.scenes.filter((scene) => scene.endNodeId !== null),
		).toHaveLength(1);

		const jump = page.getByLabel("跳到的时间");
		await jump.fill("三天后的清晨");
		await jump.press("Enter");
		await expect.poll(() => results.length).toBe(2);
		await expectNoHorizontalOverflow(page);
	});
});

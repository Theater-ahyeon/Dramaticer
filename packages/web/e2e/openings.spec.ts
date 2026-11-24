import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login, pathNodeCount } from "./helpers";

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "林雪",
		description: "旧宅的守夜人，习惯在门厅点一盏灯。",
		first_mes: "门外的雨下了一整夜。",
		alternate_greetings: ["{{char}}在门厅等{{user}}。"],
	},
};

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("导卡后开场白立即显示、可左右切换；开局候选可选、可换一批", async ({
	page,
}) => {
	const storyId = `e2e-${randomUUID()}`;
	expect(
		(
			await page.request.post("/api/stories", {
				data: { id: storyId, title: "开场端到端" },
			})
		).ok(),
	).toBeTruthy();
	expect(
		(
			await page.request.post(`/api/stories/${storyId}/import`, {
				data: { card: { format: "json", data: JSON.stringify(CARD) } },
			})
		).ok(),
	).toBeTruthy();

	await page.goto(`/stories/${storyId}/play`);
	const floors = page.locator('#script article.flr[id^="floor-"]');
	await expect(floors).toHaveCount(1);
	await expect(floors.first()).toContainText("门外的雨下了一整夜。");

	// 多条开场白左右切换，占位名换成卡名与「你」。
	const nav = page.locator(".greetnav");
	await expect(nav).toContainText("1 / 2");
	await page.getByRole("button", { name: "下一条开场白" }).click();
	await expect(floors.first()).toContainText("林雪在门厅等你。");
	await expect(nav).toContainText("2 / 2");
	await page.getByRole("button", { name: "上一条开场白" }).click();
	await expect(floors.first()).toContainText("门外的雨下了一整夜。");
	await expect(floors).toHaveCount(1);

	// 后台备好的开局候选以卡片显示；换一批会追加新的一批。
	const cards = page.locator(".opencard");
	await expect(cards).toHaveCount(3, { timeout: 30_000 });
	await page.getByRole("button", { name: "换一批开局" }).click();
	await expect(cards).toHaveCount(6, { timeout: 30_000 });
	await expectNoHorizontalOverflow(page);

	// 点一张卡片替换开场。
	const chosen = (await cards.first().innerText()).trim();
	await cards.first().click();
	await expect(floors.first()).toContainText(chosen);
	await expect(floors).toHaveCount(1);
	expect(await pathNodeCount(page, storyId)).toBe(1);

	// 一开口，开场区就收起。
	await page.locator(".say textarea").fill("我去开门");
	await page.getByRole("button", { name: "发送" }).click();
	await expect(floors).toHaveCount(2, { timeout: 60_000 });
	await expect(page.locator(".opening")).toHaveCount(0);
});

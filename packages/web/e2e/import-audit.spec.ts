import { randomUUID } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import { PASSWORD, login } from "./helpers.js";

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "潮汐列岛",
		description: "被潮水切成许多块的列岛。",
		first_mes: "潮水退了。",
		character_book: {
			name: "潮汐列岛",
			entries: [
				{
					id: 1,
					keys: [],
					comment: "世界观",
					content: "这是一个被潮汐分开的列岛世界。",
					enabled: true,
					constant: true,
				},
				{
					id: 2,
					keys: ["林雪"],
					comment: "人物：林雪",
					content: "守夜人，习惯在门厅点一盏灯。",
					enabled: true,
				},
				{
					id: 3,
					keys: [],
					comment: "草稿",
					content: "还没有归类的段落，先放在这里。",
					enabled: true,
				},
				{
					id: 4,
					keys: [],
					comment: "总结",
					content: "前情提要：潮水退了，林雪点亮了灯。",
					enabled: true,
					constant: true,
				},
			],
		},
	},
};

async function createAuditedStory(
	page: Page,
	id: string,
	title: string,
): Promise<void> {
	const created = await page.request.post("/api/stories", {
		data: { id, title },
	});
	expect(created.ok()).toBeTruthy();
	const imported = await page.request.post(`/api/stories/${id}/import`, {
		data: { card: { format: "json", data: JSON.stringify(CARD) } },
	});
	expect(imported.ok()).toBeTruthy();
}

// 旧「体检」面板拆除后（ui-v2/05），导入体检在设定页：类型分布、每轮固定带入、
// 逐条改类型、导入方式切换，以及插件残留转成初始记忆。
test.describe("导入体检（设定页）", () => {
	test.beforeEach(async ({ page }) => {
		await login(page, PASSWORD);
	});

	const chip = (page: Page, label: string) =>
		page.locator(".filters .chip", {
			hasText: new RegExp(`^(?:${label}) \\d+$`),
		});

	test("显示类型条数与固定带入，改类型后数字重算", async ({ page }) => {
		const id = `e2e-audit-${randomUUID()}`;
		const title = `潮汐列岛 ${id}`;
		await createAuditedStory(page, id, title);

		await page.goto(`/stories/${id}/lore`);
		const view = page.locator(`[data-view="lore"]`);
		await expect(view.locator("h1")).toContainText("潮汐列岛");
		await expect(view).toContainText("4");
		await expect(chip(page, "常识")).toHaveText("常识 1");
		await expect(chip(page, "人物地点")).toHaveText("人物地点 1");
		await expect(chip(page, "未分类|没认出")).toHaveText(/ 1$/);
		await expect(chip(page, "插件残留")).toHaveText("插件残留 1");

		const before = Number(await view.locator(".cost .big.was").innerText());
		const after = Number(
			await view.locator(".cost .big:not(.was)").innerText(),
		);
		expect(before).toBeGreaterThan(after);
		expect(after).toBeGreaterThan(0);

		const draft = view.locator(".entry", { hasText: "草稿" });
		await draft.locator(".head").click();
		await expect(draft.locator("textarea")).toHaveValue(/还没有归类的段落/);
		await draft.locator("select").selectOption("common");
		await expect(chip(page, "常识")).toHaveText("常识 2");
		await expect(chip(page, "未分类|没认出")).toHaveCount(0);
		await draft.locator("select").selectOption("unknown");
		await expect(chip(page, "常识")).toHaveText("常识 1");
	});

	test("切换导入方式，插件残留转成初始记忆后可撤销", async ({ page }) => {
		const id = `e2e-audit-mode-${randomUUID()}`;
		const title = `潮汐列岛 ${id}`;
		await createAuditedStory(page, id, title);

		await page.goto(`/stories/${id}/lore`);
		const mode = page.getByRole("group", { name: "导入方式" });
		const upgrade = mode.getByRole("button", { name: "优化" });
		const raw = mode.getByRole("button", { name: "原样" });
		await expect(upgrade).toHaveAttribute("aria-pressed", "true");
		await raw.click();
		await expect(raw).toHaveAttribute("aria-pressed", "true");
		await expect(
			fetchImportMode(page, `/api/stories/${id}/import-audit`),
		).resolves.toBe("raw");

		const residue = page.locator(".entry", { hasText: "总结" });
		await residue.locator(".head").click();
		await residue.getByRole("button", { name: "转为初始记忆" }).click();
		await expect(
			residue.locator(".pill", { hasText: "初始记忆" }),
		).toBeVisible();
		await expect.poll(() => residueMemory(page, id)).toBe(true);

		await residue.getByRole("button", { name: "撤销转换" }).click();
		await expect(residue.locator(".pill", { hasText: "初始记忆" })).toHaveCount(
			0,
		);
		await expect.poll(() => residueMemory(page, id)).toBe(false);

		await upgrade.click();
		await expect(upgrade).toHaveAttribute("aria-pressed", "true");
		await expect(
			fetchImportMode(page, `/api/stories/${id}/settings`),
		).resolves.toBe("upgrade");
	});
});

async function residueMemory(page: Page, id: string): Promise<boolean> {
	const response = await page.request.get(`/api/stories/${id}/lore-copy`);
	const body = (await response.json()) as {
		entries: { kind: string; memory: boolean }[];
	};
	return body.entries.some(
		(entry) => entry.kind === "plugin-residue" && entry.memory,
	);
}

async function fetchImportMode(page: Page, path: string): Promise<unknown> {
	const response = await page.request.get(path);
	expect(response.ok()).toBeTruthy();
	const body: unknown = await response.json();
	if (typeof body !== "object" || body === null || !("importMode" in body)) {
		throw new Error(`${path} 的响应里没有 importMode`);
	}
	return body.importMode;
}

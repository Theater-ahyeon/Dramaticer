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

test.describe("导入体检", () => {
	test.beforeEach(async ({ page }) => {
		await login(page, PASSWORD);
	});

	test("显示类型条数与 token，展开未识别条目，调整与恢复后数字重算", async ({
		page,
	}) => {
		const id = `e2e-audit-${randomUUID()}`;
		const title = `潮汐列岛 ${id}`;
		await createAuditedStory(page, id, title);

		await page.goto(`/stories/${id}/audit`);
		const panel = page.locator(".import-audit");
		await panel.waitFor();
		await expect(panel.locator("h1")).toContainText(title);
		await expect(panel).toContainText("这张卡的世界书有 4 条");

		const count = (kind: string) =>
			panel.locator(
				`.import-audit-counts li[data-kind="${kind}"] .import-audit-count-value`,
			);
		await expect(count("common")).toHaveText("1");
		await expect(count("entity")).toHaveText("1");
		await expect(count("unknown")).toHaveText("1");
		await expect(count("plugin-residue")).toHaveText("1");

		const before = await panel
			.locator(".import-audit-token-before")
			.innerText();
		const after = await panel.locator(".import-audit-token-after").innerText();
		expect(Number(before)).toBeGreaterThan(0);
		expect(Number(after)).toBeGreaterThan(0);

		const unknownSection = panel.locator(
			'.import-audit-section[data-group="unknown"]',
		);
		await expect(unknownSection).toContainText("草稿");
		await unknownSection.locator("summary").click();
		await expect(unknownSection.locator("pre")).toContainText(
			"还没有归类的段落",
		);

		await unknownSection.getByLabel("草稿 的类型").selectOption("common");
		await expect(count("unknown")).toHaveText("0");
		await expect(count("common")).toHaveText("2");
		await expect(unknownSection).toContainText("没有未识别条目");
		await expect
			.poll(async () =>
				Number(await panel.locator(".import-audit-token-after").innerText()),
			)
			.toBeGreaterThan(Number(after));

		await panel.locator(".import-audit-all > summary").click();
		const row = panel.locator(".import-audit-all-row").filter({
			hasText: "草稿",
		});
		await expect(row.getByLabel("全部条目：草稿 的类型")).toHaveValue("common");
		await row.getByRole("button", { name: /恢复规则判定/ }).click();
		await expect(count("unknown")).toHaveText("1");
		await expect(count("common")).toHaveText("1");
		await expect
			.poll(async () =>
				Number(await panel.locator(".import-audit-token-after").innerText()),
			)
			.toBe(Number(after));
	});

	test("切换导入模式，插件残留转成初始记忆后不再常驻并可撤销", async ({
		page,
	}) => {
		const id = `e2e-audit-mode-${randomUUID()}`;
		const title = `潮汐列岛 ${id}`;
		await createAuditedStory(page, id, title);

		await page.goto(`/stories/${id}/audit`);
		const panel = page.locator(".import-audit");
		await panel.waitFor();

		const upgrade = panel.getByRole("button", { name: "升级模式" });
		const raw = panel.getByRole("button", { name: "原样模式" });
		await expect(upgrade).toHaveAttribute("aria-pressed", "true");

		const rawTokens = async (): Promise<number> =>
			Number(await panel.locator(".import-audit-token-before").innerText());
		const upgradeTokens = async (): Promise<number> =>
			Number(await panel.locator(".import-audit-token-after").innerText());
		const beforeRaw = await rawTokens();
		const beforeUpgrade = await upgradeTokens();
		expect(beforeRaw).toBeGreaterThan(beforeUpgrade);

		await raw.click();
		await expect(raw).toHaveAttribute("aria-pressed", "true");
		await expect(upgrade).toHaveAttribute("aria-pressed", "false");
		await expect(
			fetchImportMode(page, `/api/stories/${id}/import-audit`),
		).resolves.toBe("raw");

		const residueSection = panel.locator(
			'.import-audit-section[data-group="plugin-residue"]',
		);
		await expect(residueSection).toContainText("总结");
		await expect(
			residueSection.locator('.import-audit-entry[data-memory="false"]'),
		).toHaveCount(1);

		await residueSection
			.getByRole("button", { name: /全部转为初始记忆/ })
			.click();
		await expect(
			residueSection.locator('.import-audit-entry[data-memory="true"]'),
		).toHaveCount(1);
		await expect(residueSection).toContainText("初始记忆");
		await expect.poll(rawTokens).toBeLessThan(beforeRaw);
		await expect.poll(upgradeTokens).toBe(beforeUpgrade);

		await residueSection.getByRole("button", { name: "撤销转换" }).click();
		await expect(
			residueSection.locator('.import-audit-entry[data-memory="false"]'),
		).toHaveCount(1);
		await expect.poll(rawTokens).toBe(beforeRaw);

		await upgrade.click();
		await expect(upgrade).toHaveAttribute("aria-pressed", "true");
		await expect(
			fetchImportMode(page, `/api/stories/${id}/settings`),
		).resolves.toBe("upgrade");
	});
});

async function fetchImportMode(page: Page, path: string): Promise<unknown> {
	const response = await page.request.get(path);
	expect(response.ok()).toBeTruthy();
	const body: unknown = await response.json();
	if (typeof body !== "object" || body === null || !("importMode" in body)) {
		throw new Error(`${path} 的响应里没有 importMode`);
	}
	return body.importMode;
}

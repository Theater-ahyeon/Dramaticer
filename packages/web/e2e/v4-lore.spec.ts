import { randomUUID } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "林雪",
		description: "旧宅的守夜人，习惯在门厅点一盏灯。",
		first_mes: "门外的雨下了一整夜。",
		character_book: {
			name: "旧宅",
			entries: [
				{
					id: 1,
					keys: ["门厅"],
					comment: "人物 · 门厅",
					content: "门厅的灯总是亮着，直到有人敲门。",
					enabled: true,
				},
				{
					id: 2,
					keys: [],
					comment: "规则 · 门禁",
					content: "每次推门要消耗 1 点体力。",
					enabled: true,
					constant: true,
				},
			],
		},
	},
} as const;

const DOOR_CONTENT = "门厅的灯总是亮着，直到有人敲门。";
const EDITED_CONTENT = "门厅的灯被她熄了。";

async function createLoreStory(page: Page, title: string): Promise<string> {
	const id = `e2e-${randomUUID()}`;
	const created = await page.request.post("/api/stories", {
		data: { id, title },
	});
	expect(created.ok()).toBeTruthy();
	const imported = await page.request.post(`/api/stories/${id}/import`, {
		data: { card: { format: "json", data: JSON.stringify(CARD) } },
	});
	expect(imported.ok()).toBeTruthy();
	return id;
}

interface LoreCopyView {
	readonly entries: readonly {
		readonly id: string;
		readonly name: string;
		readonly content: string;
		readonly disabled: boolean;
	}[];
}

async function loreCopy(page: Page, storyId: string): Promise<LoreCopyView> {
	const response = await page.request.get(`/api/stories/${storyId}/lore-copy`);
	expect(response.ok()).toBeTruthy();
	return (await response.json()) as LoreCopyView;
}

test.describe("新界面设定页", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("改设定只影响这个故事，能停用、恢复原卡，也能在优化与原样之间切换", async ({
		page,
	}) => {
		const stamp = Date.now();
		const storyId = await createLoreStory(page, `设定页 ${stamp}`);
		const otherId = await createLoreStory(page, `设定页对照 ${stamp}`);
		await page.goto(`/stories/${storyId}/lore`);

		const lore = page.locator('[data-view="lore"]');
		await expect(lore).toBeVisible();
		await expect(lore.locator("h1")).toContainText("设定");

		// 类型分布与「每轮固定带入」的前后对比。
		await expect(lore.locator(".bar i")).toHaveCount(2);
		await expect(lore.locator(".cost")).toContainText("每轮固定带入");

		// 按类型筛选：人物地点只剩门厅，全部恢复两条。
		await lore.getByRole("button", { name: /人物地点/ }).click();
		await expect(lore.locator("#entries .entry")).toHaveCount(1);
		await expect(lore.locator("#entries .entry")).toContainText("门厅");
		await lore.getByRole("button", { name: /全部/ }).click();
		await expect(lore.locator("#entries .entry")).toHaveCount(2);

		// 就地修改一条，只写进这个故事的副本。
		const door = lore.locator(".entry").filter({ hasText: "门厅" });
		await door.locator(".head").click();
		await door.locator("textarea").fill(EDITED_CONTENT);
		await door.getByRole("button", { name: "保存" }).click();
		await expect(page.locator(".toast")).toContainText("已保存");
		await expect(door.getByText("你改的")).toBeVisible();
		await page.reload();

		const edited = lore.locator(".entry").filter({ hasText: "门厅" });
		await edited.locator(".head").click();
		await expect(edited.locator("textarea")).toHaveValue(EDITED_CONTENT);
		await expect(edited.getByText("你改的")).toBeVisible();

		const other = await loreCopy(page, otherId);
		const untouched = other.entries.find((entry) =>
			entry.name.includes("门厅"),
		);
		expect(untouched?.content).toBe(DOOR_CONTENT);

		// 停用只影响这一条，刷新后保持。
		const doorSwitch = edited.getByRole("switch", { name: /启用/ });
		await doorSwitch.click();
		await expect(page.locator(".toast")).toContainText("已停用");
		await expect(doorSwitch).toHaveAttribute("aria-checked", "false");
		await page.reload();
		const disabled = lore.locator(".entry").filter({ hasText: "门厅" });
		await expect(
			disabled.getByRole("switch", { name: /启用/ }),
		).toHaveAttribute("aria-checked", "false");

		// 恢复原卡：内容回到卡里的样子，修改与停用都撤销，历史仍可查。
		const before = await loreCopy(page, storyId);
		const doorEntry = before.entries.find((entry) =>
			entry.name.includes("门厅"),
		);
		expect(doorEntry).toBeDefined();
		await lore.getByRole("button", { name: "恢复原卡" }).click();
		await expect(page.locator(".toast")).toContainText("恢复成卡的原样");
		await page.reload();

		const restored = lore.locator(".entry").filter({ hasText: "门厅" });
		await restored.locator(".head").click();
		await expect(restored.locator("textarea")).toHaveValue(DOOR_CONTENT);
		await expect(restored.getByText("你改的")).toHaveCount(0);
		await expect(
			restored.getByRole("switch", { name: /启用/ }),
		).toHaveAttribute("aria-checked", "true");

		const historyResponse = await page.request.get(
			`/api/stories/${storyId}/memory/history?kind=lore&target=${encodeURIComponent(doorEntry?.id ?? "")}`,
		);
		expect(historyResponse.ok()).toBeTruthy();
		const history = (await historyResponse.json()) as {
			edits: readonly { source: string }[];
		};
		expect(history.edits.some((edit) => edit.source === "restore")).toBe(true);

		// 优化与原样切换，刷新后保持。
		const mode = lore.getByRole("group", { name: "导入方式" });
		await mode.getByRole("button", { name: "原样" }).click();
		await expect(mode.getByRole("button", { name: "原样" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.reload();
		const modeAfterReload = lore.getByRole("group", { name: "导入方式" });
		await expect(
			modeAfterReload.getByRole("button", { name: "原样" }),
		).toHaveAttribute("aria-pressed", "true");
		await modeAfterReload.getByRole("button", { name: "优化" }).click();
		await expect(
			modeAfterReload.getByRole("button", { name: "优化" }),
		).toHaveAttribute("aria-pressed", "true");

		await expectNoHorizontalOverflow(page);
	});
});

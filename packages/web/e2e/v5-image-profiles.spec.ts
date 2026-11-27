import { randomUUID } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

const CHARACTERS = {
	characters: [
		{
			name: "凛",
			base: ["black long hair", "red eyes"],
			negative: ["bad hands"],
			locked: false,
			slots: {
				face: {
					front: { clothed: ["face front"], bare: ["face front bare"] },
					back: { clothed: ["face back"], bare: ["face back bare"] },
				},
				upper: {
					front: { clothed: ["upper front"], bare: ["upper front bare"] },
					back: { clothed: ["upper back"], bare: ["upper back bare"] },
				},
				full: {
					front: { clothed: ["full front"], bare: ["full front bare"] },
					back: { clothed: ["full back"], bare: ["full back bare"] },
				},
			},
			outfits: [
				{
					name: "深蓝校服",
					upper: { visible: ["navy blazer"], hidden: ["navy collar"] },
					full: { visible: ["pleated skirt"], hidden: ["skirt hem"] },
					default: true,
				},
			],
		},
		{
			name: "阿岚",
			base: ["short silver hair"],
			outfits: [
				{
					name: "灰色夹克",
					upper: { visible: ["grey jacket"], hidden: ["jacket collar"] },
					default: true,
				},
			],
		},
	],
};

const PRESET = {
	prompts: [
		{
			name: "动作·拔剑",
			category: "动作",
			content: "dynamic pose, sword swing",
			keywords: ["拔剑", "sword"],
		},
		{
			name: "表情·微笑",
			type: "expression",
			content: "soft smile",
			keys: "微笑,smile",
		},
		{ name: "画风", content: "clean lineart, muted colors" },
		{ name: "停用条目", content: "keep this off", enabled: false },
	],
};

async function createStory(page: Page, title: string): Promise<string> {
	const id = `e2e-image-${randomUUID()}`;
	const created = await page.request.post("/api/stories", {
		data: { id, title },
	});
	expect(created.ok()).toBeTruthy();
	return id;
}

function fileInput(page: Page, label: string) {
	return page.getByLabel(label);
}

test("设定页编辑分格档案、服装、标签库并导入智绘姬文件", async ({ page }) => {
	await login(page);
	const storyId = await createStory(page, `插图设定 ${Date.now()}`);
	await page.goto(`/stories/${storyId}/lore`);
	const lore = page.locator('[data-view="lore"]');
	await expect(lore).toBeVisible();

	const importSection = lore.getByRole("region", { name: "导入兼容文件" });
	await fileInput(page, "智绘姬角色/服装 JSON").setInputFiles({
		name: "characters.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(CHARACTERS)),
	});
	await expect(
		importSection.getByText("已导入 2 个人物、2 套服装"),
	).toBeVisible();

	const profiles = lore.getByRole("region", { name: "分格视觉档案" });
	const rin = profiles.locator('[data-character="凛"]');
	await expect(rin).toBeVisible();
	const lock = rin.getByRole("switch", { name: "锁定 凛" });
	await expect(lock).toHaveAttribute("aria-checked", "false");
	await lock.click();
	await expect(lock).toHaveAttribute("aria-checked", "true");

	await rin.getByRole("button", { name: "编辑分格" }).click();
	await rin.getByLabel("凛 脸·正面·着装").fill("edited face front, sharp gaze");
	await rin.getByLabel("凛 全身·背面·裸露").fill("back scar");
	await rin.getByRole("button", { name: "保存视觉档案" }).click();
	await expect(importSection.getByText("已保存 凛 的视觉档案")).toBeVisible();

	const outfits = lore.getByRole("region", { name: "独立服装" });
	await expect(outfits.locator('[data-outfit="深蓝校服"]')).toBeVisible();
	await expect(outfits.locator('[data-outfit="灰色夹克"]')).toBeVisible();
	await outfits.getByRole("button", { name: "新增服装" }).click();
	await outfits.getByLabel("新服装名称").fill("夜行衣");
	await outfits.getByLabel("新服装上身可见").fill("black cloak");
	await outfits.getByLabel("新服装全身隐藏").fill("cloak hem");
	await outfits.getByRole("button", { name: "保存服装" }).click();
	await expect(importSection.getByText("已保存服装：夜行衣")).toBeVisible();
	await expect(outfits.locator('[data-outfit="夜行衣"]')).toBeVisible();

	await fileInput(page, "智绘姬生图预设 JSON").setInputFiles({
		name: "preset.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(PRESET)),
	});
	await expect(
		importSection.getByText("已导入 2 条标签、2 条画面整理条目"),
	).toBeVisible();

	const tags = lore.getByRole("region", { name: "标签库" });
	const sword = tags.locator('[data-tag="动作·拔剑"]');
	await expect(sword).toContainText("动作");
	await expect(tags.locator('[data-tag="表情·微笑"]')).toBeVisible();
	await sword.getByRole("button", { name: "编辑标签" }).click();
	await sword.getByLabel("标签内容").fill("dynamic pose, sword raised");
	await sword.getByRole("button", { name: "保存标签" }).click();
	await expect(importSection.getByText("已保存标签：动作·拔剑")).toBeVisible();

	const organizer = lore.getByRole("region", { name: "画面整理条目" });
	await expect(organizer.locator('[data-organizer="画风"]')).toBeVisible();
	await expect(organizer.locator('[data-organizer="停用条目"]')).toBeVisible();

	await page.reload();
	await expect(lore).toBeVisible();
	const reloadedProfiles = lore.getByRole("region", { name: "分格视觉档案" });
	const reloadedRin = reloadedProfiles.locator('[data-character="凛"]');
	await expect(
		reloadedRin.getByRole("switch", { name: "锁定 凛" }),
	).toHaveAttribute("aria-checked", "true");
	await reloadedRin.getByRole("button", { name: "编辑分格" }).click();
	await expect(reloadedRin.getByLabel("凛 脸·正面·着装")).toHaveValue(
		"edited face front、sharp gaze",
	);
	await expect(reloadedRin.getByLabel("凛 全身·背面·裸露")).toHaveValue(
		"back scar",
	);
	await expect(
		lore
			.getByRole("region", { name: "独立服装" })
			.locator('[data-outfit="夜行衣"]'),
	).toBeVisible();
	await expect(
		lore
			.getByRole("region", { name: "标签库" })
			.locator('[data-tag="动作·拔剑"]'),
	).toContainText("dynamic pose, sword raised");
	await expect(
		lore
			.getByRole("region", { name: "画面整理条目" })
			.locator('[data-organizer="画风"]'),
	).toBeVisible();

	const writing = await page.request.get(`/api/stories/${storyId}/writing`);
	expect(writing.ok()).toBeTruthy();
	const writingView = (await writing.json()) as {
		entries: readonly { scope: string; name: string }[];
	};
	expect(
		writingView.entries.filter((entry) => entry.scope === "image_organizer")
			.length,
	).toBe(2);
	expect(
		writingView.entries.filter((entry) => entry.scope === "turn"),
	).toHaveLength(0);

	const tagView = await page.request.get(`/api/stories/${storyId}/image-tags`);
	expect(tagView.ok()).toBeTruthy();
	const tagsView = (await tagView.json()) as {
		entries: readonly { name: string; category: string; keywords: string[] }[];
	};
	expect(
		tagsView.entries.find((entry) => entry.name === "动作·拔剑")?.category,
	).toBe("action");
	expect(
		tagsView.entries.find((entry) => entry.name === "动作·拔剑")?.keywords,
	).toEqual(["拔剑", "sword"]);

	await expectNoHorizontalOverflow(page);
});

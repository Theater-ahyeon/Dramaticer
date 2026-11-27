import { type Page, expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

const BOOK_TITLE = "原著页 e2e";
const ORIGINAL_SUMMARY = "雨夜入门 的概要。";

function packageView(): unknown {
	return {
		format: "dramaticer-canon-package",
		version: 1,
		exportedAt: "2026-11-27T00:00:00.000Z",
		book: {
			title: BOOK_TITLE,
			filename: null,
			encoding: "utf-8",
			charCount: 400,
			chapterCount: 4,
			hasText: true,
		},
		chapters: [1, 2, 3, 4].map((ordinal) => ({
			ordinal,
			volumeTitle: null,
			title: `第${ordinal}章`,
			kind: "chapter" as const,
			charCount: 100,
			paragraphCount: 1,
			paragraphs: [`第${ordinal}章 的原文。`],
		})),
		entities: [
			{
				name: "少年",
				aliases: [],
				kind: "人物",
				lead: "山门里的少年弟子。",
				base: "第1章 少年是山门弟子。",
				baseEntries: [{ chapterOrdinal: 1, text: "少年是山门弟子。" }],
				firstChapterOrdinal: 1,
				lastChapterOrdinal: 1,
			},
		],
		events: ["雨夜入门", "旧剑出土", "少女现身", "渡口"].map(
			(title, index) => ({
				chapterOrdinal: index + 1,
				seq: 1,
				title,
				summary: `${title} 的概要。`,
				digest: `${title} 的缩写。`,
				participants: ["少年"],
				location: "山门",
				timeText: null,
				paragraphStart: 1,
				paragraphEnd: 1,
				isInterlude: false,
				timelineOrder: index + 1,
				isTurningPoint: index === 0,
			}),
		),
		voices: [
			{
				chapterOrdinal: 1,
				ordinal: 1,
				character: "少年",
				kind: "speech",
				text: "我回来了。",
			},
		],
		facts: [],
	};
}

async function startCanonStory(page: Page): Promise<string> {
	const imported = await page.request.post("/api/canon/packages/import", {
		data: { package: packageView() },
	});
	expect(imported.ok()).toBeTruthy();
	const importedBody = (await imported.json()) as {
		readonly book: { readonly id: string };
	};
	const started = await page.request.post("/api/canon/start-story", {
		data: {
			bookId: importedBody.book.id,
			identityKind: "custom",
			playerName: "旅人",
			persona: "从山下来的旅人。",
		},
	});
	expect(started.ok()).toBeTruthy();
	const startedBody = (await started.json()) as {
		readonly story: { readonly id: string };
	};
	return startedBody.story.id;
}

async function openContext(page: Page): Promise<void> {
	const opener = page.locator(".dockbtn");
	if (await opener.isVisible()) {
		await opener.click();
		await expect(page.locator(".dockwrap")).toHaveClass(/open/);
	}
	await page.getByRole("tab", { name: "上下文" }).click();
	await page.getByRole("button", { name: "导演与大纲" }).click();
}

async function closeContext(page: Page): Promise<void> {
	if (await page.locator(".dockbtn").isVisible()) {
		await page.keyboard.press("Escape");
		await expect(page.locator(".dockwrap")).not.toHaveClass(/open/);
	}
}

async function sendFloor(page: Page, text: string): Promise<void> {
	const floors = page.locator('#script article.flr[id^="floor-"]');
	const before = await floors.count();
	await page.locator(".say textarea").fill(text);
	await page.getByRole("button", { name: "发送" }).click();
	await expect(floors).toHaveCount(before + 1, { timeout: 60_000 });
	await expect(page.getByRole("button", { name: "停下" })).toHaveCount(0, {
		timeout: 30_000,
	});
}

test.describe("原著页", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("就地改概要、话术并保存后，窗口用改过的内容", async ({ page }) => {
		const storyId = await startCanonStory(page);
		await page.goto(`/stories/${storyId}/memory?tab=canon`);
		await expect(page.locator(".canonpage")).toBeVisible();
		await expect(page.locator(".canonlist li").first()).toContainText("当前");
		await expect(page.locator(".canonlist")).toContainText("关键转折");
		await expectNoHorizontalOverflow(page);

		const titleField = page.locator('section[aria-label="标题"]');
		const summaryField = page.locator('section[aria-label="概要"]');
		await titleField.locator("[contenteditable]").first().fill("雨夜入门·改");
		await titleField.locator("[contenteditable]").first().press("Enter");
		await expect(page.locator(".canonlist")).toContainText("雨夜入门·改");

		await summaryField
			.locator("[contenteditable]")
			.first()
			.fill("守门人多问了一句。");
		await summaryField.locator("[contenteditable]").first().press("Enter");
		await expect(summaryField).toContainText("守门人多问了一句。");

		const voicesField = page.locator('section[aria-label="话术"]');
		await voicesField.getByLabel("话术人物").fill("少年");
		await voicesField.getByLabel("话术内容").fill("雨太大了。");
		await voicesField.getByRole("button", { name: "加上" }).click();
		await expect(voicesField).toContainText("雨太大了。");

		await page.reload();
		await expect(page.locator(".canonlist")).toContainText("雨夜入门·改");
		await expect(page.locator('section[aria-label="概要"]')).toContainText(
			"守门人多问了一句。",
		);
		await expect(page.locator('section[aria-label="话术"]')).toContainText(
			"雨太大了。",
		);

		await page
			.locator('section[aria-label="概要"]')
			.getByRole("button", {
				name: "版本 1",
			})
			.click();
		await expect(page.locator(".canonversions")).toContainText(
			"守门人多问了一句。",
		);

		// 编辑过的事件进入故事页的原著窗口。
		await page.goto(`/stories/${storyId}/play`);
		await sendFloor(page, "我站在雨里，没有出声。");
		await openContext(page);
		await expect(page.locator(".ctxitems")).toContainText("原著 · 雨夜入门·改");
		await closeContext(page);
		await expectNoHorizontalOverflow(page);
	});

	test("撤销回到上一版，刷新后仍是旧内容", async ({ page }) => {
		const storyId = await startCanonStory(page);
		await page.goto(`/stories/${storyId}/memory?tab=canon`);
		const summaryField = page.locator('section[aria-label="概要"]');
		await expect(summaryField).toContainText(ORIGINAL_SUMMARY);

		await summaryField
			.locator("[contenteditable]")
			.first()
			.fill("临时改过的概要。");
		await summaryField.locator("[contenteditable]").first().press("Enter");
		await expect(summaryField).toContainText("临时改过的概要。");
		await expect(summaryField).toContainText("你改的");

		await summaryField.getByRole("button", { name: "撤销" }).click();
		await expect(summaryField).toContainText(ORIGINAL_SUMMARY);
		await expect(summaryField).not.toContainText("临时改过的概要。");

		await page.reload();
		await expect(page.locator('section[aria-label="概要"]')).toContainText(
			ORIGINAL_SUMMARY,
		);
		await expect(page.locator('section[aria-label="概要"]')).not.toContainText(
			"临时改过的概要。",
		);
	});

	test("从未来事件从这里开始后，游标与窗口一起切过去", async ({ page }) => {
		const storyId = await startCanonStory(page);
		await page.goto(`/stories/${storyId}/memory?tab=canon`);
		const target = page
			.locator(".canonlist li")
			.filter({ hasText: "旧剑出土" });
		await expect(target).toContainText("未来");
		await target.getByRole("button", { name: "从这里开始" }).click();
		await expect(target).toContainText("当前");
		await expect(page.locator(".canondetail")).toContainText("旧剑出土");

		await page.goto(`/stories/${storyId}/play`);
		await sendFloor(page, "我伸手去摸石缝。");
		await openContext(page);
		await expect(page.locator(".ctxitems")).toContainText("原著 · 旧剑出土");
		await expect(page.locator(".ctxitems")).not.toContainText(
			"原著 · 雨夜入门",
		);
		await closeContext(page);
		await expectNoHorizontalOverflow(page);
	});
});

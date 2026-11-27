import { type Page, expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

const BOOK_TITLE = "窗口 e2e 原著";
const EVENTS = ["雨夜入门", "旧剑出土", "少女现身", "渡口"];

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
		events: EVENTS.map((title, index) => ({
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
		})),
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

test.describe("原著窗口", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("每轮可见当前原著事件；推进 2 件与从这里开始改变窗口", async ({
		page,
	}) => {
		const storyId = await startCanonStory(page);
		await page.goto(`/stories/${storyId}/play`);
		await expect(page.locator('[data-view="play"]')).toBeVisible();
		await expectNoHorizontalOverflow(page);

		const floors = page.locator('#script article.flr[id^="floor-"]');
		await expect(floors).toHaveCount(1);
		await page.locator(".say textarea").fill("我站在雨里，没有出声。");
		await page.getByRole("button", { name: "发送" }).click();
		await expect(floors).toHaveCount(2, { timeout: 60_000 });
		await expect(page.getByRole("button", { name: "停下" })).toHaveCount(0, {
			timeout: 30_000,
		});

		await openContext(page);
		const context = page.locator(".ctxitems");
		await expect(context).toContainText("原著 · 雨夜入门");
		await expect(context).not.toContainText("原著 · 旧剑出土");
		if (await page.locator(".dockbtn").isVisible()) {
			await page.keyboard.press("Escape");
			await expect(page.locator(".dockwrap")).not.toHaveClass(/open/);
		}

		// 推进两件：窗口在下一轮给当前加接下来两件。
		await page.getByRole("button", { name: "选择推进多少" }).click();
		await page.getByRole("menuitem", { name: "推进 2 件" }).click();
		await expect(floors).toHaveCount(3, { timeout: 60_000 });
		await expect(page.getByRole("button", { name: "停下" })).toHaveCount(0, {
			timeout: 30_000,
		});
		await openContext(page);
		await expect(context).toContainText("原著 · 雨夜入门");
		await expect(context).toContainText("原著 · 旧剑出土");
		await expect(context).toContainText("原著 · 少女现身");
		if (await page.locator(".dockbtn").isVisible()) {
			await page.keyboard.press("Escape");
			await expect(page.locator(".dockwrap")).not.toHaveClass(/open/);
		}

		// 从这里开始：跳到第三件，下一轮的当前事件跟着换。
		await page.getByRole("button", { name: "写法与本轮设置" }).click();
		const canonPanel = page.getByLabel("原著", { exact: true });
		await expect(canonPanel).toBeVisible();
		await canonPanel.getByLabel("从这里开始").selectOption({ index: 3 });
		await canonPanel.getByRole("button", { name: "跳到这里" }).click();
		await page.locator(".say textarea").fill("我抬头看山门。");
		await page.getByRole("button", { name: "发送" }).click();
		await expect(floors).toHaveCount(4, { timeout: 60_000 });
		await expect(page.getByRole("button", { name: "停下" })).toHaveCount(0, {
			timeout: 30_000,
		});
		await openContext(page);
		await expect(context).toContainText("原著 · 少女现身");
		await expectNoHorizontalOverflow(page);
	});

	test("设置里切换防剧透与窗口内容", async ({ page }) => {
		const storyId = await startCanonStory(page);
		await page.goto(`/stories/${storyId}/prefs?tab=write`);
		const panel = page.locator("[data-canon-settings]");
		await expect(panel).toBeVisible();
		const spoilers = panel.getByRole("switch", {
			name: "允许模型知道全书",
		});
		await expect(spoilers).toHaveAttribute("aria-checked", "false");
		await spoilers.click();
		await expect(spoilers).toHaveAttribute("aria-checked", "true");

		const mode = panel.getByRole("group", { name: "原著窗口内容" });
		await mode.getByRole("button", { name: "原文" }).click();
		await expect(mode.getByRole("button", { name: "原文" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		const view = await page.request.get(`/api/stories/${storyId}/canon`);
		const body = (await view.json()) as {
			readonly bound: {
				readonly allowFullBookSpoilers: boolean;
				readonly windowMode: string;
			};
		};
		expect(body.bound.allowFullBookSpoilers).toBe(true);
		expect(body.bound.windowMode).toBe("full_text");
		await expectNoHorizontalOverflow(page);
	});
});

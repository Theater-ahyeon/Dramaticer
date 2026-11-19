import { DatabaseSync } from "node:sqlite";
import { crc32, deflateSync } from "node:zlib";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { DB_PATH, expectNoHorizontalOverflow, login } from "./helpers";

const PNG_CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "林雪",
		description: "旧宅的守夜人。",
		first_mes: "门外的雨下了一整夜。",
		assets: [{ type: "icon", uri: "ccdefault:", name: "林雪.png", ext: "png" }],
	},
};

const JSON_CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "雾行者",
		description: "在雾里辨路的向导。",
		first_mes: "雾又起来了。",
	},
};

function pngChunk(name: string, data: Uint8Array): Buffer {
	const type = Buffer.from(name, "ascii");
	const body = Buffer.from(data);
	const out = Buffer.alloc(12 + body.length);
	out.writeUInt32BE(body.length, 0);
	type.copy(out, 4);
	body.copy(out, 8);
	out.writeUInt32BE(crc32(Buffer.concat([type, body])) >>> 0, 8 + body.length);
	return out;
}

/** 1x1 PNG，带 chara 文本块；字节本身用作封面原图。 */
function buildPngCard(card: unknown): Buffer {
	const signature = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(1, 0);
	ihdr.writeUInt32BE(1, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const text = Buffer.concat([
		Buffer.from("chara", "latin1"),
		Buffer.from([0]),
		Buffer.from(
			Buffer.from(JSON.stringify(card), "utf8").toString("base64"),
			"latin1",
		),
	]);
	return Buffer.concat([
		signature,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
		pngChunk("tEXt", text),
		pngChunk("IEND", new Uint8Array(0)),
	]);
}

async function createStory(
	page: Page,
	id: string,
	title: string,
): Promise<void> {
	const created = await page.request.post("/api/stories", {
		data: { id, title },
	});
	expect(created.ok()).toBeTruthy();
}

/** 把 head 换成一楼已知的时间与正文，书架排序和「上回说到」都可预期。 */
function seedHead(storyId: string, raw: string, createdAt: string): string {
	const nodeId = `${storyId}-head`;
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		db.prepare(
			"INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at) VALUES (?, ?, NULL, 'assistant', ?, ?)",
		).run(nodeId, storyId, raw, createdAt);
		db.prepare("UPDATE stories SET head_node_id = ? WHERE id = ?").run(
			nodeId,
			storyId,
		);
	} finally {
		db.close();
	}
	return nodeId;
}

async function expectImageLoaded(locator: Locator): Promise<void> {
	await expect(locator).toBeVisible();
	await expect
		.poll(
			() =>
				locator.evaluate((element) => {
					const image = element as HTMLImageElement;
					return image.complete && image.naturalWidth > 0;
				}),
			{ timeout: 15_000 },
		)
		.toBe(true);
}

async function htmlBackground(page: Page): Promise<string> {
	return page.evaluate(
		() => getComputedStyle(document.documentElement).backgroundColor,
	);
}

function brightness(color: string): number {
	const parts = color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
	const [red = 0, green = 0, blue = 0] = parts;
	return (red + green + blue) / 3;
}

test.describe("新界面外壳与书架", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("书架显示卡面图与占位图，继续上次给出上回说到与进度", async ({
		page,
	}) => {
		const stamp = Date.now();
		const placeholderTitle = `雾港纪事 ${stamp}`;
		const placeholderId = `e2e-v4-placeholder-${stamp}`;
		await createStory(page, placeholderId, placeholderTitle);
		const imported = await page.request.post(
			`/api/stories/${placeholderId}/import`,
			{ data: { card: { format: "json", data: JSON.stringify(JSON_CARD) } } },
		);
		expect(imported.ok()).toBeTruthy();

		const coverTitle = `旧宅的灯 ${stamp}`;
		const coverId = `e2e-v4-cover-${stamp}`;
		const png = buildPngCard(PNG_CARD);
		await createStory(page, coverId, coverTitle);
		const coverImport = await page.request.post(
			`/api/stories/${coverId}/import`,
			{ data: { card: { format: "png", data: png.toString("base64") } } },
		);
		expect(coverImport.ok()).toBeTruthy();

		const recap = "门厅的灯亮着。林雪把那封信推回桌面，说先别看。";
		const now = Date.now();
		seedHead(coverId, recap, new Date(now + 3_600_000).toISOString());
		seedHead(
			placeholderId,
			"雾里有人在等。",
			new Date(now + 60_000).toISOString(),
		);

		await page.goto("/");
		const library = page.locator('[data-view="library"]');
		await expect(library).toBeVisible();

		const hero = library.locator(".hero");
		await expect(hero.locator("h1")).toHaveText(coverTitle);
		await expect(hero.locator(".label")).toContainText("继续上次");
		await expect(hero.locator(".label")).toContainText("第 1 章");
		await expect(hero.locator(".recap")).toHaveText(recap);
		await expect(hero.locator(".stats")).toContainText("1楼");
		await expectImageLoaded(
			hero.locator(`img.cover[alt="${coverTitle}的卡面图"]`),
		);

		const realCover = await page.request.get(
			`/api/stories/${coverId}/media/cover`,
		);
		expect(realCover.ok()).toBeTruthy();
		expect(realCover.headers()["content-type"]).toBe("image/png");
		expect(Buffer.from(await realCover.body())).toEqual(png);

		const placeholderBook = library
			.locator(".book")
			.filter({ hasText: placeholderTitle });
		const placeholderCover = placeholderBook.locator(
			`img.cover[alt="${placeholderTitle}的卡面图"]`,
		);
		await expectImageLoaded(placeholderCover);
		await expect
			.poll(() => placeholderCover.evaluate((element) => element.naturalWidth))
			.toBe(600);

		const placeholderMedia = await page.request.get(
			`/api/stories/${placeholderId}/media/cover`,
		);
		expect(placeholderMedia.ok()).toBeTruthy();
		expect(placeholderMedia.headers()["content-type"]).toContain(
			"image/svg+xml",
		);
		expect(await placeholderMedia.text()).toContain('width="600" height="900"');

		await expectNoHorizontalOverflow(page);
	});

	test("桌面左侧、手机底部的外壳在明暗两套颜色下都不横向滚动", async ({
		page,
	}) => {
		const stamp = Date.now();
		const longTitle = `漫长雨夜里无人知晓的旧宅门厅与迟来的信 ${stamp}`;
		const storyId = `e2e-v4-shell-${stamp}`;
		await createStory(page, storyId, longTitle);
		const imported = await page.request.post(`/api/stories/${storyId}/import`, {
			data: { card: { format: "json", data: JSON.stringify(JSON_CARD) } },
		});
		expect(imported.ok()).toBeTruthy();
		seedHead(
			storyId,
			"门厅的灯亮着。林雪把那封信推回桌面，说先别看。雨一直下，楼梯上传来脚步声。",
			new Date(Date.now() + 7_200_000).toISOString(),
		);

		const viewport = page.viewportSize();
		expect(viewport).not.toBeNull();
		const width = viewport?.width ?? 0;
		const height = viewport?.height ?? 0;

		const backgrounds: string[] = [];
		for (const theme of ["light", "dark"] as const) {
			await page.addInitScript((value) => {
				localStorage.setItem("dramaticer.theme", value);
			}, theme);
			await page.goto("/");
			await expect(page.locator('[data-view="library"]')).toBeVisible();
			await expect(page.locator(".hero h1")).toHaveText(longTitle);

			const color = await htmlBackground(page);
			expect(color).not.toBe("rgba(0, 0, 0, 0)");
			backgrounds.push(color);
			await expectNoHorizontalOverflow(page);

			const rail = page.locator("nav.rail");
			await expect(rail).toBeVisible();
			const box = await rail.boundingBox();
			expect(box).not.toBeNull();
			if (width <= 760) {
				// 手机：导航贴在底部，整条都在视口里。
				expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
				expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
				expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
				expect(box?.y ?? 0).toBeGreaterThan(height - 120);
			} else {
				// 桌面：导航在左侧，竖向占满。
				expect(box?.x ?? 0).toBeLessThan(60);
				expect(box?.height ?? 0).toBeGreaterThan(height * 0.5);
			}

			const items = rail.locator("a.nav");
			await expect(items).toHaveCount(7);
			for (const item of await items.all()) {
				const itemBox = await item.boundingBox();
				expect(itemBox).not.toBeNull();
				expect(itemBox?.x ?? 0).toBeGreaterThanOrEqual(0);
				expect((itemBox?.x ?? 0) + (itemBox?.width ?? 0)).toBeLessThanOrEqual(
					width,
				);
			}
		}

		const [light, dark] = backgrounds;
		expect(light).not.toBe(dark);
		expect(brightness(dark ?? "")).toBeLessThan(brightness(light ?? ""));

		if (width > 760) {
			// 桌面上的主题按钮：点一下换到下一套颜色。
			const before = await htmlBackground(page);
			await page.locator(".themebtn").click();
			await expect.poll(() => htmlBackground(page)).not.toBe(before);
			await expectNoHorizontalOverflow(page);
		}
	});
});

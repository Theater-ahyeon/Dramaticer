import { DatabaseSync } from "node:sqlite";
import { crc32, deflateSync } from "node:zlib";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { DB_PATH, PASSWORD, login } from "./helpers.js";

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

const JSON_CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "雾行者",
		description: "在雾里辨路的向导。",
		first_mes: "雾又起来了。",
	},
};

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

/** 台账页只在选中楼层后渲染故事级区块，所以给故事补一层。 */
function seedFloor(storyId: string): void {
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		const id = `${storyId}-floor`;
		db.prepare(
			"INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at) VALUES (?, ?, NULL, 'assistant', ?, ?)",
		).run(id, storyId, "门厅的灯亮着。", new Date().toISOString());
		db.prepare("UPDATE stories SET head_node_id = ? WHERE id = ?").run(
			id,
			storyId,
		);
	} finally {
		db.close();
	}
}

test.describe("卡面图与人物立绘", () => {
	test.beforeEach(async ({ page }) => {
		await login(page, PASSWORD);
	});

	test("PNG 卡在书架、游玩页、导入页显示封面，人物档案显示立绘", async ({
		page,
	}) => {
		const id = `e2e-cover-${Date.now()}`;
		const title = `旧宅的灯 ${id}`;
		await createStory(page, id, title);
		const png = buildPngCard(PNG_CARD);

		await page.goto(`/stories/${id}/import`);
		await page.getByLabel("角色卡文件").setInputFiles({
			name: "card.png",
			mimeType: "image/png",
			buffer: png,
		});
		await page.getByRole("button", { name: "导入", exact: true }).click();
		await expect(page.locator(".import-result h2")).toHaveText("林雪");
		await expectImageLoaded(page.locator(".import-head img.story-cover"));
		seedFloor(id);

		const cover = await page.request.get(`/api/stories/${id}/media/cover`);
		expect(cover.ok()).toBeTruthy();
		expect(cover.headers()["content-type"]).toBe("image/png");
		expect(Buffer.from(await cover.body())).toEqual(png);

		await page.goto("/");
		const shelfCover = page.locator(
			`[data-view="library"] img.cover[alt="${title}的卡面图"]`,
		);
		await expectImageLoaded(shelfCover);

		await page.goto(`/stories/${id}/chat`);
		await page.locator(".story-content").waitFor();
		await expectImageLoaded(page.locator(".story-title-row img.story-cover"));

		await page.goto(`/stories/${id}/ledger`);
		await page.locator(".story-content").waitFor();
		await expectImageLoaded(page.locator(".ledger-portrait"));
	});

	test("没有卡面图的故事显示 2:3 占位图", async ({ page }) => {
		const id = `e2e-placeholder-${Date.now()}`;
		const title = `雾港纪事 ${id}`;
		await createStory(page, id, title);
		const imported = await page.request.post(`/api/stories/${id}/import`, {
			data: {
				card: { format: "json", data: JSON.stringify(JSON_CARD) },
			},
		});
		expect(imported.ok()).toBeTruthy();

		const cover = await page.request.get(`/api/stories/${id}/media/cover`);
		expect(cover.ok()).toBeTruthy();
		expect(cover.headers()["content-type"]).toContain("image/svg+xml");
		const svg = await cover.text();
		expect(svg).toContain('width="600" height="900"');

		await page.goto("/");
		const shelfCover = page.locator(
			`[data-view="library"] img.cover[alt="${title}的卡面图"]`,
		);
		await expectImageLoaded(shelfCover);
	});
});

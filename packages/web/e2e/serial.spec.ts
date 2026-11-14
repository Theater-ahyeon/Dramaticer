import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login, openStoryTab } from "./helpers";

const STORY_ID = "e2e-serial";

interface SerialBody {
	readonly nodeId: string;
	readonly recap: {
		readonly stale: boolean;
		readonly scenes: readonly { readonly summary: string }[];
	};
	readonly chapters: readonly { readonly ordinal: number }[];
	readonly cast: readonly {
		readonly who: string;
		readonly status: string | null;
		readonly notes: readonly { readonly text: string }[];
	}[];
	readonly timeline: readonly {
		readonly storyTime: string | null;
		readonly place: string | null;
	}[];
}

async function readSerial(
	page: Parameters<typeof login>[0],
): Promise<SerialBody> {
	const response = await page.request.get(`/api/stories/${STORY_ID}/serial`);
	expect(response.ok()).toBeTruthy();
	return (await response.json()) as SerialBody;
}

async function readCharacterStatus(
	page: Parameters<typeof login>[0],
	nodeId: string,
	who: string,
): Promise<string | null> {
	const response = await page.request.get(`/api/nodes/${nodeId}/ledger`);
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as {
		state: { character?: Record<string, { status?: string }> };
	};
	return body.state.character?.[who]?.status ?? null;
}

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("连载页的四块派生数据读同一份响应，编辑走变更卡，导出不含私有路径", async ({
	page,
}) => {
	const serial = await readSerial(page);
	expect(serial.recap.stale).toBe(true);
	expect(serial.chapters[0]?.ordinal).toBe(1);
	const recap = serial.recap.scenes[serial.recap.scenes.length - 1];
	const lin = serial.cast.find((character) => character.who === "林雪");
	expect(lin).toBeDefined();
	const timeline = serial.timeline.find((entry) => entry.place === "天台");
	expect(timeline?.storyTime).toBe("第二天清晨");

	await openStoryTab(page, STORY_ID, "serial");
	await expect(
		page.getByRole("heading", { name: "连载", exact: true }),
	).toBeVisible();
	await expect(page.locator(".story-tabs .story-tab.active")).toHaveText(
		"连载",
	);

	// 前情提要：隔得够久时默认展开，内容与接口响应一致。
	const details = page.locator(".serial-recap details");
	await expect(details).toBeVisible();
	expect(
		await details.evaluate((element) => element.hasAttribute("open")),
	).toBe(true);
	await expect(page.locator(".serial-recap-scene").last()).toContainText(
		recap?.summary ?? "",
	);

	await page.getByRole("button", { name: "章节目录" }).click();
	await expect(page.locator(".serial-chapter").first()).toContainText(
		"第 1 章",
	);
	await expect(page.locator(".serial-chapter").first()).toContainText(
		"林雪在门厅试探你，阿宁在旁边翻信。",
	);
	await expect(page.locator(".serial-chapter").last()).toContainText(
		"第 2 章（进行中）",
	);

	await page.getByRole("button", { name: "人物关系" }).click();
	const linCard = page
		.locator(".serial-character")
		.filter({ has: page.getByRole("heading", { name: "林雪", exact: true }) });
	await expect(linCard).toContainText("想要");
	await expect(linCard).toContainText(lin?.notes[0]?.text ?? "");
	await expect(linCard).toContainText("旧识");
	await expect(linCard).toContainText("在场");

	await page.getByRole("button", { name: "时间线" }).click();
	await expect(page.locator(".serial-timeline")).toContainText("第二天清晨");
	await expect(page.locator(".serial-timeline")).toContainText("天台");

	// 可编辑记忆：提交只生成待审卡，批准前台账不变。
	const before = await readCharacterStatus(page, serial.nodeId, "林雪");
	const nextStatus = `警觉-${randomUUID().slice(0, 8)}`;
	const note = `林雪现在很警觉 ${randomUUID().slice(0, 8)}`;
	await page.getByRole("button", { name: "可编辑记忆" }).click();
	const memoryForm = page
		.locator(".serial-memory-form")
		.filter({ hasText: "林雪" });
	await memoryForm.getByLabel("状态").fill(nextStatus);
	await memoryForm.getByLabel("修改说明").fill(note);
	await memoryForm.getByRole("button", { name: "提交修改" }).click();
	const card = page.locator(".ledger-proposal").filter({ hasText: note });
	await expect(card).toBeVisible();
	expect(await readCharacterStatus(page, serial.nodeId, "林雪")).toBe(before);

	await card.getByRole("button", { name: "批准", exact: true }).click();
	await expect
		.poll(() => readCharacterStatus(page, serial.nodeId, "林雪"))
		.toBe(nextStatus);
	await expect(card).toContainText("已批准");

	// 导出成书：文件名来自故事标题，正文逐字取楼层原文。
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("button", { name: "导出成书" }).click(),
	]);
	expect(download.suggestedFilename()).toBe("连载视图.md");
	const path = await download.path();
	expect(path).not.toBeNull();
	const markdown = await readFile(path as string, "utf8");
	expect(markdown).toContain("# 连载视图");
	expect(markdown).toContain("## 第 1 章");
	expect(markdown).toContain("门厅里只剩一盏灯。");
	expect(markdown).toContain("林雪在门厅试探你，阿宁在旁边翻信。");
	for (const secret of ["E:\\", "/api/", ".devloop", "apiKey", "e2e.db"]) {
		expect(markdown).not.toContain(secret);
	}
	await expectNoHorizontalOverflow(page);
});

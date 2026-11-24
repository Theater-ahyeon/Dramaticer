import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login } from "./helpers";

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

// 旧「连载」面板拆除后（ui-v2/05），导出在故事页标题旁的「⋯」里；
// 四块派生数据只剩接口，这里核对接口，并从故事页导出成书。
test("连载的四块派生数据读同一份响应，导出不含私有路径", async ({ page }) => {
	const serial = await readSerial(page);
	expect(serial.recap.stale).toBe(true);
	expect(serial.chapters[0]?.ordinal).toBe(1);
	expect(serial.recap.scenes.length).toBeGreaterThan(0);
	const lin = serial.cast.find((character) => character.who === "林雪");
	expect(lin).toBeDefined();
	expect(lin?.status ?? null).toBe(
		await readCharacterStatus(page, serial.nodeId, "林雪"),
	);
	const timeline = serial.timeline.find((entry) => entry.place === "天台");
	expect(timeline?.storyTime).toBe("第二天清晨");

	await page.goto(`/stories/${STORY_ID}/play`);
	await page.getByRole("button", { name: "故事菜单" }).click();
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("menuitem", { name: "导出" }).click(),
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

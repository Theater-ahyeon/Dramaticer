import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	latestAssistantNodeId,
	login,
	totalNodeCount,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

// 旧「分支」面板拆除后（ui-v2/05），分支在故事页标题旁的下拉里切换。
// 编辑与改写都新建楼层（I4），旧楼层保留在树里。
test("编辑与改写新建分支，旧楼层保留，故事页的分支下拉能切换回去", async ({
	page,
}) => {
	const storyId = await createImportedStory(page, "分支端到端");
	const first = await latestAssistantNodeId(page, storyId);
	const before = await totalNodeCount(page, storyId);

	const edited = await page.request.post(`/api/nodes/${first}/edit`, {
		data: { text: "编辑出来的新分支" },
	});
	expect(edited.ok()).toBeTruthy();
	const swiped = await page.request.post(`/api/nodes/${first}/swipe`, {
		data: { text: "改写出来的分支" },
	});
	expect(swiped.ok()).toBeTruthy();
	expect(await totalNodeCount(page, storyId)).toBe(before + 2);

	await page.goto(`/stories/${storyId}/play`);
	const branch = page.getByRole("combobox", { name: "分支" });
	await expect(branch).toBeVisible();
	const options = branch.locator("option");
	await expect(options.filter({ hasText: "编辑出来的新分支" })).toHaveCount(1);
	await expect(options.filter({ hasText: "改写出来的分支" })).toHaveCount(1);

	const editedValue = await options
		.filter({ hasText: "编辑出来的新分支" })
		.getAttribute("value");
	await branch.selectOption(editedValue ?? "");
	await expect(page.locator("#script")).toContainText("编辑出来的新分支");

	const originalValue = await options
		.filter({ hasText: "门外的雨" })
		.getAttribute("value");
	await branch.selectOption(originalValue ?? "");
	await expect(page.locator("#script")).toContainText("门外的雨下了一整夜");
	await expect(page.locator("#script")).not.toContainText("编辑出来的新分支");
	await expectNoHorizontalOverflow(page);
});

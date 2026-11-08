import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	insertChangeCard,
	latestAssistantNodeId,
	login,
	openStoryTab,
	readPreferenceCounts,
	sendTurn,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("台账展示本楼写入、线索、事件与故事级记忆，变更卡可批准与拒绝", async ({
	page,
}) => {
	const storyId = await createImportedStory(page, "台账端到端");
	await openStoryTab(page, storyId, "chat");
	for (const text of ["台账起点", "第二楼", "第三楼", "第四楼"]) {
		await sendTurn(page, storyId, text);
	}
	const assistantId = await latestAssistantNodeId(page, storyId);
	insertChangeCard({
		storyId,
		sourceNodeId: assistantId,
		id: `card-approve-${randomUUID()}`,
		text: "批准用的修改",
		diffs: [
			{ path: ["character", "林雪", "location"], op: "set", value: "门廊" },
		],
		before: [{ path: ["character", "林雪", "location"], existed: false }],
	});
	insertChangeCard({
		storyId,
		sourceNodeId: assistantId,
		id: `card-reject-${randomUUID()}`,
		text: "拒绝用的修改",
		diffs: [
			{ path: ["character", "林雪", "location"], op: "set", value: "阁楼" },
		],
		before: [{ path: ["character", "林雪", "location"], existed: false }],
	});

	await openStoryTab(page, storyId, "ledger");
	await page.locator(".ledger-diff").first().waitFor();
	await expect(page.locator(".ledger-diff-list").first()).toContainText(
		"character / 林雪 / status",
	);
	await expect(page.locator(".ledger-story-list").first()).toContainText(
		"门后的脚步",
	);
	await expect(page.getByText("林雪", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("门厅", { exact: false }).first()).toBeVisible();
	await expect(page.locator(".ledger-event").first()).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator(".ledger-event").first()).toContainText("门被推开");
	await expect(page.locator(".ledger-proposal")).toHaveCount(2);

	const approveCard = page
		.locator(".ledger-proposal")
		.filter({ hasText: "批准用的修改" });
	await approveCard.getByRole("button", { name: "批准", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "已批准（1）" }),
	).toBeVisible();
	await expect(page.locator(".ledger-detail-pane")).toContainText("门廊");

	const rejectCard = page
		.locator(".ledger-proposal")
		.filter({ hasText: "拒绝用的修改" });
	await rejectCard.getByRole("button", { name: "拒绝", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "已拒绝（1）" }),
	).toBeVisible();

	const proposals = await page.request.get(
		`/api/stories/${storyId}/proposals?status=all`,
	);
	expect(proposals.ok()).toBeTruthy();
	const proposalBody: unknown = await proposals.json();
	expect(proposalBody).toMatchObject({
		proposals: expect.arrayContaining([
			expect.objectContaining({ status: "approved", text: "批准用的修改" }),
			expect.objectContaining({ status: "rejected", text: "拒绝用的修改" }),
		]),
	});
	expect(readPreferenceCounts(storyId).get("card_decision") ?? 0).toBe(2);
	await expectNoHorizontalOverflow(page);
});

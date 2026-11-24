import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	insertChangeCard,
	latestAssistantNodeId,
	login,
	readPreferenceCounts,
	sendTurn,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

// 旧「台账」面板拆除后（ui-v2/05），局面在记事页里看；本楼写入、事件与变更卡
// 只剩接口，这里按接口核对后台写入链路仍然通。
test("台账记下本楼写入、事件与故事级记忆，变更卡可批准与拒绝", async ({
	page,
}) => {
	const storyId = await createImportedStory(page, "台账端到端");
	await page.goto(`/stories/${storyId}/play`);
	for (const text of ["台账起点", "第二楼", "第三楼", "第四楼"]) {
		await sendTurn(page, storyId, text);
	}
	const assistantId = await latestAssistantNodeId(page, storyId);

	const ledger = JSON.stringify(
		await (await page.request.get(`/api/nodes/${assistantId}/ledger`)).json(),
	);
	expect(ledger).toContain("林雪");
	expect(ledger).toContain("status");
	expect(ledger).toContain("门后的脚步");

	// 事件由后台抽取写入；全量并行跑时队列可能慢，轮询等它落地。
	await expect
		.poll(
			async () =>
				JSON.stringify(
					await (
						await page.request.get(`/api/nodes/${assistantId}/events`)
					).json(),
				),
			{ timeout: 90_000 },
		)
		.toContain("门被推开");

	const approveId = `card-approve-${randomUUID()}`;
	const rejectId = `card-reject-${randomUUID()}`;
	insertChangeCard({
		storyId,
		sourceNodeId: assistantId,
		id: approveId,
		text: "批准用的修改",
		diffs: [
			{ path: ["character", "林雪", "location"], op: "set", value: "门廊" },
		],
		before: [{ path: ["character", "林雪", "location"], existed: false }],
	});
	insertChangeCard({
		storyId,
		sourceNodeId: assistantId,
		id: rejectId,
		text: "拒绝用的修改",
		diffs: [
			{ path: ["character", "林雪", "location"], op: "set", value: "阁楼" },
		],
		before: [{ path: ["character", "林雪", "location"], existed: false }],
	});
	expect(
		(await page.request.post(`/api/proposals/${approveId}/approve`)).ok(),
	).toBeTruthy();
	expect(
		(await page.request.post(`/api/proposals/${rejectId}/reject`)).ok(),
	).toBeTruthy();

	const proposals = await page.request.get(
		`/api/stories/${storyId}/proposals?status=all`,
	);
	expect(await proposals.json()).toMatchObject({
		proposals: expect.arrayContaining([
			expect.objectContaining({ status: "approved", text: "批准用的修改" }),
			expect.objectContaining({ status: "rejected", text: "拒绝用的修改" }),
		]),
	});
	expect(readPreferenceCounts(storyId).get("card_decision") ?? 0).toBe(2);
	const approved = JSON.stringify(
		await (await page.request.get(`/api/nodes/${assistantId}/ledger`)).json(),
	);
	expect(approved).toContain("门廊");
});

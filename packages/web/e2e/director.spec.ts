import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	latestAssistantNodeId,
	latestUserNodeId,
	login,
	sendTurn,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

// 旧「导演」面板拆除后（ui-v2/05），候选行动在故事页输入台上，Trace 在检视器；
// 方案、计划与线索兑现只剩接口，这里按接口核对。
test("候选行动、Trace、计划编辑与线索兑现（不再每拍写决策）", async ({
	page,
}) => {
	const storyId = await createImportedStory(page, "导演端到端");
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/stories/${storyId}/openings?status=pending`,
				);
				return JSON.stringify(await response.json()).includes("批候选") ? 1 : 0;
			},
			{ timeout: 30_000 },
		)
		.toBe(1);

	await page.goto(`/stories/${storyId}/play`);
	await sendTurn(page, storyId, "读取状态");
	const assistantId = await latestAssistantNodeId(page, storyId);

	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/nodes/${assistantId}/actions`,
				);
				return JSON.stringify(await response.json()).includes("候选行动一")
					? 1
					: 0;
			},
			{ timeout: 30_000 },
		)
		.toBe(1);
	await page.reload();
	await expect(
		page.locator(".opts .chip", { hasText: "候选行动一" }),
	).toBeVisible();
	await page.getByRole("button", { name: /^改一改再发：候选行动一/ }).click();
	await expect(page.locator(".say textarea")).toHaveValue(/候选行动一/);

	// 每拍没有程序选择的动作，新楼层不写导演决策。
	const decision = await page.request.get(
		`/api/nodes/${await latestUserNodeId(page, storyId)}/director`,
	);
	expect(JSON.stringify(await decision.json())).toContain('"decision":null');

	const trace = JSON.stringify(
		await (await page.request.get(`/api/nodes/${assistantId}/trace`)).json(),
	);
	expect(trace).toContain("fake-model");
	expect(trace).toContain("state_get");

	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/stories/${storyId}/director/plan`,
				);
				return JSON.stringify(await response.json()).includes("e2e-arc")
					? 1
					: 0;
			},
			{ timeout: 30_000 },
		)
		.toBe(1);
	const planView = (await (
		await page.request.get(`/api/stories/${storyId}/director/plan`)
	).json()) as { plan: { arcs: { title: string }[] } };
	expect(planView.plan.arcs[0]?.title).toBe("旧宅之夜");
	const edited = {
		...planView.plan,
		arcs: planView.plan.arcs.map((arc, index) =>
			index === 0 ? { ...arc, title: "旧宅之夜（改）" } : arc,
		),
	};
	const saved = await page.request.put(
		`/api/stories/${storyId}/director/plan`,
		{ data: { plan: edited } },
	);
	expect(saved.ok()).toBeTruthy();
	const reread = (await (
		await page.request.get(`/api/stories/${storyId}/director/plan`)
	).json()) as { plan: { arcs: { title: string }[] } };
	expect(reread.plan.arcs[0]?.title).toBe("旧宅之夜（改）");

	const clues = (await (
		await page.request.get(`/api/stories/${storyId}/clues`)
	).json()) as { clues: { id: string; status?: string }[] };
	const open = clues.clues.filter((clue) => clue.status !== "fulfilled");
	expect(open.length).toBeGreaterThan(0);
	for (const clue of open) {
		const fulfilled = await page.request.post(
			`/api/clues/${encodeURIComponent(clue.id)}/fulfill`,
			{ data: { storyId } },
		);
		expect(fulfilled.ok()).toBeTruthy();
	}
	const after = (await (
		await page.request.get(`/api/stories/${storyId}/clues`)
	).json()) as { clues: { status?: string }[] };
	expect(after.clues.filter((clue) => clue.status !== "fulfilled")).toEqual([]);
	await expectNoHorizontalOverflow(page);
});

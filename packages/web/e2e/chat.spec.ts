import { expect, test } from "@playwright/test";
import {
	createImportedStory,
	expectNoHorizontalOverflow,
	latestAssistantNodeId,
	latestUserNodeId,
	login,
	openStoryTab,
	pathNodeCount,
	readPreferenceCounts,
	readSwipeReasons,
	sendTurn,
} from "./helpers";

test.beforeEach(async ({ page }) => {
	await login(page);
});

test("两轮对话、思考折叠、选项偏好、读取工具与重新生成", async ({ page }) => {
	const storyId = await createImportedStory(page, "聊天端到端");
	await openStoryTab(page, storyId, "chat");
	await expect(page.getByLabel("玩家行动")).toBeVisible();

	await sendTurn(page, storyId, "第一次行动");
	const thinking = page.locator(".block-thinking").last();
	await expect(thinking).toBeVisible();
	await expect(thinking).not.toHaveAttribute("open");
	await expect(page.locator(".block-status").last()).toContainText("体力：100");
	await expect(page.locator(".turn-summary")).toContainText("状态更新");

	await page
		.locator(".block-options button", { hasText: "推门进去" })
		.last()
		.click();
	await expect(page.getByLabel("玩家行动")).toHaveValue("推门进去");
	await expect
		.poll(() => readPreferenceCounts(storyId).get("choice") ?? 0)
		.toBe(1);

	await expect(page.locator(".candidate-action").first()).toBeVisible({
		timeout: 30_000,
	});

	await sendTurn(page, storyId, "推门进去");
	await sendTurn(page, storyId, "读取状态");
	await expect(page.locator(".floor-assistant").last()).toContainText(
		"读取状态",
	);

	const before = await pathNodeCount(page, storyId);
	await page
		.locator(".floor-assistant")
		.last()
		.getByRole("button", { name: "重新生成" })
		.click();
	await expect(page.locator(".reroll-reasons")).toBeVisible();
	await page.locator(".reroll-reason", { hasText: "没推进" }).click();
	await expect
		.poll(() => readPreferenceCounts(storyId).get("swipe") ?? 0, {
			timeout: 30_000,
		})
		.toBe(1);
	await expect
		.poll(() => readSwipeReasons(storyId))
		.toEqual(["not-progressed"]);
	expect(await pathNodeCount(page, storyId)).toBe(before);

	await expectNoHorizontalOverflow(page);
});

test("故事锁定深回合后新会话默认深回合，玩家可以逐轮切回快回合", async ({
	page,
}) => {
	const storyId = await createImportedStory(page, "模式开关");
	const locked = await page.request.put(`/api/stories/${storyId}/settings`, {
		data: { turnMode: "deep" },
	});
	expect(locked.ok()).toBeTruthy();

	await openStoryTab(page, storyId, "chat");
	await expect(page.getByLabel("回合模式")).toHaveValue("deep");

	await sendTurn(page, storyId, "深回合里的行动");
	await sendTurn(page, storyId, "深回合里的第二轮");

	await page.getByLabel("回合模式").selectOption("fast");
	await expect(page.getByLabel("回合模式")).toHaveValue("fast");
	const settings = await page.request.get(`/api/stories/${storyId}/settings`);
	const settingsBody: unknown = await settings.json();
	expect(settingsBody).toMatchObject({ turnMode: "deep" });

	await sendTurn(page, storyId, "快回合里的行动");
});

test("深回合显示草稿、运行中追加要求与楼层运行时间线", async ({ page }) => {
	const storyId = await createImportedStory(page, "深回合草稿");
	await openStoryTab(page, storyId, "chat");
	await page.getByLabel("回合模式").selectOption("deep");
	await page.getByLabel("玩家行动").fill("深回合草稿：写下开场");
	await page.getByLabel("玩家行动").press("Enter");

	const steering = page.getByLabel("追加要求");
	await expect(steering).toBeVisible({ timeout: 15_000 });
	await steering.fill("让门外的脚步停下来");
	await steering.press("Enter");
	await expect(page.locator(".steering-list")).toContainText(
		"让门外的脚步停下来",
	);
	await expect(page.locator(".draft-panel")).toContainText(
		"草稿：门在风里响了一声。",
		{ timeout: 15_000 },
	);

	const lastFloor = page.locator(".floor-assistant").last();
	await expect(lastFloor).toContainText("草稿：门在风里响了一声。", {
		timeout: 30_000,
	});
	await expect(page.locator(".draft-panel")).toHaveCount(0);

	await lastFloor.getByRole("button", { name: "运行时间线" }).click();
	const timeline = page.locator(".run-timeline");
	await expect(timeline).toContainText("模型请求");
	await expect(timeline).toContainText("工具调用");
	await expect(timeline).toContainText("草稿替换");
	await expect(timeline).toContainText("草稿提交");
	await expect(timeline).toContainText("追加要求");
	await expectNoHorizontalOverflow(page);
});

test("推进三档进入请求，原因重 roll 写进偏好与用户意志", async ({ page }) => {
	const storyId = await createImportedStory(page, "推进与原因");
	const organized = await page.request.put(`/api/stories/${storyId}/settings`, {
		data: { directorOrganization: "lines" },
	});
	expect(organized.ok()).toBeTruthy();
	await openStoryTab(page, storyId, "chat");

	await sendTurn(page, storyId, "读取状态");

	// 推进三档是单轮参数：三档各自把档位带进请求，导演据此选动作。
	// 决策记录写在生成助手楼层的那条玩家楼层上。
	for (const [label, kind] of [
		["快速", "quick"],
		["大幅", "jump"],
		["推进", "advance"],
	] as const) {
		await page.locator(".composer-push-kind", { hasText: label }).click();
		await expect(
			page.locator(".composer-push-kind", { hasText: label }),
		).toHaveAttribute("aria-pressed", "true");
		const before = await pathNodeCount(page, storyId);
		await page.locator(".composer-push-send").click();
		await expect
			.poll(() => pathNodeCount(page, storyId), { timeout: 30_000 })
			.toBeGreaterThan(before);
		await expect(page.locator(".composer-send")).toBeVisible({
			timeout: 30_000,
		});
		const decision = await page.request.get(
			`/api/nodes/${await latestUserNodeId(page, storyId)}/director`,
		);
		const decisionBody: unknown = await decision.json();
		expect(JSON.stringify(decisionBody)).toContain(`"push":"${kind}"`);
	}

	// 原因重 roll：选中原因才开始重写，原因进入偏好信号与用户意志。
	await page
		.locator(".floor-assistant")
		.last()
		.getByRole("button", { name: "重新生成" })
		.click();
	await page.locator(".reroll-reason", { hasText: "太短" }).click();
	await expect
		.poll(() => readPreferenceCounts(storyId).get("swipe") ?? 0, {
			timeout: 30_000,
		})
		.toBe(1);
	expect(await readSwipeReasons(storyId)).toEqual(["too-short"]);

	// 原因同时是一条长期纠正：它出现在新楼层的台账快照里。
	const latest = await latestAssistantNodeId(page, storyId);
	const ledger = await page.request.get(`/api/nodes/${latest}/ledger`);
	expect(ledger.ok()).toBeTruthy();
	const ledgerBody: unknown = await ledger.json();
	expect(JSON.stringify(ledgerBody)).toContain("userWill");
	expect(JSON.stringify(ledgerBody)).toContain("回复要写够分量");

	await expectNoHorizontalOverflow(page);
});

test("就地纠正只改选中段，场面控制改变场次与节奏", async ({ page }) => {
	const storyId = await createImportedStory(page, "纠正与场面");
	await openStoryTab(page, storyId, "chat");
	await sendTurn(page, storyId, "读取状态");

	const floor = page.locator(".floor-assistant").last();
	const beforeId = await latestAssistantNodeId(page, storyId);
	const beforeRaw = (await floor.locator(".floor-body").innerText()).trim();

	// 在正文里选中一句话，再点「就地纠正」。
	const segment = floor.locator(".text-segment").first();
	await segment.evaluate((element) => {
		const text = element.firstChild;
		if (text === null) throw new Error("楼层没有正文节点");
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, Math.min(6, text.textContent?.length ?? 0));
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	});
	await page.locator(".composer-correct").click();
	const panel = page.locator(".correction-panel");
	await expect(panel.locator(".correction-quote")).toBeVisible();
	await panel.getByLabel("这一段哪里不对").fill("这里改成另一个说法");
	await panel.getByRole("button", { name: "只改这一段" }).click();

	await expect
		.poll(() => latestAssistantNodeId(page, storyId), { timeout: 30_000 })
		.not.toBe(beforeId);
	await expect(page.locator(".correction-panel")).toHaveCount(0);
	const afterId = await latestAssistantNodeId(page, storyId);
	const afterRaw = (
		await page
			.locator(".floor-assistant")
			.last()
			.locator(".floor-body")
			.innerText()
	).trim();
	expect(afterRaw).not.toBe(beforeRaw);
	// 只重写选中的那一段：替换文本与原文其余部分都在。
	expect(afterRaw).toContain("改过的这一段。");
	expect(afterRaw).toContain(beforeRaw.slice(6).slice(0, 12));

	// 旧楼层仍然保留在树里，纠正意见写进用户意志。
	const tree = await page.request.get(`/api/stories/${storyId}/tree`);
	expect(JSON.stringify(await tree.json())).toContain(beforeId);
	const ledger = await page.request.get(`/api/nodes/${afterId}/ledger`);
	expect(JSON.stringify(await ledger.json())).toContain("这里改成另一个说法");

	// 场面控制：结束这一场后场次数量与边界都变。
	await page.locator(".scene-control", { hasText: "结束这一场" }).click();
	await page.getByLabel("结束这一场的备注").fill("收在这里");
	await page.locator(".scene-control-submit").click();
	await expect(page.locator(".scene-summary")).toContainText("已结束 1 场");

	await page.locator(".scene-control", { hasText: "跳到某个时间" }).click();
	await page.getByLabel("跳到的时间").fill("三天后的清晨");
	await page.locator(".scene-control-submit").click();
	await expect(page.locator(".scene-summary")).toContainText("进行中");

	await page.locator(".scene-control", { hasText: "调整节奏" }).click();
	await page.locator(".scene-control-pace", { hasText: "加快" }).click();
	await expect(page.locator(".scene-summary")).toContainText("节奏快慢 1.6");
	const settings = await page.request.get(`/api/stories/${storyId}/settings`);
	const settingsBody = (await settings.json()) as {
		directorConfig: { pace: number };
	};
	expect(settingsBody.directorConfig.pace).toBe(1.6);

	await expectNoHorizontalOverflow(page);
});

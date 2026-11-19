import { DatabaseSync } from "node:sqlite";
import { type Page, expect, test } from "@playwright/test";
import {
	DB_PATH,
	expectNoHorizontalOverflow,
	login,
	readPreferenceCounts,
	totalNodeCount,
} from "./helpers";

interface FloorRequest {
	readonly mode?: string;
	readonly push?: string;
	readonly text?: string;
}

declare global {
	interface Window {
		__stageLog?: string[];
	}
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

/** 一楼固定的正文、场次与一条状态批注；标题和开销由真实回合补上。 */
function seedFirstFloor(storyId: string): string {
	const nodeId = `${storyId}-head`;
	const createdAt = new Date().toISOString();
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		db.prepare(
			"INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at) VALUES (?, ?, NULL, 'assistant', ?, ?)",
		).run(
			nodeId,
			storyId,
			"门厅里只剩一盏灯。林雪把那封信推回桌面，说先别看。",
			createdAt,
		);
		db.prepare("UPDATE stories SET head_node_id = ? WHERE id = ?").run(
			nodeId,
			storyId,
		);
		db.prepare(
			`INSERT INTO scene_logs (node_id, story_id, beat, present, scene_ends, bits, conditions, states, quote_submitted, quote_verified, repairs, created_at, scene_card)
			 VALUES (?, ?, '试探', ?, 0, '[]', '[]', '[]', 0, 0, '[]', ?, ?)`,
		).run(
			nodeId,
			storyId,
			JSON.stringify(["林雪"]),
			createdAt,
			JSON.stringify({
				present: [{ who: "林雪", want: "确认门外是谁" }],
				change: "雨声停了",
			}),
		);
		db.prepare(
			`INSERT INTO state_diffs (story_id, node_id, ordinal, path, op, value, reason, source, created_at)
			 VALUES (?, ?, 0, ?, 'set', ?, '听到门后的脚步', 'settler', ?)`,
		).run(
			storyId,
			nodeId,
			JSON.stringify(["character", "林雪", "status"]),
			JSON.stringify("警觉"),
			createdAt,
		);
	} finally {
		db.close();
	}
	return nodeId;
}

/** 记录写作期间出现过的阶段；阶段条写完就消失，只在页面上观察。 */
async function observeStages(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.__stageLog = [];
		const script = document.querySelector("#script");
		if (script === null) throw new Error("找不到正文容器");
		const record = (): void => {
			const seen = window.__stageLog ?? [];
			for (const item of document.querySelectorAll("#script .stages span.on")) {
				const text = (item.textContent ?? "").trim();
				if (text !== "" && !seen.includes(text)) seen.push(text);
			}
			window.__stageLog = seen;
		};
		new MutationObserver(record).observe(script, {
			childList: true,
			subtree: true,
			attributes: true,
			characterData: true,
		});
	});
}

/** 读写作期间出现过的阶段；阶段条写完就消失，所以同时看现场和观察记录。 */
async function stageLog(page: Page): Promise<readonly string[]> {
	return page.evaluate(() => {
		const seen = window.__stageLog ?? [];
		for (const item of document.querySelectorAll("#script .stages span.on")) {
			const text = (item.textContent ?? "").trim();
			if (text !== "" && !seen.includes(text)) seen.push(text);
		}
		window.__stageLog = seen;
		return seen;
	});
}

async function resetStageLog(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.__stageLog = [];
	});
}

test.describe("故事页：正文、批注与输入台", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("推进三档、写法进度、重写原因与批注开关在桌面和手机上都能用", async ({
		page,
	}) => {
		const stamp = Date.now();
		const title = `夜航手记 ${stamp}`;
		const storyId = `e2e-v4-story-${stamp}`;
		await createStory(page, storyId, title);
		seedFirstFloor(storyId);

		const turnBodies: FloorRequest[] = [];
		const rerollBodies: unknown[] = [];
		page.on("request", (request) => {
			if (request.method() !== "POST") return;
			const path = new URL(request.url()).pathname;
			if (path === `/api/stories/${storyId}/turns`) {
				turnBodies.push(request.postDataJSON() as FloorRequest);
			}
			if (path.endsWith("/regenerate")) {
				rerollBodies.push(request.postDataJSON());
			}
		});

		await page.goto(`/stories/${storyId}/play`);
		await expect(page.locator('[data-view="play"]')).toBeVisible();

		// 书页式正文、场次条与页边批注。
		await expect(page.locator(".sheet-head h1")).toHaveText(title);
		await expect(page.locator("#script .prose p").first()).toContainText(
			"门厅里只剩一盏灯",
		);
		await expect(page.locator(".slate").first()).toContainText("第 1 场");
		await expect(page.locator(".slate").first()).toContainText("在场：林雪");
		await expect(page.locator(".notes .note").first()).toContainText("状态");
		await expect(page.locator(".notes .fno").first()).toHaveText("第 1 楼");
		await expectNoHorizontalOverflow(page);
		await observeStages(page);

		const push = page.getByRole("button", { name: /^推进/ });
		const stepGroup = page.getByRole("group", { name: "推进多少" });
		const modeGroup = page.getByRole("group", { name: "写法" });
		const committed = page
			.locator(".notes .fno")
			.filter({ hasText: /^第 \d+ 楼$/ });

		// 快速写法：推进「一场」把档位带进请求，等待期间显示正文进度。
		await stepGroup.getByRole("button", { name: "一场" }).click();
		await resetStageLog(page);
		await push.click();
		await expect
			.poll(() => stageLog(page), { timeout: 30_000 })
			.toEqual(expect.arrayContaining(["写正文"]));
		await expect(committed).toHaveCount(2, { timeout: 60_000 });
		expect(turnBodies.at(-1)).toMatchObject({
			mode: "fast",
			push: "quick",
		});
		await expect(page.locator(".meta .num")).toContainText(
			"上一轮 120 入 · 40 出",
		);

		// 规划写法：请求带 plan，进度按挑记忆、角色意图、定计划依次出现。
		await modeGroup.getByRole("button", { name: "规划" }).click();
		await stepGroup.getByRole("button", { name: "跳跃" }).click();
		await resetStageLog(page);
		await push.click();
		await expect
			.poll(() => stageLog(page), { timeout: 30_000 })
			.toEqual(
				expect.arrayContaining(["挑记忆", "角色意图", "定计划", "正文"]),
			);
		await expect(committed).toHaveCount(3, { timeout: 60_000 });
		expect(turnBodies.at(-1)).toMatchObject({
			mode: "plan",
			push: "jump",
		});

		// 深度写法：请求带 deep，自查项与阶段都随进度出现。
		await modeGroup.getByRole("button", { name: "深度" }).click();
		await stepGroup.getByRole("button", { name: "一步" }).click();
		await resetStageLog(page);
		await push.click();
		await expect
			.poll(() => stageLog(page), { timeout: 30_000 })
			.toEqual(expect.arrayContaining(["起草", "自查"]));
		await expect(committed).toHaveCount(4, { timeout: 60_000 });
		expect(turnBodies.at(-1)).toMatchObject({
			mode: "deep",
			push: "advance",
		});

		// 重写：原因带进请求，也写进偏好信号。
		const before = await totalNodeCount(page, storyId);
		await page.locator(".acts").getByRole("button", { name: "重写" }).click();
		await expect(page.locator(".why")).toBeVisible();
		await page.locator(".why .chip", { hasText: "太短" }).click();
		await expect
			.poll(() => rerollBodies.length, { timeout: 30_000 })
			.toBeGreaterThan(0);
		expect(rerollBodies.at(-1)).toEqual({ reason: "too-short" });
		await expect
			.poll(() => readPreferenceCounts(storyId).get("swipe") ?? 0, {
				timeout: 30_000,
			})
			.toBe(1);
		await expect
			.poll(() => totalNodeCount(page, storyId), { timeout: 60_000 })
			.toBeGreaterThan(before);

		// 批注整体关闭后再打开，正文仍然可读。
		const notesToggle = page.locator(".meta .tog", { hasText: "批注" });
		await expect(notesToggle).toHaveAttribute("aria-pressed", "true");
		await notesToggle.click();
		await expect(page.locator("#sheet")).toHaveClass(/nonotes/);
		await expect(page.locator(".notes").first()).toBeHidden();
		await expect(page.locator("#script .prose p").first()).toBeVisible();
		await expectNoHorizontalOverflow(page);
		await notesToggle.click();
		await expect(page.locator("#sheet")).not.toHaveClass(/nonotes/);
		await expect(page.locator(".notes").first()).toBeVisible();
	});
});

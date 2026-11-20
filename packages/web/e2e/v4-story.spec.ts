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
	readonly features?: Record<string, unknown>;
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

	test("手机 375px 单手可用，桌面 1440px 正文居中、批注在页边、停靠栏常驻", async ({
		page,
	}) => {
		const stamp = Date.now();
		const storyId = `e2e-v4-layout-${stamp}`;
		await createStory(page, storyId, `排版 ${stamp}`);
		seedFirstFloor(storyId);

		// 桌面：正文一栏居中，批注在正文右边，停靠栏在书页右侧且不用滚动就能看到。
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/stories/${storyId}/play`);
		const prose = page.locator("#script .prose").first();
		await expect(prose).toBeVisible();
		const proseBox = await prose.boundingBox();
		const noteBox = await page.locator(".notes").first().boundingBox();
		const sheetBox = await page.locator("#sheet").boundingBox();
		const dockBox = await page.locator("#dock").boundingBox();
		expect(noteBox?.x ?? 0).toBeGreaterThan(
			(proseBox?.x ?? 0) + (proseBox?.width ?? 0),
		);
		expect(dockBox?.x ?? 0).toBeGreaterThan(
			(sheetBox?.x ?? 0) + (sheetBox?.width ?? 0),
		);
		expect(dockBox?.y ?? 900).toBeLessThan(900);
		await expect(page.locator(".dockbtn")).toBeHidden();
		await expect(page.locator(".notes .note").first()).toBeVisible();
		const fontSize = await page
			.locator("#script .prose p")
			.first()
			.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
		const perLine = (proseBox?.width ?? 0) / fontSize;
		expect(perLine).toBeGreaterThanOrEqual(30);
		expect(perLine).toBeLessThanOrEqual(38);

		// 手机：批注折叠成楼末的小标记，点开才展开。
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto(`/stories/${storyId}/play`);
		await expectNoHorizontalOverflow(page);
		const note = page.locator(".notes .note").first();
		const mark = page.locator(".nmark").first();
		await expect(note).toBeHidden();
		await mark.click();
		await expect(mark).toHaveAttribute("aria-expanded", "true");
		await expect(note).toBeVisible();

		// 输入台在屏幕里、在底部导航之上，主要按钮都够大。
		const cmpBox = await page.locator(".cmp").boundingBox();
		const railBox = await page.locator(".rail").boundingBox();
		expect((cmpBox?.y ?? 0) + (cmpBox?.height ?? 0)).toBeLessThanOrEqual(
			railBox?.y ?? 0,
		);
		for (const name of [/^推进/, "发送"]) {
			const box = await page.getByRole("button", { name }).boundingBox();
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}

		// 打字时收起底部导航，输入台贴到底部。
		await page.locator(".say textarea").focus();
		await expect(page.locator(".rail")).toBeHidden();
		const typingBox = await page.locator(".cmp").boundingBox();
		expect((typingBox?.y ?? 0) + (typingBox?.height ?? 0)).toBeLessThanOrEqual(
			667,
		);
		await page.locator(".say textarea").blur();

		// 停靠栏是底部抽屉：「它看到了什么」直接打开上下文，拉手收起。
		const drawer = page.locator(".dockwrap");
		await expect(page.locator("#dock")).toBeHidden();
		await page.getByRole("button", { name: "它看到了什么" }).click();
		await expect(drawer).toHaveClass(/open/);
		await expect(page.locator("#dock")).toBeVisible();
		await expect(
			page.locator("#dock").getByRole("tab", { name: "上下文" }),
		).toHaveAttribute("aria-selected", "true");
		await page.getByRole("button", { name: "收起停靠栏" }).click();
		await expect(page.locator("#dock")).toBeHidden();
		await page.locator(".dockbtn").click();
		await expect(page.locator("#dock")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator("#dock")).toBeHidden();
	});

	test("本轮临时开关只随下一次发送，发完清空", async ({ page }) => {
		const stamp = Date.now();
		const storyId = `e2e-v4-once-${stamp}`;
		await createStory(page, storyId, `本轮 ${stamp}`);
		seedFirstFloor(storyId);
		const bodies: FloorRequest[] = [];
		page.on("request", (request) => {
			if (
				request.method() === "POST" &&
				new URL(request.url()).pathname === `/api/stories/${storyId}/turns`
			) {
				bodies.push(request.postDataJSON() as FloorRequest);
			}
		});
		await page.goto(`/stories/${storyId}/play`);
		const once = page.locator(".once");
		await once.locator("summary").click();
		const tools = once.getByRole("button", { name: "工具查阅" });
		await expect(tools).toHaveAttribute("aria-pressed", "true");
		await tools.click();
		await expect(tools).toHaveAttribute("aria-pressed", "false");
		await expect(once.locator("summary")).toHaveText("本轮 · 改了 1 项");

		const push = page.getByRole("button", { name: /^推进/ });
		const committed = page
			.locator(".notes .fno")
			.filter({ hasText: /^第 \d+ 楼$/ });
		await push.click();
		await expect(committed).toHaveCount(2, { timeout: 60_000 });
		expect(bodies.at(-1)?.features).toEqual({ tools: false });
		await expect(once.locator("summary")).toHaveText("本轮");

		await push.click();
		await expect(committed).toHaveCount(3, { timeout: 60_000 });
		expect(bodies.at(-1)?.features).toBeUndefined();
	});
});

import { DatabaseSync } from "node:sqlite";
import { type Page, expect, test } from "@playwright/test";
import {
	DB_PATH,
	expectNoHorizontalOverflow,
	latestAssistantNodeId,
	login,
	pathNodeCount,
} from "./helpers";

interface TurnBody {
	readonly text?: string;
	readonly push?: string;
}

/** 一楼固定正文；后面的楼层由假渠道的真实回合写出。 */
function seedFirstFloor(storyId: string): void {
	const nodeId = `${storyId}-head`;
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		db.prepare(
			"INSERT INTO nodes (id, story_id, parent_id, role, raw, created_at) VALUES (?, ?, NULL, 'assistant', ?, ?)",
		).run(
			nodeId,
			storyId,
			"门厅里只剩一盏灯。林雪把那封信推回桌面，说先别看。",
			new Date().toISOString(),
		);
		db.prepare("UPDATE stories SET head_node_id = ? WHERE id = ?").run(
			nodeId,
			storyId,
		);
	} finally {
		db.close();
	}
}

/** 给最新一楼补一条带剧情线的导演安排，界面才会出现「撤回」。 */
function seedDirectorArrangement(storyId: string, nodeId: string): void {
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		db.prepare(
			`INSERT INTO director_decisions (node_id, story_id, directive, mechanisms, signals, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run(
			nodeId,
			storyId,
			"让门外的人先开口",
			JSON.stringify([
				{ name: "advance", triggered: true, reason: "这一场要确认门外是谁" },
			]),
			JSON.stringify({ action: "catch", lineId: "composer-line" }),
			new Date().toISOString(),
		);
	} finally {
		db.close();
	}
}

const floors = (page: Page) =>
	page.locator('#script article.flr[id^="floor-"]');

/** 每楼的操作条；手机上常显，桌面悬停出现。 */
const floorActs = (page: Page, index: number) =>
	page.locator(".flr-acts").nth(index);

test.describe("故事页输入台与楼层操作（ui-v2/02）", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("发送、推进、选项直发、改这句、分支切换、撤回并重写", async ({
		page,
	}, testInfo) => {
		const stamp = Date.now();
		const storyId = `e2e-v5-composer-${stamp}`;
		const created = await page.request.post("/api/stories", {
			data: { id: storyId, title: `输入台 ${stamp}` },
		});
		expect(created.ok()).toBeTruthy();
		seedFirstFloor(storyId);

		const turns: TurnBody[] = [];
		const rerolls: unknown[] = [];
		const corrections: unknown[] = [];
		page.on("request", (request) => {
			if (request.method() !== "POST") return;
			const path = new URL(request.url()).pathname;
			if (path === `/api/stories/${storyId}/turns`) {
				turns.push(request.postDataJSON() as TurnBody);
			} else if (path.endsWith("/regenerate")) {
				rerolls.push(request.postDataJSON());
			} else if (path.endsWith("/correct")) {
				corrections.push(request.postDataJSON());
			}
		});

		await page.goto(`/stories/${storyId}/play`);
		await expect(floors(page)).toHaveCount(1);

		// 空着时主按钮是推进；手机上输入台只占一行，正文区至少七成高。
		const say = page.locator(".say textarea");
		await expect(page.getByRole("button", { name: /^推进/ })).toBeVisible();
		await expect(page.getByRole("button", { name: "发送" })).toHaveCount(0);
		if (testInfo.project.name === "mobile") {
			const viewport = page.viewportSize();
			const cmp = await page.locator(".cmp").boundingBox();
			expect(cmp?.height ?? 999).toBeLessThanOrEqual(
				(viewport?.height ?? 0) * 0.3,
			);
		}
		await expectNoHorizontalOverflow(page);

		// 有字时主按钮变成发送。
		await say.fill("我走到门边听了听");
		await expect(page.getByRole("button", { name: /^推进/ })).toHaveCount(0);
		await page.getByRole("button", { name: "发送" }).click();
		await expect(floors(page)).toHaveCount(2, { timeout: 60_000 });
		expect(turns.at(-1)).toMatchObject({ text: "我走到门边听了听" });
		expect(turns.at(-1)?.push).toBeUndefined();

		// 行动选项点一下就发出去；铅笔只填进输入框。
		await page.getByRole("button", { name: "改一改再发：原地等待" }).click();
		await expect(say).toHaveValue("原地等待");
		expect(turns).toHaveLength(1);
		await say.fill("");
		await page.locator(".opts .chip", { hasText: "推门进去" }).click();
		await expect(floors(page)).toHaveCount(3, { timeout: 60_000 });
		expect(turns.at(-1)).toMatchObject({ text: "推门进去" });

		// 推进：主按钮用当前档位，下拉里换档即发。
		await page.getByRole("button", { name: /^推进/ }).click();
		await expect(floors(page)).toHaveCount(4, { timeout: 60_000 });
		expect(turns.at(-1)?.push).toBeDefined();
		await page.getByRole("button", { name: "选择推进多少" }).click();
		await page.getByRole("menuitem", { name: /^一场/ }).click();
		await expect(floors(page)).toHaveCount(5, { timeout: 60_000 });
		expect(turns.at(-1)).toMatchObject({ push: "quick" });

		// 改这句：只改最后一楼里的一段，旧版留在分支里。
		await floorActs(page, 4).getByRole("button", { name: "改这句" }).click();
		const fix = page.getByRole("form", { name: "改这句" });
		await fix.getByLabel("要改的原文").fill("风从门缝里灌进来，灯影摇了一下。");
		await fix.getByLabel("改成什么样").fill("让风更冷一点");
		await fix.getByRole("button", { name: "只改这一段" }).click();
		await expect(fix).toHaveCount(0, { timeout: 60_000 });
		expect(corrections).toHaveLength(1);

		// 从第 1 楼分支：回到那里，标题旁出现分支选择，可以切回原来的结尾。
		const longPath = await pathNodeCount(page, storyId);
		await floorActs(page, 0)
			.getByRole("button", { name: "从这里分支" })
			.click();
		await expect(floors(page)).toHaveCount(1);
		const branch = page.getByRole("combobox", { name: "分支" });
		await expect(branch).toBeVisible();
		const leaves = await branch
			.locator("option")
			.evaluateAll((options) =>
				options
					.map((option) => (option as HTMLOptionElement).value)
					.filter((value) => value !== ""),
			);
		expect(leaves.length).toBeGreaterThanOrEqual(2);
		await branch.selectOption(leaves[leaves.length - 1] as string);
		await expect(floors(page)).toHaveCount(5);
		expect(await pathNodeCount(page, storyId)).toBe(longPath);

		// 撤回导演安排：给出「仅撤回」与「撤回并重写」，后者带着原因重写最后一楼。
		const lastNode = await latestAssistantNodeId(page, storyId);
		seedDirectorArrangement(storyId, lastNode);
		await page.reload();
		await expect(floors(page)).toHaveCount(5);
		await page.getByRole("button", { name: "写法与本轮设置" }).click();
		const notesToggle = page.locator(".meta .tog", { hasText: "批注" });
		await expect(notesToggle).toHaveAttribute("aria-pressed", "false");
		await notesToggle.click();
		const lastFloor = page.locator(`#floor-${lastNode}`);
		if (testInfo.project.name === "mobile") {
			await lastFloor.locator(".nmark").click();
		}
		await lastFloor.getByRole("button", { name: "撤回", exact: true }).click();
		await expect(
			lastFloor.getByRole("button", { name: "仅撤回" }),
		).toBeVisible();
		await lastFloor.getByRole("button", { name: "撤回并重写" }).click();
		await expect.poll(() => rerolls.length, { timeout: 30_000 }).toBe(1);
		expect(rerolls[0]).toMatchObject({ reason: "avoid-line" });
		await expect(floors(page)).toHaveCount(5, { timeout: 60_000 });
		await expect(page.locator(`#floor-${lastNode}`)).toHaveCount(0, {
			timeout: 60_000,
		});
	});
});

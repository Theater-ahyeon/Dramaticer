import { type Page, expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, login, pathNodeCount } from "./helpers";

/** 手机上停靠栏是底部抽屉，先从故事页打开；桌面上它一直在。 */
async function openDock(page: Page): Promise<void> {
	const opener = page.locator(".dockbtn");
	if (await opener.isVisible()) {
		await opener.click();
		await expect(page.locator(".dockwrap")).toHaveClass(/open/);
	}
}

interface DirectionItem {
	readonly id: string;
	readonly text: string;
	readonly locked: boolean;
}

interface DirectionView {
	readonly wants: readonly DirectionItem[];
	readonly opens: readonly DirectionItem[];
	readonly pushDirections: readonly {
		readonly id: string;
		readonly text: string;
	}[];
}

async function readDirection(
	page: Page,
	storyId: string,
): Promise<DirectionView> {
	const response = await page.request.get(`/api/stories/${storyId}/direction`);
	expect(response.ok()).toBeTruthy();
	return (await response.json()) as DirectionView;
}

test.describe("剧情走向一页", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("大纲页两栏完整，能编辑、自动锁定与手动锁定", async ({
		page,
	}, testInfo) => {
		const storyId = `e2e-direction-${testInfo.project.name}`;
		await page.goto(`/stories/${storyId}/outline`);

		const pageView = page.locator('[data-view="direction"]');
		await expect(pageView).toBeVisible();
		await expect(pageView.locator("h1")).toHaveText("剧情走向");

		const wants = pageView.locator('[data-column="wants"]');
		await expect(wants).toContainText("这座灯塔，究竟为谁而亮？");
		await expect(wants).toContainText("潮湿、克制");
		await expect(wants).toContainText("第三卷之前，阿蘅不能出事");
		await expect(wants).toContainText("卷一 · 雾起");
		await expect(wants).toContainText("贺九把货箱的钥匙推到你面前");

		const opens = pageView.locator('[data-column="opens"]');
		await expect(opens.locator(".dirrow")).toHaveCount(4);
		expect(
			await opens
				.locator(".dirrow")
				.evaluateAll((rows) => rows.map((row) => row.dataset.id)),
		).toEqual([
			"line:rel-old",
			`note:${storyId}-note-old`,
			"line:prom-new",
			`note:${storyId}-note-new`,
		]);
		await expect(opens).toContainText("阿蘅想要把值更簿交给你");
		await expect(opens).toContainText("值更簿缺的那一页");

		// 改一条关键事件：保存后自动锁定，刷新仍在。
		const milestone = wants.locator('[data-id="milestone:m-open"]');
		await milestone.locator("h3").fill("阿蘅把第二把钥匙交到你手上");
		await milestone.locator("h3").press("Enter");
		await expect
			.poll(async () => {
				const view = await readDirection(page, storyId);
				return view.wants.find((item) => item.id === "milestone:m-open")?.text;
			})
			.toBe("阿蘅把第二把钥匙交到你手上");
		await expect(milestone.locator(".lock")).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// 手动锁定本场目标。
		const scene = wants.locator('[data-id="scene"]');
		await scene.getByRole("button", { name: "锁定" }).click();
		await expect
			.poll(async () => {
				const view = await readDirection(page, storyId);
				return view.wants.find((item) => item.id === "scene")?.locked;
			})
			.toBe(true);

		await page.reload();
		const reloaded = page.locator('[data-view="direction"]');
		await expect(
			reloaded.locator('[data-id="milestone:m-open"] h3'),
		).toHaveText("阿蘅把第二把钥匙交到你手上");
		await expect(
			reloaded.locator('[data-id="milestone:m-open"] .lock'),
		).toHaveAttribute("aria-pressed", "true");
		await expect(reloaded.locator('[data-id="scene"] .lock')).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expectNoHorizontalOverflow(page);
	});

	test("停靠栏的导演页复用同一套两栏，能直接编辑与锁定", async ({
		page,
	}, testInfo) => {
		const storyId = `e2e-direction-${testInfo.project.name}`;
		await page.goto(`/stories/${storyId}/play`);
		await openDock(page);

		const dock = page.locator("#dock");
		await dock.getByRole("tab", { name: "导演" }).click();
		await expect(dock.locator('[data-column="wants"]')).toBeVisible();
		await expect(dock.locator('[data-column="opens"]')).toBeVisible();
		await expect(dock).toContainText("这座灯塔，究竟为谁而亮？");
		await expect(dock).toContainText("值更簿缺的那一页");
		await expectNoHorizontalOverflow(page);

		// 就地改一条人物关系线。
		const rel = dock.locator('.dirrow[data-id="line:rel-old"]');
		await expect(rel).toContainText("阿蘅想要把值更簿交给你");
		await rel.locator("h3").fill("阿蘅想要把第二把钥匙交给你");
		await rel.locator("h3").press("Enter");
		await expect
			.poll(async () => {
				const view = await readDirection(page, storyId);
				return view.opens.find((item) => item.id === "line:rel-old")?.text;
			})
			.toBe("阿蘅想要把第二把钥匙交给你");

		// 锁定一条伏笔。
		const promise = dock.locator('.dirrow[data-id="line:prom-new"]');
		await promise.getByRole("button", { name: "锁定" }).click();
		await expect
			.poll(async () => {
				const view = await readDirection(page, storyId);
				return view.opens.find((item) => item.id === "line:prom-new")?.locked;
			})
			.toBe(true);
		await expect(promise.getByRole("button", { name: "已锁定" })).toBeVisible();

		await page.reload();
		await openDock(page);
		await page.locator("#dock").getByRole("tab", { name: "导演" }).click();
		await expect(
			page.locator('#dock .dirrow[data-id="line:rel-old"]'),
		).toContainText("阿蘅想要把第二把钥匙交给你");
		await expect(
			page.locator('#dock .dirrow[data-id="line:prom-new"] .lock'),
		).toHaveAttribute("aria-pressed", "true");
	});

	test("推进菜单给 2–3 个方向，点选后带着方向发送", async ({
		page,
	}, testInfo) => {
		const storyId = `e2e-direction-${testInfo.project.name}`;
		await page.goto(`/stories/${storyId}/play`);

		const view = await readDirection(page, storyId);
		expect(view.pushDirections.length).toBeGreaterThanOrEqual(2);
		expect(view.pushDirections.length).toBeLessThanOrEqual(3);
		const first = view.pushDirections[0];
		if (first === undefined) throw new Error("走向页没有推进方向");

		await page.getByRole("button", { name: "选择推进多少" }).click();
		const menu = page.locator('.pushmenu[aria-label="推进"]');
		await expect(menu).toBeVisible();
		const items = menu.locator("[data-direction]");
		await expect(items).toHaveCount(view.pushDirections.length);
		await expect(items.first()).toContainText(first.text);
		await expect(menu).toContainText("走多远");

		const before = await pathNodeCount(page, storyId);
		await items.first().click();
		await expect
			.poll(() => pathNodeCount(page, storyId), { timeout: 30_000 })
			.toBe(before + 2);
		await expect(page.locator(".said").last()).toContainText(
			`推进方向：${first.text}`,
		);
		await expectNoHorizontalOverflow(page);
	});

	test("规划与深度写法收在设置的实验区", async ({ page }, testInfo) => {
		const storyId = `e2e-direction-${testInfo.project.name}`;
		await page.goto(`/stories/${storyId}/prefs?tab=adv`);

		const experiment = page.locator('section[aria-label="实验"]');
		await expect(experiment).toBeVisible();
		const writing = experiment.locator("select");
		await expect(writing).toHaveValue("fast");
		await expect(writing.locator("option")).toHaveText([
			"快速（默认）",
			"规划（实验）",
			"深度（实验）",
		]);

		await writing.selectOption("plan");
		await page.getByRole("button", { name: "保存故事设置" }).click();
		await expect
			.poll(async () => {
				const response = await page.request.get(
					`/api/stories/${storyId}/settings`,
				);
				const settings = (await response.json()) as { turnMode: string };
				return settings.turnMode;
			})
			.toBe("plan");

		// 故事页常规展开区不把实验写法列为常规选项。
		await page.goto(`/stories/${storyId}/play`);
		await page.getByRole("button", { name: "写法与本轮设置" }).click();
		const modes = page.locator(".meta").getByRole("group", { name: "写法" });
		await expect(modes.getByRole("button")).toHaveText([
			"快速",
			"规划（实验）",
		]);

		await page.goto(`/stories/${storyId}/prefs?tab=adv`);
		await page
			.locator('section[aria-label="实验"] select')
			.selectOption("fast");
		await page.getByRole("button", { name: "保存故事设置" }).click();
		await expect
			.poll(async () => {
				const response = await page.request.get(
					`/api/stories/${storyId}/settings`,
				);
				const settings = (await response.json()) as { turnMode: string };
				return settings.turnMode;
			})
			.toBe("fast");
	});
});

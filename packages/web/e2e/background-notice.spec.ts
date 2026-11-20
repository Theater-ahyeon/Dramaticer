import { DatabaseSync } from "node:sqlite";
import { type Page, expect, test } from "@playwright/test";
import { DB_PATH, login } from "./helpers";

// refactor/03：后台连续因为渠道失败而出错时，故事页顶部显示可关闭的提示；
// 后台恢复（有一条任务成功）后提示自动消失。

function seedJobs(
	storyId: string,
	jobs: readonly { kind: string; status: "failed" | "done"; at: string }[],
): void {
	const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
	try {
		const insert = db.prepare(
			`INSERT INTO background_jobs (story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)
			 VALUES (?, NULL, ?, ?, 1, ?, ?, ?, ?)`,
		);
		for (const job of jobs) {
			insert.run(
				storyId,
				job.kind,
				job.status,
				job.status === "failed"
					? "模型 e2e/bg-model 的所有渠道都失败了：bg：402 insufficient_balance"
					: null,
				job.at,
				job.at,
				job.at,
			);
		}
	} finally {
		db.close();
	}
}

/** 重新加载并等后台状态读回来；否则「没有提示」可能只是还没读到。 */
async function reloadAndWaitForHealth(page: Page, storyId: string) {
	const health = page.waitForResponse((response) =>
		response.url().endsWith(`/api/stories/${storyId}/background/health`),
	);
	await page.reload();
	expect((await health).ok()).toBe(true);
	await expect(page.locator('[data-view="play"]')).toBeVisible();
}

test("后台暂停时故事页顶部提示原因，可以关掉，恢复后自动消失", async ({
	page,
}) => {
	await login(page);
	const storyId = `e2e-bg-notice-${Date.now()}`;
	const created = await page.request.post("/api/stories", {
		data: { id: storyId, title: "后台暂停" },
	});
	expect(created.ok()).toBeTruthy();
	seedJobs(storyId, [
		{ kind: "k1", status: "failed", at: "2026-11-19T10:00:01.000Z" },
		{ kind: "k2", status: "failed", at: "2026-11-19T10:00:02.000Z" },
		{ kind: "k3", status: "failed", at: "2026-11-19T10:00:03.000Z" },
	]);

	await page.goto(`/stories/${storyId}/play`);
	const notice = page.locator(".bgnotice");
	await expect(notice).toBeVisible();
	await expect(notice).toContainText("记忆与导演暂停了");
	await expect(notice).toContainText("渠道 bg");
	await expect(notice).toContainText("402");
	await expect(
		notice.getByRole("link", { name: "去渠道设置" }),
	).toHaveAttribute("href", `/stories/${storyId}/channels`);

	// 关掉后同一条不再出现。
	await notice.getByRole("button", { name: "知道了" }).click();
	await expect(notice).toHaveCount(0);
	await reloadAndWaitForHealth(page, storyId);
	await expect(page.locator(".bgnotice")).toHaveCount(0);

	// 新开一个会话（没关过）时仍然显示；有一条任务成功后自动消失。
	await page.evaluate(() => sessionStorage.clear());
	await page.reload();
	await expect(page.locator(".bgnotice")).toBeVisible();
	seedJobs(storyId, [
		{ kind: "k4", status: "done", at: "2026-11-19T10:00:04.000Z" },
	]);
	await reloadAndWaitForHealth(page, storyId);
	await expect(page.locator(".bgnotice")).toHaveCount(0);
});

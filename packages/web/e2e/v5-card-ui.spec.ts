import { randomUUID } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import { login, pathNodeCount } from "./helpers";

const CARD = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "卡片前端",
		description: "状态栏、按钮与外部脚本都在卡里。",
		first_mes: "<状态栏>气力：3</状态栏>\n门外的雨停了。",
		extensions: {
			dramaticer: {
				plugins: [
					{
						format: "dramaticer.plugin",
						formatVersion: 1,
						name: "e2e.card-ui",
						version: "1.0.0",
						kind: "floor-renderer",
						payload: {
							id: "e2e-status",
							name: "测试状态栏",
							blockTypes: ["状态栏"],
							permissions: ["sendMessage", "fillInput"],
							template:
								'<div class="probe"><p id="value">气力：3</p><button id="send" type="button">继续</button></div>',
							script: [
								'document.getElementById("send").addEventListener("click", function () {',
								'  window.dramaticerBridge.sendMessage("我按下按钮").catch(function () {});',
								"});",
								'try { window.dramaticerBridge.writeState({ path: ["mvu", "probe"], op: "set", value: 1 }).catch(function () {}); } catch (error) {}',
								'try { fetch("https://cdn.example.com/probe.json"); } catch (error) {}',
							].join("\n"),
						},
					},
				],
			},
		},
	},
};

test.beforeEach(async ({ page }) => {
	await login(page);
});

async function importCardStory(page: Page): Promise<string> {
	const id = `e2e-card-ui-${randomUUID()}`;
	const created = await page.request.post("/api/stories", {
		data: { id, title: "卡片前端" },
	});
	expect(created.ok()).toBeTruthy();
	const imported = await page.request.post(`/api/stories/${id}/import`, {
		data: { card: { format: "json", data: JSON.stringify(CARD) } },
	});
	expect(imported.ok()).toBeTruthy();
	return id;
}

async function rejectionKinds(page: Page, storyId: string): Promise<string[]> {
	const response = await page.request.get(
		`/api/stories/${storyId}/sandbox/rejections`,
	);
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as {
		rejections: readonly { kind: string; target: string }[];
	};
	return body.rejections.map((item) => `${item.kind}:${item.target}`);
}

test("沙箱楼层按钮能发消息；未声明调用与被拦的联网都进检视器；域名可逐个允许", async ({
	page,
}) => {
	const storyId = await importCardStory(page);
	await page.goto(`/stories/${storyId}/play`);
	const frame = page.frameLocator('iframe[title^="楼层渲染"]').first();
	await expect(frame.locator("#value")).toHaveText("气力：3");

	// 默认禁止联网：CSP 里没有卡脚本的域名。
	const cspBefore = await frame
		.locator('meta[http-equiv="Content-Security-Policy"]')
		.getAttribute("content");
	expect(cspBefore).toContain("default-src 'none'");
	expect(cspBefore).toContain("connect-src 'none'");
	expect(cspBefore).not.toContain("cdn.example.com");

	// 合成插件在 iframe 里画按钮；点击后经交互桥发送一条玩家消息。
	const before = await pathNodeCount(page, storyId);
	await frame.getByRole("button", { name: "继续" }).click();
	await expect
		.poll(() => pathNodeCount(page, storyId), { timeout: 30_000 })
		.toBeGreaterThan(before + 1);
	await expect(
		page.locator(".said").filter({ hasText: "我按下按钮" }).first(),
	).toBeVisible();

	// 未声明 writeState 的调用被拒绝；外部域名请求被拦截并记录。
	await expect
		.poll(() => rejectionKinds(page, storyId), { timeout: 15_000 })
		.toEqual(
			expect.arrayContaining([
				expect.stringContaining("bridge:writeState"),
				expect.stringContaining("network:https://cdn.example.com"),
			]),
		);
	await page.getByRole("button", { name: "写法与本轮设置" }).click();
	await page
		.locator(".meta")
		.getByRole("button", { name: "检视器", exact: true })
		.click();
	const inspector = page.getByRole("dialog", { name: "检视器" });
	await expect(inspector).toBeVisible();
	const sandboxSection = inspector.getByRole("region", { name: "沙箱拒绝" });
	await expect(sandboxSection).toContainText("交互桥");
	await expect(sandboxSection).toContainText("writeState");
	await expect(sandboxSection).toContainText("联网");
	await expect(sandboxSection).toContainText("cdn.example.com");
	await page.keyboard.press("Escape");

	// 设定页：脚本里的域名默认未允许，点一下允许后刷新仍在名单里。
	await page.goto(`/stories/${storyId}/lore`);
	const perms = page.getByRole("region", { name: "卡片脚本与联网" });
	await expect(perms).toBeVisible();
	await expect(perms).toContainText("测试状态栏");
	await expect(perms).toContainText("发送消息");
	const toggle = perms.getByRole("switch", { name: "允许 cdn.example.com" });
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await page.reload();
	const afterReload = page
		.getByRole("region", { name: "卡片脚本与联网" })
		.getByRole("switch", { name: "允许 cdn.example.com" });
	await expect(afterReload).toHaveAttribute("aria-checked", "true");

	// 允许后沙箱的 CSP 带上这个域名。
	await page.goto(`/stories/${storyId}/play`);
	const allowedFrame = page.frameLocator('iframe[title^="楼层渲染"]').first();
	const cspAfter = await allowedFrame
		.locator('meta[http-equiv="Content-Security-Policy"]')
		.getAttribute("content");
	expect(cspAfter).toContain("https://cdn.example.com");
	await expect(allowedFrame.locator("#value")).toHaveText("气力：3");
});

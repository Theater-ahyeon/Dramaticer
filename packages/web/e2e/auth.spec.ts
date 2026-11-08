import { expect, test } from "@playwright/test";
import { PASSWORD, login } from "./helpers";

test("未登录访问故事被拒绝，密码错误有提示，正确密码进入故事列表", async ({
	page,
}) => {
	const denied = await page.request.get("/api/stories");
	expect(denied.status()).toBe(401);

	await page.goto("/login");
	await page.getByLabel("访问密码").fill("wrong-password");
	await page.getByRole("button", { name: "登录" }).click();
	await expect(page.locator(".error-notice")).toContainText("密码错误");

	await page.getByLabel("访问密码").fill(PASSWORD);
	await page.getByRole("button", { name: "登录" }).click();
	await page.waitForURL("**/");
	await expect(page.getByRole("heading", { name: "故事" })).toBeVisible();
});

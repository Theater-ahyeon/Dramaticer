import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

interface SavedWorkflow {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
	readonly payload: Record<string, unknown>;
}

test.describe("NovelAI 模板扩展参数", () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test("自定义模型、Medium 档、负面预设、固定 seed 与 V5 开关都能保存", async ({
		page,
	}) => {
		await page.goto("/settings");
		const form = page.getByRole("region", { name: "NovelAI 模板" });
		await expect(form).toBeVisible();
		const name = `V5 模板 ${randomUUID()}`;
		await form.getByLabel("模板名称").fill(name);
		await form.getByLabel("模型").selectOption("__custom__");
		await form.getByLabel("自定义模型 id").fill("nai-diffusion-5-full");
		await form.getByLabel("Medium 档").check();
		await form.getByLabel("负面预设").selectOption("human_focus");
		await form.getByLabel("固定 seed").fill("20261127");
		await form.getByLabel("多样性增强").check();
		await form.getByLabel("按坐标排布人物").check();
		await form.getByLabel("V5 straight_alpha").check();
		await form.getByLabel("V5 tag_hint_qt").check();
		await form.getByLabel("V5 tag_hint_uc_preset").check();
		await form.getByRole("button", { name: "保存模板" }).click();
		await expect(form.getByText("已保存")).toBeVisible();

		const response = await page.request.get("/api/images/workflows");
		expect(response.ok()).toBeTruthy();
		const body = (await response.json()) as {
			workflows: readonly SavedWorkflow[];
		};
		const saved = body.workflows.find((workflow) => workflow.name === name);
		expect(saved?.kind).toBe("novelai");
		expect(saved?.payload).toMatchObject({
			model: "nai-diffusion-5-full",
			mediumTier: true,
			negativePreset: "human_focus",
			fixedSeed: 20261127,
			varietyBoost: true,
			useCoords: true,
			straightAlpha: true,
			tagHintQt: true,
			tagHintUcPreset: true,
		});
		await expect(page.locator(".v4err")).toHaveCount(0);
	});
});

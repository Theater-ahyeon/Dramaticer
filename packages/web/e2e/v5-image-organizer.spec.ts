import { randomUUID } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import {
	createImportedStory,
	latestAssistantNodeId,
	login,
	sendTurn,
} from "./helpers";

const WORKFLOW = {
	"3": {
		class_type: "KSampler",
		inputs: {
			seed: 1,
			positive: ["6", 0],
			negative: ["7", 0],
			latent_image: ["5", 0],
		},
	},
	"5": {
		class_type: "EmptyLatentImage",
		inputs: { width: 512, height: 768 },
	},
	"6": { class_type: "CLIPTextEncode", inputs: { text: "prompt" } },
	"7": { class_type: "CLIPTextEncode", inputs: { text: "negative" } },
};

const SLOTS = {
	positive: { nodeId: "6", input: "text" },
	negative: { nodeId: "7", input: "text" },
	seed: { nodeId: "3", input: "seed" },
	width: { nodeId: "5", input: "width" },
	height: { nodeId: "5", input: "height" },
};

function slots() {
	const cell = (prefix: string) => ({
		clothed: [`${prefix} clothed`],
		bare: [`${prefix} bare`],
	});
	return {
		face: { front: cell("face front"), back: cell("face back") },
		upper: { front: cell("upper front"), back: cell("upper back") },
		full: { front: cell("full front"), back: cell("full back") },
	};
}

async function importWorkflow(page: Page): Promise<string> {
	const name = `整理模板 ${randomUUID()}`;
	const response = await page.request.post("/api/images/workflows/import", {
		data: { name, workflow: WORKFLOW, slots: SLOTS },
	});
	expect(response.ok()).toBeTruthy();
	const list = await page.request.get("/api/images/workflows");
	const body = (await list.json()) as {
		workflows: readonly { id: string; name: string }[];
	};
	const saved = body.workflows.find((workflow) => workflow.name === name);
	expect(saved).toBeDefined();
	return saved?.id as string;
}

async function seedVisuals(page: Page, storyId: string): Promise<void> {
	const profiles = await page.request.put(
		`/api/stories/${storyId}/visual-profiles`,
		{
			data: {
				profiles: [
					{
						character: "林雪",
						base: ["black long hair"],
						defaultOutfit: "深蓝校服",
						negative: ["bad hands"],
						locked: true,
						slots: slots(),
					},
				],
			},
		},
	);
	expect(profiles.ok()).toBeTruthy();
	const outfits = await page.request.put(`/api/stories/${storyId}/outfits`, {
		data: {
			outfits: [
				{
					character: "林雪",
					name: "深蓝校服",
					upperVisible: ["navy blazer"],
					upperHidden: ["navy collar"],
					fullVisible: ["pleated skirt"],
					fullHidden: ["skirt hem"],
					isDefault: true,
					locked: true,
				},
			],
		},
	});
	expect(outfits.ok()).toBeTruthy();
}

async function waitForImages(
	page: Page,
	nodeId: string,
	count: number,
): Promise<
	readonly {
		id: string;
		status: string;
		title: string | null;
		insertAfterParagraph: number | null;
		prompt: string | null;
		negativePrompt: string | null;
		url: string | null;
	}[]
> {
	let images: readonly {
		id: string;
		status: string;
		title: string | null;
		insertAfterParagraph: number | null;
		prompt: string | null;
		negativePrompt: string | null;
		url: string | null;
	}[] = [];
	await expect
		.poll(
			async () => {
				const response = await page.request.get(`/api/nodes/${nodeId}/images`);
				const body = (await response.json()) as {
					images: typeof images;
				};
				images = body.images;
				return `${body.images.length}:${body.images.every((image) => image.status === "done")}`;
			},
			{ timeout: 40_000 },
		)
		.toBe(`${count}:true`);
	return images;
}

test("画面整理：触发频率与替换规则落定，整理结果带段落与展开提示词", async ({
	page,
}) => {
	await login(page);
	const storyId = await createImportedStory(page, `画面整理 ${Date.now()}`);
	const workflowId = await importWorkflow(page);
	await seedVisuals(page, storyId);

	await page.goto(`/stories/${storyId}/prefs?tab=adv`);
	const imageSection = page.getByRole("region", { name: "生图" });
	await expect(imageSection).toBeVisible();
	await imageSection.getByLabel("workflow").selectOption(workflowId);
	for (const trigger of ["manual", "scene_end"] as const) {
		await imageSection.getByLabel("触发频率").selectOption(trigger);
		await page.getByRole("button", { name: "保存故事设置" }).click();
		await expect(page.getByText("已保存", { exact: true })).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole("region", { name: "生图" }).getByLabel("触发频率"),
		).toHaveValue(trigger);
	}
	const finalSection = page.getByRole("region", { name: "生图" });
	await finalSection.getByLabel("触发频率").selectOption("floor");
	await finalSection.getByLabel("每楼最多插图（1 到 4）").fill("2");
	await imageSection.getByRole("button", { name: "新增替换规则" }).click();
	await imageSection.getByLabel("规则 1 查找").fill("门厅");
	await imageSection.getByLabel("规则 1 替换为").fill("大厅");
	await page.getByRole("button", { name: "保存故事设置" }).click();
	await expect(page.getByText("已保存", { exact: true })).toBeVisible();

	await page.reload();
	const reloaded = page.getByRole("region", { name: "生图" });
	await expect(reloaded.getByLabel("触发频率")).toHaveValue("floor");
	await expect(reloaded.getByLabel("规则 1 查找")).toHaveValue("门厅");
	await expect(reloaded.getByLabel("规则 1 替换为")).toHaveValue("大厅");

	await page.goto(`/stories/${storyId}/play`);
	await sendTurn(page, storyId, "我推门走进门厅。");
	const nodeId = await latestAssistantNodeId(page, storyId);
	const first = await waitForImages(page, nodeId, 1);
	expect(first[0]).toMatchObject({
		title: "门厅的灯",
		insertAfterParagraph: 1,
		status: "done",
	});
	expect(first[0]?.prompt).toContain("林雪站在大厅");
	expect(first[0]?.prompt).not.toContain("门厅");
	expect(first[0]?.prompt).toContain("upper front clothed");
	expect(first[0]?.prompt).toContain("navy blazer");
	expect(first[0]?.prompt).toContain("skirt hem");
	expect(first[0]?.prompt).toContain("holding a lantern");
	expect(first[0]?.negativePrompt).toContain("blurry");
	expect(
		first[0]?.negativePrompt
			?.split(", ")
			.filter((item) => item === "bad hands"),
	).toHaveLength(1);
	const file = await page.request.get(first[0]?.url as string);
	expect(file.ok()).toBeTruthy();
	expect(file.headers()["content-type"]).toBe("image/png");

	const manual = await page.request.post(
		`/api/stories/${storyId}/nodes/${nodeId}/organize-images`,
	);
	expect(manual.status()).toBe(202);
	const second = await waitForImages(page, nodeId, 2);
	expect(second.map((image) => image.status)).toEqual(["done", "done"]);
	expect(second[1]?.insertAfterParagraph).toBe(1);

	await page.goto(`/stories/${storyId}/prefs?tab=adv`);
	const preview = page.getByRole("region", { name: "生图" });
	await expect(preview.getByText("门厅的灯").first()).toBeVisible();
});

test("画面整理失败时故事页正文照常显示", async ({ page }) => {
	await login(page);
	const storyId = await createImportedStory(page, `整理失败 ${Date.now()}`);
	const workflowId = await importWorkflow(page);
	const settings = await page.request.put(`/api/stories/${storyId}/settings`, {
		data: {
			imageConfig: {
				mode: "auto",
				workflowId,
				maxPerFloor: 1,
				minFloorsBetween: 0,
				trigger: "floor",
				recentPromptHistory: 0,
				replacementRules: [],
			},
		},
	});
	expect(settings.ok()).toBeTruthy();
	await page.goto(`/stories/${storyId}/play`);
	await sendTurn(page, storyId, "整理失败");
	const nodeId = await latestAssistantNodeId(page, storyId);
	await expect
		.poll(
			async () => {
				const response = await page.request.get(`/api/stories/${storyId}/jobs`);
				const body = (await response.json()) as {
					recentErrors: readonly { kind: string; error: string }[];
				};
				return body.recentErrors.some((job) => job.kind === "image_organize");
			},
			{ timeout: 30_000 },
		)
		.toBe(true);
	const images = await page.request.get(`/api/nodes/${nodeId}/images`);
	const imageView = (await images.json()) as { images: readonly unknown[] };
	expect(imageView.images).toHaveLength(0);
	await page.reload();
	await expect(
		page.getByText("整理失败", { exact: false }).first(),
	).toBeVisible();
});

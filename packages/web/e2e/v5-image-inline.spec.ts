import { randomUUID } from "node:crypto";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { createImportedStory, login } from "./helpers";

const SLOTS = {
	positive: { nodeId: "6", input: "text" },
	negative: { nodeId: "7", input: "text" },
	seed: { nodeId: "3", input: "seed" },
	width: null,
	height: null,
};

const THREE_PARAGRAPHS =
	"第一段，雨声贴着窗。\n\n第二段，灯影摇了一下。\n\n第三段，门后的脚步停了。";

function workflow(marker: string): unknown {
	return {
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
		"10": { class_type: "Note", inputs: { text: marker } },
	};
}

async function importWorkflow(page: Page, marker: string): Promise<string> {
	const name = `插图模板 ${marker} ${randomUUID()}`;
	const response = await page.request.post("/api/images/workflows/import", {
		data: { name, workflow: workflow(marker), slots: SLOTS },
	});
	expect(response.ok()).toBeTruthy();
	const list = await page.request.get("/api/images/workflows");
	const body = (await list.json()) as {
		workflows: readonly { id: string; name: string }[];
	};
	const saved = body.workflows.find((item) => item.name === name);
	expect(saved).toBeDefined();
	return saved?.id as string;
}

interface ImageView {
	readonly id: string;
	readonly status: string;
	readonly seed: number | null;
	readonly width: number | null;
	readonly height: number | null;
	readonly url: string | null;
	readonly prompt: string | null;
	readonly negativePrompt: string | null;
	readonly workflowId: string;
	readonly insertAfterParagraph: number | null;
	readonly title: string | null;
}

async function imagesOf(
	page: Page,
	nodeId: string,
): Promise<readonly ImageView[]> {
	const response = await page.request.get(`/api/nodes/${nodeId}/images`);
	expect(response.ok()).toBeTruthy();
	const body = (await response.json()) as { images: readonly ImageView[] };
	return body.images;
}

async function waitForImage(
	page: Page,
	nodeId: string,
	check: (image: ImageView) => boolean,
): Promise<ImageView> {
	let latest: ImageView | null = null;
	await expect
		.poll(
			async () => {
				const images = await imagesOf(page, nodeId);
				latest = images[0] ?? null;
				return latest !== null && latest.status === "done" && check(latest);
			},
			{ timeout: 60_000 },
		)
		.toBe(true);
	return latest as ImageView;
}

async function openImageMenu(figure: Locator): Promise<void> {
	await figure.getByRole("button", { name: /插图操作/ }).click();
}

/** 与假后端的编码一致：正向提示词决定图片宽度。 */
function promptWidth(prompt: string): number {
	let hash = 2166136261;
	for (let index = 0; index < prompt.length; index += 1) {
		hash = Math.imul(hash ^ prompt.charCodeAt(index), 16777619);
	}
	return 40 + ((hash >>> 0) % 400);
}

test("插图按段落插入，三种重绘、删除与手动画这一幕", async ({ page }) => {
	await login(page);
	const storyId = await createImportedStory(page, `插图重绘 ${Date.now()}`);
	const workflowA = await importWorkflow(page, "template-a");
	const workflowB = await importWorkflow(page, "template-b");
	const settings = await page.request.put(`/api/stories/${storyId}/settings`, {
		data: {
			imageConfig: {
				mode: "manual",
				workflowId: workflowA,
				maxPerFloor: 4,
				minFloorsBetween: 0,
				trigger: "manual",
				recentPromptHistory: 0,
				replacementRules: [],
			},
		},
	});
	expect(settings.ok()).toBeTruthy();

	const pathResponse = await page.request.get(`/api/stories/${storyId}/path`);
	const path = (await pathResponse.json()) as {
		nodes: readonly { id: string; role: string }[];
	};
	const base = [...path.nodes]
		.reverse()
		.find((node) => node.role === "assistant");
	const edited = await page.request.post(`/api/nodes/${base?.id}/edit`, {
		data: { text: THREE_PARAGRAPHS },
	});
	expect(edited.ok()).toBeTruthy();
	const editedBody = (await edited.json()) as { node: { id: string } };
	const nodeId = editedBody.node.id;

	await page.goto(`/stories/${storyId}/play`);
	const floor = page.locator(`#floor-${nodeId}`);
	const actions = page.locator(`.flr-acts[data-node-id="${nodeId}"]`);
	await expect(floor).toBeVisible();
	const paragraphs = floor.locator(".prose > p");
	await expect(paragraphs).toHaveCount(3);
	const beforeTexts = await paragraphs.allTextContents();
	expect(beforeTexts).toEqual([
		"第一段，雨声贴着窗。",
		"第二段，灯影摇了一下。",
		"第三段，门后的脚步停了。",
	]);

	await actions.getByRole("button", { name: "画这一幕" }).click();
	const figure = floor.locator("figure.floor-ill");
	await expect(figure).toBeVisible({ timeout: 60_000 });
	const first = await waitForImage(page, nodeId, () => true);
	expect(first).toMatchObject({
		insertAfterParagraph: 1,
		title: "门厅的灯",
	});

	const placement = await figure.evaluate((element) => ({
		previous: element.previousElementSibling?.tagName,
		previousText: element.previousElementSibling?.textContent,
		next: element.nextElementSibling?.tagName,
		nextText: element.nextElementSibling?.textContent,
	}));
	expect(placement).toEqual({
		previous: "P",
		previousText: "第一段，雨声贴着窗。",
		next: "P",
		nextText: "第二段，灯影摇了一下。",
	});

	await openImageMenu(figure);
	await figure.getByRole("menuitem", { name: "重绘（换 seed）" }).click();
	const reseeded = await waitForImage(
		page,
		nodeId,
		(image) => image.seed !== first.seed && image.height !== first.height,
	);
	expect(reseeded.prompt).toBe(first.prompt);
	expect(reseeded.url).not.toBe(first.url);

	await openImageMenu(figure);
	await figure.getByRole("menuitem", { name: "改提示词后重绘" }).click();
	const promptForm = figure.getByRole("form", { name: "改提示词后重绘" });
	const promptBox = promptForm.getByRole("textbox", {
		name: "提示词",
		exact: true,
	});
	const negativeBox = promptForm.getByRole("textbox", {
		name: "负面提示词",
		exact: true,
	});
	await expect(promptBox).toHaveValue(first.prompt ?? "");
	const newPrompt = "玩家改过的提示词，门厅新构图";
	const newNegative = "玩家负面，模糊";
	await promptBox.fill(newPrompt);
	await negativeBox.fill(newNegative);
	await promptForm.getByRole("button", { name: "按新提示词重绘" }).click();
	const editedImage = await waitForImage(
		page,
		nodeId,
		(image) => image.prompt === newPrompt,
	);
	expect(editedImage.negativePrompt).toBe(newNegative);
	expect(editedImage.seed).toBe(reseeded.seed);
	expect(editedImage.width).toBe(promptWidth(newPrompt));
	expect(editedImage.height).not.toBe(reseeded.height);

	await openImageMenu(figure);
	await figure.getByRole("menuitem", { name: "换模板" }).click();
	const switchForm = figure.getByRole("form", { name: "换模板" });
	await switchForm.getByLabel("新模板").selectOption(workflowB);
	await switchForm.getByRole("button", { name: "确定" }).click();
	const switched = await waitForImage(
		page,
		nodeId,
		(image) =>
			image.workflowId === workflowB && image.height !== editedImage.height,
	);
	expect(switched.prompt).toBe(newPrompt);
	expect(switched.seed).toBe(editedImage.seed);
	expect(switched.width).toBe(promptWidth(newPrompt));

	await openImageMenu(figure);
	await figure.getByRole("menuitem", { name: "删除" }).click();
	await expect(figure).toHaveCount(0);
	expect(await imagesOf(page, nodeId)).toHaveLength(0);
	await expect(paragraphs).toHaveCount(3);
	expect(await paragraphs.allTextContents()).toEqual(beforeTexts);

	await actions.getByRole("button", { name: "画这一幕" }).click();
	await expect(floor.locator("figure.floor-ill")).toBeVisible({
		timeout: 60_000,
	});
	const redrawn = await waitForImage(page, nodeId, () => true);
	expect(redrawn.status).toBe("done");
	await expect(paragraphs).toHaveCount(3);
	expect(await paragraphs.allTextContents()).toEqual(beforeTexts);
});

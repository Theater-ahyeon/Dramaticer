// server 路由：出图工作流、楼层插图、媒体文件、卡面与立绘（refactor/06 从 routes.ts 拆出）。
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type CharacterOutfitInput,
	type CharacterVisualProfile,
	type ComfyUiSlots,
	type ComfyUiWorkflow,
	type ImagePromptRequest,
	ImageWorkflowInUseError,
	type NodeImageRecord,
	type TagLibraryEntryInput,
	assertComfyUiSlots,
	detectComfyUiSlots,
	emptyImagesConfig,
	enqueueIllustrateBackgroundJob,
	loadImagesConfig,
	parseComfyUiWorkflow,
	readWritingEntries,
	resolveImageProvider,
	saveNovelAiTemplate,
	validateImagePromptRequest,
} from "@dramaticer/core";
import type {
	ImageProvidersView,
	ImageWorkflowDetectionView,
	ImageWorkflowsView,
	NodeImage,
	NodeImagesView,
	StoryCharacterOutfitsView,
	StoryImageImportResult,
	StoryImageOrganizerEntriesView,
	StoryTagLibraryView,
	StoryVisualProfilesView,
} from "@dramaticer/protocol";
import {
	importImageCharacterLibrary,
	importImagePromptPreset,
} from "@dramaticer/st-compat";
import { renderCoverPlaceholder } from "./cover-placeholder.js";
import { HttpError, sendEmpty, sendJson } from "./http.js";
import {
	IMAGE_MEDIA_TYPES,
	assertKnownKeys,
	fieldError,
	readObjectBody,
	requireNode,
	requireStory,
	requireText,
	toBadRequest,
} from "./routes-common.js";
import type { ApiRouteOptions } from "./routes.js";
import { readStoryMediaFile, resolveMediaFile } from "./story-media.js";

export function toNodeImage(record: NodeImageRecord): NodeImage {
	return {
		id: record.id,
		nodeId: record.nodeId,
		ordinal: record.ordinal,
		status: record.status,
		url:
			record.status === "done"
				? `/api/images/${encodeURIComponent(record.id)}/file`
				: null,
		width: record.width,
		height: record.height,
		error: record.error,
	};
}

export async function handleImageProviders(
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const config =
		options.imagesPath === null
			? emptyImagesConfig()
			: await loadImagesConfig(options.imagesPath, options.imagesEnv);
	const view: ImageProvidersView = {
		providers: [...config.providers.values()].map((provider) => ({
			id: provider.id,
			api: provider.api,
			baseUrl: provider.baseUrl,
			configured: true,
			timeoutMs: provider.timeoutMs,
			pollIntervalMs: provider.api === "comfyui" ? provider.pollIntervalMs : 0,
		})),
	};
	sendJson(res, 200, view);
}

export function handleImageWorkflows(
	res: ServerResponse,
	options: ApiRouteOptions,
): void {
	const view: ImageWorkflowsView = {
		workflows: options.store.listImageWorkflows(),
	};
	sendJson(res, 200, view);
}

/** `PUT /api/stories/:id/visual-profiles`：玩家保存 12 格与锁定。 */
export async function handleStoryVisualProfilesSave(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["profiles"]);
	if (!Array.isArray(body.profiles)) {
		throw fieldError("profiles", "profiles 必须是数组");
	}
	if (body.profiles.length > 0) {
		try {
			options.store.saveCharacterVisualProfiles({
				storyId,
				profiles: body.profiles as readonly CharacterVisualProfile[],
				source: "player",
			});
		} catch (error) {
			throw toBadRequest(error, "profiles");
		}
	}
	const view: StoryVisualProfilesView = {
		storyId,
		profiles: options.store.listCharacterVisualProfiles(storyId),
	};
	sendJson(res, 200, view);
}

export function handleStoryOutfits(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: StoryCharacterOutfitsView = {
		storyId,
		outfits: options.store.listCharacterOutfits(storyId),
	};
	sendJson(res, 200, view);
}

/** `PUT /api/stories/:id/outfits`：整体保存服装表，支持增删改。 */
export async function handleStoryOutfitsSave(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["outfits"]);
	if (!Array.isArray(body.outfits)) {
		throw fieldError("outfits", "outfits 必须是数组");
	}
	try {
		options.store.replaceCharacterOutfits({
			storyId,
			outfits: body.outfits as readonly CharacterOutfitInput[],
		});
	} catch (error) {
		throw toBadRequest(error, "outfits");
	}
	const view: StoryCharacterOutfitsView = {
		storyId,
		outfits: options.store.listCharacterOutfits(storyId),
	};
	sendJson(res, 200, view);
}

export function handleStoryImageTags(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: StoryTagLibraryView = {
		storyId,
		entries: options.store.listTagLibraryEntries(storyId),
	};
	sendJson(res, 200, view);
}

/** `PUT /api/stories/:id/image-tags`：整体保存故事标签库，支持开关与删除。 */
export async function handleStoryImageTagsSave(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["entries"]);
	if (!Array.isArray(body.entries)) {
		throw fieldError("entries", "entries 必须是数组");
	}
	try {
		options.store.replaceTagLibraryEntries({
			storyId,
			entries: body.entries as readonly TagLibraryEntryInput[],
		});
	} catch (error) {
		throw toBadRequest(error, "entries");
	}
	const view: StoryTagLibraryView = {
		storyId,
		entries: options.store.listTagLibraryEntries(storyId),
	};
	sendJson(res, 200, view);
}

/** `GET /api/stories/:id/image-organizer/entries`：画面整理专用的写作条目。 */
export function handleStoryImageOrganizerEntries(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: StoryImageOrganizerEntriesView = {
		storyId,
		entries: readWritingEntries(options.store, storyId).filter(
			(entry) => entry.scope === "image_organizer",
		),
	};
	sendJson(res, 200, view);
}

/** `POST /api/stories/:id/images/import-st`：角色 / 服装库或生图预设。 */
export async function handleStoryImageImport(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["kind", "data"]);
	if (body.kind !== "characters" && body.kind !== "preset") {
		throw fieldError("kind", "kind 只能是 characters 或 preset");
	}
	if (!Object.hasOwn(body, "data")) {
		throw fieldError("data", "data 必须提供");
	}
	let result: StoryImageImportResult;
	try {
		if (body.kind === "characters") {
			const imported = importImageCharacterLibrary(
				options.store,
				storyId,
				body.data,
			);
			result = {
				storyId,
				profiles: imported.profiles,
				outfits: imported.outfits,
				tagEntries: 0,
				writingEntries: 0,
			};
		} else {
			const imported = importImagePromptPreset(
				options.store,
				storyId,
				body.data,
			);
			result = {
				storyId,
				profiles: 0,
				outfits: 0,
				tagEntries: imported.tagEntries,
				writingEntries: imported.writingEntries,
			};
		}
	} catch (error) {
		throw toBadRequest(error, "data");
	}
	sendJson(res, 200, result);
}

export async function handleImageWorkflowDetect(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["workflow"]);
	if (!Object.hasOwn(body, "workflow")) {
		throw fieldError("workflow", "workflow 必须提供");
	}
	let workflow: ComfyUiWorkflow;
	try {
		workflow = parseComfyUiWorkflow(body.workflow, "workflow");
	} catch (error) {
		throw toBadRequest(error, "workflow");
	}
	try {
		const detection: ImageWorkflowDetectionView = detectComfyUiSlots(workflow);
		sendJson(res, 200, detection);
	} catch (error) {
		throw toBadRequest(error, "workflow");
	}
}

export async function handleImageWorkflowImport(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["name", "workflow", "slots"]);
	const name = requireText(body.name, "name");
	if (!Object.hasOwn(body, "workflow")) {
		throw fieldError("workflow", "workflow 必须提供");
	}
	if (!Object.hasOwn(body, "slots")) {
		throw fieldError("slots", "slots 必须提供");
	}
	let workflow: ComfyUiWorkflow;
	try {
		workflow = parseComfyUiWorkflow(body.workflow, "workflow");
	} catch (error) {
		throw toBadRequest(error, "workflow");
	}
	let slots: ComfyUiSlots;
	try {
		slots = assertComfyUiSlots(workflow, body.slots, "slots");
	} catch (error) {
		throw toBadRequest(error, "slots");
	}
	const config =
		options.imagesPath === null
			? emptyImagesConfig()
			: await loadImagesConfig(options.imagesPath, options.imagesEnv);
	let providerId: string;
	try {
		providerId = resolveImageProvider(config, undefined, "comfyui").id;
	} catch (error) {
		throw toBadRequest(error, "provider");
	}
	try {
		const saved = options.store.saveImageWorkflow({
			name,
			provider: providerId,
			payload: workflow,
			slots,
		});
		sendJson(res, 200, saved);
	} catch (error) {
		throw toBadRequest(error, "slots");
	}
}

/** `POST /api/images/workflows/novelai`：保存 NovelAI 出图模板（同名更新）。 */
export async function handleNovelAiTemplateSave(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["name", "parameters", "provider"]);
	const name = requireText(body.name, "name");
	if (body.provider !== undefined && typeof body.provider !== "string") {
		throw fieldError("provider", "provider 必须是字符串");
	}
	const config =
		options.imagesPath === null
			? emptyImagesConfig()
			: await loadImagesConfig(options.imagesPath, options.imagesEnv);
	try {
		const saved = saveNovelAiTemplate(options.store, config, {
			name,
			parameters: body.parameters,
			...(typeof body.provider === "string" ? { provider: body.provider } : {}),
		});
		sendJson(res, 200, saved);
	} catch (error) {
		throw toBadRequest(error, "parameters");
	}
}

export function handleImageWorkflowDelete(
	res: ServerResponse,
	options: ApiRouteOptions,
	workflowId: string,
): void {
	if (options.store.getImageWorkflow(workflowId) === null) {
		throw new HttpError(404, "not_found", `workflow 不存在：${workflowId}`);
	}
	try {
		options.store.deleteImageWorkflow(workflowId);
	} catch (error) {
		if (error instanceof ImageWorkflowInUseError) {
			throw new HttpError(409, "conflict", error.message, { workflowId });
		}
		throw error;
	}
	sendEmpty(res, 204);
}

export function handleImageRetry(
	res: ServerResponse,
	options: ApiRouteOptions,
	imageId: string,
): void {
	const image = options.store.getNodeImage(imageId);
	if (image === null) {
		throw new HttpError(404, "not_found", `图片记录不存在：${imageId}`);
	}
	if (image.status !== "failed") {
		throw new HttpError(
			409,
			"conflict",
			`图片记录 ${imageId} 的状态是 ${image.status}，只有 failed 可以重试`,
		);
	}
	const retried = options.store.retryNodeImage(imageId);
	enqueueIllustrateBackgroundJob(options.store, image.storyId);
	options.scheduler?.schedule(image.storyId);
	const view: NodeImageRecord = retried;
	sendJson(res, 200, view);
}

export async function handleNodeImages(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	if (node.role !== "assistant") {
		throw fieldError("nodeId", `楼层 ${nodeId} 不是助手楼层，不能登记插图`);
	}
	const pathIds = new Set(
		options.store.getPathToHead(node.storyId).map((item) => item.id),
	);
	if (!pathIds.has(nodeId)) {
		throw new HttpError(
			409,
			"conflict",
			`楼层 ${nodeId} 不在当前路径上，不能登记插图`,
		);
	}
	const settings = options.store.getStorySettings(node.storyId);
	if (settings.imageConfig.mode === "off") {
		throw new HttpError(409, "conflict", "生图模式已关闭");
	}
	const workflowId = settings.imageConfig.workflowId.trim();
	if (workflowId.length === 0) {
		throw new HttpError(409, "conflict", "故事没有选择生图 workflow");
	}
	const workflow = options.store.getImageWorkflow(workflowId);
	if (workflow === null) {
		throw new HttpError(409, "conflict", `图片 workflow 不存在：${workflowId}`);
	}
	if (!options.imagesConfig.providers.has(workflow.provider)) {
		throw new HttpError(
			409,
			"conflict",
			`生图 workflow 的 provider 没有配置：${workflow.provider}`,
		);
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	let request: ImagePromptRequest;
	try {
		request = validateImagePromptRequest(body);
	} catch (error) {
		throw toBadRequest(error, "request");
	}
	const image = options.store.insertNodeImage({
		storyId: node.storyId,
		nodeId,
		request,
		workflowId,
		seed: Math.floor(Math.random() * 2_147_483_648),
	});
	enqueueIllustrateBackgroundJob(options.store, node.storyId);
	options.scheduler?.schedule(node.storyId);
	const view: NodeImageRecord = image;
	sendJson(res, 201, view);
}

export function handleNodeImageList(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const view: NodeImagesView = {
		nodeId: node.id,
		images: options.store.listNodeImages(node.id).map(toNodeImage),
	};
	sendJson(res, 200, view);
}

/**
 * 媒体接口只返回已完成的图片，文件名来自数据库；解析后必须仍在
 * `imagesMediaDir` 里，软链接也要通过真实路径检查。
 */
export async function handleImageFile(
	res: ServerResponse,
	options: ApiRouteOptions,
	imageId: string,
): Promise<void> {
	const image = options.store.getNodeImage(imageId);
	if (
		image === null ||
		image.status !== "done" ||
		image.fileName === null ||
		image.mediaType === null ||
		IMAGE_MEDIA_TYPES[image.mediaType] !== true
	) {
		throw imageFileMissing();
	}
	const filePath = await resolveMediaFile(
		options.imagesMediaDir,
		image.fileName,
	);
	if (filePath === null) throw imageFileMissing();
	let bytes: Buffer;
	try {
		bytes = await readFile(filePath);
	} catch {
		throw imageFileMissing();
	}
	res.writeHead(200, {
		"Content-Type": image.mediaType,
		"Content-Length": bytes.length,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "private, max-age=31536000, immutable",
	});
	res.end(bytes);
}

export function imageFileMissing(): HttpError {
	return new HttpError(404, "not_found", "图片文件不存在");
}

/** 封面：有导入的卡面图时原样返回，否则按标题生成 2:3 占位图。 */
export async function handleStoryCover(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	const story = requireStory(options.store, storyId);
	const record = options.store.getStoryMedia(storyId, "cover", "cover");
	if (record !== null) {
		const media = await readStoryMediaFile(options.imagesMediaDir, record);
		if (media !== null) {
			res.writeHead(200, {
				"Content-Type": media.mediaType,
				"Content-Length": media.bytes.length,
				"X-Content-Type-Options": "nosniff",
				// 同一地址可能因为重新导入换成别的图，不能长期缓存。
				"Cache-Control": "private, no-cache",
			});
			res.end(media.bytes);
			return;
		}
	}
	const placeholder = Buffer.from(renderCoverPlaceholder(story.title), "utf8");
	res.writeHead(200, {
		"Content-Type": "image/svg+xml; charset=utf-8",
		"Content-Length": placeholder.length,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "private, no-cache",
	});
	res.end(placeholder);
}

/** 人物立绘；没有导入过这个人物时返回 404，前端不显示图片。 */
export async function handleStoryPortrait(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	name: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const record = options.store.getStoryMedia(storyId, "portrait", name);
	const media =
		record === null
			? null
			: await readStoryMediaFile(options.imagesMediaDir, record);
	if (media === null) {
		throw new HttpError(404, "not_found", "人物立绘不存在");
	}
	res.writeHead(200, {
		"Content-Type": media.mediaType,
		"Content-Length": media.bytes.length,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "private, no-cache",
	});
	res.end(media.bytes);
}

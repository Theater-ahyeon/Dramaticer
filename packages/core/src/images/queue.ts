import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
	BackgroundJob,
	BackgroundJobHandler,
} from "../background/types.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type ImageClientFactory,
	type ImageProviderClient,
	createDefaultImageClientFactory,
} from "./client.js";
import type { ImagesConfig } from "./config.js";
import { imageExtensionOf, readImageDimensions } from "./media.js";
import { type ImagePromptStyle, compileImagePrompt } from "./prompt.js";
import type { CharacterVisualProfile, NodeImageRecord } from "./types.js";

export const ILLUSTRATE_JOB_KIND = "illustrate";

/** 每次间隙最多处理两张；单张失败按行重试三次。 */
export const IMAGE_BATCH = 2;
export const IMAGE_MAX_ATTEMPTS = 3;

export interface IllustrateHandlerOptions {
	readonly config: ImagesConfig;
	/** 生成文件目录；默认是数据库文件同目录的 `images/`。 */
	readonly mediaDir: string;
	/** 测试注入假 provider；不设置时按 provider 配置创建 ComfyUI 客户端。 */
	readonly createClient?: ImageClientFactory;
	/** 第一批固定标签式。 */
	readonly style?: ImagePromptStyle;
}

/**
 * 故事级出图任务：按创建顺序取当前 head 路径上的待出图记录，编译提示词、
 * 调用图像后端、写文件并回填宽高。单行失败只影响该行。
 */
export function createIllustrateHandler(
	options: IllustrateHandlerOptions,
): BackgroundJobHandler {
	const createClient =
		options.createClient ?? createDefaultImageClientFactory();
	const clients = new Map<string, ImageProviderClient>();
	const clientFor = (providerId: string): ImageProviderClient => {
		const provider = options.config.providers.get(providerId);
		if (provider === undefined) {
			throw new Error(`图像 provider 没有配置：${providerId}`);
		}
		const cached = clients.get(providerId);
		if (cached !== undefined) return cached;
		const client = createClient(provider);
		clients.set(providerId, client);
		return client;
	};
	return async ({ store, job }) => {
		const activeNodeIds = new Set(
			store.getPathToHead(job.storyId).map((node) => node.id),
		);
		const pending = store
			.listPendingNodeImages(job.storyId)
			.filter((image) => activeNodeIds.has(image.nodeId))
			.slice(0, IMAGE_BATCH);
		if (pending.length === 0) return;
		const profiles = store
			.listCharacterVisualProfiles(job.storyId)
			.map((record) => record.profile);
		for (const image of pending) {
			await runOneImage({
				store,
				image,
				profiles,
				config: options.config,
				clientFor,
				mediaDir: options.mediaDir,
				style: options.style ?? "tags",
			});
		}
	};
}

async function runOneImage(input: {
	readonly store: StoryStore;
	readonly image: NodeImageRecord;
	readonly profiles: readonly CharacterVisualProfile[];
	readonly config: ImagesConfig;
	readonly clientFor: (providerId: string) => ImageProviderClient;
	readonly mediaDir: string;
	readonly style: ImagePromptStyle;
}): Promise<void> {
	const { store, image } = input;
	const workflow = store.getImageWorkflow(image.workflowId);
	if (workflow === null) {
		throw new Error(`图片 workflow 不存在：${image.workflowId}`);
	}
	const provider = workflow.provider;
	if (!input.config.providers.has(provider)) {
		throw new Error(`图像 provider 没有配置：${provider}`);
	}
	// 画面整理或重绘已经把最终提示词写进记录；重试时直接复用，不再重跑整理。
	const reusable = image.prompt !== null && image.organizerResult !== null;
	const compiled = reusable
		? {
				prompt: image.prompt as string,
				negativePrompt: image.negativePrompt ?? "",
			}
		: compileImagePrompt({
				profiles: input.profiles,
				state: store.getStateSnapshot(image.nodeId).state,
				request: image.request,
				style: input.style,
			});
	const running = store.startNodeImage(image.id, {
		prompt: compiled.prompt,
		negativePrompt: compiled.negativePrompt,
	});
	try {
		const generated = await input.clientFor(provider).generate({
			template: workflow,
			prompt: compiled.prompt,
			negativePrompt: compiled.negativePrompt,
			seed: running.seed ?? 0,
			width: null,
			height: null,
		});
		const extension = imageExtensionOf(generated.mediaType);
		const fileName = `${image.storyId}/${image.id}.${extension}`;
		const filePath = path.join(
			input.mediaDir,
			image.storyId,
			`${image.id}.${extension}`,
		);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, generated.bytes);
		const dimensions = readImageDimensions(
			generated.bytes,
			generated.mediaType,
		);
		store.finishNodeImage(image.id, {
			fileName,
			mediaType: generated.mediaType,
			width: dimensions.width,
			height: dimensions.height,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		store.failNodeImage(image.id, {
			error: message.length > 0 ? message : "出图失败",
			maxAttempts: IMAGE_MAX_ATTEMPTS,
		});
	}
}

/** 入队条件为 story：当前 head 路径上还有没到三次失败上限的待出图记录。 */
export function illustrateNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	const activeNodeIds = new Set(
		store.getPathToHead(storyId).map((node) => node.id),
	);
	if (activeNodeIds.size === 0) return false;
	return store
		.listPendingNodeImages(storyId)
		.some(
			(image) =>
				activeNodeIds.has(image.nodeId) && image.attempts < IMAGE_MAX_ATTEMPTS,
		);
}

/** 手动登记后确保故事级出图任务存在；不需要时返回空数组。 */
export function enqueueIllustrateBackgroundJob(
	store: StoryStore,
	storyId: string,
): BackgroundJob[] {
	if (!illustrateNeedsRun(store, storyId)) return [];
	return store.enqueueStoryBackgroundJobs({
		storyId,
		kinds: [ILLUSTRATE_JOB_KIND],
	});
}

import { createComfyUiClient } from "./comfyui.js";
import type { ComfyUiClientOptions, ComfyUiFetch } from "./comfyui.js";
import type { ImageProviderConfig } from "./config.js";
import { createNovelAiClient } from "./novelai.js";
import type { ImageWorkflowRecord } from "./types.js";

/** 一次出图的输入：模板决定后端与参数，其余由出图任务按楼层填入。 */
export interface ImageGenerateInput {
	readonly template: ImageWorkflowRecord;
	readonly prompt: string;
	readonly negativePrompt: string | null;
	readonly seed: number;
	readonly width: number | null;
	readonly height: number | null;
}

export interface ImageGenerated {
	readonly promptId: string;
	readonly fileName: string;
	readonly mediaType: string;
	readonly bytes: Uint8Array;
}

/** 图像后端统一的生成入口。 */
export interface ImageProviderClient {
	generate(input: ImageGenerateInput): Promise<ImageGenerated>;
}

/** 由 provider 配置创建客户端；测试注入假实现，零网络。 */
export type ImageClientFactory = (
	provider: ImageProviderConfig,
) => ImageProviderClient;

export interface DefaultImageClientOptions {
	readonly fetch?: ComfyUiFetch;
	readonly sleep?: ComfyUiClientOptions["sleep"];
	readonly now?: () => number;
}

/** 生产环境按 provider 的 api 创建客户端；模板与后端不一致时直接报错。 */
export function createDefaultImageClientFactory(
	options: DefaultImageClientOptions = {},
): ImageClientFactory {
	const fetchImpl =
		options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
	return (provider) => {
		if (provider.api === "novelai") {
			const client = createNovelAiClient(provider, { fetch: fetchImpl });
			return {
				generate(input) {
					if (input.template.kind !== "novelai") {
						throw new Error(
							`模板 ${input.template.name} 是 ${input.template.kind}，不能用 NovelAI 后端 ${provider.id}`,
						);
					}
					return client.generate({
						parameters: input.template.payload,
						prompt: input.prompt,
						negativePrompt: input.negativePrompt,
						seed: input.seed,
					});
				},
			};
		}
		return {
			generate(input) {
				// ComfyUI 客户端在创建时计算总时长的截止点，所以每张图新建一个。
				const client = createComfyUiClient(provider, {
					fetch: fetchImpl,
					...(options.sleep === undefined ? {} : { sleep: options.sleep }),
					...(options.now === undefined ? {} : { now: options.now }),
				});
				if (input.template.kind !== "comfyui") {
					throw new Error(
						`模板 ${input.template.name} 是 ${input.template.kind}，不能用 ComfyUI 后端 ${provider.id}`,
					);
				}
				return client.generate({
					workflow: input.template.payload,
					slots: input.template.slots,
					prompt: input.prompt,
					negativePrompt: input.negativePrompt,
					seed: input.seed,
					width: input.width,
					height: input.height,
				});
			},
		};
	};
}

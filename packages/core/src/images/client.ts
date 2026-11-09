import {
	type ComfyUiClientOptions,
	type ComfyUiFetch,
	type ComfyUiGenerateInput,
	type ComfyUiGeneratedImage,
	createComfyUiClient,
} from "./comfyui.js";
import type { ComfyUiProviderConfig } from "./config.js";

/** 图像后端统一的生成入口；第二批按 provider 增加实现。 */
export interface ImageProviderClient {
	generate(input: ComfyUiGenerateInput): Promise<ComfyUiGeneratedImage>;
}

/** 由 provider 配置创建客户端；测试注入假实现，零网络。 */
export type ImageClientFactory = (
	provider: ComfyUiProviderConfig,
) => ImageProviderClient;

export interface DefaultImageClientOptions {
	readonly fetch?: ComfyUiFetch;
	readonly sleep?: ComfyUiClientOptions["sleep"];
	readonly now?: () => number;
}

/** 生产环境按 provider 的 api 创建客户端；第一批只有 ComfyUI。 */
export function createDefaultImageClientFactory(
	options: DefaultImageClientOptions = {},
): ImageClientFactory {
	const fetchImpl =
		options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
	return (provider) =>
		createComfyUiClient(provider, {
			fetch: fetchImpl,
			...(options.sleep === undefined ? {} : { sleep: options.sleep }),
			...(options.now === undefined ? {} : { now: options.now }),
		});
}

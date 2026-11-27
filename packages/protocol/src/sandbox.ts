import type {
	FloorBridgeCapability,
	SandboxRejectionKind,
} from "@dramaticer/core";

/** 楼层渲染失败的渲染器；其余渲染器继续尝试，正文照常兜底显示。 */
export interface FloorRenderFailureView {
	readonly renderer: string;
	readonly error: string;
}

/** 一个楼层的渲染结果；`renderer` 为空表示没有渲染器认领。 */
export interface FloorRenderView {
	readonly nodeId: string;
	readonly renderer: string | null;
	readonly name: string | null;
	readonly html: string | null;
	readonly script: string | null;
	readonly style: string | null;
	readonly permissions: readonly FloorBridgeCapability[];
	readonly failures: readonly FloorRenderFailureView[];
}

export interface StoryRenderRequest {
	/** 只渲染路径上已有的助手楼层；顺序与结果一致。 */
	readonly nodeIds: readonly string[];
}

export interface StoryRenderView {
	readonly storyId: string;
	readonly floors: readonly FloorRenderView[];
}

/** 故事上安装的楼层渲染器；权限在设置页与检视器里展示。 */
export interface StoryFloorRendererView {
	readonly id: string;
	readonly plugin: string;
	readonly name: string;
	readonly permissions: readonly FloorBridgeCapability[];
}

/** 设置页的沙箱区块：允许的域名、脚本里检测到的域名与渲染器。 */
export interface StorySandboxView {
	readonly storyId: string;
	readonly allowedDomains: readonly string[];
	readonly detectedDomains: readonly string[];
	readonly renderers: readonly StoryFloorRendererView[];
}

export interface SandboxDomainUpdateRequest {
	readonly domain: string;
	readonly allowed: boolean;
}

export interface SandboxRejectionView {
	readonly id: number;
	readonly nodeId: string | null;
	readonly renderer: string;
	readonly kind: SandboxRejectionKind;
	/** 被拒绝的方法名或请求地址。 */
	readonly target: string;
	readonly reason: string;
	readonly createdAt: string;
}

export interface SandboxRejectionsView {
	readonly storyId: string;
	readonly rejections: readonly SandboxRejectionView[];
}

/** 沙箱把越权调用与被拦截的联网请求报给父页面，父页面再记到这里。 */
export interface RecordSandboxRejectionRequest {
	readonly nodeId?: string | null;
	readonly renderer: string;
	readonly kind: SandboxRejectionKind;
	readonly target: string;
	readonly reason: string;
}

export interface SandboxStateQueryView {
	readonly nodeId: string;
	readonly path: readonly string[];
	readonly value: unknown;
}

export interface SandboxStateWrite {
	readonly path: readonly string[];
	readonly op: "set" | "delete";
	readonly value?: unknown;
}

export interface SandboxStateWriteRequest {
	readonly renderer: string;
	readonly nodeId: string;
	readonly write: SandboxStateWrite;
}

export interface SandboxStateWriteResult {
	readonly storyId: string;
	readonly nodeId: string;
	readonly written: number;
}

export interface InstallFloorRendererRequest {
	readonly plugin: unknown;
}

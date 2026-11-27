import type { StoryStore } from "../store/story-store.js";

/** 沙箱拒绝记录的两类来源：交互桥越权，以及被拦截的联网请求。 */
export const SANDBOX_REJECTION_KINDS = ["bridge", "network"] as const;

export type SandboxRejectionKind = (typeof SANDBOX_REJECTION_KINDS)[number];

export function isSandboxRejectionKind(
	value: unknown,
): value is SandboxRejectionKind {
	return (
		typeof value === "string" &&
		(SANDBOX_REJECTION_KINDS as readonly string[]).includes(value)
	);
}

export interface SandboxRejection {
	readonly id: number;
	readonly storyId: string;
	readonly nodeId: string | null;
	/** 发起调用的渲染器 id。 */
	readonly renderer: string;
	readonly kind: SandboxRejectionKind;
	/** 被拒绝的方法名，或请求的地址。 */
	readonly target: string;
	readonly reason: string;
	readonly createdAt: string;
}

export interface RecordSandboxRejectionInput {
	readonly storyId: string;
	readonly nodeId: string | null;
	readonly renderer: string;
	readonly kind: SandboxRejectionKind;
	readonly target: string;
	readonly reason: string;
}

export function recordSandboxRejection(
	store: StoryStore,
	input: RecordSandboxRejectionInput,
): SandboxRejection {
	return store.recordSandboxRejection(input);
}

export function listSandboxRejections(
	store: StoryStore,
	storyId: string,
	limit = 50,
): readonly SandboxRejection[] {
	return store.listSandboxRejections(storyId, limit);
}

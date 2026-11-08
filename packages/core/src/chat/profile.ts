/**
 * 对话档位按轮次指定：`native` 使用台账、记忆、lore、摘要、现场分析与导演；
 * `naive` 是 B0 基线，只提供角色、persona、最近若干楼原文与写作契约。
 * 档位由调用方决定，程序不根据运行状况自动切换。
 */
export type ChatProfile = "native" | "naive";

export const CHAT_PROFILES: readonly ChatProfile[] = ["native", "naive"];

export const DEFAULT_CHAT_PROFILE: ChatProfile = "native";

export function isChatProfile(value: unknown): value is ChatProfile {
	return value === "native" || value === "naive";
}

export function assertChatProfile(
	value: unknown,
	label = "对话档位",
): asserts value is ChatProfile {
	if (!isChatProfile(value)) {
		throw new Error(`${label} 只接受 native 或 naive，收到 ${String(value)}`);
	}
}

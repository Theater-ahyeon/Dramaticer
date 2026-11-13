import {
	type ContextMessage,
	type ContextSegment,
	type ContextSlotProvider,
	type ContextTemplate,
	type LlmRole,
	assembleContext,
} from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import type {
	StPreset,
	StPresetPrompt,
	StPromptOrderGroup,
} from "../preset.js";
import type { BenchmarkSampling } from "./compare.js";

/** 忠实模式的输入：同一份预设、角色卡、聊天片段与人设。 */
export interface FaithfulAssemblyInput {
	readonly preset: StPreset;
	readonly character: StCharacterCard;
	readonly chat: readonly FaithfulChatMessage[];
	readonly persona?: string | null;
	readonly userName?: string | null;
}

export interface FaithfulChatMessage {
	readonly role: LlmRole;
	readonly content: string;
	readonly name?: string | null;
	/** 酒馆据此决定是否给消息加说话人名前缀。 */
	readonly forceAvatar?: boolean;
}

/** 忠实模式无法表达的功能；detail 只写标识，不写提示词正文。 */
export interface FaithfulUnsupportedFeature {
	readonly feature: string;
	readonly detail: string;
}

export interface FaithfulRequest {
	readonly messages: readonly ContextMessage[];
	readonly sampling: BenchmarkSampling;
}

export interface FaithfulAssembly {
	readonly request: FaithfulRequest;
	readonly unsupported: readonly FaithfulUnsupportedFeature[];
}

/** 忠实模式的模板 id；只包含从 ST 输入映射来的段落。 */
export const FAITHFUL_TEMPLATE_ID = "st-faithful";

const FAITHFUL_BUDGET_TOKENS = 10_000_000;

const MARKER_FIELDS: Readonly<Record<string, keyof StCharacterCard>> = {
	charDescription: "description",
	charPersonality: "personality",
	scenario: "scenario",
};

const SUPPORTED_ROLES: Readonly<Record<string, LlmRole>> = {
	system: "system",
	user: "user",
	assistant: "assistant",
	model: "assistant",
};

const MACRO_PATTERN = /\{\{([^{}]+)\}\}/g;

interface OrderedPrompt {
	readonly entry: { readonly identifier: string; readonly enabled: boolean };
	readonly prompt: StPresetPrompt;
}

interface DepthInjection {
	readonly role: LlmRole;
	readonly content: string;
	readonly depth: number;
}

/**
 * 用同一份 ST 输入组装 Dramaticer 的忠实请求：
 * 关闭记忆、台账、导演、写作契约等原生功能，只保留预设条目、角色卡字段与聊天历史。
 * 无法表达的功能逐条返回 feature 与标识，由比对报告计数。
 */
export async function assembleFaithfulRequest(
	input: FaithfulAssemblyInput,
): Promise<FaithfulAssembly> {
	const unsupported: FaithfulUnsupportedFeature[] = [];
	const charName = input.character.name;
	const userName = input.userName ?? "User";
	const persona = input.persona ?? null;

	if (input.preset.regexScripts.length > 0) {
		unsupported.push({
			feature: "regex-scripts",
			detail: `${input.preset.regexScripts.length} 条`,
		});
	}
	if (input.preset.raw.squash_system_messages === true) {
		unsupported.push({ feature: "squash-system-messages", detail: "preset" });
	}
	collectUnsupportedSampling(input.preset, unsupported);
	if (input.character.systemPrompt.trim().length > 0) {
		unsupported.push({
			feature: "character-system-prompt",
			detail: `${input.character.systemPrompt.length} 字符`,
		});
	}
	if (input.character.postHistoryInstructions.trim().length > 0) {
		unsupported.push({
			feature: "character-post-history",
			detail: `${input.character.postHistoryInstructions.length} 字符`,
		});
	}
	if (input.character.characterBook !== null) {
		unsupported.push({ feature: "character-lorebook", detail: "present" });
	}

	const ordered = resolvePromptOrder(input.preset, unsupported);
	const injections: DepthInjection[] = [];
	type PreparedEntry =
		| {
				readonly kind: "static";
				readonly id: string;
				readonly text: string;
				readonly role: LlmRole;
		  }
		| { readonly kind: "history"; readonly id: string };
	const prepared: PreparedEntry[] = [];
	let hasHistory = false;

	for (const [index, orderedPrompt] of ordered.entries()) {
		const prompt = orderedPrompt.prompt;
		const segmentId = `${index}:${orderedPrompt.entry.identifier}`;
		if (!orderedPrompt.entry.enabled) continue;
		if (prompt.injectionTrigger !== null) {
			unsupported.push({
				feature: "injection-trigger",
				detail: prompt.identifier,
			});
			continue;
		}
		if (
			prompt.attachIndex !== null ||
			prompt.attachRole !== null ||
			prompt.attachSide !== null
		) {
			unsupported.push({
				feature: "attached-prompt",
				detail: prompt.identifier,
			});
			continue;
		}
		if (prompt.extra !== null && Object.keys(prompt.extra).length > 0) {
			unsupported.push({
				feature: "prompt-extra",
				detail: prompt.identifier,
			});
			continue;
		}
		const role = resolveRole(prompt, unsupported);
		if (role === null) continue;

		// 1 是绝对位置（按深度插进聊天历史），0 是普通相对位置。
		if (prompt.injectionPosition === 1) {
			if (prompt.injectionDepth === null || prompt.injectionDepth < 0) {
				unsupported.push({
					feature: "injection-depth",
					detail: prompt.identifier,
				});
				continue;
			}
			if (prompt.marker) {
				unsupported.push({
					feature: "marker-injection",
					detail: prompt.identifier,
				});
				continue;
			}
			const text = expandNames(prompt.content, charName, userName);
			if (text === null) {
				unsupported.push({
					feature: "macro",
					detail: prompt.identifier,
				});
				continue;
			}
			if (text.trim().length === 0) continue;
			injections.push({
				role,
				content: text,
				depth: prompt.injectionDepth,
			});
			continue;
		}
		if (prompt.injectionPosition !== null && prompt.injectionPosition !== 0) {
			unsupported.push({
				feature: "injection-position",
				detail: `${prompt.identifier}:${prompt.injectionPosition}`,
			});
			continue;
		}

		if (prompt.marker) {
			if (prompt.identifier === "chatHistory") {
				hasHistory = true;
				prepared.push({ kind: "history", id: segmentId });
				continue;
			}
			if (
				prompt.identifier === "worldInfoBefore" ||
				prompt.identifier === "worldInfoAfter"
			) {
				unsupported.push({
					feature: "world-info",
					detail: prompt.identifier,
				});
				continue;
			}
			if (prompt.identifier === "dialogueExamples") {
				if (input.character.messageExample.trim().length > 0) {
					unsupported.push({
						feature: "dialogue-examples",
						detail: "present",
					});
				}
				continue;
			}
			if (prompt.identifier === "personaDescription") {
				if (persona === null || persona.trim().length === 0) continue;
				const text = expandNames(persona, charName, userName);
				if (text === null) {
					unsupported.push({
						feature: "macro",
						detail: prompt.identifier,
					});
					continue;
				}
				prepared.push({
					kind: "static",
					id: segmentId,
					text,
					role: "system",
				});
				continue;
			}
			const field = MARKER_FIELDS[prompt.identifier];
			if (field === undefined) {
				unsupported.push({
					feature: "marker",
					detail: prompt.identifier,
				});
				continue;
			}
			const value = input.character[field];
			if (typeof value !== "string" || value.trim().length === 0) continue;
			const text = expandNames(value, charName, userName);
			if (text === null) {
				unsupported.push({
					feature: "macro",
					detail: prompt.identifier,
				});
				continue;
			}
			prepared.push({
				kind: "static",
				id: segmentId,
				text,
				role: "system",
			});
			continue;
		}

		const text = expandNames(prompt.content, charName, userName);
		if (text === null) {
			unsupported.push({
				feature: "macro",
				detail: prompt.identifier,
			});
			continue;
		}
		if (text.trim().length === 0) continue;
		prepared.push({ kind: "static", id: segmentId, text, role });
	}

	if (!hasHistory && injections.length > 0) {
		for (const injection of injections) {
			unsupported.push({
				feature: "depth-injection-without-history",
				detail: `${injection.role}:${injection.depth}`,
			});
		}
	}

	const segments: ContextSegment[] = prepared.map((entry) =>
		entry.kind === "history"
			? { id: entry.id, kind: "slot", slot: "history", priority: 100 }
			: staticSegment(entry.id, entry.text, entry.role),
	);
	let newChatPrompt: string | null = null;
	if (hasHistory) {
		const newChatText = expandNames(
			readNewChatPrompt(input.preset),
			charName,
			userName,
		);
		if (newChatText === null) {
			unsupported.push({ feature: "macro", detail: "new_chat_prompt" });
		} else if (newChatText.trim().length > 0) {
			newChatPrompt = newChatText;
		}
	}
	const historyProvider = hasHistory
		? createHistoryProvider(
				input.chat,
				injections,
				newChatPrompt,
				readNamesBehavior(input.preset),
				userName,
			)
		: null;

	const prefill = input.preset.assistantPrefill ?? "";
	if (prefill.trim().length > 0) {
		const text = expandNames(prefill, charName, userName);
		if (text === null) {
			unsupported.push({ feature: "macro", detail: "assistant_prefill" });
		} else {
			segments.push(staticSegment("assistant_prefill", text, "assistant", 120));
		}
	}

	const template: ContextTemplate = {
		id: FAITHFUL_TEMPLATE_ID,
		segments,
	};
	const assembled = await assembleContext({
		template,
		budgetTokens: FAITHFUL_BUDGET_TOKENS,
		storyId: "st-bench-faithful",
		providers: historyProvider === null ? {} : { history: historyProvider },
	});

	return {
		request: {
			messages: assembled.messages,
			sampling: {
				temperature: input.preset.temperature,
				topP: input.preset.topP,
				maxTokens: input.preset.maxTokens,
				frequencyPenalty: input.preset.frequencyPenalty,
				presencePenalty: input.preset.presencePenalty,
			},
		},
		unsupported,
	};
}

/**
 * ST 的 OpenAI 连接使用固定的全局顺序组 100001；100000 是默认预设管理器的
 * 全局组，只在预设没有 100001 时回退。
 */
export function selectPromptOrderGroup(
	preset: StPreset,
): StPromptOrderGroup | undefined {
	return (
		preset.promptOrder.find((group) => group.characterId === 100001) ??
		preset.promptOrder.find(
			(group) => group.characterId === null || group.characterId === 100000,
		) ??
		preset.promptOrder[0]
	);
}

/** 全局顺序组优先；没有显式顺序时按 prompts 数组顺序并沿用各自的启用状态。 */
function resolvePromptOrder(
	preset: StPreset,
	unsupported: FaithfulUnsupportedFeature[],
): readonly OrderedPrompt[] {
	const global = selectPromptOrderGroup(preset);
	const byIdentifier = new Map<string, StPresetPrompt>();
	for (const prompt of preset.prompts) {
		if (!byIdentifier.has(prompt.identifier)) {
			byIdentifier.set(prompt.identifier, prompt);
		}
	}
	const entries =
		global === undefined
			? preset.prompts.map((prompt) => ({
					identifier: prompt.identifier,
					enabled: prompt.enabled,
				}))
			: global.order;
	const ordered: OrderedPrompt[] = [];
	for (const entry of entries) {
		const prompt = byIdentifier.get(entry.identifier);
		if (prompt === undefined) {
			unsupported.push({
				feature: "missing-prompt",
				detail: entry.identifier,
			});
			continue;
		}
		ordered.push({ entry, prompt });
	}
	return ordered;
}

/** 未知标识或未知角色不猜测，直接记入不支持并跳过该条目。 */
function resolveRole(
	prompt: StPresetPrompt,
	unsupported: FaithfulUnsupportedFeature[],
): LlmRole | null {
	const role = prompt.role ?? "system";
	const resolved = SUPPORTED_ROLES[role];
	if (resolved === undefined) {
		unsupported.push({
			feature: "role",
			detail: `${prompt.identifier}:${role}`,
		});
		return null;
	}
	return resolved;
}

/** ST 的 names_behavior：-1 不加名字，0 仅强制头像的消息，2 全部非旁白消息。 */
function readNamesBehavior(preset: StPreset): number {
	const value = preset.raw.names_behavior;
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatHistoryContent(
	message: FaithfulChatMessage,
	namesBehavior: number,
	userName: string,
): string {
	const content = message.content.replace(/\r/gm, "");
	const name = message.name ?? "";
	const forceAvatar = message.forceAvatar === true;
	const prefixed =
		name !== "" &&
		(namesBehavior === 2 ||
			(namesBehavior === 0 && forceAvatar && name !== userName));
	return prefixed ? `${name}: ${content}` : content;
}

/** 预设没有保存 `new_chat_prompt` 时使用 ST 的默认文本。 */
function readNewChatPrompt(preset: StPreset): string {
	const value = preset.raw.new_chat_prompt;
	return typeof value === "string" ? value : "[Start a new Chat]";
}

/** 只替换角色名与玩家名；其余宏一律记为不支持，避免拿半成品去比较。 */
function expandNames(
	text: string,
	charName: string,
	userName: string,
): string | null {
	let unknown: string | null = null;
	const expanded = text.replace(MACRO_PATTERN, (_match, rawName: string) => {
		const name = rawName.trim();
		if (name === "char") return charName;
		if (name === "user") return userName;
		unknown ??= name;
		return "";
	});
	return unknown === null ? expanded : null;
}

function staticSegment(
	id: string,
	text: string,
	role: LlmRole,
	priority = 10,
): ContextSegment {
	return { id, kind: "static", text, role, priority };
}

/**
 * 历史槽位输出聊天原文，并按 ST 的深度注入语义插入预设条目：
 * depth 0 表示放在最后一条消息之后，depth n 表示放在倒数第 n 条之前。
 */
function createHistoryProvider(
	chat: readonly FaithfulChatMessage[],
	injections: readonly DepthInjection[],
	newChatPrompt: string | null,
	namesBehavior: number,
	userName: string,
): ContextSlotProvider {
	const messages: ContextMessage[] = [
		...(newChatPrompt === null
			? []
			: [{ role: "system" as const, content: newChatPrompt }]),
		...chat.flatMap((message) => {
			const content = formatHistoryContent(message, namesBehavior, userName);
			return content.trim().length === 0
				? []
				: [{ role: message.role, content }];
		}),
	];
	for (const injection of injections) {
		const index = Math.max(0, messages.length - injection.depth);
		messages.splice(index, 0, {
			role: injection.role,
			content: injection.content,
		});
	}
	return {
		packKey: `faithful-history:${messages.length}`,
		provide() {
			if (messages.length === 0) return null;
			return {
				messages,
				source: `faithful:history ${messages.length} 条`,
			};
		},
	};
}

function collectUnsupportedSampling(
	preset: StPreset,
	unsupported: FaithfulUnsupportedFeature[],
): void {
	const fields: readonly (readonly [string, number | string | null])[] = [
		["top_k", preset.topK],
		["top_a", preset.topA],
		["min_p", preset.minP],
		["repetition_penalty", preset.repetitionPenalty],
		["seed", preset.seed],
		["n", preset.n],
		["reasoning_effort", preset.reasoningEffort],
		["assistant_impersonation", preset.assistantImpersonation],
	];
	for (const [name, value] of fields) {
		if (value === null) continue;
		unsupported.push({ feature: `sampling:${name}`, detail: String(value) });
	}
}

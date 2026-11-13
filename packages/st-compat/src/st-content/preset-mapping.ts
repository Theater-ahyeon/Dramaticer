import { createHash } from "node:crypto";
import {
	type ContextMessage,
	type ContextSegment,
	type ContextSlotProvider,
	type ContextTemplate,
	type LlmReasoningLevel,
	type LlmRole,
	type StructuredOutputMode,
	WRITING_CONTRACT_SEGMENT_ID,
	assertContextTemplate,
	createDefaultContextTemplate,
	isLlmReasoningLevel,
} from "@dramaticer/core";
import type { StCharacterCard } from "../character-card.js";
import { optionalString, readBoolean } from "../field-readers.js";
import {
	type StPreset,
	type StPresetPrompt,
	selectStPromptOrderGroup,
} from "../preset.js";
import type { StAuthorNote, StAuthorNotePlacement } from "./author-note.js";
import { mapCharacterCard } from "./card.js";
import {
	type StPersona,
	type StPersonaMapping,
	type StPersonaPlacement,
	mapStPersona,
} from "./persona.js";

/** 预设映射出来的模板 id；C-T02.f 的共存适配器按这个 id 识别。 */
export const ST_CONTENT_TEMPLATE_ID = "st-content-preset";

const DEFAULT_INJECTION_ORDER = 100;
const DEPTH_INJECTION_POSITION = 1;
const RELATIVE_INJECTION_POSITION = 0;
const SUPPORTED_ROLES: Readonly<Record<string, LlmRole>> = {
	system: "system",
	user: "user",
	assistant: "assistant",
	model: "assistant",
};
const INJECTION_ROLES: readonly LlmRole[] = ["system", "user", "assistant"];
const MACRO_PATTERN = /\{\{[^{}]*\}\}/;

export interface StPresetMappingIssue {
	readonly code: string;
	readonly detail: string;
}

export interface StPresetEntryMapping {
	readonly identifier: string;
	readonly enabled: boolean;
	readonly kind: "static" | "slot" | "injection" | "skipped" | "unmapped";
	readonly segmentId: string | null;
	readonly role: LlmRole | null;
	readonly chars: number;
	/** 跳过或无法映射的原因代码；成功映射时为 null。 */
	readonly reason: string | null;
}

/**
 * 一条按深度注入的消息。`source` 为 `extension` 的条目对应酒馆的扩展提示词，
 * 与同一顺序组、同一角色的预设条目拼接后一起插入。
 */
export interface StDepthInjection {
	readonly identifier: string;
	readonly role: LlmRole;
	readonly content: string;
	readonly depth: number;
	readonly order: number;
	readonly source: "preset" | "extension";
}

export interface StPresetSamplingMapping {
	readonly temperature: number | null;
	readonly maxTokens: number | null;
	readonly reasoning: LlmReasoningLevel | null;
	/** 原生请求与故事设置表达不了的采样字段。 */
	readonly unsupported: readonly string[];
}

export interface StPresetPrefillMapping {
	readonly assistantPrefill: string | null;
	readonly continuePrefill: boolean;
	readonly continuePostfix: string | null;
	readonly squashedSystemMessages: boolean;
}

export interface StPresetFormatMapping {
	readonly scenario: string | null;
	readonly personality: string | null;
	readonly worldInfo: string | null;
}

export interface StPresetMappingInput {
	readonly preset: StPreset;
	readonly card: StCharacterCard;
	readonly structuredOutput: StructuredOutputMode;
	readonly persona?: StPersona | null;
	readonly authorNote?: StAuthorNote | null;
	/** 玩家楼层数；作者注释按间隔注入时需要它判定本轮是否到期。 */
	readonly playerMessageCount?: number;
	readonly templateId?: string;
}

export interface StPresetMapping {
	readonly template: ContextTemplate;
	readonly entries: readonly StPresetEntryMapping[];
	readonly injections: readonly StDepthInjection[];
	readonly sampling: StPresetSamplingMapping;
	readonly prefill: StPresetPrefillMapping;
	readonly formats: StPresetFormatMapping;
	readonly authorNote: {
		readonly placement: StAuthorNotePlacement;
		readonly injected: boolean;
	} | null;
	readonly issues: readonly StPresetMappingIssue[];
}

interface OrderedPrompt {
	readonly entry: { readonly identifier: string; readonly enabled: boolean };
	readonly prompt: StPresetPrompt;
}

interface PreparedMarkerText {
	readonly text: string;
	readonly marker: string;
}

/**
 * 把预设、角色卡、人设与作者注释映射成原生模板、槽位与深度注入。
 * 模板按 `prompt_order` 排列，写作契约固定为最后一段；无法表达的内容逐条写入 issues，
 * 报告里只有标识、角色、字符数与原因，不含任何提示词正文。
 */
export function mapStPreset(input: StPresetMappingInput): StPresetMapping {
	const cardMapping = mapCharacterCard(input.card);
	const sectionText = new Map(
		cardMapping.sections.map((section) => [section.marker, section.text]),
	);
	const formats = readFormats(input.preset);
	const personaMapping =
		input.persona === undefined || input.persona === null
			? null
			: mapStPersona(input.persona);
	const issues: StPresetMappingIssue[] = [];
	const entries: StPresetEntryMapping[] = [];
	const injections: StDepthInjection[] = [];
	const segments: ContextSegment[] = [];
	let mainIndex: number | null = null;
	let loreUsed = false;
	let historyIndex: number | null = null;

	const ordered = resolveOrderedPrompts(input.preset, issues);
	for (const [index, orderedPrompt] of ordered.entries()) {
		const { entry, prompt } = orderedPrompt;
		const segmentId = `st:${index}:${entry.identifier}`;
		if (!entry.enabled) {
			entries.push(entryReport(entry, "skipped", null, null, 0, "disabled"));
			continue;
		}
		if (
			prompt.injectionTrigger !== null &&
			prompt.injectionTrigger.length > 0
		) {
			addUnmapped(entries, issues, entry, "injection-trigger");
			continue;
		}
		if (
			prompt.attachIndex !== null ||
			prompt.attachRole !== null ||
			prompt.attachSide !== null
		) {
			addUnmapped(entries, issues, entry, "attached-prompt");
			continue;
		}
		if (prompt.extra !== null && Object.keys(prompt.extra).length > 0) {
			addUnmapped(entries, issues, entry, "prompt-extra");
			continue;
		}
		const role = resolveRole(prompt);
		if (role === null) {
			addUnmapped(entries, issues, entry, "role", `${prompt.role ?? ""}`);
			continue;
		}
		const position = prompt.injectionPosition ?? RELATIVE_INJECTION_POSITION;
		if (
			position !== RELATIVE_INJECTION_POSITION &&
			position !== DEPTH_INJECTION_POSITION
		) {
			addUnmapped(entries, issues, entry, "injection-position", `${position}`);
			continue;
		}

		if (prompt.marker && entry.identifier === "chatHistory") {
			if (position === DEPTH_INJECTION_POSITION) {
				addUnmapped(entries, issues, entry, "marker-injection");
				continue;
			}
			if (historyIndex !== null) {
				addUnmapped(entries, issues, entry, "duplicate-history");
				continue;
			}
			historyIndex = segments.length;
			segments.push({
				id: segmentId,
				kind: "slot",
				slot: "history",
				priority: 100,
			});
			entries.push(entryReport(entry, "slot", segmentId, null, 0, null));
			continue;
		}
		if (
			prompt.marker &&
			(entry.identifier === "worldInfoBefore" ||
				entry.identifier === "worldInfoAfter")
		) {
			if (position === DEPTH_INJECTION_POSITION) {
				addUnmapped(entries, issues, entry, "marker-injection");
				continue;
			}
			if (loreUsed) {
				addUnmapped(
					entries,
					issues,
					entry,
					"world-info-after",
					entry.identifier,
				);
				continue;
			}
			loreUsed = true;
			segments.push({
				id: segmentId,
				kind: "slot",
				slot: "lore",
				priority: 80,
			});
			entries.push(entryReport(entry, "slot", segmentId, null, 0, null));
			continue;
		}

		const marker = prompt.marker
			? resolveMarkerText(entry.identifier, input, sectionText, personaMapping)
			: null;
		if (prompt.marker && marker === null) {
			addUnmapped(entries, issues, entry, "unknown-marker", entry.identifier);
			continue;
		}
		if (marker !== null && marker.marker === "personaDescription") {
			if (personaMapping === null) {
				entries.push(entryReport(entry, "skipped", null, null, 0, "empty"));
				continue;
			}
			if (
				personaMapping.placement === "author-note-top" ||
				personaMapping.placement === "author-note-bottom"
			) {
				addUnmapped(
					entries,
					issues,
					entry,
					`persona-${personaMapping.placement}`,
				);
				continue;
			}
			if (personaMapping.placement === "disabled") {
				entries.push(entryReport(entry, "skipped", null, null, 0, "disabled"));
				continue;
			}
			if (personaMapping.placement === "in-chat") {
				if (personaMapping.depth === null) {
					addUnmapped(entries, issues, entry, "persona-depth");
					continue;
				}
				const text = personaMapping.text.trim();
				if (text.length === 0) {
					entries.push(entryReport(entry, "skipped", null, null, 0, "empty"));
					continue;
				}
				recordMacroIssue(text, entry.identifier, issues);
				injections.push({
					identifier: entry.identifier,
					role: personaMapping.role,
					content: text,
					depth: personaMapping.depth,
					order: DEFAULT_INJECTION_ORDER,
					source: "extension",
				});
				entries.push(
					entryReport(
						entry,
						"injection",
						null,
						personaMapping.role,
						text.length,
						null,
					),
				);
				continue;
			}
		}

		const text = marker?.text ?? prompt.content;
		const effectiveText = applyPresetOverride(
			entry.identifier,
			prompt,
			text,
			input.card,
		);
		const trimmed = effectiveText.trim();
		if (trimmed.length === 0) {
			entries.push(entryReport(entry, "skipped", null, null, 0, "empty"));
			continue;
		}
		recordMacroIssue(effectiveText, entry.identifier, issues);
		if (position === DEPTH_INJECTION_POSITION) {
			const depth = prompt.injectionDepth;
			if (depth === null || !Number.isInteger(depth) || depth < 0) {
				addUnmapped(entries, issues, entry, "injection-depth");
				continue;
			}
			const order = readInjectionOrder(prompt, entry.identifier, issues);
			injections.push({
				identifier: entry.identifier,
				role,
				content: effectiveText,
				depth,
				order,
				source: "preset",
			});
			entries.push(
				entryReport(entry, "injection", null, role, effectiveText.length, null),
			);
			continue;
		}
		segments.push({
			id: segmentId,
			kind: "static",
			text: effectiveText,
			role,
			priority: 10,
		});
		if (entry.identifier === "main") mainIndex = segments.length - 1;
		entries.push(
			entryReport(entry, "static", segmentId, role, effectiveText.length, null),
		);
	}

	const authorNote = applyAuthorNote(
		input,
		segments,
		injections,
		issues,
		mainIndex,
	);

	if (injections.length > 0 && historyIndex === null) {
		for (const injection of injections) {
			issues.push({
				code: "injection-without-history",
				detail: `${injection.identifier}:${injection.role}:${injection.depth}`,
			});
		}
	}

	applyPrefillAndSquash(input.preset, issues);
	const protocol = nativeProtocolSegment(input.structuredOutput);
	segments.push(protocol);
	const template: ContextTemplate = {
		id: input.templateId ?? ST_CONTENT_TEMPLATE_ID,
		segments,
	};
	assertContextTemplate(template);

	return {
		template,
		entries,
		injections,
		sampling: mapSampling(input.preset, issues),
		prefill: readPrefill(input.preset),
		formats,
		authorNote,
		issues,
	};
}

/**
 * 把深度注入按酒馆的语义插进历史消息：深度 0 放在最后一条之后，
 * 深度 n 放在倒数第 n 条之前。同一深度内按 injection_order 升序，
 * 每个顺序组内按 assistant、user、system 排列，这是酒馆反转消息数组后的实际顺序。
 */
export function injectStDepthMessages(
	messages: readonly ContextMessage[],
	injections: readonly StDepthInjection[],
): ContextMessage[] {
	const result = messages.map((message) => ({ ...message }));
	const byDepth = new Map<number, StDepthInjection[]>();
	for (const injection of injections) {
		if (!Number.isInteger(injection.depth) || injection.depth < 0) {
			throw new Error(`深度注入的 depth 必须是非负整数：${injection.depth}`);
		}
		if (!Number.isFinite(injection.order)) {
			throw new Error(`深度注入的 order 必须是有限数字：${injection.order}`);
		}
		if (injection.content.trim().length === 0) continue;
		const list = byDepth.get(injection.depth) ?? [];
		list.push(injection);
		byDepth.set(injection.depth, list);
	}
	const baseLength = result.length;
	for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
		const block = buildInjectionBlock(byDepth.get(depth) ?? []);
		if (block.length === 0) continue;
		const index = Math.max(0, baseLength - depth);
		result.splice(index, 0, ...block);
	}
	return result;
}

/** 把深度注入叠到已有历史槽位上；没有注入时原样返回。 */
export function createStHistoryProvider(
	base: ContextSlotProvider,
	injections: readonly StDepthInjection[],
): ContextSlotProvider {
	if (injections.length === 0) return base;
	const fingerprint = createHash("sha256")
		.update(
			JSON.stringify(
				injections.map((injection) => [
					injection.identifier,
					injection.role,
					injection.depth,
					injection.order,
					injection.source,
					injection.content,
				]),
			),
		)
		.digest("hex")
		.slice(0, 16);
	return {
		packKey: `${base.packKey ?? "history"}:st-injections:${fingerprint}`,
		...(base.plugin === undefined ? {} : { plugin: base.plugin }),
		async provide(request) {
			const content = await base.provide(request);
			if (content === null) return null;
			return {
				...content,
				messages: injectStDepthMessages(content.messages, injections),
			};
		},
	};
}

function buildInjectionBlock(
	injections: readonly StDepthInjection[],
): ContextMessage[] {
	const byOrder = new Map<number, StDepthInjection[]>();
	for (const injection of injections) {
		const list = byOrder.get(injection.order) ?? [];
		list.push(injection);
		byOrder.set(injection.order, list);
	}
	const reversed: ContextMessage[] = [];
	for (const order of [...byOrder.keys()].sort((a, b) => b - a)) {
		const orderInjections = byOrder.get(order) ?? [];
		for (const role of INJECTION_ROLES) {
			const presetText = trimJoin(
				orderInjections
					.filter(
						(injection) =>
							injection.role === role && injection.source === "preset",
					)
					.map((injection) => injection.content),
			);
			const extensionText = trimJoin(
				orderInjections
					.filter(
						(injection) =>
							injection.role === role && injection.source === "extension",
					)
					.map((injection) => injection.content),
			);
			const content = [presetText, extensionText]
				.filter((text) => text.length > 0)
				.join("\n");
			if (content.length > 0) reversed.push({ role, content });
		}
	}
	return reversed.reverse();
}

function trimJoin(parts: readonly string[]): string {
	return parts
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join("\n");
}

function resolveOrderedPrompts(
	preset: StPreset,
	issues: StPresetMappingIssue[],
): readonly OrderedPrompt[] {
	const global = selectStPromptOrderGroup(preset);
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
			issues.push({ code: "missing-prompt", detail: entry.identifier });
			continue;
		}
		ordered.push({ entry, prompt });
	}
	return ordered;
}

function resolveRole(prompt: StPresetPrompt): LlmRole | null {
	const role = prompt.role ?? "system";
	return SUPPORTED_ROLES[role] ?? null;
}

function resolveMarkerText(
	identifier: string,
	input: StPresetMappingInput,
	sectionText: ReadonlyMap<string, string>,
	personaMapping: StPersonaMapping | null,
): PreparedMarkerText | null {
	if (identifier === "personaDescription") {
		return { text: personaMapping?.text ?? "", marker: identifier };
	}
	if (identifier === "scenario") {
		const text = sectionText.get("scenario") ?? "";
		return {
			text:
				text.trim().length === 0
					? ""
					: applyFormat(text, input.preset, "scenario"),
			marker: identifier,
		};
	}
	if (identifier === "charPersonality") {
		const text = sectionText.get("charPersonality") ?? "";
		return {
			text:
				text.trim().length === 0
					? ""
					: applyFormat(text, input.preset, "personality"),
			marker: identifier,
		};
	}
	if (identifier === "main" || identifier === "jailbreak") {
		return { text: sectionText.get(identifier) ?? "", marker: identifier };
	}
	const text = sectionText.get(identifier);
	if (identifier === "charDescription" || identifier === "dialogueExamples") {
		return { text: text ?? "", marker: identifier };
	}
	if (text === undefined) return null;
	return { text, marker: identifier };
}

function applyFormat(
	text: string,
	preset: StPreset,
	macroName: string,
): string {
	const format =
		macroName === "scenario"
			? optionalString(preset.raw, "scenario_format", "预设")
			: optionalString(preset.raw, "personality_format", "预设");
	if (format === null || format.length === 0) return text;
	const placeholder = `{{${macroName}}}`;
	return format.includes(placeholder)
		? format.replaceAll(placeholder, text)
		: format;
}

/** 角色卡的 `system_prompt` 与 `post_history_instructions` 覆盖同名预设条目。 */
function applyPresetOverride(
	identifier: string,
	prompt: StPresetPrompt,
	text: string,
	card: StCharacterCard,
): string {
	if (prompt.forbidOverrides) return text;
	if (identifier === "main" && card.systemPrompt.trim().length > 0) {
		return card.systemPrompt;
	}
	if (
		identifier === "jailbreak" &&
		card.postHistoryInstructions.trim().length > 0
	) {
		return card.postHistoryInstructions;
	}
	return text;
}

function readInjectionOrder(
	prompt: StPresetPrompt,
	identifier: string,
	issues: StPresetMappingIssue[],
): number {
	const order = prompt.injectionOrder ?? DEFAULT_INJECTION_ORDER;
	if (!Number.isFinite(order)) {
		issues.push({
			code: "injection-order",
			detail: `${identifier}:${order}`,
		});
		return DEFAULT_INJECTION_ORDER;
	}
	return order;
}

function recordMacroIssue(
	text: string,
	identifier: string,
	issues: StPresetMappingIssue[],
): void {
	if (MACRO_PATTERN.test(text)) {
		issues.push({ code: "macro", detail: identifier });
	}
}

function addUnmapped(
	entries: StPresetEntryMapping[],
	issues: StPresetMappingIssue[],
	entry: { readonly identifier: string; readonly enabled: boolean },
	reason: string,
	detail = entry.identifier,
): void {
	issues.push({ code: reason, detail });
	entries.push(entryReport(entry, "unmapped", null, null, 0, reason));
}

function entryReport(
	entry: { readonly identifier: string; readonly enabled: boolean },
	kind: StPresetEntryMapping["kind"],
	segmentId: string | null,
	role: LlmRole | null,
	chars: number,
	reason: string | null,
): StPresetEntryMapping {
	return {
		identifier: entry.identifier,
		enabled: entry.enabled,
		kind,
		segmentId,
		role,
		chars,
		reason,
	};
}

function applyAuthorNote(
	input: StPresetMappingInput,
	segments: ContextSegment[],
	injections: StDepthInjection[],
	issues: StPresetMappingIssue[],
	mainIndex: number | null,
): StPresetMapping["authorNote"] {
	const note = input.authorNote;
	if (note === undefined || note === null) return null;
	if (note.text.trim().length === 0) {
		return { placement: note.placement, injected: false };
	}
	const due = authorNoteDue(note, input.playerMessageCount, issues);
	if (!due) {
		return { placement: note.placement, injected: false };
	}
	recordMacroIssue(note.text, "author-note", issues);
	const segment: ContextSegment = {
		id: "st:author-note",
		kind: "static",
		text: note.text,
		role: note.role,
		priority: 10,
	};
	if (note.placement === "in-chat") {
		injections.push({
			identifier: "author-note",
			role: note.role,
			content: note.text,
			depth: note.depth,
			order: DEFAULT_INJECTION_ORDER,
			source: "extension",
		});
		return { placement: note.placement, injected: true };
	}
	if (mainIndex === null) {
		issues.push({
			code: "author-note-placement",
			detail: `${note.placement}:main-missing`,
		});
		return { placement: note.placement, injected: false };
	}
	const index = note.placement === "in-prompt" ? mainIndex + 1 : mainIndex;
	segments.splice(index, 0, segment);
	return { placement: note.placement, injected: true };
}

/** 酒馆按玩家楼层数判定作者注释是否到期；未知楼层数时只有间隔 1 能确定。 */
function authorNoteDue(
	note: StAuthorNote,
	playerMessageCount: number | undefined,
	issues: StPresetMappingIssue[],
): boolean {
	if (note.interval === 1) return true;
	if (playerMessageCount === undefined) {
		issues.push({
			code: "author-note-interval",
			detail: `${note.interval}:player-message-count-missing`,
		});
		return false;
	}
	if (!Number.isInteger(playerMessageCount) || playerMessageCount < 0) {
		throw new Error(`玩家楼层数必须是非负整数：${playerMessageCount}`);
	}
	return playerMessageCount > 0 && playerMessageCount % note.interval === 0;
}

function applyPrefillAndSquash(
	preset: StPreset,
	issues: StPresetMappingIssue[],
): void {
	const squash = readBoolean(
		preset.raw,
		"squash_system_messages",
		"预设",
		false,
	);
	if (squash) {
		issues.push({
			code: "squash-system-messages",
			detail: "原生组装器不合并相邻 system 消息",
		});
	}
	if (
		preset.assistantPrefill !== null &&
		preset.assistantPrefill.trim().length > 0
	) {
		issues.push({
			code: "assistant-prefill",
			detail: `${preset.assistantPrefill.length} 字符`,
		});
	}
	if (preset.raw.continue_prefill === true) {
		issues.push({
			code: "continue-prefill",
			detail: "原生续写不预填充助手正文",
		});
	}
	const impersonation = optionalString(
		preset.raw,
		"assistant_impersonation",
		"预设",
	);
	if (impersonation !== null && impersonation.trim().length > 0) {
		issues.push({
			code: "assistant-impersonation",
			detail: `${impersonation.length} 字符`,
		});
	}
}

function readPrefill(preset: StPreset): StPresetPrefillMapping {
	const continuePostfix = optionalString(
		preset.raw,
		"continue_postfix",
		"预设",
	);
	return {
		assistantPrefill:
			preset.assistantPrefill !== null &&
			preset.assistantPrefill.trim().length > 0
				? preset.assistantPrefill
				: null,
		continuePrefill: preset.raw.continue_prefill === true,
		continuePostfix:
			continuePostfix !== null && continuePostfix.length > 0
				? continuePostfix
				: null,
		squashedSystemMessages: readBoolean(
			preset.raw,
			"squash_system_messages",
			"预设",
			false,
		),
	};
}

function readFormats(preset: StPreset): StPresetFormatMapping {
	return {
		scenario: optionalString(preset.raw, "scenario_format", "预设"),
		personality: optionalString(preset.raw, "personality_format", "预设"),
		worldInfo: optionalString(preset.raw, "wi_format", "预设"),
	};
}

function mapSampling(
	preset: StPreset,
	issues: StPresetMappingIssue[],
): StPresetSamplingMapping {
	const unsupported: string[] = [];
	const fields: readonly (readonly [string, number | null])[] = [
		["top_p", preset.topP],
		["top_k", preset.topK],
		["top_a", preset.topA],
		["min_p", preset.minP],
		["frequency_penalty", preset.frequencyPenalty],
		["presence_penalty", preset.presencePenalty],
		["repetition_penalty", preset.repetitionPenalty],
		["seed", preset.seed],
		["n", preset.n],
		["openai_max_context", preset.contextSize],
	];
	for (const [name, value] of fields) {
		if (value === null) continue;
		unsupported.push(name);
		issues.push({ code: `sampling:${name}`, detail: String(value) });
	}
	let reasoning: LlmReasoningLevel | null = null;
	if (
		preset.reasoningEffort !== null &&
		preset.reasoningEffort.trim().length > 0
	) {
		if (isLlmReasoningLevel(preset.reasoningEffort)) {
			reasoning = preset.reasoningEffort;
		} else {
			unsupported.push("reasoning_effort");
			issues.push({
				code: "sampling:reasoning_effort",
				detail: preset.reasoningEffort,
			});
		}
	}
	return {
		temperature: preset.temperature,
		maxTokens: preset.maxTokens,
		reasoning,
		unsupported,
	};
}

function nativeProtocolSegment(mode: StructuredOutputMode): ContextSegment {
	const template = createDefaultContextTemplate({ structuredOutput: mode });
	const segment = template.segments.find(
		(item) => item.id === WRITING_CONTRACT_SEGMENT_ID,
	);
	if (segment === undefined || segment.kind !== "static") {
		throw new Error("默认模板缺少写作契约段");
	}
	return segment;
}

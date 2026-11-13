import type {
	ContextMessage,
	ContextSlotContent,
	ContextSlotProvider,
	ContextSlotRequest,
	LlmRole,
	StoryStore,
} from "@dramaticer/core";
import type { StRegexScript } from "../preset.js";
import type { StWorldInfo, StWorldInfoEntry } from "../world-info.js";
import type { StMacroSubstitute } from "./macros.js";
import { ST_REGEX_PLACEMENT, applyStRegexScripts } from "./regex.js";

/** 酒馆世界书条目的注入位置。 */
export const ST_WORLD_INFO_POSITION = {
	before: 0,
	after: 1,
	authorNoteTop: 2,
	authorNoteBottom: 3,
	atDepth: 4,
	extensionTop: 5,
	extensionBottom: 6,
	outlet: 7,
} as const;

export const ST_WORLD_INFO_LOGIC = {
	andAny: 0,
	notAll: 1,
	notAny: 2,
	andAll: 3,
} as const;

const DEFAULT_SCAN_DEPTH = 2;
const DEFAULT_ENTRY_DEPTH = 4;
const DEFAULT_ENTRY_ORDER = 100;
const DEFAULT_GROUP_WEIGHT = 100;
const MAX_SCAN_DEPTH = 1000;
const MATCHER = "\u0001";
const JOINER = `\n${MATCHER}`;
const DEPTH_ROLES: Readonly<Record<number, LlmRole>> = {
	0: "system",
	1: "user",
	2: "assistant",
};

export interface StWorldInfoScanSettings {
	/** 全局扫描深度，默认 2；单条目可以用 `scanDepth` 覆盖。 */
	readonly scanDepth?: number;
	/** 是否启用递归扫描，默认关闭。 */
	readonly recursive?: boolean;
	/** 递归轮数上限；0 表示只受调用方时间预算限制。 */
	readonly maxRecursionSteps?: number;
	readonly caseSensitive?: boolean;
	readonly matchWholeWords?: boolean;
	readonly useGroupScoring?: boolean;
	/** 与酒馆相同的 token 预算；不提供时由原生槽位预算裁剪。 */
	readonly budgetTokens?: number;
	readonly estimateTokens?: (text: string) => number;
	/** 生成类型过滤；默认 `normal`。 */
	readonly trigger?: string;
}

interface ResolvedWorldInfoSettings {
	readonly scanDepth: number;
	readonly recursive: boolean;
	readonly maxRecursionSteps: number;
	readonly caseSensitive: boolean;
	readonly matchWholeWords: boolean;
	readonly useGroupScoring: boolean;
	readonly budgetTokens?: number;
	readonly estimateTokens?: (text: string) => number;
	readonly trigger: string;
}

export interface StWorldInfoGlobalScanData {
	readonly personaDescription?: string;
	readonly characterDescription?: string;
	readonly characterPersonality?: string;
	readonly characterDepthPrompt?: string;
	readonly scenario?: string;
	readonly creatorNotes?: string;
}

export interface StWorldInfoTimedEffect {
	readonly hash: string;
	readonly start: number;
	readonly end: number;
	readonly protected: boolean;
}

export interface StWorldInfoTimedEffectsState {
	readonly sticky: Readonly<Record<string, StWorldInfoTimedEffect>>;
	readonly cooldown: Readonly<Record<string, StWorldInfoTimedEffect>>;
}

export const EMPTY_ST_WORLD_INFO_TIMED_EFFECTS: StWorldInfoTimedEffectsState = {
	sticky: {},
	cooldown: {},
};

export interface StWorldInfoActivationIssue {
	readonly world: string;
	readonly uid: number;
	readonly code: string;
}

export interface StWorldInfoActivatedEntry {
	readonly world: string;
	readonly uid: number;
	readonly sourceKey: string;
	readonly order: number;
	readonly position: number;
	readonly depth: number;
	readonly role: LlmRole;
	readonly content: string;
	readonly outletName: string | null;
}

export interface StWorldInfoDepthGroup {
	readonly depth: number;
	readonly role: LlmRole;
	readonly contents: readonly string[];
}

export interface StWorldInfoActivation {
	readonly before: readonly string[];
	readonly after: readonly string[];
	readonly authorNoteTop: readonly string[];
	readonly authorNoteBottom: readonly string[];
	readonly extensionTop: readonly string[];
	readonly extensionBottom: readonly string[];
	readonly depth: readonly StWorldInfoDepthGroup[];
	readonly outlets: Readonly<Record<string, readonly string[]>>;
	readonly entries: readonly StWorldInfoActivatedEntry[];
	readonly issues: readonly StWorldInfoActivationIssue[];
	readonly timedEffects: StWorldInfoTimedEffectsState;
	readonly steps: number;
	readonly deadlineExceeded: boolean;
	readonly budgetExceeded: boolean;
}

export interface StWorldInfoActivationInput {
	readonly worlds: readonly StWorldInfo[];
	/** 倒序的对话楼层；第 0 条是最近一条，与酒馆的扫描顺序一致。 */
	readonly messages: readonly string[];
	readonly chatLength: number;
	readonly settings?: StWorldInfoScanSettings;
	readonly globalScanData?: StWorldInfoGlobalScanData;
	readonly timedEffects?: StWorldInfoTimedEffectsState;
	readonly random?: () => number;
	readonly now?: () => number;
	/** 毫秒时间戳；触达后停止递归并保留已经激活的结果。 */
	readonly deadline?: number;
	readonly dryRun?: boolean;
	readonly substitute?: StMacroSubstitute;
	/** 世界书条目在 prompt 里的正则处理；与酒馆 `buildWorldInfoPrompt` 相同。 */
	readonly regex?: StWorldInfoRegexOptions;
}

export interface StWorldInfoRegexOptions {
	readonly scripts: readonly StRegexScript[];
	readonly substitute?: StMacroSubstitute;
}

interface ScanEntry {
	readonly world: string;
	readonly entry: StWorldInfoEntry;
	readonly key: string;
	readonly hash: string;
	readonly index: number;
	readonly decorators: readonly string[];
	content: string;
}

interface TimedEffectBuffers {
	readonly sticky: readonly ScanEntry[];
	readonly cooldown: readonly ScanEntry[];
	readonly delay: readonly ScanEntry[];
	readonly state: StWorldInfoTimedEffectsState;
}

/**
 * 世界书条目的稳定标识。酒馆的计时效果用 `世界.uid` 作为键；没有 uid 的
 * 条目退回它在各自世界书里的 sourceKey。
 */
export function stWorldInfoEntryKey(
	world: string,
	entry: StWorldInfoEntry,
): string {
	const uid = entry.uid === null ? entry.sourceKey : String(entry.uid);
	return `${world}.${uid}`;
}

/** 把多份世界书摊平成一份扫描列表，保留世界名用于报告与计时键。 */
export function collectStWorldInfoEntries(
	worlds: readonly StWorldInfo[],
): readonly { readonly world: string; readonly entry: StWorldInfoEntry }[] {
	return worlds.flatMap((world, index) => {
		const name = world.name ?? `world-${index + 1}`;
		return world.entries.map((entry) => ({ world: name, entry }));
	});
}

/**
 * 酒馆的关键词正则格式是 `/pattern/flags`；不是这个格式或者编译失败时
 * 按普通文本处理。这里与 `parseRegexFromString` 的行为一致。
 */
export function parseStWorldInfoKeyRegex(input: string): RegExp | null {
	const match = /^\/([\w\W]+?)\/([gimsuy]*)$/.exec(input);
	if (!match) return null;
	let pattern = match[1] ?? "";
	const flags = match[2] ?? "";
	if (/(^|[^\\])\//.test(pattern)) return null;
	pattern = pattern.replace("\\/", "/");
	try {
		return new RegExp(pattern, flags);
	} catch {
		return null;
	}
}

/** `wi_format` 的 `{0}` 替换；空格式串表示不包裹。 */
export function formatStWorldInfo(
	value: string,
	wiFormat: string | null | undefined,
): string {
	if (!value) return "";
	const format = wiFormat ?? "{0}";
	if (!format.trim()) return value;
	return format.replace(/{(\d+)}/g, (match, index: string) =>
		index === "0" ? value : match,
	);
}

/** 按酒馆的语义把深度世界书条目插进历史消息。 */
export function injectStWorldInfoDepthMessages(
	messages: readonly ContextMessage[],
	groups: readonly StWorldInfoDepthGroup[],
): ContextMessage[] {
	const result = messages.map((message) => ({ ...message }));
	const baseLength = result.length;
	for (const group of groups) {
		const content = group.contents.join("\n");
		if (content.length === 0) continue;
		const index = Math.max(0, baseLength - group.depth);
		result.splice(index, 0, { role: group.role, content });
	}
	return result;
}

/**
 * 按酒馆的完整激活语义扫描世界书：主次关键词与四种逻辑、正则关键词、
 * 递归、sticky/cooldown/delay、分组与权重、概率、扫描深度、位置与深度角色
 * 以及 outlet。函数是确定性的；概率与权重通过传入的随机函数控制。
 */
export function activateStWorldInfo(
	input: StWorldInfoActivationInput,
): StWorldInfoActivation {
	const settings = resolveSettings(input.settings);
	const random = input.random ?? Math.random;
	const now = input.now ?? Date.now;
	const substitute = input.substitute ?? ((text: string) => text);
	const chatLength = input.chatLength;
	if (!Number.isInteger(chatLength) || chatLength < 0) {
		throw new Error("世界书扫描的楼层数必须是非负整数");
	}
	const sorted = collectStWorldInfoEntries(input.worlds)
		.map((item, index): ScanEntry => {
			const parsed = parseDecorators(item.entry.content);
			return {
				world: item.world,
				entry: item.entry,
				key: stWorldInfoEntryKey(item.world, item.entry),
				hash: stWorldInfoEntryKey(item.world, item.entry),
				index,
				decorators: parsed.decorators,
				content: parsed.content,
			};
		})
		.sort(
			(left, right) =>
				(right.entry.insertionOrder ?? DEFAULT_ENTRY_ORDER) -
				(left.entry.insertionOrder ?? DEFAULT_ENTRY_ORDER),
		);
	if (sorted.length === 0) {
		return emptyActivation(
			input.timedEffects ?? EMPTY_ST_WORLD_INFO_TIMED_EFFECTS,
		);
	}

	const timed = resolveTimedEffects(
		sorted,
		input.timedEffects,
		chatLength,
		input.dryRun !== true,
	);
	const delayLevels = [
		...new Set(
			sorted
				.filter(
					(item) =>
						item.entry.delayUntilRecursion !== null &&
						item.entry.delayUntilRecursion !== false &&
						item.entry.delayUntilRecursion !== 0,
				)
				.map((item) =>
					item.entry.delayUntilRecursion === true
						? 1
						: Number(item.entry.delayUntilRecursion),
				),
		),
	].sort((left, right) => left - right);
	let currentDelayLevel = delayLevels.shift() ?? 0;

	const depthBuffer: string[] = [];
	for (let depth = 0; depth < MAX_SCAN_DEPTH; depth += 1) {
		const message = input.messages[depth];
		if (message !== undefined) depthBuffer[depth] = message.trim();
		if (depth === input.messages.length - 1) break;
	}
	const recurseBuffer: string[] = [];
	const allActivated = new Map<string, ScanEntry>();
	const failedProbability = new Set<string>();
	const issues: StWorldInfoActivationIssue[] = [];
	let allActivatedText = "";
	let budgetExceeded = false;
	let deadlineExceeded = false;
	let steps = 0;
	let scanState: "initial" | "recursion" | null = "initial";

	function isActive(active: readonly ScanEntry[], item: ScanEntry): boolean {
		return active.some((candidate) => candidate.key === item.key);
	}

	while (scanState !== null) {
		if (settings.maxRecursionSteps > 0 && settings.maxRecursionSteps <= steps) {
			break;
		}
		if (input.deadline !== undefined && now() >= input.deadline) {
			deadlineExceeded = true;
			break;
		}
		steps += 1;
		const activatedNow = new Map<string, ScanEntry>();
		for (const item of sorted) {
			if (failedProbability.has(item.key) || allActivated.has(item.key)) {
				continue;
			}
			const entry = item.entry;
			if (entry.disabled) continue;
			if (
				entry.triggers !== null &&
				entry.triggers.length > 0 &&
				!entry.triggers.includes(settings.trigger)
			) {
				continue;
			}
			const isSticky = isActive(timed.sticky, item);
			const isCooldown = isActive(timed.cooldown, item);
			const isDelay = isActive(timed.delay, item);
			if (isDelay) continue;
			if (isCooldown && !isSticky) continue;
			if (
				scanState !== "recursion" &&
				entry.delayUntilRecursion !== null &&
				entry.delayUntilRecursion !== false &&
				entry.delayUntilRecursion !== 0 &&
				!isSticky
			) {
				continue;
			}
			if (
				scanState === "recursion" &&
				entry.delayUntilRecursion !== null &&
				entry.delayUntilRecursion !== false &&
				Number(entry.delayUntilRecursion) > currentDelayLevel &&
				!isSticky
			) {
				continue;
			}
			if (
				scanState === "recursion" &&
				settings.recursive &&
				entry.excludeRecursion === true &&
				!isSticky
			) {
				continue;
			}
			if (item.decorators.includes("@@activate")) {
				activatedNow.set(item.key, item);
				continue;
			}
			if (item.decorators.includes("@@dont_activate")) continue;
			if (entry.constant) {
				activatedNow.set(item.key, item);
				continue;
			}
			if (isSticky) {
				activatedNow.set(item.key, item);
				continue;
			}
			if (entry.keys.length === 0) continue;
			const textToScan = scanBuffer(
				item,
				scanState,
				settings,
				input.globalScanData ?? {},
				depthBuffer,
				recurseBuffer,
			);
			const primary = entry.keys
				.map((key) => substitute(key).trim())
				.find(
					(key) => key.length > 0 && matchKeys(textToScan, key, item, settings),
				);
			if (primary === undefined) continue;
			const hasSecondary = entry.selective && entry.secondaryKeys.length > 0;
			if (!hasSecondary) {
				activatedNow.set(item.key, item);
				continue;
			}
			if (matchSecondaryKeys(textToScan, entry, item, settings, substitute)) {
				activatedNow.set(item.key, item);
			}
		}

		let newEntries = [...activatedNow.values()].sort(
			(left, right) =>
				Number(isActive(timed.sticky, right)) -
					Number(isActive(timed.sticky, left)) || left.index - right.index,
		);
		newEntries = filterByInclusionGroups({
			newEntries,
			allActivated,
			scanState,
			active: timed,
			settings,
			random,
			textToScan: (item) =>
				scanBuffer(
					item,
					scanState,
					settings,
					input.globalScanData ?? {},
					depthBuffer,
					recurseBuffer,
				),
		});

		const textToScanTokens =
			settings.budgetTokens === undefined ||
			settings.estimateTokens === undefined
				? 0
				: settings.estimateTokens(allActivatedText);
		let newContent = "";
		let ignoresBudget = newEntries.filter(
			(item) => item.entry.ignoreBudget,
		).length;
		for (const item of newEntries) {
			const entry = item.entry;
			if (entry.ignoreBudget) ignoresBudget -= 1;
			if (budgetExceeded && entry.ignoreBudget !== true) {
				if (ignoresBudget > 0) continue;
				break;
			}
			const probability =
				entry.useProbability === true ? (entry.probability ?? 100) : 100;
			const isSticky = isActive(timed.sticky, item);
			if (!isSticky && probability !== 100 && random() * 100 > probability) {
				failedProbability.add(item.key);
				continue;
			}
			item.content = substitute(item.content);
			newContent += `${item.content}\n`;
			if (
				settings.budgetTokens !== undefined &&
				settings.estimateTokens !== undefined &&
				entry.ignoreBudget !== true &&
				textToScanTokens + settings.estimateTokens(newContent) >=
					settings.budgetTokens
			) {
				budgetExceeded = true;
				continue;
			}
			allActivated.set(item.key, item);
		}

		const successfulForRecursion = newEntries.filter(
			(item) =>
				!failedProbability.has(item.key) &&
				item.entry.preventRecursion !== true,
		);
		let nextState: "initial" | "recursion" | null = null;
		if (
			settings.recursive &&
			!budgetExceeded &&
			successfulForRecursion.length > 0
		) {
			nextState = "recursion";
		}
		if (nextState === null && delayLevels.length > 0) {
			nextState = "recursion";
			currentDelayLevel = delayLevels.shift() ?? 0;
		}
		scanState = nextState;
		if (scanState !== null) {
			const text = successfulForRecursion
				.map((item) => item.content)
				.join("\n");
			if (text.length > 0) {
				recurseBuffer.unshift(text);
				allActivatedText = `${text}\n${allActivatedText}`;
			}
		}
	}

	const timedEffects = input.dryRun
		? timed.state
		: applyTimedEffects(timed.state, allActivated, chatLength);

	return buildActivation({
		entries: allActivated,
		timedEffects,
		issues,
		steps,
		deadlineExceeded,
		budgetExceeded,
		regex: input.regex,
	});
}

function emptyActivation(
	timedEffects: StWorldInfoTimedEffectsState,
): StWorldInfoActivation {
	return {
		before: [],
		after: [],
		authorNoteTop: [],
		authorNoteBottom: [],
		extensionTop: [],
		extensionBottom: [],
		depth: [],
		outlets: {},
		entries: [],
		issues: [],
		timedEffects,
		steps: 0,
		deadlineExceeded: false,
		budgetExceeded: false,
	};
}

function resolveSettings(
	settings: StWorldInfoScanSettings | undefined,
): ResolvedWorldInfoSettings {
	const resolved = {
		scanDepth: settings?.scanDepth ?? DEFAULT_SCAN_DEPTH,
		recursive: settings?.recursive ?? false,
		maxRecursionSteps: settings?.maxRecursionSteps ?? 0,
		caseSensitive: settings?.caseSensitive ?? false,
		matchWholeWords: settings?.matchWholeWords ?? false,
		useGroupScoring: settings?.useGroupScoring ?? false,
		budgetTokens: settings?.budgetTokens,
		estimateTokens: settings?.estimateTokens,
		trigger: settings?.trigger ?? "normal",
	};
	if (!Number.isInteger(resolved.scanDepth) || resolved.scanDepth < 0) {
		throw new Error("世界书扫描深度必须是非负整数");
	}
	if (
		!Number.isInteger(resolved.maxRecursionSteps) ||
		resolved.maxRecursionSteps < 0
	) {
		throw new Error("世界书递归轮数上限必须是非负整数");
	}
	if (
		resolved.budgetTokens !== undefined &&
		(!Number.isInteger(resolved.budgetTokens) || resolved.budgetTokens < 1)
	) {
		throw new Error("世界书 token 预算必须是正整数");
	}
	return resolved;
}

function resolveTimedEffects(
	sorted: readonly ScanEntry[],
	state: StWorldInfoTimedEffectsState | undefined,
	chatLength: number,
	checkTimedEffects: boolean,
): TimedEffectBuffers {
	const sticky = { ...(state?.sticky ?? {}) };
	const cooldown = { ...(state?.cooldown ?? {}) };
	const byHash = new Map(sorted.map((item) => [item.hash, item] as const));
	const stickyActive: ScanEntry[] = [];
	const cooldownActive: ScanEntry[] = [];
	const delayActive: ScanEntry[] = [];

	for (const [key, effect] of checkTimedEffects ? Object.entries(sticky) : []) {
		if (chatLength <= effect.start && !effect.protected) {
			delete sticky[key];
			continue;
		}
		const entry = byHash.get(effect.hash);
		if (entry === undefined) {
			if (chatLength >= effect.end) delete sticky[key];
			continue;
		}
		if (!entry.entry.sticky) {
			delete sticky[key];
			continue;
		}
		if (chatLength >= effect.end) {
			delete sticky[key];
			if (entry.entry.cooldown) {
				cooldown[key] = {
					hash: entry.hash,
					start: chatLength,
					end: chatLength + Number(entry.entry.cooldown),
					protected: true,
				};
			}
			continue;
		}
		stickyActive.push(entry);
	}

	for (const [key, effect] of checkTimedEffects
		? Object.entries(cooldown)
		: []) {
		if (chatLength <= effect.start && !effect.protected) {
			delete cooldown[key];
			continue;
		}
		const entry = byHash.get(effect.hash);
		if (entry === undefined) {
			if (chatLength >= effect.end) delete cooldown[key];
			continue;
		}
		if (!entry.entry.cooldown) {
			delete cooldown[key];
			continue;
		}
		if (chatLength >= effect.end) {
			delete cooldown[key];
			continue;
		}
		cooldownActive.push(entry);
	}

	for (const item of sorted) {
		if (!item.entry.delay) continue;
		if (chatLength < Number(item.entry.delay)) delayActive.push(item);
	}

	return {
		sticky: stickyActive,
		cooldown: cooldownActive,
		delay: delayActive,
		state: { sticky, cooldown },
	};
}

function applyTimedEffects(
	state: StWorldInfoTimedEffectsState,
	activated: ReadonlyMap<string, ScanEntry>,
	chatLength: number,
): StWorldInfoTimedEffectsState {
	const sticky = { ...state.sticky };
	const cooldown = { ...state.cooldown };
	for (const item of activated.values()) {
		if (item.entry.sticky && !sticky[item.key]) {
			sticky[item.key] = {
				hash: item.hash,
				start: chatLength,
				end: chatLength + Number(item.entry.sticky),
				protected: false,
			};
		}
		if (item.entry.cooldown && !cooldown[item.key]) {
			cooldown[item.key] = {
				hash: item.hash,
				start: chatLength,
				end: chatLength + Number(item.entry.cooldown),
				protected: false,
			};
		}
	}
	return { sticky, cooldown };
}

function scanBuffer(
	item: ScanEntry,
	scanState: "initial" | "recursion" | null,
	settings: ResolvedWorldInfoSettings,
	globalScanData: StWorldInfoGlobalScanData,
	depthBuffer: readonly string[],
	recurseBuffer: readonly string[],
): string {
	let depth = item.entry.scanDepth ?? settings.scanDepth;
	if (depth <= 0) return "";
	if (!Number.isInteger(depth) || depth < 0) return "";
	if (depth > MAX_SCAN_DEPTH) depth = MAX_SCAN_DEPTH;
	let result = MATCHER + depthBuffer.slice(0, depth).join(JOINER);
	if (item.entry.matchPersonaDescription && globalScanData.personaDescription) {
		result += JOINER + globalScanData.personaDescription;
	}
	if (
		item.entry.matchCharacterDescription &&
		globalScanData.characterDescription
	) {
		result += JOINER + globalScanData.characterDescription;
	}
	if (
		item.entry.matchCharacterPersonality &&
		globalScanData.characterPersonality
	) {
		result += JOINER + globalScanData.characterPersonality;
	}
	if (
		item.entry.matchCharacterDepthPrompt &&
		globalScanData.characterDepthPrompt
	) {
		result += JOINER + globalScanData.characterDepthPrompt;
	}
	if (item.entry.matchScenario && globalScanData.scenario) {
		result += JOINER + globalScanData.scenario;
	}
	if (item.entry.matchCreatorNotes && globalScanData.creatorNotes) {
		result += JOINER + globalScanData.creatorNotes;
	}
	if (recurseBuffer.length > 0 && scanState !== null) {
		result += JOINER + recurseBuffer.join(JOINER);
	}
	return result;
}

function matchKeys(
	haystack: string,
	needle: string,
	item: ScanEntry,
	settings: ResolvedWorldInfoSettings,
): boolean {
	const regex = parseStWorldInfoKeyRegex(needle);
	if (regex !== null) return regex.test(haystack);
	const transformedHaystack = settings.caseSensitive
		? haystack
		: haystack.toLowerCase();
	const transformedNeedle = settings.caseSensitive
		? needle
		: needle.toLowerCase();
	const matchWholeWords =
		item.entry.matchWholeWords ?? settings.matchWholeWords;
	if (matchWholeWords) {
		const words = transformedNeedle.split(/\s+/);
		if (words.length > 1)
			return transformedHaystack.includes(transformedNeedle);
		const escaped = escapeRegex(transformedNeedle);
		return new RegExp(`(?:^|\\W)(${escaped})(?:$|\\W)`).test(
			transformedHaystack,
		);
	}
	return transformedHaystack.includes(transformedNeedle);
}

function matchSecondaryKeys(
	textToScan: string,
	entry: StWorldInfoEntry,
	item: ScanEntry,
	settings: ResolvedWorldInfoSettings,
	substitute: (text: string) => string,
): boolean {
	const logic = entry.selectiveLogic ?? ST_WORLD_INFO_LOGIC.andAny;
	let hasAnyMatch = false;
	let hasAllMatch = true;
	for (const raw of entry.secondaryKeys) {
		const key = substitute(raw).trim();
		const matched =
			key.length > 0 && matchKeys(textToScan, key, item, settings);
		if (matched) hasAnyMatch = true;
		if (!matched) hasAllMatch = false;
		if (logic === ST_WORLD_INFO_LOGIC.andAny && matched) return true;
		if (logic === ST_WORLD_INFO_LOGIC.notAll && !matched) return true;
	}
	if (logic === ST_WORLD_INFO_LOGIC.notAny && !hasAnyMatch) return true;
	if (logic === ST_WORLD_INFO_LOGIC.andAll && hasAllMatch) return true;
	return false;
}

function entryScore(
	item: ScanEntry,
	scanState: "initial" | "recursion" | null,
	settings: ResolvedWorldInfoSettings,
	textToScan: (item: ScanEntry) => string,
): number {
	const haystack = textToScan(item);
	let primaryScore = 0;
	for (const key of item.entry.keys) {
		if (matchKeys(haystack, key, item, settings)) primaryScore += 1;
	}
	if (item.entry.keys.length === 0) return 0;
	let secondaryScore = 0;
	for (const key of item.entry.secondaryKeys) {
		if (matchKeys(haystack, key, item, settings)) secondaryScore += 1;
	}
	if (item.entry.secondaryKeys.length > 0) {
		if (item.entry.selectiveLogic === ST_WORLD_INFO_LOGIC.andAny) {
			return primaryScore + secondaryScore;
		}
		if (
			item.entry.selectiveLogic === ST_WORLD_INFO_LOGIC.andAll &&
			secondaryScore === item.entry.secondaryKeys.length
		) {
			return primaryScore + secondaryScore;
		}
	}
	return primaryScore;
}

function filterByInclusionGroups(input: {
	readonly newEntries: readonly ScanEntry[];
	readonly allActivated: ReadonlyMap<string, ScanEntry>;
	readonly scanState: "initial" | "recursion" | null;
	readonly active: TimedEffectBuffers;
	readonly settings: ResolvedWorldInfoSettings;
	readonly random: () => number;
	readonly textToScan: (item: ScanEntry) => string;
}): ScanEntry[] {
	const groups = new Map<string, ScanEntry[]>();
	for (const item of input.newEntries) {
		for (const group of splitGroups(item.entry.group)) {
			const list = groups.get(group) ?? [];
			list.push(item);
			groups.set(group, list);
		}
	}
	if (groups.size === 0) return [...input.newEntries];
	const removed = new Set<string>();
	const stickyGroups = new Set<string>();
	const isActive = (active: readonly ScanEntry[], item: ScanEntry): boolean =>
		active.some((candidate) => candidate.key === item.key);

	for (const [group, entries] of groups) {
		const sticky = entries.filter((item) =>
			isActive(input.active.sticky, item),
		);
		if (sticky.length > 0) {
			stickyGroups.add(group);
			for (const item of entries) {
				if (!sticky.includes(item)) removed.add(item.key);
			}
		}
		for (const item of entries) {
			if (isActive(input.active.cooldown, item)) removed.add(item.key);
			if (isActive(input.active.delay, item)) removed.add(item.key);
		}
	}

	for (const [group, entries] of groups) {
		if (stickyGroups.has(group)) continue;
		if (
			!input.settings.useGroupScoring &&
			!entries.some((item) => item.entry.useGroupScoring === true)
		) {
			continue;
		}
		const scores = entries.map((item) =>
			entryScore(item, input.scanState, input.settings, input.textToScan),
		);
		const maxScore = Math.max(...scores);
		entries.forEach((item, index) => {
			const scored =
				item.entry.useGroupScoring ?? input.settings.useGroupScoring;
			if (scored && (scores[index] ?? 0) < maxScore) removed.add(item.key);
		});
	}

	const activatedGroups = new Set<string>();
	for (const item of input.allActivated.values()) {
		for (const group of splitGroups(item.entry.group)) {
			activatedGroups.add(group);
		}
	}

	for (const [group, entries] of groups) {
		if (stickyGroups.has(group)) continue;
		const alive = entries.filter((item) => !removed.has(item.key));
		if (activatedGroups.has(group)) {
			for (const item of alive) removed.add(item.key);
			continue;
		}
		if (alive.length <= 1) continue;
		const prioritized = alive
			.filter((item) => item.entry.groupOverride === true)
			.sort(
				(left, right) =>
					(right.entry.insertionOrder ?? DEFAULT_ENTRY_ORDER) -
					(left.entry.insertionOrder ?? DEFAULT_ENTRY_ORDER),
			);
		let winner: ScanEntry | undefined = prioritized[0];
		if (winner === undefined) {
			const totalWeight = alive.reduce(
				(sum, item) => sum + (item.entry.groupWeight ?? DEFAULT_GROUP_WEIGHT),
				0,
			);
			const roll = input.random() * totalWeight;
			let currentWeight = 0;
			for (const item of alive) {
				currentWeight += item.entry.groupWeight ?? DEFAULT_GROUP_WEIGHT;
				if (roll <= currentWeight) {
					winner = item;
					break;
				}
			}
		}
		for (const item of alive) {
			if (item !== winner) removed.add(item.key);
		}
	}

	return input.newEntries.filter((item) => !removed.has(item.key));
}

function buildActivation(input: {
	readonly entries: ReadonlyMap<string, ScanEntry>;
	readonly timedEffects: StWorldInfoTimedEffectsState;
	readonly issues: readonly StWorldInfoActivationIssue[];
	readonly steps: number;
	readonly deadlineExceeded: boolean;
	readonly budgetExceeded: boolean;
	readonly regex?: StWorldInfoRegexOptions;
}): StWorldInfoActivation {
	const before: string[] = [];
	const after: string[] = [];
	const authorNoteTop: string[] = [];
	const authorNoteBottom: string[] = [];
	const extensionTop: string[] = [];
	const extensionBottom: string[] = [];
	const depth: StWorldInfoDepthGroup[] = [];
	const outlets: Record<string, string[]> = {};
	const issues = [...input.issues];
	const entries: StWorldInfoActivatedEntry[] = [];
	const sorted = [...input.entries.values()].sort(
		(left, right) =>
			(right.entry.insertionOrder ?? DEFAULT_ENTRY_ORDER) -
			(left.entry.insertionOrder ?? DEFAULT_ENTRY_ORDER),
	);

	for (const item of sorted) {
		const entry = item.entry;
		const position = entry.position ?? ST_WORLD_INFO_POSITION.before;
		const role = DEPTH_ROLES[entry.role ?? 0] ?? "system";
		const depthValue = entry.depth ?? DEFAULT_ENTRY_DEPTH;
		const content =
			input.regex === undefined
				? item.content
				: applyStRegexScripts(item.content, ST_REGEX_PLACEMENT.worldInfo, {
						scripts: input.regex.scripts,
						isMarkdown: false,
						isPrompt: true,
						depth:
							position === ST_WORLD_INFO_POSITION.atDepth
								? depthValue
								: undefined,
						substitute: input.regex.substitute,
					});
		if (content.length === 0) continue;
		entries.push({
			world: item.world,
			uid: entry.uid ?? -1,
			sourceKey: entry.sourceKey,
			order: entry.insertionOrder ?? DEFAULT_ENTRY_ORDER,
			position,
			depth: depthValue,
			role,
			content: item.content,
			outletName: entry.outletName,
		});
		switch (position) {
			case ST_WORLD_INFO_POSITION.before:
				before.unshift(content);
				break;
			case ST_WORLD_INFO_POSITION.after:
				after.unshift(content);
				break;
			case ST_WORLD_INFO_POSITION.authorNoteTop:
				authorNoteTop.unshift(content);
				break;
			case ST_WORLD_INFO_POSITION.authorNoteBottom:
				authorNoteBottom.unshift(content);
				break;
			case ST_WORLD_INFO_POSITION.atDepth: {
				const existing = depth.find(
					(group) => group.depth === depthValue && group.role === role,
				);
				if (existing === undefined) {
					depth.push({
						depth: depthValue,
						role,
						contents: [content],
					});
				} else {
					const contents = existing.contents as string[];
					contents.unshift(content);
				}
				break;
			}
			case ST_WORLD_INFO_POSITION.extensionTop:
				extensionTop.unshift(content);
				break;
			case ST_WORLD_INFO_POSITION.extensionBottom:
				extensionBottom.unshift(content);
				break;
			case ST_WORLD_INFO_POSITION.outlet: {
				if (!entry.outletName) {
					issues.push({
						world: item.world,
						uid: entry.uid ?? -1,
						code: "outlet-without-name",
					});
					break;
				}
				outlets[entry.outletName] = [
					...(outlets[entry.outletName] ?? []),
					content,
				];
				break;
			}
			default:
				break;
		}
	}

	return {
		before,
		after,
		authorNoteTop,
		authorNoteBottom,
		extensionTop,
		extensionBottom,
		depth,
		outlets,
		entries,
		issues,
		timedEffects: input.timedEffects,
		steps: input.steps,
		deadlineExceeded: input.deadlineExceeded,
		budgetExceeded: input.budgetExceeded,
	};
}

function splitGroups(group: string | null): string[] {
	if (group === null) return [];
	return group
		.split(/,\s*/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDecorators(content: string): {
	readonly decorators: readonly string[];
	readonly content: string;
} {
	if (!content.startsWith("@@")) return { decorators: [], content };
	const known = ["@@activate", "@@dont_activate"];
	const lines = content.split("\n");
	let newContent = content;
	const decorators: string[] = [];
	let fallbacked = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line.startsWith("@@")) {
			if (line.startsWith("@@@") && !fallbacked) continue;
			const data = line.startsWith("@@@") ? line.slice(1) : line;
			if (known.some((item) => data.startsWith(item))) {
				decorators.push(data);
				fallbacked = false;
			} else {
				fallbacked = true;
			}
			continue;
		}
		newContent = lines.slice(index).join("\n");
		break;
	}
	return { decorators, content: newContent };
}

export interface StWorldInfoProviderOptions {
	readonly worlds: readonly StWorldInfo[];
	readonly store: StoryStore;
	readonly settings?: StWorldInfoScanSettings;
	readonly globalScanData?:
		| StWorldInfoGlobalScanData
		| ((request: ContextSlotRequest) => StWorldInfoGlobalScanData);
	readonly wiFormat?: string | null;
	/** 模板里 `worldInfoBefore` marker 是否存在且启用。 */
	readonly includeBefore?: boolean;
	/** 模板里 `worldInfoAfter` marker 是否存在且启用。 */
	readonly includeAfter?: boolean;
	/** 单次扫描的时间上限，默认 50 毫秒；0 表示不设上限。 */
	readonly timeBudgetMs?: number;
	readonly random?: () => number;
	readonly now?: () => number;
	readonly dryRun?: boolean;
	readonly substitute?: StMacroSubstitute;
	/** 世界书条目的 prompt 正则；由调用方从全局、角色卡与预设脚本收集。 */
	readonly regexScripts?: readonly StRegexScript[];
}

export interface StWorldInfoProviders {
	/** 世界书 before/after 结果进入原生 `lore` 槽位。 */
	readonly lore: ContextSlotProvider;
	/** 把世界书的深度条目叠到历史槽位；没有深度条目时原样返回。 */
	wrapHistory(base: ContextSlotProvider): ContextSlotProvider;
	/** 同一次上下文组装里复用同一份激活结果。 */
	activate(request: ContextSlotRequest): Promise<StWorldInfoActivation>;
}

interface CachedActivation {
	readonly key: string;
	readonly promise: Promise<StWorldInfoActivation>;
}

/**
 * 构造世界书槽位提供者。`lore` 与 `wrapHistory` 共用一次激活，
 * 计时状态跨轮保留；原生预算分配器仍在槽位外面裁剪。
 */
export function createStWorldInfoProviders(
	options: StWorldInfoProviderOptions,
): StWorldInfoProviders {
	if (
		options.timeBudgetMs !== undefined &&
		(!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs < 0)
	) {
		throw new Error("世界书扫描的时间上限必须是非负数字");
	}
	const timeBudgetMs = options.timeBudgetMs ?? 50;
	const now = options.now ?? Date.now;
	const includeBefore = options.includeBefore ?? true;
	const includeAfter = options.includeAfter ?? true;
	let timedEffects: StWorldInfoTimedEffectsState =
		EMPTY_ST_WORLD_INFO_TIMED_EFFECTS;
	let generation = 0;
	let cache: CachedActivation | null = null;

	function activate(
		request: ContextSlotRequest,
	): Promise<StWorldInfoActivation> {
		const key = `${request.storyId}:${request.nodeId ?? "-"}`;
		if (cache !== null && cache.key === key) return cache.promise;
		const promise = (async () => {
			const path =
				request.nodeId === null
					? []
					: options.store.getPathToNode(request.nodeId);
			const messages = [...path].reverse().map((node) => node.raw);
			const globalScanData =
				typeof options.globalScanData === "function"
					? options.globalScanData(request)
					: (options.globalScanData ?? {});
			const activation = activateStWorldInfo({
				worlds: options.worlds,
				messages,
				chatLength: path.length,
				settings: options.settings,
				globalScanData,
				timedEffects,
				random: options.random,
				now,
				deadline: timeBudgetMs > 0 ? now() + timeBudgetMs : undefined,
				dryRun: options.dryRun,
				substitute: options.substitute,
				regex:
					options.regexScripts === undefined
						? undefined
						: {
								scripts: options.regexScripts,
								substitute: options.substitute,
							},
			});
			timedEffects = activation.timedEffects;
			generation += 1;
			return activation;
		})();
		cache = { key, promise };
		void promise.catch(() => {
			if (cache?.promise === promise) cache = null;
		});
		return promise;
	}

	const lore: ContextSlotProvider = {
		get packKey() {
			return `st-world-info:${generation}`;
		},
		async provide(request): Promise<ContextSlotContent | null> {
			const activation = await activate(request);
			const messages: ContextMessage[] = [];
			if (includeBefore) {
				const text = formatStWorldInfo(
					activation.before.join("\n"),
					options.wiFormat,
				);
				if (text.length > 0) messages.push({ role: "system", content: text });
			}
			if (includeAfter) {
				const text = formatStWorldInfo(
					activation.after.join("\n"),
					options.wiFormat,
				);
				if (text.length > 0) messages.push({ role: "system", content: text });
			}
			if (messages.length === 0) return null;
			const depthCount = activation.depth.reduce(
				(sum, group) => sum + group.contents.length,
				0,
			);
			const outletCount = Object.keys(activation.outlets).length;
			const outletEntries = Object.values(activation.outlets).reduce(
				(sum, contents) => sum + contents.length,
				0,
			);
			const parts = [
				`世界书：前 ${includeBefore ? activation.before.length : 0} 条、后 ${includeAfter ? activation.after.length : 0} 条、深度 ${depthCount} 条`,
			];
			if (outletEntries > 0)
				parts.push(`outlet ${outletCount} 组 ${outletEntries} 条`);
			const unmapped =
				activation.authorNoteTop.length +
				activation.authorNoteBottom.length +
				activation.extensionTop.length +
				activation.extensionBottom.length;
			if (unmapped > 0) parts.push(`未映射 ${unmapped} 条`);
			if (activation.deadlineExceeded) parts.push("时间预算用尽");
			if (activation.budgetExceeded) parts.push("token 预算用尽");
			return { messages, source: parts.join("；") };
		},
	};

	return {
		lore,
		activate,
		wrapHistory(base: ContextSlotProvider): ContextSlotProvider {
			return {
				get packKey() {
					return `${base.packKey ?? "history"}:st-world-info:${generation}`;
				},
				...(base.plugin === undefined ? {} : { plugin: base.plugin }),
				async provide(request) {
					const activation = await activate(request);
					const content = await base.provide(request);
					if (content === null) return null;
					if (activation.depth.length === 0) return content;
					return {
						...content,
						messages: injectStWorldInfoDepthMessages(
							content.messages,
							activation.depth,
						),
					};
				},
			};
		},
	};
}

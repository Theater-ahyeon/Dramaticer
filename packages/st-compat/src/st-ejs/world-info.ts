import {
	type JsonObject,
	type LlmRole,
	createTokenEstimator,
} from "@dramaticer/core";
import {
	EMPTY_ST_WORLD_INFO_TIMED_EFFECTS,
	type StWorldInfoActivatedEntry,
	type StWorldInfoActivation,
	type StWorldInfoGlobalScanData,
	type StWorldInfoScanSettings,
	type StWorldInfoTimedEffectsState,
	activateStWorldInfo,
	collectStWorldInfoEntries,
} from "../st-content/world-info-activation.js";
import type { StWorldInfo, StWorldInfoEntry } from "../world-info.js";
import { parseStEjsDecorators } from "./decorators.js";

/**
 * ST-Prompt-Template 的世界书读取与激活函数。
 * 世界书数据由调用方注入；函数不读文件、不写台账，也不改楼层原文。
 */

const DEFAULT_ENTRY_ORDER = 100;
const DEFAULT_ENTRY_DEPTH = 4;
const DEFAULT_RECURSION_STEPS = 3;
const MAX_WORLD_INFO_DEPTH = 8;
const DEPTH_ROLES: Readonly<Record<number, LlmRole>> = {
	0: "system",
	1: "user",
	2: "assistant",
};

export interface StEjsWorldInfoEntryData {
	readonly world: string;
	readonly uid: number | null;
	readonly sourceKey: string;
	readonly comment: string;
	readonly keys: readonly string[];
	readonly secondaryKeys: readonly string[];
	readonly content: string;
	readonly enabled: boolean;
	readonly constant: boolean;
	readonly order: number;
	readonly position: number;
	readonly depth: number;
	readonly role: LlmRole;
	readonly outletName: string | null;
	readonly raw: JsonObject;
}

export type StEjsWorldInfoActivationSource = "keyword" | "activate";

export interface StEjsActivatedWorldInfoEntryData
	extends StEjsWorldInfoEntryData {
	readonly activatedBy: StEjsWorldInfoActivationSource;
}

export interface StEjsWorldInfoOptions {
	readonly worlds?: readonly StWorldInfo[];
	/** 省略世界书名时使用的世界书；必须是 `worlds` 里的一个。 */
	readonly currentWorld?: string | null;
	/** 旧到新排序的对话楼层。 */
	readonly messages?: readonly string[];
	readonly settings?: StWorldInfoScanSettings;
	readonly globalScanData?: StWorldInfoGlobalScanData;
	readonly timedEffects?: StWorldInfoTimedEffectsState;
	/** 调用方已经算好的激活结果；提供时不再重新扫描。 */
	readonly activation?: StWorldInfoActivation;
	readonly estimateTokens?: (text: string) => number;
}

export interface StEjsWorldInfoReadOptions {
	/** 把条目正文当成模板渲染；`raw` 为真时原样返回。 */
	readonly raw?: boolean;
	/** 递归激活条目正文触发的其他条目。 */
	readonly recursive?: boolean;
	/** 递归轮数上限；只在 `recursive` 为真时生效。 */
	readonly maxRecursionSteps?: number;
	readonly separator?: string;
}

export interface StEjsWorldInfoKeywordOptions {
	readonly recursive?: boolean;
	readonly maxRecursionSteps?: number;
	readonly scanDepth?: number;
	readonly caseSensitive?: boolean;
	readonly matchWholeWords?: boolean;
}

export interface StEjsTokenUsage {
	readonly source: string;
	readonly tokens: number;
}

export class StEjsWorldInfoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StEjsWorldInfoError";
	}
}

export class StEjsBudgetError extends Error {
	readonly source: string;
	readonly used: number;
	readonly limit: number;

	constructor(source: string, used: number, limit: number) {
		super(`模板输出超出 token 预算：${source} 累计 ${used}，上限 ${limit}`);
		this.name = "StEjsBudgetError";
		this.source = source;
		this.used = used;
		this.limit = limit;
	}
}

export interface StEjsWorldInfoHost {
	render(text: string, source: string): Promise<string>;
	estimateTokens(text: string): number;
}

function entryData(
	world: string,
	entry: StWorldInfoEntry,
): StEjsWorldInfoEntryData {
	const position = entry.position ?? 0;
	const role =
		position === 4 && entry.role !== null
			? (DEPTH_ROLES[entry.role] ?? "system")
			: "system";
	return {
		world,
		uid: entry.uid,
		sourceKey: entry.sourceKey,
		comment: entry.comment,
		keys: [...entry.keys],
		secondaryKeys: [...entry.secondaryKeys],
		content: entry.content,
		enabled: !entry.disabled,
		constant: entry.constant,
		order: entry.insertionOrder ?? DEFAULT_ENTRY_ORDER,
		position,
		depth: entry.depth ?? DEFAULT_ENTRY_DEPTH,
		role,
		outletName: entry.outletName,
		raw: entry.raw,
	};
}

function activatedData(
	entry: StWorldInfoActivatedEntry,
	source: StEjsWorldInfoActivationSource,
): StEjsActivatedWorldInfoEntryData {
	return {
		world: entry.world,
		uid: entry.uid,
		sourceKey: entry.sourceKey,
		comment: "",
		keys: [],
		secondaryKeys: [],
		content: entry.content,
		enabled: true,
		constant: false,
		order: entry.order,
		position: entry.position,
		depth: entry.depth,
		role: entry.role,
		outletName: entry.outletName,
		raw: {},
		activatedBy: source,
	};
}

/** 激活结果里没有条目元数据，回到世界书里补齐。 */
function findEntry(
	worlds: readonly StWorldInfo[],
	world: string,
	targetUid: number,
): { readonly world: string; readonly entry: StWorldInfoEntry } | null {
	for (const item of collectStWorldInfoEntries(worlds)) {
		const uid = item.entry.uid ?? -1;
		if (item.world === world && uid === targetUid) return item;
	}
	return null;
}

function entryKey(world: string, entry: StWorldInfoEntry): string {
	return `${world}.${entry.uid === null ? entry.sourceKey : entry.uid}`;
}

function activatedKey(world: string, uid: number, sourceKey: string): string {
	return `${world}.${uid < 0 ? sourceKey : uid}`;
}

function matchesName(
	entry: StWorldInfoEntry,
	value: string,
	caseSensitive: boolean,
): boolean {
	const normalize = (text: string) =>
		caseSensitive ? text : text.toLowerCase();
	const target = normalize(value);
	return (
		normalize(entry.comment) === target ||
		entry.keys.some((key) => normalize(key) === target)
	);
}

function resolveSteps(
	value: number | undefined,
	fallback: number | null,
): number {
	if (value !== undefined) {
		if (!Number.isInteger(value) || value < 0) {
			throw new StEjsWorldInfoError("递归轮数上限必须是非负整数");
		}
		return value;
	}
	return fallback ?? DEFAULT_RECURSION_STEPS;
}

export class StEjsWorldInfo {
	readonly #worlds: readonly StWorldInfo[];
	readonly #worldNames: readonly string[];
	readonly #currentWorld: string | null;
	readonly #messages: readonly string[];
	readonly #settings: StWorldInfoScanSettings;
	readonly #globalScanData: StWorldInfoGlobalScanData | undefined;
	readonly #timedEffects: StWorldInfoTimedEffectsState;
	readonly #activation: StWorldInfoActivation | null;
	readonly #host: StEjsWorldInfoHost;
	readonly #forced = new Map<string, StEjsActivatedWorldInfoEntryData>();
	readonly #usage: StEjsTokenUsage[] = [];
	#cachedActivation: StWorldInfoActivation | null = null;
	#renderDepth = 0;
	#totalTokens = 0;
	#budgetTokens: number | null;

	constructor(
		options: StEjsWorldInfoOptions,
		host: StEjsWorldInfoHost,
		budgetTokens: number | null = null,
	) {
		this.#worlds = options.worlds ?? [];
		this.#worldNames = this.#worlds.map(
			(world, index) => world.name ?? `world-${index + 1}`,
		);
		this.#currentWorld = options.currentWorld ?? null;
		if (
			this.#currentWorld !== null &&
			!this.#worldNames.includes(this.#currentWorld)
		) {
			throw new StEjsWorldInfoError(
				`当前世界书 ${this.#currentWorld} 不在提供的世界书里`,
			);
		}
		this.#messages = options.messages ?? [];
		this.#settings = options.settings ?? {};
		this.#globalScanData = options.globalScanData;
		this.#timedEffects =
			options.timedEffects ?? EMPTY_ST_WORLD_INFO_TIMED_EFFECTS;
		this.#activation = options.activation ?? null;
		this.#host = host;
		if (
			budgetTokens !== null &&
			(!Number.isInteger(budgetTokens) || budgetTokens < 1)
		) {
			throw new StEjsWorldInfoError("token 预算必须是正整数");
		}
		this.#budgetTokens = budgetTokens;
	}

	getTokenUsage(): readonly StEjsTokenUsage[] {
		return this.#usage;
	}

	getTokenTotal(): number {
		return this.#totalTokens;
	}

	setBudgetTokens(value: number | null): void {
		if (value !== null && (!Number.isInteger(value) || value < 1)) {
			throw new StEjsWorldInfoError("token 预算必须是正整数");
		}
		this.#budgetTokens = value;
	}

	/** 读取世界书条目正文；省略世界书名时使用当前世界书。 */
	async getWorldInfo(
		worldOrKey: string,
		keyOrOptions?: string | StEjsWorldInfoReadOptions,
		maybeOptions?: StEjsWorldInfoReadOptions,
	): Promise<string> {
		let world: string | null;
		let key: string;
		let options: StEjsWorldInfoReadOptions;
		if (typeof keyOrOptions === "string") {
			world = worldOrKey;
			key = keyOrOptions;
			options = maybeOptions ?? {};
		} else {
			world = this.#currentWorld;
			key = worldOrKey;
			options = keyOrOptions ?? {};
		}
		if (typeof key !== "string" || key.trim().length === 0) {
			throw new StEjsWorldInfoError("getwi 需要非空的条目名称");
		}
		const resolved = this.#resolveEntry(world, key);
		const source = `世界书 ${resolved.world}:${resolved.entry.comment || key}`;
		const body = parseStEjsDecorators(resolved.entry.content).content;
		const rendered =
			options.raw === true ? body : await this.#render(body, source);
		const separator = options.separator ?? "\n";
		const chunks = [rendered];
		if (options.recursive === true) {
			const steps = resolveSteps(
				options.maxRecursionSteps,
				this.#settings.maxRecursionSteps ?? null,
			);
			const extra = this.#scan(rendered, {
				...this.#settings,
				scanDepth: 1,
				recursive: true,
				maxRecursionSteps: steps,
			});
			for (const entry of extra) {
				if (
					entryKey(resolved.world, resolved.entry) ===
					entryKey(entry.world, entry.entry)
				) {
					continue;
				}
				const extraSource = `世界书 ${entry.world}:${entry.entry.comment || entry.entry.uid}`;
				const extraBody = parseStEjsDecorators(entry.entry.content).content;
				chunks.push(await this.#render(extraBody, extraSource));
			}
		}
		return chunks.join(separator);
	}

	/** 把指定条目加入本次激活结果；返回新加入的数据。 */
	activateWorldInfo(
		world: string,
		keys?: string | readonly string[],
	): readonly StEjsActivatedWorldInfoEntryData[] {
		const index = this.#worldIndex(world);
		const selected =
			keys === undefined ? null : Array.isArray(keys) ? keys : [keys];
		const added: StEjsActivatedWorldInfoEntryData[] = [];
		for (const entry of this.#worlds[index]?.entries ?? []) {
			if (entry.disabled) continue;
			if (
				selected !== null &&
				!selected.some((key) =>
					matchesName(entry, key, this.#settings.caseSensitive ?? false),
				)
			) {
				continue;
			}
			const key = entryKey(this.#worldNames[index] as string, entry);
			if (this.#forced.has(key)) continue;
			const data: StEjsActivatedWorldInfoEntryData = {
				...entryData(this.#worldNames[index] as string, entry),
				activatedBy: "activate",
			};
			this.#forced.set(key, data);
			added.push(data);
		}
		return added;
	}

	/** 用给定文本做关键词扫描，把命中的条目加入本次激活结果。 */
	activateWorldInfoByKeywords(
		text: string,
		options: StEjsWorldInfoKeywordOptions = {},
	): readonly StEjsActivatedWorldInfoEntryData[] {
		if (typeof text !== "string") {
			throw new StEjsWorldInfoError("activateWorldInfoByKeywords 需要文本");
		}
		const steps = resolveSteps(options.maxRecursionSteps, null);
		const activated = this.#scan(text, {
			...this.#settings,
			scanDepth: options.scanDepth ?? this.#settings.scanDepth ?? 2,
			recursive: options.recursive ?? true,
			maxRecursionSteps: steps,
			caseSensitive: options.caseSensitive ?? this.#settings.caseSensitive,
			matchWholeWords:
				options.matchWholeWords ?? this.#settings.matchWholeWords,
		});
		const added: StEjsActivatedWorldInfoEntryData[] = [];
		for (const item of activated) {
			const world = item.world;
			const key = entryKey(world, item.entry);
			if (this.#forced.has(key)) continue;
			const data: StEjsActivatedWorldInfoEntryData = {
				...entryData(world, item.entry),
				activatedBy: "keyword",
			};
			this.#forced.set(key, data);
			added.push(data);
		}
		return added;
	}

	/** 指定世界书的全部条目；省略时返回全部世界书。 */
	getWorldInfoData(world?: string): readonly StEjsWorldInfoEntryData[] {
		const indexes =
			world === undefined
				? this.#worlds.map((_, index) => index)
				: [this.#worldIndex(world)];
		return indexes.flatMap((index) =>
			(this.#worlds[index]?.entries ?? []).map((entry) =>
				entryData(this.#worldNames[index] as string, entry),
			),
		);
	}

	/** 关键词激活结果加上 `activateWorldInfo` 加入的条目。 */
	getWorldInfoActivatedData(): readonly StEjsActivatedWorldInfoEntryData[] {
		const activation = this.#getActivation();
		const result: StEjsActivatedWorldInfoEntryData[] = [];
		const seen = new Set<string>();
		for (const entry of activation.entries) {
			const key = activatedKey(entry.world, entry.uid, entry.sourceKey);
			seen.add(key);
			result.push(this.#activatedEntry(entry, "keyword"));
		}
		for (const [key, data] of this.#forced) {
			if (seen.has(key)) continue;
			seen.add(key);
			result.push(data);
		}
		return result;
	}

	getEnabledWorldInfoEntries(
		world?: string,
	): readonly StEjsWorldInfoEntryData[] {
		return this.getWorldInfoData(world).filter((entry) => entry.enabled);
	}

	/** 从候选名称或条目里挑出已经激活的条目，保持激活顺序。 */
	selectActivatedEntries(
		candidates:
			| string
			| StEjsWorldInfoEntryData
			| readonly (string | StEjsWorldInfoEntryData)[],
	): readonly StEjsActivatedWorldInfoEntryData[] {
		const list = Array.isArray(candidates)
			? candidates
			: [candidates as string | StEjsWorldInfoEntryData];
		const activated = this.getWorldInfoActivatedData();
		const selected: StEjsActivatedWorldInfoEntryData[] = [];
		const seen = new Set<string>();
		for (const candidate of list) {
			for (const entry of activated) {
				if (!this.#matchesCandidate(entry, candidate)) continue;
				const key = activatedKey(entry.world, entry.uid ?? -1, entry.sourceKey);
				if (seen.has(key)) continue;
				seen.add(key);
				selected.push(entry);
			}
		}
		return selected;
	}

	#matchesCandidate(
		entry: StEjsActivatedWorldInfoEntryData,
		candidate: string | StEjsWorldInfoEntryData,
	): boolean {
		if (typeof candidate === "string") {
			const target = candidate.trim();
			if (target.length === 0) return false;
			const id =
				entry.uid === null || entry.uid < 0
					? entry.sourceKey
					: String(entry.uid);
			return (
				entry.comment === target ||
				entry.keys.includes(target) ||
				entry.sourceKey === target ||
				`${entry.world}.${id}` === target ||
				`${entry.world}/${entry.comment || id}` === target
			);
		}
		if (typeof candidate !== "object" || candidate === null) {
			throw new StEjsWorldInfoError(
				"selectActivatedEntries 的候选必须是字符串或条目",
			);
		}
		const world = candidate.world;
		if (world !== entry.world) return false;
		if (candidate.uid !== null && candidate.uid !== undefined) {
			return candidate.uid === entry.uid;
		}
		if (candidate.comment) return candidate.comment === entry.comment;
		return candidate.sourceKey === entry.sourceKey;
	}

	#activatedEntry(
		entry: StWorldInfoActivatedEntry,
		source: StEjsWorldInfoActivationSource,
	): StEjsActivatedWorldInfoEntryData {
		const found = findEntry(this.#worlds, entry.world, entry.uid);
		if (found === null) return activatedData(entry, source);
		return {
			...entryData(entry.world, found.entry),
			activatedBy: source,
		};
	}

	/** 世界书激活结果：优先用调用方提供的，其次按运行时楼层扫描一次。 */
	#getActivation(): StWorldInfoActivation {
		if (this.#activation !== null) return this.#activation;
		if (this.#cachedActivation !== null) return this.#cachedActivation;
		this.#cachedActivation = activateStWorldInfo({
			worlds: this.#worlds,
			messages: [...this.#messages].reverse(),
			chatLength: this.#messages.length,
			settings: this.#settings,
			globalScanData: this.#globalScanData,
			timedEffects: this.#timedEffects,
		});
		return this.#cachedActivation;
	}

	#scan(
		text: string,
		settings: StWorldInfoScanSettings,
	): readonly { readonly world: string; readonly entry: StWorldInfoEntry }[] {
		const activation = activateStWorldInfo({
			worlds: this.#worlds,
			messages: [text],
			chatLength: this.#messages.length,
			settings,
			globalScanData: this.#globalScanData,
			dryRun: true,
		});
		return activation.entries.flatMap((entry) => {
			const found = findEntry(this.#worlds, entry.world, entry.uid);
			if (found === null || found.entry.constant) return [];
			return [found];
		});
	}

	#resolveEntry(
		world: string | null,
		key: string,
	): { readonly world: string; readonly entry: StWorldInfoEntry } {
		const indexes =
			world === null
				? this.#worlds.map((_, index) => index)
				: [this.#worldIndex(world)];
		for (const index of indexes) {
			const name = this.#worldNames[index] as string;
			const entry = (this.#worlds[index]?.entries ?? []).find((item) =>
				matchesName(item, key, false),
			);
			if (entry !== undefined) return { world: name, entry };
		}
		const where = world === null ? "任何一个世界书" : world;
		throw new StEjsWorldInfoError(`世界书 ${where} 里没有条目 ${key}`);
	}

	#worldIndex(world: string): number {
		const index = this.#worldNames.indexOf(world);
		if (index < 0) {
			throw new StEjsWorldInfoError(`没有世界书 ${world}`);
		}
		return index;
	}

	async #render(text: string, source: string): Promise<string> {
		if (this.#renderDepth >= MAX_WORLD_INFO_DEPTH) {
			throw new StEjsWorldInfoError(
				`getwi 嵌套超过 ${MAX_WORLD_INFO_DEPTH} 层：${source}`,
			);
		}
		this.#renderDepth += 1;
		try {
			const output = await this.#host.render(text, source);
			this.#charge(output, source);
			return output;
		} finally {
			this.#renderDepth -= 1;
		}
	}

	#charge(text: string, source: string): void {
		const tokens = this.#host.estimateTokens(text);
		this.#totalTokens += tokens;
		this.#usage.push({ source, tokens });
		if (this.#budgetTokens !== null && this.#totalTokens > this.#budgetTokens) {
			throw new StEjsBudgetError(source, this.#totalTokens, this.#budgetTokens);
		}
	}
}

export function createStEjsWorldInfo(
	options: StEjsWorldInfoOptions,
	host: StEjsWorldInfoHost,
	budgetTokens: number | null = null,
): StEjsWorldInfo {
	return new StEjsWorldInfo(options, host, budgetTokens);
}

export const defaultStEjsTokenEstimator = createTokenEstimator();

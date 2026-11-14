import type { BackgroundJobHandler } from "../background/types.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type ImportAuditEntry,
	type ImportEntryKind,
	assertImportEntryKind,
} from "./import-audit.js";
import { parseJsonOutputObject } from "./json-output.js";

export const IMPORT_KIND_JOB_KIND = "import_kind";

/** 一次请求最多分类的条目数。 */
export const IMPORT_KIND_BATCH_SIZE = 40;

/** 一次任务最多发出的请求数；剩下的未识别条目留给下一次 drain。 */
export const IMPORT_KIND_MAX_BATCHES_PER_RUN = 8;

/** 送进提示词的正文上限；分类只看开头，原文一字不改。 */
export const IMPORT_KIND_CONTENT_CHARS = 800;

const RESPONSE_FIELDS = ["entries"] as const;
const ENTRY_FIELDS = ["source", "kind"] as const;

export interface ImportKindSuggestion {
	readonly source: string;
	readonly kind: ImportEntryKind;
}

const KIND_GUIDE = [
	"common：通用设定，每轮都要看到的背景事实。",
	"entity：人物、地点、物品的档案；只需要标题与关键词就能检索到。",
	"rule：可以计算执行的规则，例如检定、资源扣减。",
	"state：状态表与状态定义。",
	"conditional：只在特定条件下才生效的内容。",
	"event：事件与舞台，按剧情节点触发。",
	"writing：写作指令、文风要求与格式约束。",
	"presentation：表现资源，例如状态栏、开场页、图片。",
	"options：给玩家的作者选项与菜单。",
	"plugin-residue：插件脚本留下的残留内容，运行时不再使用。",
	"unknown：确实无法归入以上任何一类。",
].join("\n");

const SYSTEM_PROMPT = [
	"你是故事引擎的导入分型助手。输入是一批世界书条目，每条有 source、title 与 content。",
	"为每条条目选择一个类型，只能从下面这些类型里选：",
	KIND_GUIDE,
	"只按条目本身判断，不要改写标题或正文，不要合并条目。",
	'只输出一个 JSON 对象，不要解释、前后缀或代码块标记；形如 {"entries":[{"source":"…","kind":"…"}]}。',
].join("\n");

/** 需要后台模型给类型建议的条目：规则判成 unknown，玩家与模型都还没有改过。 */
export function listPendingImportKindEntries(
	store: StoryStore,
	storyId: string,
): ImportAuditEntry[] {
	return store
		.listImportAuditEntries(storyId)
		.filter((entry) => entry.kind === "unknown" && entry.kindSource === "rule");
}

/** 入队条件为 story：还有等待建议的未识别条目时才建任务。 */
export function importKindSuggestionsNeedRun(
	store: StoryStore,
	storyId: string,
): boolean {
	return listPendingImportKindEntries(store, storyId).length > 0;
}

/**
 * 解析模型返回的类型建议：只能是本批条目、每个来源一次、类型合法。
 * 返回空数组表示模型没有给出任何建议，不算失败。
 */
export function parseImportKindSuggestions(
	text: string,
	allowedSources: readonly string[],
): ImportKindSuggestion[] {
	const record = assertPlainObject(
		parseJsonOutputObject(text, "导入分型建议"),
		"导入分型建议",
	);
	rejectUnknownKeys(record, RESPONSE_FIELDS, "导入分型建议");
	const raw = record.entries;
	if (!Array.isArray(raw)) {
		throw new Error("导入分型建议.entries 必须是数组");
	}
	const allowed = new Set(allowedSources);
	const seen = new Set<string>();
	const suggestions: ImportKindSuggestion[] = [];
	for (const [index, item] of raw.entries()) {
		const label = `导入分型建议.entries[${index}]`;
		const entry = assertPlainObject(item, label);
		rejectUnknownKeys(entry, ENTRY_FIELDS, label);
		if (typeof entry.source !== "string" || entry.source.length === 0) {
			throw new Error(`${label}.source 必须是非空字符串`);
		}
		if (!allowed.has(entry.source)) {
			throw new Error(`${label}.source 不在本批条目里：${entry.source}`);
		}
		if (seen.has(entry.source)) {
			throw new Error(`导入分型建议里重复出现条目：${entry.source}`);
		}
		seen.add(entry.source);
		suggestions.push({
			source: entry.source,
			kind: assertImportEntryKind(entry.kind, `${label}.kind`),
		});
	}
	return suggestions;
}

/** 把一批条目拼成请求内容；正文按上限截断，只用于分类。 */
export function buildImportKindUserContent(
	entries: readonly ImportAuditEntry[],
): string {
	return JSON.stringify({
		entries: entries.map((entry) => ({
			source: entry.source,
			title: entry.title,
			content: [...entry.content].slice(0, IMPORT_KIND_CONTENT_CHARS).join(""),
		})),
	});
}

export interface ImportKindSuggestionHandlerOptions {
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
	readonly batchSize?: number;
	readonly maxBatches?: number;
}

/**
 * 后台任务：给未识别条目逐批补类型建议，来源记为 `model`。
 * 玩家或模型已经改过的条目不会被覆盖，条目原文不变。
 */
export function createImportKindSuggestionHandler(
	options: ImportKindSuggestionHandlerOptions = {},
): BackgroundJobHandler {
	const batchSize = options.batchSize ?? IMPORT_KIND_BATCH_SIZE;
	const maxBatches = options.maxBatches ?? IMPORT_KIND_MAX_BATCHES_PER_RUN;
	return async ({ store, client, job, signal }) => {
		for (let batch = 0; batch < maxBatches; batch += 1) {
			const pending = listPendingImportKindEntries(store, job.storyId);
			if (pending.length === 0) return;
			const selected = pending.slice(0, batchSize);
			const messages: LlmMessage[] = [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: buildImportKindUserContent(selected) },
			];
			const result = await client.complete(
				{
					messages,
					model: options.model,
					temperature: 0,
					signal,
				},
				NO_CONTINUATION,
			);
			const suggestions = parseImportKindSuggestions(
				result.text,
				selected.map((entry) => entry.source),
			);
			applyImportKindSuggestions(store, job.storyId, suggestions);
		}
	};
}

/** 写回建议：只写仍然是规则判成 unknown 的条目，玩家改过的保持不动。 */
export function applyImportKindSuggestions(
	store: StoryStore,
	storyId: string,
	suggestions: readonly ImportKindSuggestion[],
): void {
	if (suggestions.length === 0) return;
	const current = new Map(
		store
			.listImportAuditEntries(storyId)
			.map((entry) => [entry.source, entry] as const),
	);
	for (const suggestion of suggestions) {
		const entry = current.get(suggestion.source);
		if (entry === undefined) {
			throw new Error(`导入审计条目不存在：${suggestion.source}`);
		}
		if (entry.kind !== "unknown" || entry.kindSource !== "rule") continue;
		store.setImportAuditEntryKind(
			storyId,
			suggestion.source,
			suggestion.kind,
			"model",
		);
	}
}

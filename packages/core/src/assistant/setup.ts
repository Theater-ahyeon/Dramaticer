import { createDefaultContextTemplate } from "../chat/template.js";
import { DEFAULT_CONTEXT_TEMPLATE_ID } from "../context/template.js";
import { type JsonObject, rejectUnknownKeys } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import type { DeepToolDefinition } from "../tools/registry.js";
import type { AssistantSearchClient } from "./search.js";
import type { AssistantPermission } from "./types.js";

export const WEB_SEARCH_TOOL_NAME = "web_search";
export const CARD_READ_TOOL_NAME = "card_read";
export const CHANNELS_READ_TOOL_NAME = "channels_read";
export const PROPOSE_LORE_ENTRIES_TOOL_NAME = "propose_lore_entries";
export const PROPOSE_CARD_CHANGE_TOOL_NAME = "propose_card_change";
export const PROPOSE_CHANNELS_CHANGE_TOOL_NAME = "propose_channels_change";
export const PROPOSE_SETTINGS_CHANGE_TOOL_NAME = "propose_settings_change";

const CARD_FIELD_NAMES = ["cardName", "characterPrompt", "persona"] as const;
const CHANNELS_ARGUMENTS = [
	"channels",
	"models",
	"embeddings",
	"roles",
] as const;
const MAX_SEARCH_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 5;

/** 渠道读取只返回配置结构的非敏感部分；密钥值不会进入这个结构。 */
export interface AssistantChannelsSnapshot {
	readonly channels: readonly {
		readonly id: string;
		readonly api: string;
		readonly baseUrl: string;
		readonly apiKeyEnv: string | null;
		readonly apiKeySet: boolean;
		readonly requestsPerMinute: number;
		readonly maxRetries: number;
		readonly retryBaseDelayMs: number;
		readonly timeoutMs: number;
	}[];
	readonly models: readonly {
		readonly alias: string;
		readonly id: string;
		readonly contextWindow: number;
		readonly maxTokens: number;
		readonly reasoning: boolean;
		readonly enabled: boolean;
		readonly channels: readonly string[];
	}[];
	readonly embeddings: readonly {
		readonly id: string;
		readonly api: string;
		readonly baseUrl: string;
		readonly apiKeyEnv: string | null;
		readonly apiKeySet: boolean;
		readonly model: string;
		readonly dimensions: number;
		readonly batchSize: number;
		readonly requestsPerMinute: number;
		readonly maxRetries: number;
		readonly retryBaseDelayMs: number;
		readonly timeoutMs: number;
	}[];
	readonly roles: Readonly<Record<string, string | null>>;
	readonly configuredRoles: Readonly<Record<string, string>>;
}

export interface AssistantSetupToolOptions {
	readonly store: StoryStore;
	readonly storyId: string | null;
	readonly conversationId: string;
	readonly permission: AssistantPermission;
	/** 没有显式开启联网搜索时为 undefined，此时不生成 `web_search`。 */
	readonly searchClient?: AssistantSearchClient | null;
	/** 没有渠道配置文件的 server 不提供这个读取器。 */
	readonly readChannels?: (() => Promise<AssistantChannelsSnapshot>) | null;
	readonly now?: () => string;
}

/**
 * 资料员、卡片工坊与设置向导使用的工具。读取工具只读；提案工具只生成
 * 待确认动作，批准走助手动作的既有接口。只读级别不能生成任何提案。
 */
export function createAssistantSetupTools(
	options: AssistantSetupToolOptions,
): readonly DeepToolDefinition[] {
	const tools: DeepToolDefinition[] = [];
	if (options.searchClient !== undefined && options.searchClient !== null) {
		const searchClient = options.searchClient;
		tools.push({
			name: WEB_SEARCH_TOOL_NAME,
			description:
				"联网搜索资料。返回标题、链接、摘要与抓取时间；引用结论时必须带上链接。只读。",
			parameters: objectSchema(
				{
					query: { type: "string", minLength: 1 },
					limit: {
						type: "integer",
						minimum: 1,
						maximum: MAX_SEARCH_LIMIT,
					},
				},
				["query"],
			),
			permission: "read",
			progressLabel: "联网搜索……",
			execute: (args: JsonObject) => runWebSearch(searchClient, args),
		});
	}
	tools.push({
		name: CARD_READ_TOOL_NAME,
		description:
			"读取当前故事的卡片与模板：卡片名、人物提示、persona、实体、世界书条目与生效的上下文模板。只读。",
		parameters: objectSchema({}, []),
		permission: "read",
		progressLabel: "读取卡片……",
		execute: (args: JsonObject) => {
			rejectUnknownKeys(args, [], "参数");
			const storyId = requireStoryId(options);
			const settings = options.store.getStorySettings(storyId);
			const templateId = settings.templateId ?? DEFAULT_CONTEXT_TEMPLATE_ID;
			const template =
				templateId === DEFAULT_CONTEXT_TEMPLATE_ID
					? createDefaultContextTemplate({
							structuredOutput: settings.structuredOutput,
						})
					: options.store.getContextTemplate(templateId)?.template;
			if (template === undefined) {
				throw new Error(`故事引用的上下文模板不存在：${templateId}`);
			}
			const payload = {
				card: {
					cardName: settings.cardName,
					characterPrompt: settings.characterPrompt,
					persona: settings.persona,
					templateId: settings.templateId,
				},
				entities: options.store.listEntities(storyId),
				lore: options.store.listLoreEntries(storyId),
				template,
			};
			return `故事 ${storyId} 的卡片：\n${JSON.stringify(payload, null, 2)}`;
		},
	});
	if (options.readChannels !== undefined && options.readChannels !== null) {
		const readChannels = options.readChannels;
		tools.push({
			name: CHANNELS_READ_TOOL_NAME,
			description:
				"读取渠道配置的非敏感部分：渠道 id、模型别名与名称、baseUrl、密钥是否已设置、岗位映射。密钥值永远不会返回。只读。",
			parameters: objectSchema({}, []),
			permission: "read",
			progressLabel: "读取渠道……",
			async execute(args: JsonObject) {
				rejectUnknownKeys(args, [], "参数");
				const snapshot = await readChannels();
				return `渠道配置（不含密钥值）：\n${JSON.stringify(snapshot, null, 2)}`;
			},
		});
	}
	tools.push(
		proposalTool(
			options,
			PROPOSE_LORE_ENTRIES_TOOL_NAME,
			"把调研得到的原作资料整理成世界书条目草案，生成待确认的 lore 动作。先查现有条目，避免重复。",
			"拟世界书条目……",
			{
				entries: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							name: { type: "string", minLength: 1 },
							content: { type: "string", minLength: 1 },
							entityId: { type: ["string", "null"] },
							constant: { type: "boolean" },
							keywords: {
								type: "array",
								items: { type: "string", minLength: 1 },
							},
						},
						required: ["name", "content"],
						additionalProperties: false,
					},
				},
				summary: { type: "string", minLength: 1 },
			},
			["entries", "summary"],
			proposeLoreEntries,
		),
		proposalTool(
			options,
			PROPOSE_CARD_CHANGE_TOOL_NAME,
			"提议修改卡片字段或上下文模板。card 与 template 只能给一个；生成对应种类的待确认动作，玩家批准后才写入。先读卡片再提议。",
			"拟卡片修改……",
			{
				card: {
					type: "object",
					properties: {
						cardName: { type: ["string", "null"] },
						characterPrompt: { type: ["string", "null"] },
						persona: { type: ["string", "null"] },
					},
					additionalProperties: false,
				},
				template: {
					type: "object",
					properties: {
						templateId: { type: ["string", "null"] },
						name: { type: "string", minLength: 1 },
						template: { type: "object" },
					},
					required: ["template"],
					additionalProperties: false,
				},
				summary: { type: "string", minLength: 1 },
			},
			["card", "template", "summary"],
			proposeCardChange,
		),
		proposalTool(
			options,
			PROPOSE_CHANNELS_CHANGE_TOOL_NAME,
			"提议整段渠道配置修改：渠道、模型、embedding 与岗位映射四个段都必须给全，未写的条目会被删除。批准时复用现有配置解析与校验；非法配置会被拒绝并保留待确认状态。",
			"拟渠道修改……",
			{
				channels: { type: "object" },
				models: { type: "object" },
				embeddings: { type: "object" },
				roles: { type: "object" },
				summary: { type: "string", minLength: 1 },
			},
			["channels", "models", "embeddings", "roles", "summary"],
			proposeChannelsChange,
		),
		proposalTool(
			options,
			PROPOSE_SETTINGS_CHANGE_TOOL_NAME,
			"提议修改当前故事的故事设置，生成待确认的 settings 动作。生图配置请使用 image_config 动作，不放在这里。",
			"拟设置修改……",
			{
				settings: { type: "object" },
				summary: { type: "string", minLength: 1 },
			},
			["settings", "summary"],
			proposeSettingsChange,
		),
	);
	return tools;
}

function proposalTool(
	options: AssistantSetupToolOptions,
	name: string,
	description: string,
	progressLabel: string,
	properties: Record<string, unknown>,
	allowedArguments: readonly string[],
	run: (options: AssistantSetupToolOptions, args: JsonObject) => string,
): DeepToolDefinition {
	return {
		name,
		description,
		parameters: objectSchema(properties, []),
		permission: "propose",
		progressLabel,
		execute: (args: JsonObject) => {
			assertProposalPermission(options);
			rejectUnknownKeys(args, allowedArguments, "参数");
			return run(options, args);
		},
	};
}

async function runWebSearch(
	client: AssistantSearchClient,
	args: JsonObject,
): Promise<string> {
	rejectUnknownKeys(args, ["query", "limit"], "参数");
	const query = requireString(args, "query");
	const limit =
		args.limit === undefined
			? DEFAULT_SEARCH_LIMIT
			: readLimit(args.limit, "limit", MAX_SEARCH_LIMIT);
	const results = await client.search(query, limit);
	if (results.length === 0) {
		return `搜索词「${query}」没有返回结果。`;
	}
	const lines = [`搜索词「${query}」的 ${results.length} 条结果：`];
	for (const [index, result] of results.entries()) {
		lines.push(
			`${index + 1}. ${result.title}\n   链接：${result.url}\n   抓取时间：${result.fetchedAt}\n   摘要：${result.snippet}`,
		);
	}
	return lines.join("\n");
}

function proposeLoreEntries(
	options: AssistantSetupToolOptions,
	args: JsonObject,
): string {
	const entries = args.entries;
	if (!Array.isArray(entries) || entries.length === 0) {
		throw new Error("参数.entries 必须是非空数组");
	}
	const names = entries.map((entry, index) => {
		if (!isPlainObject(entry) || typeof entry.name !== "string") {
			throw new Error(`参数.entries[${index}] 必须是带 name 的对象`);
		}
		return entry.name;
	});
	const summary = readSummary(args.summary, `世界书条目：${names.join("、")}`);
	return createAction(options, "lore", summary, { entries });
}

function proposeCardChange(
	options: AssistantSetupToolOptions,
	args: JsonObject,
): string {
	const hasCard = args.card !== undefined;
	const hasTemplate = args.template !== undefined;
	if (hasCard === hasTemplate) {
		throw new Error("参数.card 与参数.template 必须且只能给一个");
	}
	if (hasCard) {
		if (!isPlainObject(args.card)) {
			throw new Error("参数.card 必须是对象");
		}
		const fields: JsonObject = {};
		for (const key of CARD_FIELD_NAMES) {
			const value = args.card[key];
			if (value === undefined) continue;
			if (value !== null && typeof value !== "string") {
				throw new Error(`参数.card.${key} 必须是字符串或 null`);
			}
			fields[key] = value;
		}
		if (Object.keys(fields).length === 0) {
			throw new Error("参数.card 至少要包含一个卡片字段");
		}
		const summary = readSummary(
			args.summary,
			`卡片字段：${Object.keys(fields).join("、")}`,
		);
		return createAction(options, "card", summary, fields);
	}
	if (!isPlainObject(args.template)) {
		throw new Error("参数.template 必须是对象");
	}
	if (!isPlainObject(args.template.template)) {
		throw new Error("参数.template.template 必须是对象");
	}
	const payload: JsonObject = { template: args.template.template };
	const templateId = args.template.templateId;
	if (templateId !== undefined) {
		if (templateId !== null && typeof templateId !== "string") {
			throw new Error("参数.template.templateId 必须是字符串或 null");
		}
		payload.templateId = templateId;
	}
	const name = args.template.name;
	if (name !== undefined) {
		if (typeof name !== "string" || name.trim().length === 0) {
			throw new Error("参数.template.name 必须是非空字符串");
		}
		payload.name = name;
	}
	const summary = readSummary(
		args.summary,
		typeof name === "string" ? `上下文模板：${name}` : "上下文模板草案",
	);
	return createAction(options, "template", summary, payload);
}

function proposeChannelsChange(
	options: AssistantSetupToolOptions,
	args: JsonObject,
): string {
	const payload: JsonObject = {};
	for (const key of CHANNELS_ARGUMENTS) {
		const value = args[key];
		if (!isPlainObject(value)) {
			throw new Error(`参数.${key} 必须是与现有配置等价的完整对象`);
		}
		payload[key] = value;
	}
	const summary = readSummary(
		args.summary,
		`渠道配置修改：${Object.keys(payload).join("、")}`,
	);
	return createAction(options, "channels", summary, payload);
}

function proposeSettingsChange(
	options: AssistantSetupToolOptions,
	args: JsonObject,
): string {
	if (!isPlainObject(args.settings)) {
		throw new Error("参数.settings 必须是对象");
	}
	if (Object.keys(args.settings).length === 0) {
		throw new Error("参数.settings 至少要包含一个设置字段");
	}
	const summary = readSummary(
		args.summary,
		`故事设置修改：${Object.keys(args.settings).join("、")}`,
	);
	return createAction(options, "settings", summary, args.settings);
}

function createAction(
	options: AssistantSetupToolOptions,
	kind: "lore" | "card" | "template" | "channels" | "settings",
	summary: string,
	payload: JsonObject,
): string {
	const action = options.store.createAssistantAction({
		conversationId: options.conversationId,
		kind,
		summary,
		payload,
		...(options.now === undefined ? {} : { createdAt: options.now() }),
	});
	return [
		`已生成待确认动作 ${action.id}（${action.kind}，状态 ${action.status}）。`,
		summary,
		"玩家批准后才写入；拒绝不改任何内容。",
	].join("\n");
}

function assertProposalPermission(options: AssistantSetupToolOptions): void {
	if (options.permission === "read_only") {
		throw new Error(
			"permission_denied：会话权限是 read_only，不能生成待确认动作。",
		);
	}
}

function requireStoryId(options: AssistantSetupToolOptions): string {
	if (options.storyId === null) {
		throw new Error("这个技能需要关联故事；当前助手会话没有关联故事");
	}
	return options.storyId;
}

function readSummary(value: unknown, fallback: string): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("参数.summary 必须是非空字符串");
	}
	return value.trim();
}

function requireString(args: JsonObject, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`参数.${key} 必须是非空字符串`);
	}
	return value.trim();
}

function readLimit(value: unknown, label: string, max: number): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`参数.${label} 必须是整数`);
	}
	if (value < 1 || value > max) {
		throw new Error(`参数.${label} 必须在 1 到 ${max} 之间`);
	}
	return value;
}

function isPlainObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectSchema(
	properties: Record<string, unknown>,
	required: readonly string[],
): Record<string, unknown> {
	return { type: "object", properties, required, additionalProperties: false };
}

import { createDefaultContextTemplate } from "../chat/template.js";
import { DEFAULT_CONTEXT_TEMPLATE_ID } from "../context/template.js";
import { readDirectorPlan, resolveCurrentBeat } from "../director/plan.js";
import { explainNode, renderExplainReport } from "../explain/explain.js";
import type { JsonObject } from "../json.js";
import type { EmbeddingClient } from "../llm/embeddings.js";
import type { RerankClient } from "../llm/rerank.js";
import { BUILTIN_PLUGINS } from "../plugins/builtin.js";
import type { TurnRunRecord } from "../run-log.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type ReadToolContext,
	executeReadTool,
	validateReadToolArguments,
} from "../tools/read-tools.js";
import type { DeepToolDefinition } from "../tools/registry.js";
import { defineAssistantTool } from "./permissions.js";
import {
	type AssistantPermission,
	DEFAULT_ASSISTANT_PERMISSION,
} from "./types.js";

/** 应用内助手的只读工具名；没有草稿、提交、手记、正文写入与生图工具。 */
export const ASSISTANT_TOOL_NAMES = [
	"explain_node",
	"run_log_read",
	"memory_search",
	"ledger_read",
	"lore_lookup",
	"state_get",
	"director_read",
	"settings_read",
	"template_read",
	"plugin_list",
	"summarize_recent",
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

const ASSISTANT_TOOL_NAME_SET: ReadonlySet<string> = new Set(
	ASSISTANT_TOOL_NAMES,
);

/** 单次工具结果超过这个长度就截断，并把原长与截断位置写进结果。 */
export const MAX_ASSISTANT_TOOL_RESULT_CHARS = 32_000;

const MAX_MEMORY_SEARCH_LIMIT = 10;
const MAX_LOG_EVENTS = 200;
const MAX_LOG_RUNS = 10;

export function isAssistantToolName(
	value: unknown,
): value is AssistantToolName {
	return typeof value === "string" && ASSISTANT_TOOL_NAME_SET.has(value);
}

export interface AssistantToolContext {
	readonly store: StoryStore;
	/** 会话关联的故事；不关联故事时为 null。 */
	readonly storyId: string | null;
	/** 会话权限；缺省按修改前确认处理。 */
	readonly permission?: AssistantPermission;
	readonly conversationId?: string;
	readonly embedder?: EmbeddingClient | null;
	readonly reranker?: RerankClient | null;
	/** 技能附带的工具；与只读工具一起按会话权限包装。 */
	readonly extraTools?: readonly DeepToolDefinition[];
	readonly onToolCall?: (name: string, args: JsonObject) => void;
	readonly onToolResult?: (name: string, ok: boolean, content: string) => void;
	readonly onPermissionDenied?: (
		name: string,
		permission: string,
		reason: string,
	) => void;
}

/**
 * 建立助手本次运行可用的只读工具。每个工具自己校验参数与故事范围，
 * 结果统一按字符数截断；工具不会写楼层、台账、设置或文件。
 */
export function createAssistantTools(
	context: AssistantToolContext,
): readonly DeepToolDefinition[] {
	const permission = context.permission ?? DEFAULT_ASSISTANT_PERMISSION;
	const define = (
		name: AssistantToolName,
		description: string,
		parameters: Record<string, unknown>,
		progressLabel: string,
		run: (args: JsonObject) => string | Promise<string>,
	): DeepToolDefinition =>
		defineAssistantTool(
			{
				permission,
				conversationId: context.conversationId ?? "",
				onToolCall: context.onToolCall,
				onToolResult: context.onToolResult,
				onPermissionDenied: context.onPermissionDenied,
			},
			{
				name,
				description,
				parameters,
				permission: "read",
				progressLabel,
				execute: async (args: JsonObject) => fitResult(await run(args)),
			},
		);

	const readTools = [
		define(
			"explain_node",
			"解释一个楼层这一轮为什么这么写：Trace、上下文分段与 token、被裁剪的段落、检索名次、台账、导演决策、当前拍与修正建议。只读。",
			objectSchema({ nodeId: { type: "string", minLength: 1 } }, ["nodeId"]),
			"排障楼层……",
			(args) => {
				const storyId = requireStory(context);
				const nodeId = requireString(args, "nodeId");
				const node = context.store.getNode(nodeId);
				if (node === null) throw new Error(`楼层节点不存在：${nodeId}`);
				if (node.storyId !== storyId) {
					throw new Error(`楼层 ${nodeId} 属于另一个故事 ${node.storyId}`);
				}
				return renderExplainReport(explainNode(context.store, nodeId));
			},
		),
		define(
			"run_log_read",
			"读取深回合的运行日志：按运行 id 或助手楼层 id 读取事件时间线；都不给时列出故事最近几次运行。只读。",
			objectSchema(
				{
					runId: { type: "string", minLength: 1 },
					nodeId: { type: "string", minLength: 1 },
					limit: { type: "integer", minimum: 1, maximum: MAX_LOG_EVENTS },
				},
				[],
			),
			"读取运行日志……",
			(args) => runLogRead(context, args),
		),
		define(
			"memory_search",
			"沿当前 head 路径检索记忆与事件，最多 10 条。只读。",
			objectSchema(
				{
					query: { type: "string", minLength: 1 },
					limit: { type: "integer", minimum: 1, maximum: 10 },
				},
				["query"],
			),
			"检索记忆……",
			async (args) => {
				const scope = requireStoryHead(context);
				const validated = validateReadToolArguments("memory_search", {
					query: requireString(args, "query"),
					...(args.limit === undefined
						? {}
						: {
								limit: readLimit(args.limit, "limit", MAX_MEMORY_SEARCH_LIMIT),
							}),
				});
				return await executeReadTool(
					"memory_search",
					validated,
					readContext(context, scope.storyId, scope.headId),
				);
			},
		),
		define(
			"ledger_read",
			"按路径前缀读取当前 head 的台账事实及其来源、故事时间与写入楼层。只读。",
			objectSchema(
				{
					prefix: {
						type: "array",
						items: { type: "string", minLength: 1 },
						minItems: 1,
					},
				},
				[],
			),
			"读取台账……",
			async (args) => {
				const scope = requireStoryHead(context);
				const validated = validateReadToolArguments("ledger_read", {
					...(args.prefix === undefined
						? {}
						: { prefix: readStringArray(args.prefix, "prefix") }),
				});
				return await executeReadTool(
					"ledger_read",
					validated,
					readContext(context, scope.storyId, scope.headId),
				);
			},
		),
		define(
			"lore_lookup",
			"按关键词、实体名或别名查询世界书条目与实体档案。只读。",
			objectSchema(
				{
					query: { type: "string", minLength: 1 },
					limit: { type: "integer", minimum: 1, maximum: 20 },
				},
				["query"],
			),
			"查阅世界书……",
			async (args) => {
				const storyId = requireStory(context);
				const head = context.store.getHead(storyId);
				const validated = validateReadToolArguments("lore_lookup", {
					query: requireString(args, "query"),
					...(args.limit === undefined
						? {}
						: { limit: readLimit(args.limit, "limit", 20) }),
				});
				return await executeReadTool(
					"lore_lookup",
					validated,
					readContext(context, storyId, head?.id ?? ""),
				);
			},
		),
		define(
			"state_get",
			"读取当前 head 的累计状态；给出 path 时只返回该路径的值。只读。",
			objectSchema(
				{
					path: {
						type: "array",
						items: { type: "string", minLength: 1 },
						minItems: 1,
					},
				},
				[],
			),
			"读取状态……",
			async (args) => {
				const scope = requireStoryHead(context);
				const validated = validateReadToolArguments("state_get", {
					...(args.path === undefined
						? {}
						: { path: readStringArray(args.path, "path") }),
				});
				return await executeReadTool(
					"state_get",
					validated,
					readContext(context, scope.storyId, scope.headId),
				);
			},
		),
		define(
			"director_read",
			"读取一个楼层对应的导演决策、当前拍与导演计划；不给楼层时用当前 head。只读。",
			objectSchema({ nodeId: { type: "string", minLength: 1 } }, []),
			"读取导演决策……",
			(args) => directorRead(context, args),
		),
		define(
			"settings_read",
			"读取当前故事的故事设置（人物提示、预算、模板 id、模型、导演配置、生图配置与插件覆盖）。只读。",
			objectSchema({}, []),
			"读取故事设置……",
			(args) => {
				rejectUnknownKeys(args, []);
				const storyId = requireStory(context);
				const settings = context.store.getStorySettings(storyId);
				return `故事 ${storyId} 的设置：\n${JSON.stringify(settings, null, 2)}`;
			},
		),
		define(
			"template_read",
			"读取当前故事生效的上下文模板；没有指定模板时返回内置默认模板。只读。",
			objectSchema({}, []),
			"读取上下文模板……",
			(args) => {
				rejectUnknownKeys(args, []);
				const storyId = requireStory(context);
				const settings = context.store.getStorySettings(storyId);
				const templateId = settings.templateId ?? DEFAULT_CONTEXT_TEMPLATE_ID;
				const template =
					templateId === DEFAULT_CONTEXT_TEMPLATE_ID
						? createDefaultContextTemplate({
								structuredOutput: settings.structuredOutput,
							})
						: context.store.getContextTemplate(templateId)?.template;
				if (template === undefined) {
					throw new Error(`故事引用的上下文模板不存在：${templateId}`);
				}
				return `模板 ${template.id}：\n${JSON.stringify(template, null, 2)}`;
			},
		),
		define(
			"plugin_list",
			"列出内置插件、已安装的代码插件与它们被授予的权限；关联故事时同时给出故事级插件覆盖。只读。",
			objectSchema({}, []),
			"列出插件……",
			(args) => {
				rejectUnknownKeys(args, []);
				const builtin = BUILTIN_PLUGINS.map((plugin) => ({
					name: plugin.name,
					kind: "builtin",
				}));
				const installed = context.store
					.listCodePluginInstallations()
					.map((record) => ({
						name: record.name,
						version: record.version,
						kind: "code",
						permissions: record.grantedPermissions,
						installedAt: record.installedAt,
					}));
				const payload: Record<string, unknown> = { builtin, installed };
				if (context.storyId !== null) {
					const settings = context.store.getStorySettings(context.storyId);
					payload.storyId = context.storyId;
					payload.overrides = settings.pluginOverrides;
				}
				return `插件：\n${JSON.stringify(payload, null, 2)}`;
			},
		),
		define(
			"summarize_recent",
			"读取当前 head 路径上已有的章节压缩与主线、章节摘要，不生成新摘要也不调用模型。只读。",
			objectSchema({}, []),
			"读取摘要……",
			(args) => {
				rejectUnknownKeys(args, []);
				const scope = requireStoryHead(context);
				const compressions = context.store.getValidCompressions(
					scope.storyId,
					scope.headId,
				);
				const summaries = context.store.getValidSummaries(
					scope.storyId,
					scope.headId,
				);
				if (compressions.length === 0 && summaries.length === 0) {
					return `故事 ${scope.storyId} 在 head ${scope.headId} 上没有摘要记录。`;
				}
				const lines: string[] = [];
				for (const compression of compressions) {
					lines.push(
						`【压缩 ${compression.level}】覆盖 ${compression.startNodeId} 到 ${compression.endNodeId}，约 ${compression.tokenCount} token：`,
					);
					for (const [section, text] of Object.entries(compression.sections)) {
						lines.push(`${section}：${text}`);
					}
				}
				for (const summary of summaries) {
					lines.push(
						`【${summary.level === "chapter" ? "章节" : "主线"}摘要】覆盖 ${summary.startNodeId} 到 ${summary.endNodeId}，约 ${summary.tokenCount} token：${summary.text}`,
					);
				}
				return `故事 ${scope.storyId} 在 head ${scope.headId} 上的已有摘要：\n${lines.join("\n")}`;
			},
		),
	];
	const extras = (context.extraTools ?? []).map((tool) =>
		defineAssistantTool(
			{
				permission,
				conversationId: context.conversationId ?? "",
				onToolCall: context.onToolCall,
				onToolResult: context.onToolResult,
				onPermissionDenied: context.onPermissionDenied,
			},
			tool,
		),
	);
	for (const tool of extras) {
		if (readTools.some((builtin) => builtin.name === tool.name)) {
			throw new Error(`助手工具名重复：${tool.name}`);
		}
	}
	return [...readTools, ...extras];
}

function runLogRead(context: AssistantToolContext, args: JsonObject): string {
	rejectUnknownKeys(args, ["runId", "nodeId", "limit"]);
	if (args.runId !== undefined && args.nodeId !== undefined) {
		throw new Error("run_log_read 的 runId 与 nodeId 只能给一个");
	}
	const limit =
		args.limit === undefined
			? MAX_LOG_EVENTS
			: readLimit(args.limit, "limit", MAX_LOG_EVENTS);
	if (args.runId !== undefined) {
		const runId = requireString(args, "runId");
		const run = context.store.getTurnRun(runId);
		if (run === null) throw new Error(`运行不存在：${runId}`);
		return formatRun(context, run, limit);
	}
	if (args.nodeId !== undefined) {
		const nodeId = requireString(args, "nodeId");
		const storyId = requireStory(context);
		const node = context.store.getNode(nodeId);
		if (node === null) throw new Error(`楼层节点不存在：${nodeId}`);
		if (node.storyId !== storyId) {
			throw new Error(`楼层 ${nodeId} 属于另一个故事 ${node.storyId}`);
		}
		const run = context.store.getTurnRunForNode(nodeId);
		if (run === null) {
			return `楼层 ${nodeId} 没有运行日志（快回合不写运行日志，或者这一楼不是深回合提交的助手楼层）。`;
		}
		return formatRun(context, run, limit);
	}
	const storyId = requireStory(context);
	const runs = context.store.listTurnRuns(storyId).slice(0, MAX_LOG_RUNS);
	if (runs.length === 0) {
		return `故事 ${storyId} 没有运行日志。`;
	}
	const lines = runs.map(
		(run) =>
			`- ${run.runId}：模式 ${run.mode}，状态 ${run.status}，开始 ${run.startedAt}，结束 ${run.finishedAt ?? "没有结束"}，楼层 ${run.nodeId ?? "没有提交"}`,
	);
	return `故事 ${storyId} 最近 ${runs.length} 次运行：\n${lines.join("\n")}`;
}

function formatRun(
	context: AssistantToolContext,
	run: TurnRunRecord,
	limit: number,
): string {
	const events = context.store.listTurnRunEvents(run.runId);
	const shown = events.slice(0, limit);
	const lines = shown.map(
		(event) =>
			`- #${event.seq} ${event.kind}（${event.createdAt}）：${JSON.stringify(event.payload)}`,
	);
	const omitted =
		events.length > shown.length
			? `\n（还有 ${events.length - shown.length} 条事件没有列出）`
			: "";
	return `运行 ${run.runId}：模式 ${run.mode}，状态 ${run.status}，开始 ${run.startedAt}，结束 ${run.finishedAt ?? "没有结束"}，用户楼层 ${run.userNodeId}，助手楼层 ${run.nodeId ?? "没有提交"}；事件 ${events.length} 条：\n${lines.join("\n")}${omitted}`;
}

function directorRead(context: AssistantToolContext, args: JsonObject): string {
	rejectUnknownKeys(args, ["nodeId"]);
	const storyId = requireStory(context);
	const nodeId =
		args.nodeId === undefined
			? requireStoryHead(context).headId
			: requireString(args, "nodeId");
	const node = context.store.getNode(nodeId);
	if (node === null) throw new Error(`楼层节点不存在：${nodeId}`);
	if (node.storyId !== storyId) {
		throw new Error(`楼层 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const decisionNodeId =
		node.role === "assistant" ? (node.parentId ?? node.id) : node.id;
	const decision = context.store.getDirectorDecision(decisionNodeId);
	const plan = readDirectorPlan(context.store, storyId);
	const current = resolveCurrentBeat(context.store, storyId, nodeId);
	const lines: string[] = [];
	if (decision === null) {
		lines.push(`楼层 ${decisionNodeId} 没有导演决策记录。`);
	} else {
		lines.push(`楼层 ${decisionNodeId} 的导演决策：`);
		lines.push(`  指令：${decision.directive ?? "没有建议（没有机制触发）"}`);
		for (const mechanism of decision.mechanisms) {
			lines.push(
				`  机制 ${mechanism.name}：${mechanism.triggered ? "触发" : "未触发"}，${mechanism.reason}`,
			);
		}
		lines.push(`  信号：${JSON.stringify(decision.signals)}`);
	}
	lines.push(
		current === null
			? "当前拍：没有（故事没有导演计划，或者计划已经走完）。"
			: `当前拍：${current.beat.id}（弧线 ${current.arc.id}，序列 ${current.sequence.id}）目标：${current.beat.goal}`,
	);
	lines.push(`导演计划：弧线 ${plan.arcs.length} 条。`);
	for (const arc of plan.arcs) {
		lines.push(`- 弧线 ${arc.id}：${arc.title}`);
		for (const sequence of arc.sequences) {
			lines.push(`  - 序列 ${sequence.id}：${sequence.title}`);
			for (const beat of sequence.beats) {
				lines.push(`    - 拍 ${beat.id}：${beat.goal}`);
			}
		}
	}
	return lines.join("\n");
}

interface StoryHead {
	readonly storyId: string;
	readonly headId: string;
}

function requireStory(context: AssistantToolContext): string {
	if (context.storyId === null) {
		throw new Error("这个助手会话没有关联故事，无法读取故事数据");
	}
	if (context.store.getStory(context.storyId) === null) {
		throw new Error(`故事不存在：${context.storyId}`);
	}
	return context.storyId;
}

function requireStoryHead(context: AssistantToolContext): StoryHead {
	const storyId = requireStory(context);
	const head = context.store.getHead(storyId);
	if (head === null) {
		throw new Error(`故事 ${storyId} 还没有楼层，当前 head 不存在`);
	}
	return { storyId, headId: head.id };
}

function readContext(
	context: AssistantToolContext,
	storyId: string,
	beforeNodeId: string,
): ReadToolContext {
	return {
		store: context.store,
		storyId,
		beforeNodeId,
		embedder: context.embedder ?? null,
		reranker: context.reranker ?? null,
		viewpoint: null,
	};
}

function objectSchema(
	properties: Record<string, unknown>,
	required: readonly string[],
): Record<string, unknown> {
	return {
		type: "object",
		properties,
		...(required.length === 0 ? {} : { required: [...required] }),
		additionalProperties: false,
	};
}

function requireString(args: JsonObject, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${key} 必须是非空字符串`);
	}
	return value.trim();
}

function readStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串数组`);
	}
	return value.map((segment) => {
		if (typeof segment !== "string" || segment.trim().length === 0) {
			throw new Error(`${label} 的每一段都必须是非空字符串`);
		}
		return segment.trim();
	});
}

function readLimit(value: unknown, label: string, max: number): number {
	if (
		!Number.isInteger(value) ||
		(value as number) < 1 ||
		(value as number) > max
	) {
		throw new Error(`${label} 必须是 1 到 ${max} 之间的整数`);
	}
	return value as number;
}

function rejectUnknownKeys(args: JsonObject, allowed: readonly string[]): void {
	for (const key of Object.keys(args)) {
		if (!allowed.includes(key)) {
			throw new Error(`不接受参数 ${key}`);
		}
	}
}

function fitResult(text: string): string {
	if (text.length <= MAX_ASSISTANT_TOOL_RESULT_CHARS) return text;
	return `${text.slice(0, MAX_ASSISTANT_TOOL_RESULT_CHARS)}\n……（工具结果已截断：原长 ${text.length} 字符，截断位置 ${MAX_ASSISTANT_TOOL_RESULT_CHARS}）`;
}

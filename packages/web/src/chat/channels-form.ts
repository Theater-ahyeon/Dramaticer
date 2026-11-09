import type {
	LlmChannelApi,
	LlmModelProbe,
	LlmModelRole,
} from "@dramaticer/core";
import type {
	ChannelUpdateInput,
	ChannelsUpdateRequest,
	ChannelsView,
	EmbeddingUpdateInput,
	ModelUpdateInput,
} from "@dramaticer/protocol";
import type { FormFieldError } from "./settings-form";

export const CHANNEL_API_CHOICES: readonly {
	readonly value: LlmChannelApi;
	readonly label: string;
}[] = [
	{ value: "openai-completions", label: "OpenAI 兼容" },
	{ value: "google-generative-ai", label: "Google Generative AI" },
	{ value: "google-vertex", label: "Google Vertex AI" },
];

export interface RoleChoice {
	readonly value: LlmModelRole;
	readonly label: string;
	readonly fallback: string;
}

export const MODEL_ROLE_CHOICES: readonly RoleChoice[] = [
	{ value: "writer", label: "正文写作", fallback: "main" },
	{ value: "settler", label: "结算与抽取", fallback: "background" },
	{ value: "planner", label: "导演与条件判断", fallback: "background" },
	{ value: "judge", label: "评测裁判", fallback: "background" },
];

export interface ChannelFormDraft {
	/** 表单内部稳定键，不写入服务端配置。 */
	readonly key: string;
	readonly id: string;
	readonly api: LlmChannelApi;
	readonly baseUrl: string;
	/** 环境变量名；空字符串表示不需要密钥。 */
	readonly apiKeyEnv: string;
	readonly requestsPerMinute: string;
	readonly maxRetries: string;
	readonly retryBaseDelayMs: string;
	readonly timeoutMs: string;
}

export interface ModelFormDraft {
	/** 表单内部稳定键，不写入服务端配置。 */
	readonly key: string;
	readonly alias: string;
	readonly id: string;
	readonly contextWindow: string;
	readonly maxTokens: string;
	readonly reasoning: boolean;
	readonly enabled: boolean;
	/** 渠道 id，按优先级从左到右，用逗号或空白分隔。 */
	readonly channels: string;
	readonly probe: LlmModelProbe | null;
}

export interface EmbeddingFormDraft {
	readonly id: string;
	readonly baseUrl: string;
	readonly apiKeyEnv: string;
	readonly model: string;
	readonly dimensions: string;
	readonly batchSize: string;
	readonly requestsPerMinute: string;
	readonly maxRetries: string;
	readonly retryBaseDelayMs: string;
	readonly timeoutMs: string;
}

export type RolesFormDraft = Record<LlmModelRole, string>;

export interface ChannelsFormDraft {
	readonly channels: readonly ChannelFormDraft[];
	readonly models: readonly ModelFormDraft[];
	readonly embeddings: readonly EmbeddingFormDraft[];
	readonly roles: RolesFormDraft;
}

let draftKeySeed = 0;

function nextDraftKey(prefix: string): string {
	draftKeySeed += 1;
	return `${prefix}-${draftKeySeed}`;
}

export function buildChannelsDraft(view: ChannelsView): ChannelsFormDraft {
	return {
		channels: view.channels.map((channel) => ({
			key: nextDraftKey("channel"),
			id: channel.id,
			api: channel.api,
			baseUrl: channel.baseUrl,
			apiKeyEnv: channel.apiKeyEnv ?? "",
			requestsPerMinute: String(channel.requestsPerMinute),
			maxRetries: String(channel.maxRetries),
			retryBaseDelayMs: String(channel.retryBaseDelayMs),
			timeoutMs: String(channel.timeoutMs),
		})),
		models: view.models.map((model) => ({
			key: nextDraftKey("model"),
			alias: model.alias,
			id: model.id,
			contextWindow: String(model.contextWindow),
			maxTokens: String(model.maxTokens),
			reasoning: model.reasoning,
			enabled: model.enabled,
			channels: model.channels.join("、"),
			probe: model.probe,
		})),
		embeddings: view.embeddings.map((embedding) => ({
			id: embedding.id,
			baseUrl: embedding.baseUrl,
			apiKeyEnv: embedding.apiKeyEnv ?? "",
			model: embedding.model,
			dimensions: String(embedding.dimensions),
			batchSize: String(embedding.batchSize),
			requestsPerMinute: String(embedding.requestsPerMinute),
			maxRetries: String(embedding.maxRetries),
			retryBaseDelayMs: String(embedding.retryBaseDelayMs),
			timeoutMs: String(embedding.timeoutMs),
		})),
		roles: {
			writer: view.configuredRoles.writer ?? "",
			settler: view.configuredRoles.settler ?? "",
			planner: view.configuredRoles.planner ?? "",
			judge: view.configuredRoles.judge ?? "",
		},
	};
}

export function newChannelDraft(): ChannelFormDraft {
	return {
		key: nextDraftKey("channel"),
		id: "",
		api: "openai-completions",
		baseUrl: "",
		apiKeyEnv: "",
		requestsPerMinute: "30",
		maxRetries: "2",
		retryBaseDelayMs: "1000",
		timeoutMs: "300000",
	};
}

export function newModelDraft(firstChannelId: string): ModelFormDraft {
	return {
		key: nextDraftKey("model"),
		alias: "",
		id: "",
		contextWindow: "131072",
		maxTokens: "8192",
		reasoning: true,
		enabled: true,
		channels: firstChannelId,
		probe: null,
	};
}

/** 把「渠道优先级」输入拆成数组：中英文逗号与空白都算分隔符。 */
export function splitChannelPriority(text: string): string[] {
	return text
		.split(/[,，、\s]+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

export function parseChannelsDraft(draft: ChannelsFormDraft): {
	readonly update: ChannelsUpdateRequest;
	readonly errors: readonly FormFieldError[];
} {
	const errors: FormFieldError[] = [];
	const channels: Record<string, ChannelUpdateInput> = {};
	const channelIds: string[] = [];
	draft.channels.forEach((channel, index) => {
		const path =
			channel.id.trim().length === 0
				? "channels"
				: `channels.${channel.id.trim()}`;
		const id = channel.id.trim();
		if (id.length === 0) {
			errors.push({ path, message: `第 ${index + 1} 个渠道的 id 不能为空` });
		} else if (channelIds.includes(id)) {
			errors.push({ path, message: `渠道 ${id} 出现了两次` });
		} else {
			channelIds.push(id);
		}
		if (
			channel.api !== "openai-completions" &&
			channel.api !== "google-generative-ai" &&
			channel.api !== "google-vertex"
		) {
			errors.push({ path: `${path}.api`, message: "接口类型不在允许范围内" });
		}
		if (channel.baseUrl.trim().length === 0) {
			errors.push({ path: `${path}.baseUrl`, message: "服务地址不能为空" });
		}
		const apiKeyEnv = channel.apiKeyEnv.trim();
		if (apiKeyEnv.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
			errors.push({
				path: `${path}.apiKeyEnv`,
				message: "这里只写环境变量名，不写密钥值",
			});
		}
		const requestsPerMinute = parseInteger(
			channel.requestsPerMinute,
			`${path}.requestsPerMinute`,
			0,
			errors,
		);
		const maxRetries = parseInteger(
			channel.maxRetries,
			`${path}.maxRetries`,
			0,
			errors,
		);
		const retryBaseDelayMs = parseInteger(
			channel.retryBaseDelayMs,
			`${path}.retryBaseDelayMs`,
			0,
			errors,
		);
		const timeoutMs = parseInteger(
			channel.timeoutMs,
			`${path}.timeoutMs`,
			1,
			errors,
		);
		if (id.length > 0 && !(id in channels)) {
			channels[id] = {
				api: channel.api,
				baseUrl: channel.baseUrl.trim(),
				apiKeyEnv,
				requestsPerMinute: requestsPerMinute ?? 0,
				maxRetries: maxRetries ?? 0,
				retryBaseDelayMs: retryBaseDelayMs ?? 0,
				timeoutMs: timeoutMs ?? 1,
			};
		}
	});

	const models: Record<string, ModelUpdateInput> = {};
	const modelInfo = new Map<string, { id: string; enabled: boolean }>();
	draft.models.forEach((model, index) => {
		const alias = model.alias.trim();
		const path = alias.length === 0 ? "models" : `models.${alias}`;
		if (alias.length === 0) {
			errors.push({ path, message: `第 ${index + 1} 个模型的别名不能为空` });
		} else if (modelInfo.has(alias)) {
			errors.push({ path, message: `模型 ${alias} 出现了两次` });
		} else {
			modelInfo.set(alias, { id: model.id.trim(), enabled: model.enabled });
		}
		if (model.id.trim().length === 0) {
			errors.push({ path: `${path}.id`, message: "模型 id 不能为空" });
		}
		const contextWindow = parseInteger(
			model.contextWindow,
			`${path}.contextWindow`,
			1,
			errors,
		);
		const maxTokens = parseInteger(
			model.maxTokens,
			`${path}.maxTokens`,
			1,
			errors,
		);
		const selected = splitChannelPriority(model.channels);
		if (selected.length === 0) {
			errors.push({
				path: `${path}.channels`,
				message: "至少要引用一个渠道",
			});
		}
		const seen = new Set<string>();
		for (const channelId of selected) {
			if (!channelIds.includes(channelId)) {
				errors.push({
					path: `${path}.channels`,
					message: `引用了不存在的渠道 ${channelId}`,
				});
			}
			if (seen.has(channelId)) {
				errors.push({
					path: `${path}.channels`,
					message: `重复引用了渠道 ${channelId}`,
				});
			}
			seen.add(channelId);
		}
		if (alias.length > 0 && !(alias in models)) {
			models[alias] = {
				id: model.id.trim(),
				contextWindow: contextWindow ?? 1,
				maxTokens: maxTokens ?? 1,
				reasoning: model.reasoning,
				enabled: model.enabled,
				channels: selected,
			};
		}
	});

	const embeddings: Record<string, EmbeddingUpdateInput> = {};
	const embeddingIds: string[] = [];
	draft.embeddings.forEach((embedding, index) => {
		const id = embedding.id.trim();
		const path = id.length === 0 ? "embeddings" : `embeddings.${id}`;
		if (id.length === 0) {
			errors.push({
				path,
				message: `第 ${index + 1} 个嵌入提供方的 id 不能为空`,
			});
		} else if (embeddingIds.includes(id)) {
			errors.push({ path, message: `嵌入提供方 ${id} 出现了两次` });
		} else {
			embeddingIds.push(id);
		}
		if (embedding.baseUrl.trim().length === 0) {
			errors.push({ path: `${path}.baseUrl`, message: "服务地址不能为空" });
		}
		if (embedding.model.trim().length === 0) {
			errors.push({ path: `${path}.model`, message: "模型名不能为空" });
		}
		const apiKeyEnv = embedding.apiKeyEnv.trim();
		if (apiKeyEnv.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
			errors.push({
				path: `${path}.apiKeyEnv`,
				message: "这里只写环境变量名，不写密钥值",
			});
		}
		const dimensions = parseInteger(
			embedding.dimensions,
			`${path}.dimensions`,
			1,
			errors,
		);
		const batchSize = parseInteger(
			embedding.batchSize,
			`${path}.batchSize`,
			1,
			errors,
		);
		const requestsPerMinute = parseInteger(
			embedding.requestsPerMinute,
			`${path}.requestsPerMinute`,
			0,
			errors,
		);
		const maxRetries = parseInteger(
			embedding.maxRetries,
			`${path}.maxRetries`,
			0,
			errors,
		);
		const retryBaseDelayMs = parseInteger(
			embedding.retryBaseDelayMs,
			`${path}.retryBaseDelayMs`,
			0,
			errors,
		);
		const timeoutMs = parseInteger(
			embedding.timeoutMs,
			`${path}.timeoutMs`,
			1,
			errors,
		);
		if (id.length > 0 && !(id in embeddings)) {
			embeddings[id] = {
				api: "openai-embeddings",
				baseUrl: embedding.baseUrl.trim(),
				apiKeyEnv,
				model: embedding.model.trim(),
				dimensions: dimensions ?? 1,
				batchSize: batchSize ?? 1,
				requestsPerMinute: requestsPerMinute ?? 0,
				maxRetries: maxRetries ?? 0,
				retryBaseDelayMs: retryBaseDelayMs ?? 0,
				timeoutMs: timeoutMs ?? 1,
			};
		}
	});

	const roles: Partial<Record<LlmModelRole, string>> = {};
	for (const choice of MODEL_ROLE_CHOICES) {
		const alias = draft.roles[choice.value].trim();
		if (alias.length === 0) continue;
		const info = modelInfo.get(alias);
		if (info === undefined) {
			errors.push({
				path: `roles.${choice.value}`,
				message: `岗位指向了不存在的模型 ${alias}`,
			});
			continue;
		}
		if (!info.enabled) {
			errors.push({
				path: `roles.${choice.value}`,
				message: `岗位指向的模型 ${alias} 已经被停用`,
			});
			continue;
		}
		roles[choice.value] = alias;
	}

	const writer = resolveEffectiveAlias("writer", roles, modelInfo);
	const judge = resolveEffectiveAlias("judge", roles, modelInfo);
	const writerId = writer === null ? "" : (modelInfo.get(writer)?.id ?? "");
	const judgeId = judge === null ? "" : (modelInfo.get(judge)?.id ?? "");
	const roleError = errors.some(
		(item) => item.path === "roles.writer" || item.path === "roles.judge",
	);
	if (!roleError && writerId.length > 0 && judgeId.length > 0) {
		const writerFamily = modelFamily(writerId);
		const judgeFamily = modelFamily(judgeId);
		if (writerFamily === judgeFamily) {
			errors.push({
				path: "roles.judge",
				message: `评测裁判与正文写作必须来自不同的模型家族；${judge}（${judgeId}）与 ${writer}（${writerId}）都属于 ${judgeFamily} 家族`,
			});
		}
	}

	return { update: { channels, models, embeddings, roles }, errors };
}

/** 岗位实际生效的模型别名：显式配置优先，否则按 writer→main、其余→background 回落。 */
export function resolveEffectiveAlias(
	role: LlmModelRole,
	roles: Readonly<Partial<Record<LlmModelRole, string>>>,
	models: ReadonlyMap<
		string,
		{ readonly id: string; readonly enabled: boolean }
	>,
): string | null {
	const configured = roles[role];
	if (configured !== undefined) return configured;
	const fallback = MODEL_ROLE_CHOICES.find(
		(choice) => choice.value === role,
	)?.fallback;
	if (fallback === undefined) return null;
	return models.has(fallback) ? fallback : null;
}

const MODEL_FAMILY_KEYWORDS: readonly (readonly [string, readonly string[]])[] =
	[
		["gemini", ["gemini", "gemma"]],
		["deepseek", ["deepseek"]],
		["gpt", ["gpt"]],
		["claude", ["claude"]],
		["qwen", ["qwen"]],
		["kimi", ["kimi"]],
		["glm", ["glm"]],
		["llama", ["llama"]],
		["mistral", ["mistral"]],
		["grok", ["grok"]],
	];

/** 与服务端 `modelFamily` 同一张关键词表；保存时服务端仍会再校验一次。 */
export function modelFamily(modelId: string): string {
	const lowered = modelId.toLowerCase();
	for (const [family, keywords] of MODEL_FAMILY_KEYWORDS) {
		if (keywords.some((keyword) => lowered.includes(keyword))) return family;
	}
	return modelId.trim();
}

const SUPPORT_TEXT: Readonly<Record<string, string>> = {
	supported: "支持",
	unsupported: "不支持",
	unknown: "未知",
};

const STREAMING_TEXT: Readonly<Record<string, string>> = {
	streaming: "流式",
	buffered: "缓冲",
	unknown: "未知",
};

export interface ProbeRow {
	readonly label: string;
	readonly value: string;
}

/** 体检结果的中文展示行；密钥与请求细节不在这里出现。 */
export function describeProbe(probe: LlmModelProbe): readonly ProbeRow[] {
	return [
		{
			label: "流式",
			value: STREAMING_TEXT[probe.streaming] ?? probe.streaming,
		},
		{
			label: "函数调用",
			value: SUPPORT_TEXT[probe.functionCalling] ?? probe.functionCalling,
		},
		{ label: "思考", value: SUPPORT_TEXT[probe.thinking] ?? probe.thinking },
		{ label: "预填充", value: SUPPORT_TEXT[probe.prefill] ?? probe.prefill },
		{ label: "用量", value: SUPPORT_TEXT[probe.usage] ?? probe.usage },
		{
			label: "缓存统计",
			value: SUPPORT_TEXT[probe.cacheStats] ?? probe.cacheStats,
		},
		{
			label: "结构化输出",
			value:
				probe.structuredOutput === "function-call" ? "工具调用" : "文本标签",
		},
	];
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
	id: "id",
	api: "接口类型",
	baseUrl: "服务地址",
	apiKeyEnv: "密钥变量",
	requestsPerMinute: "每分钟请求数",
	maxRetries: "重试次数",
	retryBaseDelayMs: "重试间隔",
	timeoutMs: "超时",
	contextWindow: "上下文窗口",
	maxTokens: "输出上限",
	reasoning: "思考",
	enabled: "启用",
	channels: "渠道优先级",
	model: "模型名",
	dimensions: "向量维度",
	batchSize: "批大小",
};

/** 服务端字段路径转成界面上的中文名字。 */
export function describeChannelsPath(path: string): string {
	const parts = path.split(".");
	if (parts[0] === "roles" && parts[1] !== undefined) {
		const choice = MODEL_ROLE_CHOICES.find((item) => item.value === parts[1]);
		return `岗位 ${choice?.label ?? parts[1]}`;
	}
	if (parts[0] === "channels") {
		if (parts[1] === undefined) return "渠道";
		const label = parts[2] === undefined ? "" : FIELD_LABELS[parts[2]];
		return label === undefined
			? `渠道 ${parts[1]}`
			: `渠道 ${parts[1]} 的${label}`;
	}
	if (parts[0] === "models") {
		if (parts[1] === undefined) return "模型";
		const label = parts[2] === undefined ? "" : FIELD_LABELS[parts[2]];
		return label === undefined
			? `模型 ${parts[1]}`
			: `模型 ${parts[1]} 的${label}`;
	}
	if (parts[0] === "embeddings") {
		if (parts[1] === undefined) return "嵌入提供方";
		const label = parts[2] === undefined ? "" : FIELD_LABELS[parts[2]];
		return label === undefined
			? `嵌入提供方 ${parts[1]}`
			: `嵌入提供方 ${parts[1]} 的${label}`;
	}
	return path;
}

function parseInteger(
	text: string,
	path: string,
	minimum: number,
	errors: FormFieldError[],
): number | null {
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) {
		errors.push({ path, message: `必须是不小于 ${minimum} 的整数` });
		return null;
	}
	const value = Number(trimmed);
	if (!Number.isSafeInteger(value) || value < minimum) {
		errors.push({ path, message: `必须是不小于 ${minimum} 的整数` });
		return null;
	}
	return value;
}

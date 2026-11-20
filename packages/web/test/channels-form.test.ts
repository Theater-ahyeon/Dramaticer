import type { LlmModelProbe } from "@dramaticer/core";
import type { ChannelsView } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	type ChannelsFormDraft,
	buildChannelsDraft,
	describeChannelsPath,
	describeProbe,
	modelFamily,
	parseChannelsDraft,
	splitChannelPriority,
} from "../src/chat/channels-form";

const PROBE: LlmModelProbe = {
	probedAt: "2026-11-08T00:00:00.000Z",
	channel: "gateway",
	modelId: "deepseek/deepseek-chat",
	streaming: "streaming",
	functionCalling: "supported",
	thinking: "unsupported",
	prefill: "unknown",
	usage: "supported",
	cacheStats: "unknown",
	structuredOutput: "function-call",
	notes: ["本地网关"],
};

function viewFixture(overrides: Partial<ChannelsView> = {}): ChannelsView {
	return {
		warnings: [],
		channels: [
			{
				id: "gateway",
				api: "openai-completions",
				baseUrl: "http://127.0.0.1:9/v1",
				apiKeyEnv: "MAIN_KEY",
				apiKeySet: true,
				requestsPerMinute: 30,
				maxRetries: 2,
				retryBaseDelayMs: 1_000,
				timeoutMs: 300_000,
			},
			{
				id: "backup",
				api: "openai-completions",
				baseUrl: "http://127.0.0.1:9/v1",
				apiKeyEnv: null,
				apiKeySet: true,
				requestsPerMinute: 10,
				maxRetries: 0,
				retryBaseDelayMs: 500,
				timeoutMs: 60_000,
			},
		],
		models: [
			{
				alias: "main",
				id: "deepseek-v4",
				contextWindow: 131_072,
				maxTokens: 8_192,
				reasoning: true,
				enabled: true,
				channels: ["gateway", "backup"],
				probe: PROBE,
				fallback: null,
			},
			{
				alias: "background",
				id: "gemini-3.8-flash",
				contextWindow: 65_536,
				maxTokens: 4_096,
				reasoning: false,
				enabled: true,
				channels: ["gateway"],
				probe: null,
				fallback: null,
			},
		],
		embeddings: [
			{
				id: "local-embed",
				api: "openai-embeddings",
				baseUrl: "http://127.0.0.1:9/v1",
				apiKeyEnv: null,
				apiKeySet: true,
				model: "embed-small",
				dimensions: 768,
				batchSize: 32,
				requestsPerMinute: 60,
				maxRetries: 1,
				retryBaseDelayMs: 100,
				timeoutMs: 10_000,
			},
		],
		roles: {
			writer: "main",
			settler: "background",
			planner: "background",
			judge: "background",
		},
		configuredRoles: { writer: "main" },
		...overrides,
	};
}

function draftFixture(): ChannelsFormDraft {
	return buildChannelsDraft(viewFixture());
}

describe("buildChannelsDraft", () => {
	it("把视图里的数值转成表单文本并保留渠道优先级顺序", () => {
		const draft = draftFixture();
		expect(draft.channels[0]).toMatchObject({
			id: "gateway",
			requestsPerMinute: "30",
			timeoutMs: "300000",
			apiKeyEnv: "MAIN_KEY",
		});
		expect(draft.channels[1]?.apiKeyEnv).toBe("");
		expect(draft.models[0]).toMatchObject({
			alias: "main",
			contextWindow: "131072",
			maxTokens: "8192",
			channels: "gateway、backup",
			reasoning: true,
		});
		expect(draft.models[0]?.probe).toEqual(PROBE);
		expect(draft.roles).toEqual({
			writer: "main",
			settler: "",
			planner: "",
			judge: "",
		});
	});
});

describe("parseChannelsDraft", () => {
	it("回填整份更新，只写显式配置的岗位", () => {
		const { update, errors } = parseChannelsDraft(draftFixture());
		expect(errors).toEqual([]);
		expect(update.channels.gateway).toEqual({
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:9/v1",
			apiKeyEnv: "MAIN_KEY",
			requestsPerMinute: 30,
			maxRetries: 2,
			retryBaseDelayMs: 1_000,
			timeoutMs: 300_000,
		});
		expect(update.models.main?.channels).toEqual(["gateway", "backup"]);
		expect(update.embeddings["local-embed"]).toMatchObject({
			api: "openai-embeddings",
			model: "embed-small",
			dimensions: 768,
		});
		expect(update.roles).toEqual({ writer: "main" });
	});

	it("拒绝空渠道 id、重复 id、空地址与越界数值", () => {
		const draft = draftFixture();
		const first = draft.channels[0];
		const second = draft.channels[1];
		if (first === undefined || second === undefined) {
			throw new Error("缺少渠道夹具");
		}
		const broken: ChannelsFormDraft = {
			...draft,
			channels: [
				{ ...first, id: "" },
				{ ...second, id: "gateway", timeoutMs: "0" },
				{ ...second, id: "gateway", baseUrl: "  " },
			],
		};
		const { errors } = parseChannelsDraft(broken);
		const paths = errors.map((error) => error.path);
		expect(paths).toContain("channels");
		expect(paths).toContain("channels.gateway");
		expect(paths).toContain("channels.gateway.timeoutMs");
		expect(paths).toContain("channels.gateway.baseUrl");
	});

	it("密钥字段只接受环境变量名", () => {
		const draft = draftFixture();
		const broken: ChannelsFormDraft = {
			...draft,
			channels: draft.channels.map((channel) =>
				channel.id === "gateway"
					? { ...channel, apiKeyEnv: "sk-secret-value" }
					: channel,
			),
		};
		const { errors } = parseChannelsDraft(broken);
		expect(errors).toContainEqual({
			path: "channels.gateway.apiKeyEnv",
			message: "这里只写环境变量名，不写密钥值",
		});
	});

	it("拒绝引用不存在的渠道与重复的渠道", () => {
		const draft = draftFixture();
		const broken: ChannelsFormDraft = {
			...draft,
			models: draft.models.map((model) =>
				model.alias === "main"
					? { ...model, channels: "gateway、missing、gateway" }
					: model,
			),
		};
		const { errors } = parseChannelsDraft(broken);
		expect(errors).toContainEqual({
			path: "models.main.channels",
			message: "引用了不存在的渠道 missing",
		});
		expect(errors).toContainEqual({
			path: "models.main.channels",
			message: "重复引用了渠道 gateway",
		});
	});

	it("岗位指向未知别名或停用模型时报错", () => {
		const draft = draftFixture();
		const first = draft.models[0];
		const second = draft.models[1];
		if (first === undefined || second === undefined) {
			throw new Error("缺少模型夹具");
		}
		const broken: ChannelsFormDraft = {
			...draft,
			models: [first, { ...second, enabled: false }],
			roles: { ...draft.roles, settler: "background", judge: "missing" },
		};
		const { errors } = parseChannelsDraft(broken);
		expect(errors).toContainEqual({
			path: "roles.settler",
			message: "岗位指向的模型 background 已经被停用",
		});
		expect(errors).toContainEqual({
			path: "roles.judge",
			message: "岗位指向了不存在的模型 missing",
		});
	});

	it("writer 与 judge 同家族时给出岗位错误", () => {
		const draft = draftFixture();
		const sameFamily: ChannelsFormDraft = {
			...draft,
			models: draft.models.map((model) =>
				model.alias === "background"
					? { ...model, id: "deepseek-v4-background" }
					: model,
			),
			roles: { ...draft.roles, judge: "background" },
		};
		const { errors } = parseChannelsDraft(sameFamily);
		expect(errors).toContainEqual({
			path: "roles.judge",
			message:
				"评测裁判与正文写作必须来自不同的模型家族；background（deepseek-v4-background）与 main（deepseek-v4）都属于 deepseek 家族",
		});
	});

	it("没有显式岗位时按缺省回落检查家族", () => {
		const draft = draftFixture();
		const broken: ChannelsFormDraft = {
			...draft,
			models: draft.models.map((model) =>
				model.alias === "background"
					? { ...model, id: "deepseek-background" }
					: model,
			),
			roles: { writer: "", settler: "", planner: "", judge: "" },
		};
		const { errors } = parseChannelsDraft(broken);
		expect(errors.map((error) => error.path)).toContain("roles.judge");
	});
});

describe("渠道展示辅助", () => {
	it("拆分渠道优先级时接受中文逗号与空白", () => {
		expect(splitChannelPriority("gateway, backup，third  fourth")).toEqual([
			"gateway",
			"backup",
			"third",
			"fourth",
		]);
	});

	it("把服务端字段路径翻成中文", () => {
		expect(describeChannelsPath("roles.judge")).toBe("岗位 评测裁判");
		expect(describeChannelsPath("channels.gateway.baseUrl")).toBe(
			"渠道 gateway 的服务地址",
		);
		expect(describeChannelsPath("models.main.channels")).toBe(
			"模型 main 的渠道优先级",
		);
		expect(describeChannelsPath("embeddings.local.dimensions")).toBe(
			"嵌入提供方 local 的向量维度",
		);
	});

	it("体检结果包含五项能力并翻译状态", () => {
		const rows = describeProbe(PROBE);
		expect(rows).toEqual([
			{ label: "流式", value: "流式" },
			{ label: "函数调用", value: "支持" },
			{ label: "思考", value: "不支持" },
			{ label: "预填充", value: "未知" },
			{ label: "用量", value: "支持" },
			{ label: "缓存统计", value: "未知" },
			{ label: "结构化输出", value: "工具调用" },
		]);
	});

	it("模型家族映射与名称逐字比较", () => {
		expect(modelFamily("auto/deepseek-v4.1-flash")).toBe("deepseek");
		expect(modelFamily("agy-gemini-3.8-flash-medium")).toBe("gemini");
		expect(modelFamily("codex/gpt-6.1-terra")).toBe("gpt");
		expect(modelFamily("custom-model")).toBe("custom-model");
	});
});

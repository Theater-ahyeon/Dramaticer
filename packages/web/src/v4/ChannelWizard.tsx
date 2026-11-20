import type {
	ChannelUpdateInput,
	ChannelsUpdateRequest,
	ChannelsView,
	EmbeddingUpdateInput,
	ModelUpdateInput,
} from "@dramaticer/protocol";
import { useState } from "react";
import { api } from "../api";
import { errorText } from "./ui";

interface Provider {
	readonly id: string;
	readonly label: string;
	readonly baseUrl: string;
	readonly keyHint: string;
}

// 都走 OpenAI 兼容接口：同一条已验证的请求路径，模型列表也都是 `/models`。
const PROVIDERS: readonly Provider[] = [
	{
		id: "deepseek",
		label: "DeepSeek",
		baseUrl: "https://api.deepseek.com/v1",
		keyHint: "sk-…",
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		keyHint: "sk-or-…",
	},
	{
		id: "siliconflow",
		label: "硅基流动",
		baseUrl: "https://api.siliconflow.cn/v1",
		keyHint: "sk-…",
	},
	{
		id: "gemini",
		label: "Google Gemini",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
		keyHint: "AIza…",
	},
	{
		id: "claude",
		label: "Anthropic Claude",
		baseUrl: "https://api.anthropic.com/v1",
		keyHint: "sk-ant-…",
	},
	{ id: "custom", label: "其他（OpenAI 兼容）", baseUrl: "", keyHint: "" },
];

const DEFAULT_MODEL = {
	contextWindow: 131072,
	maxTokens: 8192,
	reasoning: false,
	enabled: true,
} as const;

function envNameFor(channelId: string): string {
	return `DRAMATICER_KEY_${channelId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

/** 现有配置原样转成更新请求，向导只在上面加东西、改岗位。 */
function currentUpdate(view: ChannelsView): {
	channels: Record<string, ChannelUpdateInput>;
	models: Record<string, ModelUpdateInput>;
	embeddings: Record<string, EmbeddingUpdateInput>;
} {
	const channels: Record<string, ChannelUpdateInput> = {};
	for (const channel of view.channels) {
		channels[channel.id] = {
			api: channel.api,
			baseUrl: channel.baseUrl,
			apiKeyEnv: channel.apiKeyEnv ?? "",
			requestsPerMinute: channel.requestsPerMinute,
			maxRetries: channel.maxRetries,
			retryBaseDelayMs: channel.retryBaseDelayMs,
			timeoutMs: channel.timeoutMs,
		};
	}
	const models: Record<string, ModelUpdateInput> = {};
	for (const model of view.models) {
		models[model.alias] = {
			id: model.id,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			reasoning: model.reasoning,
			enabled: model.enabled,
			channels: model.channels,
		};
	}
	const embeddings: Record<string, EmbeddingUpdateInput> = {};
	for (const embedding of view.embeddings) {
		embeddings[embedding.id] = {
			api: embedding.api,
			baseUrl: embedding.baseUrl,
			apiKeyEnv: embedding.apiKeyEnv ?? "",
			model: embedding.model,
			dimensions: embedding.dimensions,
			batchSize: embedding.batchSize,
			requestsPerMinute: embedding.requestsPerMinute,
			maxRetries: embedding.maxRetries,
			retryBaseDelayMs: embedding.retryBaseDelayMs,
			timeoutMs: embedding.timeoutMs,
		};
	}
	return { channels, models, embeddings };
}

type Status =
	| { readonly kind: "idle" }
	| { readonly kind: "busy"; readonly text: string }
	| { readonly kind: "error"; readonly text: string }
	| { readonly kind: "done"; readonly text: string };

/**
 * 连接向导：选供应商 → 填密钥 → 获取模型 → 选正文与后台模型 → 保存并测试。
 * 密钥写进服务端的 env 文件，配置里只保存变量名。
 */
export function ChannelWizard({
	view,
	onSaved,
}: {
	readonly view: ChannelsView;
	readonly onSaved: (view: ChannelsView) => void;
}) {
	const [providerId, setProviderId] = useState(PROVIDERS[0]?.id ?? "custom");
	const provider =
		PROVIDERS.find((item) => item.id === providerId) ??
		(PROVIDERS[PROVIDERS.length - 1] as Provider);
	const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
	const [key, setKey] = useState("");
	const [models, setModels] = useState<readonly string[] | null>(null);
	const [writer, setWriter] = useState("");
	const [background, setBackground] = useState("");
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const busy = status.kind === "busy";

	const existing = view.channels.find(
		(channel) =>
			channel.baseUrl.replace(/\/+$/, "") === baseUrl.replace(/\/+$/, ""),
	);
	const channelId =
		existing?.id ??
		(view.channels.some((channel) => channel.id === providerId)
			? `${providerId}-2`
			: providerId);
	const envName = existing?.apiKeyEnv ?? envNameFor(channelId);
	const keyReady = key.trim().length > 0 || existing?.apiKeySet === true;

	const choose = (id: string) => {
		const next = PROVIDERS.find((item) => item.id === id);
		setProviderId(id);
		setBaseUrl(next?.baseUrl ?? "");
		setModels(null);
		setWriter("");
		setBackground("");
		setStatus({ kind: "idle" });
	};

	const fetchModels = async () => {
		setStatus({ kind: "busy", text: "正在连接…" });
		try {
			if (key.trim().length > 0) await api.saveChannelKey(envName, key.trim());
			const list = await api.listChannelModels({
				api: "openai-completions",
				baseUrl,
				apiKeyEnv: envName,
			});
			setModels(list);
			setKey("");
			if (list.length === 0) {
				setStatus({
					kind: "error",
					text: "连接成功，但没有返回模型列表，请手动填写模型 ID",
				});
			} else {
				setWriter((value) => value || (list[0] ?? ""));
				setBackground((value) => value || (list[0] ?? ""));
				setStatus({ kind: "done", text: `连接成功，共 ${list.length} 个模型` });
			}
		} catch (error) {
			setStatus({ kind: "error", text: errorText(error) });
		}
	};

	const save = async () => {
		const writerId = writer.trim();
		const backgroundId = background.trim() || writerId;
		if (writerId.length === 0) {
			setStatus({ kind: "error", text: "请选择正文模型" });
			return;
		}
		setStatus({ kind: "busy", text: "正在保存…" });
		try {
			if (key.trim().length > 0) await api.saveChannelKey(envName, key.trim());
			const base = currentUpdate(view);
			base.channels[channelId] = {
				api: "openai-completions",
				baseUrl: baseUrl.trim(),
				apiKeyEnv: envName,
				requestsPerMinute: existing?.requestsPerMinute ?? 0,
				maxRetries: existing?.maxRetries ?? 2,
				retryBaseDelayMs: existing?.retryBaseDelayMs ?? 1000,
				timeoutMs: existing?.timeoutMs ?? 120000,
			};
			const aliasFor = (id: string) => `${channelId}-${slug(id)}`;
			const writerAlias = aliasFor(writerId);
			const backgroundAlias = aliasFor(backgroundId);
			for (const [alias, id] of [
				[writerAlias, writerId],
				[backgroundAlias, backgroundId],
			] as const) {
				base.models[alias] = {
					...(base.models[alias] ?? DEFAULT_MODEL),
					id,
					channels: [channelId],
				};
			}
			const request: ChannelsUpdateRequest = {
				...base,
				roles: {
					writer: writerAlias,
					settler: backgroundAlias,
					planner: backgroundAlias,
					judge: backgroundAlias,
				},
			};
			const saved = await api.updateChannels(request);
			setStatus({ kind: "busy", text: "已保存，正在测试正文模型…" });
			try {
				await api.probeChannel({ role: "writer" });
				setStatus({ kind: "done", text: "已保存，测试通过，可以开始写了" });
			} catch (error) {
				setStatus({
					kind: "error",
					text: `已保存，但测试没通过：${errorText(error)}`,
				});
			}
			setKey("");
			onSaved(saved);
		} catch (error) {
			setStatus({ kind: "error", text: errorText(error) });
		}
	};

	return (
		<form
			className="wizard"
			aria-label="连接模型"
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<label>
				<span>供应商</span>
				<select
					value={providerId}
					onChange={(event) => choose(event.target.value)}
					disabled={busy}
				>
					{PROVIDERS.map((item) => (
						<option key={item.id} value={item.id}>
							{item.label}
						</option>
					))}
				</select>
			</label>
			<label>
				<span>接口地址</span>
				<input
					type="url"
					required
					value={baseUrl}
					placeholder="https://…/v1"
					onChange={(event) => setBaseUrl(event.target.value)}
					disabled={busy}
				/>
			</label>
			<label>
				<span>API Key</span>
				<input
					type="password"
					autoComplete="off"
					value={key}
					placeholder={
						existing?.apiKeySet ? "已保存（不改就留空）" : provider.keyHint
					}
					onChange={(event) => setKey(event.target.value)}
					disabled={busy}
				/>
			</label>
			<div className="wizard-row">
				<button
					type="button"
					className="btn ghost"
					onClick={() => void fetchModels()}
					disabled={busy || baseUrl.trim() === "" || !keyReady}
				>
					获取模型列表
				</button>
			</div>
			<label>
				<span>正文模型</span>
				<input
					list="wizard-models"
					value={writer}
					placeholder="模型 ID"
					onChange={(event) => setWriter(event.target.value)}
					disabled={busy}
				/>
			</label>
			<label>
				<span>后台模型（记忆整理等，可选更便宜的）</span>
				<input
					list="wizard-models"
					value={background}
					placeholder="留空则与正文相同"
					onChange={(event) => setBackground(event.target.value)}
					disabled={busy}
				/>
			</label>
			<datalist id="wizard-models">
				{(models ?? []).map((id) => (
					<option key={id} value={id} />
				))}
			</datalist>
			<div className="wizard-row">
				<button
					type="submit"
					className="btn gold"
					disabled={busy || !keyReady || writer.trim() === ""}
				>
					保存并测试
				</button>
				{status.kind === "idle" ? null : (
					<output className="wizard-status" data-kind={status.kind}>
						{status.text}
					</output>
				)}
			</div>
		</form>
	);
}

import type { LlmModelProbe } from "@dramaticer/core";
import type { ChannelsView } from "@dramaticer/protocol";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import {
	CHANNEL_API_CHOICES,
	type ChannelFormDraft,
	type ChannelsFormDraft,
	MODEL_ROLE_CHOICES,
	type ModelFormDraft,
	buildChannelsDraft,
	describeChannelsPath,
	describeProbe,
	newChannelDraft,
	newModelDraft,
	parseChannelsDraft,
} from "../chat/channels-form";
import { settingsErrorsFromFailure } from "../chat/settings-form";
import { ErrorNotice } from "../components/ErrorNotice";

function Field({
	label,
	children,
}: {
	readonly label: string;
	readonly children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: label 直接包住调用方传入的输入控件
		<label className="plan-field">
			<span>{label}</span>
			{children}
		</label>
	);
}

function KeyState({
	channel,
	view,
}: {
	readonly channel: ChannelFormDraft;
	readonly view: ChannelsView;
}) {
	if (channel.apiKeyEnv.trim().length === 0) {
		return <p className="channel-key-note">不使用密钥。</p>;
	}
	const known = view.channels.find((item) => item.id === channel.id);
	if (known === undefined || known.apiKeyEnv !== channel.apiKeyEnv.trim()) {
		return (
			<p className="channel-key-note">
				保存时服务端会检查变量 {channel.apiKeyEnv.trim()} 是否已设置。
			</p>
		);
	}
	if (known.apiKeySet) {
		return (
			<p className="channel-key-note">密钥变量 {channel.apiKeyEnv} 已设置。</p>
		);
	}
	return (
		<p className="channel-key-warning" role="alert">
			密钥变量 {channel.apiKeyEnv}{" "}
			没有设置；保存会被拒绝，直到在服务端环境里填好它。
		</p>
	);
}

function ProbeSummary({ probe }: { readonly probe: LlmModelProbe }) {
	return (
		<div className="probe-summary">
			<p className="muted">
				最近一次体检：{probe.probedAt}，渠道 {probe.channel}，模型{" "}
				{probe.modelId}
			</p>
			<dl className="probe-grid">
				{describeProbe(probe).map((row) => (
					<div className="probe-row" key={row.label}>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				))}
			</dl>
			{probe.notes.length > 0 ? (
				<ul className="probe-notes">
					{probe.notes.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

export function ChannelsAdvanced() {
	const [view, setView] = useState<ChannelsView | null>(null);
	const [draft, setDraft] = useState<ChannelsFormDraft | null>(null);
	const [loadError, setLoadError] = useState<unknown>(null);
	const [errors, setErrors] = useState<
		readonly { readonly path: string; readonly message: string }[]
	>([]);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [probing, setProbing] = useState<string | null>(null);
	const [probeErrors, setProbeErrors] = useState<
		Readonly<Record<string, unknown>>
	>({});
	// 按岗位体检的结果：岗位 → 一句结论或错误。
	const [roleProbe, setRoleProbe] = useState<
		Readonly<Record<string, { readonly ok: boolean; readonly text: string }>>
	>({});

	useEffect(() => {
		let active = true;
		void api
			.getChannels()
			.then((next) => {
				if (!active) return;
				setView(next);
				setDraft(buildChannelsDraft(next));
			})
			.catch((error: unknown) => {
				if (active) setLoadError(error);
			});
		return () => {
			active = false;
		};
	}, []);

	const updateChannel = (
		index: number,
		patch: Partial<ChannelFormDraft>,
	): void => {
		setDraft((previous) =>
			previous === null
				? previous
				: {
						...previous,
						channels: previous.channels.map((channel, position) =>
							position === index ? { ...channel, ...patch } : channel,
						),
					},
		);
		setSaved(false);
	};

	const updateModel = (index: number, patch: Partial<ModelFormDraft>): void => {
		setDraft((previous) =>
			previous === null
				? previous
				: {
						...previous,
						models: previous.models.map((model, position) =>
							position === index ? { ...model, ...patch } : model,
						),
					},
		);
		setSaved(false);
	};

	const updateRole = (
		role: (typeof MODEL_ROLE_CHOICES)[number]["value"],
		alias: string,
	): void => {
		setDraft((previous) =>
			previous === null
				? previous
				: { ...previous, roles: { ...previous.roles, [role]: alias } },
		);
		setSaved(false);
	};

	const addChannel = (): void => {
		setDraft((previous) =>
			previous === null
				? previous
				: { ...previous, channels: [...previous.channels, newChannelDraft()] },
		);
		setSaved(false);
	};

	const addModel = (): void => {
		if (draft === null) return;
		const firstChannel = draft.channels[0]?.id.trim() ?? "";
		setDraft((previous) =>
			previous === null
				? previous
				: {
						...previous,
						models: [...previous.models, newModelDraft(firstChannel)],
					},
		);
		setSaved(false);
	};

	const removeChannel = (index: number): void => {
		setDraft((previous) =>
			previous === null
				? previous
				: {
						...previous,
						channels: previous.channels.filter(
							(_channel, position) => position !== index,
						),
					},
		);
		setSaved(false);
	};

	const removeModel = (index: number): void => {
		setDraft((previous) =>
			previous === null
				? previous
				: {
						...previous,
						models: previous.models.filter(
							(_model, position) => position !== index,
						),
					},
		);
		setSaved(false);
	};

	/** 按岗位体检：服务端取这个岗位当前生效的模型，体检结果写回渠道配置。 */
	const probeRole = (role: (typeof MODEL_ROLE_CHOICES)[number]["value"]) => {
		if (probing !== null) return;
		setProbing(`role:${role}`);
		void api
			.probeChannel({ role })
			.then((result) => {
				setView((previous) =>
					previous === null
						? previous
						: {
								...previous,
								models: previous.models.map((item) =>
									item.alias === result.alias
										? { ...item, probe: result.probe }
										: item,
								),
							},
				);
				setDraft((previous) =>
					previous === null
						? previous
						: {
								...previous,
								models: previous.models.map((item) =>
									item.alias.trim() === result.alias
										? { ...item, probe: result.probe }
										: item,
								),
							},
				);
				setRoleProbe((previous) => ({
					...previous,
					[role]: {
						ok: true,
						text: `${result.alias} 经渠道 ${result.channel} 体检通过`,
					},
				}));
			})
			.catch((error: unknown) => {
				setRoleProbe((previous) => ({
					...previous,
					[role]: {
						ok: false,
						text: error instanceof Error ? error.message : String(error),
					},
				}));
			})
			.finally(() => setProbing(null));
	};

	const probe = (model: ModelFormDraft, index: number): void => {
		const alias = model.alias.trim();
		if (alias.length === 0 || probing !== null) return;
		setProbing(alias);
		setProbeErrors((previous) => {
			const next = { ...previous };
			delete next[alias];
			return next;
		});
		void api
			.probeChannel({ alias })
			.then((result) => {
				updateModel(index, { probe: result.probe });
				setView((previous) =>
					previous === null
						? previous
						: {
								...previous,
								models: previous.models.map((item) =>
									item.alias === alias
										? { ...item, probe: result.probe }
										: item,
								),
							},
				);
			})
			.catch((error: unknown) => {
				setProbeErrors((previous) => ({ ...previous, [alias]: error }));
			})
			.finally(() => {
				setProbing(null);
			});
	};

	const save = (): void => {
		if (draft === null || busy) return;
		const parsed = parseChannelsDraft(draft);
		setErrors(parsed.errors);
		setSaved(false);
		if (parsed.errors.length > 0) return;
		setBusy(true);
		void api
			.updateChannels(parsed.update)
			.then((next) => {
				setView(next);
				setDraft(buildChannelsDraft(next));
				setProbeErrors({});
				setSaved(true);
			})
			.catch((error: unknown) => {
				setErrors(settingsErrorsFromFailure(error));
			})
			.finally(() => {
				setBusy(false);
			});
	};

	const reset = (): void => {
		if (view === null) return;
		setDraft(buildChannelsDraft(view));
		setErrors([]);
		setSaved(false);
		setProbeErrors({});
	};

	const aliasOptions =
		draft === null
			? []
			: [
					...new Map(
						draft.models
							.filter((model) => model.alias.trim().length > 0)
							.map((model) => [
								model.alias.trim(),
								{ alias: model.alias.trim(), enabled: model.enabled },
							]),
					).values(),
				];

	return (
		<div className="settings-page channels-page">
			<header className="ledger-floor-head">
				<h1>渠道与模型岗位</h1>
				<p className="ledger-meta">
					保存会整份替换渠道配置：这里列出的渠道、模型与嵌入提供方才会保留。密钥只写环境变量名，界面不显示密钥值。
				</p>
			</header>
			<ErrorNotice error={loadError} />
			{view !== null && view.warnings.length > 0 ? (
				<ul className="channel-warnings" aria-label="渠道配置提醒">
					{view.warnings.map((warning) => (
						<li key={warning}>{warning}</li>
					))}
				</ul>
			) : null}
			{view === null || draft === null ? (
				<p className="muted">正在读取渠道配置…</p>
			) : (
				<>
					<section className="director-section" aria-label="模型岗位">
						<header className="director-section-head">
							<h2>模型岗位</h2>
						</header>
						<div className="settings-grid">
							{MODEL_ROLE_CHOICES.map((choice) => (
								<Field
									key={choice.value}
									label={`${choice.label}（缺省回落 ${choice.fallback}）`}
								>
									<select
										value={draft.roles[choice.value]}
										onChange={(event) =>
											updateRole(choice.value, event.target.value)
										}
										disabled={busy}
									>
										<option value="">
											缺省回落：
											{view.roles[choice.value] ?? choice.fallback}
										</option>
										{aliasOptions.map((item) => (
											<option
												key={item.alias}
												value={item.alias}
												disabled={!item.enabled}
											>
												{item.alias}
												{item.enabled ? "" : "（已停用）"}
											</option>
										))}
									</select>
								</Field>
							))}
						</div>
						<div className="role-probes">
							{MODEL_ROLE_CHOICES.map((choice) => {
								const outcome = roleProbe[choice.value];
								return (
									<div className="role-probe" key={choice.value}>
										<button
											type="button"
											onClick={() => probeRole(choice.value)}
											disabled={busy || probing !== null}
										>
											{probing === `role:${choice.value}`
												? "体检中…"
												: `体检「${choice.label}」`}
										</button>
										{outcome === undefined ? null : (
											<span
												className={
													outcome.ok ? "role-probe-ok" : "role-probe-bad"
												}
											>
												{outcome.text}
											</span>
										)}
									</div>
								);
							})}
						</div>
						<p className="muted">
							评测裁判与正文写作必须来自不同的模型家族（按模型 id
							识别）；当前生效：正文 {view.roles.writer ?? "没有"}，裁判{" "}
							{view.roles.judge ?? "没有"}。
						</p>
					</section>

					<section className="director-section" aria-label="模型">
						<header className="director-section-head">
							<h2>模型</h2>
							<button type="button" onClick={addModel} disabled={busy}>
								新增模型
							</button>
						</header>
						{draft.models.map((model, index) => {
							const known = view.models.some(
								(item) => item.alias === model.alias.trim(),
							);
							const probeError = probeErrors[model.alias.trim()] ?? null;
							return (
								<div className="channel-card" key={model.key}>
									<div className="channel-card-head">
										<h3>
											{model.alias.trim().length === 0 ? "新模型" : model.alias}
										</h3>
										<span className="ledger-tag">
											{model.enabled ? "启用" : "停用"}
										</span>
									</div>
									<div className="settings-grid">
										<Field label="模型别名">
											<input
												type="text"
												value={model.alias}
												onChange={(event) =>
													updateModel(index, { alias: event.target.value })
												}
												disabled={busy}
											/>
										</Field>
										<Field label="模型 id">
											<input
												type="text"
												value={model.id}
												onChange={(event) =>
													updateModel(index, { id: event.target.value })
												}
												disabled={busy}
											/>
										</Field>
										<Field label="上下文窗口 token">
											<input
												type="text"
												inputMode="numeric"
												value={model.contextWindow}
												onChange={(event) =>
													updateModel(index, {
														contextWindow: event.target.value,
													})
												}
												disabled={busy}
											/>
										</Field>
										<Field label="输出上限 token">
											<input
												type="text"
												inputMode="numeric"
												value={model.maxTokens}
												onChange={(event) =>
													updateModel(index, { maxTokens: event.target.value })
												}
												disabled={busy}
											/>
										</Field>
									</div>
									<Field label="渠道优先级（从左到右，用逗号分隔）">
										<input
											type="text"
											value={model.channels}
											onChange={(event) =>
												updateModel(index, { channels: event.target.value })
											}
											disabled={busy}
											placeholder={draft.channels[0]?.id ?? "渠道 id"}
										/>
									</Field>
									<div className="channel-checkboxes">
										<label className="settings-check">
											<input
												type="checkbox"
												checked={model.enabled}
												onChange={(event) =>
													updateModel(index, { enabled: event.target.checked })
												}
												disabled={busy}
											/>
											启用
										</label>
										<label className="settings-check">
											<input
												type="checkbox"
												checked={model.reasoning}
												onChange={(event) =>
													updateModel(index, {
														reasoning: event.target.checked,
													})
												}
												disabled={busy}
											/>
											允许思考
										</label>
									</div>
									<div className="plan-toolbar">
										<button
											type="button"
											onClick={() => probe(model, index)}
											disabled={busy || probing !== null || !known}
										>
											{probing === model.alias.trim() ? "正在体检…" : "体检"}
										</button>
										{!known ? (
											<span className="muted">先保存配置再体检。</span>
										) : null}
									</div>
									<ErrorNotice error={probeError} />
									{model.probe === null ? (
										<p className="muted">还没有体检结果。</p>
									) : (
										<ProbeSummary probe={model.probe} />
									)}
									<div className="plan-toolbar">
										<button
											type="button"
											onClick={() => removeModel(index)}
											disabled={busy}
										>
											删除模型
										</button>
									</div>
								</div>
							);
						})}
					</section>

					<section className="director-section" aria-label="渠道">
						<header className="director-section-head">
							<h2>渠道</h2>
							<button type="button" onClick={addChannel} disabled={busy}>
								新增渠道
							</button>
						</header>
						{draft.channels.map((channel, index) => (
							<div className="channel-card" key={channel.key}>
								<div className="channel-card-head">
									<h3>
										{channel.id.trim().length === 0 ? "新渠道" : channel.id}
									</h3>
								</div>
								<div className="settings-grid">
									<Field label="渠道 id">
										<input
											type="text"
											value={channel.id}
											onChange={(event) =>
												updateChannel(index, { id: event.target.value })
											}
											disabled={busy}
										/>
									</Field>
									<Field label="接口类型">
										<select
											value={channel.api}
											onChange={(event) =>
												updateChannel(index, {
													api: event.target.value as ChannelFormDraft["api"],
												})
											}
											disabled={busy}
										>
											{CHANNEL_API_CHOICES.map((choice) => (
												<option key={choice.value} value={choice.value}>
													{choice.label}
												</option>
											))}
										</select>
									</Field>
									<Field label="服务地址">
										<input
											type="text"
											value={channel.baseUrl}
											onChange={(event) =>
												updateChannel(index, { baseUrl: event.target.value })
											}
											disabled={busy}
										/>
									</Field>
									<Field label="密钥环境变量名（留空表示不需要）">
										<input
											type="text"
											value={channel.apiKeyEnv}
											onChange={(event) =>
												updateChannel(index, {
													apiKeyEnv: event.target.value,
												})
											}
											disabled={busy}
											placeholder="DRAMATICER_MAIN_API_KEY"
										/>
									</Field>
									<Field label="每分钟请求数">
										<input
											type="text"
											inputMode="numeric"
											value={channel.requestsPerMinute}
											onChange={(event) =>
												updateChannel(index, {
													requestsPerMinute: event.target.value,
												})
											}
											disabled={busy}
										/>
									</Field>
									<Field label="重试次数">
										<input
											type="text"
											inputMode="numeric"
											value={channel.maxRetries}
											onChange={(event) =>
												updateChannel(index, {
													maxRetries: event.target.value,
												})
											}
											disabled={busy}
										/>
									</Field>
									<Field label="重试间隔毫秒">
										<input
											type="text"
											inputMode="numeric"
											value={channel.retryBaseDelayMs}
											onChange={(event) =>
												updateChannel(index, {
													retryBaseDelayMs: event.target.value,
												})
											}
											disabled={busy}
										/>
									</Field>
									<Field label="超时毫秒">
										<input
											type="text"
											inputMode="numeric"
											value={channel.timeoutMs}
											onChange={(event) =>
												updateChannel(index, {
													timeoutMs: event.target.value,
												})
											}
											disabled={busy}
										/>
									</Field>
								</div>
								<KeyState channel={channel} view={view} />
								<div className="plan-toolbar">
									<button
										type="button"
										onClick={() => removeChannel(index)}
										disabled={busy}
									>
										删除渠道
									</button>
								</div>
							</div>
						))}
					</section>

					{draft.embeddings.length === 0 ? null : (
						<section className="director-section" aria-label="嵌入提供方">
							<header className="director-section-head">
								<h2>嵌入提供方</h2>
							</header>
							<p className="muted">保存时原样保留。</p>
							<ul className="channel-list">
								{draft.embeddings.map((embedding) => {
									const known = view.embeddings.find(
										(item) => item.id === embedding.id,
									);
									return (
										<li key={embedding.id}>
											<span>{embedding.id}</span>
											<span className="muted">
												{embedding.model}，{embedding.dimensions} 维， 密钥{" "}
												{embedding.apiKeyEnv || "不使用"}
											</span>
											{known !== undefined && !known.apiKeySet ? (
												<span className="channel-key-warning">未设置</span>
											) : null}
										</li>
									);
								})}
							</ul>
						</section>
					)}

					{errors.length > 0 ? (
						<ul className="settings-errors" role="alert">
							{errors.map((error, index) => (
								<li key={`${error.path}-${index}`}>
									{error.path.length === 0
										? error.message
										: `${describeChannelsPath(error.path)}：${error.message}`}
								</li>
							))}
						</ul>
					) : null}
					<div className="plan-toolbar">
						<button type="button" onClick={save} disabled={busy}>
							{busy ? "正在保存…" : "保存渠道配置"}
						</button>
						<button type="button" onClick={reset} disabled={busy}>
							重置表单
						</button>
						{saved ? <span className="ledger-tag">已保存</span> : null}
					</div>
				</>
			)}
		</div>
	);
}

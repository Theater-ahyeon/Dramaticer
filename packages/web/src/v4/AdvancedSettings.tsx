import type {
	ContextTemplateRecord,
	ImageWorkflowView,
	StorySettings,
	StoryTemplateView,
} from "@dramaticer/protocol";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
	DIRECTOR_INTENSITY_CHOICES,
	DIRECTOR_MODE_CHOICES,
} from "../chat/director-view";
import {
	IMAGE_MODE_CHOICES,
	type ImageSettingsDraft,
} from "../chat/image-form";
import {
	DEEP_NUMBER_FIELDS,
	DIRECTOR_NUMBER_FIELDS,
	type DeepNumberKey,
	type DirectorFormDraft,
	type DirectorNumberKey,
	type FormFieldError,
	HISTORY_MODE_CHOICES,
	HISTORY_STRATEGY_CHOICES,
	type HistoryOverrideFormDraft,
	REASONING_CHOICES,
	STRUCTURED_OUTPUT_CHOICES,
	type SettingsFormDraft,
	TURN_MODE_CHOICES,
	buildSettingsDraft,
	describeHistoryPolicy,
	describeSettingsPath,
	parseSettingsDraft,
	settingsErrorsFromFailure,
} from "../chat/settings-form";
import {
	type TemplateFormDraft,
	buildContextTemplate,
	templateDraftFrom,
	validateTemplateDraft,
} from "../chat/template-form";
import { ErrorNotice } from "../components/ErrorNotice";
import { TemplateEditor } from "../components/settings/TemplateEditor";

const DEFAULT_TEMPLATE_NAME = "内置默认模板";

function normalizeDraft(
	settings: StorySettings,
	templateId: string,
): SettingsFormDraft {
	return buildSettingsDraft({
		...settings,
		templateId: templateId.length === 0 ? null : templateId,
	});
}

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

/** 本故事设置的「高级」分页：模型参数、历史块、导演参数与上下文模板。 */
export function AdvancedSettings({ storyId }: { readonly storyId: string }) {
	const [settings, setSettings] = useState<StorySettings | null>(null);
	const [draft, setDraft] = useState<SettingsFormDraft | null>(null);
	const [templates, setTemplates] = useState<readonly ContextTemplateRecord[]>(
		[],
	);
	const [imageWorkflows, setImageWorkflows] = useState<
		readonly ImageWorkflowView[]
	>([]);
	const [templateView, setTemplateView] = useState<StoryTemplateView | null>(
		null,
	);
	const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
		null,
	);
	const [templateDraft, setTemplateDraft] = useState<TemplateFormDraft | null>(
		null,
	);
	const [copyName, setCopyName] = useState("");
	const [loadError, setLoadError] = useState<unknown>(null);
	const [settingsErrors, setSettingsErrors] = useState<
		readonly FormFieldError[]
	>([]);
	const [settingsBusy, setSettingsBusy] = useState(false);
	const [settingsSaved, setSettingsSaved] = useState(false);
	const [templateErrors, setTemplateErrors] = useState<
		readonly FormFieldError[]
	>([]);
	const [templateBusy, setTemplateBusy] = useState(false);
	const [templateSaved, setTemplateSaved] = useState(false);
	const requestRef = useRef(0);

	useEffect(() => {
		let active = true;
		requestRef.current += 1;
		setSettings(null);
		setDraft(null);
		setTemplates([]);
		setTemplateView(null);
		setSelectedTemplateId(null);
		setTemplateDraft(null);
		setLoadError(null);
		setSettingsErrors([]);
		setSettingsSaved(false);
		setTemplateErrors([]);
		setTemplateSaved(false);
		void (async () => {
			try {
				const [loadedSettings, list, view, workflows] = await Promise.all([
					api.getSettings(storyId),
					api.listTemplates(),
					api.getStoryTemplate(storyId),
					api.getImageWorkflows(),
				]);
				if (!active) return;
				const templateId =
					view.source === "stored" ? (view.templateId ?? "") : "";
				const record = list.find((item) => item.id === templateId) ?? null;
				setSettings(loadedSettings);
				setDraft(normalizeDraft(loadedSettings, templateId));
				setTemplates(list);
				setTemplateView(view);
				setSelectedTemplateId(record?.id ?? null);
				setImageWorkflows(workflows.workflows);
				setTemplateDraft(
					templateDraftFrom(
						view.template,
						record?.name ?? DEFAULT_TEMPLATE_NAME,
					),
				);
				setCopyName(`${record?.name ?? "默认模板"} 副本`);
			} catch (error) {
				if (active) setLoadError(error);
			}
		})();
		return () => {
			active = false;
		};
	}, [storyId]);

	const reload = async (): Promise<void> => {
		const request = requestRef.current + 1;
		requestRef.current = request;
		const [loadedSettings, list, view, workflows] = await Promise.all([
			api.getSettings(storyId),
			api.listTemplates(),
			api.getStoryTemplate(storyId),
			api.getImageWorkflows(),
		]);
		if (requestRef.current !== request) return;
		const templateId = view.source === "stored" ? (view.templateId ?? "") : "";
		const record = list.find((item) => item.id === templateId) ?? null;
		setSettings(loadedSettings);
		setDraft(normalizeDraft(loadedSettings, templateId));
		setTemplates(list);
		setTemplateView(view);
		setSelectedTemplateId(record?.id ?? null);
		setImageWorkflows(workflows.workflows);
		setTemplateDraft(
			templateDraftFrom(view.template, record?.name ?? DEFAULT_TEMPLATE_NAME),
		);
		setCopyName(`${record?.name ?? "默认模板"} 副本`);
	};

	const updateDraft = (patch: Partial<SettingsFormDraft>): void => {
		setDraft((previous) =>
			previous === null ? previous : { ...previous, ...patch },
		);
		setSettingsSaved(false);
	};

	const updateDirector = (patch: Partial<DirectorFormDraft>): void => {
		setDraft((previous) =>
			previous === null
				? previous
				: { ...previous, director: { ...previous.director, ...patch } },
		);
		setSettingsSaved(false);
	};

	const updateImage = (patch: Partial<ImageSettingsDraft>): void => {
		setDraft((previous) =>
			previous === null
				? previous
				: { ...previous, image: { ...previous.image, ...patch } },
		);
		setSettingsSaved(false);
	};

	const setDirectorNumber = (key: DirectorNumberKey, value: string): void => {
		if (draft === null) return;
		updateDirector({ numbers: { ...draft.director.numbers, [key]: value } });
	};

	const setDeepNumber = (key: DeepNumberKey, value: string): void => {
		if (draft === null) return;
		updateDraft({ deep: { ...draft.deep, [key]: value } });
	};

	const saveSettings = (): void => {
		if (draft === null || settingsBusy) return;
		const parsed = parseSettingsDraft(draft);
		setSettingsErrors(parsed.errors);
		setSettingsSaved(false);
		if (parsed.errors.length > 0) return;
		setSettingsBusy(true);
		void api
			.updateSettings(storyId, parsed.update)
			.then(async () => {
				await reload();
				setSettingsSaved(true);
			})
			.catch((error: unknown) => {
				setSettingsErrors(settingsErrorsFromFailure(error));
			})
			.finally(() => {
				setSettingsBusy(false);
			});
	};

	const saveTemplate = (): void => {
		if (templateDraft === null || selectedTemplateId === null || templateBusy) {
			return;
		}
		const errors = validateTemplateDraft(templateDraft);
		setTemplateErrors(errors);
		setTemplateSaved(false);
		if (errors.length > 0) return;
		setTemplateBusy(true);
		void api
			.updateTemplate(selectedTemplateId, {
				name: templateDraft.name,
				template: buildContextTemplate(templateDraft),
			})
			.then(async () => {
				await reload();
				setTemplateSaved(true);
			})
			.catch((error: unknown) => {
				setTemplateErrors(settingsErrorsFromFailure(error));
			})
			.finally(() => {
				setTemplateBusy(false);
			});
	};

	const copyTemplate = (): void => {
		if (templateDraft === null || templateBusy) return;
		const name = copyName.trim();
		if (name.length === 0) {
			setTemplateErrors([{ path: "name", message: "新模板名称不能为空" }]);
			return;
		}
		const copy: TemplateFormDraft = { ...templateDraft, name };
		const errors = validateTemplateDraft(copy);
		setTemplateErrors(errors);
		if (errors.length > 0) return;
		setTemplateBusy(true);
		void api
			.createTemplate({ name, template: buildContextTemplate(copy) })
			.then(async (record) => {
				await api.updateSettings(storyId, { templateId: record.id });
				await reload();
				setTemplateSaved(true);
			})
			.catch((error: unknown) => {
				setTemplateErrors(settingsErrorsFromFailure(error));
			})
			.finally(() => {
				setTemplateBusy(false);
			});
	};

	const applyTemplateChoice = (): void => {
		if (draft === null || settingsBusy) return;
		setSettingsBusy(true);
		void api
			.updateSettings(storyId, {
				templateId: draft.templateId.length === 0 ? null : draft.templateId,
			})
			.then(async () => {
				await reload();
				setSettingsSaved(true);
			})
			.catch((error: unknown) => {
				setSettingsErrors(settingsErrorsFromFailure(error));
			})
			.finally(() => {
				setSettingsBusy(false);
			});
	};

	const updateTemplateDraft = (next: TemplateFormDraft): void => {
		setTemplateDraft(next);
		setTemplateSaved(false);
	};

	const templateChoiceOptions = [
		{ value: "", label: DEFAULT_TEMPLATE_NAME },
		...templates.map((record) => ({ value: record.id, label: record.name })),
	];

	const imageWorkflowOptions = [
		{ value: "", label: "未选择" },
		...imageWorkflows.map((record) => ({
			value: record.id,
			label: record.name,
		})),
		...(draft !== null &&
		draft.image.workflowId.length > 0 &&
		!imageWorkflows.some((record) => record.id === draft.image.workflowId)
			? [
					{
						value: draft.image.workflowId,
						label: `已删除的 workflow（${draft.image.workflowId}）`,
					},
				]
			: []),
	];

	return (
		<div className="settings-page">
			<header className="ledger-floor-head">
				<p className="ledger-meta">保存后下一轮生效。</p>
			</header>
			<ErrorNotice error={loadError} />
			{settings === null || draft === null ? (
				<p className="muted">正在读取故事设置…</p>
			) : (
				<>
					<section className="director-section" aria-label="模型与生成">
						<header className="director-section-head">
							<h2>模型与生成</h2>
						</header>
						<div className="settings-grid">
							<Field label="故事模型（留空使用渠道默认）">
								<input
									type="text"
									value={draft.model}
									onChange={(event) =>
										updateDraft({ model: event.target.value })
									}
									disabled={settingsBusy}
									placeholder="main"
								/>
							</Field>
							<Field label="上下文预算 token">
								<input
									type="text"
									inputMode="numeric"
									value={draft.budgetTokens}
									onChange={(event) =>
										updateDraft({ budgetTokens: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
							<Field label="输出上限 token">
								<input
									type="text"
									inputMode="numeric"
									value={draft.maxTokens}
									onChange={(event) =>
										updateDraft({ maxTokens: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
							<Field label="温度（0 到 2）">
								<input
									type="text"
									inputMode="decimal"
									value={draft.temperature}
									onChange={(event) =>
										updateDraft({ temperature: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
							<Field label="结构化输出">
								<select
									value={draft.structuredOutput}
									onChange={(event) =>
										updateDraft({
											structuredOutput: event.target
												.value as SettingsFormDraft["structuredOutput"],
										})
									}
									disabled={settingsBusy}
								>
									{STRUCTURED_OUTPUT_CHOICES.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
							<Field label="思考档位">
								<select
									value={draft.reasoning}
									onChange={(event) =>
										updateDraft({
											reasoning: event.target
												.value as SettingsFormDraft["reasoning"],
										})
									}
									disabled={settingsBusy}
								>
									{REASONING_CHOICES.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
							<Field label="读取工具软上限">
								<input
									type="text"
									inputMode="numeric"
									value={draft.maxReadRounds}
									onChange={(event) =>
										updateDraft({ maxReadRounds: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
							<Field label="知情者视角（留空为全知）">
								<input
									type="text"
									value={draft.viewpoint}
									onChange={(event) =>
										updateDraft({ viewpoint: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
						</div>
					</section>
					<section className="director-section" aria-label="深回合">
						<header className="director-section-head">
							<h2>深回合</h2>
							<span className="ledger-tag">只用作防失控上限</span>
						</header>
						<div className="settings-grid">
							{DEEP_NUMBER_FIELDS.map((field) => (
								<Field key={field.key} label={field.label}>
									<input
										type="text"
										inputMode="numeric"
										value={draft.deep[field.key]}
										onChange={(event) =>
											setDeepNumber(field.key, event.target.value)
										}
										disabled={settingsBusy}
									/>
								</Field>
							))}
						</div>
						<p className="muted">
							模板里的深回合配置可以覆盖工具白名单、工具调用上限与时长上限。
						</p>
					</section>
					<section className="director-section" aria-label="角色与视角">
						<header className="director-section-head">
							<h2>角色与视角</h2>
						</header>
						<div className="settings-grid">
							<Field label="角色卡名称">
								<input
									type="text"
									value={draft.cardName}
									onChange={(event) =>
										updateDraft({ cardName: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
							<Field label="玩家扮演">
								<input
									type="text"
									value={draft.persona}
									onChange={(event) =>
										updateDraft({ persona: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
						</div>
						<Field label="角色卡提示词">
							<textarea
								rows={5}
								value={draft.characterPrompt}
								onChange={(event) =>
									updateDraft({ characterPrompt: event.target.value })
								}
								disabled={settingsBusy}
							/>
						</Field>
					</section>
					<section className="director-section" aria-label="间隙后台">
						<header className="director-section-head">
							<h2>间隙后台</h2>
						</header>
						<label className="settings-check">
							<input
								type="checkbox"
								checked={draft.gapPassEnabled}
								onChange={(event) =>
									updateDraft({ gapPassEnabled: event.target.checked })
								}
								disabled={settingsBusy}
							/>
							<span>用一次合并调用代替几个独立后台任务</span>
						</label>
						<div className="settings-grid">
							<Field label="可延后任务的间隙秒数">
								<input
									type="text"
									inputMode="numeric"
									value={draft.gapPlanSeconds}
									onChange={(event) =>
										updateDraft({ gapPlanSeconds: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
						</div>
					</section>
					<section className="director-section" aria-label="生图">
						<header className="director-section-head">
							<h2>生图</h2>
							<span className="ledger-tag">
								{draft.image.mode === "auto"
									? "模型可以调用 illustrate"
									: draft.image.mode === "manual"
										? "只允许手动登记"
										: "已关闭"}
							</span>
						</header>
						<div className="settings-grid">
							<Field label="生图模式">
								<select
									value={draft.image.mode}
									onChange={(event) =>
										updateImage({
											mode: event.target.value as ImageSettingsDraft["mode"],
										})
									}
									disabled={settingsBusy}
								>
									{IMAGE_MODE_CHOICES.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
							<Field label="workflow">
								<select
									value={draft.image.workflowId}
									onChange={(event) =>
										updateImage({ workflowId: event.target.value })
									}
									disabled={settingsBusy}
								>
									{imageWorkflowOptions.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
							<Field label="每楼最多插图（1 到 4）">
								<input
									type="text"
									inputMode="numeric"
									value={draft.image.maxPerFloor}
									onChange={(event) =>
										updateImage({ maxPerFloor: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
							<Field label="两次插图的最小楼层间隔（0 到 100）">
								<input
									type="text"
									inputMode="numeric"
									value={draft.image.minFloorsBetween}
									onChange={(event) =>
										updateImage({ minFloorsBetween: event.target.value })
									}
									disabled={settingsBusy}
								/>
							</Field>
						</div>
						<p className="muted">
							workflow 在<Link to="/settings">设置</Link>
							里导入；视觉档案在设定页。
						</p>
					</section>
					<section className="director-section" aria-label="历史块策略">
						<header className="director-section-head">
							<h2>历史块策略</h2>
						</header>
						<div className="settings-grid">
							<Field label="更早楼层的渲染">
								<select
									value={draft.history.mode}
									onChange={(event) =>
										updateDraft({
											history: {
												...draft.history,
												mode: event.target
													.value as SettingsFormDraft["history"]["mode"],
											},
										})
									}
									disabled={settingsBusy}
								>
									{HISTORY_MODE_CHOICES.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
						</div>
						{draft.history.overrides.map((item, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 覆盖条目按位置编辑，块名可能还没填
							<div className="settings-override" key={index}>
								<div className="plan-field-row">
									<Field label="块类型名">
										<input
											type="text"
											value={item.name}
											onChange={(event) =>
												updateDraft({
													history: {
														...draft.history,
														overrides: draft.history.overrides.map(
															(entry, position) =>
																position === index
																	? { ...entry, name: event.target.value }
																	: entry,
														),
													},
												})
											}
											disabled={settingsBusy}
										/>
									</Field>
									<Field label="上下文策略">
										<select
											value={item.strategy}
											onChange={(event) =>
												updateDraft({
													history: {
														...draft.history,
														overrides: draft.history.overrides.map(
															(entry, position) =>
																position === index
																	? {
																			...entry,
																			strategy: event.target
																				.value as HistoryOverrideFormDraft["strategy"],
																		}
																	: entry,
														),
													},
												})
											}
											disabled={settingsBusy}
										>
											{HISTORY_STRATEGY_CHOICES.map((choice) => (
												<option key={choice.value} value={choice.value}>
													{choice.label}
												</option>
											))}
										</select>
									</Field>
									{item.strategy === "keep-depth" ? (
										<Field label="深度">
											<input
												type="text"
												inputMode="numeric"
												value={item.depth}
												onChange={(event) =>
													updateDraft({
														history: {
															...draft.history,
															overrides: draft.history.overrides.map(
																(entry, position) =>
																	position === index
																		? { ...entry, depth: event.target.value }
																		: entry,
															),
														},
													})
												}
												disabled={settingsBusy}
											/>
										</Field>
									) : null}
									<button
										type="button"
										className="plan-remove"
										onClick={() =>
											updateDraft({
												history: {
													...draft.history,
													overrides: draft.history.overrides.filter(
														(_, position) => position !== index,
													),
												},
											})
										}
										disabled={settingsBusy}
									>
										移除覆盖
									</button>
								</div>
							</div>
						))}
						<button
							type="button"
							className="plan-add"
							onClick={() =>
								updateDraft({
									history: {
										...draft.history,
										overrides: [
											...draft.history.overrides,
											{ name: "", strategy: "keep", depth: "" },
										],
									},
								})
							}
							disabled={settingsBusy}
						>
							添加块类型覆盖
						</button>
						<ul className="settings-summary">
							{describeHistoryPolicy(draft.history).map((line) => (
								<li key={line}>{line}</li>
							))}
						</ul>
					</section>
					<section className="director-section" aria-label="导演参数">
						<header className="director-section-head">
							<h2>导演参数</h2>
						</header>
						<div className="settings-grid">
							<Field label="导演模式">
								<select
									value={draft.director.mode}
									onChange={(event) =>
										updateDirector({
											mode: event.target.value as DirectorFormDraft["mode"],
										})
									}
									disabled={settingsBusy}
								>
									{DIRECTOR_MODE_CHOICES.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
							<Field label="序列拍强度">
								<select
									value={draft.director.intensity}
									onChange={(event) =>
										updateDirector({
											intensity: event.target
												.value as DirectorFormDraft["intensity"],
										})
									}
									disabled={settingsBusy}
								>
									{DIRECTOR_INTENSITY_CHOICES.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
							<Field label="开场强度">
								<select
									value={draft.director.openingIntensity}
									onChange={(event) =>
										updateDirector({
											openingIntensity: event.target
												.value as DirectorFormDraft["openingIntensity"],
										})
									}
									disabled={settingsBusy}
								>
									{DIRECTOR_INTENSITY_CHOICES.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
							<Field label="场景状态路径">
								<input
									type="text"
									value={draft.director.scenePath}
									onChange={(event) =>
										updateDirector({ scenePath: event.target.value })
									}
									disabled={settingsBusy}
									placeholder="场景.地点"
								/>
							</Field>
							<Field label="张力状态路径">
								<input
									type="text"
									value={draft.director.tensionPath}
									onChange={(event) =>
										updateDirector({ tensionPath: event.target.value })
									}
									disabled={settingsBusy}
									placeholder="张力"
								/>
							</Field>
						</div>
						<div className="settings-grid">
							{DIRECTOR_NUMBER_FIELDS.map((field) => (
								<Field key={field.key} label={field.label}>
									<input
										type="text"
										inputMode={field.integer ? "numeric" : "decimal"}
										value={draft.director.numbers[field.key]}
										onChange={(event) =>
											setDirectorNumber(field.key, event.target.value)
										}
										disabled={settingsBusy}
									/>
								</Field>
							))}
						</div>
					</section>
					{settingsErrors.length > 0 ? (
						<ul className="settings-errors" role="alert">
							{settingsErrors.map((error, index) => (
								<li key={`${error.path}-${index}`}>
									{error.path.length === 0
										? error.message
										: `${describeSettingsPath(error.path)}：${error.message}`}
								</li>
							))}
						</ul>
					) : null}
					<div className="plan-toolbar">
						<button
							type="button"
							onClick={saveSettings}
							disabled={settingsBusy}
						>
							{settingsBusy ? "正在保存…" : "保存故事设置"}
						</button>
						<button
							type="button"
							onClick={() => setDraft(buildSettingsDraft(settings))}
							disabled={settingsBusy}
						>
							重置表单
						</button>
						{settingsSaved ? <span className="ledger-tag">已保存</span> : null}
					</div>
					<section className="director-section" aria-label="上下文模板">
						<header className="director-section-head">
							<h2>上下文模板</h2>
							<span className="ledger-tag">
								{templateView?.source === "stored" ? "库里的模板" : "内置默认"}
							</span>
						</header>
						<div className="settings-grid">
							<Field label="故事使用的模板">
								<select
									value={draft.templateId}
									onChange={(event) =>
										updateDraft({ templateId: event.target.value })
									}
									disabled={settingsBusy}
								>
									{templateChoiceOptions.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
						</div>
						<div className="plan-toolbar">
							<button
								type="button"
								onClick={applyTemplateChoice}
								disabled={settingsBusy}
							>
								设为故事默认
							</button>
							<span className="muted">
								切换模板会立即重建下一回合的上下文。
							</span>
						</div>
						{templateDraft === null || templateView === null ? null : (
							<>
								<TemplateEditor
									draft={templateDraft}
									onChange={updateTemplateDraft}
									blockFormatSegment={templateView.blockFormatSegment}
									disabled={templateBusy}
								/>
								{templateErrors.length > 0 ? (
									<ul className="settings-errors" role="alert">
										{templateErrors.map((error, index) => (
											<li key={`${error.path}-${index}`}>
												{error.path.length === 0
													? error.message
													: `${error.path}：${error.message}`}
											</li>
										))}
									</ul>
								) : null}
								<div className="plan-field-row">
									<Field label="新模板名称（复制用）">
										<input
											type="text"
											value={copyName}
											onChange={(event) => setCopyName(event.target.value)}
											disabled={templateBusy}
										/>
									</Field>
								</div>
								<div className="plan-toolbar">
									<button
										type="button"
										onClick={saveTemplate}
										disabled={templateBusy || selectedTemplateId === null}
									>
										{templateBusy ? "正在保存…" : "保存模板"}
									</button>
									<button
										type="button"
										onClick={copyTemplate}
										disabled={templateBusy}
									>
										复制为新模板并设为默认
									</button>
									<button
										type="button"
										onClick={() =>
											setTemplateDraft(
												templateDraftFrom(
													templateView.template,
													templates.find(
														(record) => record.id === selectedTemplateId,
													)?.name ?? DEFAULT_TEMPLATE_NAME,
												),
											)
										}
										disabled={templateBusy}
									>
										重置模板
									</button>
									{templateSaved ? (
										<span className="ledger-tag">已保存</span>
									) : null}
								</div>
								<p className="muted">
									内置默认模板不能直接保存；先复制为新模板，再编辑保存。
								</p>
							</>
						)}
					</section>
					<section className="director-section" aria-label="实验">
						<header className="director-section-head">
							<h2>实验</h2>
							<span className="ledger-tag">只在你自己选择时生效</span>
						</header>
						<div className="settings-grid">
							<Field label="写法">
								<select
									value={draft.turnMode}
									onChange={(event) =>
										updateDraft({
											turnMode: event.target
												.value as SettingsFormDraft["turnMode"],
										})
									}
									disabled={settingsBusy}
								>
									{TURN_MODE_CHOICES.map((choice) => (
										<option key={choice.value} value={choice.value}>
											{choice.label}
										</option>
									))}
								</select>
							</Field>
						</div>
						<p className="muted">
							默认是快速写法。规划与深度是实验写法，程序不会自动切换；
							选过之后可以在故事页输入台看到并改回快速。
						</p>
					</section>
				</>
			)}
		</div>
	);
}

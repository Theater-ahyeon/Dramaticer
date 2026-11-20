import type { ComfyUiSlotName, ComfyUiWorkflow } from "@dramaticer/core";
import type {
	ImageProviderView,
	ImageWorkflowDetectionView,
	ImageWorkflowView,
	StoryVisualProfilesView,
} from "@dramaticer/protocol";
import { type ReactNode, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api";
import {
	IMAGE_SLOT_LABELS,
	IMAGE_SLOT_NAMES,
	type ImageFieldError,
	type WorkflowSlotSelections,
	defaultSlotSelections,
	describeImageErrorPath,
	emptySlotSelections,
	parseWorkflowText,
	resolveImportSlots,
	slotRefLabel,
	workflowNameFromFile,
} from "../../chat/image-form";
import { settingsErrorsFromFailure } from "../../chat/settings-form";
import { ErrorNotice } from "../../components/ErrorNotice";
import { NovelAiTemplateForm } from "./NovelAiTemplate";

type VisualProfile = StoryVisualProfilesView["profiles"][number];

const PROFILE_SOURCE_LABELS: Readonly<Record<string, string>> = {
	model: "模型生成",
	player: "玩家填写",
	import: "导入",
};

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

function describeWorkflowSlots(workflow: ImageWorkflowView): string {
	if (workflow.kind === "novelai") {
		const p = workflow.payload;
		return `NovelAI ${p.model}，${p.width}×${p.height}，${p.steps} 步，引导 ${p.scale}，${p.sampler}`;
	}
	const slots = workflow.slots;
	const parts = [
		`正向 ${slotRefLabel(slots.positive.nodeId, slots.positive.input)}`,
		`seed ${slotRefLabel(slots.seed.nodeId, slots.seed.input)}`,
	];
	if (slots.negative !== null) {
		parts.push(
			`负向 ${slotRefLabel(slots.negative.nodeId, slots.negative.input)}`,
		);
	}
	if (slots.width !== null) {
		parts.push(`宽 ${slotRefLabel(slots.width.nodeId, slots.width.input)}`);
	}
	if (slots.height !== null) {
		parts.push(`高 ${slotRefLabel(slots.height.nodeId, slots.height.input)}`);
	}
	return parts.join("，");
}

function ProviderRow({ provider }: { readonly provider: ImageProviderView }) {
	return (
		<li className="image-provider-row" data-provider={provider.id}>
			<strong>{provider.id}</strong>
			<span className="ledger-tag">{provider.api}</span>
			<span className="muted">{provider.baseUrl}</span>
			<span className={provider.configured ? "ledger-tag" : "ledger-warning"}>
				{provider.configured ? "已配置" : "未配置"}
			</span>
		</li>
	);
}

export function ImagesTool() {
	const { storyId } = useParams();
	const [providers, setProviders] = useState<readonly ImageProviderView[]>([]);
	const [workflows, setWorkflows] = useState<readonly ImageWorkflowView[]>([]);
	const [profiles, setProfiles] = useState<readonly VisualProfile[]>([]);
	const [loadError, setLoadError] = useState<unknown>(null);
	const [name, setName] = useState("");
	const [workflow, setWorkflow] = useState<ComfyUiWorkflow | null>(null);
	const [detection, setDetection] = useState<ImageWorkflowDetectionView | null>(
		null,
	);
	const [selections, setSelections] =
		useState<WorkflowSlotSelections>(emptySlotSelections);
	const [errors, setErrors] = useState<readonly ImageFieldError[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [profileBusy, setProfileBusy] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const reloadWorkflows = async (): Promise<void> => {
		const view = await api.getImageWorkflows();
		setWorkflows(view.workflows);
	};

	const reloadProfiles = async (): Promise<void> => {
		if (storyId === undefined) return;
		const view = await api.getVisualProfiles(storyId);
		setProfiles(view.profiles);
	};

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		setLoadError(null);
		void (async () => {
			try {
				const [providerView, workflowView, profileView] = await Promise.all([
					api.getImageProviders(),
					api.getImageWorkflows(),
					api.getVisualProfiles(storyId),
				]);
				if (!active) return;
				setProviders(providerView.providers);
				setWorkflows(workflowView.workflows);
				setProfiles(profileView.profiles);
			} catch (error) {
				if (active) setLoadError(error);
			}
		})();
		return () => {
			active = false;
		};
	}, [storyId]);

	const resetImport = (): void => {
		setWorkflow(null);
		setDetection(null);
		setSelections(emptySlotSelections());
		setErrors([]);
		setNotice(null);
	};

	const handleFile = (file: File): void => {
		resetImport();
		setName(workflowNameFromFile(file.name));
		setBusy(true);
		void (async () => {
			try {
				const parsed = parseWorkflowText(await file.text());
				if (parsed.error !== null || parsed.workflow === null) {
					setErrors([
						{ path: "workflow", message: parsed.error ?? "workflow 为空" },
					]);
					return;
				}
				setWorkflow(parsed.workflow);
				const detected = await api.detectImageWorkflow({
					workflow: parsed.workflow,
				});
				setDetection(detected);
				setSelections(defaultSlotSelections(detected));
			} catch (error) {
				setErrors(settingsErrorsFromFailure(error));
			} finally {
				setBusy(false);
			}
		})();
	};

	const updateSelection = (slot: ComfyUiSlotName, value: string): void => {
		setSelections((previous) => ({ ...previous, [slot]: value }));
	};

	const saveWorkflow = (): void => {
		if (busy) return;
		if (workflow === null || detection === null) {
			setErrors([
				{ path: "workflow", message: "先选择 workflow JSON 文件并识别插槽" },
			]);
			return;
		}
		const nextErrors: ImageFieldError[] = [];
		const trimmedName = name.trim();
		if (trimmedName.length === 0) {
			nextErrors.push({ path: "name", message: "workflow 名称不能为空" });
		}
		const resolved = resolveImportSlots(detection, selections);
		nextErrors.push(...resolved.errors);
		setErrors(nextErrors);
		setNotice(null);
		if (nextErrors.length > 0 || resolved.slots === null) return;
		setBusy(true);
		void api
			.importImageWorkflow({
				name: trimmedName,
				workflow,
				slots: resolved.slots,
			})
			.then(async (saved) => {
				await reloadWorkflows();
				setNotice(`已保存 workflow：${saved.name}`);
				setDetection(null);
				setSelections(emptySlotSelections());
			})
			.catch((error: unknown) => {
				setErrors(settingsErrorsFromFailure(error));
			})
			.finally(() => {
				setBusy(false);
			});
	};

	const deleteWorkflow = (target: ImageWorkflowView): void => {
		if (deletingId !== null) return;
		setDeletingId(target.id);
		setErrors([]);
		setNotice(null);
		void api
			.deleteImageWorkflow(target.id)
			.then(async () => {
				await reloadWorkflows();
				setNotice(`已删除 workflow：${target.name}`);
			})
			.catch((error: unknown) => {
				setErrors(settingsErrorsFromFailure(error));
			})
			.finally(() => {
				setDeletingId(null);
			});
	};

	const regenerateProfiles = (): void => {
		if (storyId === undefined || profileBusy) return;
		setProfileBusy(true);
		setErrors([]);
		setNotice(null);
		void api
			.generateVisualProfiles(storyId)
			.then((result) => {
				setNotice(`视觉档案已加入后台队列（任务 ${result.jobId}）`);
			})
			.catch((error: unknown) => {
				setErrors(settingsErrorsFromFailure(error));
			})
			.finally(() => {
				setProfileBusy(false);
			});
	};

	const refreshProfiles = (): void => {
		if (profileBusy) return;
		setProfileBusy(true);
		setErrors([]);
		void reloadProfiles()
			.then(() => setNotice("视觉档案已刷新"))
			.catch((error: unknown) => setErrors(settingsErrorsFromFailure(error)))
			.finally(() => setProfileBusy(false));
	};

	if (storyId === undefined) {
		return (
			<section className="panel">
				<p>地址里缺少故事 id。</p>
			</section>
		);
	}

	return (
		<div className="settings-page image-page">
			<header className="ledger-floor-head">
				<h1>生图</h1>
				<p className="ledger-meta">
					ComfyUI workflow 与角色视觉档案；生图模式与频率在故事设置里。
				</p>
			</header>
			<ErrorNotice error={loadError} />
			<section className="director-section" aria-label="生图后端">
				<header className="director-section-head">
					<h2>生图后端</h2>
					<span className="ledger-tag">{providers.length} 个 provider</span>
				</header>
				{providers.length === 0 ? (
					<p className="muted">
						没有配置生图后端。把 `data/images.yaml` 放到服务端并重启后可用。
					</p>
				) : (
					<ul className="image-provider-list">
						{providers.map((provider) => (
							<ProviderRow key={provider.id} provider={provider} />
						))}
					</ul>
				)}
			</section>
			<section className="director-section" aria-label="导入 workflow">
				<header className="director-section-head">
					<h2>导入 workflow</h2>
				</header>
				<div className="settings-grid">
					<Field label="workflow JSON 文件">
						<input
							type="file"
							accept="application/json,.json"
							onChange={(event) => {
								const file = event.target.files?.[0];
								event.target.value = "";
								if (file !== undefined) handleFile(file);
							}}
							disabled={busy}
						/>
					</Field>
					<Field label="workflow 名称">
						<input
							type="text"
							value={name}
							onChange={(event) => setName(event.target.value)}
							disabled={busy}
						/>
					</Field>
				</div>
				{detection === null ? null : (
					<>
						<p className="muted">
							自动识别完成。候选插槽必须逐项确认后才能保存
							{detection.unresolved.length === 0
								? "。"
								: `；需要确认：${detection.unresolved
										.map((slot) => IMAGE_SLOT_LABELS[slot])
										.join("、")}。`}
						</p>
						<div className="settings-grid">
							{IMAGE_SLOT_NAMES.map((slot) => (
								<Field key={slot} label={IMAGE_SLOT_LABELS[slot]}>
									<select
										value={selections[slot]}
										onChange={(event) =>
											updateSelection(slot, event.target.value)
										}
										disabled={busy}
									>
										<option value="">
											{slot === "positive" || slot === "seed"
												? "请选择"
												: "不使用"}
										</option>
										{detection.candidates[slot].map((ref, index) => (
											<option
												key={`${ref.nodeId}-${ref.input}`}
												value={String(index)}
											>
												{slotRefLabel(ref.nodeId, ref.input)}
											</option>
										))}
									</select>
								</Field>
							))}
						</div>
						<div className="plan-toolbar">
							<button type="button" onClick={saveWorkflow} disabled={busy}>
								{busy ? "正在保存…" : "确认插槽并保存"}
							</button>
							<button type="button" onClick={resetImport} disabled={busy}>
								取消
							</button>
						</div>
					</>
				)}
			</section>
			{providers.some((provider) => provider.api === "novelai") ? (
				<NovelAiTemplateForm
					providers={providers
						.filter((provider) => provider.api === "novelai")
						.map((provider) => provider.id)}
					onSaved={() => void reloadWorkflows()}
				/>
			) : null}
			<section className="director-section" aria-label="workflow 列表">
				<header className="director-section-head">
					<h2>已保存的 workflow</h2>
					<span className="ledger-tag">{workflows.length} 个</span>
				</header>
				{workflows.length === 0 ? (
					<p className="muted">还没有保存 workflow。</p>
				) : (
					<ul className="image-workflow-list">
						{workflows.map((record) => (
							<li
								className="image-workflow-card"
								key={record.id}
								data-workflow={record.name}
							>
								<div className="image-workflow-head">
									<strong>{record.name}</strong>
									<span className="ledger-tag">{record.provider}</span>
								</div>
								<p className="ledger-meta">{describeWorkflowSlots(record)}</p>
								<p className="muted">更新于 {record.updatedAt}</p>
								<button
									type="button"
									className="plan-remove"
									onClick={() => deleteWorkflow(record)}
									disabled={deletingId !== null}
								>
									{deletingId === record.id ? "正在删除…" : "删除"}
								</button>
							</li>
						))}
					</ul>
				)}
			</section>
			<section className="director-section" aria-label="角色视觉档案">
				<header className="director-section-head">
					<h2>角色视觉档案</h2>
					<span className="ledger-tag">{profiles.length} 人</span>
				</header>
				<div className="plan-toolbar">
					<button
						type="button"
						onClick={regenerateProfiles}
						disabled={profileBusy}
					>
						{profileBusy ? "正在入队…" : "重新生成视觉档案"}
					</button>
					<button
						type="button"
						onClick={refreshProfiles}
						disabled={profileBusy}
					>
						刷新档案
					</button>
				</div>
				{profiles.length === 0 ? (
					<p className="muted">
						还没有视觉档案；导入角色卡后会自动生成，也可以手动重新生成。
					</p>
				) : (
					<ul className="image-profile-list">
						{profiles.map((record) => (
							<li className="image-profile-card" key={record.character}>
								<div className="image-workflow-head">
									<strong>{record.character}</strong>
									<span className="ledger-tag">
										{PROFILE_SOURCE_LABELS[record.source] ?? record.source}
									</span>
								</div>
								<dl className="image-profile-fields">
									<div>
										<dt>基础外貌</dt>
										<dd>{record.profile.base.join("、") || "未提供"}</dd>
									</div>
									<div>
										<dt>默认服装</dt>
										<dd>{record.profile.defaultOutfit}</dd>
									</div>
									<div>
										<dt>负向标签</dt>
										<dd>{record.profile.negative.join("、") || "无"}</dd>
									</div>
									<div>
										<dt>更新时间</dt>
										<dd>{record.updatedAt}</dd>
									</div>
								</dl>
							</li>
						))}
					</ul>
				)}
			</section>
			{errors.length > 0 ? (
				<ul className="settings-errors" role="alert">
					{errors.map((error, index) => (
						<li key={`${error.path}-${index}`}>
							{error.path.length === 0
								? error.message
								: `${describeImageErrorPath(error.path)}：${error.message}`}
						</li>
					))}
				</ul>
			) : null}
			{notice === null ? null : <p className="ledger-tag">{notice}</p>}
		</div>
	);
}

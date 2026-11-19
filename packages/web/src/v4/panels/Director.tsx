import type {
	DirectorIntensity,
	DirectorMode,
	DirectorPlan,
	LedgerClue,
	TurnTrace,
} from "@dramaticer/core";
import type {
	NodeDirectorView,
	StoryPath,
	StorySettings,
	StoryTree,
} from "@dramaticer/protocol";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, type StoryPathOptions, api } from "../../api";
import {
	PATH_PAGE_LIMIT,
	buildBranchRows,
	collectPathNodeIds,
	toggleCollapsed,
} from "../../chat/branch-tree";
import { setComposerDraft } from "../../chat/composer-draft";
import {
	DIRECTOR_INTENSITY_CHOICES,
	DIRECTOR_MODE_CHOICES,
	emptyDirectorPlan,
} from "../../chat/director-view";
import { formatFloorTime } from "../../chat/format";
import { formatNodeRef } from "../../chat/ledger-view";
import { ErrorNotice } from "../../components/ErrorNotice";
import { BranchTree } from "../../components/branches/BranchTree";
import { CandidateActions } from "../../components/chat/CandidateActions";
import { DirectorDecision } from "../../components/director/DirectorDecision";
import { DirectorPlanEditor } from "../../components/director/PlanEditor";
import { TracePanel } from "../../components/director/TracePanel";

export function DirectorTool() {
	const { storyId } = useParams();
	const navigate = useNavigate();
	const [tree, setTree] = useState<StoryTree | null>(null);
	const [pathNodeIds, setPathNodeIds] = useState<readonly string[]>([]);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<unknown>(null);
	const [settings, setSettings] = useState<StorySettings | null>(null);
	const [plan, setPlan] = useState<DirectorPlan>(emptyDirectorPlan());
	const [draftPlan, setDraftPlan] = useState<DirectorPlan>(emptyDirectorPlan());
	const [planBusy, setPlanBusy] = useState(false);
	const [planError, setPlanError] = useState<unknown>(null);
	const [planSaved, setPlanSaved] = useState(false);
	const [clues, setClues] = useState<readonly LedgerClue[]>([]);
	const [clueBusyId, setClueBusyId] = useState<string | null>(null);
	const [clueError, setClueError] = useState<unknown>(null);
	const [mode, setMode] = useState<DirectorMode>("transparent");
	const [intensity, setIntensity] = useState<DirectorIntensity>("natural");
	const [openingIntensity, setOpeningIntensity] =
		useState<DirectorIntensity>("natural");
	const [openingFloors, setOpeningFloors] = useState(10);
	const [settingsBusy, setSettingsBusy] = useState(false);
	const [settingsError, setSettingsError] = useState<unknown>(null);
	const [settingsSaved, setSettingsSaved] = useState(false);
	const [director, setDirector] = useState<NodeDirectorView | null>(null);
	const [actions, setActions] = useState<
		ReadonlyArray<{
			readonly id: string;
			readonly ordinal: number;
			readonly kind: "action" | "scene_change";
			readonly text: string;
		}>
	>([]);
	const [trace, setTrace] = useState<TurnTrace | null>(null);
	const [traceNote, setTraceNote] = useState<string | null>(null);
	const [traceError, setTraceError] = useState<unknown>(null);
	const [nodeError, setNodeError] = useState<unknown>(null);
	const [nodeLoading, setNodeLoading] = useState(false);
	const requestRef = useRef(0);

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		requestRef.current += 1;
		setTree(null);
		setPathNodeIds([]);
		setCollapsed(new Set());
		setSelectedId(null);
		setLoadError(null);
		setSettings(null);
		setPlan(emptyDirectorPlan());
		setDraftPlan(emptyDirectorPlan());
		setPlanBusy(false);
		setPlanError(null);
		setPlanSaved(false);
		setClues([]);
		setClueBusyId(null);
		setClueError(null);
		setSettingsError(null);
		setSettingsSaved(false);
		setDirector(null);
		setActions([]);
		setTrace(null);
		setTraceNote(null);
		setTraceError(null);
		setNodeError(null);
		void (async () => {
			try {
				const [loadedTree, ids, loadedSettings, planView, clueView] =
					await Promise.all([
						api.getTree(storyId),
						collectPathNodeIds((before) => fetchPathPage(storyId, before)),
						api.getSettings(storyId),
						api.getDirectorPlan(storyId),
						api.getClues(storyId),
					]);
				if (!active) return;
				setTree(loadedTree);
				setPathNodeIds(ids);
				setSettings(loadedSettings);
				setMode(loadedSettings.directorConfig.mode);
				setIntensity(loadedSettings.directorConfig.intensity);
				setOpeningIntensity(loadedSettings.directorConfig.openingIntensity);
				setOpeningFloors(loadedSettings.directorConfig.openingFloors);
				setPlan(planView.plan);
				setDraftPlan(planView.plan);
				setClues(clueView.clues);
				setSelectedId(loadedTree.headNodeId);
			} catch (error) {
				if (active) setLoadError(error);
			}
		})();
		return () => {
			active = false;
		};
	}, [storyId]);

	useEffect(() => {
		if (storyId === undefined || selectedId === null) {
			setDirector(null);
			setActions([]);
			setTrace(null);
			setTraceNote(null);
			setTraceError(null);
			return;
		}
		const request = requestRef.current + 1;
		requestRef.current = request;
		let active = true;
		setNodeLoading(true);
		setNodeError(null);
		setTraceError(null);
		setTraceNote(null);
		setDirector(null);
		setActions([]);
		setTrace(null);
		void (async () => {
			try {
				const [directorView, actionsView] = await Promise.all([
					api.getDirector(selectedId),
					api.getActions(selectedId),
				]);
				if (!active || requestRef.current !== request) return;
				setDirector(directorView);
				setActions(actionsView.actions);
			} catch (error) {
				if (active && requestRef.current === request) setNodeError(error);
			}
			try {
				const value = await api.getTrace(selectedId);
				if (!active || requestRef.current !== request) return;
				setTrace(value);
			} catch (error) {
				if (!active || requestRef.current !== request) return;
				if (error instanceof ApiError && error.status === 404) {
					setTraceNote(
						"这一楼没有 Trace；只有生成完成的助手楼层才有生成记录。",
					);
				} else {
					setTraceError(error);
				}
			} finally {
				if (active && requestRef.current === request) setNodeLoading(false);
			}
		})();
		return () => {
			active = false;
		};
	}, [storyId, selectedId]);

	const changePlan = (next: DirectorPlan) => {
		setDraftPlan(next);
		setPlanSaved(false);
	};

	const savePlan = () => {
		if (storyId === undefined || planBusy) return;
		setPlanBusy(true);
		setPlanError(null);
		setPlanSaved(false);
		void api
			.updateDirectorPlan(storyId, { plan: draftPlan })
			.then((result) => {
				setPlan(result.plan);
				setDraftPlan(result.plan);
				setPlanSaved(true);
			})
			.catch((error: unknown) => {
				setPlanError(error);
			})
			.finally(() => {
				setPlanBusy(false);
			});
	};

	const resetPlan = () => {
		setDraftPlan(plan);
		setPlanError(null);
		setPlanSaved(false);
	};

	const saveDirectorConfig = () => {
		if (storyId === undefined || settings === null || settingsBusy) return;
		setSettingsBusy(true);
		setSettingsError(null);
		setSettingsSaved(false);
		void api
			.updateSettings(storyId, {
				directorConfig: {
					...settings.directorConfig,
					mode,
					intensity,
					openingIntensity,
					openingFloors,
				},
			})
			.then((updated) => {
				setSettings(updated);
				setMode(updated.directorConfig.mode);
				setIntensity(updated.directorConfig.intensity);
				setOpeningIntensity(updated.directorConfig.openingIntensity);
				setOpeningFloors(updated.directorConfig.openingFloors);
				setSettingsSaved(true);
				if (selectedId !== null) {
					void api
						.getDirector(selectedId)
						.then((view) => {
							setDirector(view);
							setNodeError(null);
						})
						.catch((error: unknown) => {
							setNodeError(error);
						});
				}
			})
			.catch((error: unknown) => {
				setSettingsError(error);
			})
			.finally(() => {
				setSettingsBusy(false);
			});
	};

	const fulfillClue = (clueId: string) => {
		if (storyId === undefined || clueBusyId !== null) return;
		setClueBusyId(clueId);
		setClueError(null);
		void api
			.fulfillClue(clueId, { storyId })
			.then(async () => {
				const view = await api.getClues(storyId);
				setClues(view.clues);
			})
			.catch((error: unknown) => {
				setClueError(error);
			})
			.finally(() => {
				setClueBusyId(null);
			});
	};

	const pickAction = (text: string) => {
		if (storyId === undefined) return;
		setComposerDraft(storyId, text);
		navigate(`/stories/${encodeURIComponent(storyId)}/chat`);
	};

	const rows =
		tree === null
			? []
			: buildBranchRows({
					tree,
					pathNodeIds: new Set(pathNodeIds),
					collapsed,
				});
	const selected =
		tree === null
			? null
			: (tree.nodes.find((node) => node.id === selectedId) ?? null);
	const selectedAssistant = selected !== null && selected.role === "assistant";

	return (
		<div className="ledger-layout director-layout">
			<aside className="ledger-tree-pane">
				<h2>楼层</h2>
				<p className="muted">
					选择任意一层查看那一楼的导演决策、候选行动与 Trace。
				</p>
				{tree === null ? null : (
					<BranchTree
						rows={rows}
						selectedId={selectedId}
						focusSignal={0}
						onSelect={setSelectedId}
						onToggle={(nodeId) =>
							setCollapsed((previous) => toggleCollapsed(previous, nodeId))
						}
					/>
				)}
			</aside>
			<div className="ledger-detail-pane">
				<ErrorNotice error={loadError} />
				{tree !== null && tree.nodes.length === 0 ? (
					<p className="muted">这个故事还没有楼层。</p>
				) : null}
				{tree !== null && tree.nodes.length > 0 && selected === null ? (
					<p className="muted">正在读取导演记录…</p>
				) : null}
				{selected !== null ? (
					<>
						<header className="ledger-floor-head">
							<h1>导演</h1>
							<p className="ledger-meta">
								楼层 {formatNodeRef(selected.id)} ·{" "}
								{selected.role === "user" ? "你" : "剧情"} ·{" "}
								{formatFloorTime(selected.createdAt)}
							</p>
						</header>
						<ErrorNotice error={nodeError} />
						{nodeLoading ? <p className="muted">正在读取导演记录…</p> : null}
						<section className="director-section" aria-label="导演模式与强度">
							<header className="director-section-head">
								<h2>模式与强度</h2>
							</header>
							<p className="muted">
								模式只由玩家切换；下一回合按这里的设置评估与注入。
							</p>
							{settings === null ? (
								<p className="muted">正在读取故事设置…</p>
							) : (
								<>
									<div className="plan-field-row">
										<label className="plan-field">
											<span>导演模式</span>
											<select
												value={mode}
												onChange={(event) =>
													setMode(event.target.value as DirectorMode)
												}
												disabled={settingsBusy}
											>
												{DIRECTOR_MODE_CHOICES.map((choice) => (
													<option key={choice.value} value={choice.value}>
														{choice.label}
													</option>
												))}
											</select>
										</label>
										<label className="plan-field">
											<span>序列拍强度</span>
											<select
												value={intensity}
												onChange={(event) =>
													setIntensity(event.target.value as DirectorIntensity)
												}
												disabled={settingsBusy}
											>
												{DIRECTOR_INTENSITY_CHOICES.map((choice) => (
													<option key={choice.value} value={choice.value}>
														{choice.label}
													</option>
												))}
											</select>
										</label>
										<label className="plan-field">
											<span>开场强度</span>
											<select
												value={openingIntensity}
												onChange={(event) =>
													setOpeningIntensity(
														event.target.value as DirectorIntensity,
													)
												}
												disabled={settingsBusy}
											>
												{DIRECTOR_INTENSITY_CHOICES.map((choice) => (
													<option key={choice.value} value={choice.value}>
														{choice.label}
													</option>
												))}
											</select>
										</label>
										<label className="plan-field">
											<span>开场楼层数（0 关闭）</span>
											<input
												type="number"
												min={0}
												step={1}
												value={openingFloors}
												onChange={(event) => {
													const value = Number.parseInt(event.target.value, 10);
													setOpeningFloors(
														Number.isFinite(value) && value >= 0 ? value : 0,
													);
												}}
												disabled={settingsBusy}
											/>
										</label>
									</div>
									<div className="plan-toolbar">
										<button
											type="button"
											onClick={saveDirectorConfig}
											disabled={settingsBusy}
										>
											{settingsBusy ? "正在保存…" : "保存设置"}
										</button>
										{settingsSaved ? (
											<span className="ledger-tag">已保存</span>
										) : null}
									</div>
									<ErrorNotice error={settingsError} />
								</>
							)}
						</section>
						{director === null ? null : (
							<DirectorDecision view={director} plan={plan} />
						)}
						<section className="director-section" aria-label="候选行动">
							<header className="director-section-head">
								<h2>候选行动</h2>
							</header>
							{actions.length === 0 ? (
								<p className="muted">
									{selectedAssistant
										? "本楼还没有候选行动；间隙后台任务写入后出现。"
										: "只有助手楼层才有候选行动。"}
								</p>
							) : (
								<CandidateActions actions={actions} onPick={pickAction} />
							)}
						</section>
						<DirectorPlanEditor
							saved={plan}
							draft={draftPlan}
							onChange={changePlan}
							onSave={savePlan}
							onReset={resetPlan}
							saving={planBusy}
							savedNotice={planSaved}
							error={planError}
						/>
						<section className="director-section" aria-label="未兑现线索">
							<header className="director-section-head">
								<h2>未兑现线索</h2>
								<span className="ledger-tag">当前路径</span>
							</header>
							<ErrorNotice error={clueError} />
							{clues.length === 0 ? (
								<p className="muted">没有未兑现的线索。</p>
							) : (
								<ul className="ledger-story-list">
									{clues.map((clue) => (
										<li key={clue.id} className="ledger-story-item">
											<div className="ledger-diff-head">
												<span className="ledger-path">
													{clue.text ?? clue.id}
												</span>
												<span className="ledger-tag">
													{clue.status ?? "状态未记录"}
												</span>
											</div>
											<p className="ledger-meta">
												开启 {clue.openedAt ?? "未记录"} · 更新{" "}
												{clue.updatedAt ?? "未记录"}
											</p>
											<div className="plan-toolbar">
												<button
													type="button"
													onClick={() => fulfillClue(clue.id)}
													disabled={clueBusyId !== null}
												>
													{clueBusyId === clue.id ? "正在兑现…" : "兑现线索"}
												</button>
											</div>
										</li>
									))}
								</ul>
							)}
						</section>
						<TracePanel
							trace={trace}
							note={traceNote}
							loading={nodeLoading}
							error={traceError}
						/>
					</>
				) : null}
			</div>
		</div>
	);
}

function fetchPathPage(
	storyId: string,
	before: string | undefined,
): Promise<StoryPath> {
	const options: StoryPathOptions =
		before === undefined
			? { limit: PATH_PAGE_LIMIT }
			: { limit: PATH_PAGE_LIMIT, before };
	return api.getPath(storyId, options);
}

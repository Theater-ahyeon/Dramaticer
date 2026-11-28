import type { LedgerChangeCard } from "@dramaticer/core";
import type {
	AssistantActionView,
	AssistantContextUsage,
	AssistantConversationDetailView,
	AssistantConversationStatus,
	AssistantConversationStatusView,
	AssistantConversationView,
	AssistantMessageView,
	AssistantPermission,
	AssistantSkillView,
	AssistantThinking,
	ModelView,
	UpdateAssistantConversationRequest,
} from "@dramaticer/protocol";
import { isAssistantSkillId } from "@dramaticer/protocol";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { assistantApi } from "../api/assistant";
import { formatFloorTime } from "../chat/format";
import { formatLedgerSource } from "../chat/ledger-view";
import { ErrorNotice } from "../components/ErrorNotice";
import { LedgerValue } from "../components/ledger/LedgerValue";
import {
	contextLevel,
	contextPartsLabel,
	contextPercentLabel,
	formatOrdinalRanges,
} from "./context-usage";
import {
	type ConversationListState,
	applyConversationList,
	createConversationListState,
	matchFor,
	patchConversation,
	removeConversation,
	selectConversation,
	upsertConversation,
} from "./conversation-list";
import {
	ASSISTANT_CONVERSATION_DEFAULTS,
	ASSISTANT_PERMISSION_OPTIONS,
	ASSISTANT_THINKING_OPTIONS,
	canCancel,
	conversationStatusLabel,
	isAssistantFailure,
} from "./permissions";
import {
	ASSISTANT_ACTION_KIND_LABELS,
	REVIEW_FILTER_ALL,
	describeAssistantActionFields,
	describeLedgerRows,
	matchesReviewConversation,
	reviewConversationOptions,
	reviewConversationTitle,
} from "./review";
import {
	type AssistantRunState,
	applyAssistantSseEvent,
	applyPersistedAssistantEvents,
	createAssistantRunState,
	selectLatestRunEvents,
} from "./stream";

const POLL_INTERVAL_MS = 700;
const ACTION_POLL_INTERVAL_MS = 5_000;
const ACTIVE_KEY_PREFIX = "dramaticer.assistant.active";

export interface AssistantSummary {
	readonly running: boolean;
	readonly failed: boolean;
	readonly pendingActions: number;
	readonly conversationId: string | null;
}

export const EMPTY_ASSISTANT_SUMMARY: AssistantSummary = {
	running: false,
	failed: false,
	pendingActions: 0,
	conversationId: null,
};

export interface AssistantDrawerProps {
	readonly storyId: string;
	readonly open: boolean;
	readonly onClose: () => void;
	readonly onSummaryChange: (summary: AssistantSummary) => void;
}

/** 故事页右侧的助手抽屉；关闭后组件仍然挂载，运行中的事件继续进入状态。 */
export function AssistantDrawer({
	storyId,
	open,
	onClose,
	onSummaryChange,
}: AssistantDrawerProps) {
	const [skills, setSkills] = useState<readonly AssistantSkillView[]>([]);
	const [models, setModels] = useState<readonly ModelView[]>([]);
	const [list, setList] = useState<ConversationListState>(
		createConversationListState,
	);
	const [searchInput, setSearchInput] = useState("");
	const [query, setQuery] = useState("");
	const [listLoading, setListLoading] = useState(false);
	const [listError, setListError] = useState<unknown>(null);
	const [detail, setDetail] = useState<AssistantConversationDetailView | null>(
		null,
	);
	const [status, setStatus] = useState<AssistantConversationStatusView | null>(
		null,
	);
	const [messages, setMessages] = useState<readonly AssistantMessageView[]>([]);
	const [run, setRun] = useState<AssistantRunState>(createAssistantRunState);
	const [input, setInput] = useState("");
	const [compactInput, setCompactInput] = useState("");
	const [streaming, setStreaming] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const [pendingActions, setPendingActions] = useState(0);
	const [view, setView] = useState<"chat" | "review">("chat");
	const [reviewActions, setReviewActions] = useState<
		readonly AssistantActionView[]
	>([]);
	const [reviewCards, setReviewCards] = useState<readonly LedgerChangeCard[]>(
		[],
	);
	const [reviewConversations, setReviewConversations] = useState<
		readonly AssistantConversationView[]
	>([]);
	const [reviewFilter, setReviewFilter] = useState(REVIEW_FILTER_ALL);
	const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
	const [reviewError, setReviewError] = useState<{
		readonly id: string;
		readonly message: string;
	} | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const runRef = useRef(run);
	runRef.current = run;
	const queryRef = useRef(query);
	queryRef.current = query;
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (open) closeButtonRef.current?.focus();
	}, [open]);

	const active = detail?.conversation ?? null;

	const loadConversations = useCallback(
		async (search: string): Promise<void> => {
			setListLoading(true);
			try {
				const view = await assistantApi.listConversations({
					storyId,
					query: search.trim().length === 0 ? undefined : search.trim(),
					limit: 50,
				});
				setList((previous) => {
					const next = applyConversationList(previous, view);
					if (next.activeId !== null) return next;
					const first = next.conversations[0];
					return first === undefined
						? next
						: selectConversation(next, first.id);
				});
				setListError(null);
			} catch (value) {
				setListError(value);
			} finally {
				setListLoading(false);
			}
		},
		[storyId],
	);

	const refreshPendingActions = useCallback(async (): Promise<void> => {
		try {
			const [actionView, proposalView] = await Promise.all([
				assistantApi.listActions({
					storyId,
					status: "pending",
					limit: 100,
				}),
				assistantApi.listProposals(storyId, "pending"),
			]);
			setReviewActions(actionView.actions);
			setReviewCards(proposalView.proposals);
			setPendingActions(
				actionView.actions.length + proposalView.proposals.length,
			);
		} catch (value) {
			setListError(value);
		}
	}, [storyId]);

	useEffect(() => {
		let cancelled = false;
		setList(createConversationListState());
		setDetail(null);
		setStatus(null);
		setMessages([]);
		setRun(createAssistantRunState());
		setInput("");
		setCompactInput("");
		setError(null);
		setQuery("");
		setSearchInput("");
		setRenamingId(null);
		setConfirmDeleteId(null);
		setView("chat");
		setReviewFilter(REVIEW_FILTER_ALL);
		setReviewActions([]);
		setReviewCards([]);
		setReviewConversations([]);
		setReviewBusyId(null);
		setReviewError(null);
		const stored = readStoredConversation(storyId);
		if (stored !== null) {
			setList((previous) => selectConversation(previous, stored));
		}
		void assistantApi.listSkills().then(
			(view) => {
				if (!cancelled) setSkills(view.skills);
			},
			(value: unknown) => {
				if (!cancelled) setListError(value);
			},
		);
		void assistantApi.getChannels().then(
			(view) => {
				if (!cancelled) setModels(view.models);
			},
			() => {
				if (!cancelled) setModels([]);
			},
		);
		void loadConversations("");
		void refreshPendingActions();
		void assistantApi.listConversations({ storyId, limit: 100 }).then(
			(view) => {
				if (!cancelled) setReviewConversations(view.conversations);
			},
			() => {
				if (!cancelled) setReviewConversations([]);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [storyId, loadConversations, refreshPendingActions]);

	useEffect(() => {
		if (list.activeId === null) {
			localStorage.removeItem(activeKey(storyId));
			return;
		}
		localStorage.setItem(activeKey(storyId), list.activeId);
	}, [storyId, list.activeId]);

	useEffect(() => {
		const id = list.activeId;
		if (id === null) return;
		let cancelled = false;
		setDetail(null);
		setStatus(null);
		setMessages([]);
		setRun(createAssistantRunState());
		setError(null);
		setCompactInput("");
		void (async () => {
			try {
				const [detailView, statusView, eventsView] = await Promise.all([
					assistantApi.getConversation(id),
					assistantApi.getStatus(id),
					assistantApi.listEvents(id, 0),
				]);
				if (cancelled) return;
				const latest = selectLatestRunEvents(eventsView.events);
				const restored = applyPersistedAssistantEvents(
					createAssistantRunState(),
					latest,
				);
				setDetail(detailView);
				setMessages(detailView.messages);
				setStatus(statusView);
				setRun({
					...restored,
					lastSeq: Math.max(restored.lastSeq, statusView.lastEventSeq),
				});
			} catch (value) {
				if (!cancelled) setError(value);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [list.activeId]);

	// 关闭抽屉或刷新后重新接管运行：按 `after` 续读事件，不重复应用正文。
	useEffect(() => {
		const id = list.activeId;
		if (id === null || status?.status !== "running" || streaming) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = async (): Promise<void> => {
			try {
				const [statusView, eventsView] = await Promise.all([
					assistantApi.getStatus(id),
					assistantApi.listEvents(id, runRef.current.lastSeq),
				]);
				if (cancelled) return;
				setRun((previous) => {
					const next = applyPersistedAssistantEvents(
						previous,
						eventsView.events,
					);
					return {
						...next,
						lastSeq: Math.max(next.lastSeq, eventsView.lastSeq),
					};
				});
				if (statusView.status !== "running") {
					const detailView = await assistantApi.getConversation(id);
					setDetail(detailView);
					setMessages(detailView.messages);
					setRun(createAssistantRunState(statusView.lastEventSeq));
					setStatus(statusView);
					void loadConversations(queryRef.current);
					void refreshPendingActions();
					return;
				}
				setStatus(statusView);
			} catch (value) {
				if (!cancelled) setError(value);
			}
			if (!cancelled) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
		};
		timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [
		list.activeId,
		status?.status,
		streaming,
		loadConversations,
		refreshPendingActions,
	]);

	// 待确认动作数量供右下角标记使用；与助手运行无关，按固定间隔重试。
	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = async (): Promise<void> => {
			await refreshPendingActions();
			if (!cancelled) {
				timer = setTimeout(() => void tick(), ACTION_POLL_INTERVAL_MS);
			}
		};
		timer = setTimeout(() => void tick(), ACTION_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [refreshPendingActions]);

	const running = streaming || status?.status === "running";
	const failed =
		status?.status === "failed" ||
		status?.status === "interrupted" ||
		(run.error !== null && status?.status !== "cancelled");

	useEffect(() => {
		onSummaryChange({
			running,
			failed,
			pendingActions,
			conversationId: list.activeId,
		});
	}, [onSummaryChange, running, failed, pendingActions, list.activeId]);

	const reloadConversation = useCallback(async (id: string): Promise<void> => {
		try {
			const [detailView, statusView] = await Promise.all([
				assistantApi.getConversation(id),
				assistantApi.getStatus(id),
			]);
			setDetail(detailView);
			setMessages(detailView.messages);
			setStatus(statusView);
			setRun(createAssistantRunState(statusView.lastEventSeq));
		} catch (value) {
			setError(value);
		}
	}, []);

	const createConversation = async (): Promise<void> => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const conversation = await assistantApi.createConversation({
				storyId,
				...ASSISTANT_CONVERSATION_DEFAULTS,
			});
			setList((previous) => upsertConversation(previous, conversation));
			setQuery("");
			setSearchInput("");
			await loadConversations("");
		} catch (value) {
			setError(value);
		} finally {
			setBusy(false);
		}
	};

	const updateConversation = async (
		patch: UpdateAssistantConversationRequest,
	): Promise<void> => {
		if (active === null || busy) return;
		setBusy(true);
		setError(null);
		try {
			const updated = await assistantApi.updateConversation(active.id, patch);
			setList((previous) => patchConversation(previous, updated));
			setDetail((previous) =>
				previous === null ? previous : { ...previous, conversation: updated },
			);
		} catch (value) {
			setError(value);
		} finally {
			setBusy(false);
		}
	};

	const renameConversation = async (
		id: string,
		title: string,
	): Promise<void> => {
		const trimmed = title.trim();
		if (trimmed.length === 0) return;
		setRenamingId(null);
		await updateConversationById(id, { title: trimmed });
	};

	const updateConversationById = async (
		id: string,
		patch: UpdateAssistantConversationRequest,
	): Promise<void> => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const updated = await assistantApi.updateConversation(id, patch);
			setList((previous) => patchConversation(previous, updated));
			setDetail((previous) =>
				previous !== null && previous.conversation.id === id
					? { ...previous, conversation: updated }
					: previous,
			);
		} catch (value) {
			setError(value);
		} finally {
			setBusy(false);
		}
	};

	const deleteConversation = async (id: string): Promise<void> => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await assistantApi.deleteConversation(id);
			setConfirmDeleteId(null);
			setList((previous) => removeConversation(previous, id));
			if (detail?.conversation.id === id) {
				setDetail(null);
				setStatus(null);
				setMessages([]);
				setRun(createAssistantRunState());
			}
			await loadConversations(queryRef.current);
		} catch (value) {
			setError(value);
		} finally {
			setBusy(false);
		}
	};

	const search = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setQuery(searchInput);
		void loadConversations(searchInput);
	};

	const clearSearch = (): void => {
		setSearchInput("");
		setQuery("");
		void loadConversations("");
	};

	const sendMessage = async (): Promise<void> => {
		if (active === null || streaming) return;
		const text = input.trim();
		if (text.length === 0) return;
		setInput("");
		setError(null);
		setStreaming(true);
		setRun(createAssistantRunState(runRef.current.lastSeq));
		setStatus((previous) =>
			previous === null
				? {
						conversationId: active.id,
						status: "running",
						lastEventSeq: 0,
						updatedAt: new Date().toISOString(),
						lastMessageAt: null,
					}
				: { ...previous, status: "running" },
		);
		setMessages((previous) => [
			...previous,
			{
				conversationId: active.id,
				ordinal: (previous.at(-1)?.ordinal ?? 0) + 1,
				role: "user",
				text,
				toolName: null,
				toolResult: null,
				usage: null,
				createdAt: new Date().toISOString(),
			},
		]);
		try {
			for await (const event of assistantApi.streamMessage(active.id, text)) {
				setRun((previous) => applyAssistantSseEvent(previous, event));
				if (event.event === "assistant.error") {
					setError(new Error(event.data.message));
				}
			}
		} catch (value) {
			setError(value);
		} finally {
			setStreaming(false);
			await reloadConversation(active.id);
			await loadConversations(queryRef.current);
			await refreshPendingActions();
		}
	};

	const cancelRun = async (): Promise<void> => {
		if (active === null) return;
		setError(null);
		try {
			await assistantApi.cancel(active.id);
		} catch (value) {
			setError(value);
		} finally {
			await reloadConversation(active.id);
		}
	};

	const compactContext = async (): Promise<void> => {
		if (active === null || busy || running) return;
		setBusy(true);
		setError(null);
		try {
			const instructions = compactInput.trim();
			await assistantApi.compactConversation(
				active.id,
				instructions.length === 0 ? {} : { instructions },
			);
			setCompactInput("");
			await reloadConversation(active.id);
		} catch (value) {
			setError(value);
		} finally {
			setBusy(false);
		}
	};

	const reviewConversationList = useMemo(() => {
		const byId = new Map(
			reviewConversations.map((conversation) => [
				conversation.id,
				conversation,
			]),
		);
		for (const conversation of list.conversations) {
			byId.set(conversation.id, conversation);
		}
		return [...byId.values()];
	}, [reviewConversations, list.conversations]);

	const approveReviewAction = async (id: string): Promise<void> => {
		if (reviewBusyId !== null) return;
		setReviewBusyId(id);
		setReviewError(null);
		try {
			await assistantApi.approveAction(id);
			await refreshPendingActions();
		} catch (value) {
			setReviewError({ id, message: errorMessage(value) });
		} finally {
			setReviewBusyId(null);
		}
	};

	const rejectReviewAction = async (
		id: string,
		reason: string,
	): Promise<void> => {
		if (reviewBusyId !== null) return;
		setReviewBusyId(id);
		setReviewError(null);
		try {
			await assistantApi.rejectAction(id, reason);
			await refreshPendingActions();
		} catch (value) {
			setReviewError({ id, message: errorMessage(value) });
		} finally {
			setReviewBusyId(null);
		}
	};

	const decideReviewCard = async (
		id: string,
		action: "approve" | "reject",
	): Promise<void> => {
		if (reviewBusyId !== null) return;
		setReviewBusyId(id);
		setReviewError(null);
		try {
			await assistantApi.decideProposal(id, action);
			await refreshPendingActions();
		} catch (value) {
			setReviewError({ id, message: errorMessage(value) });
		} finally {
			setReviewBusyId(null);
		}
	};

	const statusValue: AssistantConversationStatus =
		status?.status ?? active?.status ?? "idle";

	return (
		<>
			{open ? (
				// biome-ignore lint/a11y/useKeyWithClickEvents: Esc 在窗口上处理
				<div className="assistant-scrim" aria-hidden="true" onClick={onClose} />
			) : null}
			<aside
				className="assistant-drawer"
				aria-label="应用内助手"
				aria-hidden={!open}
				hidden={!open}
			>
				<header className="assistant-head">
					<h2>助手</h2>
					<div
						className="assistant-view-tabs"
						role="tablist"
						aria-label="助手视图"
					>
						<button
							type="button"
							role="tab"
							aria-selected={view === "chat"}
							className={view === "chat" ? "active" : undefined}
							onClick={() => setView("chat")}
						>
							对话
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={view === "review"}
							className={view === "review" ? "active" : undefined}
							onClick={() => setView("review")}
						>
							待确认{pendingActions === 0 ? "" : `（${pendingActions}）`}
						</button>
					</div>
					<button
						ref={closeButtonRef}
						type="button"
						className="assistant-close"
						onClick={onClose}
						aria-label="关闭助手"
					>
						✕
					</button>
				</header>
				<ErrorNotice error={error} />
				<div className="assistant-body">
					<section className="assistant-conversations" aria-label="会话列表">
						<form className="assistant-search" onSubmit={search}>
							<input
								type="search"
								aria-label="搜索会话"
								placeholder="搜索标题或消息"
								value={searchInput}
								onChange={(event) => setSearchInput(event.target.value)}
							/>
							<button type="submit">搜索</button>
							{query.length === 0 ? null : (
								<button type="button" onClick={clearSearch}>
									清除
								</button>
							)}
						</form>
						<button
							type="button"
							className="assistant-new"
							disabled={busy}
							onClick={() => {
								void createConversation();
							}}
						>
							新建会话
						</button>
						{listLoading ? <p className="muted">正在读取会话…</p> : null}
						<ErrorNotice error={listError} />
						<ul className="assistant-conversation-list">
							{list.conversations.map((conversation) => {
								const match = matchFor(list, conversation.id);
								const isActive = conversation.id === list.activeId;
								return (
									<li
										key={conversation.id}
										className="assistant-conversation-item"
									>
										<button
											type="button"
											className={
												isActive
													? "assistant-conversation-open active"
													: "assistant-conversation-open"
											}
											aria-current={isActive ? "true" : undefined}
											onClick={() =>
												setList((previous) =>
													selectConversation(previous, conversation.id),
												)
											}
										>
											<span className="assistant-conversation-title">
												{conversation.title}
											</span>
											<span className="assistant-conversation-meta">
												{skillName(skills, conversation.skill)} ·{" "}
												{conversationStatusLabel(conversation.status)}
												{match === null ? "" : ` · ${match.snippet}`}
											</span>
										</button>
										<div className="assistant-conversation-actions">
											<button
												type="button"
												onClick={() => {
													setRenamingId(conversation.id);
													setRenameValue(conversation.title);
													setConfirmDeleteId(null);
												}}
											>
												改名
											</button>
											{confirmDeleteId === conversation.id ? (
												<>
													<button
														type="button"
														className="assistant-danger"
														disabled={busy}
														onClick={() => {
															void deleteConversation(conversation.id);
														}}
													>
														确定删除
													</button>
													<button
														type="button"
														onClick={() => setConfirmDeleteId(null)}
													>
														取消
													</button>
												</>
											) : (
												<button
													type="button"
													onClick={() => setConfirmDeleteId(conversation.id)}
												>
													删除
												</button>
											)}
										</div>
										{renamingId === conversation.id ? (
											<form
												className="assistant-rename"
												onSubmit={(event) => {
													event.preventDefault();
													void renameConversation(conversation.id, renameValue);
												}}
											>
												<input
													type="text"
													aria-label="会话标题"
													value={renameValue}
													onChange={(event) =>
														setRenameValue(event.target.value)
													}
												/>
												<button type="submit">保存</button>
												<button
													type="button"
													onClick={() => setRenamingId(null)}
												>
													取消
												</button>
											</form>
										) : null}
									</li>
								);
							})}
						</ul>
					</section>
					{view === "review" ? (
						<ReviewPanel
							actions={reviewActions}
							cards={reviewCards}
							conversations={reviewConversationList}
							filter={reviewFilter}
							onFilterChange={setReviewFilter}
							busyId={reviewBusyId}
							error={reviewError}
							onApproveAction={(id) => void approveReviewAction(id)}
							onRejectAction={(id, reason) =>
								void rejectReviewAction(id, reason)
							}
							onApproveCard={(id) => void decideReviewCard(id, "approve")}
							onRejectCard={(id) => void decideReviewCard(id, "reject")}
						/>
					) : (
						<section className="assistant-conversation" aria-label="当前会话">
							{active === null ? (
								<div className="assistant-empty">
									<p className="muted">
										还没有会话。建一个之后，助手会在这里回答，也能帮你改记忆、设定与设置。
									</p>
									<button
										type="button"
										className="btn gold"
										disabled={busy}
										onClick={() => {
											void createConversation();
										}}
									>
										新建一个会话
									</button>
								</div>
							) : (
								<>
									<div className="assistant-controls">
										<label>
											技能
											<select
												value={active.skill}
												disabled={busy}
												onChange={(event) => {
													const skill = event.target.value;
													if (!isAssistantSkillId(skill)) return;
													void updateConversation({ skill });
												}}
											>
												{skills.map((skill) => (
													<option key={skill.id} value={skill.id}>
														{skill.name}
													</option>
												))}
											</select>
										</label>
										<label>
											权限
											<select
												value={active.permission}
												disabled={busy}
												onChange={(event) =>
													void updateConversation({
														permission: event.target
															.value as AssistantPermission,
													})
												}
											>
												{ASSISTANT_PERMISSION_OPTIONS.map((option) => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
										</label>
										<label>
											思考
											<select
												value={active.thinking}
												disabled={busy}
												onChange={(event) =>
													void updateConversation({
														thinking: event.target.value as AssistantThinking,
													})
												}
											>
												{ASSISTANT_THINKING_OPTIONS.map((option) => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
										</label>
										<label>
											模型
											<select
												value={active.modelAlias ?? ""}
												disabled={busy}
												onChange={(event) =>
													void updateConversation({
														modelAlias:
															event.target.value.length === 0
																? null
																: event.target.value,
													})
												}
											>
												<option value="">默认（writer 岗位）</option>
												{models
													.filter((model) => model.enabled)
													.map((model) => (
														<option key={model.alias} value={model.alias}>
															{model.alias}
														</option>
													))}
											</select>
										</label>
										<span className="assistant-status">
											{conversationStatusLabel(statusValue)}
										</span>
										{detail === null ? null : (
											<ContextRing usage={detail.context} />
										)}
										{canCancel(statusValue) ? (
											<button type="button" onClick={() => void cancelRun()}>
												取消运行
											</button>
										) : null}
									</div>
									<ErrorNotice
										error={
											isAssistantFailure(statusValue) && run.error === null
												? new Error(
														`上次运行${conversationStatusLabel(statusValue)}`,
													)
												: null
										}
									/>
									<div className="assistant-messages" aria-live="polite">
										{detail?.compaction === null ||
										detail?.compaction === undefined ? null : (
											<details className="assistant-compaction">
												<summary>
													已压缩 {detail.compaction.omittedMessageIds.length}{" "}
													条消息
												</summary>
												<p className="muted">
													省略序号：
													{formatOrdinalRanges(
														detail.compaction.omittedMessageIds,
													)}
												</p>
												<pre>{detail.compaction.summary}</pre>
											</details>
										)}
										{messages.map((message, index) => (
											<article
												key={`${message.ordinal}-${index}`}
												className={`assistant-message assistant-message-${message.role}`}
											>
												<p className="assistant-message-role">
													{messageRoleLabel(message.role)}
												</p>
												<pre>{message.text}</pre>
											</article>
										))}
										{running ? (
											<article className="assistant-message assistant-message-assistant">
												<p className="assistant-message-role">
													助手{run.status === "running" ? "（运行中）" : ""}
												</p>
												<pre>
													{run.text.length === 0 ? "正在思考…" : run.text}
												</pre>
											</article>
										) : run.error === null ? null : (
											<ErrorNotice error={new Error(run.error)} />
										)}
										{run.thinking.length === 0 ? null : (
											<details className="assistant-thinking">
												<summary>思考过程</summary>
												<pre>{run.thinking}</pre>
											</details>
										)}
										{run.tools.length === 0 ? null : (
											<details className="assistant-tools">
												<summary>工具活动（{run.tools.length}）</summary>
												<ul>
													{run.tools.map((tool, index) => (
														<li key={`${index}-${tool.name}`}>
															<span>{tool.name}</span>
															{tool.deniedPermission === null ? null : (
																<span className="assistant-denied">
																	被拒绝（{tool.deniedPermission}）
																</span>
															)}
															{tool.ok === null ? (
																<span className="muted">进行中</span>
															) : (
																<span className="muted">
																	{tool.ok ? "成功" : "失败"}
																</span>
															)}
															{tool.reason === null ? null : (
																<span className="muted">{tool.reason}</span>
															)}
															{tool.arguments === null ? null : (
																<pre>{JSON.stringify(tool.arguments)}</pre>
															)}
															{tool.result === null ? null : (
																<pre>
																	{JSON.stringify(tool.result, null, 2)}
																</pre>
															)}
														</li>
													))}
												</ul>
											</details>
										)}
									</div>
									<form
										className="assistant-compact"
										onSubmit={(event) => {
											event.preventDefault();
											void compactContext();
										}}
									>
										<input
											type="text"
											aria-label="压缩要求"
											placeholder="压缩要求（可选）"
											value={compactInput}
											onChange={(event) => setCompactInput(event.target.value)}
										/>
										<button
											type="submit"
											disabled={busy || running || detail === null}
										>
											压缩上下文
										</button>
									</form>
									<form
										className="assistant-composer"
										onSubmit={(event) => {
											event.preventDefault();
											void sendMessage();
										}}
									>
										<textarea
											aria-label="给助手的消息"
											rows={3}
											value={input}
											onChange={(event) => setInput(event.target.value)}
											onKeyDown={(event) => {
												if (event.key !== "Enter" || event.shiftKey) return;
												event.preventDefault();
												void sendMessage();
											}}
										/>
										<div className="assistant-composer-actions">
											<span className="muted">
												{conversationStatusLabel(statusValue)}
											</span>
											<button
												type="submit"
												disabled={streaming || input.trim().length === 0}
											>
												发送
											</button>
										</div>
									</form>
								</>
							)}
						</section>
					)}
				</div>
			</aside>
		</>
	);
}

export interface ReviewPanelProps {
	readonly actions: readonly AssistantActionView[];
	readonly cards: readonly LedgerChangeCard[];
	readonly conversations: readonly AssistantConversationView[];
	readonly filter: string;
	readonly onFilterChange: (filter: string) => void;
	readonly busyId: string | null;
	readonly error: { readonly id: string; readonly message: string } | null;
	readonly onApproveAction: (id: string) => void;
	readonly onRejectAction: (id: string, reason: string) => void;
	readonly onApproveCard: (id: string) => void;
	readonly onRejectCard: (id: string) => void;
}

/** 待确认视图：助手动作与台账变更卡共用一套审阅与决定入口。 */
function ReviewPanel({
	actions,
	cards,
	conversations,
	filter,
	onFilterChange,
	busyId,
	error,
	onApproveAction,
	onRejectAction,
	onApproveCard,
	onRejectCard,
}: ReviewPanelProps) {
	const options = reviewConversationOptions(actions, cards, conversations);
	const effectiveFilter = options.some((option) => option.id === filter)
		? filter
		: REVIEW_FILTER_ALL;
	const visibleActions = actions.filter((action) =>
		matchesReviewConversation(action.conversationId, effectiveFilter),
	);
	const visibleCards = cards.filter((card) =>
		matchesReviewConversation(card.assistantConversationId, effectiveFilter),
	);
	const [rejectingId, setRejectingId] = useState<string | null>(null);
	const [rejectReason, setRejectReason] = useState("");
	const startReject = (id: string): void => {
		setRejectingId(id);
		setRejectReason("");
	};
	const submitReject = (id: string): void => {
		const reason = rejectReason.trim();
		if (reason.length === 0) return;
		setRejectingId(null);
		setRejectReason("");
		onRejectAction(id, reason);
	};
	return (
		<section className="assistant-conversation" aria-label="待确认修改">
			<div className="assistant-review-head">
				<label>
					来源
					<select
						value={effectiveFilter}
						onChange={(event) => onFilterChange(event.target.value)}
					>
						<option value={REVIEW_FILTER_ALL}>全部来源</option>
						{options.map((option) => (
							<option key={option.id} value={option.id}>
								{option.title}
							</option>
						))}
					</select>
				</label>
				<span className="muted">
					待确认 {visibleActions.length + visibleCards.length} 项
				</span>
			</div>
			{visibleActions.length === 0 && visibleCards.length === 0 ? (
				<p className="muted">没有待确认的修改。</p>
			) : (
				<ul className="assistant-review-list">
					{visibleCards.map((card) => (
						<LedgerReviewItem
							key={card.id}
							card={card}
							conversations={conversations}
							busyId={busyId}
							error={error}
							onApprove={onApproveCard}
							onReject={onRejectCard}
						/>
					))}
					{visibleActions.map((action) => (
						<ActionReviewItem
							key={action.id}
							action={action}
							conversations={conversations}
							busyId={busyId}
							error={error}
							rejecting={rejectingId === action.id}
							rejectReason={rejectReason}
							onRejectReasonChange={setRejectReason}
							onStartReject={startReject}
							onSubmitReject={submitReject}
							onApprove={onApproveAction}
							onCancelReject={() => setRejectingId(null)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

interface ReviewItemCommonProps {
	readonly conversations: readonly AssistantConversationView[];
	readonly busyId: string | null;
	readonly error: { readonly id: string; readonly message: string } | null;
}

function ReviewItemError({
	id,
	error,
}: {
	readonly id: string;
	readonly error: { readonly id: string; readonly message: string } | null;
}) {
	if (error === null || error.id !== id) return null;
	return (
		<p className="assistant-review-error" role="alert">
			{error.message}
		</p>
	);
}

function ActionReviewItem({
	action,
	busyId,
	error,
	rejecting,
	rejectReason,
	onRejectReasonChange,
	onStartReject,
	onSubmitReject,
	onApprove,
	onCancelReject,
	conversations,
}: ReviewItemCommonProps & {
	readonly action: AssistantActionView;
	readonly rejecting: boolean;
	readonly rejectReason: string;
	readonly onRejectReasonChange: (reason: string) => void;
	readonly onStartReject: (id: string) => void;
	readonly onSubmitReject: (id: string) => void;
	readonly onApprove: (id: string) => void;
	readonly onCancelReject: () => void;
}) {
	const fields = describeAssistantActionFields(action);
	return (
		<li
			className="assistant-review-item"
			data-kind={action.kind}
			data-id={action.id}
		>
			<div className="assistant-review-meta">
				<span className="assistant-review-kind">
					{ASSISTANT_ACTION_KIND_LABELS[action.kind]}
				</span>
				<span className="muted">
					会话 {reviewConversationTitle(conversations, action.conversationId)}
				</span>
				<span className="muted">{formatFloorTime(action.createdAt)}</span>
			</div>
			<p className="assistant-review-summary">{action.summary}</p>
			<ul className="assistant-review-fields">
				{fields.map((field, index) => (
					<li key={`${index}-${field.label}`}>
						<span className="ledger-path">{field.label}</span>
						<LedgerValue value={field.value} />
					</li>
				))}
			</ul>
			<ReviewItemError id={action.id} error={error} />
			{rejecting ? (
				<form
					className="assistant-review-reject"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmitReject(action.id);
					}}
				>
					<input
						type="text"
						aria-label="拒绝原因"
						placeholder="拒绝原因"
						value={rejectReason}
						onChange={(event) => onRejectReasonChange(event.target.value)}
					/>
					<button
						type="submit"
						disabled={rejectReason.trim().length === 0 || busyId !== null}
					>
						确定拒绝
					</button>
					<button type="button" onClick={onCancelReject}>
						取消
					</button>
				</form>
			) : (
				<div className="assistant-review-actions">
					<button
						type="button"
						disabled={busyId !== null}
						onClick={() => onApprove(action.id)}
					>
						{busyId === action.id ? "处理中…" : "批准"}
					</button>
					<button
						type="button"
						className="assistant-danger"
						disabled={busyId !== null}
						onClick={() => onStartReject(action.id)}
					>
						拒绝
					</button>
				</div>
			)}
		</li>
	);
}

function LedgerReviewItem({
	card,
	conversations,
	busyId,
	error,
	onApprove,
	onReject,
}: ReviewItemCommonProps & {
	readonly card: LedgerChangeCard;
	readonly onApprove: (id: string) => void;
	readonly onReject: (id: string) => void;
}) {
	const rows = describeLedgerRows(card);
	const conversation =
		card.assistantConversationId === null
			? null
			: reviewConversationTitle(conversations, card.assistantConversationId);
	return (
		<li className="assistant-review-item" data-kind="ledger" data-id={card.id}>
			<div className="assistant-review-meta">
				<span className="assistant-review-kind">台账变更卡</span>
				<span className="muted">
					来源 {conversation ?? formatLedgerSource(card.source)}
				</span>
				<span className="muted">{formatFloorTime(card.createdAt)}</span>
			</div>
			<p className="assistant-review-summary">{card.text}</p>
			<ul className="assistant-review-fields">
				{rows.map((row) => (
					<li key={`${card.id}:${row.path}`}>
						<span className="ledger-path">{row.path}</span>
						<span className="assistant-review-diff">
							原值{" "}
							{row.beforeExisted ? (
								<LedgerValue value={row.before} />
							) : (
								<span className="muted">（未记录）</span>
							)}
						</span>
						<span className="assistant-review-diff">
							新值{" "}
							{row.op === "delete" ? (
								<span className="muted">删除</span>
							) : (
								<LedgerValue value={row.after} />
							)}
						</span>
					</li>
				))}
			</ul>
			<ReviewItemError id={card.id} error={error} />
			<div className="assistant-review-actions">
				<button
					type="button"
					disabled={busyId !== null}
					onClick={() => onApprove(card.id)}
				>
					{busyId === card.id ? "处理中…" : "批准"}
				</button>
				<button
					type="button"
					className="assistant-danger"
					disabled={busyId !== null}
					onClick={() => onReject(card.id)}
				>
					拒绝
				</button>
			</div>
		</li>
	);
}

function errorMessage(value: unknown): string {
	if (value instanceof Error) return value.message;
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

function ContextRing({ usage }: { usage: AssistantContextUsage }) {
	const circumference = 2 * Math.PI * 18;
	const filled = Math.min(1, Math.max(0, usage.percent)) * circumference;
	return (
		<div
			className={`assistant-context assistant-context-${contextLevel(usage)}`}
			title={contextPartsLabel(usage)}
			aria-label={`上下文用量 ${contextPercentLabel(usage)}`}
		>
			<svg viewBox="0 0 44 44" role="img" aria-hidden="true">
				<circle
					className="assistant-context-track"
					cx="22"
					cy="22"
					r="18"
					fill="none"
				/>
				<circle
					className="assistant-context-fill"
					cx="22"
					cy="22"
					r="18"
					fill="none"
					strokeDasharray={`${filled} ${circumference}`}
					transform="rotate(-90 22 22)"
				/>
			</svg>
			<span className="assistant-context-label">
				{contextPercentLabel(usage)}
			</span>
			<span className="assistant-context-used">
				{usage.used}/{usage.budget}
			</span>
		</div>
	);
}

function activeKey(storyId: string): string {
	return `${ACTIVE_KEY_PREFIX}.${storyId}`;
}

function readStoredConversation(storyId: string): string | null {
	try {
		const value = localStorage.getItem(activeKey(storyId));
		return value === null || value.length === 0 ? null : value;
	} catch {
		return null;
	}
}

function skillName(skills: readonly AssistantSkillView[], id: string): string {
	const skill = skills.find((item) => item.id === id);
	return skill?.name ?? id;
}

function messageRoleLabel(role: AssistantMessageView["role"]): string {
	switch (role) {
		case "user":
			return "你";
		case "assistant":
			return "助手";
		case "tool":
			return "工具";
		case "system":
			return "摘要";
	}
}

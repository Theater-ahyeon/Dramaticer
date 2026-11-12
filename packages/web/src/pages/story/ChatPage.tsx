import type { TurnMode } from "@dramaticer/core";
import type {
	NodeActionsView,
	NodeImagesView,
	SseEvent,
	StoryOpeningsView,
	StoryPath,
	StorySettings,
} from "@dramaticer/protocol";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api";
import {
	ACTION_POLL_INTERVAL_MS,
	type CandidateActionItem,
	shouldPollActions,
} from "../../chat/candidate-actions";
import {
	clearComposerDraft,
	readComposerDraft,
} from "../../chat/composer-draft";
import {
	NODE_IMAGE_POLL_INTERVAL_MS,
	applyNodeImages,
	isImagePending,
	nodesWithPendingImages,
	shouldPollNodeImages,
} from "../../chat/node-images";
import {
	OPENING_POLL_INTERVAL_MS,
	type OpeningCandidateItem,
	advanceOpeningPoll,
	beginOpeningPoll,
	maxOpeningOrdinal,
	orderOpeningCandidates,
	shouldPollOpenings,
} from "../../chat/opening-candidates";
import {
	applyLatestPage,
	applyOlderPage,
	canLoadOlder,
	emptyPathState,
	markLoadingOlder,
} from "../../chat/path-state";
import {
	type TurnDraft,
	applyTurnEvent,
	createTurnDraft,
	markTurnFailed,
	resolveRetryAction,
} from "../../chat/stream-state";
import {
	type TurnSummary,
	describeTurnSummary,
	summarizeTurn,
} from "../../chat/turn-summary";
import { ErrorNotice } from "../../components/ErrorNotice";
import { CandidateActions } from "../../components/chat/CandidateActions";
import { ChatFloorList } from "../../components/chat/ChatFloorList";
import { Composer } from "../../components/chat/Composer";
import { OpeningCandidates } from "../../components/chat/OpeningCandidates";

const PAGE_SIZE = 60;
const RETRY_ATTEMPTS = 8;
const RETRY_DELAY_MS = 150;

/** 故事设置尚未读到时的默认值；读到后跟随故事锁定值。 */
const DEFAULT_TURN_MODE: TurnMode = "fast";

interface FailedTurn {
	readonly text: string;
	readonly started: boolean;
	readonly assistantNodeId: string | null;
}

export function ChatPage() {
	const { storyId } = useParams();
	const [path, setPath] = useState(emptyPathState);
	const [pathLoaded, setPathLoaded] = useState(false);
	const [loadError, setLoadError] = useState<unknown>(null);
	const [olderError, setOlderError] = useState<unknown>(null);
	const [composerError, setComposerError] = useState<unknown>(null);
	const [draft, setDraft] = useState<TurnDraft | null>(null);
	const [pendingUserText, setPendingUserText] = useState<string | null>(null);
	const [summary, setSummary] = useState<TurnSummary | null>(null);
	const [failed, setFailed] = useState<FailedTurn | null>(null);
	const [input, setInput] = useState("");
	const [streaming, setStreaming] = useState(false);
	const [bottomSignal, setBottomSignal] = useState(0);
	const [settings, setSettings] = useState<StorySettings | null>(null);
	const [settingsError, setSettingsError] = useState<unknown>(null);
	/** 玩家为本轮选的模式；null 表示跟随故事设置。 */
	const [turnModeOverride, setTurnModeOverride] = useState<TurnMode | null>(
		null,
	);
	const [actions, setActions] = useState<readonly CandidateActionItem[]>([]);
	const [actionsError, setActionsError] = useState<unknown>(null);
	const [imageError, setImageError] = useState<unknown>(null);
	const [retryingImageId, setRetryingImageId] = useState<string | null>(null);
	/** 手动重试后立刻重新开始轮询。 */
	const [imagePollSignal, setImagePollSignal] = useState(0);
	const [openingCandidates, setOpeningCandidates] = useState<
		readonly OpeningCandidateItem[]
	>([]);
	const [openingBaseline, setOpeningBaseline] = useState(0);
	const [openingBusy, setOpeningBusy] = useState(false);
	const [openingTimedOut, setOpeningTimedOut] = useState(false);
	const [openingError, setOpeningError] = useState<unknown>(null);
	const abortRef = useRef<AbortController | null>(null);
	const streamingRef = useRef(false);
	const loadingOlderRef = useRef(false);
	/** 同一个故事只取一次草稿，避免 StrictMode 的重复 effect 把输入框清空。 */
	const composerStoryRef = useRef<string | null>(null);

	const lastNode = path.nodes.at(-1);
	const latestAssistantId =
		lastNode !== undefined && lastNode.role === "assistant"
			? lastNode.id
			: null;
	/** 开场候选只能成为首个楼层，故事有楼层时不再显示。 */
	const storyEmpty = pathLoaded && path.nodes.length === 0;
	const turnMode: TurnMode =
		turnModeOverride ?? settings?.turnMode ?? DEFAULT_TURN_MODE;
	/** 有未完成插图的楼层；键变化时页面从第一次轮询重新开始。 */
	const pendingImageKey = nodesWithPendingImages(path.nodes).join("\n");
	/** 手动重试后即使楼层集合不变也要重新开始轮询。 */
	const imagePollKey = `${imagePollSignal}\n${pendingImageKey}`;

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		setPath(emptyPathState());
		setPathLoaded(false);
		setLoadError(null);
		setOlderError(null);
		setComposerError(null);
		setSummary(null);
		setFailed(null);
		setDraft(null);
		if (composerStoryRef.current !== storyId) {
			composerStoryRef.current = storyId;
			const draft = readComposerDraft(storyId);
			setInput(draft ?? "");
			clearComposerDraft(storyId);
		}
		setSettings(null);
		setSettingsError(null);
		setTurnModeOverride(null);
		setActions([]);
		setActionsError(null);
		setImageError(null);
		setRetryingImageId(null);
		setImagePollSignal(0);
		setOpeningCandidates([]);
		setOpeningBaseline(0);
		setOpeningBusy(false);
		setOpeningTimedOut(false);
		setOpeningError(null);
		void (async () => {
			try {
				const page = await api.getPath(storyId, { limit: PAGE_SIZE });
				if (!active) return;
				setPath((previous) => applyLatestPage(previous, page));
				setBottomSignal((value) => value + 1);
			} catch (error) {
				if (active) setLoadError(error);
			} finally {
				if (active) setPathLoaded(true);
			}
		})();
		void (async () => {
			try {
				const value = await api.getSettings(storyId);
				if (active) setSettings(value);
			} catch (error) {
				if (active) setSettingsError(error);
			}
		})();
		return () => {
			active = false;
		};
	}, [storyId]);

	useEffect(
		() => () => {
			abortRef.current?.abort();
		},
		[],
	);

	// 候选行动由间隙里的后台任务写入；回合刚结束时可能还没有，按固定间隔重试。
	useEffect(() => {
		if (storyId === undefined || latestAssistantId === null) {
			setActions([]);
			return;
		}
		const nodeId = latestAssistantId;
		let cancelled = false;
		let attempt = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = async (): Promise<void> => {
			let view: NodeActionsView;
			try {
				view = await api.getActions(nodeId);
			} catch (error) {
				if (!cancelled) setActionsError(error);
				return;
			}
			if (cancelled) return;
			setActions(view.actions);
			if (shouldPollActions(attempt, view.actions)) {
				attempt += 1;
				timer = setTimeout(() => {
					void poll();
				}, ACTION_POLL_INTERVAL_MS);
			}
		};
		void poll();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [storyId, latestAssistantId]);

	// 出图在间隙里完成；有未完成图片时按固定间隔刷新这些楼层，失败或到上限就停。
	useEffect(() => {
		if (storyId === undefined) return;
		const nodeIds = imagePollKey.split("\n").slice(1).filter(Boolean);
		if (nodeIds.length === 0) return;
		let cancelled = false;
		let attempt = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = async (): Promise<void> => {
			const remaining = new Set(nodeIds);
			for (const nodeId of nodeIds) {
				let view: NodeImagesView;
				try {
					view = await api.getNodeImages(nodeId);
				} catch (error) {
					if (!cancelled) setImageError(error);
					return;
				}
				if (cancelled) return;
				setPath((previous) => ({
					...previous,
					nodes: applyNodeImages(previous.nodes, view.nodeId, view.images),
				}));
				if (!view.images.some(isImagePending)) remaining.delete(nodeId);
			}
			if (shouldPollNodeImages(attempt, [...remaining])) {
				attempt += 1;
				timer = setTimeout(() => {
					void poll();
				}, NODE_IMAGE_POLL_INTERVAL_MS);
			}
		};
		void poll();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [storyId, imagePollKey]);

	// 空故事的开场候选由后台任务生成，轮询到出现为止。
	useEffect(() => {
		if (storyId === undefined || !storyEmpty) return;
		let cancelled = false;
		let state = beginOpeningPoll([]);
		void (async () => {
			for (;;) {
				let view: StoryOpeningsView;
				try {
					view = await api.getOpenings(storyId, "pending");
				} catch (error) {
					if (!cancelled) setOpeningError(error);
					return;
				}
				if (cancelled) return;
				setOpeningCandidates(orderOpeningCandidates(view.candidates));
				const result = advanceOpeningPoll(state, view.candidates);
				state = result.state;
				if (!shouldPollOpenings(state)) return;
				await delay(OPENING_POLL_INTERVAL_MS);
				if (cancelled) return;
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [storyId, storyEmpty]);

	const refreshPath = async (
		targetStoryId: string,
		userNodeId: string | null,
	): Promise<StoryPath | null> => {
		const attempts = userNodeId === null ? 1 : RETRY_ATTEMPTS;
		let page: StoryPath | null = null;
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			if (attempt > 0) {
				const { promise, resolve } = Promise.withResolvers<void>();
				setTimeout(resolve, RETRY_DELAY_MS);
				await promise;
			}
			try {
				page = await api.getPath(targetStoryId, { limit: PAGE_SIZE });
			} catch (error) {
				setLoadError(error);
				return null;
			}
			if (
				userNodeId === null ||
				page.nodes.some(
					(node) => node.parentId === userNodeId && node.role === "assistant",
				)
			) {
				break;
			}
		}
		if (page !== null) {
			setPath((previous) => applyLatestPage(previous, page));
			setBottomSignal((value) => value + 1);
		}
		return page;
	};

	const runStream = async (
		targetStoryId: string,
		open: (signal: AbortSignal) => AsyncGenerator<SseEvent>,
		userText: string | null,
	) => {
		if (streamingRef.current) return;
		const controller = new AbortController();
		abortRef.current = controller;
		streamingRef.current = true;
		setStreaming(true);
		setComposerError(null);
		setFailed(null);
		setSummary(null);
		setPendingUserText(userText);
		let current = createTurnDraft();
		setDraft(current);
		let failure: unknown = null;
		try {
			for await (const event of open(controller.signal)) {
				current = applyTurnEvent(current, event);
				setDraft(current);
				if (event.event === "turn.completed") {
					setSummary(summarizeTurn(event.data));
				}
			}
		} catch (error) {
			failure = error;
			current = markTurnFailed(
				current,
				error instanceof Error ? error.message : "生成失败",
			);
			setDraft(current);
		} finally {
			abortRef.current = null;
			streamingRef.current = false;
			setStreaming(false);
			setPendingUserText(null);
		}
		const page = await refreshPath(targetStoryId, current.userNodeId);
		setDraft(null);
		if (failure === null || isAbortError(failure)) return;
		setComposerError(failure);
		const assistantNodeId =
			current.userNodeId === null
				? null
				: (page?.nodes.find(
						(node) =>
							node.parentId === current.userNodeId && node.role === "assistant",
					)?.id ?? null);
		setFailed({
			text: userText ?? "",
			started: current.started,
			assistantNodeId,
		});
	};

	const sendText = (text: string) => {
		if (storyId === undefined) return;
		const trimmed = text.trim();
		if (trimmed.length === 0) return;
		setInput("");
		void runStream(
			storyId,
			(signal) =>
				api.streamTurn(storyId, { text: trimmed, mode: turnMode }, signal),
			trimmed,
		);
	};

	const regenerate = (nodeId: string) => {
		if (storyId === undefined) return;
		void runStream(
			storyId,
			(signal) => api.streamRegenerate(nodeId, signal),
			null,
		);
	};

	const loadOlder = () => {
		if (storyId === undefined || loadingOlderRef.current) return;
		const anchor = path.headNodeId;
		const oldest = path.nodes[0];
		if (anchor === null || oldest === undefined || !path.hasMore) return;
		loadingOlderRef.current = true;
		setPath((previous) => markLoadingOlder(previous));
		void (async () => {
			try {
				const page = await api.getPath(storyId, {
					nodeId: anchor,
					before: oldest.id,
					limit: PAGE_SIZE,
				});
				setPath((previous) => applyOlderPage(previous, page));
				setOlderError(null);
			} catch (error) {
				setOlderError(error);
				setPath((previous) => ({ ...previous, loadingOlder: false }));
			} finally {
				loadingOlderRef.current = false;
			}
		})();
	};

	const chooseOption = async (nodeId: string, text: string) => {
		setInput(text);
		try {
			await api.recordChoice(nodeId, { text });
			setComposerError(null);
		} catch (error) {
			setComposerError(error);
		}
	};

	/** 失败图片退回待生成；立刻刷新该楼层，把占位换回来。 */
	const retryImage = async (nodeId: string, imageId: string) => {
		setRetryingImageId(imageId);
		setImageError(null);
		try {
			await api.retryImage(imageId);
			const view = await api.getNodeImages(nodeId);
			setPath((previous) => ({
				...previous,
				nodes: applyNodeImages(previous.nodes, view.nodeId, view.images),
			}));
			setImagePollSignal((value) => value + 1);
		} catch (error) {
			setImageError(error);
		} finally {
			setRetryingImageId(null);
		}
	};

	const generateOpenings = async () => {
		if (storyId === undefined) return;
		const baseline = maxOpeningOrdinal(openingCandidates);
		setOpeningBusy(true);
		setOpeningTimedOut(false);
		setOpeningError(null);
		try {
			await api.generateOpenings(storyId);
			let state = beginOpeningPoll(openingCandidates);
			setOpeningBaseline(baseline);
			for (;;) {
				const view = await api.getOpenings(storyId, "pending");
				const result = advanceOpeningPoll(state, view.candidates);
				state = result.state;
				if (result.fresh.length > 0) {
					setOpeningCandidates(orderOpeningCandidates(view.candidates));
					return;
				}
				if (!shouldPollOpenings(state)) {
					setOpeningTimedOut(true);
					return;
				}
				await delay(OPENING_POLL_INTERVAL_MS);
			}
		} catch (error) {
			setOpeningError(error);
		} finally {
			setOpeningBusy(false);
		}
	};

	const pickOpening = async (candidateId: string) => {
		if (storyId === undefined) return;
		setOpeningBusy(true);
		setOpeningError(null);
		try {
			const result = await api.pickOpening(storyId, candidateId);
			setPath((previous) => applyLatestPage(previous, result.path));
			setBottomSignal((value) => value + 1);
			setOpeningCandidates([]);
			setOpeningBaseline(0);
		} catch (error) {
			setOpeningError(error);
		} finally {
			setOpeningBusy(false);
		}
	};

	if (storyId === undefined) {
		return (
			<section className="panel">
				<p>地址里缺少故事 id。</p>
			</section>
		);
	}

	const retryAction =
		failed === null
			? null
			: resolveRetryAction({
					started: failed.started,
					assistantNodeId: failed.assistantNodeId,
				});

	return (
		<section className="chat-panel" aria-label="聊天">
			<ErrorNotice error={loadError} />
			<ErrorNotice error={settingsError} />
			<ErrorNotice error={olderError} />
			{storyEmpty ? (
				<>
					<ErrorNotice error={openingError} />
					<OpeningCandidates
						candidates={openingCandidates}
						baselineOrdinal={openingBaseline}
						busy={openingBusy}
						timedOut={openingTimedOut}
						onPick={(candidateId) => {
							void pickOpening(candidateId);
						}}
						onGenerate={() => {
							void generateOpenings();
						}}
					/>
				</>
			) : null}
			<ChatFloorList
				nodes={path.nodes}
				draft={draft}
				pendingUserText={pendingUserText}
				canLoadOlder={canLoadOlder(path)}
				latestAssistantId={latestAssistantId}
				bottomSignal={bottomSignal}
				retryingImageId={retryingImageId}
				onLoadOlder={loadOlder}
				onRegenerate={regenerate}
				onChooseOption={(nodeId, text) => {
					void chooseOption(nodeId, text);
				}}
				onRetryImage={(nodeId, imageId) => {
					void retryImage(nodeId, imageId);
				}}
			/>
			{summary === null ? null : (
				<p className="turn-summary">{describeTurnSummary(summary)}</p>
			)}
			{draft === null ? (
				<CandidateActions actions={actions} onPick={setInput} />
			) : null}
			<ErrorNotice error={actionsError} />
			<ErrorNotice error={imageError} />
			{failed !== null && retryAction !== null ? (
				<div className="retry-bar">
					{retryAction.kind === "resend" ? (
						<button type="button" onClick={() => sendText(failed.text)}>
							重发
						</button>
					) : null}
					{retryAction.kind === "regenerate" ? (
						<button
							type="button"
							onClick={() => regenerate(retryAction.nodeId)}
						>
							重新生成回复
						</button>
					) : null}
					{retryAction.kind === "blocked" ? (
						<span>{retryAction.message}</span>
					) : null}
				</div>
			) : null}
			<ErrorNotice error={composerError} />
			<Composer
				value={input}
				streaming={streaming}
				turnMode={turnMode}
				onTurnModeChange={setTurnModeOverride}
				onChange={setInput}
				onSend={() => sendText(input)}
				onStop={() => abortRef.current?.abort()}
			/>
		</section>
	);
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function delay(milliseconds: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, milliseconds);
	return promise;
}

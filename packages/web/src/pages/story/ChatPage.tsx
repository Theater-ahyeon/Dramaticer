import type { TurnMode } from "@dramaticer/core";
import type { SseEvent, StoryPath } from "@dramaticer/protocol";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api";
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
import { ChatFloorList } from "../../components/chat/ChatFloorList";
import { Composer } from "../../components/chat/Composer";

const PAGE_SIZE = 60;
const RETRY_ATTEMPTS = 8;
const RETRY_DELAY_MS = 150;

/** R3b 完成前只有快回合可玩；深回合不在界面上出现。 */
const TURN_MODE: TurnMode = "fast";

interface FailedTurn {
	readonly text: string;
	readonly started: boolean;
	readonly assistantNodeId: string | null;
}

export function ChatPage() {
	const { storyId } = useParams();
	const [path, setPath] = useState(emptyPathState);
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
	const abortRef = useRef<AbortController | null>(null);
	const streamingRef = useRef(false);
	const loadingOlderRef = useRef(false);

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		setPath(emptyPathState());
		setLoadError(null);
		setOlderError(null);
		setComposerError(null);
		setSummary(null);
		setFailed(null);
		setDraft(null);
		setInput("");
		void (async () => {
			try {
				const page = await api.getPath(storyId, { limit: PAGE_SIZE });
				if (!active) return;
				setPath((previous) => applyLatestPage(previous, page));
				setBottomSignal((value) => value + 1);
			} catch (error) {
				if (active) setLoadError(error);
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
				api.streamTurn(storyId, { text: trimmed, mode: TURN_MODE }, signal),
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

	if (storyId === undefined) {
		return (
			<section className="panel">
				<p>地址里缺少故事 id。</p>
			</section>
		);
	}

	const lastNode = path.nodes.at(-1);
	const latestAssistantId =
		lastNode !== undefined && lastNode.role === "assistant"
			? lastNode.id
			: null;
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
			<ErrorNotice error={olderError} />
			<ChatFloorList
				nodes={path.nodes}
				draft={draft}
				pendingUserText={pendingUserText}
				canLoadOlder={canLoadOlder(path)}
				latestAssistantId={latestAssistantId}
				bottomSignal={bottomSignal}
				onLoadOlder={loadOlder}
				onRegenerate={regenerate}
				onChooseOption={(nodeId, text) => {
					void chooseOption(nodeId, text);
				}}
			/>
			{summary === null ? null : (
				<p className="turn-summary">{describeTurnSummary(summary)}</p>
			)}
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

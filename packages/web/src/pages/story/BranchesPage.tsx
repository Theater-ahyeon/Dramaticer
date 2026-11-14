import type { StoryPath, StoryTree, StoryTreeNode } from "@dramaticer/protocol";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { type StoryPathOptions, api } from "../../api";
import {
	PATH_PAGE_LIMIT,
	buildBranchRows,
	collectPathNodeIds,
	describeHeadSwitch,
	pruneCollapsed,
	toggleCollapsed,
} from "../../chat/branch-tree";
import { formatFloorTime } from "../../chat/format";
import {
	type TurnDraft,
	applyTurnEvent,
	createTurnDraft,
	markTurnFailed,
} from "../../chat/stream-state";
import { ErrorNotice } from "../../components/ErrorNotice";
import { BranchTree } from "../../components/branches/BranchTree";
import { StreamingBubble } from "../../components/chat/StreamingBubble";

export function BranchesPage() {
	const { storyId } = useParams();
	const [tree, setTree] = useState<StoryTree | null>(null);
	const [pathNodeIds, setPathNodeIds] = useState<readonly string[]>([]);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedRaw, setSelectedRaw] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<unknown>(null);
	const [panelError, setPanelError] = useState<unknown>(null);
	const [editBuffer, setEditBuffer] = useState<string | null>(null);
	const [swipeBuffer, setSwipeBuffer] = useState<string | null>(null);
	const [confirmHead, setConfirmHead] = useState(false);
	const [busy, setBusy] = useState(false);
	const [draft, setDraft] = useState<TurnDraft | null>(null);
	const [focusSignal, setFocusSignal] = useState(0);
	const abortRef = useRef<AbortController | null>(null);
	const rawRequestRef = useRef(0);

	const selected =
		tree === null
			? null
			: (tree.nodes.find((node) => node.id === selectedId) ?? null);
	const pathSet = new Set(pathNodeIds);

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		setTree(null);
		setPathNodeIds([]);
		setSelectedId(null);
		setSelectedRaw(null);
		setLoadError(null);
		setPanelError(null);
		setEditBuffer(null);
		setSwipeBuffer(null);
		setConfirmHead(false);
		setDraft(null);
		setCollapsed(new Set());
		void (async () => {
			try {
				const [loadedTree, ids] = await Promise.all([
					api.getTree(storyId),
					collectPathNodeIds((before) => fetchPathPage(storyId, before)),
				]);
				if (!active) return;
				setTree(loadedTree);
				setPathNodeIds(ids);
				setSelectedId(loadedTree.headNodeId);
				setFocusSignal((value) => value + 1);
				if (loadedTree.headNodeId !== null) {
					const page = await api.getPath(storyId, {
						nodeId: loadedTree.headNodeId,
						limit: 1,
					});
					if (!active) return;
					setSelectedRaw(page.nodes.at(-1)?.raw ?? "");
				}
			} catch (error) {
				if (active) setLoadError(error);
			}
		})();
		return () => {
			active = false;
			abortRef.current?.abort();
		};
	}, [storyId]);

	useEffect(
		() => () => {
			abortRef.current?.abort();
		},
		[],
	);

	const readSelectedRaw = async (
		targetStoryId: string,
		nodeId: string,
	): Promise<void> => {
		const request = rawRequestRef.current + 1;
		rawRequestRef.current = request;
		setSelectedRaw(null);
		const page = await api.getPath(targetStoryId, { nodeId, limit: 1 });
		if (rawRequestRef.current !== request) return;
		setSelectedRaw(page.nodes.at(-1)?.raw ?? "");
	};

	const selectNode = (nodeId: string) => {
		if (storyId === undefined || nodeId === selectedId) return;
		setSelectedId(nodeId);
		setSelectedRaw(null);
		setEditBuffer(null);
		setSwipeBuffer(null);
		setConfirmHead(false);
		setPanelError(null);
		void readSelectedRaw(storyId, nodeId).catch((error: unknown) => {
			setPanelError(error);
		});
	};

	const toggleNode = (nodeId: string) => {
		setCollapsed((previous) => toggleCollapsed(previous, nodeId));
	};

	/** head 切换、编辑与 swipe 之后都重新取树和完整路径，并定位到新末端。 */
	const applyChange = async (
		targetStoryId: string,
		nodeId: string,
		raw: string,
		remainingTree: StoryTree | null,
	): Promise<void> => {
		const ids = await collectPathNodeIds((before) =>
			fetchPathPage(targetStoryId, before),
		);
		const nextTree = remainingTree ?? (await api.getTree(targetStoryId));
		rawRequestRef.current += 1;
		setPathNodeIds(ids);
		setTree(nextTree);
		setCollapsed((previous) => pruneCollapsed(previous, nextTree));
		setSelectedId(nodeId);
		setSelectedRaw(raw);
		setEditBuffer(null);
		setSwipeBuffer(null);
		setConfirmHead(false);
		setFocusSignal((value) => value + 1);
	};

	const switchHead = async () => {
		if (storyId === undefined || selected === null) return;
		setBusy(true);
		try {
			const page = await api.setHead(storyId, selected.id);
			const nextTree = await api.getTree(storyId);
			rawRequestRef.current += 1;
			setPathNodeIds(page.nodes.map((node) => node.id));
			setTree(nextTree);
			setCollapsed((previous) => pruneCollapsed(previous, nextTree));
			setConfirmHead(false);
			setPanelError(null);
			setFocusSignal((value) => value + 1);
		} catch (error) {
			setPanelError(error);
		} finally {
			setBusy(false);
		}
	};

	const saveEdit = async () => {
		if (storyId === undefined || selected === null || editBuffer === null) {
			return;
		}
		if (editBuffer.trim().length === 0) return;
		setBusy(true);
		try {
			const result = await api.editNode(selected.id, { text: editBuffer });
			await applyChange(storyId, result.node.id, result.node.raw, null);
			setPanelError(null);
		} catch (error) {
			setPanelError(error);
		} finally {
			setBusy(false);
		}
	};

	const saveSwipe = async () => {
		if (storyId === undefined || selected === null || swipeBuffer === null) {
			return;
		}
		if (swipeBuffer.trim().length === 0) return;
		setBusy(true);
		try {
			const result = await api.swipeNode(selected.id, { text: swipeBuffer });
			await applyChange(storyId, result.node.id, result.node.raw, null);
			setPanelError(null);
		} catch (error) {
			setPanelError(error);
		} finally {
			setBusy(false);
		}
	};

	const refreshAfterRegenerate = async (
		targetStoryId: string,
		nodeId: string | null,
	): Promise<void> => {
		try {
			const nextTree = await api.getTree(targetStoryId);
			const ids = await collectPathNodeIds((before) =>
				fetchPathPage(targetStoryId, before),
			);
			setTree(nextTree);
			setPathNodeIds(ids);
			setCollapsed((previous) => pruneCollapsed(previous, nextTree));
			if (nodeId !== null) {
				setSelectedId(nodeId);
				await readSelectedRaw(targetStoryId, nodeId);
			}
			setFocusSignal((value) => value + 1);
		} catch (error) {
			setPanelError(error);
		}
	};

	const regenerate = (nodeId: string) => {
		if (storyId === undefined) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setBusy(true);
		setPanelError(null);
		setDraft(createTurnDraft());
		void (async () => {
			let current = createTurnDraft();
			let failure: unknown = null;
			try {
				for await (const event of api.streamRegenerate(
					nodeId,
					undefined,
					controller.signal,
				)) {
					current = applyTurnEvent(current, event);
					setDraft(current);
				}
			} catch (error) {
				failure = error;
				current = markTurnFailed(
					current,
					error instanceof Error ? error.message : "重新生成失败",
				);
				setDraft(current);
			} finally {
				abortRef.current = null;
			}
			// 中止与失败也可能已经保存了部分正文，统一按最新的树刷新。
			await refreshAfterRegenerate(storyId, current.completed?.node.id ?? null);
			const aborted = failure instanceof Error && failure.name === "AbortError";
			if (failure !== null && !aborted) setPanelError(failure);
			setDraft(null);
			setBusy(false);
		})();
	};

	const rows =
		tree === null
			? []
			: buildBranchRows({
					tree,
					pathNodeIds: pathSet,
					collapsed,
				});
	const switchWarning =
		tree === null || selected === null
			? null
			: describeHeadSwitch(selected, tree);

	if (storyId === undefined) {
		return (
			<section className="panel">
				<p>地址里缺少故事 id。</p>
			</section>
		);
	}

	return (
		<section className="branches-panel" aria-label="分支">
			<ErrorNotice error={loadError} />
			<div className="branches-layout">
				<div className="branches-tree-pane">
					<h2>楼层树</h2>
					{tree === null ? (
						<p className="muted">正在读取楼层树…</p>
					) : (
						<BranchTree
							rows={rows}
							selectedId={selectedId}
							focusSignal={focusSignal}
							onSelect={selectNode}
							onToggle={toggleNode}
						/>
					)}
				</div>
				<div className="branches-detail-pane">
					<ErrorNotice error={panelError} />
					{selected === null ? (
						<p className="muted">在左侧选择一层楼查看原文与操作。</p>
					) : (
						<BranchDetail
							node={selected}
							raw={selectedRaw}
							isHead={tree?.headNodeId === selected.id}
							busy={busy}
							switchWarning={switchWarning}
							confirmHead={confirmHead}
							editBuffer={editBuffer}
							swipeBuffer={swipeBuffer}
							draft={draft}
							onEditStart={() => {
								setEditBuffer(selectedRaw ?? "");
								setSwipeBuffer(null);
								setConfirmHead(false);
							}}
							onEditChange={setEditBuffer}
							onEditCancel={() => setEditBuffer(null)}
							onEditSave={() => {
								void saveEdit();
							}}
							onSwipeStart={() => {
								setSwipeBuffer("");
								setEditBuffer(null);
								setConfirmHead(false);
							}}
							onSwipeChange={setSwipeBuffer}
							onSwipeCancel={() => setSwipeBuffer(null)}
							onSwipeSave={() => {
								void saveSwipe();
							}}
							onConfirmRequest={() => setConfirmHead(true)}
							onConfirmCancel={() => setConfirmHead(false)}
							onConfirm={() => {
								void switchHead();
							}}
							onRegenerate={() => regenerate(selected.id)}
						/>
					)}
				</div>
			</div>
		</section>
	);
}

interface BranchDetailProps {
	readonly node: StoryTreeNode;
	readonly raw: string | null;
	readonly isHead: boolean;
	readonly busy: boolean;
	readonly switchWarning: string | null;
	readonly confirmHead: boolean;
	readonly editBuffer: string | null;
	readonly swipeBuffer: string | null;
	readonly draft: TurnDraft | null;
	readonly onEditStart: () => void;
	readonly onEditChange: (text: string) => void;
	readonly onEditCancel: () => void;
	readonly onEditSave: () => void;
	readonly onSwipeStart: () => void;
	readonly onSwipeChange: (text: string) => void;
	readonly onSwipeCancel: () => void;
	readonly onSwipeSave: () => void;
	readonly onConfirmRequest: () => void;
	readonly onConfirmCancel: () => void;
	readonly onConfirm: () => void;
	readonly onRegenerate: () => void;
}

function BranchDetail({
	node,
	raw,
	isHead,
	busy,
	switchWarning,
	confirmHead,
	editBuffer,
	swipeBuffer,
	draft,
	onEditStart,
	onEditChange,
	onEditCancel,
	onEditSave,
	onSwipeStart,
	onSwipeChange,
	onSwipeCancel,
	onSwipeSave,
	onConfirmRequest,
	onConfirmCancel,
	onConfirm,
	onRegenerate,
}: BranchDetailProps) {
	const isAssistant = node.role === "assistant";
	const canRegenerate = isAssistant && node.parentId !== null && !busy;
	return (
		<article className="branch-detail">
			<header className="branch-detail-head">
				<span className={`branch-role branch-role-${node.role}`}>
					{isAssistant ? "剧情" : "你"}
				</span>
				<time dateTime={node.createdAt}>{formatFloorTime(node.createdAt)}</time>
				{isHead ? <span className="branch-badge">当前末端</span> : null}
				<span className="muted branch-node-id">{node.id}</span>
			</header>
			{raw === null ? (
				<p className="muted">正在读取原文…</p>
			) : (
				<pre className="branch-detail-raw">{raw}</pre>
			)}
			<div className="branch-detail-actions">
				<button
					type="button"
					disabled={isHead || busy || confirmHead}
					onClick={onConfirmRequest}
				>
					{isHead ? "已是当前楼层" : "切换到此楼层"}
				</button>
				<button
					type="button"
					disabled={busy || raw === null}
					onClick={onEditStart}
				>
					编辑正文
				</button>
				{isAssistant ? (
					<button
						type="button"
						disabled={busy || raw === null}
						onClick={onSwipeStart}
					>
						改写（新建分支）
					</button>
				) : null}
				{isAssistant ? (
					<button
						type="button"
						disabled={!canRegenerate}
						onClick={onRegenerate}
					>
						重新生成
					</button>
				) : null}
			</div>
			{confirmHead && switchWarning !== null ? (
				<div className="branch-confirm" role="alert">
					<p>{switchWarning}</p>
					<div className="branch-detail-actions">
						<button type="button" disabled={busy} onClick={onConfirm}>
							确认切换
						</button>
						<button type="button" onClick={onConfirmCancel}>
							取消
						</button>
					</div>
				</div>
			) : null}
			{editBuffer === null ? null : (
				<form
					className="branch-editor"
					onSubmit={(event) => {
						event.preventDefault();
						onEditSave();
					}}
				>
					<label>
						编辑后的正文
						<textarea
							value={editBuffer}
							onChange={(event) => onEditChange(event.target.value)}
						/>
					</label>
					<p className="muted">
						保存会新建一层楼，旧楼层保留为兄弟分支，原文不变。
					</p>
					<div className="branch-detail-actions">
						<button
							type="submit"
							disabled={busy || editBuffer.trim().length === 0}
						>
							保存编辑
						</button>
						<button type="button" onClick={onEditCancel}>
							取消
						</button>
					</div>
				</form>
			)}
			{swipeBuffer === null ? null : (
				<form
					className="branch-editor"
					onSubmit={(event) => {
						event.preventDefault();
						onSwipeSave();
					}}
				>
					<label>
						新分支的正文
						<textarea
							value={swipeBuffer}
							onChange={(event) => onSwipeChange(event.target.value)}
						/>
					</label>
					<p className="muted">
						新楼层与被替换的楼层同属一条分支点；旧楼层保留，可以随时切回。
					</p>
					<div className="branch-detail-actions">
						<button
							type="submit"
							disabled={busy || swipeBuffer.trim().length === 0}
						>
							新建分支
						</button>
						<button type="button" onClick={onSwipeCancel}>
							取消
						</button>
					</div>
				</form>
			)}
			{draft === null ? null : <StreamingBubble draft={draft} />}
		</article>
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

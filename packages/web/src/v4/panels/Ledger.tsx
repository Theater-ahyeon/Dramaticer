import type {
	Entity,
	LedgerChangeCard,
	LedgerClue,
	LedgerFact,
	LoreEntry,
	MemoryEvent,
	Summary,
} from "@dramaticer/core";
import type {
	NodeLedgerView,
	ProposalDecisionAction,
	StoryPath,
	StoryTree,
	StoryTreeNode,
} from "@dramaticer/protocol";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { type StoryPathOptions, api } from "../../api";
import {
	PATH_PAGE_LIMIT,
	buildBranchRows,
	collectPathNodeIds,
	toggleCollapsed,
} from "../../chat/branch-tree";
import { formatFloorTime } from "../../chat/format";
import {
	appendEventPage,
	buildNamespaceSlices,
	describeEventMeta,
	formatConfidence,
	formatLedgerPath,
	formatLedgerSource,
	formatNodeRef,
	formatStoryTime,
	formatSummaryLevel,
	hasMoreEventPage,
	highlightPaths,
	nextEventRequest,
	pathKey,
} from "../../chat/ledger-view";
import { replaceProposalCard } from "../../chat/proposal-view";
import { ErrorNotice } from "../../components/ErrorNotice";
import { BranchTree } from "../../components/branches/BranchTree";
import { LedgerValue } from "../../components/ledger/LedgerValue";
import { ProposalList } from "../../components/ledger/ProposalList";
import { StateTree } from "../../components/ledger/StateTree";

export function LedgerTool() {
	const { storyId } = useParams();
	const [tree, setTree] = useState<StoryTree | null>(null);
	const [pathNodeIds, setPathNodeIds] = useState<readonly string[]>([]);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [ledger, setLedger] = useState<NodeLedgerView | null>(null);
	const [events, setEvents] = useState<readonly MemoryEvent[]>([]);
	const [eventsHasMore, setEventsHasMore] = useState(false);
	const [eventsLoading, setEventsLoading] = useState(false);
	const [compressions, setCompressions] = useState<readonly Summary[]>([]);
	const [clues, setClues] = useState<readonly LedgerClue[]>([]);
	const [entities, setEntities] = useState<readonly Entity[]>([]);
	const [lore, setLore] = useState<readonly LoreEntry[]>([]);
	const [nodeLoading, setNodeLoading] = useState(false);
	const [loadError, setLoadError] = useState<unknown>(null);
	const [nodeError, setNodeError] = useState<unknown>(null);
	const [cards, setCards] = useState<readonly LedgerChangeCard[]>([]);
	const [cardBusyId, setCardBusyId] = useState<string | null>(null);
	const [cardError, setCardError] = useState<unknown>(null);
	const requestRef = useRef(0);
	const storyEpoch = useRef(0);
	const selectedIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		storyEpoch.current += 1;
		requestRef.current += 1;
		setTree(null);
		setPathNodeIds([]);
		setCollapsed(new Set());
		setSelectedId(null);
		setLedger(null);
		setEvents([]);
		setEventsHasMore(false);
		setCompressions([]);
		setClues([]);
		setEntities([]);
		setLore([]);
		setCards([]);
		setCardBusyId(null);
		setCardError(null);
		setNodeError(null);
		setLoadError(null);
		void (async () => {
			try {
				const [loadedTree, ids, clueView, entityView, loreView, proposalView] =
					await Promise.all([
						api.getTree(storyId),
						collectPathNodeIds((before) => fetchPathPage(storyId, before)),
						api.getClues(storyId),
						api.getEntities(storyId),
						api.getLore(storyId),
						api.getProposals(storyId, "all"),
					]);
				if (!active) return;
				setTree(loadedTree);
				setPathNodeIds(ids);
				setClues(clueView.clues);
				setEntities(entityView.entities);
				setLore(loreView.entries);
				setCards(proposalView.proposals);
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
		selectedIdRef.current = selectedId;
	}, [selectedId]);

	useEffect(() => {
		if (
			storyId === undefined ||
			selectedId === null ||
			tree === null ||
			tree.storyId !== storyId
		) {
			return;
		}
		const request = requestRef.current + 1;
		requestRef.current = request;
		let active = true;
		setNodeLoading(true);
		setNodeError(null);
		setLedger(null);
		setEvents([]);
		setEventsHasMore(false);
		setCompressions([]);
		void (async () => {
			try {
				const [ledgerView, eventPage, compressionView] = await Promise.all([
					api.getLedger(selectedId),
					api.getEvents(selectedId, nextEventRequest(0)),
					api.getCompressions(selectedId),
				]);
				if (!active || requestRef.current !== request) return;
				setLedger(ledgerView);
				setEvents(eventPage.events);
				setEventsHasMore(
					hasMoreEventPage(eventPage.events.length, eventPage.limit),
				);
				setCompressions(compressionView.compressions);
			} catch (error) {
				if (active && requestRef.current === request) setNodeError(error);
			} finally {
				if (active && requestRef.current === request) setNodeLoading(false);
			}
		})();
		return () => {
			active = false;
		};
	}, [storyId, selectedId, tree]);

	const selected =
		tree === null
			? null
			: (tree.nodes.find((node) => node.id === selectedId) ?? null);
	const nodeById = new Map(
		tree === null ? [] : tree.nodes.map((node) => [node.id, node] as const),
	);
	const rows =
		tree === null
			? []
			: buildBranchRows({
					tree,
					pathNodeIds: new Set(pathNodeIds),
					collapsed,
				});
	const slices =
		ledger === null
			? []
			: buildNamespaceSlices(ledger.state, ledger.facts, ledger.diffs);
	const highlighted =
		ledger === null ? new Set<string>() : highlightPaths(ledger.diffs);

	const loadMoreEvents = () => {
		if (storyId === undefined || selectedId === null || eventsLoading) return;
		const nodeId = selectedId;
		const request = requestRef.current;
		setEventsLoading(true);
		void api
			.getEvents(nodeId, nextEventRequest(events.length))
			.then((page) => {
				if (requestRef.current !== request) return;
				setEvents((previous) => appendEventPage(previous, page.events));
				setEventsHasMore(hasMoreEventPage(page.events.length, page.limit));
				setNodeError(null);
			})
			.catch((error: unknown) => {
				if (requestRef.current === request) setNodeError(error);
			})
			.finally(() => {
				if (requestRef.current === request) setEventsLoading(false);
			});
	};

	const decideCard = (cardId: string, action: ProposalDecisionAction) => {
		if (storyId === undefined || cardBusyId !== null) return;
		const epoch = storyEpoch.current;
		setCardBusyId(cardId);
		setCardError(null);
		void api
			.decideProposal(cardId, action)
			.then(async (result) => {
				if (storyEpoch.current !== epoch) return;
				setCards((previous) => replaceProposalCard(previous, result.card));
				if (
					result.ledger !== null &&
					result.ledger.nodeId === selectedIdRef.current
				) {
					setLedger(result.ledger);
				}
				const clueView = await api.getClues(storyId);
				if (storyEpoch.current === epoch) setClues(clueView.clues);
			})
			.catch((error: unknown) => {
				if (storyEpoch.current === epoch) setCardError(error);
			})
			.finally(() => {
				if (storyEpoch.current === epoch) setCardBusyId(null);
			});
	};

	return (
		<div className="ledger-layout">
			<aside className="ledger-tree-pane">
				<h2>楼层</h2>
				<p className="muted">选择任意一层查看那一楼的台账与事件。</p>
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
					<p className="muted">正在读取台账…</p>
				) : null}
				{selected !== null ? (
					<>
						<header className="ledger-floor-head">
							<h1>台账</h1>
							<p className="ledger-meta">
								楼层 {formatNodeRef(selected.id)} ·{" "}
								{selected.role === "user" ? "你" : "剧情"} ·{" "}
								{formatFloorTime(selected.createdAt)}
							</p>
						</header>
						<ErrorNotice error={nodeError} />
						{nodeLoading ? <p className="muted">正在读取台账…</p> : null}
						<ErrorNotice error={cardError} />
						<ProposalList
							cards={cards}
							busyId={cardBusyId}
							onDecide={decideCard}
						/>
						{ledger === null ? null : (
							<>
								<section className="ledger-section">
									<h2>本楼写入</h2>
									{ledger.diffs.length === 0 ? (
										<p className="muted">本楼没有台账写入。</p>
									) : (
										<ul className="ledger-diff-list">
											{ledger.diffs.map((diff) => (
												<li
													key={diff.id}
													className={
														diff.op === "delete"
															? "ledger-diff ledger-diff-delete"
															: "ledger-diff"
													}
												>
													<div className="ledger-diff-head">
														<span className="ledger-path">
															{formatLedgerPath(diff.path)}
														</span>
														<span className="ledger-tag">
															{diff.op === "delete" ? "删除" : "写入"}
														</span>
														<span className="ledger-tag">
															{formatLedgerSource(diff.source)}
														</span>
														<span className="ledger-tag">
															置信度 {formatConfidence(diff.confidence)}
														</span>
														<span className="ledger-tag">
															故事时间 {formatStoryTime(diff.storyTime)}
														</span>
													</div>
													{diff.op === "set" ? (
														<LedgerValue value={diff.value} />
													) : null}
													{diff.reason === null ? null : (
														<p className="ledger-meta">原因：{diff.reason}</p>
													)}
												</li>
											))}
										</ul>
									)}
								</section>
								<div className="ledger-cards">
									{slices.map((slice) => (
										<section key={slice.namespace} className="ledger-card">
											<header className="ledger-card-head">
												<h2>{slice.label}</h2>
												<span className="ledger-namespace">
													{slice.namespace}
												</span>
												{slice.diffs.length === 0 ? null : (
													<span className="ledger-badge">
														本楼 {slice.diffs.length} 条
													</span>
												)}
											</header>
											{slice.state === undefined ? (
												<p className="muted">没有记录。</p>
											) : (
												<StateTree
													value={slice.state}
													highlighted={highlighted}
													basePath={[slice.namespace]}
												/>
											)}
											{slice.facts.length === 0 ? null : (
												<details className="ledger-facts">
													<summary>事实（{slice.facts.length}）</summary>
													<ul className="ledger-fact-list">
														{slice.facts.map((fact) => (
															<li
																key={pathKey(fact.path)}
																className="ledger-fact"
															>
																<div className="ledger-fact-head">
																	<span className="ledger-path">
																		{formatLedgerPath(fact.path)}
																	</span>
																	<span className="ledger-tag">
																		{formatLedgerSource(fact.source)}
																	</span>
																	{fact.storyTime === null ? null : (
																		<span className="ledger-tag">
																			{formatStoryTime(fact.storyTime)}
																		</span>
																	)}
																</div>
																<LedgerValue value={fact.value} />
																<p className="ledger-meta">
																	来源楼层 {formatNodeRef(fact.nodeId)} ·{" "}
																	{describeFactOrigin(nodeById, fact)}
																</p>
															</li>
														))}
													</ul>
												</details>
											)}
										</section>
									))}
								</div>
								<section className="ledger-section">
									<h2>事件</h2>
									{events.length === 0 ? (
										<p className="muted">当前路径上没有抽取到事件。</p>
									) : (
										<ul className="ledger-event-list">
											{events.map((event) => (
												<li key={event.id} className="ledger-event">
													<p className="ledger-event-text">{event.text}</p>
													<dl className="ledger-meta-list">
														{describeEventMeta(event).map((item) => (
															<div key={item.label}>
																<dt>{item.label}</dt>
																<dd>{item.value}</dd>
															</div>
														))}
													</dl>
												</li>
											))}
										</ul>
									)}
									{eventsHasMore ? (
										<button
											type="button"
											className="ledger-more"
											onClick={loadMoreEvents}
											disabled={eventsLoading}
										>
											{eventsLoading ? "正在加载…" : "加载更多事件"}
										</button>
									) : null}
								</section>
								<section className="ledger-section">
									<h2>记忆摘要</h2>
									{compressions.length === 0 ? (
										<p className="muted">没有覆盖本楼的摘要。</p>
									) : (
										<ul className="ledger-summary-list">
											{compressions.map((summary) => (
												<li key={summary.id} className="ledger-summary">
													<header className="ledger-card-head">
														<span className="ledger-badge">
															{formatSummaryLevel(summary.level)}
														</span>
														<span className="ledger-tag">
															{summary.tokenCount} token
														</span>
													</header>
													<p className="ledger-meta">
														覆盖 {formatNodeRef(summary.startNodeId)} →{" "}
														{formatNodeRef(summary.endNodeId)}
													</p>
													<LedgerValue value={summary.text} />
												</li>
											))}
										</ul>
									)}
								</section>
							</>
						)}
						<section className="ledger-section">
							<h2>故事级记忆</h2>
							<h3>未兑现线索</h3>
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
										</li>
									))}
								</ul>
							)}
							<h3>实体</h3>
							{entities.length === 0 ? (
								<p className="muted">没有实体。</p>
							) : (
								<ul className="ledger-story-list">
									{entities.map((entity) => (
										<li
											key={entity.id}
											className="ledger-story-item ledger-entity"
										>
											{entity.kind === "character" && storyId !== undefined ? (
												<img
													className="ledger-portrait"
													src={api.storyPortraitUrl(storyId, entity.name)}
													alt={`${entity.name} 的立绘`}
													onError={(event) => {
														event.currentTarget.hidden = true;
													}}
												/>
											) : null}
											<div className="ledger-entity-body">
												<div className="ledger-diff-head">
													<span className="ledger-path">{entity.name}</span>
													<span className="ledger-tag">{entity.kind}</span>
												</div>
												{entity.aliases.length === 0 ? null : (
													<p className="ledger-meta">
														别名：{entity.aliases.join("、")}
													</p>
												)}
												{entity.description.length === 0 ? null : (
													<LedgerValue value={entity.description} />
												)}
												<p className="ledger-meta">来源：{entity.source}</p>
											</div>
										</li>
									))}
								</ul>
							)}
							<h3>世界书</h3>
							{lore.length === 0 ? (
								<p className="muted">没有世界书条目。</p>
							) : (
								<ul className="ledger-story-list">
									{lore.map((entry) => (
										<li key={entry.id} className="ledger-story-item">
											<div className="ledger-diff-head">
												<span className="ledger-path">{entry.name}</span>
												{entry.constant ? (
													<span className="ledger-badge">常驻</span>
												) : null}
											</div>
											{entry.keywords.length === 0 ? null : (
												<p className="ledger-meta">
													关键词：{entry.keywords.join("、")}
												</p>
											)}
											<LedgerValue value={entry.content} />
											<p className="ledger-meta">来源：{entry.source}</p>
										</li>
									))}
								</ul>
							)}
						</section>
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

/** 事实的来源楼层与写入时间；楼层不在当前树里时明确写未记录。 */
function describeFactOrigin(
	nodeById: ReadonlyMap<string, StoryTreeNode>,
	fact: LedgerFact,
): string {
	const node = nodeById.get(fact.nodeId);
	if (node === undefined) return "写入时间未记录";
	return `${node.role === "user" ? "你" : "剧情"} · ${formatFloorTime(node.createdAt)}`;
}

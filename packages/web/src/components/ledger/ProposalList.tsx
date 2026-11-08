import type { LedgerChangeCard } from "@dramaticer/core";
import type { ProposalDecisionAction } from "@dramaticer/protocol";
import { formatFloorTime } from "../../chat/format";
import { formatLedgerSource, formatNodeRef } from "../../chat/ledger-view";
import {
	PROPOSAL_ACTION_LABELS,
	describeProposalDiffs,
	groupProposalCards,
	proposalActions,
} from "../../chat/proposal-view";
import { LedgerValue } from "./LedgerValue";

export interface ProposalListProps {
	readonly cards: readonly LedgerChangeCard[];
	readonly busyId: string | null;
	readonly onDecide: (cardId: string, action: ProposalDecisionAction) => void;
}

/** 待审变更卡列表：按状态分组，批准、拒绝与回滚只在这里发起。 */
export function ProposalList({ cards, busyId, onDecide }: ProposalListProps) {
	const groups = groupProposalCards(cards);
	return (
		<section className="ledger-section">
			<h2>变更卡</h2>
			{groups.length === 0 ? (
				<p className="muted">没有变更卡。</p>
			) : (
				groups.map((group) => (
					<div key={group.status} className="ledger-proposal-group">
						<h3>
							{group.label}（{group.cards.length}）
						</h3>
						<ul className="ledger-proposal-list">
							{group.cards.map((card) => {
								const actions = proposalActions(card.status);
								return (
									<li key={card.id} className="ledger-proposal">
										<div className="ledger-diff-head">
											<span className="ledger-tag">
												{formatLedgerSource(card.source)}
											</span>
											<span className="ledger-tag">{group.label}</span>
											<span className="ledger-meta">
												来源楼层 {formatNodeRef(card.sourceNodeId)} ·{" "}
												{formatFloorTime(card.createdAt)}
											</span>
										</div>
										<p className="ledger-proposal-text">{card.text}</p>
										<ul className="ledger-proposal-diffs">
											{describeProposalDiffs(card).map((diff) => (
												<li key={`${card.id}:${diff.path}`}>
													<div className="ledger-diff-head">
														<span className="ledger-path">{diff.path}</span>
														<span className="ledger-tag">
															{diff.op === "delete" ? "删除" : "写入"}
														</span>
													</div>
													{diff.op === "delete" ? null : (
														<LedgerValue value={diff.value} />
													)}
												</li>
											))}
										</ul>
										{card.rejectionReason === null ? null : (
											<p className="ledger-proposal-rejection">
												拒绝原因：{card.rejectionReason}
											</p>
										)}
										{actions.length === 0 ? null : (
											<div className="ledger-proposal-actions">
												{actions.map((action) => (
													<button
														key={action}
														type="button"
														className="ledger-proposal-action"
														disabled={busyId !== null}
														onClick={() => onDecide(card.id, action)}
													>
														{busyId === card.id
															? "处理中…"
															: PROPOSAL_ACTION_LABELS[action]}
													</button>
												))}
											</div>
										)}
									</li>
								);
							})}
						</ul>
					</div>
				))
			)}
		</section>
	);
}

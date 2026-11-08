import type {
	LedgerChangeCard,
	LedgerChangeCardStatus,
	StateDiffOp,
} from "@dramaticer/core";
import type { ProposalDecisionAction } from "@dramaticer/protocol";
import { formatLedgerPath } from "./ledger-view";

/** 变更卡分组的固定顺序：先看待审，再看已经处理过的。 */
export const PROPOSAL_GROUP_LABELS = [
	{ status: "pending", label: "待审" },
	{ status: "approved", label: "已批准" },
	{ status: "rejected", label: "已拒绝" },
	{ status: "rolled_back", label: "已回滚" },
] as const satisfies readonly {
	readonly status: LedgerChangeCardStatus;
	readonly label: string;
}[];

export const PROPOSAL_ACTION_LABELS: Readonly<
	Record<ProposalDecisionAction, string>
> = {
	approve: "批准",
	reject: "拒绝",
	rollback: "回滚",
};

export interface ProposalDiffView {
	readonly path: string;
	readonly op: StateDiffOp;
	/** `delete` 时为 undefined。 */
	readonly value: unknown;
}

export interface ProposalGroup {
	readonly status: LedgerChangeCardStatus;
	readonly label: string;
	readonly cards: readonly LedgerChangeCard[];
}

/** 按状态分组；没有卡片的状态不出现，组内保持服务端给的顺序。 */
export function groupProposalCards(
	cards: readonly LedgerChangeCard[],
): readonly ProposalGroup[] {
	return PROPOSAL_GROUP_LABELS.map(({ status, label }) => ({
		status,
		label,
		cards: cards.filter((card) => card.status === status),
	})).filter((group) => group.cards.length > 0);
}

/** 卡片当前允许的动作；已拒绝与已回滚的卡片没有动作。 */
export function proposalActions(
	status: LedgerChangeCardStatus,
): readonly ProposalDecisionAction[] {
	switch (status) {
		case "pending":
			return ["approve", "reject"];
		case "approved":
			return ["rollback"];
		case "rejected":
		case "rolled_back":
			return [];
	}
}

/** 卡片里每条修改的路径、动作与值；长值由 LedgerValue 组件折叠。 */
export function describeProposalDiffs(
	card: LedgerChangeCard,
): readonly ProposalDiffView[] {
	return card.diffs.map((diff) => ({
		path: formatLedgerPath(diff.path),
		op: diff.op,
		value: diff.op === "set" ? diff.value : undefined,
	}));
}

/** 操作成功后用服务端返回的卡片替换列表里的同一张。 */
export function replaceProposalCard(
	cards: readonly LedgerChangeCard[],
	updated: LedgerChangeCard,
): readonly LedgerChangeCard[] {
	const exists = cards.some((card) => card.id === updated.id);
	if (!exists) return [...cards, updated];
	return cards.map((card) => (card.id === updated.id ? updated : card));
}

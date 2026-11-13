import type { LedgerChangeCard } from "@dramaticer/core";
import { describe, expect, it } from "vitest";
import {
	describeProposalDiffs,
	groupProposalCards,
	proposalActions,
	replaceProposalCard,
} from "../src/chat/proposal-view";

const CREATED_AT = "2026-11-08T10:00:00.000Z";

function card(
	id: string,
	status: LedgerChangeCard["status"],
	overrides: Partial<LedgerChangeCard> = {},
): LedgerChangeCard {
	return {
		id,
		storyId: "story-1",
		source: "player",
		assistantConversationId: null,
		sourceNodeId: "node-1",
		text: `变更 ${id}`,
		diffs: [{ path: ["mvu", "time"], op: "set", value: "夜晚" }],
		before: [{ path: ["mvu", "time"], existed: false }],
		status,
		rejectionReason: null,
		createdAt: CREATED_AT,
		decidedAt: null,
		...overrides,
	};
}

describe("变更卡展示", () => {
	it("按待审、已批准、已拒绝、已回滚分组，组内保持服务端顺序", () => {
		const groups = groupProposalCards([
			card("a", "approved"),
			card("b", "pending"),
			card("c", "rolled_back"),
			card("d", "pending"),
			card("e", "rejected"),
		]);
		expect(groups.map((group) => group.status)).toEqual([
			"pending",
			"approved",
			"rejected",
			"rolled_back",
		]);
		expect(groups.map((group) => group.cards.map((item) => item.id))).toEqual([
			["b", "d"],
			["a"],
			["e"],
			["c"],
		]);
	});

	it("没有卡片的状态不出现", () => {
		expect(groupProposalCards([])).toEqual([]);
		expect(
			groupProposalCards([card("a", "approved")]).map((group) => group.label),
		).toEqual(["已批准"]);
	});

	it("动作按状态给出", () => {
		expect(proposalActions("pending")).toEqual(["approve", "reject"]);
		expect(proposalActions("approved")).toEqual(["rollback"]);
		expect(proposalActions("rejected")).toEqual([]);
		expect(proposalActions("rolled_back")).toEqual([]);
	});

	it("修改列表写出路径、动作与值，删除没有值", () => {
		const diffs = describeProposalDiffs(
			card("a", "pending", {
				diffs: [
					{ path: ["character", "凛", "location"], op: "set", value: "屋顶" },
					{ path: ["item", "旧剑"], op: "delete" },
				],
			}),
		);
		expect(diffs).toEqual([
			{ path: "character / 凛 / location", op: "set", value: "屋顶" },
			{ path: "item / 旧剑", op: "delete", value: undefined },
		]);
	});

	it("操作成功后替换同一张卡片，未知卡片追加到末尾", () => {
		const before = [card("a", "pending"), card("b", "pending")];
		const updated = card("a", "approved");
		expect(replaceProposalCard(before, updated)).toEqual([updated, before[1]]);
		const added = card("c", "pending");
		expect(replaceProposalCard(before, added)).toEqual([...before, added]);
	});
});

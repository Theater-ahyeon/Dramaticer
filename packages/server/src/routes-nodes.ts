// server 路由：单个楼层：正文、选择、Trace、运行、台账、事件、压缩、导演与候选行动、变更卡（refactor/06 从 routes.ts 拆出）。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	DEFAULT_MEMORY_EVENT_LIMIT,
	type DirectorDecision,
	LEDGER_CHANGE_CARD_STATUSES,
	type LedgerChangeCard,
	LedgerChangeCardError,
	MAX_MEMORY_EVENT_LIMIT,
	type StoryStore,
	approveLedgerChangeCard,
	assertLedgerChangeCardDiffs,
	createPlayerLedgerChangeCard,
	isLedgerChangeCardStatus,
	readLedgerFacts,
	rejectLedgerChangeCard,
	rollbackLedgerChangeCard,
} from "@dramaticer/core";
import type {
	DirectorDecisionView,
	NodeActionResult,
	NodeActionsView,
	NodeChoiceResult,
	NodeCompressionsView,
	NodeDirectorView,
	NodeEventsView,
	NodeLedgerView,
	NodeRunView,
	ProposalDecisionAction,
	ProposalDecisionResult,
	StoryProposalCreateResult,
	StoryProposalsView,
} from "@dramaticer/protocol";
import { HttpError, sendJson } from "./http.js";
import {
	assertKnownKeys,
	fieldError,
	queryInteger,
	readObjectBody,
	requireNode,
	requireRawText,
	requireStory,
	requireText,
	toBadRequest,
} from "./routes-common.js";
import { buildPath } from "./routes-stories.js";
import type { ApiRouteOptions } from "./routes.js";

export async function handleNodeText(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
	action: "swipe" | "edit",
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text"]);
	const text = requireRawText(body.text, "text");
	const created =
		action === "swipe"
			? options.store.swipeNode(node.id, text)
			: options.store.editNode(node.id, text);
	const view: NodeActionResult = {
		node: created,
		path: buildPath(
			options.store,
			created.storyId,
			options.store.getPathToNode(created.id),
		),
	};
	sendJson(res, 201, view);
}

/**
 * 记录一次选项块的选择。界面只发送选中的正文，故事与楼层从节点推出；
 * 载荷校验与非空判断在 `recordPreference` 里完成。
 */
export async function handleNodeChoice(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text"]);
	const text = requireText(body.text, "text");
	const event = options.store.recordPreference({
		storyId: node.storyId,
		nodeId: node.id,
		kind: "choice",
		payload: { choiceText: text },
	});
	const view: NodeChoiceResult = { event };
	sendJson(res, 201, view);
}

export function handleNodeTrace(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	requireNode(options.store, nodeId);
	const trace = options.store.getTurnTrace(nodeId);
	if (trace === null) {
		throw new HttpError(404, "not_found", `楼层 ${nodeId} 没有 Trace`);
	}
	sendJson(res, 200, trace);
}

export function handleNodeRun(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	requireNode(options.store, nodeId);
	const run = options.store.getTurnRunForNode(nodeId);
	if (run === null) {
		throw new HttpError(404, "not_found", `楼层 ${nodeId} 没有运行记录`);
	}
	const view: NodeRunView = {
		nodeId,
		run,
		events: options.store.listTurnRunEvents(run.runId),
	};
	sendJson(res, 200, view);
}

export function handleNodeLedger(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	sendJson(res, 200, buildNodeLedgerView(options.store, nodeId));
}

export function buildNodeLedgerView(
	store: StoryStore,
	nodeId: string,
): NodeLedgerView {
	const node = requireNode(store, nodeId);
	return {
		nodeId,
		storyId: node.storyId,
		state: store.getStateSnapshot(nodeId).state,
		facts: readLedgerFacts(store, nodeId),
		diffs: store.getStateDiffs(nodeId),
	};
}

export function handleNodeEvents(
	res: ServerResponse,
	options: ApiRouteOptions,
	url: URL,
	nodeId: string,
): void {
	requireNode(options.store, nodeId);
	const limit = queryInteger(url, "limit", 1, MAX_MEMORY_EVENT_LIMIT);
	const offset = queryInteger(url, "offset", 0, Number.MAX_SAFE_INTEGER);
	const view: NodeEventsView = {
		nodeId,
		limit: limit ?? DEFAULT_MEMORY_EVENT_LIMIT,
		offset: offset ?? 0,
		events: options.store.getEventsForPath(nodeId, {
			...(limit === undefined ? {} : { limit }),
			...(offset === undefined ? {} : { offset }),
		}),
	};
	sendJson(res, 200, view);
}

export function handleNodeCompressions(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const view: NodeCompressionsView = {
		nodeId,
		compressions: options.store.getValidSummaries(node.storyId, nodeId),
	};
	sendJson(res, 200, view);
}

export function handleNodeDirector(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const mode = options.store.getStorySettings(node.storyId).directorConfig.mode;
	const decision = options.store.getDirectorDecision(node.id);
	const view: NodeDirectorView = {
		nodeId: node.id,
		mode,
		decision:
			decision === null
				? null
				: mode === "blind"
					? redactDirectorDecision(decision)
					: decision,
	};
	sendJson(res, 200, view);
}

/** 该楼层在间隙里生成的候选行动；没有时返回空数组。 */
export function handleNodeActions(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const view: NodeActionsView = {
		nodeId: node.id,
		actions: options.store.listDirectorCandidateActions(node.id),
	};
	sendJson(res, 200, view);
}

/** 盲盒模式下面向玩家只保留机制触发状态，隐去指令与信号。 */
export function redactDirectorDecision(
	decision: DirectorDecision,
): DirectorDecisionView {
	return {
		nodeId: decision.nodeId,
		storyId: decision.storyId,
		directive: null,
		mechanisms: decision.mechanisms,
		createdAt: decision.createdAt,
	};
}

export async function handleProposalDecision(
	res: ServerResponse,
	options: ApiRouteOptions,
	cardId: string,
	action: ProposalDecisionAction,
): Promise<void> {
	let card: LedgerChangeCard;
	try {
		card = await decideLedgerChangeCard(options.store, cardId, action);
	} catch (error) {
		throw toProposalDecisionError(error);
	}
	const head = options.store.getHead(card.storyId);
	const view: ProposalDecisionResult = {
		card,
		ledger: head === null ? null : buildNodeLedgerView(options.store, head.id),
	};
	sendJson(res, 200, view);
}

export function decideLedgerChangeCard(
	store: StoryStore,
	cardId: string,
	action: ProposalDecisionAction,
): Promise<LedgerChangeCard> {
	switch (action) {
		case "approve":
			return approveLedgerChangeCard(store, cardId);
		case "reject":
			return rejectLedgerChangeCard(store, cardId);
		case "rollback":
			return rollbackLedgerChangeCard(store, cardId);
	}
}

/** 卡片不存在映射 404，状态不允许映射 409；其余错误原样上抛。 */
export function toProposalDecisionError(error: unknown): HttpError {
	if (!(error instanceof LedgerChangeCardError)) throw error;
	if (error.code === "not_found") {
		return new HttpError(404, "not_found", error.message);
	}
	return new HttpError(409, "conflict", error.message);
}

export async function handleCreateProposal(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text", "diffs"]);
	const text = requireText(body.text, "text");
	if (!Array.isArray(body.diffs) || body.diffs.length === 0) {
		throw fieldError("diffs", "diffs 必须是非空数组");
	}
	let card: LedgerChangeCard;
	try {
		card = createPlayerLedgerChangeCard(options.store, storyId, {
			text,
			diffs: assertLedgerChangeCardDiffs(body.diffs, "diffs"),
		});
	} catch (error) {
		throw toBadRequest(error, "diffs");
	}
	const head = options.store.getHead(storyId);
	const view: StoryProposalCreateResult = {
		card,
		ledger: head === null ? null : buildNodeLedgerView(options.store, head.id),
	};
	sendJson(res, 201, view);
}

export function handleProposals(
	res: ServerResponse,
	options: ApiRouteOptions,
	url: URL,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const status = url.searchParams.get("status") ?? "pending";
	if (status !== "all" && !isLedgerChangeCardStatus(status)) {
		throw fieldError(
			"status",
			`status 只能是 all 或 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}`,
		);
	}
	const view: StoryProposalsView = {
		storyId,
		status,
		proposals: options.store.listLedgerChangeCards(
			storyId,
			status === "all" ? {} : { status },
		),
	};
	sendJson(res, 200, view);
}

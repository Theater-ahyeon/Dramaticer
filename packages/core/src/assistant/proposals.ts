import { parseDirectorPlan } from "../director/plan.js";
import { type JsonObject, rejectUnknownKeys } from "../json.js";
import {
	type LedgerChangeCardDiff,
	assertLedgerChangeCardDiff,
	ledgerChangeCardId,
	readBeforeEntry,
} from "../ledger/cards.js";
import type { StoryStore } from "../store/story-store.js";
import type { DeepToolDefinition } from "../tools/registry.js";
import type { AssistantPermission } from "./types.js";

/** 台账修订技能的提案工具：只生成待批准的变更卡。 */
export const PROPOSE_LEDGER_CHANGE_TOOL_NAME = "propose_ledger_change";
/** 参谋技能的提案工具：只生成待确认的导演计划动作。 */
export const PROPOSE_DIRECTOR_PLAN_TOOL_NAME = "propose_director_plan";

const LEDGER_CHANGE_ARGUMENTS = ["diffs", "explanation"] as const;
const DIRECTOR_PLAN_ARGUMENTS = ["plan", "summary"] as const;

export interface AssistantProposalToolOptions {
	readonly store: StoryStore;
	readonly storyId: string | null;
	readonly conversationId: string;
	readonly permission: AssistantPermission;
	readonly now?: () => string;
}

/**
 * 生成两个提案工具。工具本身只写待批准变更卡与待确认动作；批准与拒绝
 * 走台账卡片和助手动作的既有接口。只读级别不能生成任何提案。
 */
export function createAssistantProposalTools(
	options: AssistantProposalToolOptions,
): readonly DeepToolDefinition[] {
	return [
		{
			name: PROPOSE_LEDGER_CHANGE_TOOL_NAME,
			description:
				"提议修改台账。逐条给出路径与操作（set 带 value，delete 不带 value），用当前 head 快照校验后生成待批准的变更卡，玩家批准后才写入。先读台账再提议。",
			parameters: {
				type: "object",
				properties: {
					diffs: {
						type: "array",
						minItems: 1,
						items: {
							type: "object",
							properties: {
								path: {
									type: "array",
									items: { type: "string", minLength: 1 },
									minItems: 1,
								},
								op: { type: "string", enum: ["set", "delete"] },
								value: {},
							},
							required: ["path", "op"],
							additionalProperties: false,
						},
					},
					explanation: { type: "string", minLength: 1 },
				},
				required: ["diffs", "explanation"],
				additionalProperties: false,
			},
			permission: "propose",
			progressLabel: "拟台账变更……",
			execute: (args: JsonObject) => proposeLedgerChange(options, args),
		},
		{
			name: PROPOSE_DIRECTOR_PLAN_TOOL_NAME,
			description:
				"提议整份导演计划：弧线、序列与拍。用现有计划校验器检查后生成待确认动作，玩家批准后替换当前计划。先读导演计划与台账再提议。",
			parameters: {
				type: "object",
				properties: {
					plan: {
						type: "object",
						properties: {
							arcs: {
								type: "array",
								minItems: 1,
								items: {
									type: "object",
									properties: {
										id: { type: "string", minLength: 1 },
										title: { type: "string", minLength: 1 },
										throughLine: { type: "string", minLength: 1 },
										difficulty: { type: "number", minimum: 0, maximum: 1 },
										redLines: {
											type: "array",
											items: { type: "string", minLength: 1 },
										},
										sequences: { type: "array" },
									},
									required: [
										"id",
										"title",
										"throughLine",
										"difficulty",
										"redLines",
										"sequences",
									],
									additionalProperties: false,
								},
							},
						},
						required: ["arcs"],
						additionalProperties: false,
					},
					summary: { type: "string", minLength: 1 },
				},
				required: ["plan"],
				additionalProperties: false,
			},
			permission: "propose",
			progressLabel: "拟导演计划……",
			execute: (args: JsonObject) => proposeDirectorPlan(options, args),
		},
	];
}

function proposeLedgerChange(
	options: AssistantProposalToolOptions,
	args: JsonObject,
): string {
	if (options.permission === "read_only") {
		throw new Error(
			"permission_denied：会话权限是 read_only，不能生成待批准变更卡。",
		);
	}
	if (options.storyId === null) {
		throw new Error("这个技能需要关联故事；当前助手会话没有关联故事");
	}
	rejectUnknownKeys(args, LEDGER_CHANGE_ARGUMENTS, "参数");
	if (typeof args.explanation !== "string" || args.explanation.trim() === "") {
		throw new Error("参数.explanation 必须是非空字符串");
	}
	const explanation = args.explanation.trim();
	if (!Array.isArray(args.diffs) || args.diffs.length === 0) {
		throw new Error("参数.diffs 必须是非空数组");
	}
	const storyId = options.storyId;
	const head = options.store.getHead(storyId);
	if (head === null) {
		throw new Error(
			`故事 ${storyId} 还没有任何楼层（没有 head），无法锚定台账变更卡`,
		);
	}
	const diffs = args.diffs.map((item, index) => {
		try {
			return assertLedgerChangeCardDiff(item, `参数.diffs[${index}]`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`参数.diffs[${index}] 不合法：${message}`);
		}
	});
	const snapshot = options.store.getStateSnapshot(head.id).state;
	for (const [index, diff] of diffs.entries()) {
		if (diff.op !== "delete") continue;
		if (!readBeforeEntry(snapshot, diff.path).existed) {
			throw new Error(
				`参数.diffs[${index}].path 指向的台账路径不存在：${pathLabel(diff.path)}`,
			);
		}
	}
	const before = diffs.map((diff) => readBeforeEntry(snapshot, diff.path));
	const id = ledgerChangeCardId([
		PROPOSE_LEDGER_CHANGE_TOOL_NAME,
		options.conversationId,
		head.id,
		explanation,
		JSON.stringify(diffs),
	]);
	const existing = options.store.getLedgerChangeCard(id);
	if (existing !== null) {
		return renderCard(
			existing.id,
			existing.status,
			existing.diffs,
			existing.before,
			false,
		);
	}
	const card = options.store.insertLedgerChangeCard({
		id,
		storyId,
		source: "assistant",
		assistantConversationId: options.conversationId,
		sourceNodeId: head.id,
		text: explanation,
		diffs,
		before,
		status: "pending",
		createdAt: options.now?.() ?? new Date().toISOString(),
		decidedAt: null,
	});
	return renderCard(card.id, card.status, card.diffs, card.before, true);
}

function proposeDirectorPlan(
	options: AssistantProposalToolOptions,
	args: JsonObject,
): string {
	if (options.permission === "read_only") {
		throw new Error(
			"permission_denied：会话权限是 read_only，不能生成待确认动作。",
		);
	}
	if (options.storyId === null) {
		throw new Error("这个技能需要关联故事；当前助手会话没有关联故事");
	}
	rejectUnknownKeys(args, DIRECTOR_PLAN_ARGUMENTS, "参数");
	const plan = parseDirectorPlan(args.plan, "参数.plan");
	let summary: string;
	if (args.summary === undefined) {
		summary = `导演计划：${plan.arcs.map((arc) => arc.title).join("、")}`;
	} else if (typeof args.summary === "string" && args.summary.trim() !== "") {
		summary = args.summary.trim();
	} else {
		throw new Error("参数.summary 必须是非空字符串");
	}
	const action = options.store.createAssistantAction({
		conversationId: options.conversationId,
		kind: "director_plan",
		summary,
		payload: { plan: plan as unknown as JsonObject },
		...(options.now === undefined ? {} : { createdAt: options.now() }),
	});
	return [
		`已生成待确认动作 ${action.id}（${action.kind}，状态 ${action.status}）。`,
		summary,
		"玩家批准后替换当前导演计划；拒绝不改计划。",
	].join("\n");
}

function renderCard(
	id: string,
	status: string,
	diffs: readonly LedgerChangeCardDiff[],
	before: readonly {
		readonly path: readonly string[];
		readonly existed: boolean;
	}[],
	created: boolean,
): string {
	const lines = [
		created
			? `已生成待批准的台账变更卡 ${id}（状态 ${status}）。`
			: `相同内容的台账变更卡已经存在：${id}（状态 ${status}），没有新建卡片。`,
	];
	for (const [index, diff] of diffs.entries()) {
		const beforeText =
			before[index]?.existed === true ? "原来有值" : "原来不存在";
		lines.push(
			`- ${pathLabel(diff.path)}：${diff.op === "delete" ? "删除" : "写入"}（${beforeText}）`,
		);
	}
	lines.push("玩家批准后才写入台账；拒绝不改任何事实。");
	return lines.join("\n");
}

function pathLabel(path: readonly string[]): string {
	return path.map((segment) => JSON.stringify(segment)).join(".");
}

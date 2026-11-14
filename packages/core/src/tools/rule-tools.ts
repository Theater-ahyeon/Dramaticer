import type { JsonObject } from "../json.js";
import { executeRuleCheck } from "../ledger/rules.js";
import { applyDiffEntriesTo } from "../state.js";
import type { StoryStore } from "../store/story-store.js";
import type { AcceptedStateUpdate } from "../structured/types.js";
import type { DeepToolDefinition } from "./registry.js";

export const RULE_CHECK_TOOL_NAME = "rule_check";

const RULE_CHECK_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		ruleId: {
			type: "string",
			minLength: 1,
			description: "卡在 extensions.dramaticer.rules 里声明的规则 id",
		},
	},
	required: ["ruleId"],
	additionalProperties: false,
};

export const RULE_CHECK_TOOL: DeepToolDefinition = {
	name: RULE_CHECK_TOOL_NAME,
	description:
		"由程序执行一次卡声明的检定：掷 d20 并扣掉声明的资源。结果与资源余量登记为本楼层的台账写入，由结算器校验后生效；参数非法、未知规则与资源不足作为工具错误返回。",
	parameters: RULE_CHECK_SCHEMA,
	permission: "propose",
	progressLabel: "执行检定……",
};

/** 执行检定需要的回合信息；不依赖读取工具的其余字段。 */
export interface RuleCheckToolContext {
	readonly store: StoryStore;
	readonly storyId: string;
	/** 当前用户楼层；资源余量取它之前的状态。 */
	readonly beforeNodeId: string;
}

export interface RuleCheckToolOutcome {
	/** 写进工具结果的文字，成功与失败都由这里决定。 */
	readonly content: string;
	/** 待提交的台账写入：资源余量与这次检定的结果。 */
	readonly accepted: readonly AcceptedStateUpdate[];
}

/**
 * 执行 rule_check：未知规则、非法参数与资源不足都抛错，由执行器写成
 * 工具错误；本回合此前的待提交写入先叠加到快照上，同一回合连续检定
 * 不会重复花掉同一份资源。
 */
export function executeRuleCheckTool(
	value: unknown,
	context: RuleCheckToolContext,
	proposed: readonly AcceptedStateUpdate[],
): RuleCheckToolOutcome {
	const ruleId = validateRuleCheckArguments(value);
	const declared = context.store.listStoryRules(context.storyId);
	const rule = declared.find((item) => item.id === ruleId);
	if (rule === undefined) {
		const known =
			declared.length === 0
				? "故事没有声明任何规则"
				: `已声明的规则：${declared.map((item) => item.id).join("、")}`;
		throw new Error(`未知规则：${ruleId}（${known}）`);
	}
	const snapshot = applyDiffEntriesTo(
		context.store.getStateSnapshot(context.beforeNodeId).state,
		proposed,
	);
	const outcome = executeRuleCheck(rule, { snapshot });
	const resource =
		outcome.resource === null
			? ""
			: `；资源 ${outcome.resource.path.join(".")} ${outcome.resource.before} → ${outcome.resource.after}`;
	const content = [
		`规则「${outcome.label}」检定${outcome.success ? "成功" : "失败"}：d20 掷出 ${outcome.roll}，难度 ${outcome.difficulty}，目标 ${outcome.target}${resource}。`,
		"结果与资源余量已登记，由结算器校验后写入台账。",
	].join("");
	return {
		content,
		accepted: outcome.writes.map((write) => ({
			path: write.path,
			op: "set",
			value: write.value,
			reason: null,
			storyTime: null,
			confidence: null,
		})),
	};
}

function validateRuleCheckArguments(value: unknown): string {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("rule_check 的参数必须是 JSON 对象");
	}
	const args = value as JsonObject;
	for (const key of Object.keys(args)) {
		if (key !== "ruleId") {
			throw new Error(`rule_check 不接受参数 ${key}`);
		}
	}
	const ruleId = args.ruleId;
	if (typeof ruleId !== "string" || ruleId.trim().length === 0) {
		throw new Error("rule_check.ruleId 必须是非空字符串");
	}
	return ruleId.trim();
}

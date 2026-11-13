import {
	PROPOSE_DIRECTOR_PLAN_TOOL_NAME,
	PROPOSE_LEDGER_CHANGE_TOOL_NAME,
} from "./proposals.js";
import {
	type AssistantPermission,
	DEFAULT_ASSISTANT_PERMISSION,
} from "./types.js";

/**
 * 一个助手技能：系统提示、工具白名单与默认权限。注册表按 id 查找，
 * 未注册的 id 在创建或修改会话时被拒绝。
 */
export interface AssistantSkillDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	/** 追加在基础系统提示之后；空字符串表示只使用基础提示。 */
	readonly instructions: string;
	/** 本次运行可以使用的工具名；超出的工具不会发给模型。 */
	readonly toolNames: readonly string[];
	readonly defaultPermission: AssistantPermission;
}

export const TROUBLESHOOT_TOOL_NAMES = [
	"explain_node",
	"run_log_read",
	"ledger_read",
	"director_read",
	"memory_search",
	"state_get",
] as const;

export const GUIDE_TOOL_NAMES = [
	"docs_search",
	"settings_read",
	"template_read",
	"plugin_list",
] as const;

export const LEDGER_REVISION_TOOL_NAMES = [
	"ledger_read",
	"state_get",
	"memory_search",
	PROPOSE_LEDGER_CHANGE_TOOL_NAME,
] as const;

export const STRATEGY_TOOL_NAMES = [
	"director_read",
	"ledger_read",
	"memory_search",
	"state_get",
	"summarize_recent",
	PROPOSE_DIRECTOR_PLAN_TOOL_NAME,
] as const;

const TROUBLESHOOT_INSTRUCTIONS = [
	"每条结论必须附证据：楼层 id、Trace 字段、上下文分段 id、检索名次、台账路径或导演机制；指出具体字段与数值，不要只复述结论。",
	"没有运行日志、没有检索记录或没有导演决策时，明确写“没有记录”，并说明查的是哪个楼层或哪个字段。",
	"修正建议只能使用当前会话可用的工具能做到的动作，并写清要改的路径、楼层或设置项；工具做不到的说明需要玩家手动处理。",
].join("\n");

const GUIDE_INSTRUCTIONS = [
	"回答“怎么用”时先用 docs_search 查内置文档，再按命中的段落回答。",
	"引用文档时写出相对路径与标题，例如 DESIGN.md「10.3 应用内助手」或 dev/TASKS.md「H-T04 排障与使用指南技能」。",
	"文档没有写明的内容写“没有记录”，并说明缺的是哪一份文档或哪个标题；不要编造命令、参数或界面位置。",
].join("\n");

const LEDGER_REVISION_INSTRUCTIONS = [
	"先读台账与当前状态，确认要改的路径现在是否存在、旧值是什么，再提议修改。",
	"用 propose_ledger_change 提交：每条修改写清路径、操作与写入值，explanation 说明为什么要改、会改变哪条路径。",
	"delete 只能指向已存在的路径；路径不存在时先确认是不是拼写错误，不要用删除掩盖不存在的路径。",
	"提案只会生成待批准的变更卡，玩家批准后才写入台账；不要声称已经改好。",
].join("\n");

const STRATEGY_INSTRUCTIONS = [
	"先读导演计划、台账与最近摘要，确认当前弧线、序列与拍已经走到哪里，再提出整份计划。",
	"用 propose_director_plan 提交弧线、序列与拍的草案；每个拍都要有观众能观察到的起始迹象与具体契合点。",
	"提案只会生成待确认动作，玩家批准后才替换计划；拒绝时计划保持不变。",
	"不要修改楼层正文，也不要用提案绕过台账变更卡。",
].join("\n");

export const ASSISTANT_SKILLS: readonly AssistantSkillDefinition[] = [
	{
		id: "troubleshoot",
		name: "排障",
		description:
			"解释一个楼层为什么这么写、为什么忘了某件事；读 Trace、上下文分段、检索名次、台账与导演决策，结论带证据。",
		instructions: TROUBLESHOOT_INSTRUCTIONS,
		toolNames: TROUBLESHOOT_TOOL_NAMES,
		defaultPermission: DEFAULT_ASSISTANT_PERMISSION,
	},
	{
		id: "guide",
		name: "使用指南",
		description:
			"回答“怎么用”：检索内置的设计、任务、人类事项与报告文档，引用来源路径与标题。",
		instructions: GUIDE_INSTRUCTIONS,
		toolNames: GUIDE_TOOL_NAMES,
		defaultPermission: DEFAULT_ASSISTANT_PERMISSION,
	},
	{
		id: "ledger_revision",
		name: "台账修订",
		description:
			"把“把某人的好感度改成某值”这类修改要求写成待批准的台账变更卡：先读台账与状态，再逐条提案。",
		instructions: LEDGER_REVISION_INSTRUCTIONS,
		toolNames: LEDGER_REVISION_TOOL_NAMES,
		defaultPermission: DEFAULT_ASSISTANT_PERMISSION,
	},
	{
		id: "strategy",
		name: "参谋",
		description:
			"基于导演计划、台账与摘要提出新的弧线、序列与拍；提案写成待确认的导演计划动作。",
		instructions: STRATEGY_INSTRUCTIONS,
		toolNames: STRATEGY_TOOL_NAMES,
		defaultPermission: DEFAULT_ASSISTANT_PERMISSION,
	},
];

const SKILLS_BY_ID: Readonly<Record<string, AssistantSkillDefinition>> =
	Object.fromEntries(ASSISTANT_SKILLS.map((skill) => [skill.id, skill]));

export function listAssistantSkills(): readonly AssistantSkillDefinition[] {
	return ASSISTANT_SKILLS;
}

/** 未注册时返回 null；调用方决定拒绝方式。 */
export function getAssistantSkill(id: string): AssistantSkillDefinition | null {
	return Object.hasOwn(SKILLS_BY_ID, id) ? (SKILLS_BY_ID[id] ?? null) : null;
}

/** 取已注册技能；未注册时抛错并指出 id。 */
export function requireAssistantSkill(id: string): AssistantSkillDefinition {
	const skill = getAssistantSkill(id);
	if (skill === null) {
		throw new Error(`助手技能未注册：${id}`);
	}
	return skill;
}

export function isAssistantSkillRegistered(id: unknown): boolean {
	return typeof id === "string" && Object.hasOwn(SKILLS_BY_ID, id);
}

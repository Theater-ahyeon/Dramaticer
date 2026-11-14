import type { StWorldInfoEntry } from "./world-info.js";

/** 世界书条目按运行时行为分型的结果（DESIGN §20.1）。 */
export type WorldbookEntryKind =
	| "common"
	| "entity"
	| "rule"
	| "state"
	| "conditional"
	| "event"
	| "writing"
	| "presentation"
	| "options"
	| "plugin-residue"
	| "unknown";

/** 类型的固定顺序；输出的条目与计数字段都按这个顺序排列。 */
export const WORLDBOOK_ENTRY_KINDS: readonly WorldbookEntryKind[] = [
	"common",
	"entity",
	"rule",
	"state",
	"conditional",
	"event",
	"writing",
	"presentation",
	"options",
	"plugin-residue",
	"unknown",
];

export interface WorldbookEntryMatch {
	readonly kind: WorldbookEntryKind;
	/** 命中的规则 id，按规则表顺序排列。 */
	readonly rules: readonly string[];
}

export interface ClassifiedWorldbookEntry {
	readonly sourceKey: string;
	/** 条目标题（酒馆的 `comment`），没有标题时为空串。 */
	readonly title: string;
	/**
	 * 命中的类型与依据。没有任何规则命中时只有一条 `unknown`，
	 * 依据为 `no-rule`；未知条目不会被丢掉。
	 */
	readonly matches: readonly WorldbookEntryMatch[];
	readonly primaryKind: WorldbookEntryKind;
	/** 命中两个及以上非 `unknown` 类型（混合条目，原文不拆）。 */
	readonly mixed: boolean;
}

export interface WorldbookClassification {
	readonly entries: readonly ClassifiedWorldbookEntry[];
	/**
	 * 每个类型命中的条目数。一个条目可以计入多个类型，
	 * 所以各项之和等于命中次数，不一定是条目总数。
	 */
	readonly counts: Readonly<Record<WorldbookEntryKind, number>>;
}

interface ClassifierInput {
	readonly title: string;
	readonly content: string;
	readonly keys: readonly string[];
	readonly constant: boolean;
}

interface WorldbookRule {
	readonly id: string;
	readonly kind: Exclude<WorldbookEntryKind, "unknown">;
	readonly test: (input: ClassifierInput) => boolean;
}

const NAME_LINE_LIMIT = 30;
const NAME_LENGTH_LIMIT = 16;
const SHORT_CONSTANT_LIMIT = 160;
const KEYED_DESCRIPTION_LIMIT = 600;

const NAME_PUNCTUATION = /[，。！？；：、,.;:!?]/;
const NUMERIC_TOKEN = /[\d=+\-*/×÷]/;

const PROFILE_FIELD_PATTERNS = [
	"姓名",
	"性别",
	"年龄",
	"外貌",
	"性格",
	"身份",
	"职业",
	"所属",
	"所在地",
	"位置",
	"能力",
].map((field) => new RegExp(`${field}\\s*[:：]`));

function isEjsConditional(content: string): boolean {
	if (!/<%[\s\S]*%(>|$)/.test(content)) return false;
	if (!/(?:getvar|getVariable|getMessageVar)/.test(content)) return false;
	return /\bif\b|\bswitch\b|\?/.test(content);
}

function isNameList(input: ClassifierInput): boolean {
	const lines = input.content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0 || lines.length > NAME_LINE_LIMIT) return false;
	if (
		lines.some(
			(line) => line.length > NAME_LENGTH_LIMIT || NAME_PUNCTUATION.test(line),
		)
	) {
		return false;
	}
	if (lines.length > 1) return true;
	return !NUMERIC_TOKEN.test(lines[0] ?? "");
}

function equalsTitleOrKey(input: ClassifierInput): boolean {
	const content = input.content.trim().toLowerCase();
	const title = input.title.trim().toLowerCase();
	if (content.length === 0) return false;
	if (title.length > 0 && content === title) return true;
	return input.keys.some((key) => key.trim().toLowerCase() === content);
}

const RULES: readonly WorldbookRule[] = [
	// 常识
	{
		id: "title:common",
		kind: "common",
		test: (input) =>
			/世界观|世界设定|世界背景|背景设定|故事背景|常识|总览|简介|核心设定|设定总览|世界概述/.test(
				input.title,
			),
	},
	{
		id: "content:worldview",
		kind: "common",
		test: (input) =>
			/(?:这是一个|本世界|世界观|世界背景|世界设定|世界常识)/.test(
				input.content,
			),
	},
	// 实体档案
	{
		id: "title:entity",
		kind: "entity",
		test: (input) =>
			/人物|角色|地点|势力|组织|物品|种族|神明|宗门|城市|国家|地名|实体档案/.test(
				input.title,
			),
	},
	{
		id: "content:profile-fields",
		kind: "entity",
		test: (input) =>
			PROFILE_FIELD_PATTERNS.filter((pattern) => pattern.test(input.content))
				.length >= 2,
	},
	// 规则
	{
		id: "title:rule",
		kind: "rule",
		test: (input) =>
			/规则|检定|判定|战斗|境界|玩法|声望|机制|系统设定|数值设定|属性规则/.test(
				input.title,
			),
	},
	{
		id: "content:check",
		kind: "rule",
		test: (input) =>
			/(?:检定|判定|掷骰|[dD]\d{1,3}|难度|目标值|成功值)/.test(input.content),
	},
	{
		id: "content:resource",
		kind: "rule",
		test: (input) =>
			/(?:资源|消耗|扣减|花费)[^。\n]{0,12}(?:点|格|个|层|%)/.test(
				input.content,
			),
	},
	{
		id: "content:formula",
		kind: "rule",
		test: (input) =>
			/(?:攻击力|防御力|生命值|法力值|HP|MP|伤害)[^。\n]{0,12}[=:：]/.test(
				input.content,
			),
	},
	{
		id: "content:rank",
		kind: "rule",
		test: (input) =>
			/(?:境界|品阶|等级)[^。\n]{0,10}(?:分为|划分|从低到高|依次)/.test(
				input.content,
			),
	},
	// 状态定义
	{
		id: "title:state",
		kind: "state",
		test: (input) =>
			/变量|状态定义|状态表|初始值|更新规则|变量列表|属性表|数值定义|初始设定/.test(
				input.title,
			),
	},
	{
		id: "content:mvu",
		kind: "state",
		test: (input) =>
			/\[InitVar\]|UpdateVariable|_.set\(|_.add\(|initvar|变量更新|更新变量|初始变量|变量声明|变量规则/.test(
				input.content,
			),
	},
	{
		id: "content:state-table",
		kind: "state",
		test: (input) =>
			/[|｜]/.test(input.content) &&
			/(?:变量|属性|数值)/.test(input.content) &&
			/(?:初始值|默认值|当前值)/.test(input.content),
	},
	// 条件内容
	{
		id: "title:conditional",
		kind: "conditional",
		test: (input) => /条件|阶段|触发条件|分支设定/.test(input.title),
	},
	{
		id: "content:ejs-conditional",
		kind: "conditional",
		test: (input) => isEjsConditional(input.content),
	},
	{
		id: "content:condition-phrase",
		kind: "conditional",
		test: (input) =>
			/(?:仅在|只有在|生效条件|满足条件|条件[:：])/.test(input.content),
	},
	// 事件与舞台
	{
		id: "title:event",
		kind: "event",
		test: (input) =>
			/事件|章节|舞台|剧情|时间线|主线|支线|任务|委托|日程/.test(input.title),
	},
	{
		id: "content:chapter",
		kind: "event",
		test: (input) =>
			/(?:本章|下一章|章节舞台|时间线|剧情线|事件列表|随机事件|剧情推进)/.test(
				input.content,
			),
	},
	// 写作指令
	{
		id: "title:writing",
		kind: "writing",
		test: (input) =>
			/写作|文风|指令|元指令|思维链|格式要求|系统提示|提示词|写作要求|输出要求|正文要求|叙事/.test(
				input.title,
			),
	},
	{
		id: "content:writing-rule",
		kind: "writing",
		test: (input) =>
			/(?:文风|思维链|思维过程|输出格式|正文格式|字数要求|人称|禁止出现|不要出现|回复要求|写作要求|叙事视角)/.test(
				input.content,
			),
	},
	// 表现资源
	{
		id: "title:presentation",
		kind: "presentation",
		test: (input) =>
			/状态栏|界面|样式|插画|立绘|背景音乐|BGM|音乐|图片|资源表|表情|CG|贴图|UI/.test(
				input.title,
			),
	},
	{
		id: "content:markup",
		kind: "presentation",
		test: (input) =>
			/<(?:style|div|span|img|audio|video|svg|table)\b/i.test(input.content),
	},
	{
		id: "content:asset",
		kind: "presentation",
		test: (input) =>
			/!\[[^\]]*\]\(|https?:\/\/\S+\.(?:png|jpe?g|webp|gif|mp3|ogg|wav)\b/i.test(
				input.content,
			),
	},
	// 作者选项
	{
		id: "title:options",
		kind: "options",
		test: (input) =>
			/选项|可选|扩展|难度选择|模式|开局选择|作者选项|设置面板/.test(
				input.title,
			),
	},
	{
		id: "content:options",
		kind: "options",
		test: (input) =>
			/(?:以下选项|选择一种|可选模式|难度模式|开局选项|选项如下|模式选择)/.test(
				input.content,
			),
	},
	// 插件残留
	{
		id: "title:plugin-residue",
		kind: "plugin-residue",
		test: (input) =>
			/表格|总结|摘要记录|历史记录|记忆栏|统计|变量输出|记录表/.test(
				input.title,
			),
	},
	{
		id: "content:table",
		kind: "plugin-residue",
		test: (input) =>
			/<table\b/i.test(input.content) || /\|\s*-{3,}\s*\|/.test(input.content),
	},
	{
		id: "content:summary",
		kind: "plugin-residue",
		test: (input) =>
			/(?:前情提要|剧情总结|本轮总结|目前为止|到此为止的剧情|已发生的事件[:：])/.test(
				input.content,
			),
	},
];

function fallbackMatch(input: ClassifierInput): WorldbookEntryMatch | null {
	const content = input.content.trim();
	if (content.length === 0) return { kind: "entity", rules: ["content:empty"] };
	if (equalsTitleOrKey(input)) {
		return { kind: "entity", rules: ["content:name-only"] };
	}
	if (isNameList(input))
		return { kind: "entity", rules: ["content:name-list"] };
	if (input.constant && content.length <= SHORT_CONSTANT_LIMIT) {
		return { kind: "common", rules: ["structure:short-constant"] };
	}
	if (input.keys.length > 0 && content.length <= KEYED_DESCRIPTION_LIMIT) {
		return { kind: "entity", rules: ["structure:keyed"] };
	}
	return null;
}

/** 分型单条世界书条目。纯函数：不读磁盘、不调用模型、不修改入参。 */
export function classifyWorldbookEntry(
	entry: StWorldInfoEntry,
): ClassifiedWorldbookEntry {
	const input: ClassifierInput = {
		title: entry.comment.trim(),
		content: entry.content,
		keys: entry.keys,
		constant: entry.constant,
	};
	const rulesByKind = new Map<
		Exclude<WorldbookEntryKind, "unknown">,
		string[]
	>();
	for (const rule of RULES) {
		if (!rule.test(input)) continue;
		const rules = rulesByKind.get(rule.kind);
		if (rules === undefined) rulesByKind.set(rule.kind, [rule.id]);
		else rules.push(rule.id);
	}
	const matches: WorldbookEntryMatch[] = [];
	for (const kind of WORLDBOOK_ENTRY_KINDS) {
		if (kind === "unknown") continue;
		const rules = rulesByKind.get(kind);
		if (rules !== undefined) matches.push({ kind, rules });
	}
	if (matches.length === 0) {
		matches.push(
			fallbackMatch(input) ?? { kind: "unknown", rules: ["no-rule"] },
		);
	}
	return {
		sourceKey: entry.sourceKey,
		title: input.title,
		matches,
		primaryKind: matches[0]?.kind ?? "unknown",
		mixed: matches.filter((match) => match.kind !== "unknown").length > 1,
	};
}

/**
 * 把世界书条目按运行时行为分型（DESIGN §20.1）。只给出类型与依据，
 * 不拆分、不改写条目原文；条目的最终去向由导入体检决定。
 */
export function classifyWorldbookEntries(
	entries: readonly StWorldInfoEntry[],
): WorldbookClassification {
	const classified = entries.map(classifyWorldbookEntry);
	const counts = Object.fromEntries(
		WORLDBOOK_ENTRY_KINDS.map((kind) => [kind, 0]),
	) as Record<WorldbookEntryKind, number>;
	for (const entry of classified) {
		for (const match of entry.matches) counts[match.kind] += 1;
	}
	return { entries: classified, counts };
}

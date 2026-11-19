import {
	type BlueprintEntry,
	assertBlueprintEntries,
} from "../blueprint/story-blueprint.js";
import { normalizeEntityName } from "../entity.js";
import { assertPlainObject, isJsonObject, rejectUnknownKeys } from "../json.js";
import {
	type DramaticerRuleDeclaration,
	parseDramaticerRuleDeclarations,
} from "../ledger/rules.js";
import {
	type DeclarativePlugin,
	type DeclarativeRequirements,
	parseDeclarativePlugins,
	parseDeclarativeRequirements,
} from "../plugins/declarative.js";
import { type DirectorBit, parseDirectorBitDefinitions } from "./bits.js";
import {
	type DramaticerEventDefinition,
	parseDramaticerEventDefinitions,
} from "./event-definition.js";
import { type DirectorArc, parseDirectorPlan } from "./plan.js";

export interface DramaticerNpcAgendaDefinition {
	/** NPC 的名称或别名，导入时解析成实体。 */
	readonly npc: string;
	readonly goal: string;
	readonly everyChapters: number;
	readonly importance: number;
}

export interface DramaticerCardExtension {
	readonly events: readonly DramaticerEventDefinition[];
	/** 导演组织方式 bits 使用的小品；只在导入时校验并保存。 */
	readonly bits: readonly DirectorBit[];
	readonly npcAgendas: readonly DramaticerNpcAgendaDefinition[];
	/** 弧线、序列与节拍，字段与 `DirectorPlan` 相同。 */
	readonly arcs: readonly DirectorArc[];
	/** 卡声明的检定与资源扣减；没有声明时不开放检定工具。 */
	readonly rules: readonly DramaticerRuleDeclaration[];
	/** 卡片随附的声明式插件；导入时与依赖声明一起展示。 */
	readonly plugins: readonly DeclarativePlugin[];
	/** 缺少时导入流程必须提示安装的插件与玩法包。 */
	readonly requires: DeclarativeRequirements;
	/** 建议安装但不影响使用的插件与玩法包。 */
	readonly recommends: DeclarativeRequirements;
	/**
	 * 卡的推荐配置：写作选项、写法、功能档位与开关。载入时应用，
	 * 玩家的调整叠在上面；内容在使用处逐项校验，不认识的字段忽略。
	 */
	readonly config?: Readonly<Record<string, unknown>> | null;
	/** 随卡带的默认蓝图；导入后成为故事级起点，楼层上的修改累加在它之上。 */
	readonly blueprint: readonly BlueprintEntry[];
}

const EMPTY_EXTENSION: DramaticerCardExtension = {
	events: [],
	bits: [],
	npcAgendas: [],
	arcs: [],
	rules: [],
	plugins: [],
	requires: { plugins: [], playpacks: [] },
	recommends: { plugins: [], playpacks: [] },
	blueprint: [],
};

const AGENDA_KEYS = ["npc", "goal", "everyChapters", "importance"];

/**
 * 解析卡的 `extensions.dramaticer`。没有这个字段时返回空扩展；有了就必须完全合法，
 * 未知字段、类型不符、空字符串、非法条件与重复 id 都抛错。
 */
export function parseDramaticerCardExtension(
	value: unknown,
): DramaticerCardExtension {
	if (value === undefined || value === null) return EMPTY_EXTENSION;
	const root = assertPlainObject(value, "extensions.dramaticer");
	rejectUnknownKeys(
		root,
		[
			"events",
			"bits",
			"npcAgendas",
			"arcs",
			"rules",
			"plugins",
			"requires",
			"recommends",
			"blueprint",
			"config",
		],
		"extensions.dramaticer",
	);

	const events = parseDramaticerEventDefinitions(
		root.events,
		"extensions.dramaticer.events",
	);
	const bits = parseDirectorBitDefinitions(
		root.bits,
		"extensions.dramaticer.bits",
	);
	const npcAgendas = parseArray(
		root.npcAgendas,
		"extensions.dramaticer.npcAgendas",
		(item, path) => parseAgenda(item, path),
	);
	const { arcs } = parseDirectorPlan(
		{ arcs: root.arcs ?? [] },
		"extensions.dramaticer",
	);
	const rules = parseDramaticerRuleDeclarations(
		root.rules,
		"extensions.dramaticer.rules",
	);
	const plugins = parseDeclarativePlugins(
		root.plugins,
		"extensions.dramaticer.plugins",
	);
	const requires = parseDeclarativeRequirements(
		root.requires,
		"extensions.dramaticer.requires",
	);
	const recommends = parseDeclarativeRequirements(
		root.recommends,
		"extensions.dramaticer.recommends",
	);
	const blueprint = assertBlueprintEntries(
		root.blueprint ?? [],
		"extensions.dramaticer.blueprint",
	);
	return {
		events,
		bits,
		npcAgendas,
		arcs,
		rules,
		plugins,
		requires,
		recommends,
		blueprint,
		config: isJsonObject(root.config) ? root.config : null,
	};
}

function parseArray<T>(
	value: unknown,
	path: string,
	parseItem: (item: unknown, path: string) => T,
): T[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	return value.map((item, index) => parseItem(item, `${path}[${index}]`));
}

function parseAgenda(
	value: unknown,
	path: string,
): DramaticerNpcAgendaDefinition {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, AGENDA_KEYS, path);
	const npc = readNonEmptyString(object.npc, `${path}.npc`);
	if (normalizeEntityName(npc).length === 0) {
		throw new Error(`${path}.npc 去掉标点与空白后为空`);
	}
	const goal = readNonEmptyString(object.goal, `${path}.goal`);
	const everyChapters = object.everyChapters ?? 1;
	if (
		typeof everyChapters !== "number" ||
		!Number.isInteger(everyChapters) ||
		everyChapters < 1
	) {
		throw new Error(`${path}.everyChapters 必须是正整数`);
	}
	const importance = object.importance ?? 0.5;
	if (
		typeof importance !== "number" ||
		!Number.isFinite(importance) ||
		importance < 0 ||
		importance > 1
	) {
		throw new Error(`${path}.importance 必须是 0 到 1 之间的数字`);
	}
	return {
		npc,
		goal,
		everyChapters: everyChapters as number,
		importance,
	};
}

function readNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new Error(`${path} 必须是字符串`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${path} 不能是空字符串`);
	}
	return trimmed;
}

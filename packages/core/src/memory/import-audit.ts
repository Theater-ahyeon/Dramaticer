/**
 * 导入分型：条目按运行时行为分流的结果（DESIGN §20.1）。
 * 词汇属于运行时，不属于任何内容格式；转换层负责判定，原生层按类型决定注入方式。
 */
export type ImportEntryKind =
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

/** 类型的固定顺序；接口与计数都按这个顺序排列。 */
export const IMPORT_ENTRY_KINDS: readonly ImportEntryKind[] = [
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

export const IMPORT_ENTRY_KIND_SOURCES = ["rule", "model", "player"] as const;

/** 类型的来源：程序规则、后台模型建议、玩家手动指定。 */
export type ImportEntryKindSource = (typeof IMPORT_ENTRY_KIND_SOURCES)[number];

export interface ImportEntryMatch {
	readonly kind: ImportEntryKind;
	/** 命中的规则 id；分型器只输出规则命中 */
	readonly rules: readonly string[];
}

/** 一条导入条目的分型结果；原始条目正文单独保存，分型不拆分也不改写它。 */
export interface ImportAuditEntry {
	readonly storyId: string;
	/** 与 lore 条目相同的来源标记；没有导入成 lore 的条目也有一条 */
	readonly source: string;
	readonly title: string;
	readonly content: string;
	readonly matches: readonly ImportEntryMatch[];
	/** 程序规则判定的首要类型 */
	readonly rulePrimary: ImportEntryKind;
	/** 生效的类型；玩家或模型改过时与 `rulePrimary` 不同 */
	readonly kind: ImportEntryKind;
	readonly kindSource: ImportEntryKindSource;
	/** 导入时的条目是否常驻；重复导入会更新，玩家转换初始记忆不回写这一列 */
	readonly constant: boolean;
	/** 已转为初始记忆：不进入每轮的常驻集合，只在命中时按记忆注入 */
	readonly memory: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** 世界书槽位判断注入方式只需要三个字段；逐轮读取不解析命中的规则。 */
export interface ImportAuditInjectionRule {
	readonly source: string;
	readonly kind: ImportEntryKind;
	readonly memory: boolean;
}

export interface NewImportAuditEntry {
	readonly source: string;
	readonly title: string;
	readonly content: string;
	readonly matches: readonly ImportEntryMatch[];
	readonly rulePrimary: ImportEntryKind;
	readonly constant: boolean;
	readonly createdAt?: string;
}

export function isImportEntryKind(value: unknown): value is ImportEntryKind {
	return (
		typeof value === "string" &&
		(IMPORT_ENTRY_KINDS as readonly string[]).includes(value)
	);
}

export function assertImportEntryKind(
	value: unknown,
	label = "导入分型的类型",
): ImportEntryKind {
	if (!isImportEntryKind(value)) {
		throw new Error(`${label}不合法：${String(value)}`);
	}
	return value;
}

export function isImportEntryKindSource(
	value: unknown,
): value is ImportEntryKindSource {
	return (
		typeof value === "string" &&
		(IMPORT_ENTRY_KIND_SOURCES as readonly string[]).includes(value)
	);
}

export function assertImportEntryKindSource(
	value: unknown,
	label = "导入分型的类型来源",
): ImportEntryKindSource {
	if (!isImportEntryKindSource(value)) {
		throw new Error(`${label}不合法：${String(value)}`);
	}
	return value;
}

/** 校验命中的类型与依据：类型不重复，`unknown` 不能与其他类型并列。 */
export function assertImportEntryMatches(
	value: unknown,
	label = "导入分型的命中类型",
): readonly ImportEntryMatch[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label}必须是非空数组`);
	}
	const seen = new Set<ImportEntryKind>();
	const matches: ImportEntryMatch[] = [];
	for (const [index, item] of value.entries()) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new Error(`${label}[${index}] 必须是对象`);
		}
		const record = item as Record<string, unknown>;
		const kind = assertImportEntryKind(record.kind, `${label}[${index}].kind`);
		if (seen.has(kind)) {
			throw new Error(`${label} 里重复出现类型 ${kind}`);
		}
		seen.add(kind);
		const rules = record.rules;
		if (!Array.isArray(rules)) {
			throw new Error(`${label}[${index}].rules 必须是字符串数组`);
		}
		const ruleIds = rules.map((rule, ruleIndex) => {
			if (typeof rule !== "string" || rule.length === 0) {
				throw new Error(
					`${label}[${index}].rules[${ruleIndex}] 必须是非空字符串`,
				);
			}
			return rule;
		});
		matches.push({ kind, rules: ruleIds });
	}
	if (seen.has("unknown") && matches.length > 1) {
		throw new Error(`${label} 里的 unknown 不能与其他类型并列`);
	}
	return matches;
}

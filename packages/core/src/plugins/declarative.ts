import {
	type BlockContextStrategy,
	type BlockDisplayStrategy,
	assertBlockContextStrategy,
} from "../blocks/types.js";
import { parseContextCondition } from "../context/condition.js";
import { isContextSlotName } from "../context/slot-names.js";
import {
	type ContextCondition,
	type ContextSegment,
	type ContextTemplate,
	type ContextTemplateDeepTurn,
	assertContextTemplate,
	assertContextTemplateDeepTurn,
} from "../context/template.js";
import { assertDirectorConfig } from "../director/evaluate.js";
import {
	type DramaticerEventDefinition,
	parseDramaticerEventDefinitions,
} from "../director/event-definition.js";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorConfig,
} from "../director/types.js";
import {
	assertJsonValue,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import { type LedgerNamespace, isLedgerNamespace } from "../ledger/schema.js";

/** 声明式插件的格式标识；卡片打包与独立文件都使用同一个外壳。 */
export const DECLARATIVE_PLUGIN_FORMAT = "dramaticer.plugin";

/**
 * 当前唯一支持的格式版本。同一个版本号覆盖全部类型，类型扩展时整体升版，
 * 解析器遇到不认识的版本直接拒绝，不猜测兼容性。
 */
export const DECLARATIVE_PLUGIN_FORMAT_VERSION = 1;

export const DECLARATIVE_PLUGIN_KINDS = [
	"ledger-schema",
	"plot-beat",
	"context-template",
	"block-renderer",
	"skill",
	"director-config",
	"event-pool",
] as const;

export type DeclarativePluginKind = (typeof DECLARATIVE_PLUGIN_KINDS)[number];

export const LEDGER_FIELD_TYPES = [
	"string",
	"number",
	"integer",
	"boolean",
	"enum",
	"string-array",
] as const;

export type LedgerFieldType = (typeof LEDGER_FIELD_TYPES)[number];

/** 字段约束只描述值本身；写入仍然经过结算器的 `validateLedgerDiff`。 */
export interface LedgerFieldSchema {
	/** 相对命名空间的路径段，例如 `["境界"]`。 */
	readonly path: readonly string[];
	readonly type: LedgerFieldType;
	/** `enum` 必须提供，其余类型不许出现。 */
	readonly values?: readonly string[];
	/** `number` 与 `integer` 可用。 */
	readonly min?: number;
	readonly max?: number;
	/** `string` 可用，按码点计数。 */
	readonly maxLength?: number;
}

export interface LedgerSchemaPayload {
	readonly namespace: LedgerNamespace;
	readonly fields: readonly LedgerFieldSchema[];
}

export interface PlotBeatPayload {
	readonly id: string;
	readonly title: string;
	readonly text: string;
	readonly preconditions: ContextCondition | null;
}

export interface BlockRendererPayload {
	/** 标签名，例如 `状态栏`。 */
	readonly block: string;
	readonly display: BlockDisplayStrategy;
	readonly context: BlockContextStrategy;
}

export interface SkillPayload {
	readonly name: string;
	readonly description: string;
	/** `SKILL.md` 的正文，按原文保存。 */
	readonly content: string;
}

export interface DirectorConfigPayload {
	/** 相对默认导演配置的覆盖项；未出现的字段沿用默认值。 */
	readonly config: Partial<DirectorConfig>;
}

export interface EventPoolPayload {
	readonly events: readonly DramaticerEventDefinition[];
}

interface DeclarativePluginBase {
	readonly format: typeof DECLARATIVE_PLUGIN_FORMAT;
	readonly formatVersion: typeof DECLARATIVE_PLUGIN_FORMAT_VERSION;
	readonly name: string;
	/** 插件自身版本，形如 `1.2.3` 或 `1.2.3-beta.1`。 */
	readonly version: string;
	readonly title?: string;
	readonly description?: string;
}

export interface LedgerSchemaPlugin extends DeclarativePluginBase {
	readonly kind: "ledger-schema";
	readonly payload: LedgerSchemaPayload;
}

export interface PlotBeatPlugin extends DeclarativePluginBase {
	readonly kind: "plot-beat";
	readonly payload: PlotBeatPayload;
}

export interface ContextTemplatePlugin extends DeclarativePluginBase {
	readonly kind: "context-template";
	readonly payload: ContextTemplate;
}

export interface BlockRendererPlugin extends DeclarativePluginBase {
	readonly kind: "block-renderer";
	readonly payload: BlockRendererPayload;
}

export interface SkillPlugin extends DeclarativePluginBase {
	readonly kind: "skill";
	readonly payload: SkillPayload;
}

export interface DirectorConfigPlugin extends DeclarativePluginBase {
	readonly kind: "director-config";
	readonly payload: DirectorConfigPayload;
}

export interface EventPoolPlugin extends DeclarativePluginBase {
	readonly kind: "event-pool";
	readonly payload: EventPoolPayload;
}

export type DeclarativePlugin =
	| LedgerSchemaPlugin
	| PlotBeatPlugin
	| ContextTemplatePlugin
	| BlockRendererPlugin
	| SkillPlugin
	| DirectorConfigPlugin
	| EventPoolPlugin;

/** 卡片声明的一条例外依赖；`versionRange` 只做语法检查，匹配留给安装流程。 */
export interface DeclarativeDependency {
	readonly name: string;
	readonly versionRange?: string;
}

export interface DeclarativeRequirements {
	readonly plugins: readonly DeclarativeDependency[];
	readonly playpacks: readonly DeclarativeDependency[];
}

const PLUGIN_KEYS = [
	"format",
	"formatVersion",
	"name",
	"version",
	"kind",
	"title",
	"description",
	"payload",
];
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const BLOCK_NAME_PATTERN = /[<>/\s]/;

/**
 * 解析一个声明式插件。输入先按 JSON 值校验，因此函数、类实例与其他
 * 可执行内容无法通过；随后按 `kind` 走对应类型的严格 schema。
 */
export function parseDeclarativePlugin(
	value: unknown,
	path = "declarativePlugin",
): DeclarativePlugin {
	assertJsonValue(value, path);
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, PLUGIN_KEYS, path);
	if (object.format !== DECLARATIVE_PLUGIN_FORMAT) {
		throw new Error(`${path}.format 必须是 ${DECLARATIVE_PLUGIN_FORMAT}`);
	}
	if (object.formatVersion !== DECLARATIVE_PLUGIN_FORMAT_VERSION) {
		throw new Error(
			`${path}.formatVersion 只支持 ${DECLARATIVE_PLUGIN_FORMAT_VERSION}`,
		);
	}
	const name = readPluginName(object.name, `${path}.name`);
	const version = readPluginVersion(object.version, `${path}.version`);
	const title =
		object.title === undefined
			? undefined
			: readNonEmptyString(object.title, `${path}.title`);
	const description =
		object.description === undefined
			? undefined
			: readNonEmptyString(object.description, `${path}.description`);
	const kind = object.kind;
	if (
		typeof kind !== "string" ||
		!(DECLARATIVE_PLUGIN_KINDS as readonly string[]).includes(kind)
	) {
		throw new Error(
			`${path}.kind 必须是 ${DECLARATIVE_PLUGIN_KINDS.join("、")} 之一`,
		);
	}
	if (!Object.hasOwn(object, "payload")) {
		throw new Error(`${path}.payload 必须提供`);
	}
	const payloadPath = `${path}.payload`;
	const base = {
		format: DECLARATIVE_PLUGIN_FORMAT,
		formatVersion: DECLARATIVE_PLUGIN_FORMAT_VERSION,
		name,
		version,
		...(title === undefined ? {} : { title }),
		...(description === undefined ? {} : { description }),
	} as const;
	switch (kind as DeclarativePluginKind) {
		case "ledger-schema":
			return {
				...base,
				kind: "ledger-schema",
				payload: parseLedgerSchemaPayload(object.payload, payloadPath),
			};
		case "plot-beat":
			return {
				...base,
				kind: "plot-beat",
				payload: parsePlotBeatPayload(object.payload, payloadPath),
			};
		case "context-template":
			return {
				...base,
				kind: "context-template",
				payload: parseContextTemplatePayload(object.payload, payloadPath),
			};
		case "block-renderer":
			return {
				...base,
				kind: "block-renderer",
				payload: parseBlockRendererPayload(object.payload, payloadPath),
			};
		case "skill":
			return {
				...base,
				kind: "skill",
				payload: parseSkillPayload(object.payload, payloadPath),
			};
		case "director-config":
			return {
				...base,
				kind: "director-config",
				payload: parseDirectorConfigPayload(object.payload, payloadPath),
			};
		case "event-pool":
			return {
				...base,
				kind: "event-pool",
				payload: parseEventPoolPayload(object.payload, payloadPath),
			};
	}
}

/** 解析一组插件；名字重复时整组拒绝，避免后加载的静默覆盖前一个。 */
export function parseDeclarativePlugins(
	value: unknown,
	path = "declarativePlugins",
): DeclarativePlugin[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const names = new Set<string>();
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const plugin = parseDeclarativePlugin(item, itemPath);
		if (names.has(plugin.name)) {
			throw new Error(`${itemPath}.name 重复：${plugin.name}`);
		}
		names.add(plugin.name);
		return plugin;
	});
}

/** 解析卡片的插件与玩法包声明；`undefined` 表示没有声明。 */
export function parseDeclarativeRequirements(
	value: unknown,
	path = "requirements",
): DeclarativeRequirements {
	if (value === undefined || value === null) return EMPTY_REQUIREMENTS;
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ["plugins", "playpacks"], path);
	return {
		plugins: parseDependencyList(object.plugins, `${path}.plugins`),
		playpacks: parseDependencyList(object.playpacks, `${path}.playpacks`),
	};
}

const EMPTY_REQUIREMENTS: DeclarativeRequirements = {
	plugins: [],
	playpacks: [],
};

function parseDependencyList(
	value: unknown,
	path: string,
): DeclarativeDependency[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${path} 必须是数组`);
	}
	const names = new Set<string>();
	return value.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const object = assertPlainObject(item, itemPath);
		rejectUnknownKeys(object, ["name", "versionRange"], itemPath);
		const name = readPluginName(object.name, `${itemPath}.name`);
		const versionRange =
			object.versionRange === undefined
				? undefined
				: readNonEmptyString(object.versionRange, `${itemPath}.versionRange`);
		if (names.has(name)) {
			throw new Error(`${itemPath}.name 重复：${name}`);
		}
		names.add(name);
		return versionRange === undefined ? { name } : { name, versionRange };
	});
}

function parseLedgerSchemaPayload(
	value: unknown,
	path: string,
): LedgerSchemaPayload {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ["namespace", "fields"], path);
	const namespace = object.namespace;
	if (typeof namespace !== "string" || !isLedgerNamespace(namespace)) {
		throw new Error(
			`${path}.namespace 不是已知台账命名空间：${String(namespace)}`,
		);
	}
	if (!Array.isArray(object.fields) || object.fields.length === 0) {
		throw new Error(`${path}.fields 必须是非空数组`);
	}
	const paths = new Set<string>();
	const fields = object.fields.map((item, index) => {
		const fieldPath = `${path}.fields[${index}]`;
		const field = parseLedgerField(item, fieldPath);
		const key = JSON.stringify(field.path);
		if (paths.has(key)) {
			throw new Error(`${fieldPath}.path 重复：${field.path.join(" / ")}`);
		}
		paths.add(key);
		return field;
	});
	return { namespace, fields };
}

function parseLedgerField(value: unknown, path: string): LedgerFieldSchema {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(
		object,
		["path", "type", "values", "min", "max", "maxLength"],
		path,
	);
	if (!Array.isArray(object.path) || object.path.length === 0) {
		throw new Error(`${path}.path 必须是非空字符串数组`);
	}
	const fieldPath = object.path.map((segment, index) => {
		if (typeof segment !== "string" || segment.trim().length === 0) {
			throw new Error(`${path}.path[${index}] 必须是非空字符串`);
		}
		return segment;
	});
	const type = object.type;
	if (
		typeof type !== "string" ||
		!(LEDGER_FIELD_TYPES as readonly string[]).includes(type)
	) {
		throw new Error(
			`${path}.type 必须是 ${LEDGER_FIELD_TYPES.join("、")} 之一`,
		);
	}
	const fieldType = type as LedgerFieldType;
	const has = (key: string) => Object.hasOwn(object, key);
	switch (fieldType) {
		case "enum": {
			if (has("min") || has("max") || has("maxLength")) {
				throw new Error(`${path} 的 enum 字段只允许 values`);
			}
			if (!Array.isArray(object.values) || object.values.length === 0) {
				throw new Error(`${path}.values 必须是非空数组`);
			}
			const values = object.values.map((item, index) => {
				if (typeof item !== "string" || item.trim().length === 0) {
					throw new Error(`${path}.values[${index}] 必须是非空字符串`);
				}
				return item;
			});
			if (new Set(values).size !== values.length) {
				throw new Error(`${path}.values 不能重复`);
			}
			return { path: fieldPath, type: fieldType, values };
		}
		case "number":
		case "integer": {
			if (has("values") || has("maxLength")) {
				throw new Error(`${path} 的数值字段不允许 values 或 maxLength`);
			}
			const min = readOptionalNumber(object.min, `${path}.min`);
			const max = readOptionalNumber(object.max, `${path}.max`);
			if (min !== undefined && max !== undefined && min > max) {
				throw new Error(`${path}.min 不能大于 max`);
			}
			return {
				path: fieldPath,
				type: fieldType,
				...(min === undefined ? {} : { min }),
				...(max === undefined ? {} : { max }),
			};
		}
		case "string": {
			if (has("values") || has("min") || has("max")) {
				throw new Error(`${path} 的字符串字段只允许 maxLength`);
			}
			const maxLength = object.maxLength;
			if (
				maxLength !== undefined &&
				(typeof maxLength !== "number" ||
					!Number.isInteger(maxLength) ||
					maxLength < 1)
			) {
				throw new Error(`${path}.maxLength 必须是正整数`);
			}
			return {
				path: fieldPath,
				type: fieldType,
				...(maxLength === undefined ? {} : { maxLength }),
			};
		}
		case "boolean":
			if (has("values") || has("min") || has("max") || has("maxLength")) {
				throw new Error(`${path} 的布尔字段不接受额外约束`);
			}
			return { path: fieldPath, type: fieldType };
		case "string-array":
			if (has("values") || has("min") || has("max") || has("maxLength")) {
				throw new Error(`${path} 的字符串数组字段不接受额外约束`);
			}
			return { path: fieldPath, type: fieldType };
	}
}

function parsePlotBeatPayload(value: unknown, path: string): PlotBeatPayload {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ["id", "title", "text", "preconditions"], path);
	const preconditions =
		object.preconditions === undefined || object.preconditions === null
			? null
			: parseContextCondition(object.preconditions, `${path}.preconditions`);
	return {
		id: readNonEmptyString(object.id, `${path}.id`),
		title: readNonEmptyString(object.title, `${path}.title`),
		text: readNonEmptyString(object.text, `${path}.text`),
		preconditions,
	};
}

function parseContextTemplatePayload(
	value: unknown,
	path: string,
): ContextTemplate {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ["id", "segments", "deepTurn"], path);
	const id = readNonEmptyString(object.id, `${path}.id`);
	if (!Array.isArray(object.segments) || object.segments.length === 0) {
		throw new Error(`${path}.segments 必须是非空数组`);
	}
	const segments = object.segments.map((item, index) =>
		parseContextSegment(item, `${path}.segments[${index}]`),
	);
	const template: {
		id: string;
		segments: readonly ContextSegment[];
		deepTurn?: ContextTemplateDeepTurn;
	} = { id, segments };
	if (object.deepTurn !== undefined) {
		template.deepTurn = parseDeepTurn(object.deepTurn, id, `${path}.deepTurn`);
	}
	assertContextTemplate(template);
	return template;
}

function parseContextSegment(value: unknown, path: string): ContextSegment {
	const object = assertPlainObject(value, path);
	const kind = object.kind;
	if (kind === "static") {
		rejectUnknownKeys(object, ["id", "kind", "text", "priority", "when"], path);
		const priority = readOptionalNumber(object.priority, `${path}.priority`);
		const when =
			object.when === undefined
				? undefined
				: parseContextCondition(object.when, `${path}.when`);
		return {
			id: readNonEmptyString(object.id, `${path}.id`),
			kind: "static",
			text: readNonEmptyString(object.text, `${path}.text`),
			...(priority === undefined ? {} : { priority }),
			...(when === undefined ? {} : { when }),
		};
	}
	if (kind === "slot") {
		rejectUnknownKeys(object, ["id", "kind", "slot", "priority", "when"], path);
		const slot = object.slot;
		if (typeof slot !== "string" || !isContextSlotName(slot)) {
			throw new Error(`${path}.slot 不是合法槽位：${String(slot)}`);
		}
		const priority = readOptionalNumber(object.priority, `${path}.priority`);
		const when =
			object.when === undefined
				? undefined
				: parseContextCondition(object.when, `${path}.when`);
		return {
			id: readNonEmptyString(object.id, `${path}.id`),
			kind: "slot",
			slot,
			...(priority === undefined ? {} : { priority }),
			...(when === undefined ? {} : { when }),
		};
	}
	throw new Error(`${path}.kind 必须是 static 或 slot`);
}

function parseDeepTurn(
	value: unknown,
	templateId: string,
	path: string,
): ContextTemplateDeepTurn {
	const object = assertPlainObject(value, path);
	assertContextTemplateDeepTurn(object, templateId);
	const deepTurn: {
		tools?: readonly string[];
		maxToolCalls?: number;
		maxDurationMs?: number;
		notesEnabled?: boolean;
	} = {};
	if (object.tools !== undefined) {
		deepTurn.tools = (object.tools as unknown[]).map((item, index) => {
			if (typeof item !== "string" || item.trim().length === 0) {
				throw new Error(`${path}.tools[${index}] 必须是非空字符串`);
			}
			return item;
		});
	}
	if (object.maxToolCalls !== undefined) {
		deepTurn.maxToolCalls = object.maxToolCalls as number;
	}
	if (object.maxDurationMs !== undefined) {
		deepTurn.maxDurationMs = object.maxDurationMs as number;
	}
	if (object.notesEnabled !== undefined) {
		deepTurn.notesEnabled = object.notesEnabled as boolean;
	}
	return deepTurn;
}

function parseBlockRendererPayload(
	value: unknown,
	path: string,
): BlockRendererPayload {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ["block", "display", "context"], path);
	const block = readNonEmptyString(object.block, `${path}.block`);
	if (BLOCK_NAME_PATTERN.test(block)) {
		throw new Error(`${path}.block 不能包含 '<'、'>'、'/' 或空白`);
	}
	return {
		block,
		display: parseBlockDisplay(object.display, `${path}.display`),
		context: parseBlockContext(object.context, `${path}.context`),
	};
}

function parseBlockDisplay(value: unknown, path: string): BlockDisplayStrategy {
	const object = assertPlainObject(value, path);
	const kind = object.kind;
	if (kind === "html") {
		rejectUnknownKeys(object, ["kind", "template"], path);
		return {
			kind: "html",
			template: readNonEmptyString(object.template, `${path}.template`),
		};
	}
	if (kind === "native") {
		rejectUnknownKeys(object, ["kind", "component"], path);
		return {
			kind: "native",
			component: readNonEmptyString(object.component, `${path}.component`),
		};
	}
	if (kind === "hidden") {
		rejectUnknownKeys(object, ["kind"], path);
		return { kind: "hidden" };
	}
	throw new Error(`${path}.kind 必须是 html、native 或 hidden`);
}

function parseBlockContext(value: unknown, path: string): BlockContextStrategy {
	const object = assertPlainObject(value, path);
	const kind = object.kind;
	if (kind === "keep-depth") {
		rejectUnknownKeys(object, ["kind", "depth"], path);
		const depth = object.depth;
		if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1) {
			throw new Error(`${path}.depth 必须是正整数`);
		}
		const context: BlockContextStrategy = { kind, depth };
		assertBlockContextStrategy(context, path);
		return context;
	}
	if (kind === "keep" || kind === "drop" || kind === "compress") {
		rejectUnknownKeys(object, ["kind"], path);
		const context: BlockContextStrategy = { kind };
		assertBlockContextStrategy(context, path);
		return context;
	}
	throw new Error(`${path}.kind 必须是 keep、drop、keep-depth 或 compress`);
}

function parseSkillPayload(value: unknown, path: string): SkillPayload {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ["name", "description", "content"], path);
	return {
		name: readNonEmptyString(object.name, `${path}.name`),
		description: readNonEmptyString(object.description, `${path}.description`),
		content: readNonEmptyString(object.content, `${path}.content`),
	};
}

function parseDirectorConfigPayload(
	value: unknown,
	path: string,
): DirectorConfigPayload {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ["config"], path);
	const config = assertPlainObject(object.config, `${path}.config`);
	rejectUnknownKeys(
		config,
		Object.keys(DEFAULT_DIRECTOR_CONFIG),
		`${path}.config`,
	);
	assertDirectorConfig({
		...DEFAULT_DIRECTOR_CONFIG,
		...config,
	});
	return { config: config as Partial<DirectorConfig> };
}

function parseEventPoolPayload(value: unknown, path: string): EventPoolPayload {
	const object = assertPlainObject(value, path);
	rejectUnknownKeys(object, ["events"], path);
	if (!Array.isArray(object.events) || object.events.length === 0) {
		throw new Error(`${path}.events 必须是非空数组`);
	}
	return {
		events: parseDramaticerEventDefinitions(object.events, `${path}.events`),
	};
}

export function readPluginName(value: unknown, path: string): string {
	const name = readNonEmptyString(value, path);
	if (!NAME_PATTERN.test(name)) {
		throw new Error(
			`${path} 只能包含小写字母、数字、点、下划线与连字符，并以字母或数字开头：${name}`,
		);
	}
	return name;
}

export function readPluginVersion(value: unknown, path: string): string {
	const version = readNonEmptyString(value, path);
	if (!VERSION_PATTERN.test(version)) {
		throw new Error(`${path} 必须是形如 1.2.3 的版本号：${version}`);
	}
	return version;
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

function readOptionalNumber(value: unknown, path: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${path} 必须是有限数字`);
	}
	return value;
}

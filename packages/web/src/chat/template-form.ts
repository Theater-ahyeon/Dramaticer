import type {
	ContextCondition,
	ContextSegment,
	ContextSlotName,
	ContextStaticSegment,
	ContextTemplate,
	ContextTemplateDeepTurn,
} from "@dramaticer/core";
import {
	DEEP_MAX_TOOL_CALLS_RANGE,
	DEEP_TIMEOUT_MS_RANGE,
	DEEP_TURN_TOOL_NAMES,
	DEEP_TURN_TOOL_OPTIONS,
	NOTE_TURN_TOOL_NAMES,
} from "./deep-turn";
import type { FormFieldError } from "./settings-form";

/** 写作契约段固定使用这个 id；服务端要求它排在最后。 */
export const PROTOCOL_SEGMENT_ID = "protocol";
/** 可选的块格式说明段。 */
export const BLOCK_FORMAT_SEGMENT_ID = "block_format";

export const SLOT_CHOICES: readonly {
	readonly value: ContextSlotName;
	readonly label: string;
}[] = [
	{ value: "lore", label: "世界书" },
	{ value: "character", label: "角色" },
	{ value: "persona", label: "玩家扮演" },
	{ value: "summary", label: "摘要" },
	{ value: "state", label: "状态" },
	{ value: "memory", label: "记忆" },
	{ value: "history", label: "历史" },
	{ value: "scene", label: "现场分析" },
	{ value: "profile", label: "人物档案" },
	{ value: "reunion", label: "重逢注入" },
	{ value: "scene_card", label: "场面卡" },
	{ value: "director", label: "导演" },
	{ value: "user_will", label: "用户意志" },
	{ value: "protocol", label: "写作契约" },
];

export const CONDITION_KIND_CHOICES: readonly {
	readonly value: ConditionDraft["kind"];
	readonly label: string;
}[] = [
	{ value: "switch", label: "开关" },
	{ value: "state", label: "状态" },
	{ value: "all", label: "全部满足" },
	{ value: "any", label: "任一满足" },
	{ value: "not", label: "取反" },
];

export const STATE_OP_CHOICES: readonly {
	readonly value: StateConditionDraft["op"];
	readonly label: string;
}[] = [
	{ value: "exists", label: "存在" },
	{ value: "equals", label: "等于" },
	{ value: "truthy", label: "为真" },
];

export interface SwitchConditionDraft {
	readonly kind: "switch";
	readonly name: string;
	readonly equals: boolean;
}

export interface StateConditionDraft {
	readonly kind: "state";
	/** 英文句点分隔的状态路径。 */
	readonly path: string;
	readonly op: "exists" | "equals" | "truthy";
	/** `equals` 的比较值，按 JSON 解析；其它操作符忽略。 */
	readonly valueText: string;
}

export interface AllConditionDraft {
	readonly kind: "all";
	readonly conditions: readonly ConditionDraft[];
}

export interface AnyConditionDraft {
	readonly kind: "any";
	readonly conditions: readonly ConditionDraft[];
}

export interface NotConditionDraft {
	readonly kind: "not";
	readonly condition: ConditionDraft;
}

export type ConditionDraft =
	| SwitchConditionDraft
	| StateConditionDraft
	| AllConditionDraft
	| AnyConditionDraft
	| NotConditionDraft;

export interface SegmentFormDraft {
	readonly id: string;
	readonly kind: "static" | "slot";
	readonly text: string;
	readonly slot: ContextSlotName;
	/** 预算裁剪优先级；空字符串表示未设置。 */
	readonly priority: string;
	/** null 表示无条件。 */
	readonly condition: ConditionDraft | null;
}

/** 深回合配置草稿；空字符串表示不覆盖故事设置里的对应上限。 */
export interface TemplateDeepTurnDraft {
	/** 选中的工具名；全选时保存会省略该字段，表示使用全部工具。 */
	readonly tools: readonly string[];
	readonly maxToolCalls: string;
	readonly maxDurationMs: string;
	readonly notesEnabled: boolean;
}

export interface TemplateFormDraft {
	readonly id: string;
	readonly name: string;
	readonly segments: readonly SegmentFormDraft[];
	readonly deepTurn: TemplateDeepTurnDraft;
}

export interface TemplateSegmentRow {
	readonly index: number;
	readonly id: string;
	readonly kindLabel: string;
	readonly detail: string;
	readonly condition: string;
	readonly priority: string;
}

export function conditionDraftFrom(
	condition: ContextCondition,
): ConditionDraft {
	switch (condition.kind) {
		case "switch":
			return {
				kind: "switch",
				name: condition.name,
				equals: condition.equals ?? true,
			};
		case "state":
			return {
				kind: "state",
				path: condition.path.join("."),
				op: condition.op,
				valueText:
					condition.value === undefined ? "" : JSON.stringify(condition.value),
			};
		case "all":
			return {
				kind: "all",
				conditions: condition.conditions.map(conditionDraftFrom),
			};
		case "any":
			return {
				kind: "any",
				conditions: condition.conditions.map(conditionDraftFrom),
			};
		case "not":
			return {
				kind: "not",
				condition: conditionDraftFrom(condition.condition),
			};
	}
}

export function segmentDraftFrom(segment: ContextSegment): SegmentFormDraft {
	return {
		id: segment.id,
		kind: segment.kind,
		text: segment.kind === "static" ? segment.text : "",
		slot: segment.kind === "slot" ? segment.slot : "history",
		priority: segment.priority === undefined ? "" : String(segment.priority),
		condition:
			segment.when === undefined ? null : conditionDraftFrom(segment.when),
	};
}

export function deepTurnDraftFrom(
	config: ContextTemplateDeepTurn | undefined,
): TemplateDeepTurnDraft {
	return {
		tools: config?.tools === undefined ? DEEP_TURN_TOOL_NAMES : config.tools,
		maxToolCalls:
			config?.maxToolCalls === undefined ? "" : String(config.maxToolCalls),
		maxDurationMs:
			config?.maxDurationMs === undefined ? "" : String(config.maxDurationMs),
		notesEnabled: config?.notesEnabled ?? true,
	};
}

export function templateDraftFrom(
	template: ContextTemplate,
	name: string,
): TemplateFormDraft {
	return {
		id: template.id,
		name,
		segments: template.segments.map(segmentDraftFrom),
		deepTurn: deepTurnDraftFrom(template.deepTurn),
	};
}

/** 转换单个条件；`equals` 的取值按 JSON 解析，解析失败时指出位置。 */
export function conditionDraftTo(
	draft: ConditionDraft,
	path: string,
): {
	readonly condition: ContextCondition | null;
	readonly errors: readonly FormFieldError[];
} {
	const errors: FormFieldError[] = [];
	switch (draft.kind) {
		case "switch": {
			const name = draft.name.trim();
			if (name.length === 0) {
				errors.push({ path: `${path}.name`, message: "开关名不能为空" });
			}
			return {
				condition:
					name.length === 0
						? null
						: {
								kind: "switch",
								name,
								...(draft.equals ? {} : { equals: false }),
							},
				errors,
			};
		}
		case "state": {
			const pathSegments = draft.path.split(".").map((item) => item.trim());
			if (
				draft.path.trim().length === 0 ||
				pathSegments.some((item) => item.length === 0)
			) {
				errors.push({
					path: `${path}.path`,
					message: "状态路径必须用英文句点分隔且每一段都非空",
				});
			}
			let value: unknown;
			if (draft.op === "equals") {
				try {
					value = JSON.parse(draft.valueText);
				} catch {
					errors.push({
						path: `${path}.value`,
						message: "等于操作符的比较值必须是合法 JSON",
					});
				}
			}
			if (errors.length > 0) return { condition: null, errors };
			return {
				condition:
					draft.op === "equals"
						? {
								kind: "state",
								path: pathSegments,
								op: draft.op,
								value,
							}
						: { kind: "state", path: pathSegments, op: draft.op },
				errors,
			};
		}
		case "all":
		case "any": {
			const conditions: ContextCondition[] = [];
			draft.conditions.forEach((child, index) => {
				const result = conditionDraftTo(child, `${path}.conditions[${index}]`);
				errors.push(...result.errors);
				if (result.condition !== null) conditions.push(result.condition);
			});
			return {
				condition:
					errors.length === 0 ? { kind: draft.kind, conditions } : null,
				errors,
			};
		}
		case "not": {
			const result = conditionDraftTo(draft.condition, `${path}.condition`);
			return {
				condition:
					result.condition === null
						? null
						: { kind: "not", condition: result.condition },
				errors: result.errors,
			};
		}
	}
}

function emptyCondition(kind: ConditionDraft["kind"]): ConditionDraft {
	switch (kind) {
		case "switch":
			return { kind: "switch", name: "", equals: true };
		case "state":
			return { kind: "state", path: "", op: "exists", valueText: "" };
		case "all":
			return { kind: "all", conditions: [] };
		case "any":
			return { kind: "any", conditions: [] };
		case "not":
			return { kind: "not", condition: emptyCondition("switch") };
	}
}

/** 切换条件类型；能沿用的字段保留，避免玩家重新填写。 */
export function switchConditionKind(
	current: ConditionDraft | null,
	kind: ConditionDraft["kind"],
): ConditionDraft {
	if (current === null) return emptyCondition(kind);
	switch (kind) {
		case "switch":
			return {
				kind: "switch",
				name: current.kind === "switch" ? current.name : "",
				equals: current.kind === "switch" ? current.equals : true,
			};
		case "state":
			return current.kind === "state"
				? current
				: { kind: "state", path: "", op: "exists", valueText: "" };
		case "all":
			return current.kind === "all"
				? current
				: { kind: "all", conditions: [current] };
		case "any":
			return current.kind === "any"
				? current
				: { kind: "any", conditions: [current] };
		case "not":
			return current.kind === "not"
				? current
				: { kind: "not", condition: current };
	}
}

export function updateSegmentDraft(
	draft: TemplateFormDraft,
	index: number,
	patch: Partial<SegmentFormDraft>,
): TemplateFormDraft {
	return {
		...draft,
		segments: draft.segments.map((segment, position) =>
			position === index ? { ...segment, ...patch } : segment,
		),
	};
}

/** 勾选或取消一个工具；未知工具名原样拒绝为无变化。 */
export function setDeepTurnTool(
	draft: TemplateFormDraft,
	name: string,
	enabled: boolean,
): TemplateFormDraft {
	if (enabled) {
		if (draft.deepTurn.tools.includes(name)) return draft;
		return {
			...draft,
			deepTurn: { ...draft.deepTurn, tools: [...draft.deepTurn.tools, name] },
		};
	}
	return {
		...draft,
		deepTurn: {
			...draft.deepTurn,
			tools: draft.deepTurn.tools.filter((item) => item !== name),
		},
	};
}

/** 关掉手记时同时移出手记工具，保证草稿与保存规则一致。 */
export function setDeepTurnNotesEnabled(
	draft: TemplateFormDraft,
	enabled: boolean,
): TemplateFormDraft {
	const tools = enabled
		? draft.deepTurn.tools
		: draft.deepTurn.tools.filter(
				(name) => !NOTE_TURN_TOOL_NAMES.includes(name),
			);
	return {
		...draft,
		deepTurn: { ...draft.deepTurn, notesEnabled: enabled, tools },
	};
}

function nextSegmentId(draft: TemplateFormDraft): string {
	let ordinal = 1;
	while (
		draft.segments.some((segment) => segment.id === `segment-${ordinal}`)
	) {
		ordinal += 1;
	}
	return `segment-${ordinal}`;
}

/** 在 protocol 之前插入；没有 protocol 时追加到末尾。 */
function insertBeforeProtocol(
	draft: TemplateFormDraft,
	segment: SegmentFormDraft,
): TemplateFormDraft {
	const protocolIndex = draft.segments.findIndex(
		(item) => item.id === PROTOCOL_SEGMENT_ID,
	);
	const segments =
		protocolIndex === -1
			? [...draft.segments, segment]
			: [
					...draft.segments.slice(0, protocolIndex),
					segment,
					...draft.segments.slice(protocolIndex),
				];
	return { ...draft, segments };
}

export function addStaticSegment(draft: TemplateFormDraft): TemplateFormDraft {
	return insertBeforeProtocol(draft, {
		id: nextSegmentId(draft),
		kind: "static",
		text: "",
		slot: "history",
		priority: "",
		condition: null,
	});
}

export function addSlotSegment(
	draft: TemplateFormDraft,
	slot: ContextSlotName,
): TemplateFormDraft {
	return insertBeforeProtocol(draft, {
		id: nextSegmentId(draft),
		kind: "slot",
		text: "",
		slot,
		priority: "",
		condition: null,
	});
}

export function removeSegmentDraft(
	draft: TemplateFormDraft,
	index: number,
): TemplateFormDraft {
	return {
		...draft,
		segments: draft.segments.filter((_, position) => position !== index),
	};
}

/** 上下移动：`delta` 为 -1 上移、1 下移；越界时原样返回。 */
export function moveSegmentDraft(
	draft: TemplateFormDraft,
	index: number,
	delta: number,
): TemplateFormDraft {
	const target = index + delta;
	if (index < 0 || index >= draft.segments.length) return draft;
	if (target < 0 || target >= draft.segments.length) return draft;
	const segments = [...draft.segments];
	const [moved] = segments.splice(index, 1);
	if (moved === undefined) return draft;
	segments.splice(target, 0, moved);
	return { ...draft, segments };
}

export function hasBlockFormatSegment(draft: TemplateFormDraft): boolean {
	return draft.segments.some(
		(segment) => segment.id === BLOCK_FORMAT_SEGMENT_ID,
	);
}

export function addBlockFormatSegment(
	draft: TemplateFormDraft,
	segment: ContextStaticSegment,
): TemplateFormDraft {
	if (hasBlockFormatSegment(draft)) return draft;
	return insertBeforeProtocol(draft, segmentDraftFrom(segment));
}

export function removeBlockFormatSegment(
	draft: TemplateFormDraft,
): TemplateFormDraft {
	return {
		...draft,
		segments: draft.segments.filter(
			(segment) => segment.id !== BLOCK_FORMAT_SEGMENT_ID,
		),
	};
}

export function describeConditionDraft(
	condition: ConditionDraft | null,
): string {
	if (condition === null) return "无条件";
	switch (condition.kind) {
		case "switch":
			return `开关 ${condition.name || "（未填写）"} ${condition.equals ? "为真" : "为假"}`;
		case "state": {
			const op =
				condition.op === "exists"
					? "存在"
					: condition.op === "equals"
						? `等于 ${condition.valueText || "（未填写）"}`
						: "为真";
			return `状态 ${condition.path || "（未填写）"} ${op}`;
		}
		case "all":
			return condition.conditions.length === 0
				? "全部满足（空）"
				: condition.conditions
						.map(describeConditionDraft)
						.map((item) => `(${item})`)
						.join(" 且 ");
		case "any":
			return condition.conditions.length === 0
				? "任一满足（空）"
				: condition.conditions
						.map(describeConditionDraft)
						.map((item) => `(${item})`)
						.join(" 或 ");
		case "not":
			return `非（${describeConditionDraft(condition.condition)}）`;
	}
}

/** 组装顺序预览：与草稿顺序一一对应。 */
export function describeTemplateSegments(
	draft: TemplateFormDraft,
): readonly TemplateSegmentRow[] {
	return draft.segments.map((segment, index) => ({
		index,
		id: segment.id,
		kindLabel: segment.kind === "static" ? "静态" : "槽位",
		detail:
			segment.kind === "static"
				? segment.text.length === 0
					? "（空文本）"
					: segment.text
				: (SLOT_CHOICES.find((choice) => choice.value === segment.slot)
						?.label ?? segment.slot),
		condition: describeConditionDraft(segment.condition),
		priority: segment.priority.length === 0 ? "默认" : segment.priority,
	}));
}

/** 可选的整数上限；空字符串表示沿用故事设置。 */
function parseOptionalDeepInteger(
	text: string,
	path: string,
	minimum: number,
	maximum: number,
	errors: FormFieldError[],
): void {
	if (text.trim().length === 0) return;
	const value = Number(text.trim());
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		errors.push({
			path,
			message: `必须是 ${minimum} 到 ${maximum} 之间的整数或留空`,
		});
	}
}

function validateDeepTurn(
	draft: TemplateDeepTurnDraft,
): readonly FormFieldError[] {
	const errors: FormFieldError[] = [];
	const seen = new Set<string>();
	draft.tools.forEach((name, index) => {
		if (!DEEP_TURN_TOOL_NAMES.includes(name)) {
			errors.push({
				path: `template.deepTurn.tools[${index}]`,
				message: `未知工具：${name}`,
			});
		} else if (seen.has(name)) {
			errors.push({
				path: `template.deepTurn.tools[${index}]`,
				message: `重复的工具名：${name}`,
			});
		}
		seen.add(name);
	});
	if (
		!draft.notesEnabled &&
		draft.tools.some((name) => NOTE_TURN_TOOL_NAMES.includes(name))
	) {
		errors.push({
			path: "template.deepTurn.tools",
			message: "关掉手记时不能选中手记工具",
		});
	}
	parseOptionalDeepInteger(
		draft.maxToolCalls,
		"template.deepTurn.maxToolCalls",
		DEEP_MAX_TOOL_CALLS_RANGE.minimum,
		DEEP_MAX_TOOL_CALLS_RANGE.maximum,
		errors,
	);
	parseOptionalDeepInteger(
		draft.maxDurationMs,
		"template.deepTurn.maxDurationMs",
		DEEP_TIMEOUT_MS_RANGE.minimum,
		DEEP_TIMEOUT_MS_RANGE.maximum,
		errors,
	);
	return errors;
}

/** 与服务端 `assertContextTemplate`、`assertStoredContextTemplate` 同一套规则。 */
export function validateTemplateDraft(
	draft: TemplateFormDraft,
): readonly FormFieldError[] {
	const errors: FormFieldError[] = [];
	if (draft.id.trim().length === 0) {
		errors.push({ path: "template.id", message: "模板 id 必须是非空字符串" });
	}
	if (draft.segments.length === 0) {
		errors.push({ path: "template.segments", message: "模板至少需要一个片段" });
	}
	const ids = new Set<string>();
	draft.segments.forEach((segment, index) => {
		const path = `template.segments[${index}]`;
		if (segment.id.trim().length === 0) {
			errors.push({ path: `${path}.id`, message: "片段 id 必须是非空字符串" });
		} else if (ids.has(segment.id)) {
			errors.push({
				path: `${path}.id`,
				message: `片段 id 重复：${segment.id}`,
			});
		}
		ids.add(segment.id);
		if (segment.priority.trim().length > 0) {
			const priority = Number(segment.priority.trim());
			if (!Number.isFinite(priority)) {
				errors.push({
					path: `${path}.priority`,
					message: "优先级必须是数字或留空",
				});
			}
		}
		if (segment.kind === "static") {
			if (segment.text.length === 0) {
				errors.push({
					path: `${path}.text`,
					message: "静态片段的文本不能为空",
				});
			}
		} else if (SLOT_CHOICES.every((choice) => choice.value !== segment.slot)) {
			errors.push({
				path: `${path}.slot`,
				message: `未知的槽位：${String(segment.slot)}`,
			});
		}
		if (segment.condition !== null) {
			const result = conditionDraftTo(segment.condition, `${path}.when`);
			errors.push(...result.errors);
		}
	});
	const protocolIndex = draft.segments.findIndex(
		(segment) => segment.id === PROTOCOL_SEGMENT_ID,
	);
	const lastIndex = draft.segments.length - 1;
	if (protocolIndex !== -1 && protocolIndex !== lastIndex) {
		errors.push({
			path: `template.segments[${protocolIndex}]`,
			message: `写作契约必须是最后一个片段：当前在第 ${protocolIndex + 1} 个，后面还有 ${
				lastIndex - protocolIndex
			} 个片段`,
		});
	}
	errors.push(...validateDeepTurn(draft.deepTurn));
	return errors;
}

/** 全选工具与默认值等价，保存时省略该字段；其余字段为空时同样省略。 */
function buildDeepTurn(
	draft: TemplateDeepTurnDraft,
): ContextTemplateDeepTurn | undefined {
	const allSelected = DEEP_TURN_TOOL_NAMES.every((name) =>
		draft.tools.includes(name),
	);
	const config: ContextTemplateDeepTurn = {
		...(allSelected ? {} : { tools: [...draft.tools] }),
		...(draft.maxToolCalls.trim().length === 0
			? {}
			: { maxToolCalls: Number(draft.maxToolCalls.trim()) }),
		...(draft.maxDurationMs.trim().length === 0
			? {}
			: { maxDurationMs: Number(draft.maxDurationMs.trim()) }),
		...(draft.notesEnabled ? {} : { notesEnabled: false }),
	};
	return Object.keys(config).length === 0 ? undefined : config;
}

/** 校验通过后转成协议对象；有错误时调用方不应保存。 */
export function buildContextTemplate(
	draft: TemplateFormDraft,
): ContextTemplate {
	const segments = draft.segments.map((segment) => {
		const base = {
			id: segment.id,
			...(segment.priority.trim().length === 0
				? {}
				: { priority: Number(segment.priority.trim()) }),
			...(segment.condition === null
				? {}
				: {
						when:
							conditionDraftTo(segment.condition, "when").condition ??
							undefined,
					}),
		};
		if (segment.kind === "static") {
			return { ...base, kind: "static" as const, text: segment.text };
		}
		return { ...base, kind: "slot" as const, slot: segment.slot };
	});
	const deepTurn = buildDeepTurn(draft.deepTurn);
	return {
		id: draft.id,
		segments,
		...(deepTurn === undefined ? {} : { deepTurn }),
	};
}

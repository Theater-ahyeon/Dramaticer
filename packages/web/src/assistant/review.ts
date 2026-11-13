import type { LedgerChangeCard } from "@dramaticer/core";
import type {
	AssistantActionKind,
	AssistantActionView,
	AssistantConversationView,
} from "@dramaticer/protocol";
import { formatLedgerPath, pathKey } from "../chat/ledger-view";

/** 待确认视图的“全部来源”选项，其余选项是会话 id。 */
export const REVIEW_FILTER_ALL = "all";

export const ASSISTANT_ACTION_KIND_LABELS: Readonly<
	Record<AssistantActionKind, string>
> = {
	channels: "渠道配置",
	settings: "故事设置",
	template: "上下文模板",
	lore: "世界书条目",
	director_plan: "导演计划",
	card: "卡片字段",
	image_config: "生图配置",
};

/** 待确认动作的一个字段；值统一交给 LedgerValue 折叠显示。 */
export interface ReviewField {
	readonly label: string;
	readonly value: unknown;
}

/** 台账变更卡的一条路径，连同批准前的原值与批准后的新值。 */
export interface ReviewLedgerRow {
	readonly path: string;
	readonly beforeExisted: boolean;
	readonly before: unknown;
	readonly op: "set" | "delete";
	readonly after: unknown;
}

/**
 * 按动作种类给出可以展示的字段。渠道只显示别名、模型与密钥是否设置，
 * 载荷里的密钥值与环境变量名都不会进入界面。
 */
export function describeAssistantActionFields(
	action: AssistantActionView,
): readonly ReviewField[] {
	const payload = asRecord(action.payload);
	switch (action.kind) {
		case "channels":
			return describeChannelsFields(payload);
		case "settings":
		case "card":
			return Object.entries(payload).map(([key, value]) => ({
				label: key,
				value,
			}));
		case "template":
			return describeTemplateFields(payload);
		case "lore":
			return describeLoreFields(payload);
		case "director_plan":
			return describePlanFields(payload);
		case "image_config":
			return Object.entries(asRecord(payload.imageConfig)).map(
				([key, value]) => ({ label: key, value }),
			);
	}
}

function describeChannelsFields(
	payload: Readonly<Record<string, unknown>>,
): readonly ReviewField[] {
	const fields: ReviewField[] = [];
	for (const [alias, model] of Object.entries(asRecord(payload.models))) {
		const id = asRecord(model).id;
		fields.push({
			label: `模型 ${alias}`,
			value: typeof id === "string" ? id : "",
		});
	}
	for (const [id, channel] of Object.entries(asRecord(payload.channels))) {
		fields.push({ label: `渠道 ${id}`, value: secretState(channel) });
	}
	for (const [id, embedding] of Object.entries(asRecord(payload.embeddings))) {
		const model = asRecord(embedding).model;
		const name = typeof model === "string" ? model : "";
		fields.push({
			label: `向量 ${id}`,
			value: `${name} · ${secretState(embedding)}`,
		});
	}
	for (const [role, alias] of Object.entries(asRecord(payload.roles))) {
		fields.push({
			label: `岗位 ${role}`,
			value: typeof alias === "string" ? alias : "",
		});
	}
	return fields;
}

function describeTemplateFields(
	payload: Readonly<Record<string, unknown>>,
): readonly ReviewField[] {
	const template = asRecord(payload.template);
	const segments = Array.isArray(template.segments) ? template.segments : [];
	const ids = segments.map((segment) => {
		const id = asRecord(segment).id;
		return typeof id === "string" ? id : "";
	});
	return [
		{
			label: "模板",
			value:
				typeof payload.templateId === "string" ? payload.templateId : "新建",
		},
		{
			label: "名称",
			value: typeof payload.name === "string" ? payload.name : "",
		},
		{ label: "段落数量", value: segments.length },
		{ label: "段落", value: ids.join("、") },
	];
}

function describeLoreFields(
	payload: Readonly<Record<string, unknown>>,
): readonly ReviewField[] {
	const entries = Array.isArray(payload.entries) ? payload.entries : [];
	return entries.map((entry, index) => {
		const item = asRecord(entry);
		return {
			label: `条目 ${typeof item.name === "string" ? item.name : index + 1}`,
			value: typeof item.content === "string" ? item.content : "",
		};
	});
}

function describePlanFields(
	payload: Readonly<Record<string, unknown>>,
): readonly ReviewField[] {
	const plan = asRecord(payload.plan);
	const arcs = Array.isArray(plan.arcs) ? plan.arcs : [];
	return [
		{ label: "弧线数量", value: arcs.length },
		...arcs.map((arc, index) => ({
			label: `弧线 ${index + 1}`,
			value: asRecord(arc).title,
		})),
	];
}

/** 每条 diff 的原值从卡片的 before 里按路径取；没有记录的原值按不存在显示。 */
export function describeLedgerRows(
	card: LedgerChangeCard,
): readonly ReviewLedgerRow[] {
	const before = new Map(
		card.before.map((entry) => [pathKey(entry.path), entry]),
	);
	return card.diffs.map((diff) => {
		const original = before.get(pathKey(diff.path));
		return {
			path: formatLedgerPath(diff.path),
			beforeExisted: original?.existed ?? false,
			before: original?.value,
			op: diff.op,
			after: diff.op === "set" ? diff.value : undefined,
		};
	});
}

export function matchesReviewConversation(
	conversationId: string | null,
	filter: string,
): boolean {
	if (filter === REVIEW_FILTER_ALL) return true;
	return conversationId === filter;
}

export interface ReviewConversationOption {
	readonly id: string;
	readonly title: string;
}

/** 过滤选项来自当前待确认条目，按标题排序；与会话列表里的名字合并查找。 */
export function reviewConversationOptions(
	actions: readonly AssistantActionView[],
	cards: readonly LedgerChangeCard[],
	conversations: readonly AssistantConversationView[],
): readonly ReviewConversationOption[] {
	const ids = new Set<string>();
	for (const action of actions) ids.add(action.conversationId);
	for (const card of cards) {
		if (card.assistantConversationId !== null) {
			ids.add(card.assistantConversationId);
		}
	}
	return [...ids]
		.map((id) => ({ id, title: reviewConversationTitle(conversations, id) }))
		.sort((left, right) => left.title.localeCompare(right.title, "zh"));
}

export function reviewConversationTitle(
	conversations: readonly AssistantConversationView[],
	id: string,
): string {
	return (
		conversations.find((conversation) => conversation.id === id)?.title ?? id
	);
}

function secretState(value: unknown): string {
	const entry = asRecord(value);
	const apiKey = entry.apiKey;
	if (typeof apiKey === "string" && apiKey.length > 0) return "密钥已设置";
	const env = entry.apiKeyEnv;
	if (typeof env === "string" && env.length > 0) return "密钥已设置";
	return "密钥未设置";
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: {};
}

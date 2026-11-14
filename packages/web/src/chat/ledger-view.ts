import type {
	JsonObject,
	JsonValue,
	LedgerFact,
	MemoryEvent,
	StateDiff,
	StoryTime,
	Summary,
} from "@dramaticer/core";

/** 台账分区的固定顺序；未知命名空间（例如 `mvu`）排在后面。 */
export const LEDGER_NAMESPACE_LABELS = [
	{ namespace: "character", label: "人物" },
	{ namespace: "relation", label: "关系" },
	{ namespace: "item", label: "物品" },
	{ namespace: "scene", label: "场景" },
	{ namespace: "time", label: "时间" },
	{ namespace: "clue", label: "线索" },
	{ namespace: "knowledge", label: "知情表" },
	{ namespace: "userWill", label: "用户意志" },
	{ namespace: "rule", label: "规则" },
] as const;

/** 事件分页每页条数。 */
export const EVENT_PAGE_SIZE = 20;

/** 超过这个长度的值在列表里折叠，展开后显示完整内容。 */
export const LONG_VALUE_LIMIT = 120;

export interface LedgerNamespaceSlice {
	readonly namespace: string;
	readonly label: string;
	readonly state: JsonValue | undefined;
	readonly facts: readonly LedgerFact[];
	readonly diffs: readonly StateDiff[];
}

export interface LedgerValueText {
	readonly inline: string;
	readonly full: string;
	readonly expandable: boolean;
}

export interface EventMetaItem {
	readonly label: string;
	readonly value: string;
}

export interface EventPageRequest {
	readonly limit: number;
	readonly offset: number;
}

const KNOWN_NAMESPACES: ReadonlySet<string> = new Set(
	LEDGER_NAMESPACE_LABELS.map((entry) => entry.namespace),
);

function isJsonRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pathKey(path: readonly string[]): string {
	return JSON.stringify(path);
}

export function formatLedgerPath(path: readonly string[]): string {
	return path.join(" / ");
}

/** 本楼 diff 的完整路径集合，供状态树逐行比对；不做前缀匹配。 */
export function highlightPaths(
	diffs: readonly StateDiff[],
): ReadonlySet<string> {
	return new Set(diffs.map((diff) => pathKey(diff.path)));
}

export function isPathHighlighted(
	highlighted: ReadonlySet<string>,
	path: readonly string[],
): boolean {
	return highlighted.has(pathKey(path));
}

/** 该路径下面（不含自身）是否有本楼写入，用来决定子树默认展开。 */
export function hasHighlightedDescendant(
	highlighted: ReadonlySet<string>,
	path: readonly string[],
): boolean {
	const prefix = pathKey(path).slice(0, -1);
	if (path.length === 0) return highlighted.size > 0;
	for (const key of highlighted) {
		if (key.startsWith(`${prefix},`)) return true;
	}
	return false;
}

/**
 * 按命名空间切分台账快照、事实与本楼写入。已知命名空间即使为空也保留，
 * 其余命名空间按名称排序追加。
 */
export function buildNamespaceSlices(
	state: JsonValue,
	facts: readonly LedgerFact[],
	diffs: readonly StateDiff[],
): readonly LedgerNamespaceSlice[] {
	const root: JsonObject = isJsonRecord(state) ? state : {};
	const extras = new Set<string>();
	for (const key of Object.keys(root)) {
		if (!KNOWN_NAMESPACES.has(key)) extras.add(key);
	}
	for (const fact of facts) {
		const namespace = fact.path[0];
		if (namespace !== undefined && !KNOWN_NAMESPACES.has(namespace)) {
			extras.add(namespace);
		}
	}
	for (const diff of diffs) {
		const namespace = diff.path[0];
		if (namespace !== undefined && !KNOWN_NAMESPACES.has(namespace)) {
			extras.add(namespace);
		}
	}
	const namespaces = [
		...LEDGER_NAMESPACE_LABELS.map((entry) => ({ ...entry })),
		...[...extras].sort().map((namespace) => ({
			namespace,
			label: namespace === "mvu" ? "MVU" : namespace,
		})),
	];
	return namespaces.map(({ namespace, label }) => ({
		namespace,
		label,
		state: root[namespace],
		facts: facts.filter((fact) => fact.path[0] === namespace),
		diffs: diffs.filter((diff) => diff.path[0] === namespace),
	}));
}

export function describeLedgerValue(
	value: unknown,
	limit: number = LONG_VALUE_LIMIT,
): LedgerValueText {
	if (value === null) {
		return { inline: "（空）", full: "null", expandable: false };
	}
	if (value === undefined) {
		return { inline: "（未记录）", full: "", expandable: false };
	}
	if (typeof value === "string") {
		return {
			inline: value.length > limit ? `${value.slice(0, limit)}…` : value,
			full: value,
			expandable: value.length > limit,
		};
	}
	if (typeof value === "number" || typeof value === "boolean") {
		const text = String(value);
		return { inline: text, full: text, expandable: false };
	}
	const compact = JSON.stringify(value) ?? String(value);
	return {
		inline: compact.length > limit ? `${compact.slice(0, limit)}…` : compact,
		full: JSON.stringify(value, null, 2) ?? compact,
		expandable: compact.length > limit,
	};
}

export function formatStoryTime(time: StoryTime | null): string {
	if (time === null) return "未记录";
	if (time.start !== null && time.end !== null) {
		return `${time.start} 至 ${time.end}`;
	}
	if (time.start !== null) return `${time.start} 起`;
	if (time.end !== null) return `截至 ${time.end}`;
	return "未记录";
}

export function formatLedgerSource(source: string): string {
	switch (source) {
		case "model":
			return "正文模型";
		case "settler":
			return "结算器";
		case "player":
			return "玩家";
		case "import":
			return "导入";
		default:
			return source;
	}
}

/** 空置信度表示这条事实来自正文模型，没有经过结算器。 */
export function formatConfidence(confidence: number | null): string {
	if (confidence === null) return "正文写入";
	return confidence.toFixed(2);
}

export function formatNodeRef(nodeId: string): string {
	return nodeId.length > 12 ? `${nodeId.slice(0, 10)}…` : nodeId;
}

export function describeEventMeta(
	event: MemoryEvent,
): readonly EventMetaItem[] {
	return [
		{ label: "故事时间", value: event.storyTime ?? "未记录" },
		{ label: "地点", value: event.location ?? "未记录" },
		{
			label: "参与者",
			value:
				event.participants.length > 0 ? event.participants.join("、") : "无",
		},
		{ label: "重要度", value: String(event.importance) },
		{
			label: "知情者",
			value: event.knowers.length > 0 ? event.knowers.join("、") : "无",
		},
		{ label: "来源楼层", value: formatNodeRef(event.sourceNodeId) },
	];
}

/** 事件按 offset 分页；下一页从已经收到的条数开始。 */
export function nextEventRequest(receivedCount: number): EventPageRequest {
	if (!Number.isInteger(receivedCount) || receivedCount < 0) {
		throw new Error(`已收到的事件条数必须是不小于 0 的整数：${receivedCount}`);
	}
	return { limit: EVENT_PAGE_SIZE, offset: receivedCount };
}

/** 服务端返回满一页时可能还有下一页；空页或不满一页就到底了。 */
export function hasMoreEventPage(
	receivedCount: number,
	requestedLimit: number,
): boolean {
	return receivedCount >= requestedLimit;
}

/** 翻页时服务端可能因为分页起点变化重复返回同一条事件，按 id 去重。 */
export function appendEventPage(
	previous: readonly MemoryEvent[],
	page: readonly MemoryEvent[],
): readonly MemoryEvent[] {
	const seen = new Set(previous.map((event) => event.id));
	const merged = [...previous];
	for (const event of page) {
		if (seen.has(event.id)) continue;
		seen.add(event.id);
		merged.push(event);
	}
	return merged;
}

export function formatSummaryLevel(level: Summary["level"]): string {
	return level === "chapter" ? "章节摘要" : "主线摘要";
}

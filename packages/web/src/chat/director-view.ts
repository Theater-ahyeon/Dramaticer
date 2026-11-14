import type {
	ChatProfile,
	DirectorArc,
	DirectorBeat,
	DirectorIntensity,
	DirectorMode,
	DirectorPlan,
	DirectorSequence,
	JsonObject,
	JsonValue,
	LlmModelRole,
	LlmStopReason,
	LlmToolTransport,
	LlmTruncationReason,
	StructuredOutputMode,
	TurnMode,
	TurnTrace,
} from "@dramaticer/core";
import type {
	DirectorDecisionView,
	NodeDirectorView,
} from "@dramaticer/protocol";
import { describeRerollReason } from "./reroll";

export const DIRECTOR_MODE_CHOICES: readonly {
	readonly value: DirectorMode;
	readonly label: string;
}[] = [
	{ value: "off", label: "关闭" },
	{ value: "transparent", label: "透明（显示指令与信号）" },
	{ value: "blind", label: "盲盒（只显示机制触发状态）" },
];

export const DIRECTOR_INTENSITY_CHOICES: readonly {
	readonly value: DirectorIntensity;
	readonly label: string;
}[] = [
	{ value: "setup", label: "铺垫" },
	{ value: "natural", label: "自然" },
	{ value: "detonate", label: "引爆" },
];

const MECHANISM_LABELS: Readonly<Record<string, string>> = {
	beat: "节拍",
	clue: "线索",
	event_pool: "事件池",
	opening: "开场",
	pacing: "节奏",
	repetition: "重复",
};

export interface DirectorSignalRow {
	readonly label: string;
	readonly value: string;
}

export interface DirectorMechanismRow {
	readonly name: string;
	readonly label: string;
	readonly triggered: boolean;
	readonly reason: string;
}

/** 当前拍在计划里的位置与本次评估使用的强度。 */
export interface DirectorBeatView {
	readonly beatId: string;
	readonly arcId: string | null;
	readonly arcTitle: string | null;
	readonly sequenceId: string | null;
	readonly sequenceTitle: string | null;
	readonly goal: string | null;
	readonly intensity: DirectorIntensity | null;
	readonly difficulty: number | null;
	readonly floorDepth: number | null;
	readonly usedFitPoints: readonly string[];
}

export interface DirectorDecisionSummary {
	readonly directive: string | null;
	readonly intensity: DirectorIntensity | null;
	readonly beat: DirectorBeatView | null;
	readonly mechanisms: readonly DirectorMechanismRow[];
	readonly signalRows: readonly DirectorSignalRow[];
	readonly createdAt: string;
}

export interface DirectorModeSummary {
	readonly mode: DirectorMode;
	readonly label: string;
	readonly blind: boolean;
	/** 服务端在盲盒模式下已经隐去指令与信号。 */
	readonly decision: DirectorDecisionSummary | null;
}

export function describeDirectorMode(mode: DirectorMode): string {
	switch (mode) {
		case "off":
			return "关闭";
		case "transparent":
			return "透明";
		case "blind":
			return "盲盒";
	}
}

export function describeDirectorIntensity(
	intensity: DirectorIntensity,
): string {
	switch (intensity) {
		case "setup":
			return "铺垫";
		case "natural":
			return "自然";
		case "detonate":
			return "引爆";
	}
}

export function describeMechanismName(name: string): string {
	return MECHANISM_LABELS[name] ?? name;
}

export function summarizeDirectorView(
	view: NodeDirectorView,
	plan: DirectorPlan | null,
): DirectorModeSummary {
	return {
		mode: view.mode,
		label: describeDirectorMode(view.mode),
		blind: view.mode === "blind",
		decision:
			view.decision === null
				? null
				: summarizeDirectorDecision(view.decision, plan),
	};
}

export function summarizeDirectorDecision(
	decision: DirectorDecisionView,
	plan: DirectorPlan | null,
): DirectorDecisionSummary {
	const signals = decision.signals;
	const beatSignal = signals === undefined ? null : readObject(signals.beat);
	const beatId = beatSignal === null ? null : readString(beatSignal.beatId);
	const located = beatId === null ? null : findDirectorBeat(plan, beatId);
	const intensity =
		beatSignal === null
			? openingIntensity(signals)
			: (readIntensity(beatSignal.intensity) ?? openingIntensity(signals));
	return {
		directive: decision.directive,
		intensity,
		beat:
			beatId === null
				? null
				: {
						beatId,
						arcId: located?.arc.id ?? readString(beatSignal?.arcId),
						arcTitle: located?.arc.title ?? null,
						sequenceId:
							located?.sequence.id ?? readString(beatSignal?.sequenceId),
						sequenceTitle: located?.sequence.title ?? null,
						goal: located?.beat.goal ?? null,
						intensity,
						difficulty:
							located?.arc.difficulty ??
							(beatSignal === null ? null : readNumber(beatSignal.difficulty)),
						floorDepth:
							beatSignal === null ? null : readNumber(beatSignal.floorDepth),
						usedFitPoints:
							beatSignal === null
								? []
								: readStringArray(beatSignal.usedFitPoints),
					},
		mechanisms: decision.mechanisms.map((mechanism) => ({
			name: mechanism.name,
			label: describeMechanismName(mechanism.name),
			triggered: mechanism.triggered,
			reason: mechanism.reason,
		})),
		signalRows: signals === undefined ? [] : flattenSignalRows(signals),
		createdAt: decision.createdAt,
	};
}

/** 把导演信号按叶子展开成「键.子键 = 值」的行，数组按一行显示。 */
export function flattenSignalRows(
	value: JsonValue | undefined,
	prefix = "",
): readonly DirectorSignalRow[] {
	if (value === undefined) return [];
	if (value === null) {
		return [{ label: prefix.length === 0 ? "值" : prefix, value: "（空）" }];
	}
	if (Array.isArray(value)) {
		const label = prefix.length === 0 ? "值" : prefix;
		if (value.length === 0) return [{ label, value: "（空数组）" }];
		const primitive = value.every(
			(item) => item === null || typeof item !== "object",
		);
		return [
			{
				label,
				value: primitive
					? value
							.map((item) => (item === null ? "（空）" : formatPrimitive(item)))
							.join("、")
					: JSON.stringify(value),
			},
		];
	}
	if (typeof value === "object") {
		const entries = Object.entries(value);
		const label = prefix.length === 0 ? "值" : prefix;
		if (entries.length === 0) return [{ label, value: "（空对象）" }];
		return entries.flatMap(([key, child]) =>
			flattenSignalRows(child, prefix.length === 0 ? key : `${prefix}.${key}`),
		);
	}
	return [
		{
			label: prefix.length === 0 ? "值" : prefix,
			value: formatPrimitive(value),
		},
	];
}

function formatPrimitive(value: string | number | boolean): string {
	if (typeof value === "boolean") return value ? "是" : "否";
	return String(value);
}

export interface PlanLocation {
	readonly arc: DirectorArc;
	readonly sequence: DirectorSequence;
	readonly beat: DirectorBeat;
}

/** 在计划里按 id 找拍；找不到时返回 null。 */
export function findDirectorBeat(
	plan: DirectorPlan | null,
	beatId: string,
): PlanLocation | null {
	if (plan === null) return null;
	for (const arc of plan.arcs) {
		for (const sequence of arc.sequences) {
			const beat = sequence.beats.find((item) => item.id === beatId);
			if (beat !== undefined) return { arc, sequence, beat };
		}
	}
	return null;
}

export function countPlanBeats(plan: DirectorPlan): number {
	return plan.arcs.reduce(
		(total, arc) =>
			total +
			arc.sequences.reduce(
				(arcTotal, sequence) => arcTotal + sequence.beats.length,
				0,
			),
		0,
	);
}

export function emptyDirectorPlan(): DirectorPlan {
	return { arcs: [] };
}

export function splitPlanLines(text: string): readonly string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function joinPlanLines(items: readonly string[]): string {
	return items.join("\n");
}

/** 新增条目的 id 按 `前缀-序号` 递增，避开计划里已经存在的 id。 */
export function nextDirectorEntryId(
	prefix: string,
	plan: DirectorPlan,
): string {
	const existing = new Set<string>();
	for (const arc of plan.arcs) {
		existing.add(arc.id);
		for (const sequence of arc.sequences) {
			existing.add(sequence.id);
			for (const beat of sequence.beats) existing.add(beat.id);
		}
	}
	for (let index = 1; ; index += 1) {
		const candidate = `${prefix}-${index}`;
		if (!existing.has(candidate)) return candidate;
	}
}

export function addDirectorArc(plan: DirectorPlan): DirectorPlan {
	const arc: DirectorArc = {
		id: nextDirectorEntryId("arc", plan),
		title: "",
		throughLine: "",
		difficulty: 0.5,
		redLines: [],
		sequences: [],
	};
	return { arcs: [...plan.arcs, arc] };
}

export function updateDirectorArc(
	plan: DirectorPlan,
	arcIndex: number,
	patch: Partial<
		Pick<DirectorArc, "title" | "throughLine" | "difficulty" | "redLines">
	>,
): DirectorPlan {
	return {
		arcs: plan.arcs.map((arc, index) =>
			index === arcIndex ? { ...arc, ...patch } : arc,
		),
	};
}

export function removeDirectorArc(
	plan: DirectorPlan,
	arcIndex: number,
): DirectorPlan {
	return { arcs: plan.arcs.filter((_, index) => index !== arcIndex) };
}

export function addDirectorSequence(
	plan: DirectorPlan,
	arcIndex: number,
): DirectorPlan {
	const sequence: DirectorSequence = {
		id: nextDirectorEntryId("sequence", plan),
		title: "",
		beats: [],
	};
	return {
		arcs: plan.arcs.map((arc, index) =>
			index === arcIndex
				? { ...arc, sequences: [...arc.sequences, sequence] }
				: arc,
		),
	};
}

export function updateDirectorSequence(
	plan: DirectorPlan,
	arcIndex: number,
	sequenceIndex: number,
	patch: Partial<Pick<DirectorSequence, "title">>,
): DirectorPlan {
	return {
		arcs: plan.arcs.map((arc, index) =>
			index === arcIndex
				? {
						...arc,
						sequences: arc.sequences.map((sequence, inner) =>
							inner === sequenceIndex ? { ...sequence, ...patch } : sequence,
						),
					}
				: arc,
		),
	};
}

export function removeDirectorSequence(
	plan: DirectorPlan,
	arcIndex: number,
	sequenceIndex: number,
): DirectorPlan {
	return {
		arcs: plan.arcs.map((arc, index) =>
			index === arcIndex
				? {
						...arc,
						sequences: arc.sequences.filter(
							(_, inner) => inner !== sequenceIndex,
						),
					}
				: arc,
		),
	};
}

export function addDirectorBeat(
	plan: DirectorPlan,
	arcIndex: number,
	sequenceIndex: number,
): DirectorPlan {
	const beat: DirectorBeat = {
		id: nextDirectorEntryId("beat", plan),
		goal: "",
		entrySigns: [],
		fitPoints: [],
	};
	return {
		arcs: plan.arcs.map((arc, index) =>
			index === arcIndex
				? {
						...arc,
						sequences: arc.sequences.map((sequence, inner) =>
							inner === sequenceIndex
								? { ...sequence, beats: [...sequence.beats, beat] }
								: sequence,
						),
					}
				: arc,
		),
	};
}

export function updateDirectorBeat(
	plan: DirectorPlan,
	arcIndex: number,
	sequenceIndex: number,
	beatIndex: number,
	patch: Partial<Pick<DirectorBeat, "goal" | "entrySigns" | "fitPoints">>,
): DirectorPlan {
	return {
		arcs: plan.arcs.map((arc, index) =>
			index === arcIndex
				? {
						...arc,
						sequences: arc.sequences.map((sequence, inner) =>
							inner === sequenceIndex
								? {
										...sequence,
										beats: sequence.beats.map((beat, beatIndex_) =>
											beatIndex_ === beatIndex ? { ...beat, ...patch } : beat,
										),
									}
								: sequence,
						),
					}
				: arc,
		),
	};
}

export function removeDirectorBeat(
	plan: DirectorPlan,
	arcIndex: number,
	sequenceIndex: number,
	beatIndex: number,
): DirectorPlan {
	return {
		arcs: plan.arcs.map((arc, index) =>
			index === arcIndex
				? {
						...arc,
						sequences: arc.sequences.map((sequence, inner) =>
							inner === sequenceIndex
								? {
										...sequence,
										beats: sequence.beats.filter(
											(_, beatIndex_) => beatIndex_ !== beatIndex,
										),
									}
								: sequence,
						),
					}
				: arc,
		),
	};
}

export interface TraceRow {
	readonly label: string;
	readonly value: string;
}

export interface TraceOmissionView {
	readonly blockType: string;
	readonly characters: number;
	readonly tokens: number;
}

export interface TraceHistoryView {
	readonly policy: string;
	readonly recentRawFloors: number;
	readonly omitted: readonly TraceOmissionView[];
}

export interface TraceContextEntryView {
	readonly segmentId: string;
	readonly kindLabel: string;
	readonly source: string;
	readonly tokens: number;
	readonly statusLabel: string;
	readonly appendedTo: string | null;
	readonly history: TraceHistoryView | null;
}

export interface TraceContextView {
	readonly budgetTokens: number;
	readonly totalTokens: number;
	readonly entries: readonly TraceContextEntryView[];
	readonly dropped: readonly string[];
	readonly missingSlots: readonly string[];
	readonly conditionFalse: readonly string[];
}

export interface TraceView {
	readonly turnRows: readonly TraceRow[];
	readonly llmRows: readonly TraceRow[];
	readonly toolsRows: readonly TraceRow[];
	readonly structuredRows: readonly TraceRow[];
	readonly timingRows: readonly TraceRow[];
	readonly context: TraceContextView;
}

export function buildTraceView(trace: TurnTrace): TraceView {
	return {
		turnRows: [
			{ label: "楼层", value: trace.nodeId },
			{ label: "回合模式", value: describeTurnMode(trace.turnMode) },
			{ label: "对话档位", value: describeChatProfile(trace.profile) },
			{
				label: "重 roll 原因",
				value: describeRerollReason(trace.rerollReason),
			},
			{ label: "模板", value: trace.templateId },
			{ label: "生成时间", value: trace.createdAt },
		],
		llmRows: [
			{ label: "模型", value: trace.llm.model },
			{ label: "角色", value: describeLlmRole(trace.llm.role) },
			{ label: "渠道", value: trace.llm.channel ?? "没有记录" },
			{
				label: "结束原因",
				value: describeStopReason(trace.llm.stopReason),
			},
			{ label: "finishReason", value: trace.llm.finishReason ?? "没有记录" },
			{
				label: "截断",
				value:
					trace.llm.truncations.length === 0
						? "没有"
						: trace.llm.truncations
								.map((reason) => describeTruncation(reason))
								.join("、"),
			},
			{ label: "输入 token", value: tokenText(trace.llm.usage.promptTokens) },
			{
				label: "输出 token",
				value: tokenText(trace.llm.usage.completionTokens),
			},
			{ label: "合计 token", value: tokenText(trace.llm.usage.totalTokens) },
			{
				label: "思考 token",
				value: tokenText(trace.llm.usage.reasoningTokens),
			},
			{ label: "缓存 token", value: tokenText(trace.llm.usage.cachedTokens) },
			{ label: "请求次数", value: String(trace.llm.attempts) },
			{ label: "模型轮次", value: String(trace.llm.rounds) },
			{ label: "缓存命中", value: trace.llm.cached ? "是" : "否" },
		],
		toolsRows: [
			{ label: "传输", value: describeTransport(trace.tools.transport) },
			{
				label: "读取轮次",
				value: `${trace.tools.rounds} / 软上限 ${trace.tools.maxRounds}`,
			},
			{
				label: "达到软上限",
				value: trace.tools.capped ? "是，本轮按上限收束" : "否",
			},
			{ label: "调用", value: describeToolCalls(trace.tools.calls) },
			{ label: "被拒绝", value: describeToolRejections(trace.tools.rejected) },
		],
		structuredRows: [
			{
				label: "模式",
				value: describeStructuredMode(trace.structured.mode),
			},
			{
				label: "接受 state_update",
				value: String(trace.structured.acceptedStateUpdates),
			},
			{
				label: "接受 plot_note",
				value: String(trace.structured.acceptedNotes),
			},
			{
				label: "问题",
				value:
					trace.structured.issues.length === 0
						? "没有"
						: String(trace.structured.issues.length),
			},
		],
		timingRows: [
			{
				label: "首字",
				value:
					trace.timing.firstTokenMs === null
						? "没有记录"
						: `${trace.timing.firstTokenMs} 毫秒`,
			},
			{ label: "总耗时", value: `${trace.timing.durationMs} 毫秒` },
		],
		context: {
			budgetTokens: trace.context.budgetTokens,
			totalTokens: trace.context.totalTokens,
			entries: trace.context.entries.map((entry) => ({
				segmentId: entry.segmentId,
				kindLabel: describeContextKind(entry),
				source: entry.source,
				tokens: entry.tokens,
				statusLabel: describeContextStatus(entry.status),
				appendedTo:
					entry.appendedTo === undefined ? null : "最后一条 user 消息",
				history:
					entry.history === undefined
						? null
						: {
								policy: describeBlockPolicy(entry.history.policy),
								recentRawFloors: entry.history.recentRawFloors,
								omitted: entry.history.omitted.map((omission) => ({
									blockType: omission.blockType,
									characters: omission.characters,
									tokens: omission.tokens,
								})),
							},
			})),
			dropped: trace.context.entries
				.filter((entry) => entry.status === "budget-dropped")
				.map((entry) => entry.segmentId),
			missingSlots: trace.context.entries
				.filter((entry) => entry.status === "missing-slot")
				.map((entry) => entry.segmentId),
			conditionFalse: trace.context.entries
				.filter((entry) => entry.status === "condition-false")
				.map((entry) => entry.segmentId),
		},
	};
}

export function tokenText(value: number | null): string {
	return value === null ? "没有记录" : `${value} token`;
}

export function describeTurnMode(mode: TurnMode): string {
	return mode === "fast" ? "快回合" : "深回合";
}

export function describeChatProfile(profile: ChatProfile): string {
	return profile === "native" ? "原生（全部槽位）" : "基线（naive）";
}

export function describeLlmRole(role: LlmModelRole): string {
	switch (role) {
		case "writer":
			return "正文";
		case "settler":
			return "结算";
		case "planner":
			return "规划";
		case "judge":
			return "裁判";
	}
}

export function describeStopReason(reason: LlmStopReason): string {
	switch (reason) {
		case "stop":
			return "正常结束";
		case "length":
			return "达到长度上限";
		case "toolUse":
			return "请求工具调用";
		case "error":
			return "错误";
		case "aborted":
			return "中止";
	}
}

export function describeTruncation(reason: LlmTruncationReason): string {
	switch (reason) {
		case "length":
			return "达到长度上限";
		case "unclosed_tag":
			return "标签未闭合";
		case "abrupt_end":
			return "正文突然中断";
	}
}

export function describeTransport(transport: LlmToolTransport): string {
	return transport === "native" ? "原生函数调用" : "文本协议";
}

export function describeStructuredMode(mode: StructuredOutputMode): string {
	return mode === "function-call" ? "函数调用" : "文本标签";
}

export function describeBlockPolicy(policy: string): string {
	return policy === "full" ? "完整原文" : "默认（省略显示类块）";
}

export function describeContextStatus(status: string): string {
	switch (status) {
		case "included":
			return "已注入";
		case "budget-dropped":
			return "预算裁掉";
		case "missing-slot":
			return "槽位缺失";
		case "condition-false":
			return "条件不满足";
		default:
			return status;
	}
}

function describeContextKind(
	entry: TurnTrace["context"]["entries"][number],
): string {
	if (entry.kind === "slot") {
		return entry.slot === null ? "槽位" : `槽位 ${entry.slot}`;
	}
	return "静态段";
}

function describeToolCalls(calls: TurnTrace["tools"]["calls"]): string {
	if (calls.length === 0) return "没有";
	return calls
		.map(
			(call) =>
				`${call.name} ${call.ok ? "成功" : `失败（${call.error ?? "没有原因"}）`}`,
		)
		.join("；");
}

function describeToolRejections(
	rejected: TurnTrace["tools"]["rejected"],
): string {
	if (rejected.length === 0) return "没有";
	return rejected.map((item) => `${item.name}（${item.reason}）`).join("；");
}

function openingIntensity(
	signals: JsonObject | undefined,
): DirectorIntensity | null {
	if (signals === undefined) return null;
	const opening = readObject(signals.opening);
	return opening === null ? null : readIntensity(opening.intensity);
}

function readObject(value: JsonValue | undefined): JsonObject | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value;
}

function readString(value: JsonValue | undefined): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: JsonValue | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: JsonValue | undefined): readonly string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function readIntensity(value: JsonValue | undefined): DirectorIntensity | null {
	return value === "setup" || value === "natural" || value === "detonate"
		? value
		: null;
}

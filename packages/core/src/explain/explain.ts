import type {
	ContextTraceEntry,
	RetrievalInjectionTrace,
} from "../context/assembler.js";
import {
	type ResolvedDirectorBeat,
	readDirectorPlan,
	resolveCurrentBeat,
} from "../director/plan.js";
import type { DirectorDecision } from "../director/types.js";
import type { LedgerFact } from "../ledger/read.js";
import { readLedgerFacts } from "../ledger/read.js";
import {
	DEFAULT_MAX_SCENE_FLOORS,
	type SceneBoundary,
	readSceneSegments,
} from "../ledger/scenes.js";
import type { TurnHookTraceEntry } from "../plugins/turn-hooks.js";
import type { TurnRunDetail } from "../run-log.js";
import type { StoryStore } from "../store/story-store.js";
import type { StateDiff, TimelineRole } from "../timeline.js";
import type { TurnTrace, TurnTraceCache } from "../trace.js";

/** 排障报告里的上下文分段：全部片段、被预算裁掉的片段、缺失槽位与条件不满足片段。 */
export interface ExplainContextSection {
	readonly budgetTokens: number;
	readonly totalTokens: number;
	readonly entries: readonly ContextTraceEntry[];
	readonly dropped: readonly ContextTraceEntry[];
	readonly missingSlots: readonly ContextTraceEntry[];
	readonly conditionFalse: readonly ContextTraceEntry[];
}

/** 某个分段记录的检索名次、融合结果与实际注入的楼层。 */
export interface ExplainRetrievalSection {
	readonly segmentId: string;
	readonly routes: NonNullable<ContextTraceEntry["retrieval"]>["routes"];
	readonly hits: NonNullable<ContextTraceEntry["retrieval"]>["hits"];
	readonly injectedNodeIds: readonly string[];
	readonly injected: readonly RetrievalInjectionTrace[];
}

export interface ExplainLedgerSection {
	readonly facts: readonly LedgerFact[];
	readonly diffs: readonly StateDiff[];
}

export interface ExplainDirectorSection {
	/** 决策写在哪一个楼层：生成助手楼层时写在它的父消息楼层上。 */
	readonly nodeId: string;
	readonly decision: DirectorDecision;
}

/** 一条落拍记录：结算时写下的节拍、所在楼层与程序是否已经前进。 */
export interface ExplainBeatRecord {
	readonly nodeId: string;
	readonly beatId: string;
	readonly completed: boolean;
	readonly createdAt: string;
	readonly advanced: boolean;
}

/** 当前拍与沿路径的落拍记录；没有计划时 `current` 为 null 且记录为空。 */
export interface ExplainBeatSection {
	readonly current: ResolvedDirectorBeat | null;
	readonly planBeats: number;
	readonly exhausted: boolean;
	readonly records: readonly ExplainBeatRecord[];
}

/** 一条可以照着做的修正建议，附带它依据的记录。 */
export interface ExplainSuggestion {
	readonly advice: string;
	readonly evidence: string;
}

/** 一场的归档摘要；`stale` 表示存下来的归档与当前场次划分不一致。 */
export interface ExplainSceneArchiveState {
	readonly summary: string;
	readonly stateChanges: number;
	readonly cluesOpened: number;
	readonly cluesClosed: number;
	readonly createdAt: string;
}

/** 当前路径上的一场；没有结束时 `endNodeId` 为 null。 */
export interface ExplainSceneRecord {
	readonly startNodeId: string;
	readonly endNodeId: string | null;
	readonly floorCount: number;
	readonly boundary: SceneBoundary | null;
	readonly archive: ExplainSceneArchiveState | null;
	readonly stale: boolean;
}

/** 场次是路径上的派生区间；这里给出划分与每场的归档状态。 */
export interface ExplainSceneSection {
	readonly maxSceneFloors: number;
	readonly scenes: readonly ExplainSceneRecord[];
}

export interface ExplainReport {
	readonly nodeId: string;
	readonly storyId: string;
	readonly role: TimelineRole;
	readonly trace: TurnTrace | null;
	/** 这一轮的运行日志；快回合或没有运行记录时为 null。 */
	readonly run: TurnRunDetail | null;
	readonly context: ExplainContextSection | null;
	/** 回合内钩子的耗时与跳过原因；没有记录时为空数组。 */
	readonly hooks: readonly TurnHookTraceEntry[];
	readonly retrieval: readonly ExplainRetrievalSection[];
	readonly ledger: ExplainLedgerSection;
	readonly director: ExplainDirectorSection | null;
	readonly beats: ExplainBeatSection;
	/** 当前路径的场次划分与每场归档状态。 */
	readonly scenes: ExplainSceneSection;
	/** 某一部分没有记录时的明确说明。 */
	readonly notes: readonly string[];
	readonly suggestions: readonly ExplainSuggestion[];
}

/**
 * 只读排障：解释一个楼层的 Trace、上下文分段与检索、台账与导演决策。
 * 不写楼层、不改变 head、不调用模型。
 */
export function explainNode(
	store: Pick<
		StoryStore,
		| "getNode"
		| "getTurnTrace"
		| "getStateDiffs"
		| "getDirectorDecision"
		| "getStateSnapshot"
		| "getStateDiffsAlongPath"
		| "getTurnRunForNode"
		| "listTurnRunEvents"
		| "listDirectorPlanEntries"
		| "listDirectorBeatStatesAlongPath"
		| "getPathToNode"
		| "getSceneLog"
		| "getSceneArchive"
	>,
	nodeId: string,
): ExplainReport {
	if (typeof nodeId !== "string" || nodeId.length === 0) {
		throw new Error("排障必须指定楼层节点 id");
	}
	const node = store.getNode(nodeId);
	if (!node) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	const trace = store.getTurnTrace(nodeId);
	const runRecord = store.getTurnRunForNode(nodeId);
	const run: TurnRunDetail | null =
		runRecord === null
			? null
			: {
					run: runRecord,
					events: store.listTurnRunEvents(runRecord.runId),
				};
	const context = trace === null ? null : buildContextSection(trace);
	const retrieval =
		context === null
			? []
			: context.entries.flatMap((entry): ExplainRetrievalSection[] => {
					if (entry.retrieval === undefined) return [];
					return [
						{
							segmentId: entry.segmentId,
							routes: entry.retrieval.routes,
							hits: entry.retrieval.hits,
							injectedNodeIds: entry.retrieval.injectedNodeIds,
							injected: entry.retrieval.injected ?? [],
						},
					];
				});
	const decisionNodeId =
		node.role === "assistant" ? (node.parentId ?? node.id) : node.id;
	const decision = store.getDirectorDecision(decisionNodeId);
	const notes: string[] = [];
	if (trace === null) {
		notes.push(
			node.role === "assistant"
				? `楼层 ${nodeId} 没有 Trace：这一楼不是生成出来的助手楼层，或者生成被中止；上下文与检索无法解释。`
				: `楼层 ${nodeId} 是消息楼层，不保存 Trace；请指定它之后的助手楼层查看生成记录。`,
		);
	}
	if (decision === null) {
		notes.push(
			`楼层 ${decisionNodeId} 没有导演决策记录：导演关闭，或者这一轮没有评估导演。`,
		);
	}
	const report: ExplainReport = {
		nodeId,
		storyId: node.storyId,
		role: node.role,
		trace,
		run,
		context,
		hooks: trace?.hooks ?? [],
		retrieval,
		ledger: {
			facts: readLedgerFacts(store, nodeId),
			diffs: store.getStateDiffs(nodeId),
		},
		director: decision === null ? null : { nodeId: decisionNodeId, decision },
		beats: buildBeatSection(store, node.storyId, nodeId),
		scenes: buildSceneSection(store, nodeId),
		notes,
		suggestions: [],
	};
	return { ...report, suggestions: buildSuggestions(report) };
}

function buildSceneSection(
	store: Pick<
		StoryStore,
		"getNode" | "getPathToNode" | "getSceneLog" | "getSceneArchive"
	>,
	nodeId: string,
): ExplainSceneSection {
	const segments = readSceneSegments(store, nodeId, DEFAULT_MAX_SCENE_FLOORS);
	const scenes = segments.map((segment): ExplainSceneRecord => {
		if (segment.endNodeId === null) {
			return {
				startNodeId: segment.startNodeId,
				endNodeId: null,
				floorCount: segment.floorIds.length,
				boundary: null,
				archive: null,
				stale: false,
			};
		}
		const archive = store.getSceneArchive(segment.endNodeId);
		if (archive === null) {
			return {
				startNodeId: segment.startNodeId,
				endNodeId: segment.endNodeId,
				floorCount: segment.floorIds.length,
				boundary: segment.boundary,
				archive: null,
				stale: false,
			};
		}
		const stale =
			archive.startNodeId !== segment.startNodeId ||
			archive.floorCount !== segment.floorIds.length ||
			archive.boundary !== segment.boundary;
		return {
			startNodeId: segment.startNodeId,
			endNodeId: segment.endNodeId,
			floorCount: segment.floorIds.length,
			boundary: segment.boundary,
			archive: {
				summary: archive.summary,
				stateChanges: archive.stateChanges.length,
				cluesOpened: archive.cluesOpened.length,
				cluesClosed: archive.cluesClosed.length,
				createdAt: archive.createdAt,
			},
			stale,
		};
	});
	return { maxSceneFloors: DEFAULT_MAX_SCENE_FLOORS, scenes };
}

function buildBeatSection(
	store: Pick<
		StoryStore,
		"getNode" | "listDirectorPlanEntries" | "listDirectorBeatStatesAlongPath"
	>,
	storyId: string,
	nodeId: string,
): ExplainBeatSection {
	const plan = readDirectorPlan(store, storyId);
	const order: string[] = [];
	for (const arc of plan.arcs) {
		for (const sequence of arc.sequences) {
			for (const beat of sequence.beats) {
				order.push(beat.id);
			}
		}
	}
	if (order.length === 0) {
		return { current: null, planBeats: 0, exhausted: false, records: [] };
	}
	const current = resolveCurrentBeat(store, storyId, nodeId);
	const currentIndex = current === null ? null : order.indexOf(current.beat.id);
	const rows = [...store.listDirectorBeatStatesAlongPath(nodeId)].reverse();
	const records = rows.map((row, index): ExplainBeatRecord => {
		const beatIndex = order.indexOf(row.beatId);
		const laterBeats = rows
			.slice(index + 1)
			.map((later) => order.indexOf(later.beatId));
		const advanced =
			beatIndex !== -1 &&
			((currentIndex !== null && currentIndex > beatIndex) ||
				laterBeats.some((later) => later > beatIndex) ||
				(current === null && index === rows.length - 1 && row.completed));
		return {
			nodeId: row.nodeId,
			beatId: row.beatId,
			completed: row.completed,
			createdAt: row.createdAt,
			advanced,
		};
	});
	return {
		current,
		planBeats: order.length,
		exhausted: current === null,
		records,
	};
}

function buildContextSection(trace: TurnTrace): ExplainContextSection {
	const entries = trace.context.entries;
	return {
		budgetTokens: trace.context.budgetTokens,
		totalTokens: trace.context.totalTokens,
		entries,
		dropped: entries.filter((entry) => entry.status === "budget-dropped"),
		missingSlots: entries.filter((entry) => entry.status === "missing-slot"),
		conditionFalse: entries.filter(
			(entry) => entry.status === "condition-false",
		),
	};
}

function buildSuggestions(report: ExplainReport): ExplainSuggestion[] {
	const suggestions: ExplainSuggestion[] = [];
	const trace = report.trace;
	const context = report.context;
	if (trace === null) {
		suggestions.push({
			advice:
				report.role === "assistant"
					? "重新生成这一楼，或者改用有 Trace 的助手楼层排障。"
					: "排障请指定消息楼层之后的助手楼层。",
			evidence: `楼层 ${report.nodeId} 没有 traces 记录`,
		});
	} else {
		if (trace.llm.truncations.length > 0) {
			suggestions.push({
				advice: `本楼回复被截断（${trace.llm.truncations.join("、")}）；可提高故事设置 maxTokens，或缩短要求的篇幅后重新生成。`,
				evidence: `Trace llm.stopReason=${trace.llm.stopReason}、llm.truncations=${JSON.stringify(trace.llm.truncations)}`,
			});
		}
		if (trace.tools.capped) {
			suggestions.push({
				advice: `读取工具达到软上限 ${trace.tools.maxRounds} 轮并提前收束；可在故事设置里提高 maxReadRounds。`,
				evidence: `Trace tools.rounds=${trace.tools.rounds}、tools.maxRounds=${trace.tools.maxRounds}、tools.capped=true`,
			});
		}
		if (trace.structured.issues.length > 0) {
			suggestions.push({
				advice:
					"结构化输出有被拒绝的条目，对应事实没有写进台账；修正输出格式后重新生成，或运行后台结算器补写。",
				evidence: `Trace structured.issues=${JSON.stringify(trace.structured.issues)}`,
			});
		}
	}
	if (context !== null) {
		if (context.dropped.length > 0) {
			const candidate = context.entries.reduce(
				(total, entry) => total + entry.tokens,
				0,
			);
			suggestions.push({
				advice: `预算裁剪丢掉了 ${context.dropped.length} 段（${context.dropped
					.map((entry) => entry.segmentId)
					.join(
						"、",
					)}）；可提高 budgetTokens，或降低这些段落的优先级、压缩内容。`,
				evidence: `Trace context.budgetTokens=${context.budgetTokens}，候选合计 ${candidate} token，实际注入 ${context.totalTokens} token`,
			});
		}
		if (context.missingSlots.length > 0 && trace?.profile !== "naive") {
			suggestions.push({
				advice: `槽位 ${context.missingSlots
					.map((entry) => entry.segmentId)
					.join(
						"、",
					)} 没有内容；检查素材是否已导入，并运行 \`dramaticer work\` 补齐后台任务。`,
				evidence: "Trace context.entries 里这些片段的 status=missing-slot",
			});
		}
	}
	for (const hook of report.hooks) {
		if (hook.outcome !== "timeout") continue;
		const label =
			hook.extension === "context.slot"
				? `槽位 ${hook.hook}`
				: `请求改写的 ${hook.hook}`;
		suggestions.push({
			advice: `${label} 的钩子（插件 ${hook.plugin}）超过时间预算被跳过，这一轮按缺失处理；检查该插件的耗时，或提高回合钩子的时间预算。`,
			evidence: `Trace hooks 里 outcome=timeout，耗时 ${hook.durationMs} 毫秒，原因：${hook.reason ?? "没有记录"}`,
		});
	}
	for (const hook of report.hooks) {
		for (const template of hook.templates ?? []) {
			if (template.outcome !== "timeout") continue;
			suggestions.push({
				advice: `${hook.plugin} 的模板「${template.source}」超过时间预算被跳过，这一条按空内容处理；检查模板里的循环与远程调用，或提高回合钩子的时间预算。`,
				evidence: `Trace hooks 里模板 outcome=timeout，耗时 ${template.durationMs} 毫秒，调用函数：${template.functions.length === 0 ? "无" : template.functions.join("、")}，原因：${template.reason ?? "没有记录"}`,
			});
		}
	}
	for (const section of report.retrieval) {
		if (section.hits.length === 0) {
			const routes =
				section.routes.length === 0
					? "无"
					: section.routes
							.map((route) => `${route.route} ${route.items.length} 条`)
							.join("、");
			suggestions.push({
				advice:
					"记忆检索没有命中任何条目；可把关键事实写进台账，或让它在最近的正文里再次出现。",
				evidence: `分段 ${section.segmentId} 的 retrieval.hits 为空，各路候选：${routes}`,
			});
			continue;
		}
		const injected = new Set(section.injectedNodeIds);
		const skipped = section.hits.filter((hit) => !injected.has(hit.nodeId));
		if (skipped.length > 0) {
			suggestions.push({
				advice: `检索命中但没有注入 ${skipped.length} 条（${skipped
					.map((hit) => hit.nodeId)
					.join("、")}）；这些楼层的 prompt 视图是空的，可检查楼层原文。`,
				evidence: `分段 ${section.segmentId} 的 retrieval.injectedNodeIds 少于 retrieval.hits`,
			});
		}
	}
	if (trace !== null && report.ledger.diffs.length === 0) {
		suggestions.push({
			advice:
				"本楼没有台账写入；如果模型本该输出状态，检查结构化输出模式，或运行后台结算器补写。",
			evidence: `getStateDiffs(${report.nodeId}) 返回 0 条`,
		});
	}
	if (trace !== null && report.director === null) {
		suggestions.push({
			advice:
				"本轮没有导演决策；检查故事设置的导演开关，或模板里是否保留了 director 槽位。",
			evidence: `楼层 ${report.nodeId} 有 Trace，但它对应的消息楼层没有 director_decisions 记录`,
		});
	}
	return suggestions;
}

function statusLabel(status: ContextTraceEntry["status"]): string {
	switch (status) {
		case "included":
			return "已注入";
		case "budget-dropped":
			return "预算裁掉";
		case "missing-slot":
			return "槽位缺失";
		case "condition-false":
			return "条件不满足";
	}
}

function describeCache(cache: TurnTraceCache | undefined): string {
	if (cache === undefined) return "   缓存：没有记录。";
	if (cache.source === "none") {
		return `   缓存：渠道没有报告缓存字段（输入 ${cache.promptTokens ?? "没有记录"} token）。`;
	}
	return `   缓存：命中 ${cache.hitTokens ?? "没有记录"} / 输入 ${cache.promptTokens ?? "没有记录"} token（来源 ${cache.source}）。`;
}

function describeSegmentOrder(trace: TurnTrace | null): string {
	if (
		trace === null ||
		trace.layout === undefined ||
		trace.segmentOrder === undefined
	) {
		return "   段落顺序：没有记录。";
	}
	return `   段落顺序：${trace.layout}（${trace.segmentOrder.join(" → ")}）`;
}

/** 把排障报告渲染成中文文本；字段顺序与 `ExplainReport` 一致。 */
export function renderExplainReport(report: ExplainReport): string {
	const lines: string[] = [];
	const roleLabel =
		report.role === "assistant"
			? "助手楼层"
			: report.role === "user"
				? "消息楼层"
				: "系统楼层";
	lines.push(`楼层 ${report.nodeId}（${roleLabel}，故事 ${report.storyId}）`);

	lines.push("");
	lines.push("1. 这一轮用的模型与结果");
	const trace = report.trace;
	if (trace === null) {
		lines.push("   没有记录（该楼层没有 Trace）。");
	} else {
		const toolCalls =
			trace.tools.calls.length === 0
				? "没有"
				: trace.tools.calls
						.map(
							(call) =>
								`${call.name} ${call.ok ? "成功" : `失败（${call.error ?? "没有原因"}）`}`,
						)
						.join("、");
		lines.push(
			`   模型：${trace.llm.model}（角色 ${trace.llm.role}，渠道 ${trace.llm.channel ?? "没有记录"}）`,
		);
		lines.push(
			`   模板：${trace.templateId}；模式：${trace.turnMode}；档位：${trace.profile}`,
		);
		if (trace.run !== null) {
			lines.push(
				`   运行：${trace.run.runId}（${trace.run.status}，事件 ${trace.run.eventCount} 条）`,
			);
		}
		lines.push(
			`   结束原因：${trace.llm.stopReason}（${trace.llm.finishReason ?? "没有记录"}）；截断：${
				trace.llm.truncations.length === 0
					? "没有"
					: trace.llm.truncations.join("、")
			}`,
		);
		lines.push(
			`   用量：输入 ${trace.llm.usage.promptTokens ?? "没有记录"} / 输出 ${trace.llm.usage.completionTokens ?? "没有记录"} / 合计 ${trace.llm.usage.totalTokens ?? "没有记录"} token；请求 ${trace.llm.attempts} 次，模型轮次 ${trace.llm.rounds}`,
		);
		lines.push(describeCache(trace.cache));
		lines.push(
			`   耗时：首字 ${trace.timing.firstTokenMs === null ? "没有记录" : `${trace.timing.firstTokenMs} 毫秒`}，总计 ${trace.timing.durationMs} 毫秒`,
		);
		lines.push(
			`   工具：传输 ${trace.tools.transport}，读取 ${trace.tools.rounds}/${trace.tools.maxRounds} 轮${trace.tools.capped ? "（达到软上限）" : ""}；调用 ${toolCalls}；拒绝 ${trace.tools.rejected.length} 次`,
		);
		lines.push(
			`   结构化输出：${trace.structured.mode}，接受 state_update ${trace.structured.acceptedStateUpdates} 条、plot_note ${trace.structured.acceptedNotes} 条，问题 ${trace.structured.issues.length} 条`,
		);
	}

	lines.push("");
	lines.push("2. 上下文分段与 token");
	const context = report.context;
	if (context === null) {
		lines.push("   没有记录。");
	} else {
		lines.push(
			`   合计 ${context.totalTokens} token，预算 ${context.budgetTokens} token`,
		);
		lines.push(describeSegmentOrder(trace));
		if (context.entries.length === 0) lines.push("   没有记录。");
		for (const entry of context.entries) {
			const kindLabel =
				entry.kind === "slot"
					? `槽位 ${entry.slot}`
					: entry.kind === "static"
						? "静态段"
						: entry.kind;
			const history =
				entry.history === undefined
					? ""
					: `；块视图 ${entry.history.policy}，最近 ${entry.history.recentRawFloors} 楼保留原文，省略 ${entry.history.omitted.length} 类块`;
			const appended =
				entry.appendedTo === undefined
					? ""
					: `；拼接到最后一条 user 消息（appendedTo: ${entry.appendedTo}）`;
			lines.push(
				`   - ${entry.segmentId}（${kindLabel}）${entry.tokens} token，${statusLabel(entry.status)}，来源 ${entry.source}${appended}${history}`,
			);
			if (entry.history !== undefined) {
				for (const omission of entry.history.omitted) {
					lines.push(
						`       省略块 ${omission.blockType} ${omission.characters} 字符、约 ${omission.tokens} token`,
					);
				}
			}
		}
	}

	lines.push("");
	lines.push("3. 被裁剪的段落与缺失槽位");
	if (context === null) {
		lines.push("   没有记录。");
	} else {
		const describe = (entries: readonly ContextTraceEntry[]): string =>
			entries.length === 0
				? "没有"
				: entries
						.map(
							(entry) =>
								`${entry.segmentId}（${entry.tokens} token，来源 ${entry.source}）`,
						)
						.join("、");
		lines.push(`   预算裁剪：${describe(context.dropped)}`);
		lines.push(`   缺失槽位：${describe(context.missingSlots)}`);
		lines.push(`   条件不满足：${describe(context.conditionFalse)}`);
	}

	lines.push("");
	lines.push("   回合钩子（时间预算与跳过原因）：");
	if (report.hooks.length === 0) {
		lines.push("     没有记录。");
	} else {
		const skipped = report.hooks.filter(
			(hook) => hook.outcome === "timeout",
		).length;
		lines.push(`     运行 ${report.hooks.length} 个，超时跳过 ${skipped} 个`);
		for (const hook of report.hooks) {
			const label =
				hook.extension === "context.slot"
					? `槽位 ${hook.hook}`
					: `请求改写 ${hook.hook}`;
			const outcome = hook.outcome === "ok" ? "正常" : "超时跳过，按缺失处理";
			lines.push(
				`     - ${label}（插件 ${hook.plugin}）：${outcome}，${hook.durationMs} 毫秒${hook.reason === null ? "" : `，原因：${hook.reason}`}`,
			);
			for (const template of hook.templates ?? []) {
				const templateOutcome =
					template.outcome === "ok" ? "正常" : "超时跳过，按空内容处理";
				const functions =
					template.functions.length === 0
						? ""
						: `，调用函数：${template.functions.join("、")}`;
				lines.push(
					`       模板 ${template.source}：${templateOutcome}，${template.durationMs} 毫秒${functions}${template.reason === null ? "" : `，原因：${template.reason}`}`,
				);
			}
		}
	}

	lines.push("");
	lines.push("4. 记忆检索的每一路名次与融合结果");
	if (report.retrieval.length === 0) {
		lines.push("   没有记录（本轮没有记忆检索，或者记忆槽位没有返回内容）。");
	}
	for (const section of report.retrieval) {
		lines.push(`   分段 ${section.segmentId}：`);
		for (const route of section.routes) {
			const items =
				route.items.length === 0
					? "没有候选"
					: route.items
							.map(
								(item, index) =>
									`${item.nodeId}（${item.kind}，第 ${index + 1}）`,
							)
							.join("、");
			lines.push(`     路 ${route.route}：${items}`);
		}
		if (section.hits.length === 0) lines.push("     融合：没有命中");
		for (const hit of section.hits) {
			const sources = hit.sources
				.map((source) => `${source.route} 第 ${source.rank}`)
				.join("、");
			const injection = section.injected.find(
				(item) => item.nodeId === hit.nodeId,
			);
			const scope =
				injection === undefined
					? ""
					: injection.scope === "segment"
						? "，注入父段"
						: "，注入整楼";
			lines.push(
				`     融合：${hit.nodeId}（${hit.kind}）分数 ${hit.score.toFixed(4)}，来自 ${sources}${scope}${section.injectedNodeIds.includes(hit.nodeId) ? "，已注入" : "，未注入"}`,
			);
		}
	}

	lines.push("");
	lines.push("5. 台账快照与本楼写入");
	lines.push(`   快照事实 ${report.ledger.facts.length} 条：`);
	if (report.ledger.facts.length === 0) lines.push("     没有记录。");
	for (const fact of report.ledger.facts) {
		const time =
			fact.storyTime === null
				? ""
				: `，故事时间 ${fact.storyTime.start ?? "?"} 到 ${fact.storyTime.end ?? "?"}`;
		lines.push(
			`     - ${fact.path.join(".")} = ${JSON.stringify(fact.value)}（来源 ${fact.source}，写入楼层 ${fact.nodeId}${time}）`,
		);
	}
	lines.push(`   本楼写入 ${report.ledger.diffs.length} 条：`);
	if (report.ledger.diffs.length === 0) lines.push("     没有记录。");
	for (const diff of report.ledger.diffs) {
		const value = diff.op === "set" ? ` ${JSON.stringify(diff.value)}` : "";
		const reason = diff.reason === null ? "" : `，原因 ${diff.reason}`;
		const confidence =
			diff.confidence === null ? "" : `，置信度 ${diff.confidence}`;
		lines.push(
			`     - ${diff.path.join(".")} ${diff.op}${value}（来源 ${diff.source}${confidence}${reason}）`,
		);
	}

	lines.push("");
	lines.push("6. 导演决策");
	if (report.director === null) {
		lines.push("   没有记录。");
	} else {
		lines.push(`   决策写在楼层 ${report.director.nodeId}`);
		lines.push(
			`   指令：${report.director.decision.directive ?? "没有建议（没有机制触发）"}`,
		);
		lines.push("   机制：");
		for (const mechanism of report.director.decision.mechanisms) {
			lines.push(
				`     - ${mechanism.name}：${mechanism.triggered ? "触发" : "未触发"}，${mechanism.reason}`,
			);
		}
		lines.push(`   信号：${JSON.stringify(report.director.decision.signals)}`);
	}

	lines.push("");
	lines.push("7. 当前拍与落拍记录");
	const beats = report.beats;
	if (beats.planBeats === 0) {
		lines.push("   没有记录（故事还没有导演计划）。");
	} else if (beats.current === null) {
		lines.push(`   当前拍：没有（计划里的 ${beats.planBeats} 拍已经走完）。`);
	} else {
		lines.push(
			`   当前拍：${beats.current.beat.id}（弧线 ${beats.current.arc.id}，序列 ${beats.current.sequence.id}）目标：${beats.current.beat.goal}`,
		);
		lines.push(
			`   计划里共 ${beats.planBeats} 拍，已完成 ${beats.records.filter((record) => record.completed).length} 条记录。`,
		);
	}
	if (beats.records.length === 0) {
		lines.push("   落拍记录：没有记录。");
	} else {
		lines.push("   落拍记录：");
		for (const record of beats.records) {
			lines.push(
				`     - 楼层 ${record.nodeId}，节拍 ${record.beatId}，${record.completed ? "已完成" : "未完成"}，${record.advanced ? "已前进到下一拍" : "停在原地"}（写下于 ${record.createdAt}）`,
			);
		}
	}

	lines.push("");
	lines.push("8. 修正建议");
	if (report.suggestions.length === 0) {
		lines.push("   没有需要修正的地方。");
	}
	for (const suggestion of report.suggestions) {
		lines.push(`   - ${suggestion.advice}`);
		lines.push(`     证据：${suggestion.evidence}`);
	}

	lines.push("");
	lines.push("9. 运行时间线");
	if (report.run === null) {
		lines.push(
			"   没有记录（快回合不写运行日志，或者这一楼不是深回合提交的助手楼层）。",
		);
	} else {
		const run = report.run.run;
		lines.push(
			`   运行 ${run.runId}：模式 ${run.mode}，状态 ${run.status}，开始 ${run.startedAt}，结束 ${run.finishedAt ?? "没有结束"}`,
		);
		if (report.run.events.length === 0) {
			lines.push("   没有事件。");
		}
		for (const event of report.run.events) {
			lines.push(
				`   - #${event.seq} ${event.kind}：${JSON.stringify(event.payload)}`,
			);
		}
	}

	lines.push("");
	lines.push("10. 场次划分与归档");
	const sceneSection = report.scenes;
	const openScenes = sceneSection.scenes.filter(
		(scene) => scene.endNodeId === null,
	).length;
	lines.push(
		`   每场最多 ${sceneSection.maxSceneFloors} 楼，共 ${sceneSection.scenes.length} 场，其中 ${openScenes} 场进行中。`,
	);
	if (sceneSection.scenes.length === 0) {
		lines.push("   没有记录（当前路径上没有助手楼层）。");
	}
	for (const [index, scene] of sceneSection.scenes.entries()) {
		const range =
			scene.endNodeId === null
				? `楼层 ${scene.startNodeId} 起`
				: `楼层 ${scene.startNodeId} 到 ${scene.endNodeId}`;
		const boundary =
			scene.boundary === null
				? "进行中"
				: scene.boundary === "scene-ends"
					? "场记判定结束"
					: "达到楼层上限";
		let status: string;
		if (scene.endNodeId === null) {
			status = "还没有归档";
		} else if (scene.archive === null) {
			status = "待归档";
		} else if (scene.stale) {
			status = "归档与当前划分不一致，待重新归档";
		} else {
			status = `已归档（摘要 ${scene.archive.summary.length} 字，状态变化 ${scene.archive.stateChanges} 条，开了线索 ${scene.archive.cluesOpened} 条、收了 ${scene.archive.cluesClosed} 条，写于 ${scene.archive.createdAt}）`;
		}
		lines.push(
			`   - 场次 ${index + 1}：${range}（${scene.floorCount} 楼，${boundary}），${status}`,
		);
	}

	if (report.notes.length > 0) {
		lines.push("");
		for (const note of report.notes) lines.push(`注：${note}`);
	}
	return lines.join("\n");
}

import type {
	PlaytestPreferenceKind,
	PlaytestRecord,
	PlaytestRoundRecord,
	PlaytestRunResult,
} from "./records";
import {
	PLAYTEST_PREFERENCE_KINDS,
	isPlaytestFailureRecord,
	isPlaytestRoundRecord,
} from "./records";
import type { PlaytestAggregate } from "./stats";

/** 只出现在私有报告里的故事信息；统计版不得包含任何一项。 */
export interface PlaytestPrivateContext {
	readonly storyId: string;
	readonly storyTitle: string;
	readonly characterNames: readonly string[];
	readonly dbPath: string;
	readonly channelsPath: string;
}

export interface PlaytestIdentifierScan {
	readonly identifiers: number;
	readonly matches: readonly string[];
}

const MIN_IDENTIFIER_LENGTH = 6;
const MIN_TEXT_LINE_LENGTH = 12;

export function renderPrivateReport(input: {
	readonly result: PlaytestRunResult;
	readonly aggregate: PlaytestAggregate;
	readonly context: PlaytestPrivateContext;
}): string {
	const { result, aggregate, context } = input;
	const lines: string[] = [
		"# 自动试玩私有报告",
		"",
		`- 故事：${context.storyTitle}（\`${context.storyId}\`）`,
		`- 数据库：\`${context.dbPath}\``,
		`- 渠道配置：\`${context.channelsPath}\``,
		`- 模型：正文 \`${result.meta.writerModel}\`，后台 \`${result.meta.backgroundModel}\``,
		`- 视口：${result.meta.viewport}`,
		`- 时间：${result.meta.startedAt} 至 ${result.meta.finishedAt}`,
		`- 设定轮数：${result.meta.rounds}；成功 ${aggregate.succeededRounds} 轮，失败 ${aggregate.failedRounds} 轮`,
		`- 操作排期：swipe ${formatList(result.meta.schedule.swipeAt)}；edit ${formatList(result.meta.schedule.editAt)}；branch ${formatList(result.meta.schedule.branchAt)}；候选行动 ${formatList(result.meta.schedule.candidateAt)}；选项 ${formatList(result.meta.schedule.optionAt)}`,
		"",
		"## 偏好信号",
		"",
		"| 种类 | 条数 |",
		"|---|---|",
		...PLAYTEST_PREFERENCE_KINDS.map(
			(kind) => `| ${kind} | ${result.preferenceCounts[kind]} |`,
		),
		"",
	];
	const opening = result.records
		.filter(isPlaytestRoundRecord)
		.find((round) => round.openingCandidates !== null)?.openingCandidates;
	lines.push("## 开场候选", "");
	lines.push(
		opening === null || opening === undefined
			? "没有记录到开场候选的显示结果。"
			: `显示 ${opening.count} 条；面板可见：${opening.visible ? "是" : "否"}。`,
	);
	lines.push("");
	const failures = result.records.filter(isPlaytestFailureRecord);
	if (failures.length > 0) {
		lines.push("## 失败", "");
		for (const failure of failures) {
			lines.push(
				`- 第 ${failure.round} 轮 \`${failure.stepId}\`：${failure.error}（截图 \`${failure.screenshot}\`）`,
			);
		}
		lines.push("");
	}
	lines.push("## 逐轮记录", "");
	for (const record of result.records) {
		if (isPlaytestRoundRecord(record)) lines.push(...renderRound(record));
	}
	return `${lines.join("\n")}\n`;
}

function renderRound(record: PlaytestRoundRecord): string[] {
	const lines: string[] = [
		`### 第 ${record.round} 轮`,
		"",
		`- 用户楼层：\`${record.userNodeId}\`；助手楼层：\`${record.assistantNodeId}\``,
		`- 回合模式：${record.turnMode}；首字 ${formatMs(record.firstTokenMs)}；耗时 ${formatMs(record.durationMs)}`,
		`- 用量：prompt ${formatNumber(record.usage.promptTokens)}，completion ${formatNumber(record.usage.completionTokens)}，total ${formatNumber(record.usage.totalTokens)}，reasoning ${formatNumber(record.usage.reasoningTokens)}`,
		`- 台账 diff：${record.ledgerDiffCount}；新线索 ${record.newClueIds.length}；兑现 ${record.fulfilledClueIds.length}`,
	];
	lines.push(
		record.director === null
			? "- 导演：没有决策记录"
			: `- 导演指令：${record.director.directive ?? "（无）"}；机制：${
					record.director.mechanisms
						.map(
							(mechanism) =>
								`${mechanism.name}${mechanism.triggered ? "（触发）" : "（未触发）"}`,
						)
						.join("、") || "（无）"
				}`,
	);
	if (record.candidateActions !== null) {
		lines.push(
			`- 候选行动：显示 ${record.candidateActions.count} 条；点击填入${record.candidateActions.pickedText === null ? "无" : `「${record.candidateActions.pickedText}」`}`,
		);
	}
	if (record.openingCandidates !== null) {
		lines.push(
			`- 开场候选：显示 ${record.openingCandidates.count} 条；面板可见：${record.openingCandidates.visible ? "是" : "否"}`,
		);
	}
	if (record.background !== null) {
		lines.push(
			`- 后台任务：待办 ${record.background.pending}，执行中 ${record.background.running}，失败 ${record.background.failed}`,
		);
	}
	for (const operation of record.operations) {
		const detail = operation.text === null ? "" : `：${operation.text}`;
		lines.push(
			`- 操作 ${operation.kind}（\`${operation.stepId}\`）\`${operation.fromNodeId}\` → \`${operation.toNodeId}\`${detail}`,
		);
	}
	lines.push(`- 截图：\`${record.screenshot}\``, "");
	lines.push("用户原文：", "", "```", record.user, "```", "");
	lines.push("助手原文：", "", "```", record.assistant, "```", "");
	return lines;
}

export function renderStatsReport(input: {
	readonly result: PlaytestRunResult;
	readonly aggregate: PlaytestAggregate;
	readonly scan: PlaytestIdentifierScan;
}): string {
	const { result, aggregate, scan } = input;
	const lines: string[] = [
		"# 自动试玩统计报告",
		"",
		"> 统计版不包含故事名、角色名、原文与题目文本；模型别名、配置与样本数允许出现。",
		"",
		"## 运行信息",
		"",
		`- 模型别名：正文 \`${result.meta.writerModel}\`，后台 \`${result.meta.backgroundModel}\``,
		`- 视口：${result.meta.viewport}`,
		`- 设定轮数：${aggregate.requestedRounds}；成功 ${aggregate.succeededRounds} 轮；失败 ${aggregate.failedRounds} 轮`,
		`- 操作排期：swipe ${formatList(result.meta.schedule.swipeAt)}；edit ${formatList(result.meta.schedule.editAt)}；branch ${formatList(result.meta.schedule.branchAt)}；候选行动 ${formatList(result.meta.schedule.candidateAt)}；选项 ${formatList(result.meta.schedule.optionAt)}`,
		`- 私有标识反向扫描：${scan.matches.length === 0 ? `通过（${scan.identifiers} 个标识）` : `失败（${scan.matches.length} 处）`}`,
		"",
		"## 指标",
		"",
		"| 指标 | 数值 | 样本 |",
		"|---|---|---|",
		`| 轮数 | ${aggregate.succeededRounds} 成功 / ${aggregate.failedRounds} 失败 | ${aggregate.requestedRounds} 设定 |`,
		"| 对比胜率 | 未证实 | 没有两两对比样本 |",
		"| 矛盾率 | 未证实 | 没有一致性探针样本 |",
		`| 相邻块 Jaccard 均值 | ${formatDecimal(aggregate.jaccard.mean, 4)} | ${aggregate.jaccard.count} 对 |`,
		`| 相邻块 Jaccard P90 | ${formatDecimal(aggregate.jaccard.p90, 4)} | ${aggregate.jaccard.count} 对 |`,
		"| 节拍余弦 | 未证实 | 没有楼层向量 |",
		`| 首字延迟 P50（毫秒） | ${formatInteger(aggregate.firstToken.p50)} | ${aggregate.firstToken.count} 轮 |`,
		`| 首字延迟 P95（毫秒） | ${formatInteger(aggregate.firstToken.p95)} | ${aggregate.firstToken.count} 轮 |`,
		`| 生成耗时 P50（毫秒） | ${formatInteger(aggregate.duration.p50)} | ${aggregate.duration.count} 轮 |`,
		`| 生成耗时 P95（毫秒） | ${formatInteger(aggregate.duration.p95)} | ${aggregate.duration.count} 轮 |`,
		`| 每轮 prompt token | ${formatDecimal(aggregate.tokens.promptPerRound, 1)} | ${aggregate.tokens.roundsWithUsage} 轮 |`,
		`| 每轮 completion token | ${formatDecimal(aggregate.tokens.completionPerRound, 1)} | ${aggregate.tokens.roundsWithUsage} 轮 |`,
		`| 每轮 total token | ${formatDecimal(aggregate.tokens.totalPerRound, 1)} | ${aggregate.tokens.roundsWithUsage} 轮 |`,
		`| 每轮 reasoning token | ${formatInteger(
			aggregate.tokens.roundsWithUsage === 0
				? null
				: aggregate.tokens.reasoningTotal / aggregate.tokens.roundsWithUsage,
		)} | ${aggregate.tokens.roundsWithUsage} 轮 |`,
		`| 导演决策数 | ${aggregate.director.decisions} | ${aggregate.succeededRounds} 轮 |`,
		`| 导演有建议的轮数 | ${aggregate.director.directives} | ${aggregate.director.decisions} 次决策 |`,
		`| 新建线索 | ${aggregate.clues.opened} | ${aggregate.succeededRounds} 轮 |`,
		`| 兑现线索 | ${aggregate.clues.fulfilled} | ${aggregate.succeededRounds} 轮 |`,
		`| 兑现率 | ${aggregate.clues.fulfillmentRate === null ? "未证实" : `${formatDecimal(aggregate.clues.fulfillmentRate * 100, 1)}%`} | ${aggregate.clues.opened} 条新线索 |`,
		`| 兑现平均年龄（轮） | ${formatDecimal(aggregate.clues.meanAge, 2)} | ${aggregate.clues.agedFulfillments} 次兑现 |`,
		`| 错误数 | ${aggregate.errors.count} | ${aggregate.errors.steps.length} 个复现步骤编号 |`,
		...PLAYTEST_PREFERENCE_KINDS.map(
			(kind: PlaytestPreferenceKind) =>
				`| 偏好信号 ${kind} | ${aggregate.preferenceCounts[kind]} | preference_events |`,
		),
		"",
	];
	if (aggregate.director.mechanisms.length > 0) {
		lines.push(
			"## 导演机制命中",
			"",
			"| 机制 | 触发 | 决策 |",
			"|---|---|---|",
			...aggregate.director.mechanisms.map(
				(mechanism) =>
					`| ${mechanism.name} | ${mechanism.triggered} | ${mechanism.total} |`,
			),
			"",
		);
	}
	if (aggregate.errors.steps.length > 0) {
		lines.push(
			"## 错误与复现步骤",
			"",
			...aggregate.errors.steps.map((step) => `- \`${step}\``),
			"",
		);
	}
	return `${lines.join("\n")}\n`;
}

/** 收集只应出现在私有报告里的标识：故事 id、标题、角色名、节点 id、原文行、截图路径。 */
export function collectPrivateIdentifiers(input: {
	readonly context: PlaytestPrivateContext;
	readonly records: readonly PlaytestRecord[];
}): Set<string> {
	const identifiers = new Set<string>();
	const add = (value: string | null | undefined): void => {
		const text = value?.trim() ?? "";
		if (text.length >= MIN_IDENTIFIER_LENGTH) identifiers.add(text);
	};
	add(input.context.storyId);
	add(input.context.storyTitle);
	add(input.context.dbPath);
	add(input.context.channelsPath);
	for (const name of input.context.characterNames) add(name);
	for (const record of input.records) {
		if (isPlaytestFailureRecord(record)) {
			add(record.screenshot);
			add(record.error);
			continue;
		}
		add(record.userNodeId);
		add(record.assistantNodeId);
		add(record.traceNodeId);
		add(record.screenshot);
		for (const text of [record.user, record.assistant]) {
			for (const line of text.split(/\r?\n/)) {
				if (line.trim().length >= MIN_TEXT_LINE_LENGTH) add(line);
			}
		}
	}
	return identifiers;
}

/** 反向扫描：统计版里出现任何一个私有标识就视为泄漏。 */
export function scanPrivateIdentifiers(
	report: string,
	identifiers: ReadonlySet<string>,
): PlaytestIdentifierScan {
	const matches: string[] = [];
	for (const identifier of identifiers) {
		if (report.includes(identifier)) matches.push(identifier);
	}
	return { identifiers: identifiers.size, matches };
}

export function assertNoPrivateIdentifiers(scan: PlaytestIdentifierScan): void {
	if (scan.matches.length === 0) return;
	const preview = scan.matches
		.slice(0, 3)
		.map((match) => JSON.stringify(match.slice(0, 40)))
		.join("、");
	throw new Error(`统计报告包含 ${scan.matches.length} 处私有标识：${preview}`);
}

function formatList(values: readonly number[]): string {
	return values.length === 0 ? "无" : values.join("、");
}

function formatMs(value: number | null): string {
	return value === null ? "—" : `${Math.round(value)} 毫秒`;
}

function formatInteger(value: number | null): string {
	return value === null ? "—" : String(Math.round(value));
}

function formatDecimal(value: number | null, digits: number): string {
	return value === null ? "—" : value.toFixed(digits);
}

function formatNumber(value: number | null): string {
	return value === null ? "—" : String(value);
}

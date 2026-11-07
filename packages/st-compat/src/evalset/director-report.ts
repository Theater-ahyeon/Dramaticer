import type {
	DirectorEvalReport,
	ModeAggregate,
	ReplayMode,
	ReplayRunRecord,
} from "./director-eval.js";

const MODE_LABELS: Readonly<Record<ReplayMode, string>> = {
	on: "开启导演",
	off: "关闭导演",
};

export function renderPrivateDirectorReport(
	report: DirectorEvalReport,
): string {
	return renderDirectorReport(report, true);
}

export function renderPublicDirectorReport(report: DirectorEvalReport): string {
	return renderDirectorReport(report, false);
}

function renderDirectorReport(
	report: DirectorEvalReport,
	includeFailureDetails: boolean,
): string {
	const lines: string[] = [
		"# M3 Director 开关对比评测",
		"",
		`生成时间：${report.generatedAt}`,
		"",
		"## 配置",
		"",
		`- 模型别名：${report.modelAlias}`,
		`- 结构化输出：${report.settings.structuredOutput}`,
		`- embedding：${report.embeddingLabel ?? "未使用"}`,
		`- 分支点间隔：${report.settings.interval} 楼；每个对话最多 ${report.settings.maxBranchPointsPerStory} 个分支点`,
		`- 每个分支点回放 ${report.settings.rounds} 轮；开启与关闭各运行 ${report.settings.pairs} 次`,
		`- 导演配置：线索年龄 ${report.settings.director.clueAgeWarning} 楼、未兑现上限 ${report.settings.director.maxOpenClues}、停滞 ${report.settings.director.stallFloors} 楼、意外频率 ${report.settings.director.surprise}`,
		`- 重复检测：余弦阈值 ${report.settings.director.similarityThreshold}、窗口 ${report.settings.director.similarityWindow} 对、步长 ${report.settings.director.similarityStep}、连续上升 ${report.settings.director.similarityRiseWindows} 个窗口`,
		`- 节奏：张力阈值 ${report.settings.director.tensionEscalate}/${report.settings.director.tensionClimax}、高潮 ${report.settings.director.climaxFloors} 楼、喘息 ${report.settings.director.breatheFloors} 楼、pace ${report.settings.director.pace}`,
		"",
		"## 方法",
		"",
		"- 从 `eval-private/raw/` 的评测对话导入楼层树，沿主路径按固定间隔取分支点（只取已确认助手楼层，且后面还有足够的真实用户消息）。",
		"- 每个回放复制一份种子数据库，把 head 指到分支点，用后续真实用户消息逐轮生成；开启与关闭导演使用同一份前缀与同一模型。",
		"- 文本重复度复用参照文本统计：生成正文按行切块，相邻块用字符 4-gram Jaccard，报告均值、中位数、P90、P95、P99 与最大值。",
		"- 节拍余弦复用 M3-T06 的口径：助手楼层的块向量取平均，再算相邻楼层的余弦；生成楼层在下一轮导演评估前写入向量。",
		"- 线索兑现判定：后续助手回复的显示视图里出现笔记正文的连续 4 个规范化字符（笔记不足 4 字时按整条包含）。同一轮生成的笔记不参与本轮判定；年龄按楼层位置计算。",
		"- 每个机制的触发次数来自 `director_decisions.mechanisms`，被选中次数来自 Trace 的 `director:<mechanism>` 来源；关闭导演时不写决策记录。",
		"- 种子数据库只建立对话、卡与世界书内容、块与向量；不建立事件表与摘要，事件池与摘要槽位在回放里保持为空。生成内容本身不保证一致，报告给出样本数与模型别名。",
		"",
		"## 语料与分支点",
		"",
		"| 对话 | 主路径楼层 | 分支点 | 块数 | 向量数 |",
		"|---|---|---|---|---|",
	];
	for (const story of report.stories) {
		lines.push(
			`| ${story.story} | ${story.floors} | ${story.branchPoints} | ${story.chunkCount} | ${story.vectorCount} |`,
		);
	}

	lines.push("", "## 两种模式总览", "");
	lines.push(
		"| 模式 | 回放 | 生成楼层 | 文本块 | Jaccard 对数 | Jaccard 均值 | 中位数 | P90 | P95 | P99 |",
		"|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const mode of modes()) {
		lines.push(similarityRow(MODE_LABELS[mode], report.aggregate[mode]));
	}
	lines.push(
		"",
		"| 模式 | 余弦对数 | 余弦均值 | 中位数 | P90 | P95 | P99 | 新建笔记 | 兑现笔记 | 兑现率 | 兑现平均年龄 | 决策记录 | 导演消息 |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const mode of modes()) {
		const aggregate = report.aggregate[mode];
		lines.push(
			`| ${MODE_LABELS[mode]} | ${aggregate.cosine.count} | ${decimal(aggregate.cosine.mean)} | ${decimal(aggregate.cosine.median)} | ${decimal(aggregate.cosine.p90)} | ${decimal(aggregate.cosine.p95)} | ${decimal(aggregate.cosine.p99)} | ${aggregate.notesCreated} | ${aggregate.notesFulfilled} | ${ratio(aggregate.fulfillmentRate)} | ${numberOrDash(aggregate.meanFulfillAge)} | ${aggregate.directorDecisions} | ${aggregate.directorMessages} |`,
		);
	}

	lines.push("", "## 按对话分栏", "");
	lines.push(
		"| 对话 | 模式 | 回放 | 生成楼层 | Jaccard 均值 | 余弦均值 | 新建笔记 | 兑现笔记 | 决策记录 | 导演消息 |",
		"|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const story of report.stories) {
		for (const mode of modes()) {
			const runs = report.runs.filter(
				(run) => run.story === story.story && run.mode === mode,
			);
			if (runs.length === 0) continue;
			lines.push(storyRow(story.story, mode, runs));
		}
	}

	lines.push("", "## 机制触发与被选中", "");
	lines.push("| 模式 | 机制 | 触发次数 | 被选中次数 |");
	lines.push("|---|---|---|---|");
	const mechanismNames = [
		...new Set(
			modes().flatMap((mode) => [
				...Object.keys(report.aggregate[mode].mechanismTriggers),
				...Object.keys(report.aggregate[mode].mechanismSelections),
			]),
		),
	].sort();
	for (const mode of modes()) {
		const aggregate = report.aggregate[mode];
		if (mechanismNames.length === 0) {
			lines.push(`| ${MODE_LABELS[mode]} | — | 0 | 0 |`);
			continue;
		}
		for (const name of mechanismNames) {
			lines.push(
				`| ${MODE_LABELS[mode]} | ${name} | ${aggregate.mechanismTriggers[name] ?? 0} | ${aggregate.mechanismSelections[name] ?? 0} |`,
			);
		}
	}

	lines.push("", "## 开启与关闭对比", "");
	lines.push("| 指标 | 开启 | 关闭 | 更好的方向 | 结果 |");
	lines.push("|---|---|---|---|---|");
	for (const comparison of report.comparisons) {
		lines.push(
			`| ${comparison.label} | ${numberOrDash(comparison.on)} | ${numberOrDash(comparison.off)} | ${comparison.better === "lower" ? "越低越好" : "越高越好"} | ${improvedLabel(comparison)} |`,
		);
	}

	lines.push("", "## 验收核对", "");
	lines.push(
		`- 关闭导演时没有决策记录：${report.checks.offHasNoDecisions ? "通过" : "未通过"}`,
	);
	lines.push(
		`- 关闭导演时没有导演消息：${report.checks.offHasNoDirectorMessages ? "通过" : "未通过"}`,
	);
	lines.push(
		`- 开启导演时至少一个机制触发：${report.checks.onTriggersMechanism ? "通过" : "未通过"}`,
	);
	lines.push("");
	lines.push(
		`失败回放：${report.failures.length} 个；成功回放：${report.runs.length} 个。`,
	);

	if (includeFailureDetails) {
		lines.push("", "## 逐次回放", "");
		lines.push(
			"| 对话 | 分支楼层 | 模式 | 第几次 | 生成楼层 | Jaccard 均值 | 余弦均值 | 笔记 兑现/新建 | 兑现年龄 | 决策 | 导演消息 | 机制触发 |",
			"|---|---|---|---|---|---|---|---|---|---|---|---|",
		);
		for (const run of report.runs) {
			lines.push(
				`| ${run.story} | ${run.branchFloor} | ${MODE_LABELS[run.mode]} | ${run.pair} | ${run.generatedFloors} | ${decimal(run.jaccard.mean)} | ${decimal(run.cosine.mean)} | ${run.notesFulfilled}/${run.notesCreated} | ${numberOrDash(run.meanFulfillAge)} | ${run.directorDecisions} | ${run.directorMessages} | ${formatRecord(run.mechanismTriggers)} |`,
			);
		}
		if (report.failures.length > 0) {
			lines.push("", "## 失败列表", "");
			for (const failure of report.failures) {
				lines.push(
					`- ${failure.story}${failure.branchFloor === null ? "" : ` 第 ${failure.branchFloor} 楼`}${failure.mode === null ? "" : ` ${MODE_LABELS[failure.mode]}`}${failure.pair === null ? "" : ` 第 ${failure.pair} 次`}：${failure.message}`,
				);
			}
		}
	} else if (report.failures.length > 0) {
		lines.push("", "失败原因不写入统计版报告。");
	}

	lines.push("", "## 限制", "");
	lines.push(
		"- 回放只使用生成内容自身的重复度与线索指标，不判断文笔好坏；生成内容每次不同，结果应看样本内的分布而不是单个数字。",
	);
	lines.push(
		"- 种子数据库没有事件表与摘要，事件池机制只在卡扩展提供事件时可能触发；摘要槽位为空。",
	);
	lines.push(
		"- 线索兑现使用文本包含的确定性判定，可能低估改述式的兑现；该口径在 ADR 中记录。",
	);
	return `${lines.join("\n")}\n`;
}

function similarityRow(label: string, aggregate: ModeAggregate): string {
	const jaccard = aggregate.jaccard;
	return `| ${label} | ${aggregate.runs} | ${aggregate.generatedFloors} | ${aggregate.blockCount} | ${jaccard.count} | ${decimal(jaccard.mean)} | ${decimal(jaccard.median)} | ${decimal(jaccard.p90)} | ${decimal(jaccard.p95)} | ${decimal(jaccard.p99)} |`;
}

function storyRow(
	story: string,
	mode: ReplayMode,
	runs: readonly ReplayRunRecord[],
): string {
	return `| ${story} | ${MODE_LABELS[mode]} | ${runs.length} | ${sum(runs.map((run) => run.generatedFloors))} | ${decimal(mean(runs.map((run) => run.jaccard.mean)))} | ${decimal(mean(runs.map((run) => run.cosine.mean)))} | ${sum(runs.map((run) => run.notesCreated))} | ${sum(runs.map((run) => run.notesFulfilled))} | ${sum(runs.map((run) => run.directorDecisions))} | ${sum(runs.map((run) => run.directorMessages))} |`;
}

function modes(): readonly ReplayMode[] {
	return ["on", "off"];
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
	return values.length === 0 ? 0 : sum(values) / values.length;
}

function decimal(value: number): string {
	return value.toFixed(4);
}

function ratio(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function numberOrDash(value: number | null): string {
	return value === null
		? "—"
		: Number.isInteger(value)
			? String(value)
			: value.toFixed(2);
}

function improvedLabel(comparison: {
	readonly on: number | null;
	readonly off: number | null;
	readonly improved: boolean | null;
}): string {
	if (comparison.improved === null) return "无法比较";
	if (comparison.on === comparison.off) return "持平";
	return comparison.improved ? "开启更好" : "关闭更好";
}

function formatRecord(record: Readonly<Record<string, number>>): string {
	const entries = Object.entries(record);
	return entries.length === 0
		? "—"
		: entries.map(([name, count]) => `${name} ${count}`).join("、");
}

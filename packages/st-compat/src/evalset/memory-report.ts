import type {
	MemoryEvalReport,
	MemoryEvalScore,
	MemoryEvalStateAccuracy,
	MemoryEvalStoryScore,
	MemoryEvalThreshold,
} from "./memory-eval.js";
import { kindLabel } from "./memory-eval.js";
import { renderJudgedMemorySection } from "./memory-judged.js";
import type { QuestionKind } from "./question-files.js";

const ROUTE_LABELS: Readonly<Record<string, string>> = {
	bm25: "BM25",
	vector: "向量",
	entity: "实体",
	event: "事件",
	recent: "最近块",
	fused: "融合",
};

/** M0 报告里已经发布的基线数字，用于和本次评测并列。 */
const M0_BM25 = {
	state: { questionCount: 236, hitAt5: 16, hitAt10: 18, hitAt20: 19 },
	event: { questionCount: 150, hitAt5: 125, hitAt10: 138, hitAt20: 144 },
} as const;
const M0_ACU = {
	state: { covered: 88, questionCount: 236 },
	event: { covered: 3, questionCount: 150 },
} as const;

export function renderPrivateMemoryReport(report: MemoryEvalReport): string {
	return renderMemoryReport(report, true);
}

export function renderPublicMemoryReport(report: MemoryEvalReport): string {
	return renderMemoryReport(report, false);
}

function renderMemoryReport(
	report: MemoryEvalReport,
	includeStoryNames: boolean,
): string {
	const judged = report.judged ?? null;
	const lines: string[] = [
		"# M2 记忆引擎检索评测",
		"",
		`生成时间：${report.generatedAt}`,
		"",
		"## 方法",
		"",
		"- 把 3 个私有对话导入临时 SQLite：当前 swipe 连成主路径，其他 swipe 作为兄弟节点；块索引由 `appendNode` 自动建立。",
		"- 实体来自角色卡与世界书；向量由配置的 embedding 渠道按块生成，结果按文本内容缓存，重复运行不重复调用渠道。",
		report.eventsBuilt
			? "- 事件用生产的事件抽取处理器沿主路径建立，模型调用的磁盘缓存由渠道客户端负责。"
			: "- 本次没有建立事件表：事件路与实体路的事件召回不参与，知情者过滤数量为 0。",
		"- 每道题用 `retrieveMemory` 的同一套候选收集与 RRF 融合；只在提问楼层的祖先路径上检索，证据楼层出现在前 K 个结果里算命中。",
		"- 每一路按自己的原始名次单独计分；路缺失时该路记 0 命中，题数保持一致。",
		"- 状态题的标准答案来自 MVU 快照，证据楼层是产生该状态变更的楼层；原文检索不读取状态层，这一题型的结果只反映文本召回。",
		...(judged === null
			? []
			: [
					"- 五类记忆题在各自的提问楼层组装上下文生成回答，再交与一致性探针同一套的裁判判分；编造回忆题是拒答题里用 `fabricated` 标注的子集。",
				]),
		"",
		"## 语料与索引",
		"",
		"| 对话 | 楼层 | 块数 | 向量数 | 实体数 | 事件数 |",
		"|---|---|---|---|---|---|",
	];
	report.stories.forEach((story, index) => {
		lines.push(
			`| ${storyLabel(index, story, includeStoryNames)} | ${story.floorCount} | ${story.chunkCount} | ${story.vectorCount} | ${story.entityCount} | ${story.eventCount} |`,
		);
	});

	lines.push("", "## 融合结果（按对话与题型）", "");
	lines.push("| 对话 | 题目类型 | 题数 | 命中@5 | 命中@10 | 命中@20 |");
	lines.push("|---|---|---|---|---|---|");
	report.stories.forEach((story, index) => {
		for (const score of story.byKind) {
			lines.push(
				scoreRow(
					storyLabel(index, story, includeStoryNames),
					score,
					score.kind,
				),
			);
		}
	});
	for (const score of report.byKind) {
		lines.push(scoreRow("合计", score, score.kind));
	}

	lines.push("", "## 合计（按题型）", "");
	lines.push("| 题目类型 | 题数 | 命中@5 | 命中@10 | 命中@20 |");
	lines.push("|---|---|---|---|---|");
	for (const score of report.byKind) {
		lines.push(
			`| ${kindLabel(score.kind)} | ${score.questionCount} | ${hitText(score, "hitAt5")} | ${hitText(score, "hitAt10")} | ${hitText(score, "hitAt20")} |`,
		);
	}
	lines.push(
		`| 全部 | ${report.total.questionCount} | ${hitText(report.total, "hitAt5")} | ${hitText(report.total, "hitAt10")} | ${hitText(report.total, "hitAt20")} |`,
	);

	lines.push("", "## 每一路的单独成绩", "");
	lines.push("| 路 | 题目类型 | 题数 | 命中@5 | 命中@10 | 命中@20 |");
	lines.push("|---|---|---|---|---|---|");
	for (const route of report.routes) {
		for (const score of route.byKind) {
			lines.push(
				`| ${ROUTE_LABELS[route.route] ?? route.route} | ${kindLabel(score.kind)} | ${score.questionCount} | ${hitText(score, "hitAt5")} | ${hitText(score, "hitAt10")} | ${hitText(score, "hitAt20")} |`,
			);
		}
	}

	lines.push("", "## 知情者过滤", "");
	lines.push(
		`- 视角：${report.filter.viewpoint === null ? "全知（不启用过滤）" : "指定视角"}`,
	);
	lines.push(`- 过滤前事件数：${report.filter.eventsBeforeFilter}`);
	lines.push(`- 过滤后事件数：${report.filter.eventsAfterFilter}`);
	lines.push(
		`- 原文块被整体排除的查询数：${report.filter.queriesWithExcludedChunks}`,
	);

	lines.push("", "## 与 M0 基线对照", "");
	lines.push(
		"M0 报告里的基线：状态题 BM25 命中@5/10/20 为 6.8%/7.6%/8.1%，ACU 覆盖 37.3%；事件题 BM25 为 83.3%/92.0%/96.0%，ACU 覆盖 2.0%。",
	);
	lines.push("");
	lines.push(
		"| 对话 | 题目类型 | 本次 BM25 @5/@10/@20 | 本次融合 @5/@10/@20 | M0 BM25 @5/@10/@20 | ACU 覆盖 |",
	);
	lines.push("|---|---|---|---|---|---|");
	report.stories.forEach((story, index) => {
		for (const kind of ["state", "event"] as QuestionKind[]) {
			const fused = findKind(story, "fused", kind);
			const bm25 = findKind(story, "bm25", kind);
			if (!fused || !bm25) continue;
			const m0 = M0_BM25[kind];
			const acu = M0_ACU[kind];
			lines.push(
				`| ${storyLabel(index, story, includeStoryNames)} | ${kindLabel(kind)} | ${ratioTriplet(bm25)} | ${ratioTriplet(fused)} | ${percent(m0.hitAt5 / m0.questionCount)}/${percent(m0.hitAt10 / m0.questionCount)}/${percent(m0.hitAt20 / m0.questionCount)} | ${percent(acu.covered / acu.questionCount)} |`,
			);
		}
	});

	lines.push("", "## 状态层答案正确率", "");
	lines.push(
		"提问楼层的 `getStateSnapshot` 按题目路径取值，与标准答案逐题比较。这些题不经过文本检索，结果反映状态链路本身是否正确。",
	);
	lines.push("");
	lines.push("| 对话 | 题数 | 一致 | 路径缺失 | 正确率 |");
	lines.push("|---|---|---|---|---|");
	report.stories.forEach((story, index) => {
		if (story.stateAccuracy.questionCount === 0) return;
		lines.push(
			accuracyRow(
				storyLabel(index, story, includeStoryNames),
				story.stateAccuracy,
			),
		);
	});
	lines.push(accuracyRow("合计", report.stateAccuracy));

	lines.push("", "## 门槛核对", "");
	lines.push("| 门槛 | 对话 | 题数 | 实际 | 基线 | 目标 | 结果 |");
	lines.push("|---|---|---|---|---|---|---|");
	for (const threshold of report.thresholds) {
		lines.push(thresholdRow(threshold, report, includeStoryNames));
	}
	if (judged !== null) {
		lines.push(
			"",
			renderJudgedMemorySection(judged, {
				privateDetails: includeStoryNames,
			}).trimEnd(),
		);
	}
	return `${lines.join("\n")}\n`;
}

function thresholdRow(
	threshold: MemoryEvalThreshold,
	report: MemoryEvalReport,
	includeStoryNames: boolean,
): string {
	const story =
		threshold.story === null
			? "合计"
			: (() => {
					const index = report.stories.findIndex(
						(storyScore) => storyScore.story === threshold.story,
					);
					const storyScore = report.stories[index];
					if (!storyScore) return threshold.story;
					return storyLabel(index, storyScore, includeStoryNames);
				})();
	const baseline =
		threshold.baselineHits === null
			? "—"
			: percent(threshold.baselineHits / threshold.questionCount);
	return `| ${threshold.label} | ${story} | ${threshold.questionCount} | ${percent(threshold.hits / threshold.questionCount)} | ${baseline} | ${percent(threshold.targetRatio)} | ${threshold.passed ? "通过" : "未通过"} |`;
}

function storyLabel(
	index: number,
	story: MemoryEvalStoryScore,
	includeStoryNames: boolean,
): string {
	return includeStoryNames
		? `对话 ${index + 1}（${story.story}）`
		: `对话 ${index + 1}`;
}

function findKind(
	story: MemoryEvalStoryScore,
	route: string,
	kind: QuestionKind,
): MemoryEvalScore | null {
	return (
		story.routes
			.find((entry) => entry.route === route)
			?.byKind.find((entry) => entry.kind === kind) ?? null
	);
}

function scoreRow(
	label: string,
	score: MemoryEvalScore,
	kind: QuestionKind | null,
): string {
	return `| ${label} | ${kind === null ? "全部" : kindLabel(kind)} | ${score.questionCount} | ${hitText(score, "hitAt5")} | ${hitText(score, "hitAt10")} | ${hitText(score, "hitAt20")} |`;
}

function hitText(
	score: MemoryEvalScore,
	key: "hitAt5" | "hitAt10" | "hitAt20",
): string {
	return `${score[key]}（${percent(score[key] / score.questionCount)}）`;
}

function ratioTriplet(score: MemoryEvalScore): string {
	return `${percent(score.hitAt5 / score.questionCount)}/${percent(score.hitAt10 / score.questionCount)}/${percent(score.hitAt20 / score.questionCount)}`;
}

function percent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function accuracyRow(label: string, accuracy: MemoryEvalStateAccuracy): string {
	const ratio =
		accuracy.questionCount === 0
			? "—"
			: percent(accuracy.correct / accuracy.questionCount);
	return `| ${label} | ${accuracy.questionCount} | ${accuracy.correct} | ${accuracy.missing} | ${ratio} |`;
}

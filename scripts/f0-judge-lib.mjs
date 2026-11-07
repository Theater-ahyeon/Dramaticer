// F0-T03：裁判校准的纯函数部分：盲评提示词、输出校验、区间与汇总。
import { PAIR_DEPTH_BUCKETS, pairDepthBucketOf } from "./f0-pairs.mjs";

export const JUDGE_ORDERS = Object.freeze(["rejected-first", "accepted-first"]);

export const AGREEMENT_THRESHOLD = 0.65;
export const POSITION_BIAS_LIMIT = 0.1;

export function assertOrder(order) {
	if (!JUDGE_ORDERS.includes(order)) {
		throw new Error(`未知的裁判顺序：${String(order)}`);
	}
	return order;
}

/** 盲评时位置甲放哪一份回复；位置与质量无关，两种顺序各判一次。 */
export function acceptedPositionOf(order) {
	assertOrder(order);
	return order === "rejected-first" ? "B" : "A";
}

export function picksAccepted(order, choice) {
	assertOrder(order);
	if (choice !== "A" && choice !== "B") {
		throw new Error(`choice 不合法：${String(choice)}`);
	}
	return choice === acceptedPositionOf(order);
}

function contextBlock(context) {
	if (context.length === 0) return "（没有更早的对话）";
	return context
		.map((entry) => `${entry.role === "user" ? "用户" : "助手"}：${entry.text}`)
		.join("\n\n");
}

export function buildChoiceMessages(pair, order) {
	assertOrder(order);
	const rejected = pair.rejectedText;
	const accepted = pair.acceptedText;
	if (typeof rejected !== "string" || typeof accepted !== "string") {
		throw new Error(`配对 ${String(pair?.id)} 缺少回复正文`);
	}
	const context = Array.isArray(pair.context) ? pair.context : [];
	const first = order === "rejected-first" ? rejected : accepted;
	const second = order === "rejected-first" ? accepted : rejected;
	const system = [
		"你是故事编辑，正在做盲评。同一楼层的助手回复有两个版本，玩家保留了其中一个、放弃了另一个。",
		"请只根据最近的对话与两个版本的内容，判断玩家更可能保留哪一个。",
		"两个版本展示为回复甲与回复乙，位置与质量无关：不要因为某个版本排在前面或后面就偏向它。",
		"两个版本差别很小时仍然要选一个。",
		"confidence 是 0 到 1 的小数，表示你对选择的把握。",
		'只输出一个 JSON 对象，不要 Markdown，不要解释：{"choice": "A", "confidence": 0.0}',
		'choice 取 "A"（回复甲）或 "B"（回复乙）。',
	].join("\n");
	const user = [
		`最近的对话：\n${contextBlock(context)}`,
		`回复甲：\n${first}`,
		`回复乙：\n${second}`,
		"请输出你的判断。",
	].join("\n\n");
	return {
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		acceptedPosition: acceptedPositionOf(order),
	};
}

function stripCodeFence(text) {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ?? text;
}

function tryParseJson(text) {
	if (text === null || text.length === 0) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function extractJsonObject(text) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) return text.slice(start, end + 1);
	return null;
}

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseChoice(text) {
	const body = stripCodeFence(String(text ?? "").trim());
	const parsed = tryParseJson(body) ?? tryParseJson(extractJsonObject(body));
	if (!isPlainObject(parsed)) {
		throw new Error("裁判输出里找不到 JSON 对象");
	}
	const { choice, confidence } = parsed;
	if (choice !== "A" && choice !== "B") {
		throw new Error(`choice 不合法：${String(choice)}`);
	}
	if (
		typeof confidence !== "number" ||
		!Number.isFinite(confidence) ||
		confidence < 0 ||
		confidence > 1
	) {
		throw new Error(`confidence 必须是 0 到 1 的小数：${String(confidence)}`);
	}
	return { choice, confidence };
}

export function wilsonInterval(successes, total, z = 1.96) {
	if (!Number.isInteger(total) || total < 0) {
		throw new Error(`total 必须是非负整数：${String(total)}`);
	}
	if (!Number.isInteger(successes) || successes < 0 || successes > total) {
		throw new Error(`successes 必须是 0 到 ${total} 的整数：${String(successes)}`);
	}
	if (total === 0) return null;
	const p = successes / total;
	const denominator = 1 + (z * z) / total;
	const centre = (p + (z * z) / (2 * total)) / denominator;
	const margin =
		(z *
			Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
		denominator;
	return {
		low: Math.max(0, centre - margin),
		high: Math.min(1, centre + margin),
	};
}

function rateStats(judgements) {
	const total = judgements.length;
	const accepted = judgements.filter((entry) => entry.picksAccepted).length;
	const positionA = judgements.filter((entry) => entry.choice === "A").length;
	return {
		judgements: total,
		accepted,
		agreement: total === 0 ? null : accepted / total,
		agreementInterval: wilsonInterval(accepted, total),
		positionA,
		positionAShare: total === 0 ? null : positionA / total,
		positionAInterval: wilsonInterval(positionA, total),
		positionDeviation: total === 0 ? null : Math.abs(positionA / total - 0.5),
	};
}

function consistencyStats(pairsWithBothOrders) {
	const total = pairsWithBothOrders.length;
	const consistent = pairsWithBothOrders.filter(
		(entries) => entries[0].picksAccepted === entries[1].picksAccepted,
	).length;
	return {
		pairs: total,
		consistent,
		rate: total === 0 ? null : consistent / total,
		interval: wilsonInterval(consistent, total),
	};
}

/**
 * 汇总裁判结果。results 里同一配对同一顺序可能有多行，取最后一行；
 * 只有 ok 为 true 的行参与统计。
 */
export function summarizeJudge(pairs, results, attributionByPair = new Map()) {
	const byPair = new Map();
	for (const entry of results) {
		if (entry?.ok !== true) continue;
		if (!JUDGE_ORDERS.includes(entry.order)) {
			throw new Error(`裁判结果里的顺序不合法：${String(entry.order)}`);
		}
		if (!byPair.has(entry.pair)) byPair.set(entry.pair, new Map());
		byPair.get(entry.pair).set(entry.order, entry);
	}

	const judgements = [];
	const bothOrders = [];
	const judgedPairs = [];
	for (const pair of pairs) {
		const orders = byPair.get(pair.id);
		if (orders === undefined) continue;
		const entries = JUDGE_ORDERS.map((order) => orders.get(order)).filter(
			(entry) => entry !== undefined,
		);
		if (entries.length === 0) continue;
		judgedPairs.push(pair);
		judgements.push(...entries);
		if (entries.length === JUDGE_ORDERS.length) bothOrders.push(entries);
	}

	const overall = rateStats(judgements);
	const confidences = judgements.map((entry) => entry.confidence);
	const confidenceMean =
		confidences.length === 0
			? null
			: confidences.reduce((sum, value) => sum + value, 0) / confidences.length;

	function groupStats(label, members) {
		const groupJudgements = [];
		const groupBoth = [];
		for (const pair of members) {
			const orders = byPair.get(pair.id);
			if (orders === undefined) continue;
			const entries = JUDGE_ORDERS.map((order) => orders.get(order)).filter(
				(entry) => entry !== undefined,
			);
			if (entries.length === 0) continue;
			groupJudgements.push(...entries);
			if (entries.length === JUDGE_ORDERS.length) groupBoth.push(entries);
		}
		const stats = rateStats(groupJudgements);
		if (stats.judgements === 0) return null;
		return {
			label,
			judgedPairs: members.filter((pair) => byPair.get(pair.id) !== undefined)
				.length,
			...stats,
			consistency: consistencyStats(groupBoth),
		};
	}

	const groups = [];
	groups.push(groupStats("全部样本", pairs));
	for (const bucket of PAIR_DEPTH_BUCKETS) {
		groups.push(
			groupStats(
				bucket.label,
				pairs.filter((pair) => pairDepthBucketOf(pair.depthFloor) === bucket.label),
			),
		);
	}
	groups.push(
		groupStats(
			"被接受的是最后一条 swipe",
			pairs.filter((pair) => pair.acceptedNotLast === false),
		),
	);
	groups.push(
		groupStats(
			"被接受的不是最后一条",
			pairs.filter((pair) => pair.acceptedNotLast === true),
		),
	);
	groups.push(
		groupStats(
			"归因为另一种可行写法",
			pairs.filter(
				(pair) => attributionByPair.get(pair.id)?.alternativeOnly === true,
			),
		),
	);
	groups.push(
		groupStats(
			"归因不是另一种可行写法",
			pairs.filter(
				(pair) => attributionByPair.get(pair.id)?.alternativeOnly === false,
			),
		),
	);

	const agreementPassed =
		overall.agreement !== null && overall.agreement >= AGREEMENT_THRESHOLD;
	const positionPassed =
		overall.positionDeviation !== null &&
		overall.positionDeviation <= POSITION_BIAS_LIMIT;
	return {
		pairs: judgedPairs.length,
		judgements: overall,
		perOrder: JUDGE_ORDERS.map((order) => ({
			order,
			...rateStats(judgements.filter((entry) => entry.order === order)),
		})),
		consistency: consistencyStats(bothOrders),
		confidence: { mean: confidenceMean, belowHalf: confidences.filter((value) => value < 0.5).length },
		groups: groups.filter((group) => group !== null),
		thresholds: {
			agreement: AGREEMENT_THRESHOLD,
			positionBias: POSITION_BIAS_LIMIT,
			agreementPassed,
			positionPassed,
			passed: agreementPassed && positionPassed,
		},
	};
}

function pct(value) {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function intervalText(interval) {
	if (interval === null) return "—";
	return `${(interval.low * 100).toFixed(1)}%–${(interval.high * 100).toFixed(1)}%`;
}

function points(value) {
	return value === null ? "—" : `${(value * 100).toFixed(1)} 个百分点`;
}

const ORDER_LABELS = Object.freeze({
	"rejected-first": "被放弃的回复在位置甲",
	"accepted-first": "被保留的回复在位置甲",
});

export function renderJudgeSection({ summary, meta }) {
	const { thresholds, judgements, consistency, perOrder } = summary;
	const lines = [];
	lines.push("<!-- F0-T03:begin -->");
	lines.push("### 结果（F0-T03）", "");
	lines.push(`生成时间：${meta.generatedAt}`, "");

	lines.push("#### 样本与调用", "");
	lines.push("| 项目 | 数值 |", "|---|---|");
	lines.push(`| 裁判模型 | \`${meta.modelId}\` |`);
	lines.push(`| 已成功归因的配对 | ${meta.availablePairs} |`);
	lines.push(`| 抽样配对 | ${meta.selectedPairs ?? summary.pairs} |`);
	lines.push(`| 有判断的配对 | ${summary.pairs} |`);
	lines.push(`| 成功判断 | ${judgements.judgements} |`);
	lines.push(
		`| 失败判断 | ${meta.failedJudgements}（没有计入一致率，下次运行会重试） |`,
	);
	lines.push(`| 网络请求（成功判断） | ${meta.cost.requests} |`);
	lines.push(`| 缓存命中（成功判断） | ${meta.cost.cacheHits} |`);
	lines.push(
		`| 因输出为空或截断而重试的判断 | ${meta.cost.retries} |`,
	);
	lines.push(`| 累计 prompt token | ${meta.cost.usage.promptTokens} |`);
	lines.push(`| 累计 completion token | ${meta.cost.usage.completionTokens} |`);
	lines.push(`| 累计 reasoning token | ${meta.cost.usage.reasoningTokens} |`);
	lines.push("");
	if (meta.routeNote) {
		lines.push(meta.routeNote, "");
	}
	lines.push("按楼层深度的抽样与判断：", "");
	lines.push(
		"| 楼层深度 | 可用配对 | 每层目标 | 抽样配对 | 判断 |",
		"|---|---|---|---|---|",
	);
	for (const item of meta.sampleStats) {
		const group = summary.groups.find((entry) => entry.label === item.label);
		lines.push(
			`| ${item.label} | ${item.available} | ${item.target} | ${item.picked} | ${group?.judgements ?? 0} |`,
		);
	}
	lines.push("");

	lines.push("#### 与玩家选择的一致率", "");
	lines.push(
		"| 顺序 | 判断 | 选中被保留的回复 | 一致率 | 95% 置信区间 | 选位置甲 | 位置甲占比 |",
		"|---|---|---|---|---|---|---|",
	);
	lines.push(
		`| 两种顺序合并 | ${judgements.judgements} | ${judgements.accepted} | ${pct(judgements.agreement)} | ${intervalText(judgements.agreementInterval)} | ${judgements.positionA} | ${pct(judgements.positionAShare)} |`,
	);
	for (const order of perOrder) {
		lines.push(
			`| ${ORDER_LABELS[order.order]} | ${order.judgements} | ${order.accepted} | ${pct(order.agreement)} | ${intervalText(order.agreementInterval)} | ${order.positionA} | ${pct(order.positionAShare)} |`,
		);
	}
	lines.push("");
	lines.push(
		`合并后的位置偏差 ${points(judgements.positionDeviation)}（95% 置信区间 ${intervalText(judgements.positionAInterval)} 是位置甲占比的区间），门槛 ≤ ${points(thresholds.positionBias)}：${thresholds.positionPassed ? "达到" : "未达到"}。`,
		"",
	);

	lines.push("#### 换序一致率", "");
	lines.push("| 项目 | 数值 |", "|---|---|");
	lines.push(`| 两种顺序都成功的配对 | ${consistency.pairs} |`);
	lines.push(`| 两种顺序选中同一份回复 | ${consistency.consistent} |`);
	lines.push(
		`| 换序一致率 | ${pct(consistency.rate)}（95% 置信区间 ${intervalText(consistency.interval)}） |`,
	);
	lines.push("");

	lines.push("#### 分组", "");
	lines.push(
		"| 分组 | 有判断的配对 | 判断 | 一致率 | 95% 置信区间 | 选位置甲占比 | 换序一致率 |",
		"|---|---|---|---|---|---|---|",
	);
	for (const group of summary.groups) {
		lines.push(
			`| ${group.label} | ${group.judgedPairs} | ${group.judgements} | ${pct(group.agreement)} | ${intervalText(group.agreementInterval)} | ${pct(group.positionAShare)} | ${pct(group.consistency.rate)} |`,
		);
	}
	lines.push("");

	lines.push("#### 结论", "");
	lines.push(
		`- 一致率 ${pct(judgements.agreement)}，门槛 ${pct(thresholds.agreement)}：${thresholds.agreementPassed ? "达到" : "未达到"}。`,
	);
	lines.push(
		`- 位置偏差 ${points(judgements.positionDeviation)}，门槛 ≤ ${points(thresholds.positionBias)}：${thresholds.positionPassed ? "达到" : "未达到"}。`,
	);
	if (thresholds.passed) {
		lines.push(
			"- 两项都达到门槛：R2 的 LLM 裁判可以用于偏好判断。偏好信号仍以玩家的重 roll、编辑与选择为准，裁判只用来扩展样本。",
		);
	} else {
		const failed = [];
		if (!thresholds.agreementPassed) failed.push("一致率");
		if (!thresholds.positionPassed) failed.push("位置偏差");
		lines.push(
			`- ${failed.join("与")}未达到门槛：R2 的 LLM 裁判只用于有台账可对照的矛盾与遗忘判定；偏好判断改用玩家的选择数据（重 roll、编辑、选择）。`,
		);
	}
	lines.push(
		`- 这是同模型自评：裁判与 F0-T02 的归因使用同一个模型（\`${meta.modelId}\`），结论不能当作 R2 的裁判口径。`,
	);
	lines.push("");
	lines.push("<!-- F0-T03:end -->");
	return lines.join("\n");
}

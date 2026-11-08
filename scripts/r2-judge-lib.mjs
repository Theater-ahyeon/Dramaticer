// R2-T03.b：裁判校准的汇总与报告渲染。纯函数，不读文件、不调用模型。
import {
	AGREEMENT_THRESHOLD,
	POSITION_BIAS_LIMIT,
	wilsonInterval,
} from "./f0-judge-lib.mjs";

/** 试玩判分与模拟用户判定重 roll 率的差超过这个值时，视为判定尺度偏宽松。 */
export const LENIENCY_MARGIN = 0.05;

/** 试玩样本少于这个数量时只报告数字，不判定尺度。 */
export const MIN_PLAYTEST_SAMPLES = 50;

/** F0 取证里 1–10 楼玩家的真实重 roll 率；内容与模型不同，只作外部参照。 */
export const F0_EARLY_REROLL_RATE = 0.249;

function rate(count, total) {
	return total === 0 ? null : count / total;
}

function rateRow(done, predicate) {
	const count = done.filter(predicate).length;
	return {
		count,
		rate: rate(count, done.length),
		interval: wilsonInterval(count, done.length),
	};
}

/**
 * 对比同一批试玩回复上两个评审的重 roll 与跟随指令判定。
 * judge 与 reference 都只取 status 为 done 的记录；按轮次配对。
 */
export function summarizeTurnComparison(judgeRecords, referenceRecords) {
	if (judgeRecords.length !== referenceRecords.length) {
		throw new Error("裁判与参考判定数量不一致");
	}
	const pairs = [];
	for (let index = 0; index < judgeRecords.length; index += 1) {
		const judge = judgeRecords[index];
		const reference = referenceRecords[index];
		if (judge.status !== "done" || reference.status !== "done") continue;
		pairs.push({ judge, reference });
	}
	const judgeDone = pairs.map((entry) => entry.judge);
	const referenceDone = pairs.map((entry) => entry.reference);
	const rerollAgree = pairs.filter(
		(entry) => entry.judge.reroll === entry.reference.reroll,
	).length;
	const followedAgree = pairs.filter(
		(entry) => entry.judge.followed === entry.reference.followed,
	).length;
	const missedReroll = pairs.filter(
		(entry) => entry.reference.reroll && !entry.judge.reroll,
	).length;
	const extraReroll = pairs.filter(
		(entry) => entry.judge.reroll && !entry.reference.reroll,
	).length;
	const judgeReroll = rateRow(judgeDone, (entry) => entry.reroll);
	const referenceReroll = rateRow(referenceDone, (entry) => entry.reroll);
	const judgeFollowed = rateRow(judgeDone, (entry) => entry.followed);
	const referenceFollowed = rateRow(referenceDone, (entry) => entry.followed);
	const rerollDifference =
		judgeReroll.rate === null || referenceReroll.rate === null
			? null
			: judgeReroll.rate - referenceReroll.rate;
	const sufficientlySampled = pairs.length >= MIN_PLAYTEST_SAMPLES;
	const lenient =
		sufficientlySampled &&
		rerollDifference !== null &&
		rerollDifference <= -LENIENCY_MARGIN;
	return {
		records: judgeRecords.length,
		pairs: pairs.length,
		judgeFailures: judgeRecords.filter((entry) => entry.status !== "done")
			.length,
		referenceFailures: referenceRecords.filter(
			(entry) => entry.status !== "done",
		).length,
		judgeReroll,
		referenceReroll,
		judgeFollowed,
		referenceFollowed,
		rerollAgreement: {
			count: rerollAgree,
			rate: rate(rerollAgree, pairs.length),
			interval: wilsonInterval(rerollAgree, pairs.length),
		},
		followedAgreement: {
			count: followedAgree,
			rate: rate(followedAgree, pairs.length),
			interval: wilsonInterval(followedAgree, pairs.length),
		},
		missedReroll,
		extraReroll,
		rerollDifference,
		sufficientlySampled,
		lenient,
	};
}

function pct(value) {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function intervalText(interval) {
	if (interval === null || interval === undefined) return "—";
	return `${(interval.low * 100).toFixed(1)}%–${(interval.high * 100).toFixed(1)}%`;
}

function points(value) {
	return value === null ? "—" : `${(value * 100).toFixed(1)} 个百分点`;
}

const ORDER_LABELS = Object.freeze({
	"rejected-first": "被放弃的回复在位置甲",
	"accepted-first": "被保留的回复在位置甲",
});

function calibrationSection(calibration, meta) {
	const { judgements, consistency, perOrder, thresholds } = calibration;
	const lines = [];
	lines.push("### 第一部分：F0 配对上的协议校准", "");
	lines.push(`生成时间：${meta.generatedAt}`, "");
	lines.push("#### 样本与调用", "");
	lines.push("| 项目 | 数值 |", "|---|---|");
	lines.push(`| 裁判角色 | \`judge\`（\`${meta.judgeModel}\`） |`);
	lines.push(`| 已成功归因的配对 | ${meta.availablePairs} |`);
	lines.push(`| 与 F0-T03 相同的抽样配对 | ${calibration.pairs} |`);
	lines.push(`| 成功判断 | ${judgements.judgements} |`);
	lines.push(
		`| 失败判断 | ${meta.failedJudgements}（没有计入一致率，明细在私有结果文件里） |`,
	);
	lines.push(`| 网络请求（成功判断） | ${meta.cost.requests} |`);
	lines.push(`| 缓存命中（成功判断） | ${meta.cost.cacheHits} |`);
	if (meta.duplicatePrompts && meta.duplicatePrompts.duplicates > 0) {
		lines.push(
			`| 内容完全相同的重复判断 | ${meta.duplicatePrompts.duplicates}（语料里有内容相同的对话副本；独立判断 ${meta.duplicatePrompts.unique}） |`,
		);
	}
	lines.push(`| 因输出为空或截断而重试的判断 | ${meta.cost.retries} |`);
	lines.push(`| 累计 prompt token | ${meta.cost.usage.promptTokens} |`);
	lines.push(`| 累计 completion token | ${meta.cost.usage.completionTokens} |`);
	lines.push(`| 累计 reasoning token | ${meta.cost.usage.reasoningTokens} |`);
	lines.push("");

	lines.push("#### 与玩家实际选择的一致率", "");
	lines.push(
		"| 顺序 | 判断 | 选中被保留的回复 | 一致率 | 95% 置信区间 | 选位置甲占比 |",
		"|---|---|---|---|---|---|",
	);
	lines.push(
		`| 两种顺序合并 | ${judgements.judgements} | ${judgements.accepted} | ${pct(judgements.agreement)} | ${intervalText(judgements.agreementInterval)} | ${pct(judgements.positionAShare)} |`,
	);
	for (const order of perOrder) {
		lines.push(
			`| ${ORDER_LABELS[order.order]} | ${order.judgements} | ${order.accepted} | ${pct(order.agreement)} | ${intervalText(order.agreementInterval)} | ${pct(order.positionAShare)} |`,
		);
	}
	lines.push("");
	lines.push(
		`位置偏差 ${points(judgements.positionDeviation)}（位置甲占比的 95% 置信区间 ${intervalText(judgements.positionAInterval)}），门槛 ≤ ${points(thresholds.positionBias)}：${thresholds.positionPassed ? "达到" : "未达到"}。`,
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
		"| 分组 | 有判断的配对 | 判断 | 一致率 | 95% 置信区间 | 换序一致率 |",
		"|---|---|---|---|---|---|",
	);
	for (const group of calibration.groups) {
		lines.push(
			`| ${group.label} | ${group.judgedPairs} | ${group.judgements} | ${pct(group.agreement)} | ${intervalText(group.agreementInterval)} | ${pct(group.consistency.rate)} |`,
		);
	}
	lines.push("");
	lines.push("#### 第一部分结论", "");
	lines.push(
		`- 一致率 ${pct(judgements.agreement)}，门槛 ${pct(thresholds.agreement)}：${thresholds.agreementPassed ? "达到" : "未达到"}。`,
	);
	lines.push(
		`- 位置偏差 ${points(judgements.positionDeviation)}，门槛 ≤ ${points(thresholds.positionBias)}：${thresholds.positionPassed ? "达到" : "未达到"}。`,
	);
	if (thresholds.passed) {
		lines.push(
			"- 两项都达到：`judge` 可用于扩展偏好判断的聚合样本，单次判断仍不作为偏好结论。",
		);
	} else {
		lines.push(
			"- 未达到：`judge` 不用于重 roll 与偏好判定；R2-T04 的盲测改用确定性指标加配对统计，并在报告注明。",
		);
	}
	const reverted = calibration.groups.find(
		(group) => group.label === "被接受的不是最后一条",
	);
	if (
		reverted !== undefined &&
		reverted.agreement !== null &&
		reverted.agreement < thresholds.agreement
	) {
		lines.push(
			`- 玩家切回较早 swipe 的子集一致率 ${pct(reverted.agreement)}，低于门槛；这类偏好直接采用玩家数据，不用裁判外推。`,
		);
	}
	lines.push(
		`- 预注册门槛：一致率 ≥ ${pct(AGREEMENT_THRESHOLD)}，位置偏差 ≤ ${points(POSITION_BIAS_LIMIT)}。`,
	);
	lines.push("");
	return lines;
}

function playtestSection(playtest, meta) {
	const lines = [];
	lines.push("### 第二部分：自动试玩回复上的尺度对照", "");
	lines.push(
		`样本来自一轮 ${playtest.records} 轮自动试玩（档位 \`${meta.playtestProfile}\`，写作 \`${meta.playtestWriterModel}\`，模拟用户 \`${meta.playtestUserModel}\`）。同一个玩家侧问题分别交给两个评审：裁判角色 \`judge\`（\`${meta.judgeModel}\`）与模拟用户模型（\`${meta.playtestUserModel}\`）。`,
		"",
	);
	lines.push("| 项目 | 裁判 | 模拟用户模型 |", "|---|---|---|");
	lines.push(
		`| 可判定回复 | ${playtest.pairs} | ${playtest.pairs} |`,
	);
	lines.push(
		`| 会重 roll | ${pct(playtest.judgeReroll.rate)}（${playtest.judgeReroll.count} 条） | ${pct(playtest.referenceReroll.rate)}（${playtest.referenceReroll.count} 条） |`,
	);
	lines.push(
		`| 重 roll 率 95% 置信区间 | ${intervalText(playtest.judgeReroll.interval)} | ${intervalText(playtest.referenceReroll.interval)} |`,
	);
	lines.push(
		`| 判定为遵循指令 | ${pct(playtest.judgeFollowed.rate)}（${playtest.judgeFollowed.count} 条） | ${pct(playtest.referenceFollowed.rate)}（${playtest.referenceFollowed.count} 条） |`,
	);
	lines.push(`| 判定失败 | ${playtest.judgeFailures} | ${playtest.referenceFailures} |`);
	lines.push("");
	lines.push("配对对照：", "");
	lines.push("| 项目 | 数值 |", "|---|---|");
	lines.push(
		`| 重 roll 判定一致 | ${playtest.rerollAgreement.count}（${pct(playtest.rerollAgreement.rate)}，95% 置信区间 ${intervalText(playtest.rerollAgreement.interval)}） |`,
	);
	lines.push(
		`| 跟随指令判定一致 | ${playtest.followedAgreement.count}（${pct(playtest.followedAgreement.rate)}，95% 置信区间 ${intervalText(playtest.followedAgreement.interval)}） |`,
	);
	lines.push(
		`| 参考要重 roll、裁判不重 roll | ${playtest.missedReroll} |`,
	);
	lines.push(
		`| 裁判要重 roll、参考不重 roll | ${playtest.extraReroll} |`,
	);
	lines.push(
		`| 重 roll 率差（裁判减参考） | ${points(playtest.rerollDifference)} |`,
	);
	lines.push(
		`| 外部参照：F0 的 1–10 楼真实重 roll 率 | ${pct(F0_EARLY_REROLL_RATE)}（写作模型与内容不同，只作参照） |`,
	);
	lines.push("");
	lines.push("#### 第二部分结论", "");
	if (!playtest.sufficientlySampled) {
		lines.push(
			`- 可判定样本 ${playtest.pairs} 条，少于 ${MIN_PLAYTEST_SAMPLES} 条，只报告数字，不判定尺度。`,
		);
	} else if (playtest.lenient) {
		lines.push(
			`- 裁判的重 roll 率比模拟用户模型低 ${points(Math.abs(playtest.rerollDifference))}，超过 ${points(LENIENCY_MARGIN)} 的宽松界：判定尺度偏宽松，\`judge\` 不用于重 roll 判定；R2-T04 改用确定性指标加配对统计。`,
		);
	} else {
		lines.push(
			`- 裁判的重 roll 率与模拟用户模型的差没有超过 ${points(LENIENCY_MARGIN)} 的宽松界：没有证据显示判定尺度偏宽松。`,
		);
	}
	lines.push(
		`- 自动试玩还没有记录玩家的行为偏好（R2-T07 待做），这里的参考是同一个模拟用户模型对同一回复的判定；它不是玩家的真实 swipe，只能说明两个评审的尺度是否一致。`,
	);
	lines.push("");
	return lines;
}

/**
 * 渲染报告正文。calibration 为 summarizeJudge 的返回值，
 * playtest 为 summarizeTurnComparison 的返回值；只含聚合数字。
 */
export function renderR2JudgeSection({ calibration, playtest, meta }) {
	const lines = [];
	lines.push("<!-- R2-T03.b:begin -->");
	lines.push(...calibrationSection(calibration, meta));
	lines.push(...playtestSection(playtest, meta));
	lines.push("#### 总体判定", "");
	const calibrationPassed = calibration.thresholds.passed;
	const playtestUsable =
		playtest.sufficientlySampled && !playtest.lenient;
	if (calibrationPassed && playtestUsable) {
		lines.push(
			"- 两部分都通过：`judge` 可以用于重 roll 的聚合判定，单次判断与偏好结论仍以玩家数据为准。",
		);
	} else {
		const reasons = [];
		if (!calibrationPassed) reasons.push("配对校准未达门槛");
		if (!playtestUsable) reasons.push("试玩尺度对照未通过");
		lines.push(
			`- ${reasons.join("、")}：\`judge\` 不用于重 roll 判定；R2-T04 的盲测改用确定性指标加配对统计，并在报告注明。`,
		);
	}
	lines.push("<!-- R2-T03.b:end -->");
	return lines.join("\n");
}

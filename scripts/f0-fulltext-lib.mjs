// F0-T04：全文基线与记忆引擎对比的纯函数部分：分支点选择、裁判提示词、统计与报告渲染。

export const PROBE_LEVELS = Object.freeze([
	32768, 65536, 131072, 262144, 524288, 1048576,
]);

export const FULLTEXT_ARMS = Object.freeze(["full", "memory"]);

export const JUDGE_ORDERS = Object.freeze(["full-first", "memory-first"]);

const FILLER_UNIT =
	"这是一段用于探测模型输入长度上限的填充文本，内容没有意义，只用于测量请求能否被渠道接受。";

/** 按估算器生成大约 targetTokens 个 token 的填充文本。 */
export function buildFiller(targetTokens, estimator) {
	if (!Number.isInteger(targetTokens) || targetTokens < 1) {
		throw new Error(`填充文本的 token 目标必须是正整数：${String(targetTokens)}`);
	}
	if (typeof estimator !== "function") {
		throw new Error("填充文本需要 token 估算函数");
	}
	const unitTokens = estimator(FILLER_UNIT);
	let repeats = Math.max(1, Math.ceil(targetTokens / unitTokens));
	let text = FILLER_UNIT.repeat(repeats);
	while (repeats > 1 && estimator(text) > targetTokens) {
		repeats -= 1;
		text = FILLER_UNIT.repeat(repeats);
	}
	if (estimator(text) < targetTokens * 0.9) {
		throw new Error("填充文本的估算值与目标相差过大");
	}
	return text;
}

/**
 * 分支点必须是用户楼层，且此前的助手楼层数达到摘要门槛、
 * 原文 token 不超过上下文余量。选满足条件的最后一个。
 */
export function chooseBranchPoint(nodes, options) {
	const maxRawTokens = options?.maxRawTokens;
	const minAssistantFloors = options?.minAssistantFloors ?? 20;
	if (!Number.isInteger(maxRawTokens) || maxRawTokens < 1) {
		throw new Error("分支点的原文 token 上限必须是正整数");
	}
	if (!Number.isInteger(minAssistantFloors) || minAssistantFloors < 1) {
		throw new Error("分支点的助手楼层门槛必须是正整数");
	}
	if (!Array.isArray(nodes) || nodes.length === 0) {
		throw new Error("分支点选择需要非空的楼层列表");
	}
	let chosen = null;
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (node.role !== "user") continue;
		if (node.assistantBefore < minAssistantFloors) continue;
		if (node.rawTokens > maxRawTokens) continue;
		chosen = { index, node };
	}
	if (chosen === null) throw new Error("没有满足条件的分支点");
	return chosen;
}

function roleLabel(role) {
	if (role === "user") return "用户";
	if (role === "system") return "系统";
	return "助手";
}

/** 把分支点之前的全部楼层按时间顺序写进一段文本，供裁判阅读。 */
export function renderTranscript(nodes) {
	if (!Array.isArray(nodes) || nodes.length === 0) {
		throw new Error("裁判材料需要非空的楼层列表");
	}
	const lines = ["以下是故事到目前为止的全部楼层（按时间顺序）："];
	nodes.forEach((node) => {
		lines.push(`<楼层 角色="${roleLabel(node.role)}">`);
		lines.push(node.text);
		lines.push("</楼层>");
	});
	return lines.join("\n");
}

export function assertJudgeOrder(order) {
	if (!JUDGE_ORDERS.includes(order)) {
		throw new Error(`未知的裁判顺序：${String(order)}`);
	}
	return order;
}

/** 两种顺序里位置甲分别放哪一份续写。 */
export function positionAArm(order) {
	assertJudgeOrder(order);
	return order === "full-first" ? "full" : "memory";
}

export function buildJudgeMessages(input) {
	assertJudgeOrder(input.order);
	if (typeof input.transcript !== "string" || input.transcript.length === 0) {
		throw new Error("裁判材料缺少故事正文");
	}
	if (typeof input.fullText !== "string" || input.fullText.length === 0) {
		throw new Error("裁判材料缺少全文组的续写");
	}
	if (typeof input.memoryText !== "string" || input.memoryText.length === 0) {
		throw new Error("裁判材料缺少记忆引擎组的续写");
	}
	const first = positionAArm(input.order) === "full" ? input.fullText : input.memoryText;
	const second = positionAArm(input.order) === "full" ? input.memoryText : input.fullText;
	const system = [
		"你是故事编辑，正在比较同一处用户发言之后的两份续写。",
		"先通读故事到目前为止的全部楼层，再分别看续写甲与续写乙。",
		"判断哪一份与已发生的内容矛盾更少、遗漏或遗忘的关键信息更少。",
		"两个版本差别很小时仍然要选一个。位置与质量无关，不要因为某一份排在前面或后面就偏向它。",
		"confidence 是 0 到 1 的小数，表示你对选择的把握。",
		'只输出一个 JSON 对象，不要 Markdown，不要解释：{"choice": "A", "confidence": 0.0}',
		'choice 取 "A"（续写甲）或 "B"（续写乙）。',
	].join("\n");
	const user = [
		input.transcript,
		`续写甲：\n${first}`,
		`续写乙：\n${second}`,
		"请输出你的判断。",
	].join("\n\n");
	return {
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		positionAArm: positionAArm(input.order),
	};
}

function stripCodeFence(text) {
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ?? text;
}

function tryParseJson(text) {
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

export function parseJudgeOutput(text) {
	const body = stripCodeFence(String(text ?? "").trim());
	const parsed = tryParseJson(body) ?? tryParseJson(extractJsonObject(body));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
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

/** 裁判选中全文组时返回 true；顺序决定位置甲对应哪一组。 */
export function judgePicksFull(order, choice) {
	assertJudgeOrder(order);
	if (choice !== "A" && choice !== "B") {
		throw new Error(`choice 不合法：${String(choice)}`);
	}
	return positionAArm(order) === "full" ? choice === "A" : choice === "B";
}

/**
 * 汇总每个分支两种顺序的判断。只有 ok 为 true 的判断参与统计；
 * 同一分支同一顺序出现多行时取最后一行。
 */
export function summarizeBranches(branches, judgements) {
	const byKey = new Map();
	for (const entry of judgements) {
		if (entry?.ok !== true) continue;
		assertJudgeOrder(entry.order);
		const label = entry.branch ?? entry.label;
		if (typeof label !== "string") {
			throw new Error("裁判结果缺少分支标签");
		}
		byKey.set(`${label}|${entry.order}`, entry);
	}
	const rows = [];
	const all = [];
	for (const branch of branches) {
		const entries = JUDGE_ORDERS.map((order) =>
			byKey.get(`${branch.label}|${order}`),
		).filter((entry) => entry !== undefined);
		if (entries.length === 0) continue;
		const fullWins = entries.filter((entry) =>
			judgePicksFull(entry.order, entry.choice),
		).length;
		const consistent =
			entries.length === JUDGE_ORDERS.length
				? judgePicksFull(entries[0].order, entries[0].choice) ===
					judgePicksFull(entries[1].order, entries[1].choice)
				: null;
		rows.push({
			label: branch.label,
			judgements: entries.length,
			fullWins,
			memoryWins: entries.length - fullWins,
			consistent,
			confidenceMean:
				entries.reduce((sum, entry) => sum + entry.confidence, 0) /
				entries.length,
		});
		all.push(...entries);
	}
	const total = all.length;
	const fullWins = all.filter((entry) =>
		judgePicksFull(entry.order, entry.choice),
	).length;
	const positionA = all.filter((entry) => entry.choice === "A").length;
	const perOrder = JUDGE_ORDERS.map((order) => {
		const entries = all.filter((entry) => entry.order === order);
		const wins = entries.filter((entry) =>
			judgePicksFull(entry.order, entry.choice),
		).length;
		return {
			order,
			judgements: entries.length,
			fullWins: wins,
			memoryWins: entries.length - wins,
			positionAShare:
				entries.length === 0
					? null
					: entries.filter((entry) => entry.choice === "A").length /
						entries.length,
		};
	});
	const bothOrders = rows.filter((row) => row.consistent !== null);
	return {
		branches: rows,
		judgements: total,
		fullWins,
		memoryWins: total - fullWins,
		positionAShare: total === 0 ? null : positionA / total,
		consistentBranches: bothOrders.filter((row) => row.consistent).length,
		branchesWithBothOrders: bothOrders.length,
		perOrder,
		confidenceMean:
			total === 0
				? null
				: all.reduce((sum, entry) => sum + entry.confidence, 0) / total,
	};
}

function formatPercent(value) {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value) {
	return value === null || value === undefined ? "—" : String(value);
}

function tokenRange(generations, arm) {
	const values = generations
		.filter((entry) => entry.arm === arm)
		.map((entry) => entry.assembledTokens)
		.filter((value) => typeof value === "number");
	if (values.length === 0) return "—";
	return `${Math.min(...values)}–${Math.max(...values)}`;
}

function renderProbeRows(probe) {
	return probe.entries
		.map(
			(entry) =>
				`| ${entry.level} | ${entry.estimatedTokens} | ${entry.modelAlias} | ${
					entry.ok ? "成功" : "失败"
				} | ${formatNumber(entry.promptTokens)} | ${formatNumber(
					entry.cachedTokens,
				)} | ${formatNumber(entry.inputTokens)} | ${formatNumber(
					entry.firstTokenMs,
				)} | ${formatNumber(entry.durationMs)} | ${entry.note} |`,
		)
		.join("\n");
}

function renderBranchRows(branches) {
	return branches
		.map(
			(branch) =>
				`| 对话 ${branch.label} | ${branch.priorFloors} | ${branch.assistantFloors} | ${branch.rawTokens} | ${branch.viewTokens} | ${branch.summaryCount} | ${branch.stateDiffCount} |`,
		)
		.join("\n");
}

function renderGenerationRows(generations) {
	return generations
		.map(
			(entry) =>
				`| 对话 ${entry.label} | ${entry.arm === "full" ? "全文" : "记忆引擎"} | ${formatNumber(
					entry.maxTokens ?? 2048,
				)} | ${formatNumber(entry.assembledTokens)} | ${formatNumber(
					entry.promptTokens,
				)} | ${formatNumber(entry.firstTokenMs)} | ${formatNumber(
					entry.completionTokens,
				)} | ${entry.stopReason} |`,
		)
		.join("\n");
}

function renderJudgeRows(summary) {
	return summary.branches
		.map(
			(row) =>
				`| 对话 ${row.label} | ${row.judgements} | ${row.fullWins} | ${row.memoryWins} | ${
					row.consistent === null ? "—" : row.consistent ? "一致" : "不一致"
				} | ${row.confidenceMean.toFixed(2)} |`,
		)
		.join("\n");
}

export function renderFulltextSection(input) {
	const probe = input.probe;
	const branchSummary = summarizeBranches(input.branches, input.judgements);
	const lines = [
		"<!-- F0-T04:begin -->",
		"## 全文基线与记忆引擎对比（F0-T04）",
		"",
		`生成时间：${input.generatedAt}`,
		"",
		"口径：",
		"",
		"- 上限探测使用正文渠道，输入是合成填充文本，输出上限压到最小；每级记录是否被接受、未命中前缀缓存的输入 token、缓存命中 token、首字延迟与结束原因。",
		"- 分支点选在用户楼层：此前的助手楼层数达到摘要门槛，且此前全部原文的 token 估算不超过上下文余量；同一分支点分别用「全部正文 + 原生模板」与「当前记忆引擎」各生成一次。",
		"- 全文组把分支点之前的全部原文按角色顺序放进上下文，只保留原生模板的协议段；记忆引擎组使用状态快照、分层摘要、多路记忆检索、最近 20 楼与角色槽位，世界书与导演关闭。",
		"- 全文 token 用 core 的块解析器剔除标签块之后再估算，报告同时给出剔除前后的两个口径。",
		"- 裁判收到分支点之前的全部原文与两份续写，以两种顺序各判一次，问哪一份矛盾更少、遗忘的关键信息更少。",
		"- 以上全部调用固定同一个模型，结论是同模型自评。",
		"",
		"### 请求长度上限探测",
		"",
		`正文渠道模型：${probe.modelAlias}`,
		"",
		"| 目标 token | 预计输入 token | 模型别名 | 结果 | 未缓存输入 token | 缓存命中 token | 输入合计 | 首字毫秒 | 总毫秒 | 说明 |",
		"|---|---|---|---|---|---|---|---|---|---|",
		renderProbeRows(probe),
		"",
		`上限结论：${probe.conclusion}`,
		"",
		probe.switchedFrom === null
			? "本次探测直接使用配置里的正文模型。"
			: `配置里的正文模型别名 ${probe.switchedFrom} 在最小探测级别失败，按 ADR-0042 改用 ${probe.modelAlias}；下表的模型别名按实际路由记录。`,
		`配置里正文模型的 contextWindow 是 ${probe.contextWindow ?? "—"}；上面的探测显示渠道接受更大的输入，配置值只影响本地估算与预算裁剪。`,
		"",
		"### 分支点",
		"",
		"| 对话 | 此前楼层 | 此前助手楼层 | 原文 token（含标签） | 原文 token（不含标签） | 摘要条数 | 状态 diff 条数 |",
		"|---|---|---|---|---|---|---|",
		renderBranchRows(input.branches),
		"",
		"### 生成",
		"",
		"| 对话 | 组 | 输出上限 | 组装估算 token | 未缓存输入 token | 首字毫秒 | 输出 token | 结束原因 |",
		"|---|---|---|---|---|---|---|---|",
		renderGenerationRows(input.generations),
		"",
		"上下文规模以组装估算为准；提供方报告的输入 token 是未命中前缀缓存的部分，重跑过的组合会大量命中缓存，不能直接当作上下文大小。首轮输出上限是 2048，结束原因为 length 的组合用 4096 重跑一次，表中只保留最终结果。",
		"",
		`正文渠道调用 ${input.callCounts.main} 次（上限 30），后台裁判调用 ${input.callCounts.judge} 次。${
			(input.callCounts.discarded ?? 0) > 0
				? `其中 ${input.callCounts.discarded} 条生成结果没有进入当前对比（提供方拒绝生成或已被替换），仍计入调用次数。`
				: ""
		}`,
		"",
		"### 裁判结果",
		"",
		"| 对话 | 判断 | 全文组胜 | 记忆引擎组胜 | 两种顺序是否一致 | 平均置信度 |",
		"|---|---|---|---|---|---|",
		renderJudgeRows(branchSummary),
		"",
		`合计 ${branchSummary.judgements} 次判断：全文组胜 ${branchSummary.fullWins} 次，记忆引擎组胜 ${branchSummary.memoryWins} 次；位置甲占比 ${formatPercent(
			branchSummary.positionAShare,
		)}；两种顺序结论一致的分支 ${branchSummary.consistentBranches}/${branchSummary.branchesWithBothOrders}；平均置信度 ${
			branchSummary.confidenceMean === null
				? "—"
				: branchSummary.confidenceMean.toFixed(2)
		}。`,
		"",
		"按顺序分组：",
		"",
		"| 顺序 | 判断 | 全文组胜 | 记忆引擎组胜 | 选位置甲占比 |",
		"|---|---|---|---|---|",
		branchSummary.perOrder
			.map(
				(order) =>
					`| ${order.order} | ${order.judgements} | ${order.fullWins} | ${order.memoryWins} | ${formatPercent(order.positionAShare)} |`,
			)
			.join("\n"),
		"",
		"### 结论",
		"",
		`- ${probe.conclusion}`,
		probe.switchedFrom === null
			? "- 正文模型没有切换路由。"
			: `- 配置里的正文模型别名 ${probe.switchedFrom} 不可用，实际使用 ${probe.modelAlias}。`,
		`- 全文组的组装估算输入 ${tokenRange(input.generations, "full")} token，记忆引擎组 ${tokenRange(input.generations, "memory")} token。`,
		`- 裁判 ${branchSummary.judgements} 次判断里全文组胜 ${branchSummary.fullWins} 次、记忆引擎组胜 ${branchSummary.memoryWins} 次；两种顺序结论一致的分支 ${branchSummary.consistentBranches}/${branchSummary.branchesWithBothOrders}。`,
		`- 两种顺序结论不一致的分支有 ${branchSummary.branchesWithBothOrders - branchSummary.consistentBranches} 个；裁判判断受位置与抽样影响的可能性无法排除，样本只有几个分支点，结论只作描述。`,
		"",
		"### 限制",
		"",
		"- 样本只有几个分支点，裁判判断只做描述，不据此设门槛。",
		"- 记忆引擎组的摘要只覆盖章节级，事件池没有为本次对比构建；本次没有导入角色卡与世界书，两组都没有这些槽位。",
		"- 裁判与生成使用同一个模型，结论不能当作 R2 的裁判口径。",
		"- 全文组包含标签块原文，记忆引擎组使用剔除标签块后的上下文视图；两组的差异同时包含记忆机制与标签处理。",
		"",
		"<!-- F0-T04:end -->",
	];
	return lines.join("\n");
}

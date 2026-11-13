import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type ContextSlotProviders,
	type ContextTemplate,
	type LlmClient,
	type LlmStreamingClient,
	StoryStore as SqliteStoryStore,
	type StoryStore,
	type StructuredOutputMode,
	createDefaultContextTemplate,
	createStandardChatSlots,
	isJsonObject,
	isStructuredOutputMode,
	runChatTurn,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	parseCharacterCardFile,
} from "../character-card.js";
import { importChatFileToStore } from "../chat-import.js";
import { importCardContent } from "../chat/session.js";
import {
	type PercentileSummary,
	summarizePercentiles,
} from "../evalset/deep-eval.js";
import {
	type ForgettingQuestionRecord,
	type ForgettingStaticQuestion,
	runForgettingQuestions,
	summarizeQuestionRecords,
} from "../evalset/forgetting.js";
import { readMemoryQuestionFile } from "../evalset/memory-questions.js";
import {
	type PreferenceComparisonRecord,
	type PreferenceComparisonSummary,
	type PreferenceSample,
	formatPairwiseContext,
	runPreferenceSample,
	summarizePreferenceComparisons,
} from "../evalset/pairwise.js";

/** 指标变差的门槛；报告与 ADR 共用这些数字。 */
export const COEXIST_REGRESSION_MARGIN = 0.05;
export const COEXIST_BLIND_WIN_FLOOR = 0.45;
export const COEXIST_BLIND_WIN_CEILING = 0.55;
export const COEXIST_FIRST_TOKEN_RATIO = 1.2;
export const COEXIST_FIRST_TOKEN_MIN_DELTA_MS = 100;
export const COEXIST_MIN_SAMPLES = 5;
export const COEXIST_DEFAULT_BUDGET_TOKENS = 32_000;
export const COEXIST_REPORT_FILE = "report.md";
export const COEXIST_METRICS_FILE = "metrics.json";
export const COEXIST_CONFIG_FORMAT = "dramaticer.st-bench-coexist";

/**
 * 兼容插件在共存评测里的唯一入口。关闭时用基础模板与槽位；
 * 开启时由插件返回它改写后的模板与槽位，评测运行器不做别的假设。
 */
export interface CoexistPluginAdapter {
	readonly id: string;
	apply(
		input: CoexistApplyInput,
	): Promise<CoexistApplyResult> | CoexistApplyResult;
}

/**
 * 供 CLI 使用的已注册兼容插件。C-T02–C-T05 在这里加入各自的适配器；
 * 适配器只改写模板与槽位，不直接写楼层或台账。
 */
export const ST_BENCH_COEXIST_PLUGINS: readonly CoexistPluginAdapter[] = [];

export interface CoexistApplyInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly card: StCharacterCard;
	readonly template: ContextTemplate;
	readonly providers: ContextSlotProviders;
	readonly budgetTokens: number;
	readonly structuredOutput: StructuredOutputMode;
}

export interface CoexistApplyResult {
	readonly template?: ContextTemplate;
	readonly providers?: ContextSlotProviders;
	/** 只进报告，不含正文。 */
	readonly notes?: readonly string[];
}

/** 一张卡在两种开关状态下各跑一遍；脚本消息保证两边输入一致。 */
export interface CoexistCardSpec {
	readonly id: string;
	readonly storyId: string;
	readonly title: string;
	readonly card: StCharacterCard;
	/** 可选的已有对话；导入后两边从同一分支点继续。 */
	readonly chatPath: string | null;
	readonly messages: readonly string[];
	readonly questions: readonly ForgettingStaticQuestion[];
}

export interface CoexistRunConfig {
	readonly pluginIds: readonly string[];
	readonly cards: readonly CoexistCardSpec[];
	/** 每张卡最多跑几轮；不设置时用脚本消息条数。 */
	readonly rounds: number | null;
	readonly budgetTokens: number;
	readonly maxTokens: number | null;
	readonly temperature: number | null;
	readonly structuredOutput: StructuredOutputMode;
}

export interface CoexistRunOptions {
	readonly config: CoexistRunConfig;
	readonly plugins: readonly CoexistPluginAdapter[];
	readonly writer: {
		readonly client: LlmStreamingClient;
		readonly model: string;
	};
	readonly judge: { readonly client: LlmClient; readonly model: string };
	readonly runDir: string;
	readonly now?: () => number;
	readonly log?: (message: string) => void;
}

export type CoexistVariant = "off" | "on";

export interface CoexistRoundRecord {
	readonly round: number;
	readonly userText: string;
	readonly reply: string | null;
	readonly firstTokenMs: number | null;
	readonly durationMs: number | null;
	readonly error: string | null;
}

export interface CoexistVariantRun {
	readonly cardId: string;
	readonly variant: CoexistVariant;
	readonly rounds: readonly CoexistRoundRecord[];
	readonly questions: readonly ForgettingQuestionRecord[];
	readonly notes: readonly string[];
	/** 导入片段后的公共前缀；盲评语境只用它与此前的脚本消息。 */
	readonly baseContext: string;
}

export type CoexistMetricName =
	| "contradiction"
	| "fabricated"
	| "blindWin"
	| "firstToken";

export type CoexistVerdict = "better" | "same" | "worse" | "insufficient";

export interface CoexistMetricComparison {
	readonly metric: CoexistMetricName;
	readonly off: number | null;
	readonly on: number | null;
	readonly samplesOff: number;
	readonly samplesOn: number;
	readonly verdict: CoexistVerdict;
	readonly detail: string;
}

export interface CoexistComparison {
	readonly pluginId: string;
	readonly cards: number;
	readonly roundsOff: number;
	readonly roundsOn: number;
	readonly failedRoundsOff: number;
	readonly failedRoundsOn: number;
	readonly metrics: readonly CoexistMetricComparison[];
	readonly degraded: readonly CoexistMetricComparison[];
	readonly pairwise: PreferenceComparisonSummary;
	readonly variantsOff: readonly CoexistVariantRun[];
	readonly variantsOn: readonly CoexistVariantRun[];
	readonly generatedAt: string;
}

export interface CoexistOutputFiles {
	readonly reportFile: string;
	readonly metricsFile: string;
}

interface CardVariantPair {
	readonly card: CoexistCardSpec;
	readonly off: CoexistVariantRun;
	readonly on: CoexistVariantRun;
	readonly baseContext: string;
}

/**
 * 同一批卡在插件关闭与开启时各跑一遍，再按 R2 的裁判口径比较
 * 矛盾率、编造回忆率、盲测胜率与首字延迟。只调用 Dramaticer 的渠道，
 * 不启动沙箱 ST，也不使用玩家本机的 ST 额度（I14）。
 * 配置里的每个插件各自输出一份对比。
 */
export async function runCoexistComparisons(
	options: CoexistRunOptions,
): Promise<readonly CoexistComparison[]> {
	assertConfig(options.config);
	const registry = new Map(
		options.plugins.map((plugin) => [plugin.id, plugin]),
	);
	for (const id of options.config.pluginIds) {
		if (!registry.has(id)) {
			throw new Error(
				`没有注册兼容插件 ${id}；可用插件：${[...registry.keys()].join("、") || "（空）"}`,
			);
		}
	}
	await mkdir(options.runDir, { recursive: true });
	const comparisons: CoexistComparison[] = [];
	for (const pluginId of options.config.pluginIds) {
		const adapter = registry.get(pluginId);
		if (adapter === undefined) throw new Error(`插件 ${pluginId} 未注册`);
		comparisons.push(await comparePlugin(options, adapter));
	}
	return comparisons;
}

async function comparePlugin(
	options: CoexistRunOptions,
	adapter: CoexistPluginAdapter,
): Promise<CoexistComparison> {
	const log = options.log ?? (() => undefined);
	const pairs: CardVariantPair[] = [];
	for (const card of options.config.cards) {
		const rounds = options.config.rounds ?? card.messages.length;
		log(`插件 ${adapter.id}：卡 ${card.id}，关闭与开启各 ${rounds} 轮`);
		const off = await runVariant(options, card, "off", null, rounds);
		const on = await runVariant(options, card, "on", adapter, rounds);
		const baseContext = off.baseContext;
		pairs.push({ card, off, on, baseContext });
	}
	const pairwise = await judgePairs(options, adapter, pairs);
	const metrics = buildMetrics(pairs, pairwise);
	const degraded = metrics.filter((metric) => metric.verdict === "worse");
	return {
		pluginId: adapter.id,
		cards: pairs.length,
		roundsOff: countRounds(pairs, "off"),
		roundsOn: countRounds(pairs, "on"),
		failedRoundsOff: countFailures(pairs, "off"),
		failedRoundsOn: countFailures(pairs, "on"),
		metrics,
		degraded,
		pairwise,
		variantsOff: pairs.map((pair) => pair.off),
		variantsOn: pairs.map((pair) => pair.on),
		generatedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
	};
}

function assertConfig(config: CoexistRunConfig): void {
	if (config.pluginIds.length === 0) {
		throw new Error("共存评测至少要配置一个兼容插件");
	}
	if (new Set(config.pluginIds).size !== config.pluginIds.length) {
		throw new Error(`插件 id 重复：${config.pluginIds.join("、")}`);
	}
	for (const id of config.pluginIds) {
		if (!/^[A-Za-z0-9._-]+$/.test(id)) {
			throw new Error(`插件 id 只允许字母、数字、点、下划线与短横线：${id}`);
		}
	}
	if (config.cards.length === 0) {
		throw new Error("共存评测至少要配置一张卡");
	}
	const cardIds = new Set<string>();
	const storyIds = new Set<string>();
	for (const card of config.cards) {
		if (card.id.length === 0) throw new Error("卡 id 不能为空");
		if (card.storyId.length === 0) throw new Error("故事 id 不能为空");
		if (card.title.length === 0) throw new Error("故事标题不能为空");
		if (cardIds.has(card.id)) throw new Error(`卡 id 重复：${card.id}`);
		if (storyIds.has(card.storyId)) {
			throw new Error(`故事 id 重复：${card.storyId}`);
		}
		cardIds.add(card.id);
		storyIds.add(card.storyId);
		if (card.messages.length === 0) {
			throw new Error(`卡 ${card.id} 没有脚本消息`);
		}
		for (const message of card.messages) {
			if (message.length === 0) {
				throw new Error(`卡 ${card.id} 的脚本消息不能为空`);
			}
		}
		for (const question of card.questions) {
			if (question.story !== card.storyId) {
				throw new Error(
					`卡 ${card.id} 的题目 ${question.id} 属于故事 ${question.story}`,
				);
			}
		}
	}
	if (!Number.isInteger(config.budgetTokens) || config.budgetTokens < 1) {
		throw new Error(`token 预算必须是正整数，收到 ${config.budgetTokens}`);
	}
	if (config.rounds !== null) {
		if (!Number.isInteger(config.rounds) || config.rounds < 1) {
			throw new Error(`轮数必须是正整数，收到 ${config.rounds}`);
		}
		for (const card of config.cards) {
			if (config.rounds > card.messages.length) {
				throw new Error(
					`轮数 ${config.rounds} 超过卡 ${card.id} 的脚本消息条数 ${card.messages.length}`,
				);
			}
		}
	}
	if (!isStructuredOutputMode(config.structuredOutput)) {
		throw new Error(`未知的结构化输出方式：${config.structuredOutput}`);
	}
}

async function runVariant(
	options: CoexistRunOptions,
	card: CoexistCardSpec,
	variant: CoexistVariant,
	adapter: CoexistPluginAdapter | null,
	rounds: number,
): Promise<CoexistVariantRun> {
	const dir = path.join(
		options.runDir,
		safeSegment(adapter?.id ?? "baseline"),
		variant,
	);
	await mkdir(dir, { recursive: true });
	const store = SqliteStoryStore.open(
		path.join(dir, `${safeSegment(card.id)}.db`),
	);
	try {
		const { characterPrompt } = await prepareStory(store, card);
		const baseContext = formatPairwiseContext(
			store.getPathToHead(card.storyId),
		);
		const baseTemplate = createDefaultContextTemplate({
			structuredOutput: options.config.structuredOutput,
		});
		const slots = await createStandardChatSlots({
			store,
			characterPrompt,
		});
		let template = baseTemplate;
		let providers = slots.providers;
		let notes: readonly string[] = [];
		if (adapter !== null) {
			const applied = await adapter.apply({
				store,
				storyId: card.storyId,
				card: card.card,
				template,
				providers,
				budgetTokens: options.config.budgetTokens,
				structuredOutput: options.config.structuredOutput,
			});
			template = applied.template ?? template;
			providers = applied.providers ?? providers;
			notes = applied.notes ?? [];
		}
		const records: CoexistRoundRecord[] = [];
		for (let round = 1; round <= rounds; round += 1) {
			const userText = card.messages[round - 1];
			if (userText === undefined) {
				throw new Error(`卡 ${card.id} 缺少第 ${round} 轮脚本消息`);
			}
			const startedAt = options.now?.() ?? Date.now();
			try {
				const result = await runTurn(options, store, card, {
					template,
					providers,
					userText,
				});
				const finishedAt = options.now?.() ?? Date.now();
				records.push({
					round,
					userText,
					reply: result.raw,
					firstTokenMs: result.firstTokenMs,
					durationMs: finishedAt - startedAt,
					error: null,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				records.push({
					round,
					userText,
					reply: null,
					firstTokenMs: null,
					durationMs: null,
					error: message,
				});
			}
		}
		const questions =
			card.questions.length === 0
				? []
				: await askQuestions(options, store, card, template, providers);
		return {
			cardId: card.id,
			variant,
			rounds: records,
			questions,
			notes,
			baseContext,
		};
	} finally {
		store.close();
	}
}

async function prepareStory(
	store: StoryStore,
	card: CoexistCardSpec,
): Promise<{ readonly characterPrompt: string }> {
	if (card.chatPath === null) {
		store.createStory({ id: card.storyId, title: card.title });
	} else {
		await importChatFileToStore(store, card.chatPath, {
			storyId: card.storyId,
			title: card.title,
		});
	}
	const content = importCardContent(store, card.storyId, { card: card.card });
	store.updateStorySettings(card.storyId, {
		cardName: content.cardName,
		characterPrompt: content.characterPrompt,
	});
	return { characterPrompt: content.characterPrompt };
}

async function runTurn(
	options: CoexistRunOptions,
	store: StoryStore,
	card: CoexistCardSpec,
	turn: {
		readonly template: ContextTemplate;
		readonly providers: ContextSlotProviders;
		readonly userText: string;
	},
): Promise<{ readonly raw: string; readonly firstTokenMs: number | null }> {
	const result = await runChatTurn({
		store,
		storyId: card.storyId,
		client: options.writer.client,
		userText: turn.userText,
		template: turn.template,
		providers: turn.providers,
		budgetTokens: options.config.budgetTokens,
		structuredOutput: options.config.structuredOutput,
		model: options.writer.model,
		...(options.config.maxTokens === null
			? {}
			: { maxTokens: options.config.maxTokens }),
		...(options.config.temperature === null
			? {}
			: { temperature: options.config.temperature }),
	});
	return {
		raw: result.node.raw,
		firstTokenMs: result.trace.timing.firstTokenMs,
	};
}

async function askQuestions(
	options: CoexistRunOptions,
	store: StoryStore,
	card: CoexistCardSpec,
	template: ContextTemplate,
	providers: ContextSlotProviders,
): Promise<readonly ForgettingQuestionRecord[]> {
	const head = store.getHead(card.storyId);
	if (head === null) return [];
	return runForgettingQuestions({
		store,
		storyId: card.storyId,
		askAtNode: head.id,
		questions: card.questions,
		template,
		providers,
		budgetTokens: options.config.budgetTokens,
		assistant: { client: options.writer.client, model: options.writer.model },
		judge: { client: options.judge.client, model: options.judge.model },
	});
}

async function judgePairs(
	options: CoexistRunOptions,
	adapter: CoexistPluginAdapter,
	pairs: readonly CardVariantPair[],
): Promise<PreferenceComparisonSummary> {
	const records: PreferenceComparisonRecord[] = [];
	for (const pair of pairs) {
		const rounds = options.config.rounds ?? pair.card.messages.length;
		for (let round = 1; round <= rounds; round += 1) {
			const off = pair.off.rounds.find((entry) => entry.round === round);
			const on = pair.on.rounds.find((entry) => entry.round === round);
			if (
				off?.reply === null ||
				off?.reply === undefined ||
				on?.reply === null ||
				on?.reply === undefined
			) {
				continue;
			}
			const prior = pair.card.messages
				.slice(0, round - 1)
				.map((message) => `玩家：${message}`)
				.join("\n\n");
			const context = [pair.baseContext, prior]
				.filter((part) => part.trim().length > 0)
				.join("\n\n");
			const sample: PreferenceSample = {
				sampleId: `${adapter.id}:${pair.card.id}:${round}`,
				storyId: pair.card.storyId,
				kind: "historical",
				sourceEventId: `${adapter.id}:${pair.card.id}:${round}`,
				earlierSwipe: false,
				context,
				acceptedText: on.reply,
				abandonedText: off.reply,
			};
			records.push(
				...(await runPreferenceSample(sample, {
					client: options.judge.client,
					model: options.judge.model,
				})),
			);
		}
	}
	return summarizePreferenceComparisons(records);
}

function buildMetrics(
	pairs: readonly CardVariantPair[],
	pairwise: PreferenceComparisonSummary,
): CoexistMetricComparison[] {
	const offQuestions = pairs.flatMap((pair) => pair.off.questions);
	const onQuestions = pairs.flatMap((pair) => pair.on.questions);
	const offScore = summarizeQuestionRecords(offQuestions);
	const onScore = summarizeQuestionRecords(onQuestions);
	const offFirstToken = summarizePercentiles(
		pairs
			.flatMap((pair) => pair.off.rounds)
			.map((round) => round.firstTokenMs)
			.filter((value): value is number => value !== null),
	);
	const onFirstToken = summarizePercentiles(
		pairs
			.flatMap((pair) => pair.on.rounds)
			.map((round) => round.firstTokenMs)
			.filter((value): value is number => value !== null),
	);
	const overall = pairwise.groups[0];
	if (overall === undefined) {
		throw new Error("盲评汇总缺少总体分组");
	}
	return [
		compareRateMetric(
			"contradiction",
			"矛盾率",
			offScore.contradicted,
			offScore.consistent + offScore.contradicted,
			onScore.contradicted,
			onScore.consistent + onScore.contradicted,
			"占比越低越好",
		),
		compareRateMetric(
			"fabricated",
			"编造回忆率",
			offScore.fabricated,
			offScore.fabricatedJudged,
			onScore.fabricated,
			onScore.fabricatedJudged,
			"占比越低越好",
		),
		compareBlindWin(overall.acceptedShare, overall.judgements),
		compareFirstToken(offFirstToken, onFirstToken),
	];
}

function compareRateMetric(
	metric: CoexistMetricName,
	label: string,
	offNumerator: number,
	offDenominator: number,
	onNumerator: number,
	onDenominator: number,
	detail: string,
): CoexistMetricComparison {
	const off = offDenominator === 0 ? null : offNumerator / offDenominator;
	const on = onDenominator === 0 ? null : onNumerator / onDenominator;
	let verdict: CoexistVerdict;
	if (
		offDenominator < COEXIST_MIN_SAMPLES ||
		onDenominator < COEXIST_MIN_SAMPLES ||
		off === null ||
		on === null
	) {
		verdict = "insufficient";
	} else if (on - off >= COEXIST_REGRESSION_MARGIN) {
		verdict = "worse";
	} else if (off - on >= COEXIST_REGRESSION_MARGIN) {
		verdict = "better";
	} else {
		verdict = "same";
	}
	return {
		metric,
		off,
		on,
		samplesOff: offDenominator,
		samplesOn: onDenominator,
		verdict,
		detail: `${label}；${detail}；样本量 ${offDenominator}/${onDenominator}`,
	};
}

function compareBlindWin(
	acceptedShare: number | null,
	judgements: number,
): CoexistMetricComparison {
	let verdict: CoexistVerdict;
	if (acceptedShare === null || judgements < COEXIST_MIN_SAMPLES) {
		verdict = "insufficient";
	} else if (acceptedShare < COEXIST_BLIND_WIN_FLOOR) {
		verdict = "worse";
	} else if (acceptedShare > COEXIST_BLIND_WIN_CEILING) {
		verdict = "better";
	} else {
		verdict = "same";
	}
	return {
		metric: "blindWin",
		off: null,
		on: acceptedShare,
		samplesOff: judgements,
		samplesOn: judgements,
		verdict,
		detail: `开启侧胜率；门槛 ${COEXIST_BLIND_WIN_FLOOR} 到 ${COEXIST_BLIND_WIN_CEILING}；顺序级判定 ${judgements} 次`,
	};
}

function compareFirstToken(
	off: PercentileSummary | null,
	on: PercentileSummary | null,
): CoexistMetricComparison {
	let verdict: CoexistVerdict;
	if (
		off === null ||
		on === null ||
		off.count < COEXIST_MIN_SAMPLES ||
		on.count < COEXIST_MIN_SAMPLES
	) {
		verdict = "insufficient";
	} else if (
		on.p90 > off.p90 * COEXIST_FIRST_TOKEN_RATIO &&
		on.p90 - off.p90 >= COEXIST_FIRST_TOKEN_MIN_DELTA_MS
	) {
		verdict = "worse";
	} else if (
		off.p90 > on.p90 * COEXIST_FIRST_TOKEN_RATIO &&
		off.p90 - on.p90 >= COEXIST_FIRST_TOKEN_MIN_DELTA_MS
	) {
		verdict = "better";
	} else {
		verdict = "same";
	}
	return {
		metric: "firstToken",
		off: off?.p90 ?? null,
		on: on?.p90 ?? null,
		samplesOff: off?.count ?? 0,
		samplesOn: on?.count ?? 0,
		verdict,
		detail: `首字 P90（毫秒）；变差门槛 ${COEXIST_FIRST_TOKEN_RATIO} 倍且多 ${COEXIST_FIRST_TOKEN_MIN_DELTA_MS} 毫秒`,
	};
}

function countRounds(
	pairs: readonly CardVariantPair[],
	variant: CoexistVariant,
): number {
	return pairs.reduce(
		(total, pair) =>
			total + (variant === "off" ? pair.off : pair.on).rounds.length,
		0,
	);
}

function countFailures(
	pairs: readonly CardVariantPair[],
	variant: CoexistVariant,
): number {
	return pairs.reduce(
		(total, pair) =>
			total +
			(variant === "off" ? pair.off : pair.on).rounds.filter(
				(round) => round.error !== null,
			).length,
		0,
	);
}

export function renderCoexistReport(
	comparison: CoexistComparison,
	config: CoexistRunConfig,
): string {
	const lines: string[] = [];
	lines.push(`# 兼容插件共存对照：${comparison.pluginId}`);
	lines.push("");
	lines.push(
		`- 卡：${comparison.cards} 张（${config.cards.map((card) => card.id).join("、")}）`,
	);
	lines.push(
		`- 轮数：关闭 ${comparison.roundsOff}，开启 ${comparison.roundsOn}；失败：关闭 ${comparison.failedRoundsOff}，开启 ${comparison.failedRoundsOn}`,
	);
	lines.push(`- 结构化输出：${config.structuredOutput}`);
	lines.push(`- 生成时间：${comparison.generatedAt}`);
	lines.push(
		"- 口径：矛盾率与编造回忆率复用 R2 的跑后提问与裁判；盲测胜率复用 R2 的两顺序盲评，接受侧是开启插件的回复；首字延迟取 Trace。",
	);
	lines.push(
		"- 渠道：只用 Dramaticer 配置的模型，不启动沙箱 ST，不使用玩家本机 ST 额度（I14）。",
	);
	lines.push("");
	lines.push("## 原生指标");
	lines.push("");
	lines.push("|指标|关闭|开启|样本量（关/开）|判定|说明|");
	lines.push("|---|---|---|---|---|---|");
	for (const metric of comparison.metrics) {
		lines.push(
			`|${metricNameLabel(metric.metric)}|${formatMetric(metric.metric, metric.off)}|${formatMetric(metric.metric, metric.on)}|${metric.samplesOff}/${metric.samplesOn}|${verdictLabel(metric.verdict)}|${metric.detail}|`,
		);
	}
	lines.push("");
	const overall = comparison.pairwise.groups[0];
	const failures = comparison.pairwise.failures.length;
	if (overall !== undefined) {
		lines.push("## 盲评");
		lines.push("");
		lines.push(
			`- 样本 ${overall.samples} 个，顺序级判定 ${overall.judgements} 次，开启侧胜 ${overall.acceptedWins}、关闭侧胜 ${overall.abandonedWins}、平局 ${overall.ties}；两次顺序结论不一致 ${overall.inconsistent} 个样本；失败 ${failures} 次`,
		);
		lines.push("");
	}
	lines.push("## 逐卡轮次");
	lines.push("");
	lines.push(
		"|卡|关闭成功/失败|开启成功/失败|关闭首字 P50（毫秒）|开启首字 P50（毫秒）|",
	);
	lines.push("|---|---|---|---|---|");
	for (const card of config.cards) {
		const off = comparison.variantsOff.find((run) => run.cardId === card.id);
		const on = comparison.variantsOn.find((run) => run.cardId === card.id);
		if (off === undefined || on === undefined) continue;
		const offFirst = summarizePercentiles(
			off.rounds
				.map((round) => round.firstTokenMs)
				.filter((value): value is number => value !== null),
		);
		const onFirst = summarizePercentiles(
			on.rounds
				.map((round) => round.firstTokenMs)
				.filter((value): value is number => value !== null),
		);
		const offSuccess = off.rounds.filter(
			(round) => round.error === null,
		).length;
		const offFailures = off.rounds.length - offSuccess;
		const onSuccess = on.rounds.filter((round) => round.error === null).length;
		const onFailures = on.rounds.length - onSuccess;
		lines.push(
			`|${card.id}|${offSuccess}/${offFailures}|${onSuccess}/${onFailures}|${offFirst?.p50 ?? "—"}|${onFirst?.p50 ?? "—"}|`,
		);
	}
	lines.push("");
	lines.push("## 明显变差");
	lines.push("");
	if (comparison.degraded.length === 0) {
		lines.push("没有指标达到变差门槛。");
	} else {
		for (const metric of comparison.degraded) {
			lines.push(
				`- ${metricNameLabel(metric.metric)}：关闭 ${formatMetric(metric.metric, metric.off)}，开启 ${formatMetric(metric.metric, metric.on)}，样本量 ${metric.samplesOff}/${metric.samplesOn}`,
			);
		}
	}
	const notes = [
		...comparison.variantsOff.flatMap((run) => run.notes),
		...comparison.variantsOn.flatMap((run) => run.notes),
	];
	if (notes.length > 0) {
		lines.push("");
		lines.push("## 插件说明");
		lines.push("");
		for (const note of notes) lines.push(`- ${note}`);
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

function metricNameLabel(metric: CoexistMetricName): string {
	switch (metric) {
		case "contradiction":
			return "矛盾率";
		case "fabricated":
			return "编造回忆率";
		case "blindWin":
			return "盲测胜率（开启侧）";
		case "firstToken":
			return "首字 P90";
	}
}

function formatMetric(metric: CoexistMetricName, value: number | null): string {
	if (value === null) return "—";
	if (metric === "firstToken") return `${Math.round(value)} 毫秒`;
	return `${(value * 100).toFixed(1)}%`;
}

function verdictLabel(verdict: CoexistVerdict): string {
	switch (verdict) {
		case "better":
			return "变好";
		case "same":
			return "持平";
		case "worse":
			return "变差";
		case "insufficient":
			return "样本不足";
	}
}

export async function writeCoexistOutputs(
	runDir: string,
	comparison: CoexistComparison,
	config: CoexistRunConfig,
): Promise<CoexistOutputFiles> {
	await mkdir(runDir, { recursive: true });
	const reportFile = path.join(runDir, COEXIST_REPORT_FILE);
	const metricsFile = path.join(runDir, COEXIST_METRICS_FILE);
	await writeFile(reportFile, renderCoexistReport(comparison, config), "utf8");
	await writeFile(
		metricsFile,
		`${JSON.stringify(serializeComparison(comparison), null, "\t")}\n`,
		"utf8",
	);
	return { reportFile, metricsFile };
}

/** 落盘只写指标、样本量与开关状态，不写提示词与回复正文。 */
function serializeComparison(comparison: CoexistComparison): unknown {
	return {
		plugin: comparison.pluginId,
		cards: comparison.cards,
		rounds: {
			off: comparison.roundsOff,
			on: comparison.roundsOn,
			failedOff: comparison.failedRoundsOff,
			failedOn: comparison.failedRoundsOn,
		},
		metrics: comparison.metrics,
		degraded: comparison.degraded.map((metric) => metric.metric),
		pairwise: {
			groups: comparison.pairwise.groups,
			failures: comparison.pairwise.failures.length,
			records: comparison.pairwise.records,
		},
		generatedAt: comparison.generatedAt,
	};
}

export interface CoexistConfigFile {
	readonly format: string;
	readonly version: number;
	readonly writerModel: string;
	readonly judgeModel: string | null;
	readonly budgetTokens: number | null;
	readonly maxTokens: number | null;
	readonly temperature: number | null;
	readonly structuredOutput: StructuredOutputMode;
	readonly rounds: number | null;
	readonly plugins: readonly string[];
	readonly cards: readonly CoexistCardFile[];
}

export interface CoexistCardFile {
	readonly id: string;
	readonly storyId: string;
	readonly title: string;
	readonly cardPath: string;
	readonly chatPath: string | null;
	readonly messages: readonly string[];
	readonly questionsPath: string | null;
}

export async function loadCoexistConfig(
	configPath: string,
): Promise<CoexistConfigFile> {
	const absolute = path.resolve(configPath);
	let value: unknown;
	try {
		value = JSON.parse(await readFile(absolute, "utf8"));
	} catch (error) {
		throw new Error(
			`读取共存评测配置失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return parseCoexistConfig(value, path.dirname(absolute));
}

export function parseCoexistConfig(
	value: unknown,
	baseDir: string,
): CoexistConfigFile {
	if (!isJsonObject(value)) throw new Error("共存评测配置必须是 JSON 对象");
	const format = requireString(value.format, "format");
	if (format !== COEXIST_CONFIG_FORMAT) {
		throw new Error(`配置 format 是 ${format}，期望 ${COEXIST_CONFIG_FORMAT}`);
	}
	if (value.version !== 1) {
		throw new Error(`配置 version 只支持 1，收到 ${String(value.version)}`);
	}
	const structuredOutput = requireStructuredOutput(value.structuredOutput);
	const plugins = requireNonEmptyStrings(value.plugins, "plugins");
	const cardsValue = value.cards;
	if (!Array.isArray(cardsValue) || cardsValue.length === 0) {
		throw new Error("cards 必须是非空数组");
	}
	const cards = cardsValue.map((card, index) =>
		parseCardFile(card, `cards[${index}]`, baseDir),
	);
	return {
		format,
		version: 1,
		writerModel: requireString(value.writerModel, "writerModel"),
		judgeModel:
			value.judgeModel === undefined || value.judgeModel === null
				? null
				: requireString(value.judgeModel, "judgeModel"),
		budgetTokens:
			value.budgetTokens === undefined || value.budgetTokens === null
				? null
				: requirePositiveInteger(value.budgetTokens, "budgetTokens"),
		maxTokens:
			value.maxTokens === undefined || value.maxTokens === null
				? null
				: requirePositiveInteger(value.maxTokens, "maxTokens"),
		temperature:
			value.temperature === undefined || value.temperature === null
				? null
				: requireNumber(value.temperature, "temperature"),
		structuredOutput,
		rounds:
			value.rounds === undefined || value.rounds === null
				? null
				: requirePositiveInteger(value.rounds, "rounds"),
		plugins,
		cards,
	};
}

function parseCardFile(
	value: unknown,
	label: string,
	baseDir: string,
): CoexistCardFile {
	if (!isJsonObject(value)) throw new Error(`${label} 必须是对象`);
	const cardPath = resolveRelative(
		requireString(value.card, `${label}.card`),
		baseDir,
	);
	const chatPath =
		value.chat === undefined || value.chat === null
			? null
			: resolveRelative(requireString(value.chat, `${label}.chat`), baseDir);
	const questionsPath =
		value.questions === undefined || value.questions === null
			? null
			: resolveRelative(
					requireString(value.questions, `${label}.questions`),
					baseDir,
				);
	return {
		id: requireString(value.id, `${label}.id`),
		storyId: requireString(value.storyId, `${label}.storyId`),
		title: requireString(value.title, `${label}.title`),
		cardPath,
		chatPath,
		messages: requireNonEmptyStrings(value.messages, `${label}.messages`),
		questionsPath,
	};
}

/** 把配置里的文件读成可直接运行的卡：角色卡、题目与脚本消息。 */
export async function loadCoexistCards(
	file: CoexistConfigFile,
): Promise<readonly CoexistCardSpec[]> {
	const cards: CoexistCardSpec[] = [];
	for (const entry of file.cards) {
		const card = await parseCharacterCardFile(entry.cardPath);
		const questions =
			entry.questionsPath === null
				? []
				: (await readMemoryQuestionFile(entry.questionsPath)).map(
						(question) => ({
							id: question.id,
							story: question.story,
							question: question.question,
							answer: question.answer,
							evidenceNodes: question.evidenceNodes,
							kind: "memory" as const,
							category: question.category,
							fabricated: question.fabricated,
						}),
					);
		cards.push({
			id: entry.id,
			storyId: entry.storyId,
			title: entry.title,
			card,
			chatPath: entry.chatPath,
			messages: entry.messages,
			questions,
		});
	}
	return cards;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

function requireNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${label} 必须是数字`);
	}
	return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${label} 必须是正整数`);
	}
	return value;
}

function requireNonEmptyStrings(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是非空数组`);
	}
	return value.map((entry, index) =>
		requireString(entry, `${label}[${index}]`),
	);
}

function requireStructuredOutput(value: unknown): StructuredOutputMode {
	if (typeof value !== "string" || !isStructuredOutputMode(value)) {
		throw new Error(
			`structuredOutput 只接受 function-call 或 text-tags，收到 ${String(value)}`,
		);
	}
	return value;
}

function resolveRelative(value: string, baseDir: string): string {
	return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

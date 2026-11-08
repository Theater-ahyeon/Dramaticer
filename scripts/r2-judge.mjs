// R2-T03.b：用 judge 角色重新校准 F0 配对，并在自动试玩回复上与模拟用户模型对照判定尺度。
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	StoryStore,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "../packages/core/dist/index.js";
import { judgePlaytestTurn } from "../packages/st-compat/dist/evalset/turn-judge.js";
import { parsePlaytestJsonl } from "../packages/st-compat/dist/evalset/playtest.js";
import {
	JUDGE_ORDERS,
	buildChoiceMessages,
	countDuplicatePrompts,
	parseChoice,
	picksAccepted,
	summarizeJudge,
} from "./f0-judge-lib.mjs";
import { replaceMarkedSection, sampleStratified } from "./f0-pairs.mjs";
import {
	renderR2JudgeSection,
	summarizeTurnComparison,
} from "./r2-judge-lib.mjs";

const MARKER = "R2-T03.b";
const EVAL_DIR = path.resolve("eval-private", "f0");
const PAIRS_PATH = path.join(EVAL_DIR, "pairs.jsonl");
const ATTRIBUTION_PATH = path.join(EVAL_DIR, "attribution.jsonl");
const WORK_DIR = path.resolve("eval-private", "reports", "r2-judge");
const RESULTS_PATH = path.join(WORK_DIR, "calibration.jsonl");
const CACHE_DIR = path.join(WORK_DIR, "llm-cache");
const VERDICTS_PATH = path.join(WORK_DIR, "turn-verdicts.jsonl");
const PLAYTEST_PATH = path.join(WORK_DIR, "playtest.jsonl");
const PLAYTEST_DB_PATH = path.join(WORK_DIR, "playtest.db");
const REPORT_PATH = path.resolve("docs", "dev", "reports", "R2-judge.md");
const CHANNELS_PATH = path.resolve("data", "channels.yaml");

/** 与 F0-T03 相同的分层目标与种子，保证是同一批回复对。 */
const SAMPLE_TARGETS = Object.freeze({
	"1–10 楼": 70,
	"11–50 楼": 60,
	"51 楼以上": 70,
});
const SAMPLE_SEED = "f0-t03-v1";
const PLAYTEST_SAMPLES = 100;
const PLAYTEST_PROFILE = "naive";
const PLAYTEST_WRITER_MODEL = "rp";
const PLAYTEST_USER_MODEL = "background";

function readPositiveInt(name, fallback) {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} 必须是正整数，收到 ${raw}`);
	}
	return value;
}

async function readJsonl(file, onEntry) {
	let raw;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
	raw.split("\n").forEach((line, index) => {
		if (line.trim() === "") return;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch (cause) {
			throw new Error(`${path.basename(file)} 第 ${index + 1} 行不是合法 JSON`, {
				cause,
			});
		}
		onEntry(entry, index);
	});
	return true;
}

async function readPairs() {
	const pairs = [];
	await readJsonl(PAIRS_PATH, (entry, index) => {
		if (typeof entry?.id !== "string") {
			throw new Error(`pairs.jsonl 第 ${index + 1} 行缺少 id`);
		}
		pairs.push(entry);
	});
	return pairs;
}

async function readAttribution() {
	const byPair = new Map();
	await readJsonl(ATTRIBUTION_PATH, (entry, index) => {
		if (typeof entry?.pair !== "string") {
			throw new Error(`attribution.jsonl 第 ${index + 1} 行缺少 pair`);
		}
		if (entry.ok === true) byPair.set(entry.pair, entry);
	});
	return byPair;
}

async function readResults() {
	const byKey = new Map();
	await readJsonl(RESULTS_PATH, (entry, index) => {
		if (typeof entry?.key !== "string") {
			throw new Error(`calibration.jsonl 第 ${index + 1} 行缺少 key`);
		}
		byKey.set(entry.key, entry);
	});
	return byKey;
}

async function readVerdicts() {
	const byRound = new Map();
	await readJsonl(VERDICTS_PATH, (entry, index) => {
		if (!Number.isInteger(entry?.round)) {
			throw new Error(`turn-verdicts.jsonl 第 ${index + 1} 行缺少轮次`);
		}
		byRound.set(entry.round, entry);
	});
	return byRound;
}

async function runPool(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;
	async function lane() {
		while (true) {
			const index = next;
			next += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	}
	const lanes = Array.from({ length: Math.min(limit, items.length) }, () =>
		lane(),
	);
	await Promise.all(lanes);
	return results;
}

function addUsage(total, usage) {
	return {
		promptTokens:
			total.promptTokens +
			(typeof usage?.promptTokens === "number" ? usage.promptTokens : 0),
		completionTokens:
			total.completionTokens +
			(typeof usage?.completionTokens === "number"
				? usage.completionTokens
				: 0),
		reasoningTokens:
			total.reasoningTokens +
			(typeof usage?.reasoningTokens === "number"
				? usage.reasoningTokens
				: 0),
	};
}

function zeroUsage() {
	return { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
}

function createClients(config, alias, cacheDir) {
	return {
		client: createLlmClient(config, { defaultModel: alias, cacheDir }),
		retryClient: createLlmClient(config, { defaultModel: alias, cacheDir: null }),
	};
}

async function runCalibration(config, judgeAlias, attributionByPair) {
	const concurrency = readPositiveInt("DRAMATICER_R2_JUDGE_CONCURRENCY", 4);
	const maxTokens = readPositiveInt("DRAMATICER_R2_JUDGE_MAX_TOKENS", 2_048);
	const rerun = process.env.DRAMATICER_R2_JUDGE_RERUN === "1";
	const { client, retryClient } = createClients(
		config,
		judgeAlias,
		CACHE_DIR,
	);

	const pairs = await readPairs();
	const eligible = pairs.filter((pair) => attributionByPair.has(pair.id));
	const { picked, stats: sampleStats } = sampleStratified(
		eligible,
		SAMPLE_TARGETS,
		SAMPLE_SEED,
	);
	console.error(
		`配对抽样：从 ${eligible.length} 个已归因配对准取 ${picked.length} 对；按层 ${sampleStats
			.map((item) => `${item.label} ${item.picked}/${item.target}`)
			.join("、")}`,
	);

	const jobs = picked.flatMap((pair) =>
		JUDGE_ORDERS.map((order) => ({
			pair,
			order,
			key: `${pair.id}|${order}`,
		})),
	);
	const existing = await readResults();
	const pending = rerun
		? jobs
		: jobs.filter((job) => existing.get(job.key)?.ok !== true);
	console.error(
		`配对判断：共 ${jobs.length} 次，已有 ${jobs.length - pending.length} 次，本次 ${pending.length} 次`,
	);

	await mkdir(WORK_DIR, { recursive: true });
	let appendChain = Promise.resolve();
	function persist(entry) {
		appendChain = appendChain.then(() =>
			appendFile(RESULTS_PATH, `${JSON.stringify(entry)}\n`, "utf8"),
		);
		return appendChain;
	}

	const runStats = {
		calls: 0,
		cacheHits: 0,
		requests: 0,
		retries: 0,
		usage: zeroUsage(),
	};
	let completed = 0;
	await runPool(pending, concurrency, async (job) => {
		runStats.calls += 1;
		let entry;
		try {
			const { messages } = buildChoiceMessages(job.pair, job.order);
			const activeClient =
				existing.get(job.key)?.ok === false ? retryClient : client;
			const request = (tokens) =>
				activeClient.complete({
					messages,
					model: judgeAlias,
					temperature: 0,
					maxTokens: tokens,
					reasoning: "low",
				});
			let response = await request(maxTokens);
			if (response.cached) runStats.cacheHits += 1;
			else runStats.requests += response.attempts;
			let usage = addUsage(zeroUsage(), response.usage);
			let retried = false;
			if (response.stopReason === "length" || response.text.trim() === "") {
				retried = true;
				runStats.retries += 1;
				response = await request(Math.max(maxTokens, 4_096));
				if (response.cached) runStats.cacheHits += 1;
				else runStats.requests += response.attempts;
				usage = addUsage(usage, response.usage);
			}
			runStats.usage = addUsage(runStats.usage, usage);
			const { choice, confidence } = parseChoice(response.text);
			entry = {
				key: job.key,
				pair: job.pair.id,
				order: job.order,
				ok: true,
				choice,
				confidence,
				picksAccepted: picksAccepted(job.order, choice),
				retried,
				cached: response.cached,
				attempts: response.attempts,
				model: response.model,
				channel: response.channel,
				usage,
				at: new Date().toISOString(),
			};
		} catch (error) {
			entry = {
				key: job.key,
				pair: job.pair.id,
				order: job.order,
				ok: false,
				error: String(error?.message ?? error).slice(0, 500),
				at: new Date().toISOString(),
			};
		} finally {
			completed += 1;
			if (completed % 20 === 0 || completed === pending.length) {
				console.error(`配对判断进度 ${completed}/${pending.length}`);
			}
		}
		await persist(entry);
	});
	await appendChain;

	const merged = new Map(existing);
	await readJsonl(RESULTS_PATH, (entry) => merged.set(entry.key, entry));
	const selectedResults = jobs
		.map((job) => merged.get(job.key))
		.filter((entry) => entry !== undefined);
	const summary = summarizeJudge(picked, selectedResults, attributionByPair);
	const okEntries = selectedResults.filter((entry) => entry.ok === true);
	if (okEntries.length === 0) {
		throw new Error("没有任何成功的配对判断，不写报告");
	}
	const usage = okEntries.reduce(
		(total, entry) => addUsage(total, entry.usage),
		zeroUsage(),
	);
	const cost = {
		requests: okEntries.reduce(
			(total, entry) =>
				total + (entry.cached === true ? 0 : Number(entry.attempts) || 0),
			0,
		),
		cacheHits: okEntries.filter((entry) => entry.cached === true).length,
		retries: okEntries.filter((entry) => entry.retried === true).length,
		usage,
	};
	return {
		summary,
		meta: {
			availablePairs: eligible.length,
			sampleStats,
			cost,
			failedJudgements: selectedResults.length - okEntries.length,
			duplicatePrompts: countDuplicatePrompts(picked),
		},
	};
}

async function runPlaytestComparison(config, judgeAlias, store) {
	const rerun = process.env.DRAMATICER_R2_JUDGE_RERUN === "1";
	const concurrency = readPositiveInt("DRAMATICER_R2_JUDGE_CONCURRENCY", 4);
	if (!config.models.has(PLAYTEST_USER_MODEL)) {
		throw new Error(`没有模拟用户模型 ${PLAYTEST_USER_MODEL}`);
	}
	const judge = createClients(config, judgeAlias, CACHE_DIR);
	const reference = createClients(config, PLAYTEST_USER_MODEL, CACHE_DIR);
	const raw = await readFile(PLAYTEST_PATH, "utf8");
	const records = parsePlaytestJsonl(raw)
		.filter((record) => record.status === "done")
		.slice(0, PLAYTEST_SAMPLES);
	if (records.length === 0) {
		throw new Error(`试玩记录里没有成功轮次：${PLAYTEST_PATH}`);
	}
	console.error(`试玩对照：${records.length} 条助手回复`);

	const existing = rerun ? new Map() : await readVerdicts();
	const pending = records.filter((record) => {
		const entry = existing.get(record.round);
		return (
			entry?.judge?.status !== "done" || entry?.reference?.status !== "done"
		);
	});
	console.error(
		`试玩判定：共 ${records.length} 条，已有 ${records.length - pending.length} 条，本次 ${pending.length} 条`,
	);

	await mkdir(WORK_DIR, { recursive: true });
	let appendChain = Promise.resolve();
	function persist(entry) {
		appendChain = appendChain.then(() =>
			appendFile(VERDICTS_PATH, `${JSON.stringify(entry)}\n`, "utf8"),
		);
		return appendChain;
	}

	let completed = 0;
	await runPool(pending, concurrency, async (record) => {
		const input = {
			store,
			storyId: record.storyId,
			round: record.round,
			userText: record.user,
			assistantText: record.assistant,
			assistantNodeId: record.nodeId,
		};
		const judgeVerdict = await judgePlaytestTurn({
			...input,
			judge: { client: judge.client, model: judgeAlias },
		});
		const referenceVerdict = await judgePlaytestTurn({
			...input,
			judge: { client: reference.client, model: PLAYTEST_USER_MODEL },
		});
		completed += 1;
		if (completed % 10 === 0 || completed === pending.length) {
			console.error(`试玩判定进度 ${completed}/${pending.length}`);
		}
		await persist({
			round: record.round,
			judge: judgeVerdict,
			reference: referenceVerdict,
			at: new Date().toISOString(),
		});
	});
	await appendChain;

	const merged = new Map(existing);
	await readJsonl(VERDICTS_PATH, (entry) => merged.set(entry.round, entry));
	const judged = records.map((record) => merged.get(record.round));
	const judgeRecords = judged.map((entry) => entry.judge);
	const referenceRecords = judged.map((entry) => entry.reference);
	return summarizeTurnComparison(judgeRecords, referenceRecords);
}

async function main() {
	loadDotEnv(path.resolve(".env"));
	const config = await loadChannelsConfig(CHANNELS_PATH);
	const judgeAlias = resolveModelForRole(config, "judge");
	const attributionByPair = await readAttribution();

	const calibration = await runCalibration(
		config,
		judgeAlias,
		attributionByPair,
	);

	const embeddingConfig = config.embeddings.get("default");
	const store = StoryStore.open(
		PLAYTEST_DB_PATH,
		embeddingConfig === undefined
			? {}
			: { embeddingDimensions: embeddingConfig.dimensions },
	);
	let playtest;
	try {
		playtest = await runPlaytestComparison(config, judgeAlias, store);
	} finally {
		store.close();
	}

	const generatedAt = new Date().toISOString();
	const meta = {
		generatedAt,
		judgeModel: config.models.get(judgeAlias)?.id ?? judgeAlias,
		playtestProfile: PLAYTEST_PROFILE,
		playtestWriterModel: PLAYTEST_WRITER_MODEL,
		playtestUserModel: PLAYTEST_USER_MODEL,
		...calibration.meta,
	};
	const section = renderR2JudgeSection({
		calibration: calibration.summary,
		playtest,
		meta,
	});
	let report;
	try {
		report = await readFile(REPORT_PATH, "utf8");
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		throw new Error("docs/dev/reports/R2-judge.md 不存在，门槛必须先写入报告");
	}
	await writeFile(REPORT_PATH, replaceMarkedSection(report, section, MARKER), "utf8");

	console.log(
		JSON.stringify({
			calibration: {
				pairs: calibration.summary.pairs,
				judgements: calibration.summary.judgements.judgements,
				agreement: calibration.summary.judgements.agreement,
				positionDeviation:
					calibration.summary.judgements.positionDeviation,
				passed: calibration.summary.thresholds.passed,
			},
			playtest: {
				pairs: playtest.pairs,
				judgeRerollRate: playtest.judgeReroll.rate,
				referenceRerollRate: playtest.referenceReroll.rate,
				rerollAgreement: playtest.rerollAgreement.rate,
				lenient: playtest.lenient,
			},
		}),
	);
}

await main();

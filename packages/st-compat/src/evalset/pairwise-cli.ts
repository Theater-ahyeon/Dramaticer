import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type LlmChannelsConfig,
	type LlmClient,
	StoryStore,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "@dramaticer/core";
import {
	DEFAULT_PAIRWISE_MAX_TOKENS,
	PAIRWISE_ORDERS,
	type PairwiseJudge,
	type PreferenceComparisonRecord,
	type PreferenceSample,
	buildPreferenceSample,
	parseComparisonRecordsJsonl,
	parsePreferencePairsJsonl,
	renderPairwiseReport,
	runPreferenceSample,
	summarizePreferenceComparisons,
} from "./pairwise.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat pairwise --db <path> [选项]",
	"",
	"把偏好导出里的接受/放弃回复对按两种顺序交给裁判，统计偏好一致率与位置偏差。",
	"",
	"选项：",
	"  --db <path>            必填，回复对所在故事的数据库",
	"  --pairs <path>         导出目录或单个 .pairs.jsonl，默认 eval-private/preferences",
	"  --story <id>           只评判这个故事的回复对",
	"  --out <path>           逐条判定的 JSONL，默认 eval-private/reports/R2-pairwise/records.jsonl",
	"  --private-report <p>   私有版报告，默认 eval-private/reports/R2-pairwise.md",
	"  --public-report <p>    统计版报告，默认 docs/dev/reports/R2-pairwise.md",
	"  --judge-model <m>      裁判模型别名，默认按 roles.judge 解析",
	`  --max-tokens <n>       裁判输出上限，默认 ${DEFAULT_PAIRWISE_MAX_TOKENS}`,
	"  --limit <n>            只评判前 n 个样本",
	"  --resume               复用 JSONL 里已有的样本与顺序，不重新判定",
	"  --report-only          不调用模型，只从已有 JSONL 重新生成报告",
	"  --channels <path>      渠道配置，默认 data/channels.yaml",
	"  --help                 显示本说明",
].join("\n");

export interface PairwiseCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (
		config: LlmChannelsConfig,
		alias: string,
	) => LlmClient;
	readonly now?: () => Date;
	readonly log?: (message: string) => void;
}

export interface PairwiseCliResult {
	readonly sampleCount: number;
	readonly judgedOrders: number;
	readonly failures: number;
	readonly recordsPath: string;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
}

interface ParsedArgs {
	readonly dbPath: string | null;
	readonly pairsPath: string;
	readonly story: string | null;
	readonly outPath: string;
	readonly privateReportPath: string;
	readonly publicReportPath: string;
	readonly judgeModel: string | null;
	readonly maxTokens: number;
	readonly limit: number | null;
	readonly resume: boolean;
	readonly reportOnly: boolean;
	readonly channelsPath: string | null;
}

/** 逐样本让裁判按两种顺序各判一次，统计偏好一致率与位置偏差。 */
export async function runPairwiseCli(
	args: readonly string[],
	dependencies: PairwiseCliDependencies = {},
): Promise<PairwiseCliResult> {
	const log = dependencies.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return {
			sampleCount: 0,
			judgedOrders: 0,
			failures: 0,
			recordsPath: "",
			privateReportPath: "",
			publicReportPath: "",
		};
	}
	const parsed = parseArgs(args);
	const now = dependencies.now ?? (() => new Date());
	const generatedAt = now().toISOString();
	const existing =
		parsed.resume || parsed.reportOnly
			? await readExistingRecords(parsed.outPath)
			: [];
	let sampleCount = 0;
	let judgedOrders = 0;
	let sampleSources: string[] = [];
	const newRecords: PreferenceComparisonRecord[] = [];
	if (!parsed.reportOnly) {
		if (parsed.dbPath === null) {
			throw new Error(`--db 必填；${USAGE}`);
		}
		if (!existsSync(parsed.dbPath)) {
			throw new Error(`数据库不存在：${parsed.dbPath}`);
		}
		const files = collectPairFiles(parsed.pairsPath);
		sampleSources = files;
		const store = StoryStore.open(parsed.dbPath);
		try {
			const pairs = files.flatMap((file) => {
				const parsedPairs = parsePreferencePairsJsonl(
					readFileSync(file, "utf8"),
					file,
				);
				return parsed.story === null
					? parsedPairs
					: parsedPairs.filter((pair) => pair.storyId === parsed.story);
			});
			let samples = pairs.map((pair) => buildPreferenceSample(store, pair));
			if (parsed.limit !== null) samples = samples.slice(0, parsed.limit);
			sampleCount = samples.length;
			if (samples.length === 0) {
				throw new Error(
					parsed.story === null
						? "没有可用的回复对"
						: `没有故事 ${parsed.story} 的回复对`,
				);
			}
			const recorded = new Set(
				existing.map((record) => `${record.sampleId}\u0000${record.order}`),
			);
			const pending = samples.filter((sample) =>
				PAIRWISE_ORDERS.some(
					(order) => !recorded.has(`${sample.sampleId}\u0000${order}`),
				),
			);
			if (pending.length > 0) {
				const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
				const channelsPath =
					parsed.channelsPath ??
					dependencies.channelsPath ??
					path.join(repoRoot, "data", "channels.yaml");
				(dependencies.loadEnv ?? loadDotEnv)(envPath);
				const config = await (dependencies.loadConfig ?? loadChannelsConfig)(
					channelsPath,
				);
				const judgeModel =
					parsed.judgeModel ?? resolveModelForRole(config, "judge");
				if (!config.models.has(judgeModel)) {
					throw new Error(
						`没有裁判模型 ${judgeModel}；可用模型：${[...config.models.keys()].join("、")}`,
					);
				}
				const createClient =
					dependencies.createClient ??
					((channels: LlmChannelsConfig, alias: string) =>
						createLlmClient(channels, {
							defaultModel: alias,
							cacheDir: null,
						}));
				const judge: PairwiseJudge = {
					client: createClient(config, judgeModel),
					model: judgeModel,
					maxTokens: parsed.maxTokens,
				};
				for (const sample of pending) {
					const records = await runPreferenceSample(sample, judge, {
						now: () => now().toISOString(),
					});
					newRecords.push(...records);
					judgedOrders += records.length;
					log(
						`样本 ${sample.sampleId}：${records
							.map((record) =>
								record.status === "done"
									? `${record.order} ${record.winner}`
									: `${record.order} 失败`,
							)
							.join("，")}`,
					);
				}
			}
		} finally {
			store.close();
		}
	}
	const merged = mergeRecords(existing, newRecords);
	if (parsed.reportOnly && merged.length === 0) {
		throw new Error(`没有可读的判定记录：${parsed.outPath}`);
	}
	await mkdir(path.dirname(parsed.outPath), { recursive: true });
	await writeFile(
		parsed.outPath,
		merged.map((record) => `${JSON.stringify(record)}\n`).join(""),
		"utf8",
	);
	const summary = summarizePreferenceComparisons(merged);
	if (parsed.reportOnly) sampleCount = summary.groups[0]?.samples ?? 0;
	const model =
		parsed.judgeModel ??
		([...new Set(merged.map((record) => record.model))].sort().join("、") ||
			"未记录");
	const privateText = renderPairwiseReport(summary, {
		privateDetails: true,
		model,
		generatedAt,
		sampleSources,
	});
	const publicText = renderPairwiseReport(summary, {
		privateDetails: false,
		model,
		generatedAt,
	});
	await mkdir(path.dirname(parsed.privateReportPath), { recursive: true });
	await mkdir(path.dirname(parsed.publicReportPath), { recursive: true });
	await writeFile(parsed.privateReportPath, privateText, "utf8");
	await writeFile(parsed.publicReportPath, publicText, "utf8");
	log(
		parsed.reportOnly
			? `盲测报告：${sampleCount} 个样本，${merged.length} 条已有判定；报告 ${parsed.publicReportPath}`
			: `盲测：${sampleCount} 个样本，${judgedOrders} 次判定，失败 ${summary.failures.length}；记录 ${parsed.outPath}`,
	);
	return {
		sampleCount,
		judgedOrders,
		failures: summary.failures.length,
		recordsPath: parsed.outPath,
		privateReportPath: parsed.privateReportPath,
		publicReportPath: parsed.publicReportPath,
	};
}

function collectPairFiles(pairsPath: string): string[] {
	if (!existsSync(pairsPath)) {
		throw new Error(`回复对路径不存在：${pairsPath}`);
	}
	const stats = statSync(pairsPath);
	if (stats.isFile()) return [pairsPath];
	if (!stats.isDirectory()) {
		throw new Error(`回复对路径既不是文件也不是目录：${pairsPath}`);
	}
	const files = readdirSync(pairsPath)
		.filter((name) => name.endsWith(".pairs.jsonl"))
		.sort()
		.map((name) => path.join(pairsPath, name));
	if (files.length === 0) {
		throw new Error(`目录里没有 .pairs.jsonl：${pairsPath}`);
	}
	return files;
}

async function readExistingRecords(
	outPath: string,
): Promise<PreferenceComparisonRecord[]> {
	if (!existsSync(outPath)) return [];
	return parseComparisonRecordsJsonl(await readFile(outPath, "utf8"), outPath);
}

function mergeRecords(
	existing: readonly PreferenceComparisonRecord[],
	fresh: readonly PreferenceComparisonRecord[],
): PreferenceComparisonRecord[] {
	const merged = new Map<string, PreferenceComparisonRecord>();
	for (const record of [...existing, ...fresh]) {
		merged.set(`${record.sampleId}\u0000${record.order}`, record);
	}
	return [...merged.values()].sort((left, right) => {
		const bySample =
			left.sampleId < right.sampleId
				? -1
				: left.sampleId > right.sampleId
					? 1
					: 0;
		if (bySample !== 0) return bySample;
		return (
			PAIRWISE_ORDERS.indexOf(left.order) - PAIRWISE_ORDERS.indexOf(right.order)
		);
	});
}

function parseArgs(args: readonly string[]): ParsedArgs {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (key === "resume" || key === "report-only") {
			if (equals !== -1) {
				throw new Error(`--${key} 不接受值；${USAGE}`);
			}
			if (flags.has(key)) {
				throw new Error(`参数 --${key} 重复；${USAGE}`);
			}
			flags.add(key);
			continue;
		}
		if (
			key !== "db" &&
			key !== "pairs" &&
			key !== "story" &&
			key !== "out" &&
			key !== "private-report" &&
			key !== "public-report" &&
			key !== "judge-model" &&
			key !== "max-tokens" &&
			key !== "limit" &&
			key !== "channels"
		) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
		if (equals === -1) index += 1;
		if (value === undefined || value.trim().length === 0) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		values.set(key, value);
	}
	const maxTokens =
		values.get("max-tokens") === undefined
			? DEFAULT_PAIRWISE_MAX_TOKENS
			: parsePositiveInt(values.get("max-tokens") as string, "--max-tokens");
	const limit =
		values.get("limit") === undefined
			? null
			: parsePositiveInt(values.get("limit") as string, "--limit");
	return {
		dbPath: values.get("db") ?? null,
		pairsPath:
			values.get("pairs") ?? path.join(repoRoot, "eval-private", "preferences"),
		story: values.get("story") ?? null,
		outPath:
			values.get("out") ??
			path.join(
				repoRoot,
				"eval-private",
				"reports",
				"R2-pairwise",
				"records.jsonl",
			),
		privateReportPath:
			values.get("private-report") ??
			path.join(repoRoot, "eval-private", "reports", "R2-pairwise.md"),
		publicReportPath:
			values.get("public-report") ??
			path.join(repoRoot, "docs", "dev", "reports", "R2-pairwise.md"),
		judgeModel: values.get("judge-model") ?? null,
		maxTokens,
		limit,
		resume: flags.has("resume"),
		reportOnly: flags.has("report-only"),
		channelsPath: values.get("channels") ?? null,
	};
}

function parsePositiveInt(value: string, name: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} 必须是正整数：${value}`);
	}
	return parsed;
}

async function main(): Promise<void> {
	await runPairwiseCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}

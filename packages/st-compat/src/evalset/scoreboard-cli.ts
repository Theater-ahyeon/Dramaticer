import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ForgettingRunResult, parseForgettingRun } from "./forgetting.js";
import {
	type HistoricalReplayRecord,
	type HistoricalReplaySample,
	parseHistoricalReplayRecordsJsonl,
	parseHistoricalReplaySamplesJsonl,
} from "./historical-replay.js";
import {
	type PreferenceComparisonRecord,
	parseComparisonRecordsJsonl,
} from "./pairwise.js";
import { type PlaytestRecord, parsePlaytestJsonl } from "./playtest.js";
import { type QualityRecord, parseQualityRecordsJsonl } from "./quality.js";
import { buildScoreboard, renderScoreboard } from "./scoreboard.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat scoreboard [选项]",
	"",
	"从私有 JSONL 汇总生成 docs/dev/SCOREBOARD.md 记分牌。",
	"",
	"选项：",
	"  --playtest <path>          试玩 JSONL 或其所在目录，可重复",
	"  --pairwise-records <path>  偏好盲测判定 JSONL，可重复",
	"  --pairwise-quality <path>  偏好盲测评分 JSONL，可重复",
	"  --forgetting <path>        遗忘运行 JSON 或目录，可重复",
	"  --b1-samples <path>        B1 样本 JSONL，可重复",
	"  --b1-records <path>        B1 判定 JSONL，可重复",
	"  --b1-quality <path>        B1 评分 JSONL，可重复",
	"  --phase <label>            阶段，默认 R2",
	"  --date <YYYY-MM-DD>        覆盖数据截止日期",
	"  --conclusion <text>        当前结论",
	"  --next <text>              下一步",
	"  --out <path>               输出，默认 docs/dev/SCOREBOARD.md",
	"  --help                     显示本说明",
].join("\n");

const REPEATABLE_KEYS = [
	"playtest",
	"pairwise-records",
	"pairwise-quality",
	"forgetting",
	"b1-samples",
	"b1-records",
	"b1-quality",
] as const;

const SINGLE_KEYS = ["phase", "date", "conclusion", "next", "out"] as const;

export interface ScoreboardCliOptions {
	readonly log?: (message: string) => void;
}

export interface ScoreboardCliResult {
	readonly outPath: string;
	readonly playtestRounds: number;
	readonly forgettingRuns: number;
	readonly b1Samples: number;
}

export async function runScoreboardCli(
	args: readonly string[],
	options: ScoreboardCliOptions = {},
): Promise<ScoreboardCliResult> {
	const log = options.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return {
			outPath: "",
			playtestRounds: 0,
			forgettingRuns: 0,
			b1Samples: 0,
		};
	}
	const parsed = parseArgs(args);
	const playtests: PlaytestRecord[] = [];
	for (const input of parsed.inputs.get("playtest") ?? []) {
		for (const file of await expandInput(input, ".jsonl")) {
			playtests.push(...parsePlaytestJsonl(await readText(file)));
		}
	}
	const pairwiseRecords: PreferenceComparisonRecord[] = [];
	for (const input of parsed.inputs.get("pairwise-records") ?? []) {
		pairwiseRecords.push(
			...parseComparisonRecordsJsonl(await readText(input), input),
		);
	}
	const pairwiseQuality: QualityRecord[] = [];
	for (const input of parsed.inputs.get("pairwise-quality") ?? []) {
		pairwiseQuality.push(
			...parseQualityRecordsJsonl(await readText(input), input),
		);
	}
	const forgettingRuns: ForgettingRunResult[] = [];
	for (const input of parsed.inputs.get("forgetting") ?? []) {
		for (const file of await expandInput(input, ".json")) {
			let value: unknown;
			try {
				value = JSON.parse(await readText(file));
			} catch (error) {
				throw new Error(
					`${file} 不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`,
				);
			}
			try {
				forgettingRuns.push(parseForgettingRun(value));
			} catch (error) {
				throw new Error(
					`${file} 不是合法的遗忘评测结果：${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	const b1Samples: HistoricalReplaySample[] = [];
	for (const input of parsed.inputs.get("b1-samples") ?? []) {
		b1Samples.push(
			...parseHistoricalReplaySamplesJsonl(await readText(input), input),
		);
	}
	const b1Records: HistoricalReplayRecord[] = [];
	for (const input of parsed.inputs.get("b1-records") ?? []) {
		b1Records.push(
			...parseHistoricalReplayRecordsJsonl(await readText(input), input),
		);
	}
	const b1Quality: QualityRecord[] = [];
	for (const input of parsed.inputs.get("b1-quality") ?? []) {
		b1Quality.push(...parseQualityRecordsJsonl(await readText(input), input));
	}
	const scoreboard = buildScoreboard({
		phase: parsed.phase,
		date: parsed.date,
		conclusion: parsed.conclusion,
		next: parsed.next,
		playtests,
		pairwiseRecords,
		pairwiseQuality,
		forgettingRuns,
		b1Samples,
		b1Records,
		b1Quality,
	});
	await mkdir(path.dirname(parsed.outPath), { recursive: true });
	await writeFile(parsed.outPath, renderScoreboard(scoreboard), "utf8");
	log(
		`记分牌：试玩 ${scoreboard.counts.playtestRounds} 轮（失败 ${scoreboard.counts.playtestFailures}）、遗忘运行 ${scoreboard.counts.forgettingRuns} 次、B1 样本 ${scoreboard.counts.b1Samples} 个；写入 ${parsed.outPath}`,
	);
	return {
		outPath: parsed.outPath,
		playtestRounds: scoreboard.counts.playtestRounds,
		forgettingRuns: scoreboard.counts.forgettingRuns,
		b1Samples: scoreboard.counts.b1Samples,
	};
}

async function readText(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		throw new Error(
			`读不了 ${filePath}：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** 输入既可以是单个文件，也可以是指定扩展名的目录。 */
async function expandInput(
	input: string,
	extension: string,
): Promise<string[]> {
	if (!existsSync(input)) {
		throw new Error(`输入路径不存在：${input}`);
	}
	const stats = statSync(input);
	if (stats.isFile()) return [input];
	if (!stats.isDirectory()) {
		throw new Error(`输入路径既不是文件也不是目录：${input}`);
	}
	const entries = await readdir(input, { withFileTypes: true });
	const files = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(extension))
		.map((entry) => path.join(input, entry.name))
		.sort();
	if (files.length === 0) {
		throw new Error(`目录里没有 ${extension} 文件：${input}`);
	}
	return files;
}

interface ParsedArgs {
	readonly inputs: ReadonlyMap<string, readonly string[]>;
	readonly phase: string;
	readonly date: string | null;
	readonly conclusion: string | null;
	readonly next: string | null;
	readonly outPath: string;
}

function parseArgs(args: readonly string[]): ParsedArgs {
	const inputs = new Map<string, string[]>();
	const singles = new Map<string, string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		const repeatable = (REPEATABLE_KEYS as readonly string[]).includes(key);
		const single = (SINGLE_KEYS as readonly string[]).includes(key);
		if (!repeatable && !single) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		let value: string | undefined;
		if (equals !== -1) {
			value = arg.slice(equals + 1);
		} else {
			value = args[index + 1];
			index += 1;
		}
		if (value === undefined || value.trim().length === 0) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		if (repeatable) {
			const list = inputs.get(key);
			if (list === undefined) inputs.set(key, [value]);
			else list.push(value);
		} else {
			if (singles.has(key)) {
				throw new Error(`参数 --${key} 重复；${USAGE}`);
			}
			singles.set(key, value);
		}
	}
	const date = singles.get("date") ?? null;
	if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new Error(`--date 必须是 YYYY-MM-DD，收到 ${date}`);
	}
	return {
		inputs,
		phase: singles.get("phase") ?? "R2",
		date,
		conclusion: singles.get("conclusion") ?? null,
		next: singles.get("next") ?? null,
		outPath:
			singles.get("out") ?? path.join(repoRoot, "docs", "dev", "SCOREBOARD.md"),
	};
}

async function main(): Promise<void> {
	await runScoreboardCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}

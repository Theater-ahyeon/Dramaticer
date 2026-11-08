import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parsePlaytestJsonl } from "./playtest.js";
import {
	type ProbeStorySummary,
	renderProbeReport,
	summarizePlaytestProbes,
} from "./probe.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat probe-report --input <playtest.jsonl> [选项]",
	"",
	"按故事聚合试玩记录里的一致性探针结果，写出私有版与统计版报告。",
	"",
	"选项：",
	"  --input <path>       必填，playtest 写出的 JSONL",
	"  --private-out <path> 私有报告路径，默认 eval-private/reports/playtest-probe.md",
	"  --public-out <path>  统计版报告路径，默认 docs/dev/reports/R2-probe.md",
	"  --help               显示本说明",
].join("\n");

export interface ProbeReportCliDependencies {
	readonly log?: (message: string) => void;
	readonly readText?: (filePath: string) => Promise<string>;
	readonly writeText?: (filePath: string, text: string) => Promise<void>;
}

export interface ProbeReportCliResult {
	readonly summaries: readonly ProbeStorySummary[];
	readonly privatePath: string;
	readonly publicPath: string;
}

export async function runProbeReportCli(
	args: readonly string[],
	dependencies: ProbeReportCliDependencies = {},
): Promise<ProbeReportCliResult> {
	const log = dependencies.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return { summaries: [], privatePath: "", publicPath: "" };
	}
	const values = parseArgs(args);
	const inputPath = values.get("input");
	if (inputPath === undefined || inputPath.trim().length === 0) {
		throw new Error(`--input 必须是非空字符串；${USAGE}`);
	}
	const privatePath =
		values.get("private-out") ??
		path.join(repoRoot, "eval-private", "reports", "playtest-probe.md");
	const publicPath =
		values.get("public-out") ??
		path.join(repoRoot, "docs", "dev", "reports", "R2-probe.md");
	const readText =
		dependencies.readText ?? ((filePath: string) => readFile(filePath, "utf8"));
	const writeText =
		dependencies.writeText ??
		(async (filePath: string, text: string) => {
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, text, "utf8");
		});
	const records = parsePlaytestJsonl(await readText(inputPath));
	const summaries = summarizePlaytestProbes(records);
	if (summaries.length === 0) {
		throw new Error(`输入里没有探针记录：${inputPath}`);
	}
	await writeText(
		privatePath,
		renderProbeReport(summaries, { privateDetails: true }),
	);
	await writeText(
		publicPath,
		renderProbeReport(summaries, { privateDetails: false }),
	);
	const attempted = summaries.reduce(
		(total, summary) => total + summary.attempted,
		0,
	);
	const contradicted = summaries.reduce(
		(total, summary) => total + summary.contradicted,
		0,
	);
	log(
		`探针报告：${summaries.length} 个故事，${attempted} 个探针，矛盾 ${contradicted} 个；私有版 ${privatePath}，统计版 ${publicPath}`,
	);
	return { summaries, privatePath, publicPath };
}

function parseArgs(args: readonly string[]): ReadonlyMap<string, string> {
	const allowed: Readonly<Record<string, true>> = {
		input: true,
		"private-out": true,
		"public-out": true,
	};
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (allowed[key] !== true) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		let value: string | undefined;
		if (equals !== -1) {
			value = arg.slice(equals + 1);
		} else {
			value = args[index + 1];
			index += 1;
		}
		if (value === undefined) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		values.set(key, value);
	}
	return values;
}

async function main(): Promise<void> {
	await runProbeReportCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}

import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type R6GateRunReport,
	formatR6GateReport,
	listB1Results,
	listCompareResults,
	runR6Gate,
} from "./r6-gate.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat r6-gate --dir <运行目录> [选项]",
	"",
	"读齐 G0–G6 的结果文件，交给 evaluateR6Gates 判定，写出门槛表、B1 参考数字与遗忘漏斗表。只读结果 JSON，不调用任何模型。",
	"",
	"选项：",
	"  --dir <path>         必填，r6 的私有运行目录；相对路径按仓库根目录解析",
	"  --instrument <path>  G0 的 r6-instrument 结果，默认 <dir>/instrument.json",
	"  --replay <path>      G1 的 r6-replay 结果，默认 <dir>/replay-<故事>.json（只接受一份）",
	"  --compare <path>     C1 的 r6-compare 结果，可重复；缺省时取 <dir>/compare-*.json",
	"  --deep <path>        G5 的 r6-deep 结果，默认 <dir>/deep.json",
	"  --preference <path>  G6 的 r6-preference 结果，默认 <dir>/preference.json",
	"  --funnel <path>      遗忘漏斗结果，默认 <dir>/funnel.json",
	"  --b1 <path>          B1 参考结果，可重复；缺省时取 <dir>/b1-*.json",
	"  --json <path>        结果 JSON，默认 <dir>/gate.json",
	"  --report <path>      报告，默认 <dir>/gate.md",
	"  --help               显示本说明",
].join("\n");

export interface R6GateCliOptions {
	readonly dir: string;
	readonly instrumentPath: string | null;
	readonly replayPath: string | null;
	readonly comparePaths: readonly string[];
	readonly deepPath: string | null;
	readonly preferencePath: string | null;
	readonly funnelPath: string | null;
	readonly b1Paths: readonly string[];
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly log?: (message: string) => void;
	readonly now?: () => number;
}

/** 只接受一份重 roll 回放结果：多个故事分开跑时先合并，避免悄悄丢掉一部分配对。 */
async function resolveReplayPath(dir: string): Promise<string> {
	const entries = await readdir(dir, { withFileTypes: true });
	const candidates = entries
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.startsWith("replay-") &&
				entry.name.endsWith(".json"),
		)
		.map((entry) => path.join(dir, entry.name))
		.sort();
	if (candidates.length === 1) return candidates[0] as string;
	if (candidates.length === 0) {
		throw new Error(
			`缺少 G1 结果（r6-replay）：请用 --replay 指定，或把 replay-<故事>.json 放到 ${dir} 下`,
		);
	}
	throw new Error(
		`${dir} 下有 ${candidates.length} 份 r6-replay 结果，G1 需要合并后的一份：请用 --replay 指定`,
	);
}

export async function runR6GateCli(
	options: R6GateCliOptions,
): Promise<R6GateRunReport> {
	const log = options.log ?? ((message: string) => console.log(message));
	const dir = path.resolve(repoRoot, options.dir);
	if (!existsSync(dir)) {
		throw new Error(`运行目录不存在：${dir}`);
	}
	const comparePaths =
		options.comparePaths.length > 0
			? [...options.comparePaths]
			: await listCompareResults(dir);
	const b1Paths =
		options.b1Paths.length > 0
			? [...options.b1Paths]
			: await listB1Results(dir);
	const instrumentPath =
		options.instrumentPath ?? path.join(dir, "instrument.json");
	const replayPath = options.replayPath ?? (await resolveReplayPath(dir));
	const deepPath = options.deepPath ?? path.join(dir, "deep.json");
	const preferencePath =
		options.preferencePath ?? path.join(dir, "preference.json");
	const funnelPath = options.funnelPath ?? path.join(dir, "funnel.json");
	const report = await runR6Gate({
		instrumentPath,
		replayPath,
		comparePaths,
		deepPath,
		preferencePath,
		funnelPath,
		b1Paths,
		...(options.now === undefined ? {} : { now: options.now }),
	});
	const jsonPath =
		options.jsonPath === null
			? path.join(dir, "gate.json")
			: path.resolve(repoRoot, options.jsonPath);
	const reportPath =
		options.reportPath === null
			? path.join(dir, "gate.md")
			: path.resolve(repoRoot, options.reportPath);
	await mkdir(path.dirname(jsonPath), { recursive: true });
	await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await mkdir(path.dirname(reportPath), { recursive: true });
	await writeFile(reportPath, `${formatR6GateReport(report)}\n`, "utf8");
	const gates = report.gates;
	log(
		`R6 门槛：${gates.passed ? "通过" : "未通过"}${gates.failed.length > 0 ? `；未通过 ${gates.failed.join("、")}` : ""}${gates.insufficient.length > 0 ? `；样本不足 ${gates.insufficient.join("、")}` : ""}${gates.invalid.length > 0 ? `；仪器无效 ${gates.invalid.join("、")}` : ""}`,
	);
	log(`结果：${jsonPath}`);
	log(`报告：${reportPath}`);
	return report;
}

interface CliArgs {
	readonly dir: string | null;
	readonly instrumentPath: string | null;
	readonly replayPath: string | null;
	readonly comparePaths: readonly string[];
	readonly deepPath: string | null;
	readonly preferencePath: string | null;
	readonly funnelPath: string | null;
	readonly b1Paths: readonly string[];
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly help: boolean;
}

const VALUE_ARGS: Readonly<Record<string, true>> = {
	"--dir": true,
	"--instrument": true,
	"--replay": true,
	"--compare": true,
	"--deep": true,
	"--preference": true,
	"--funnel": true,
	"--b1": true,
	"--json": true,
	"--report": true,
};

function parseArgs(args: readonly string[]): CliArgs {
	const comparePaths: string[] = [];
	const b1Paths: string[] = [];
	let dir: string | null = null;
	let instrumentPath: string | null = null;
	let replayPath: string | null = null;
	let deepPath: string | null = null;
	let preferencePath: string | null = null;
	let funnelPath: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let help = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (VALUE_ARGS[arg] !== true) {
			throw new Error(`未知参数：${arg}`);
		}
		const value = args[index + 1];
		if (value === undefined) throw new Error(`${arg} 需要一个值`);
		index += 1;
		switch (arg) {
			case "--dir":
				dir = value;
				break;
			case "--instrument":
				instrumentPath = value;
				break;
			case "--replay":
				replayPath = value;
				break;
			case "--compare":
				comparePaths.push(value);
				break;
			case "--deep":
				deepPath = value;
				break;
			case "--preference":
				preferencePath = value;
				break;
			case "--funnel":
				funnelPath = value;
				break;
			case "--b1":
				b1Paths.push(value);
				break;
			case "--json":
				jsonPath = value;
				break;
			default:
				reportPath = value;
				break;
		}
	}
	return {
		dir,
		instrumentPath,
		replayPath,
		comparePaths,
		deepPath,
		preferencePath,
		funnelPath,
		b1Paths,
		jsonPath,
		reportPath,
		help,
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(USAGE);
		return;
	}
	if (args.dir === null) throw new Error(`缺少 --dir；${USAGE}`);
	await runR6GateCli({
		dir: args.dir,
		instrumentPath: args.instrumentPath,
		replayPath: args.replayPath,
		comparePaths: args.comparePaths,
		deepPath: args.deepPath,
		preferencePath: args.preferencePath,
		funnelPath: args.funnelPath,
		b1Paths: args.b1Paths,
		jsonPath: args.jsonPath,
		reportPath: args.reportPath,
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type LlmClient,
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "@dramaticer/core";
import {
	type SceneLogCompareBatchResult,
	formatSceneLogCompareBatchReport,
	readSceneLogSamples,
	runSceneLogCompareBatch,
} from "./scene-log-compare-batch.js";
import { SCENE_LOG_COMPARE_SETTLE_WINDOW } from "./scene-log-compare.js";

export interface SceneLogCompareCliOptions {
	readonly samplesPath: string;
	readonly dir: string;
	readonly jsonPath: string;
	readonly reportPath: string;
	readonly cacheDir: string;
	/** 不提供 createClient 时必填。 */
	readonly channelsPath?: string;
	readonly envPath?: string;
	/** 覆盖 settler 角色的模型；两边使用同一个模型。 */
	readonly model?: string | null;
	readonly settleWindowFloors?: number | null;
	/** 覆盖样本文件里的最低楼层数。 */
	readonly minimumFloors?: number | null;
	readonly log?: (message: string) => void;
	/** 测试注入；按档位各要一个客户端，缓存目录也按档位分开。 */
	readonly createClient?: (
		side: "independent" | "merged",
		cacheDir: string,
	) => LlmClient;
}

export async function runSceneLogCompareCli(
	options: SceneLogCompareCliOptions,
): Promise<SceneLogCompareBatchResult> {
	const log = options.log ?? ((message: string) => console.log(message));
	const samples = await readSceneLogSamples(options.samplesPath);
	await mkdir(options.cacheDir, { recursive: true });
	let independentClient: LlmClient;
	let mergedClient: LlmClient;
	if (options.createClient !== undefined) {
		independentClient = options.createClient(
			"independent",
			path.join(options.cacheDir, "independent"),
		);
		mergedClient = options.createClient(
			"merged",
			path.join(options.cacheDir, "merged"),
		);
		log(`场记对照：模型 ${options.model ?? "测试客户端"}`);
	} else {
		if (options.channelsPath === undefined) {
			throw new Error("没有注入 createClient 时必须提供 channelsPath");
		}
		loadDotEnv(options.envPath ?? ".env");
		const channels = await loadChannelsConfig(options.channelsPath);
		const alias = options.model ?? resolveModelForRole(channels, "settler");
		if (!channels.models.has(alias)) {
			throw new Error(
				`没有模型 ${alias}；可用模型：${[...channels.models.keys()].join("、")}`,
			);
		}
		const makeClient = (side: "independent" | "merged") =>
			createLlmClient(channels, {
				defaultModel: alias,
				cacheDir: path.join(options.cacheDir, side),
			});
		independentClient = makeClient("independent");
		mergedClient = makeClient("merged");
		log(`场记对照：模型 ${alias}（settler 角色），两边各用一个响应缓存`);
	}
	const result = await runSceneLogCompareBatch({
		stories: samples.stories,
		dir: options.dir,
		independentClient,
		mergedClient,
		minimumFloors: options.minimumFloors ?? samples.minimumFloors,
		settleWindowFloors:
			options.settleWindowFloors ?? SCENE_LOG_COMPARE_SETTLE_WINDOW,
		samplesPath: path.resolve(options.samplesPath),
		log,
	});
	const report = formatSceneLogCompareBatchReport(result);
	await mkdir(path.dirname(options.jsonPath), { recursive: true });
	await writeFile(
		options.jsonPath,
		`${JSON.stringify(result, null, 2)}\n`,
		"utf8",
	);
	await mkdir(path.dirname(options.reportPath), { recursive: true });
	await writeFile(options.reportPath, `${report}\n`, "utf8");
	log(report);
	log(`结果：${options.jsonPath}`);
	log(`报告：${options.reportPath}`);
	return result;
}

interface CliArgs {
	readonly samplesPath: string | null;
	readonly dir: string | null;
	readonly jsonPath: string | null;
	readonly reportPath: string | null;
	readonly channelsPath: string | null;
	readonly model: string | null;
	readonly cacheDir: string | null;
	readonly settleWindowFloors: number | null;
	readonly minimumFloors: number | null;
	readonly help: boolean;
}

const VALUE_ARGS: Readonly<Record<string, true>> = {
	"--samples": true,
	"--dir": true,
	"--json": true,
	"--report": true,
	"--channels": true,
	"--model": true,
	"--cache": true,
	"--window": true,
	"--min-samples": true,
};

function parseArgs(args: readonly string[]): CliArgs {
	let samplesPath: string | null = null;
	let dir: string | null = null;
	let jsonPath: string | null = null;
	let reportPath: string | null = null;
	let channelsPath: string | null = null;
	let model: string | null = null;
	let cacheDir: string | null = null;
	let settleWindowFloors: number | null = null;
	let minimumFloors: number | null = null;
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
		if (arg === "--samples") samplesPath = value;
		else if (arg === "--dir") dir = value;
		else if (arg === "--json") jsonPath = value;
		else if (arg === "--report") reportPath = value;
		else if (arg === "--channels") channelsPath = value;
		else if (arg === "--model") model = value;
		else if (arg === "--cache") cacheDir = value;
		else if (arg === "--window")
			settleWindowFloors = requirePositive(value, arg);
		else minimumFloors = requirePositive(value, arg);
	}
	return {
		samplesPath,
		dir,
		jsonPath,
		reportPath,
		channelsPath,
		model,
		cacheDir,
		settleWindowFloors,
		minimumFloors,
		help,
	};
}

function requirePositive(value: string, label: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	const parsed = Number(value);
	if (parsed < 1) {
		throw new Error(`${label} 必须是不小于 1 的整数，收到 ${value}`);
	}
	return parsed;
}

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat scene-log-compare [选项]",
	"",
	"按固定楼层清单把 3 个 legacy 对话各复制两份数据库，分别跑独立后台任务与场记，",
	"逐楼层对比台账写入、引文命中、拒绝原因与请求数。源库只读，副本每次重建。",
	"",
	"选项：",
	"  --samples <path>   固定楼层清单，默认 eval-private/reports/scene-log/samples.json",
	"  --dir <path>       运行目录（两份副本与 runs/），默认 eval-private/reports/scene-log",
	"  --json <path>      结果 JSON，默认 <dir>/result.json",
	"  --report <path>    报告，默认 <dir>/report.md",
	"  --channels <path>  渠道配置，默认 data/channels.yaml",
	"  --model <alias>    覆盖 settler 角色的模型",
	"  --cache <path>     模型响应缓存目录，默认 <dir>/cache",
	"  --window <n>       结算窗口楼层数，默认 4",
	"  --min-samples <n>  最低楼层数，默认取样本文件或 20",
	"  --help             显示本说明",
	"",
	"样本文件格式：",
	'{"minimumFloors":20,"stories":[{"story":"<故事 id>","sourceDb":"source/<slug>.db","nodeIds":["<助手楼层>"]}]}',
].join("\n");

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(USAGE);
		return;
	}
	const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
	const reportsDir = path.join(
		repoRoot,
		"eval-private",
		"reports",
		"scene-log",
	);
	const dir = args.dir ?? reportsDir;
	await runSceneLogCompareCli({
		samplesPath: args.samplesPath ?? path.join(dir, "samples.json"),
		dir,
		jsonPath: args.jsonPath ?? path.join(dir, "result.json"),
		reportPath: args.reportPath ?? path.join(dir, "report.md"),
		cacheDir: args.cacheDir ?? path.join(dir, "cache"),
		channelsPath:
			args.channelsPath ?? path.join(repoRoot, "data", "channels.yaml"),
		envPath: path.join(repoRoot, ".env"),
		model: args.model,
		settleWindowFloors: args.settleWindowFloors,
		minimumFloors: args.minimumFloors,
	});
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}

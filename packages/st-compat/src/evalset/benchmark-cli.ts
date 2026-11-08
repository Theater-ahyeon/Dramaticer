import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StoryStore } from "@dramaticer/core";
import {
	type BenchmarkValidationResult,
	importBenchmark,
	validateBenchmark,
	writeBenchmark,
} from "./benchmark.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat benchmark --generate | --validate | --import --db <path> [选项]",
	"",
	"生成、校验或导入公开合成基准。",
	"",
	"选项：",
	"  --generate         按固定种子重新生成 benchmarks/ 的全部文件",
	"  --validate         逐字节比对生成结果，并校验题目结构、证据楼层、去重与分支点（默认）",
	"  --import           把基准故事导入一个数据库，之后可以跑试玩",
	"  --db <path>        --import 使用的数据库路径",
	"  --root <dir>       基准目录，默认仓库根目录的 benchmarks/",
	"  --scratch <dir>    校验时导入用的临时目录，默认 .devloop/scratch",
	"  --story <id>       只导入指定故事，可以重复",
	"  --help             显示本说明",
].join("\n");

export interface BenchmarkCliResult {
	readonly action: "generate" | "validate" | "import";
	readonly validation?: BenchmarkValidationResult;
	readonly imported?: readonly string[];
}

export async function runBenchmarkCli(
	args: readonly string[],
	dependencies: { readonly log?: (message: string) => void } = {},
): Promise<BenchmarkCliResult> {
	const log = dependencies.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return { action: "validate" };
	}
	const parsed = parseArgs(args);
	if (parsed.action === "generate") {
		const manifest = await writeBenchmark(parsed.rootDir);
		log(
			`已生成基准：${manifest.stories.length} 个故事，每个 ${manifest.turns * 2} 条消息，输出 ${parsed.rootDir}`,
		);
		return { action: "generate" };
	}
	if (parsed.action === "import") {
		if (parsed.dbPath === null) {
			throw new Error("--import 需要 --db <path>");
		}
		const store = StoryStore.open(parsed.dbPath);
		try {
			const result = await importBenchmark(store, {
				rootDir: parsed.rootDir,
				...(parsed.storyIds.length === 0 ? {} : { storyIds: parsed.storyIds }),
			});
			for (const story of result.stories) {
				log(
					`已导入 ${story.storyId}（${story.title}），${story.nodeCount} 个楼层`,
				);
			}
			return {
				action: "import",
				imported: result.stories.map((story) => story.storyId),
			};
		} finally {
			store.close();
		}
	}
	const validation = await validateBenchmark(parsed.rootDir, {
		...(parsed.scratchDir === null ? {} : { scratchDir: parsed.scratchDir }),
	});
	log(
		`基准校验通过：${validation.stories} 个故事、${validation.messages} 条消息、${validation.memoryQuestions} 道记忆题、${validation.probeQuestions} 道探针题、${validation.branchPoints} 个分支点`,
	);
	return { action: "validate", validation };
}

interface ParsedArgs {
	readonly action: "generate" | "validate" | "import";
	readonly rootDir: string;
	readonly dbPath: string | null;
	readonly scratchDir: string | null;
	readonly storyIds: readonly string[];
}

function parseArgs(args: readonly string[]): ParsedArgs {
	let action: ParsedArgs["action"] = "validate";
	let rootDir = path.join(repoRoot, "benchmarks");
	let dbPath: string | null = null;
	let scratchDir: string | null = null;
	const storyIds: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const nextValue = (): string => {
			index += 1;
			return requireValue(args, index, arg);
		};
		switch (arg) {
			case "--generate":
				action = "generate";
				break;
			case "--validate":
				action = "validate";
				break;
			case "--import":
				action = "import";
				break;
			case "--db":
				dbPath = nextValue();
				break;
			case "--root":
				rootDir = nextValue();
				break;
			case "--scratch":
				scratchDir = nextValue();
				break;
			case "--story":
				storyIds.push(nextValue());
				break;
			default:
				throw new Error(`未知参数：${arg}`);
		}
	}
	return { action, rootDir, dbPath, scratchDir, storyIds };
}

function requireValue(
	args: readonly string[],
	index: number,
	flag: string,
): string {
	const value = args[index];
	if (value === undefined || value.startsWith("--")) {
		throw new Error(`${flag} 需要参数值`);
	}
	return value;
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	runBenchmarkCli(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StoryStore } from "@dramaticer/core";
import { type PreferencesExportResult, exportPreferences } from "./export.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat preferences export --db <path> [选项]",
	"",
	"按故事导出偏好记录与接受/放弃的回复对，只写私有目录。",
	"",
	"选项：",
	"  --db <path>    必填，记录所在的数据库",
	"  --out <dir>    导出目录，默认 eval-private/preferences",
	"  --story <id>   只导出这个故事；不写时导出库里全部有记录的故事",
	"  --help         显示本说明",
].join("\n");

export interface PreferencesCliOptions {
	readonly log?: (message: string) => void;
}

/** `preferences export`：写出 `<故事>.events.jsonl`、`<故事>.pairs.jsonl` 与 `index.json`。 */
export async function runPreferencesCli(
	args: readonly string[],
	options: PreferencesCliOptions = {},
): Promise<PreferencesExportResult> {
	const log = options.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return {
			outDir: "",
			stories: [],
			eventCount: 0,
			pairCount: 0,
			unpairedChoices: 0,
		};
	}
	if (args[0] !== "export") {
		throw new Error(USAGE);
	}
	const values = new Map<string, string>();
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (key !== "db" && key !== "out" && key !== "story") {
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
	const dbPath = values.get("db");
	if (dbPath === undefined) {
		throw new Error(`--db 必填；${USAGE}`);
	}
	if (!existsSync(dbPath)) {
		throw new Error(`数据库不存在：${dbPath}`);
	}
	const outDir =
		values.get("out") ?? path.join(repoRoot, "eval-private", "preferences");
	const store = StoryStore.open(dbPath);
	try {
		const result = exportPreferences(store, {
			outDir,
			story: values.get("story") ?? null,
		});
		for (const story of result.stories) {
			const kinds = Object.entries(story.kindCounts)
				.map(([kind, count]) => `${kind} ${count}`)
				.join("、");
			log(
				`故事 ${story.storyId}：${story.eventCount} 条记录（${kinds}），${story.pairCount} 组回复对，未配对选择 ${story.unpairedChoices}`,
			);
		}
		log(
			`偏好导出：${result.stories.length} 个故事，${result.eventCount} 条记录，${result.pairCount} 组回复对，未配对选择 ${result.unpairedChoices}；目录 ${result.outDir}`,
		);
		return result;
	} finally {
		store.close();
	}
}

async function main(): Promise<void> {
	await runPreferencesCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}

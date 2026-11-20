import { existsSync } from "node:fs";
import { StoryStore } from "../store/story-store.js";
import {
	type RerollRateReport,
	formatRerollRates,
	readRerollRates,
} from "./reroll-stats.js";

const USAGE =
	"用法：dramaticer stats rerolls --db <path> [--story <id>] [--json]（只读，不调用模型）";

export interface StatsCliDependencies {
	readonly log?: (message: string) => void;
}

/** `dramaticer stats rerolls`：每百楼带原因重写率，按故事给出（DESIGN §14.1）。 */
export async function runStatsCli(
	args: readonly string[],
	dependencies: StatsCliDependencies = {},
): Promise<readonly RerollRateReport[]> {
	const parsed = parseStatsArgs(args);
	const log = dependencies.log ?? console.log;
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const store = StoryStore.open(parsed.dbPath);
	try {
		const storyIds =
			parsed.storyId === null
				? store.listStories().map((story) => story.id)
				: [parsed.storyId];
		const reports = storyIds.map((id) => readRerollRates(store, id));
		log(
			parsed.json
				? JSON.stringify(reports, null, 2)
				: reports.length === 0
					? "没有故事"
					: reports.map(formatRerollRates).join("\n\n"),
		);
		return reports;
	} finally {
		store.close();
	}
}

interface StatsArgs {
	readonly dbPath: string;
	readonly storyId: string | null;
	readonly json: boolean;
}

function parseStatsArgs(args: readonly string[]): StatsArgs {
	if (args[0] !== "stats" || args[1] !== "rerolls") throw new Error(USAGE);
	const values = new Map<string, string>();
	let json = false;
	for (let index = 2; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--json") {
			if (json) throw new Error(`参数 --json 重复；${USAGE}`);
			json = true;
			continue;
		}
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (key !== "db" && key !== "story") {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (values.has(key)) throw new Error(`参数 --${key} 重复；${USAGE}`);
		const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
		if (equals === -1) index += 1;
		if (value === undefined || value.length === 0) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		values.set(key, value);
	}
	const dbPath = values.get("db");
	if (dbPath === undefined) throw new Error(`--db 必须写数据库路径；${USAGE}`);
	return { dbPath, storyId: values.get("story") ?? null, json };
}

import { existsSync } from "node:fs";
import { StoryStore } from "../store/story-store.js";
import {
	type ExplainReport,
	explainNode,
	renderExplainReport,
} from "./explain.js";

const USAGE =
	"用法：dramaticer explain --node <楼层 id> --db <path> [--json]（只读，不调用模型）";

export interface ExplainCliDependencies {
	readonly log?: (message: string) => void;
}

export interface ExplainCliResult {
	readonly nodeId: string;
	readonly report: ExplainReport;
}

/** `dramaticer explain`：解释一个楼层为什么这么写、为什么忘了某件事。 */
export async function runExplainCli(
	args: readonly string[],
	dependencies: ExplainCliDependencies = {},
): Promise<ExplainCliResult> {
	const parsed = parseExplainArgs(args);
	const log = dependencies.log ?? console.log;
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const store = StoryStore.open(parsed.dbPath);
	try {
		const report = explainNode(store, parsed.nodeId);
		log(
			parsed.json
				? JSON.stringify(report, null, 2)
				: renderExplainReport(report),
		);
		return { nodeId: parsed.nodeId, report };
	} finally {
		store.close();
	}
}

interface ExplainArgs {
	readonly nodeId: string;
	readonly dbPath: string;
	readonly json: boolean;
}

function parseExplainArgs(args: readonly string[]): ExplainArgs {
	if (args[0] !== "explain") throw new Error(USAGE);
	const values = new Map<string, string>();
	let json = false;
	for (let index = 1; index < args.length; index += 1) {
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
		if (key !== "node" && key !== "db") {
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
	const nodeId = values.get("node");
	const dbPath = values.get("db");
	if (nodeId === undefined) throw new Error(`--node 必须写楼层 id；${USAGE}`);
	if (dbPath === undefined) throw new Error(`--db 必须写数据库路径；${USAGE}`);
	return { nodeId, dbPath, json };
}

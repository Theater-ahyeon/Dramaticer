import { existsSync } from "node:fs";
import { StoryStore } from "../store/story-store.js";
import type { DirectorCandidateAction } from "./candidates.js";

const USAGE =
	"用法：dramaticer actions --node <id> --db <path> [--json]（读取该楼层已经生成的候选行动）";

export interface ActionsCliDependencies {
	readonly log?: (message: string) => void;
}

export interface ActionsCliResult {
	readonly nodeId: string;
	readonly storyId: string;
	readonly actions: DirectorCandidateAction[];
}

interface ActionsArgs {
	readonly dbPath: string;
	readonly nodeId: string;
	readonly json: boolean;
}

/** `dramaticer actions`：只读列出某个楼层的候选行动与场景变化。 */
export function runActionsCli(
	args: readonly string[],
	dependencies: ActionsCliDependencies = {},
): ActionsCliResult {
	const parsed = parseActionsArgs(args);
	const log = dependencies.log ?? console.log;
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const store = StoryStore.open(parsed.dbPath);
	try {
		const node = store.getNode(parsed.nodeId);
		if (node === null) {
			throw new Error(`楼层节点不存在：${parsed.nodeId}`);
		}
		const actions = store.listDirectorCandidateActions(node.id);
		if (parsed.json) {
			log(JSON.stringify(actions, null, 2));
		} else {
			log(`楼层 ${node.id} 的候选行动：`);
			if (actions.length === 0) {
				log("（还没有生成）");
			}
			for (const action of actions) {
				const label = action.kind === "action" ? "行动" : "场景变化";
				log(`${action.ordinal + 1}. [${label}] ${action.text}`);
			}
		}
		return { nodeId: node.id, storyId: node.storyId, actions };
	} finally {
		store.close();
	}
}

function parseActionsArgs(args: readonly string[]): ActionsArgs {
	if (args[0] !== "actions") throw new Error(USAGE);
	let nodeId: string | undefined;
	let dbPath: string | undefined;
	let json = false;
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--json") {
			json = true;
			continue;
		}
		const [flag, inlineValue] = splitFlag(arg);
		if (flag === "--node") {
			nodeId = readFlagValue(args, index, inlineValue, "--node");
			if (inlineValue === undefined) index += 1;
			continue;
		}
		if (flag === "--db") {
			dbPath = readFlagValue(args, index, inlineValue, "--db");
			if (inlineValue === undefined) index += 1;
			continue;
		}
		throw new Error(`不认识的参数 ${arg}；${USAGE}`);
	}
	if (nodeId === undefined) throw new Error(`缺少 --node；${USAGE}`);
	if (dbPath === undefined) throw new Error(`缺少 --db；${USAGE}`);
	return { nodeId, dbPath, json };
}

function splitFlag(arg: string): [string, string | undefined] {
	const index = arg.indexOf("=");
	if (index === -1) return [arg, undefined];
	return [arg.slice(0, index), arg.slice(index + 1)];
}

function readFlagValue(
	args: readonly string[],
	index: number,
	inlineValue: string | undefined,
	flag: string,
): string {
	const value = inlineValue ?? args[index + 1];
	if (value === undefined || value.length === 0) {
		throw new Error(`${flag} 需要一个值；${USAGE}`);
	}
	return value;
}

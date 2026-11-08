import { existsSync, readFileSync } from "node:fs";
import { StoryStore } from "../store/story-store.js";
import {
	type DirectorPlan,
	parseDirectorPlan,
	readDirectorPlan,
	replaceDirectorPlan,
} from "./plan.js";

const USAGE =
	"用法：dramaticer director plan --story <id> --db <path> [--json] [--set <file>]（--set 用玩家身份整份替换计划）";

export interface DirectorCliDependencies {
	readonly log?: (message: string) => void;
}

export interface DirectorCliResult {
	readonly storyId: string;
	readonly plan: DirectorPlan;
	/** `set` 表示本次运行写了计划；`list` 只读。 */
	readonly action: "list" | "set";
}

interface DirectorPlanArgs {
	readonly dbPath: string;
	readonly storyId: string;
	readonly json: boolean;
	readonly setPath: string | undefined;
}

/** `dramaticer director plan`：读取或整份替换故事的长线计划。 */
export function runDirectorCli(
	args: readonly string[],
	dependencies: DirectorCliDependencies = {},
): DirectorCliResult {
	const parsed = parseDirectorArgs(args);
	const log = dependencies.log ?? console.log;
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const store = StoryStore.open(parsed.dbPath);
	try {
		return runWithStore(store, parsed, log);
	} finally {
		store.close();
	}
}

function runWithStore(
	store: StoryStore,
	parsed: DirectorPlanArgs,
	log: (message: string) => void,
): DirectorCliResult {
	if (!store.getStory(parsed.storyId)) {
		throw new Error(`故事不存在：${parsed.storyId}`);
	}
	if (parsed.setPath !== undefined) {
		const raw = readFileSync(parsed.setPath, "utf8");
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch (error) {
			throw new Error(
				`计划文件 ${parsed.setPath} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
			);
		}
		const plan = parseDirectorPlan(value);
		replaceDirectorPlan(store, parsed.storyId, plan);
		const saved = readDirectorPlan(store, parsed.storyId);
		log(`已写入导演计划：${parsed.storyId}`);
		logPlan(saved, parsed.json, log);
		return { storyId: parsed.storyId, plan: saved, action: "set" };
	}
	const plan = readDirectorPlan(store, parsed.storyId);
	logPlan(plan, parsed.json, log);
	return { storyId: parsed.storyId, plan, action: "list" };
}

function logPlan(
	plan: DirectorPlan,
	json: boolean,
	log: (message: string) => void,
): void {
	if (json) {
		log(JSON.stringify(plan, null, 2));
		return;
	}
	const beatCount = plan.arcs.reduce(
		(total, arc) =>
			total +
			arc.sequences.reduce(
				(sequenceTotal, sequence) => sequenceTotal + sequence.beats.length,
				0,
			),
		0,
	);
	log(`导演计划：${plan.arcs.length} 条弧线、${beatCount} 个节拍`);
	for (const arc of plan.arcs) {
		log(
			`弧线 ${arc.id}《${arc.title}》难度 ${arc.difficulty.toFixed(2)}，红线 ${arc.redLines.length} 条`,
		);
		for (const sequence of arc.sequences) {
			log(
				`  序列 ${sequence.id}《${sequence.title}》，节拍 ${sequence.beats.length} 个`,
			);
			for (const beat of sequence.beats) {
				log(`    ${beat.id}：${beat.goal}`);
			}
		}
	}
}

function parseDirectorArgs(args: readonly string[]): DirectorPlanArgs {
	if (args[0] !== "director" || args[1] !== "plan") throw new Error(USAGE);
	let storyId: string | undefined;
	let dbPath: string | undefined;
	let setPath: string | undefined;
	let json = false;
	for (let index = 2; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--json") {
			json = true;
			continue;
		}
		const [flag, inlineValue] = splitFlag(arg);
		if (flag === "--story") {
			storyId = readFlagValue(args, index, inlineValue, "--story", USAGE);
			if (inlineValue === undefined) index += 1;
			continue;
		}
		if (flag === "--db") {
			dbPath = readFlagValue(args, index, inlineValue, "--db", USAGE);
			if (inlineValue === undefined) index += 1;
			continue;
		}
		if (flag === "--set") {
			setPath = readFlagValue(args, index, inlineValue, "--set", USAGE);
			if (inlineValue === undefined) index += 1;
			continue;
		}
		throw new Error(`不认识的参数 ${arg}；${USAGE}`);
	}
	if (storyId === undefined) throw new Error(`缺少 --story；${USAGE}`);
	if (dbPath === undefined) throw new Error(`缺少 --db；${USAGE}`);
	return { storyId, dbPath, json, setPath };
}

function splitFlag(arg: string): [string, string | undefined] {
	const equals = arg.indexOf("=");
	if (!arg.startsWith("--") || equals === -1) return [arg, undefined];
	return [arg.slice(0, equals), arg.slice(equals + 1)];
}

function readFlagValue(
	args: readonly string[],
	index: number,
	inlineValue: string | undefined,
	flag: string,
	usage: string,
): string {
	const value = inlineValue ?? args[index + 1];
	if (value === undefined || value.length === 0 || value.startsWith("--")) {
		throw new Error(`${flag} 后面必须写值；${usage}`);
	}
	return value;
}

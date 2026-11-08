import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../env.js";
import {
	type LlmChannelsConfig,
	loadChannelsConfig,
	resolveModelForRole,
} from "../llm/channels.js";
import { createLlmClient } from "../llm/configure.js";
import type { LlmClient } from "../llm/types.js";
import { StoryStore } from "../store/story-store.js";
import {
	type DirectorPlan,
	parseDirectorPlan,
	readDirectorPlan,
	replaceDirectorPlan,
} from "./plan.js";
import { generateDirectorPlan } from "./planner.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE =
	"用法：dramaticer director plan --story <id> --db <path> [--json] [--set <file> | --generate]（--set 用玩家身份整份替换计划；--generate 同步执行一次规划器）";

export interface DirectorCliDependencies {
	readonly log?: (message: string) => void;
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	/** 规划器客户端；测试注入时不读取渠道配置。 */
	readonly client?: LlmClient;
}

export interface DirectorCliResult {
	readonly storyId: string;
	readonly plan: DirectorPlan;
	/** `set` 与 `generate` 表示本次运行写了计划；`list` 只读。 */
	readonly action: "list" | "set" | "generate";
}

interface DirectorPlanArgs {
	readonly dbPath: string;
	readonly storyId: string;
	readonly json: boolean;
	readonly setPath: string | undefined;
	readonly generate: boolean;
}

/** `dramaticer director plan`：读取、整份替换或生成故事的长线计划。 */
export async function runDirectorCli(
	args: readonly string[],
	dependencies: DirectorCliDependencies = {},
): Promise<DirectorCliResult> {
	const parsed = parseDirectorArgs(args);
	const log = dependencies.log ?? console.log;
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const store = StoryStore.open(parsed.dbPath);
	try {
		return await runWithStore(store, parsed, log, dependencies);
	} finally {
		store.close();
	}
}

async function runWithStore(
	store: StoryStore,
	parsed: DirectorPlanArgs,
	log: (message: string) => void,
	dependencies: DirectorCliDependencies,
): Promise<DirectorCliResult> {
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
	if (parsed.generate) {
		const client = await resolvePlannerClient(dependencies);
		await generateDirectorPlan({
			store,
			client,
			storyId: parsed.storyId,
		});
		const saved = readDirectorPlan(store, parsed.storyId);
		log(`已生成导演计划：${parsed.storyId}`);
		logPlan(saved, parsed.json, log);
		return { storyId: parsed.storyId, plan: saved, action: "generate" };
	}
	const plan = readDirectorPlan(store, parsed.storyId);
	logPlan(plan, parsed.json, log);
	return { storyId: parsed.storyId, plan, action: "list" };
}

/** 规划器使用 `roles.planner` 的模型与独立客户端，不复用正文或结算的客户端。 */
async function resolvePlannerClient(
	dependencies: DirectorCliDependencies,
): Promise<LlmClient> {
	if (dependencies.client !== undefined) return dependencies.client;
	const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
	const channelsPath =
		dependencies.channelsPath ?? path.join(repoRoot, "data", "channels.yaml");
	const loadEnv = dependencies.loadEnv ?? loadDotEnv;
	const loadConfig = dependencies.loadConfig ?? loadChannelsConfig;
	loadEnv(envPath);
	const config = await loadConfig(channelsPath);
	return createLlmClient(config, {
		defaultModel: resolveModelForRole(config, "planner"),
		cacheDir: null,
	});
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
	let generate = false;
	for (let index = 2; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--generate") {
			generate = true;
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
	if (generate && setPath !== undefined) {
		throw new Error(`--generate 与 --set 不能同时使用；${USAGE}`);
	}
	return { storyId, dbPath, json, setPath, generate };
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

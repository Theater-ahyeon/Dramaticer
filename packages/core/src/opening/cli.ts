import { existsSync } from "node:fs";
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
import type { OpeningCandidateRecord } from "../store/settings.js";
import { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import {
	assertOpeningCandidateCount,
	generateOpeningCandidates,
} from "./candidates.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE =
	"用法：dramaticer open --story <id> --db <path> [--generate <n>] [--list] [--pick <id>]（--generate 生成一批候选，n 取 2 或 3；不写动作时列出候选）";

type OpeningAction = "generate" | "list" | "pick";

export interface OpeningCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (config: LlmChannelsConfig) => LlmClient;
	readonly now?: () => number;
	readonly log?: (message: string) => void;
}

export interface OpeningCliResult {
	readonly action: OpeningAction;
	readonly candidates: readonly OpeningCandidateRecord[];
	/** 选中候选生成的楼层；其它动作是 null。 */
	readonly node: TimelineNode | null;
}

type OpeningArgs =
	| {
			readonly action: "list";
			readonly dbPath: string;
			readonly storyId: string;
	  }
	| {
			readonly action: "generate";
			readonly dbPath: string;
			readonly storyId: string;
			readonly generateCount: number;
	  }
	| {
			readonly action: "pick";
			readonly dbPath: string;
			readonly storyId: string;
			readonly pickId: string;
	  };

/** `dramaticer open`：生成、列出或选中故事的首楼开场候选。 */
export async function runOpeningCli(
	args: readonly string[],
	dependencies: OpeningCliDependencies = {},
): Promise<OpeningCliResult> {
	const parsed = parseOpeningArgs(args);
	const log = dependencies.log ?? console.log;
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const store = StoryStore.open(parsed.dbPath);
	try {
		if (parsed.action === "list") {
			const candidates = store.listOpeningCandidates(parsed.storyId);
			logCandidates(candidates, log);
			return { action: "list", candidates, node: null };
		}
		if (parsed.action === "pick") {
			const picked = store.chooseOpeningCandidate(parsed.pickId, {
				...(dependencies.now === undefined
					? {}
					: { chosenAt: new Date(dependencies.now()).toISOString() }),
			});
			log(
				`已选中开场候选 ${picked.candidate.id}，成为首个楼层 ${picked.node.id}`,
			);
			return {
				action: "pick",
				candidates: [picked.candidate],
				node: picked.node,
			};
		}
		const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
		const channelsPath =
			dependencies.channelsPath ?? path.join(repoRoot, "data", "channels.yaml");
		(dependencies.loadEnv ?? loadDotEnv)(envPath);
		const config = await (dependencies.loadConfig ?? loadChannelsConfig)(
			channelsPath,
		);
		const model = resolveModelForRole(config, "settler");
		const client = (
			dependencies.createClient ??
			((value: LlmChannelsConfig) =>
				createLlmClient(value, { defaultModel: model, cacheDir: null }))
		)(config);
		const candidates = await generateOpeningCandidates({
			store,
			client,
			storyId: parsed.storyId,
			count: parsed.generateCount,
			...(dependencies.now === undefined
				? {}
				: { createdAt: new Date(dependencies.now()).toISOString() }),
		});
		logCandidates(candidates, log);
		return { action: "generate", candidates, node: null };
	} finally {
		store.close();
	}
}

function logCandidates(
	candidates: readonly OpeningCandidateRecord[],
	log: (message: string) => void,
): void {
	log(`开场候选 ${candidates.length} 条：`);
	for (const candidate of candidates) {
		const firstLine =
			candidate.raw.split("\n").find((line) => line.trim().length > 0) ?? "";
		log(
			`${candidate.id} [${candidate.status}] 序号 ${candidate.ordinal}：${firstLine}`,
		);
	}
}

function parseOpeningArgs(args: readonly string[]): OpeningArgs {
	if (args[0] !== "open") throw new Error(USAGE);
	const allowed: Readonly<Record<string, true>> = {
		story: true,
		db: true,
		generate: true,
		list: true,
		pick: true,
	};
	const values = new Map<string, string>();
	let list = false;
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (allowed[key] !== true) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (key === "list" ? list : values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		if (key === "list") {
			if (equals !== -1) {
				throw new Error(`--list 不带值；${USAGE}`);
			}
			list = true;
			continue;
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
		throw new Error(`--db 必须是非空路径；${USAGE}`);
	}
	const storyId = values.get("story");
	if (storyId === undefined) {
		throw new Error(`--story 必须是非空故事 id；${USAGE}`);
	}
	const generate = values.get("generate");
	const generateCount =
		generate === undefined
			? null
			: assertOpeningCandidateCount(Number(generate));
	const pickId = values.get("pick");
	const actionCount =
		(generateCount === null ? 0 : 1) +
		(list ? 1 : 0) +
		(pickId === undefined ? 0 : 1);
	if (actionCount > 1) {
		throw new Error(`--generate、--list、--pick 只能选一个；${USAGE}`);
	}
	if (generateCount !== null) {
		return { action: "generate", dbPath, storyId, generateCount };
	}
	if (pickId !== undefined) {
		return { action: "pick", dbPath, storyId, pickId };
	}
	return { action: "list", dbPath, storyId };
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../env.js";
import {
	type LlmChannelConfig,
	type LlmChannelsConfig,
	type LlmModelConfig,
	type LlmModelProbe,
	loadChannelsConfig,
	writeModelProbe,
} from "../llm/channels.js";
import { createLlmChannel } from "../llm/configure.js";
import { probeChannel } from "../llm/probe.js";
import type { LlmChannel } from "../llm/types.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export interface ProbeCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createChannel?: (config: LlmChannelConfig) => LlmChannel;
	readonly writeProbe?: (
		filePath: string,
		alias: string,
		probe: LlmModelProbe,
	) => Promise<void>;
	readonly now?: () => number;
	readonly log?: (message: string) => void;
}

export interface ProbeCliResult {
	readonly channel: string;
	readonly alias: string;
	readonly probe: LlmModelProbe;
}

/** `dramaticer probe <channel> [--model <alias>]` 的实现，依赖可注入。 */
export async function runProbeCli(
	args: readonly string[],
	dependencies: ProbeCliDependencies = {},
): Promise<ProbeCliResult> {
	const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
	const channelsPath =
		dependencies.channelsPath ?? path.join(repoRoot, "data", "channels.yaml");
	const loadEnv = dependencies.loadEnv ?? loadDotEnv;
	const loadConfig = dependencies.loadConfig ?? loadChannelsConfig;
	const createChannel = dependencies.createChannel ?? createLlmChannel;
	const writeProbe = dependencies.writeProbe ?? writeModelProbe;
	const log = dependencies.log ?? console.log;

	const { channelId, modelAlias } = parseProbeArgs(args);
	loadEnv(envPath);
	const config = await loadConfig(channelsPath);
	const channelConfig = config.channels.get(channelId);
	if (channelConfig === undefined) {
		throw new Error(
			`没有渠道 ${channelId}；可用渠道：${[...config.channels.keys()].join("、")}`,
		);
	}
	const model = selectModel(config, channelId, modelAlias);
	const probe = await probeChannel({
		channel: createChannel(channelConfig),
		model: {
			id: model.id,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			reasoning: model.reasoning,
		},
		now: dependencies.now,
	});
	await writeProbe(channelsPath, model.alias, probe);
	log(`渠道 ${channelId} / 模型 ${model.alias} 的体检结果：`);
	log(JSON.stringify(probe, null, 2));
	return { channel: channelId, alias: model.alias, probe };
}

function parseProbeArgs(args: readonly string[]): {
	readonly channelId: string;
	readonly modelAlias: string | undefined;
} {
	const usage = "用法：dramaticer probe <channel> [--model <alias>]";
	if (args.length === 0 || args[0] !== "probe") {
		throw new Error(usage);
	}
	let channelId: string | undefined;
	let modelAlias: string | undefined;
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--model") {
			const value = args[index + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new Error(`--model 后面必须写模型别名；${usage}`);
			}
			modelAlias = value;
			index += 1;
		} else if (arg.startsWith("--model=")) {
			modelAlias = arg.slice("--model=".length);
			if (modelAlias.length === 0) {
				throw new Error(`--model= 后面必须写模型别名；${usage}`);
			}
		} else if (arg.startsWith("--")) {
			throw new Error(`不认识的参数 ${arg}；${usage}`);
		} else if (channelId === undefined) {
			channelId = arg;
		} else {
			throw new Error(`只能指定一个渠道；${usage}`);
		}
	}
	if (channelId === undefined) throw new Error(usage);
	return { channelId, modelAlias };
}

function selectModel(
	config: LlmChannelsConfig,
	channelId: string,
	alias: string | undefined,
): LlmModelConfig {
	if (alias !== undefined) {
		const model = config.models.get(alias);
		if (model === undefined) {
			throw new Error(
				`没有模型 ${alias}；可用模型：${[...config.models.keys()].join("、")}`,
			);
		}
		if (!model.channels.includes(channelId)) {
			throw new Error(`模型 ${alias} 没有配置渠道 ${channelId}`);
		}
		return model;
	}
	const candidates = [...config.models.values()].filter((model) =>
		model.channels.includes(channelId),
	);
	if (candidates.length === 1) return candidates[0];
	if (candidates.length === 0) {
		throw new Error(`没有模型使用渠道 ${channelId}`);
	}
	throw new Error(
		`渠道 ${channelId} 被多个模型使用：${candidates
			.map((model) => model.alias)
			.join("、")}；请用 --model 指定`,
	);
}

const entryPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === entryPath) {
	try {
		await runProbeCli(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}

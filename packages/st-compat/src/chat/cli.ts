import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ChatTurnResult,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	StoryStore,
	createDefaultContextTemplate,
	createDirectorSlotProvider,
	createEmbeddingClient,
	createHistorySlotProvider,
	createLlmClient,
	createLoreSlotProvider,
	createMemorySlotProvider,
	createStateSlotProvider,
	createStaticSlotProvider,
	createSummarySlotProvider,
	loadChannelsConfig,
	loadDotEnv,
	resolveStructuredOutputMode,
	runChatTurn,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	parseCharacterCardFile,
} from "../character-card.js";
import { importCharacterCardEntity } from "../entity-import.js";
import {
	importCharacterBookLore,
	importWorldInfoLore,
} from "../lore-import.js";
import { type StWorldInfo, parseWorldInfoFile } from "../world-info.js";
import { renderCharacterPrompt } from "./character.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export interface ChatCliDependencies {
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly dbPath?: string;
	readonly loadEnv?: (filePath: string) => void;
	readonly loadConfig?: (filePath: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (
		config: LlmChannelsConfig,
		modelAlias: string,
	) => LlmStreamingClient;
	readonly loadCard?: (filePath: string) => Promise<StCharacterCard>;
	readonly loadWorld?: (filePath: string) => Promise<StWorldInfo>;
	readonly now?: () => number;
	/** 状态信息，默认写到 stderr，避免和正文混在一起。 */
	readonly log?: (message: string) => void;
	/** 正文增量，默认写到 stdout。 */
	readonly write?: (text: string) => void;
}

const USAGE =
	"用法：dramaticer chat --story <id> --card <path> --user <text> [--world <path>] [--db <path>] [--model <alias>] [--budget <tokens>] [--max-tokens <n>] [--temperature <x>]";

interface ChatArgs {
	readonly storyId: string;
	readonly cardPath: string;
	readonly worldPaths: readonly string[];
	readonly userText: string;
	readonly dbPath: string | null;
	readonly model: string | null;
	readonly budgetTokens: number | null;
	readonly maxTokens: number | null;
	readonly temperature: number | null;
}

/** `dramaticer chat` 的实现，依赖可注入。 */
export async function runChatCli(
	args: readonly string[],
	dependencies: ChatCliDependencies = {},
): Promise<ChatTurnResult> {
	const parsed = parseChatArgs(args);
	const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
	const channelsPath =
		dependencies.channelsPath ?? path.join(repoRoot, "data", "channels.yaml");
	const loadEnv = dependencies.loadEnv ?? loadDotEnv;
	const loadConfig = dependencies.loadConfig ?? loadChannelsConfig;
	const loadCard = dependencies.loadCard ?? parseCharacterCardFile;
	const loadWorld = dependencies.loadWorld ?? parseWorldInfoFile;
	const createClient =
		dependencies.createClient ??
		((config: LlmChannelsConfig, alias: string) =>
			createLlmClient(config, { defaultModel: alias, cacheDir: null }));
	const log =
		dependencies.log ??
		((message: string) => {
			process.stderr.write(`${message}\n`);
		});
	const write =
		dependencies.write ??
		((text: string) => {
			process.stdout.write(text);
		});

	loadEnv(envPath);
	const config = await loadConfig(channelsPath);
	const modelAlias = parsed.model ?? pickDefaultModel(config);
	const model = config.models.get(modelAlias);
	if (model === undefined) {
		throw new Error(
			`没有模型 ${modelAlias}；可用模型：${[...config.models.keys()].join("、")}`,
		);
	}
	const mode = resolveStructuredOutputMode(model.probe);
	const card = await loadCard(parsed.cardPath);

	const dbPath =
		parsed.dbPath ??
		dependencies.dbPath ??
		path.join(repoRoot, "data", "dramaticer.db");
	await mkdir(path.dirname(dbPath), { recursive: true });
	const embeddingDimensions = config.embeddings.get("default")?.dimensions;
	const embedder = config.embeddings.has("default")
		? createEmbeddingClient(config)
		: null;
	const store = StoryStore.open(
		dbPath,
		embeddingDimensions === undefined ? {} : { embeddingDimensions },
	);
	try {
		if (store.getStory(parsed.storyId) === null) {
			store.createStory({
				id: parsed.storyId,
				title: card.name.trim().length > 0 ? card.name : parsed.storyId,
			});
			const greeting = card.firstMessage.trim();
			if (greeting.length > 0) {
				store.appendNode({
					storyId: parsed.storyId,
					parentId: null,
					role: "assistant",
					raw: greeting,
				});
			}
			log(`已创建故事 ${parsed.storyId}`);
		}
		importCharacterCardEntity(store, parsed.storyId, card);
		if (card.characterBook !== null) {
			importCharacterBookLore(
				store,
				parsed.storyId,
				card.characterBook,
				card.name,
			);
		}
		for (const worldPath of parsed.worldPaths) {
			const worldInfo = await loadWorld(worldPath);
			importWorldInfoLore(store, parsed.storyId, worldInfo);
		}
		const budgetTokens =
			parsed.budgetTokens ?? model.contextWindow - model.maxTokens;
		if (budgetTokens <= 0) {
			throw new Error(
				`模型的上下文窗口 ${model.contextWindow} 不大于输出上限 ${model.maxTokens}，没有可用的输入预算`,
			);
		}
		const result = await runChatTurn({
			store,
			client: createClient(config, modelAlias),
			storyId: parsed.storyId,
			userText: parsed.userText,
			template: createDefaultContextTemplate({ structuredOutput: mode }),
			providers: {
				character: createStaticSlotProvider(
					[{ role: "system", content: renderCharacterPrompt(card) }],
					`card:${card.name}`,
				),
				history: createHistorySlotProvider(store),
				state: createStateSlotProvider(store),
				summary: createSummarySlotProvider(store),
				memory: createMemorySlotProvider(store, { embedder }),
				lore: createLoreSlotProvider(store),
				director: createDirectorSlotProvider(store),
			},
			budgetTokens,
			structuredOutput: mode,
			model: modelAlias,
			embedder,
			maxTokens: parsed.maxTokens ?? undefined,
			temperature: parsed.temperature ?? undefined,
			reasoning: "low",
			now: dependencies.now,
			onTextDelta: (delta) => {
				write(delta);
			},
		});
		write("\n");
		const usage = result.trace.llm.usage;
		log(
			`楼层 ${result.node.id}：状态变更 ${result.stateDiffs.length} 条，剧情笔记 ${result.structured.notes.length} 条，拒绝 ${result.structured.issues.length} 条，读取工具 ${result.trace.tools.rounds} 轮`,
		);
		log(
			`模型 ${result.trace.llm.model}，渠道 ${result.trace.llm.channel ?? "缓存"}，首字 ${
				result.trace.timing.firstTokenMs === null
					? "—"
					: `${result.trace.timing.firstTokenMs} 毫秒`
			}，总耗时 ${result.trace.timing.durationMs} 毫秒`,
		);
		log(
			`token 输入 ${usage.promptTokens ?? "—"}，输出 ${usage.completionTokens ?? "—"}，合计 ${usage.totalTokens ?? "—"}`,
		);
		return result;
	} finally {
		store.close();
	}
}

function pickDefaultModel(config: LlmChannelsConfig): string {
	if (config.models.has("main")) return "main";
	if (config.models.size === 1) {
		return [...config.models.keys()][0] as string;
	}
	throw new Error(
		`渠道配置里有多个模型，请用 --model 指定：${[...config.models.keys()].join("、")}`,
	);
}

function parseChatArgs(args: readonly string[]): ChatArgs {
	if (args[0] !== "chat") throw new Error(USAGE);
	const allowed: Readonly<Record<string, true>> = {
		story: true,
		card: true,
		world: true,
		user: true,
		db: true,
		model: true,
		budget: true,
		"max-tokens": true,
		temperature: true,
	};
	const values = new Map<string, string>();
	const worldPaths: string[] = [];
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
		if (values.has(key) && key !== "world") {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		let value: string | undefined;
		if (equals !== -1) {
			value = arg.slice(equals + 1);
		} else {
			value = args[index + 1];
			index += 1;
		}
		if (value === undefined) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		if (key === "world") {
			worldPaths.push(requireText(value, "--world"));
			continue;
		}
		values.set(key, value);
	}

	const storyId = requireText(values.get("story"), "--story");
	const cardPath = requireText(values.get("card"), "--card");
	const userText = requireText(values.get("user"), "--user");
	const dbPath = optionalText(values.get("db"), "--db");
	const model = optionalText(values.get("model"), "--model");
	const budget = values.get("budget");
	const maxTokens = values.get("max-tokens");
	const temperature = values.get("temperature");
	return {
		storyId,
		cardPath,
		worldPaths,
		userText,
		dbPath,
		model,
		budgetTokens:
			budget === undefined ? null : parseInteger(budget, "--budget", 0),
		maxTokens:
			maxTokens === undefined
				? null
				: parseInteger(maxTokens, "--max-tokens", 1),
		temperature:
			temperature === undefined ? null : parseTemperature(temperature),
	};
}

function requireText(value: string | undefined, label: string): string {
	if (value === undefined || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串；${USAGE}`);
	}
	return value;
}

function optionalText(value: string | undefined, label: string): string | null {
	if (value === undefined) return null;
	if (value.trim().length === 0) {
		throw new Error(`${label} 不能为空字符串；${USAGE}`);
	}
	return value;
}

function parseInteger(value: string, label: string, minimum: number): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum) {
		throw new Error(`${label} 必须是不小于 ${minimum} 的整数；${USAGE}`);
	}
	return parsed;
}

function parseTemperature(value: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`--temperature 必须是非负数字；${USAGE}`);
	}
	return parsed;
}

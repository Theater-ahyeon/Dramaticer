import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ChatProfile,
	type ChatTurnResult,
	DEFAULT_CHAT_PROFILE,
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorIntensity,
	type DirectorMode,
	type LlmChannelsConfig,
	type LlmStreamingClient,
	StoryStore,
	type TurnMode,
	createEmbeddingClient,
	createLlmClient,
	createNaiveChatSlots,
	createNaiveContextTemplate,
	createRerankClient,
	createStandardChatSlots,
	isChatProfile,
	isDirectorIntensity,
	isDirectorMode,
	isTurnMode,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
	resolveStructuredOutputMode,
	resolveToolTransport,
	runChatTurn,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	parseCharacterCardFile,
} from "../character-card.js";
import { type StWorldInfo, parseWorldInfoFile } from "../world-info.js";
import { importCardContent, resolveStoryContextTemplate } from "./session.js";

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
	"用法：dramaticer chat --story <id> --user <text> [--card <path>] [--world <path>] [--profile <native|naive>] [--persona <text>] [--director <off|transparent|blind>] [--intensity <setup|natural|detonate>] [--mode <fast|deep>] [--db <path>] [--model <alias>] [--budget <tokens>] [--max-tokens <n>] [--temperature <x>]";

interface ChatArgs {
	readonly storyId: string;
	/** 首次运行必须提供；之后可以只靠故事设置里的提示词。 */
	readonly cardPath: string | null;
	readonly worldPaths: readonly string[];
	readonly userText: string;
	readonly dbPath: string | null;
	readonly model: string | null;
	readonly budgetTokens: number | null;
	readonly maxTokens: number | null;
	readonly temperature: number | null;
	readonly directorMode: DirectorMode;
	/** 单轮导演强度；不传时用导演配置里的值。 */
	readonly directorIntensity: DirectorIntensity | null;
	/** 单轮模式；不传时用故事设置里的锁定值。 */
	readonly turnMode: TurnMode | null;
	readonly profile: ChatProfile;
	/** 玩家人设；传了就写进故事设置。 */
	readonly persona: string | null;
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
	const modelAlias = parsed.model ?? resolveModelForRole(config, "writer");
	const model = config.models.get(modelAlias);
	if (model === undefined) {
		throw new Error(
			`没有模型 ${modelAlias}；可用模型：${[...config.models.keys()].join("、")}`,
		);
	}
	const mode = resolveStructuredOutputMode(model.probe);

	const dbPath =
		parsed.dbPath ??
		dependencies.dbPath ??
		path.join(repoRoot, "data", "dramaticer.db");
	await mkdir(path.dirname(dbPath), { recursive: true });
	const embeddingDimensions = config.embeddings.get("default")?.dimensions;
	const embedder = config.embeddings.has("default")
		? createEmbeddingClient(config)
		: null;
	const reranker = createRerankClient(config);
	const store = StoryStore.open(
		dbPath,
		embeddingDimensions === undefined ? {} : { embeddingDimensions },
	);
	try {
		const card =
			parsed.cardPath === null ? null : await loadCard(parsed.cardPath);
		if (store.getStory(parsed.storyId) === null) {
			if (card === null) {
				throw new Error(
					`故事 ${parsed.storyId} 不存在，首次运行需要用 --card 导入角色卡`,
				);
			}
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
		if (card === null && parsed.worldPaths.length > 0) {
			throw new Error("--world 需要同时提供 --card");
		}
		const worlds: StWorldInfo[] = [];
		for (const worldPath of parsed.worldPaths) {
			worlds.push(await loadWorld(worldPath));
		}
		const imported =
			card === null
				? null
				: importCardContent(store, parsed.storyId, { card, worlds });
		const settings = store.getStorySettings(parsed.storyId);
		if (imported !== null) {
			store.updateStorySettings(parsed.storyId, {
				cardName: imported.cardName,
				characterPrompt: imported.characterPrompt,
			});
			const report = imported.cardMapping.report;
			log(
				`角色卡兼容：${report.spec}，prompt 字段 ${report.fields.length} 个，未知字段 ${report.unknownFields.length} 个，群聊问候 ${report.greetings.groupOnlyCount} 条，作者注释 ${report.creatorNotesChars} 字符未注入`,
			);
			for (const issue of imported.cardMapping.report.issues) {
				log(`兼容提示：${issue.code}：${issue.detail}`);
			}
			for (const issue of imported.dependencies.issues) {
				log(
					`依赖提示：${issue.message}${issue.level === "required" ? "（必需依赖未满足）" : ""}`,
				);
			}
		}
		const characterPrompt =
			imported === null ? settings.characterPrompt : imported.characterPrompt;
		if (characterPrompt === null) {
			throw new Error(
				`故事 ${parsed.storyId} 没有保存角色提示词，请用 --card 导入角色卡`,
			);
		}
		if (parsed.persona !== null) {
			store.updateStorySettings(parsed.storyId, { persona: parsed.persona });
		}
		const persona = parsed.persona ?? settings.persona;
		const template =
			parsed.profile === "naive"
				? createNaiveContextTemplate()
				: resolveStoryContextTemplate(store, settings.templateId, mode);
		const budgetTokens =
			parsed.budgetTokens ?? model.contextWindow - model.maxTokens;
		if (budgetTokens <= 0) {
			throw new Error(
				`模型的上下文窗口 ${model.contextWindow} 不大于输出上限 ${model.maxTokens}，没有可用的输入预算`,
			);
		}
		const slots =
			parsed.profile === "naive"
				? await createNaiveChatSlots({ store, characterPrompt, persona })
				: await createStandardChatSlots({
						store,
						characterPrompt,
						embedder,
						reranker,
						directorConfig: {
							...DEFAULT_DIRECTOR_CONFIG,
							mode: parsed.directorMode,
						},
						historyBlockPolicy: settings.historyBlockPolicy,
						worldModel: settings.worldModel,
						directorOrganization: settings.directorOrganization,
					});
		const result = await runChatTurn({
			store,
			client: createClient(config, modelAlias),
			storyId: parsed.storyId,
			userText: parsed.userText,
			template,
			providers: slots.providers,
			requestRewriter: slots.kernel,
			budgetTokens,
			structuredOutput: mode,
			profile: parsed.profile,
			toolTransport: resolveToolTransport(model),
			turnMode: parsed.turnMode,
			directorIntensity: parsed.directorIntensity,
			model: modelAlias,
			embedder,
			reranker,
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
			`楼层 ${result.node.id}（档位 ${result.trace.profile}）：状态变更 ${result.stateDiffs.length} 条，剧情笔记 ${result.structured.notes.length} 条，拒绝 ${result.structured.issues.length} 条，读取工具 ${result.trace.tools.rounds} 轮`,
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
		director: true,
		intensity: true,
		mode: true,
		profile: true,
		persona: true,
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
	const cardValue = values.get("card");
	const cardPath =
		cardValue === undefined ? null : requireText(cardValue, "--card");
	const userText = requireText(values.get("user"), "--user");
	const dbPath = optionalText(values.get("db"), "--db");
	const model = optionalText(values.get("model"), "--model");
	const budget = values.get("budget");
	const maxTokens = values.get("max-tokens");
	const temperature = values.get("temperature");
	const director = values.get("director");
	const intensity = values.get("intensity");
	const turnModeValue = values.get("mode");
	const profileValue = values.get("profile");
	const personaValue = values.get("persona");
	const profile =
		profileValue === undefined
			? DEFAULT_CHAT_PROFILE
			: parseProfile(profileValue);
	const directorMode =
		director === undefined
			? DEFAULT_DIRECTOR_CONFIG.mode
			: parseDirector(director);
	const directorIntensity =
		intensity === undefined ? null : parseIntensity(intensity);
	if (profile === "naive" && director !== undefined && directorMode !== "off") {
		throw new Error(`朴素模式没有导演，--director 只能是 off；${USAGE}`);
	}
	if (profile === "naive" && directorIntensity !== null) {
		throw new Error(`朴素模式没有导演，不要传 --intensity；${USAGE}`);
	}
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
		directorMode,
		directorIntensity,
		turnMode: turnModeValue === undefined ? null : parseTurnMode(turnModeValue),
		profile,
		persona:
			personaValue === undefined
				? null
				: requireText(personaValue, "--persona"),
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

function parseDirector(value: string): DirectorMode {
	if (!isDirectorMode(value)) {
		throw new Error(
			`--director 只接受 off、transparent 或 blind，收到 ${value}；${USAGE}`,
		);
	}
	return value;
}

function parseIntensity(value: string): DirectorIntensity {
	if (!isDirectorIntensity(value)) {
		throw new Error(
			`--intensity 只接受 setup、natural 或 detonate，收到 ${value}；${USAGE}`,
		);
	}
	return value;
}

function parseTurnMode(value: string): TurnMode {
	if (!isTurnMode(value)) {
		throw new Error(`--mode 只接受 fast 或 deep，收到 ${value}；${USAGE}`);
	}
	return value;
}

function parseProfile(value: string): ChatProfile {
	if (!isChatProfile(value)) {
		throw new Error(
			`--profile 只接受 native 或 naive，收到 ${value}；${USAGE}`,
		);
	}
	return value;
}

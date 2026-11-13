import type { StHelperChatMessages } from "./messages.js";
import type { StHelperVariableBank } from "./variables.js";

/**
 * 酒馆助手脚本常用的 STscript 子集。命令只通过宿主 API 读写变量、消息与
 * 楼层，不解析宏、不执行闭包；未列出的命令直接抛错并指出命令名。
 *
 * 管道：每个命令的返回值成为下一个命令的未命名参数（下一个命令自己
 * 没有写未命名参数时）。引号：双引号包住的文本保留空格与 `|`，`\` 转义
 * 下一个字符。
 */

export const ST_HELPER_SLASH_COMMANDS = [
	"setvar",
	"getvar",
	"addvar",
	"incvar",
	"decvar",
	"flushvar",
	"setglobalvar",
	"getglobalvar",
	"addglobalvar",
	"incglobalvar",
	"decglobalvar",
	"flushglobalvar",
	"pass",
	"echo",
	"messages",
	"addswipe",
	"swipe",
	"hide",
	"unhide",
	"gen",
	"genraw",
	"genresult",
] as const;

export type StHelperSlashCommand = (typeof ST_HELPER_SLASH_COMMANDS)[number];

export type StHelperSlashVariableScope = "chat" | "global";

export interface StHelperSlashGenerationRequest {
	readonly command: "gen" | "genraw";
	readonly prompt: string;
	readonly system: string | null;
	readonly maxTokens: number | null;
}

/** 安静生成的登记者；返回后台请求 id，不返回正文。 */
export type StHelperSlashGenerator = (
	request: StHelperSlashGenerationRequest,
) => string | Promise<string>;

/** 读取已登记请求的正文；未完成时是空串。 */
export interface StHelperSlashGenerationReader {
	read(id: string): string;
}

export interface StHelperSlashRunnerOptions {
	readonly variables: StHelperVariableBank;
	readonly messages: StHelperChatMessages;
	readonly generate?: StHelperSlashGenerator;
	readonly generationResults?: StHelperSlashGenerationReader;
}

const COMMANDS: ReadonlySet<string> = new Set(ST_HELPER_SLASH_COMMANDS);

const ALIASES: Readonly<Record<string, StHelperSlashCommand>> = {
	setchatvar: "setvar",
	getchatvar: "getvar",
	addchatvar: "addvar",
	incchatvar: "incvar",
	decchatvar: "decvar",
	flushchatvar: "flushvar",
	message: "messages",
	swipeadd: "addswipe",
	return: "pass",
};

const NAMED_ARGUMENTS: Readonly<
	Record<StHelperSlashCommand, readonly string[]>
> = {
	setvar: ["key"],
	getvar: ["key"],
	addvar: ["key"],
	incvar: [],
	decvar: [],
	flushvar: [],
	setglobalvar: ["key"],
	getglobalvar: ["key"],
	addglobalvar: ["key"],
	incglobalvar: [],
	decglobalvar: [],
	flushglobalvar: [],
	pass: [],
	echo: [],
	messages: ["names", "hidden", "role"],
	addswipe: ["switch"],
	swipe: ["direction"],
	hide: [],
	unhide: [],
	gen: ["length"],
	genraw: ["length", "system"],
	genresult: [],
};

const DIRECTION_RIGHT = "right";
const DIRECTION_LEFT = "left";

interface SlashStage {
	readonly command: string;
	readonly named: Readonly<Record<string, string>>;
	readonly unnamed: readonly string[];
}

/**
 * 执行一段 STscript，返回最后一个命令的结果字符串。安静生成只登记后台
 * 请求并返回请求 id；正文用 `genresult` 在之后读取。
 */
export class StHelperSlashRunner {
	readonly #variables: StHelperVariableBank;
	readonly #messages: StHelperChatMessages;
	readonly #generate: StHelperSlashGenerator | null;
	readonly #generationResults: StHelperSlashGenerationReader | null;

	constructor(options: StHelperSlashRunnerOptions) {
		this.#variables = options.variables;
		this.#messages = options.messages;
		this.#generate = options.generate ?? null;
		this.#generationResults = options.generationResults ?? null;
	}

	get commands(): readonly StHelperSlashCommand[] {
		return ST_HELPER_SLASH_COMMANDS;
	}

	async run(script: string): Promise<string> {
		if (typeof script !== "string" || script.trim().length === 0) {
			throw new Error("triggerSlash 需要非空的 STscript");
		}
		const stages = splitStages(script).map((stage) => parseStage(stage));
		let pipe = "";
		for (const stage of stages) {
			pipe = await this.#execute(stage, pipe);
		}
		return pipe;
	}

	#execute(stage: SlashStage, pipe: string): Promise<string> | string {
		const command = resolveCommand(stage.command);
		assertNamedArguments(command, stage.named);
		const value = stage.unnamed.join(" ");
		const argument = value.length > 0 ? value : pipe;
		switch (command) {
			case "setvar":
				return this.#setVariable(stage, argument, "chat");
			case "getvar":
				return this.#getVariable(stage, argument, "chat");
			case "addvar":
				return this.#addVariable(stage.named.key, argument, "chat");
			case "incvar":
				return this.#addVariable(argument, "1", "chat");
			case "decvar":
				return this.#addVariable(argument, "-1", "chat");
			case "flushvar":
				return this.#flushVariable(argument, "chat");
			case "setglobalvar":
				return this.#setVariable(stage, argument, "global");
			case "getglobalvar":
				return this.#getVariable(stage, argument, "global");
			case "addglobalvar":
				return this.#addVariable(stage.named.key, argument, "global");
			case "incglobalvar":
				return this.#addVariable(argument, "1", "global");
			case "decglobalvar":
				return this.#addVariable(argument, "-1", "global");
			case "flushglobalvar":
				return this.#flushVariable(argument, "global");
			case "pass":
			case "echo":
				return argument;
			case "messages":
				return this.#readMessages(stage, argument);
			case "addswipe":
				return this.#addSwipe(stage, argument);
			case "swipe":
				return this.#swipe(stage);
			case "hide":
				return this.#hide(argument, true);
			case "unhide":
				return this.#hide(argument, false);
			case "gen":
				return this.#generateText(stage, argument, "gen");
			case "genraw":
				return this.#generateText(stage, argument, "genraw");
			case "genresult":
				return this.#generationResult(argument);
		}
	}

	#setVariable(
		stage: SlashStage,
		value: string,
		scope: StHelperSlashVariableScope,
	): string {
		const key = requireKey(stage, "key");
		if (value.length === 0) {
			throw new Error(`STscript 命令 ${stage.command} 需要变量值`);
		}
		this.#variables.insertOrAssignVariable(key, value, { type: scope });
		return value;
	}

	#getVariable(
		stage: SlashStage,
		argument: string,
		scope: StHelperSlashVariableScope,
	): string {
		const key = stage.named.key ?? argument;
		if (key.length === 0) {
			throw new Error(`STscript 命令 ${stage.command} 需要变量名`);
		}
		return formatVariable(this.#variables.getVariable(key, { type: scope }));
	}

	#addVariable(
		key: string | undefined,
		value: string,
		scope: StHelperSlashVariableScope,
	): string {
		if (key === undefined || key.length === 0) {
			throw new Error("STscript 变量命令需要变量名");
		}
		const current = this.#variables.getVariable(key, { type: scope });
		const added = parseScalar(value);
		let next: unknown;
		if (Array.isArray(current)) {
			next = [...current, added];
		} else {
			const increment = Number(added);
			const base = Number(current ?? 0);
			next =
				Number.isNaN(increment) || Number.isNaN(base)
					? `${formatVariable(current)}${value}`
					: base + increment;
		}
		this.#variables.insertOrAssignVariable(key, next, { type: scope });
		return formatVariable(next);
	}

	#flushVariable(key: string, scope: StHelperSlashVariableScope): string {
		if (key.length === 0) {
			throw new Error("STscript 命令 flushvar 需要变量名");
		}
		this.#variables.deleteVariable(key, { type: scope });
		return "";
	}

	#readMessages(stage: SlashStage, argument: string): string {
		const range = parseMessageRange(argument);
		const includeNames = readBoolean(stage.named.names, true, "names");
		const includeHidden = readBoolean(stage.named.hidden, false, "hidden");
		const role = stage.named.role;
		if (
			role !== undefined &&
			role !== "system" &&
			role !== "user" &&
			role !== "assistant"
		) {
			throw new Error(`STscript 命令 messages 的 role 非法：${role}`);
		}
		const messages = this.#messages.getChatMessages(range, {
			...(role === undefined ? {} : { role }),
			hide_state: includeHidden ? "all" : "unhidden",
		});
		return messages
			.map((message) =>
				includeNames ? `${message.name}: ${message.message}` : message.message,
			)
			.join("\n");
	}

	#addSwipe(stage: SlashStage, text: string): string {
		if (text.length === 0) {
			throw new Error("STscript 命令 addswipe 需要新 swipe 的正文");
		}
		const switchTo = readBoolean(stage.named.switch, false, "switch");
		const swipeId = this.#messages.addSwipe(text, { switchTo });
		return String(swipeId);
	}

	#swipe(stage: SlashStage): string {
		const direction = stage.named.direction ?? DIRECTION_RIGHT;
		if (direction !== DIRECTION_RIGHT && direction !== DIRECTION_LEFT) {
			throw new Error(`STscript 命令 swipe 的 direction 非法：${direction}`);
		}
		this.#messages.switchSwipe(direction);
		return "";
	}

	#hide(argument: string, hidden: boolean): string {
		const range =
			argument.length === 0 ? "latest" : parseMessageRange(argument);
		const messages = this.#messages.getChatMessages(range);
		if (messages.length === 0) return "";
		this.#messages.setChatMessages(
			messages.map((message) => ({
				message_id: message.message_id,
				is_hidden: hidden,
			})),
			{ refresh: "none" },
		);
		return "";
	}

	async #generateText(
		stage: SlashStage,
		prompt: string,
		command: "gen" | "genraw",
	): Promise<string> {
		if (prompt.length === 0) {
			throw new Error(`STscript 命令 ${command} 需要提示词`);
		}
		if (this.#generate === null) {
			throw new Error(
				`STscript 命令 ${command} 需要宿主接入安静生成，当前没有执行者`,
			);
		}
		const length = stage.named.length;
		let maxTokens: number | null = null;
		if (length !== undefined) {
			const parsed = Number(length);
			if (!Number.isInteger(parsed) || parsed <= 0) {
				throw new Error(`STscript 命令 ${command} 的 length 必须是正整数`);
			}
			maxTokens = parsed;
		}
		return this.#generate({
			command,
			prompt,
			system: stage.named.system ?? null,
			maxTokens,
		});
	}

	#generationResult(argument: string): string {
		if (this.#generationResults === null) {
			throw new Error(
				"STscript 命令 genresult 需要宿主接入安静生成队列，当前没有结果存储",
			);
		}
		const id = argument.trim();
		if (id.length === 0) {
			throw new Error("STscript 命令 genresult 需要生成请求 id");
		}
		return this.#generationResults.read(id);
	}
}

function resolveCommand(name: string): StHelperSlashCommand {
	const normalized = name.toLowerCase();
	const command = COMMANDS.has(normalized) ? normalized : ALIASES[normalized];
	if (command === undefined) {
		throw new Error(`STscript 命令 ${name} 未实现`);
	}
	return command as StHelperSlashCommand;
}

function assertNamedArguments(
	command: StHelperSlashCommand,
	named: Readonly<Record<string, string>>,
): void {
	const allowed = new Set(NAMED_ARGUMENTS[command]);
	for (const key of Object.keys(named)) {
		if (!allowed.has(key)) {
			throw new Error(`STscript 命令 ${command} 不支持参数 ${key}`);
		}
	}
}

function requireKey(stage: SlashStage, key: string): string {
	const value = stage.named[key];
	if (value === undefined || value.length === 0) {
		throw new Error(`STscript 命令 ${stage.command} 需要参数 ${key}`);
	}
	return value;
}

function readBoolean(
	value: string | undefined,
	fallback: boolean,
	label: string,
): boolean {
	if (value === undefined) return fallback;
	if (value === "on" || value === "true" || value === "1") return true;
	if (value === "off" || value === "false" || value === "0") return false;
	throw new Error(`STscript 参数 ${label} 只能是 on/off、true/false 或 1/0`);
}

function formatVariable(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 && !Number.isNaN(Number(trimmed))
			? String(Number(trimmed))
			: value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

function parseScalar(text: string): unknown {
	if (text === "true") return true;
	if (text === "false") return false;
	if (text.length > 0 && !Number.isNaN(Number(text))) return Number(text);
	return text;
}

/** 消息范围：单个下标、`起-止` 与 `latest`；负数从末尾数。 */
function parseMessageRange(text: string): {
	readonly start: number;
	readonly end: number;
} {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		throw new Error("STscript 命令 messages 需要消息范围");
	}
	if (trimmed === "latest") return { start: -1, end: -1 };
	const match = /^(-?\d+)(?:-(-?\d+))?$/.exec(trimmed);
	if (match === null) {
		throw new Error(`STscript 的消息范围非法：${text}`);
	}
	const start = Number(match[1]);
	const end = match[2] === undefined ? start : Number(match[2]);
	return { start, end };
}

/** 按未转义、且不在引号里的 `|` 分段。 */
function splitStages(script: string): string[] {
	const stages: string[] = [];
	let current = "";
	let quoted = false;
	for (let index = 0; index < script.length; index += 1) {
		const char = script[index];
		if (char === "\\") {
			const next = script[index + 1];
			if (next === undefined) {
				throw new Error("STscript 结尾有未完成的转义");
			}
			current += next;
			index += 1;
			continue;
		}
		if (char === '"') {
			quoted = !quoted;
			current += char;
			continue;
		}
		if (char === "|" && !quoted) {
			stages.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (quoted) throw new Error("STscript 的引号没有闭合");
	stages.push(current);
	if (stages.every((stage) => stage.trim().length === 0)) {
		throw new Error("STscript 没有任何命令");
	}
	return stages;
}

function parseStage(text: string): SlashStage {
	const tokens = tokenize(text);
	const commandToken = tokens.shift();
	if (commandToken === undefined) {
		throw new Error("STscript 的分段是空的");
	}
	const match = /^\/([A-Za-z][\w-]*)$/.exec(commandToken);
	if (match === null) {
		throw new Error(`STscript 命令必须以 / 开头：${commandToken}`);
	}
	const named: Record<string, string> = {};
	const unnamed: string[] = [];
	for (const token of tokens) {
		const argument = /^([A-Za-z_][\w-]*)=([\s\S]*)$/.exec(token);
		if (argument === null) {
			unnamed.push(token);
			continue;
		}
		const key = argument[1];
		if (Object.hasOwn(named, key)) {
			throw new Error(`STscript 命令 ${match[1]} 的参数 ${key} 重复`);
		}
		named[key] = argument[2];
	}
	return { command: match[1], named, unnamed };
}

function tokenize(text: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quoted = false;
	let started = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === "\\") {
			const next = text[index + 1];
			if (next === undefined) {
				throw new Error("STscript 结尾有未完成的转义");
			}
			current += next;
			started = true;
			index += 1;
			continue;
		}
		if (char === '"') {
			quoted = !quoted;
			started = true;
			continue;
		}
		if (!quoted && /\s/.test(char)) {
			if (started) {
				tokens.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		current += char;
		started = true;
	}
	if (quoted) throw new Error("STscript 的引号没有闭合");
	if (started) tokens.push(current);
	return tokens;
}

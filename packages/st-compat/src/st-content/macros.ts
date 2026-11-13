import droll from "droll";
import moment from "moment";
import seedrandom from "seedrandom";

/** 宏替换的附加选项。`postProcess` 与酒馆的 `postProcessFn` 同义。 */
export interface StMacroSubstituteOptions {
	readonly postProcess?: (value: string) => string;
	/** 正则的 `trimStrings` 用当前说话的角色覆盖 `{{char}}`。 */
	readonly charOverride?: string;
}

export type StMacroSubstitute = (
	text: string,
	options?: StMacroSubstituteOptions,
) => string;

/**
 * 酒馆的变量存储。局部变量属于当前对话，全局变量跨对话；
 * 值可能是数字，因为 `{{incvar}}` 一类的宏会写回计算结果。
 */
export interface StMacroVariables {
	readonly local: Record<string, string | number>;
	readonly global: Record<string, string | number>;
}

export interface StMacroChatMessage {
	readonly text: string;
	readonly isUser: boolean;
	readonly isSystem?: boolean;
	readonly sendDate?: string | number | Date | null;
	readonly swipes?: readonly string[];
	readonly swipeId?: number | null;
}

/** 角色卡字段，键名与酒馆的宏名一致。调用方负责准备好示例对话的文本。 */
export interface StMacroCardFields {
	readonly charPrompt?: string;
	readonly charInstruction?: string;
	readonly charJailbreak?: string;
	readonly description?: string;
	readonly personality?: string;
	readonly scenario?: string;
	readonly persona?: string;
	readonly mesExamples?: string;
	readonly mesExamplesRaw?: string;
	readonly charVersion?: string;
	readonly charDepthPrompt?: string;
	readonly creatorNotes?: string;
}

export interface StMacroOptions {
	readonly user?: string;
	readonly char?: string;
	readonly group?: string;
	readonly groupNotMuted?: string;
	readonly notChar?: string;
	readonly model?: string;
	/** `{{original}}` 只在一次替换里出现一次，与酒馆一致。 */
	readonly original?: string;
	readonly input?: string;
	readonly card?: StMacroCardFields;
	/** 正序的对话楼层。 */
	readonly messages?: readonly StMacroChatMessage[];
	readonly chatId?: string | null;
	readonly outlets?: Readonly<Record<string, string>>;
	readonly maxPrompt?: number;
	readonly maxContext?: number;
	readonly maxResponse?: number;
	readonly firstIncludedMessageId?: number | null;
	readonly firstDisplayedMessageId?: number | null;
	readonly variables?: StMacroVariables;
	readonly now?: () => Date;
	readonly random?: () => number;
	/** 扩展注册的宏；按插入顺序在环境宏之后求值。 */
	readonly extra?: Readonly<Record<string, string | (() => string)>>;
}

export interface StMacroEngine {
	readonly variables: StMacroVariables;
	readonly substitute: StMacroSubstitute;
	/** 列出文本里剩余的宏名（不含花括号），用于检查替换后的残留。 */
	unresolved(text: string): readonly string[];
}

interface MacroEvaluation {
	readonly post: (value: string) => string;
	readonly variables: StMacroVariables;
	readonly env: ReadonlyMap<string, () => string>;
	readonly rawContent: string;
	readonly messages: readonly StMacroChatMessage[];
	readonly nowDate: Date;
	readonly random: () => number;
	readonly chatIdHash: number;
	readonly outlets: Readonly<Record<string, string>>;
	readonly input: string;
	readonly maxPrompt?: number;
	readonly maxContext?: number;
	readonly maxResponse?: number;
	readonly firstIncludedMessageId: string;
	readonly firstDisplayedMessageId: string;
}

interface MacroRule {
	/** `<USER>` 这类不带花括号的旧式宏。 */
	readonly legacy?: boolean;
	apply(text: string, context: MacroEvaluation): string;
}

const COMMA_PLACEHOLDER = "##\uFFFDCOMMA\uFFFD##";

function escapeRegex(value: string): string {
	return value.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");
}

function sanitizeMacroValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === null || value === undefined) return "";
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "function") return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** 酒馆的 `getStringHash`：53 位字符串哈希，`{{pick}}` 的稳定种子依赖它。 */
export function stStringHash(value: string, seed = 0): number {
	if (typeof value !== "string") return 0;
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function readVariable(
	variables: Readonly<Record<string, string | number>>,
	name: string,
): string {
	const value = variables[name];
	if (value === undefined) return "";
	const text = String(value);
	return text.trim() === "" || Number.isNaN(Number(text))
		? text
		: String(Number(text));
}

function addVariable(
	variables: Record<string, string | number>,
	name: string,
	value: string,
): string {
	const current = readVariable(variables, name);
	try {
		const parsed: unknown = JSON.parse(String(variables[name] ?? "null"));
		if (Array.isArray(parsed)) {
			parsed.push(value);
			variables[name] = JSON.stringify(parsed);
			return JSON.stringify(parsed);
		}
	} catch {
		// 非 JSON 值按数字或字符串拼接处理
	}
	const increment = Number(value);
	if (Number.isNaN(increment) || Number.isNaN(Number(current))) {
		const text = String(current || "") + value;
		variables[name] = text;
		return text;
	}
	const next = Number(current) + increment;
	variables[name] = next;
	return String(next);
}

function splitChoiceList(listString: string): string[] {
	return listString.includes("::")
		? listString.split("::")
		: listString
				.replace(/\\,/g, COMMA_PLACEHOLDER)
				.split(",")
				.map((item) =>
					item.trim().replace(new RegExp(COMMA_PLACEHOLDER, "g"), ","),
				);
}

function rollDice(formula: string): string {
	const trimmed = formula.trim();
	const normalized = /^\d+$/.test(trimmed) ? `1d${trimmed}` : trimmed;
	if (!droll.validate(normalized)) return "";
	const result = droll.roll(normalized);
	if (result === false) return "";
	return String(result.total);
}

function lastMessageIndex(
	messages: readonly StMacroChatMessage[],
	options: {
		readonly excludeSwiping?: boolean;
		readonly filter?: (message: StMacroChatMessage) => boolean;
	} = {},
): number | null {
	const excludeSwiping = options.excludeSwiping ?? true;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message === undefined) continue;
		if (
			excludeSwiping &&
			message.swipes !== undefined &&
			(message.swipeId ?? 0) >= message.swipes.length
		) {
			continue;
		}
		if (options.filter !== undefined && !options.filter(message)) continue;
		return index;
	}
	return null;
}

function idleDuration(
	messages: readonly StMacroChatMessage[],
	now: moment.Moment,
): string {
	let target: StMacroChatMessage | undefined;
	let takeNext = false;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message === undefined) continue;
		if (message.isSystem === true) continue;
		if (message.isUser && takeNext) {
			target = message;
			break;
		}
		takeNext = true;
	}
	if (target?.sendDate === undefined || target.sendDate === null) {
		return "just now";
	}
	const sent = moment(target.sendDate);
	if (!sent.isValid()) return "just now";
	return moment.duration(now.diff(sent)).humanize();
}

const PRE_ENV_RULES: readonly MacroRule[] = [
	{
		legacy: true,
		apply: (text, context) =>
			text.replace(/<USER>/gi, () =>
				context.post(context.env.get("user")?.() ?? ""),
			),
	},
	{
		legacy: true,
		apply: (text, context) =>
			text.replace(/<BOT>/gi, () =>
				context.post(context.env.get("char")?.() ?? ""),
			),
	},
	{
		legacy: true,
		apply: (text, context) =>
			text.replace(/<CHAR>/gi, () =>
				context.post(context.env.get("char")?.() ?? ""),
			),
	},
	{
		legacy: true,
		apply: (text, context) =>
			text.replace(/<CHARIFNOTGROUP>/gi, () =>
				context.post(context.env.get("charIfNotGroup")?.() ?? ""),
			),
	},
	{
		legacy: true,
		apply: (text, context) =>
			text.replace(/<GROUP>/gi, () =>
				context.post(context.env.get("group")?.() ?? ""),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{roll[ : ]([^}]+)}}/gi, (_match: string, raw: string) =>
				context.post(rollDice(raw)),
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{setvar::([^:]+)::([^}]*)}}/gi,
				(_match: string, rawName: string, value: string) => {
					context.variables.local[rawName.trim()] = value;
					return context.post("");
				},
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{addvar::([^:]+)::([^}]+)}}/gi,
				(_match: string, rawName: string, value: string) =>
					context.post(
						addVariable(context.variables.local, rawName.trim(), value),
					),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{incvar::([^}]+)}}/gi, (_match: string, rawName: string) =>
				context.post(addVariable(context.variables.local, rawName.trim(), "1")),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{decvar::([^}]+)}}/gi, (_match: string, rawName: string) =>
				context.post(
					addVariable(context.variables.local, rawName.trim(), "-1"),
				),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{getvar::([^}]+)}}/gi, (_match: string, rawName: string) =>
				context.post(readVariable(context.variables.local, rawName.trim())),
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{setglobalvar::([^:]+)::([^}]*)}}/gi,
				(_match: string, rawName: string, value: string) => {
					context.variables.global[rawName.trim()] = value;
					return context.post("");
				},
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{addglobalvar::([^:]+)::([^}]+)}}/gi,
				(_match: string, rawName: string, value: string) =>
					context.post(
						addVariable(context.variables.global, rawName.trim(), value),
					),
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{incglobalvar::([^}]+)}}/gi,
				(_match: string, rawName: string) =>
					context.post(
						addVariable(context.variables.global, rawName.trim(), "1"),
					),
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{decglobalvar::([^}]+)}}/gi,
				(_match: string, rawName: string) =>
					context.post(
						addVariable(context.variables.global, rawName.trim(), "-1"),
					),
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{getglobalvar::([^}]+)}}/gi,
				(_match: string, rawName: string) =>
					context.post(readVariable(context.variables.global, rawName.trim())),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{newline}}/gi, () => context.post("\n")),
	},
	{
		apply: (text, context) =>
			text.replace(/(?:\r?\n)*{{trim}}(?:\r?\n)*/gi, () => context.post("")),
	},
	{
		apply: (text, context) =>
			text.replace(/{{noop}}/gi, () => context.post("")),
	},
	{
		apply: (text, context) =>
			text.replace(/{{input}}/gi, () => context.post(context.input)),
	},
];

const POST_ENV_RULES: readonly MacroRule[] = [
	{
		apply: (text, context) =>
			text.replace(/{{maxPrompt}}/gi, () =>
				context.post(optionalNumber(context.maxPrompt)),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{maxPromptTokens}}/gi, () =>
				context.post(optionalNumber(context.maxPrompt)),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{maxContext}}/gi, () =>
				context.post(optionalNumber(context.maxContext)),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{maxContextTokens}}/gi, () =>
				context.post(optionalNumber(context.maxContext)),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{maxResponse}}/gi, () =>
				context.post(optionalNumber(context.maxResponse)),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{maxResponseTokens}}/gi, () =>
				context.post(optionalNumber(context.maxResponse)),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{lastMessage}}/gi, () => {
				const index = lastMessageIndex(context.messages);
				return context.post(
					index === null ? "" : (context.messages[index]?.text ?? ""),
				);
			}),
	},
	{
		apply: (text, context) =>
			text.replace(/{{lastMessageId}}/gi, () => {
				const index = lastMessageIndex(context.messages);
				return context.post(index === null ? "" : String(index));
			}),
	},
	{
		apply: (text, context) =>
			text.replace(/{{lastUserMessage}}/gi, () => {
				const index = lastMessageIndex(context.messages, {
					filter: (message) => message.isUser && message.isSystem !== true,
				});
				return context.post(
					index === null ? "" : (context.messages[index]?.text ?? ""),
				);
			}),
	},
	{
		apply: (text, context) =>
			text.replace(/{{lastCharMessage}}/gi, () => {
				const index = lastMessageIndex(context.messages, {
					filter: (message) => !message.isUser && message.isSystem !== true,
				});
				return context.post(
					index === null ? "" : (context.messages[index]?.text ?? ""),
				);
			}),
	},
	{
		apply: (text, context) =>
			text.replace(/{{firstIncludedMessageId}}/gi, () =>
				context.post(context.firstIncludedMessageId),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{firstDisplayedMessageId}}/gi, () =>
				context.post(context.firstDisplayedMessageId),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{lastSwipeId}}/gi, () => {
				const index = lastMessageIndex(context.messages, {
					excludeSwiping: false,
				});
				const swipes =
					index === null ? undefined : context.messages[index]?.swipes;
				return context.post(swipes === undefined ? "" : String(swipes.length));
			}),
	},
	{
		apply: (text, context) =>
			text.replace(/{{currentSwipeId}}/gi, () => {
				const index = lastMessageIndex(context.messages, {
					excludeSwiping: false,
				});
				const swipeId =
					index === null ? undefined : context.messages[index]?.swipeId;
				return context.post(
					swipeId === undefined || swipeId === null ? "" : String(swipeId + 1),
				);
			}),
	},
	{
		apply: (text, context) =>
			text.replace(/{{allChatRange}}/gi, () =>
				context.post(
					context.messages.length === 0
						? ""
						: `0-${context.messages.length - 1}`,
				),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{reverse:(.+?)}}/gi, (_match: string, value: string) =>
				context.post(Array.from(value).reverse().join("")),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/\{\{\/\/([\s\S]*?)\}\}/gm, () => context.post("")),
	},
	{
		apply: (text, context) =>
			text.replace(/{{time}}/gi, () =>
				context.post(moment(context.nowDate).format("LT")),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{date}}/gi, () =>
				context.post(moment(context.nowDate).format("LL")),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{weekday}}/gi, () =>
				context.post(moment(context.nowDate).format("dddd")),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{isotime}}/gi, () =>
				context.post(moment(context.nowDate).format("HH:mm")),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{isodate}}/gi, () =>
				context.post(moment(context.nowDate).format("YYYY-MM-DD")),
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{datetimeformat +([^}]*)}}/gi,
				(_match: string, format: string) =>
					context.post(moment(context.nowDate).format(format)),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{idle_duration}}/gi, () =>
				context.post(idleDuration(context.messages, moment(context.nowDate))),
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{time_UTC([-+]\d+)}}/gi,
				(_match: string, offset: string) =>
					context.post(
						moment(context.nowDate)
							.utc()
							.utcOffset(Number.parseInt(offset, 10))
							.format("LT"),
					),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{outlet::(.+?)}}/gi, (_match: string, rawKey: string) =>
				context.post(context.outlets[rawKey.trim()] ?? ""),
			),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{timeDiff::(.*?)::(.*?)}}/gi,
				(_match: string, left: string, right: string) =>
					context.post(
						moment.duration(moment(left).diff(moment(right))).humanize(true),
					),
			),
	},
	{
		apply: (text, context) =>
			text.replace(/{{banned "(.*)"}}/gi, () => context.post("")),
	},
	{
		apply: (text, context) =>
			text.replace(
				/{{random\s?::?([^}]+)}}/gi,
				(_match: string, list: string) => {
					const items = splitChoiceList(list);
					if (items.length === 0) return context.post("");
					const index = Math.floor(context.random() * items.length);
					return context.post(items[index] ?? "");
				},
			),
	},
	{
		apply: (text, context) => {
			const rawContentHash = stStringHash(context.rawContent);
			return text.replace(
				/{{pick\s?::?([^}]+)}}/gi,
				(_match: string, list: string, offset: string) => {
					const items = splitChoiceList(list);
					if (items.length === 0) return context.post("");
					const seed = stStringHash(
						`${context.chatIdHash}-${rawContentHash}-${offset}`,
					);
					const rng = seedrandom(String(seed));
					const index = Math.floor(rng() * items.length);
					return context.post(items[index] ?? "");
				},
			);
		},
	},
];

function optionalNumber(value: number | undefined): string {
	return value === undefined ? "" : String(value);
}

export function createStMacroEngine(
	options: StMacroOptions = {},
): StMacroEngine {
	const variables = options.variables ?? { local: {}, global: {} };
	const messages = options.messages ?? [];
	const card = options.card ?? {};
	const outlets = options.outlets ?? {};
	const now = options.now ?? (() => new Date());
	const random = options.random ?? Math.random;
	const chatIdHash = stStringHash(options.chatId ?? "");

	function buildEnvironment(
		charOverride: string | undefined,
	): Map<string, () => string> {
		const env = new Map<string, () => string>();
		if (options.original !== undefined) {
			const original = options.original;
			let used = false;
			env.set("original", () => {
				if (used) return "";
				used = true;
				return original;
			});
		}
		setIfDefined(env, "charPrompt", card.charPrompt);
		setIfDefined(
			env,
			"charInstruction",
			card.charInstruction ?? card.charJailbreak,
		);
		setIfDefined(
			env,
			"charJailbreak",
			card.charJailbreak ?? card.charInstruction,
		);
		setIfDefined(env, "description", card.description);
		setIfDefined(env, "personality", card.personality);
		setIfDefined(env, "scenario", card.scenario);
		setIfDefined(env, "persona", card.persona);
		setIfDefined(env, "mesExamples", card.mesExamples);
		setIfDefined(env, "mesExamplesRaw", card.mesExamplesRaw);
		setIfDefined(env, "charVersion", card.charVersion);
		setIfDefined(env, "char_version", card.charVersion);
		setIfDefined(env, "charDepthPrompt", card.charDepthPrompt);
		setIfDefined(env, "creatorNotes", card.creatorNotes);
		const char = charOverride ?? options.char ?? "";
		const group = options.group ?? char;
		env.set("user", () => options.user ?? "");
		env.set("char", () => char);
		env.set("group", () => group);
		env.set("charIfNotGroup", () => group);
		env.set("groupNotMuted", () => options.groupNotMuted ?? group);
		env.set("notChar", () => options.notChar ?? options.user ?? "");
		env.set("model", () => options.model ?? "");
		for (const [name, value] of Object.entries(options.extra ?? {})) {
			env.set(name, typeof value === "function" ? value : () => value);
		}
		return env;
	}

	function buildEnvironmentRules(
		env: ReadonlyMap<string, () => string>,
	): MacroRule[] {
		return [...env.keys()].map((name) => {
			const pattern = new RegExp(`{{${escapeRegex(name)}}}`, "gi");
			return {
				apply: (text: string, context: MacroEvaluation) =>
					text.replace(pattern, () =>
						context.post(context.env.get(name)?.() ?? ""),
					),
			};
		});
	}

	function substitute(
		text: string,
		substituteOptions: StMacroSubstituteOptions = {},
	): string {
		if (!text) return "";
		const post = substituteOptions.postProcess ?? ((value: string) => value);
		const env = buildEnvironment(substituteOptions.charOverride);
		const context: MacroEvaluation = {
			post,
			variables,
			env,
			rawContent: text,
			messages,
			nowDate: now(),
			random,
			chatIdHash,
			outlets,
			input: options.input ?? "",
			maxPrompt: options.maxPrompt,
			maxContext: options.maxContext,
			maxResponse: options.maxResponse,
			firstIncludedMessageId:
				options.firstIncludedMessageId === undefined ||
				options.firstIncludedMessageId === null
					? ""
					: String(options.firstIncludedMessageId),
			firstDisplayedMessageId:
				options.firstDisplayedMessageId === undefined ||
				options.firstDisplayedMessageId === null
					? ""
					: String(options.firstDisplayedMessageId),
		};
		const rules = [
			...PRE_ENV_RULES,
			...buildEnvironmentRules(env),
			...POST_ENV_RULES,
		];
		let content = text;
		for (const rule of rules) {
			if (!content) break;
			if (rule.legacy !== true && !content.includes("{{")) break;
			content = rule.apply(content, context);
		}
		return content;
	}

	return {
		variables,
		substitute,
		unresolved(text: string): readonly string[] {
			const matches = text.match(/\{\{[^{}]*\}\}/g) ?? [];
			return [...new Set(matches.map((match) => match.slice(2, -2)))];
		},
	};
}

function setIfDefined(
	env: Map<string, () => string>,
	name: string,
	value: string | undefined,
): void {
	if (value !== undefined) env.set(name, () => value);
}

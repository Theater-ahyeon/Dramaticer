import type {
	LlmClient,
	LlmMessage,
	LlmUsage,
	StoryStore,
} from "@dramaticer/core";

export const MAX_TURN_JUDGE_ATTEMPTS = 3;
export const DEFAULT_TURN_JUDGE_MAX_TOKENS = 512;
const DEFAULT_CONTEXT_FLOORS = 6;
const MAX_CARD_PROMPT_LENGTH = 1_500;

export interface TurnJudgeVerdict {
	readonly reroll: boolean;
	readonly followed: boolean;
	readonly reason: string;
}

export type TurnJudgeRecord =
	| {
			readonly status: "done";
			readonly reroll: boolean;
			readonly followed: boolean;
			readonly reason: string;
			readonly attempts: number;
			readonly usage: LlmUsage | null;
	  }
	| {
			readonly status: "failed";
			readonly reroll: null;
			readonly followed: null;
			readonly reason: null;
			readonly attempts: number;
			readonly usage: LlmUsage | null;
			readonly error: string;
	  };

export interface PlaytestTurnJudgeInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly round: number;
	/** 玩家本轮的输入；编辑操作之后取编辑后的文本。 */
	readonly userText: string;
	/** 玩家实际看到的助手正文；swipe 与分支之后取最终节点。 */
	readonly assistantText: string;
	/** 最终助手楼层；用来取它之前的上下文。 */
	readonly assistantNodeId: string;
	readonly judge: {
		readonly client: LlmClient;
		readonly model: string;
		readonly maxTokens?: number;
	};
}

/** 严格解析裁判输出：只接受 {reroll: boolean, followed: boolean, reason: string}。 */
export function parseTurnJudgeOutput(text: string): TurnJudgeVerdict | null {
	let value: unknown;
	try {
		value = JSON.parse(text.trim());
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const keys = Object.keys(value).sort();
	if (
		keys.length !== 3 ||
		keys[0] !== "followed" ||
		keys[1] !== "reason" ||
		keys[2] !== "reroll"
	) {
		return null;
	}
	const record = value as {
		reroll?: unknown;
		followed?: unknown;
		reason?: unknown;
	};
	if (typeof record.reroll !== "boolean") return null;
	if (typeof record.followed !== "boolean") return null;
	if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
		return null;
	}
	return {
		reroll: record.reroll,
		followed: record.followed,
		reason: record.reason,
	};
}

const JUDGE_SYSTEM_PROMPT = `你是玩家侧的评审。你会看到角色卡摘要、玩家人设、最近的对话、玩家这一轮的输入与角色的回复。判断两件事：
- reroll：如果你是这位玩家，会不会重 roll 这条回复。重复上一楼、剧情没有推进、没听玩家指令、角色出戏、替玩家做决定、格式崩坏都算会。
- followed：角色的回复是否回应并遵循了玩家这一轮的输入，包括玩家要求的行动、问题与语气；忽略玩家、答非所问或替玩家行动算没有遵循。
只输出一个 JSON 对象，键为 reroll、followed 与 reason，例如 {"reroll":false,"followed":true,"reason":"回复回应了玩家的提问并推进了场景"}。reason 用一句话说明依据。不要输出代码块。`;

function buildJudgeMessages(input: PlaytestTurnJudgeInput): LlmMessage[] {
	const settings = input.store.getStorySettings(input.storyId);
	const characterPrompt = settings.characterPrompt ?? "";
	const shortened =
		characterPrompt.length > MAX_CARD_PROMPT_LENGTH
			? `${characterPrompt.slice(0, MAX_CARD_PROMPT_LENGTH)}……`
			: characterPrompt;
	const path = input.store.getPathToNode(input.assistantNodeId);
	const context = path
		.slice(0, -1)
		.slice(-DEFAULT_CONTEXT_FLOORS)
		.map((node) => `${node.role === "user" ? "玩家" : "角色"}：${node.raw}`);
	const parts = [
		`角色卡名称：${settings.cardName ?? "未命名故事"}`,
		shortened.trim().length === 0 ? null : `角色卡：${shortened}`,
		`玩家人设：${settings.persona ?? "未设置"}`,
		context.length === 0
			? "最近对话：这是故事的开头。"
			: `最近对话：\n${context.join("\n")}`,
		`玩家这一轮的输入：${input.userText}`,
		`角色的回复：${input.assistantText}`,
		"请判断并只输出 JSON。",
	].filter((part): part is string => part !== null);
	return [
		{ role: "system", content: JUDGE_SYSTEM_PROMPT },
		{ role: "user", content: parts.join("\n\n") },
	];
}

/** 让裁判评价一轮回复；调用失败或连续非法输出只记失败，不抛错。 */
export async function judgePlaytestTurn(
	input: PlaytestTurnJudgeInput,
): Promise<TurnJudgeRecord> {
	const baseMessages = buildJudgeMessages(input);
	let usage: LlmUsage | null = null;
	let lastProblem = "";
	for (let attempt = 1; attempt <= MAX_TURN_JUDGE_ATTEMPTS; attempt += 1) {
		const messages: LlmMessage[] =
			attempt === 1
				? baseMessages
				: [
						...baseMessages,
						{
							role: "user",
							content: `上一次输出不是合法的判定 JSON（${lastProblem}）。只输出 {"reroll":true|false,"followed":true|false,"reason":"…"}，不要代码块。`,
						},
					];
		let text: string;
		try {
			const result = await input.judge.client.complete({
				messages,
				model: input.judge.model,
				temperature: 0,
				maxTokens: input.judge.maxTokens ?? DEFAULT_TURN_JUDGE_MAX_TOKENS,
			});
			text = result.text;
			usage = result.usage;
		} catch (error) {
			return {
				status: "failed",
				reroll: null,
				followed: null,
				reason: null,
				attempts: attempt,
				usage,
				error: `裁判调用失败：${error instanceof Error ? error.message : String(error)}`,
			};
		}
		const verdict = parseTurnJudgeOutput(text);
		if (verdict !== null) {
			return {
				status: "done",
				reroll: verdict.reroll,
				followed: verdict.followed,
				reason: verdict.reason,
				attempts: attempt,
				usage,
			};
		}
		lastProblem =
			"缺少 reroll、followed 或 reason，字段类型不对，或包含多余字段";
	}
	return {
		status: "failed",
		reroll: null,
		followed: null,
		reason: null,
		attempts: MAX_TURN_JUDGE_ATTEMPTS,
		usage,
		error: `裁判连续 ${MAX_TURN_JUDGE_ATTEMPTS} 次没有输出合法的 {reroll, followed, reason}`,
	};
}

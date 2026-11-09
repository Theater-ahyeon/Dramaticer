import { type LlmClient, NO_CONTINUATION } from "@dramaticer/core";

/** 模拟用户连续输出非法 JSON 的次数上限；达到后试玩终止。 */
export const MAX_SIMULATED_USER_ATTEMPTS = 3;

const SIMULATED_USER_SYSTEM_PROMPT = `你在模拟一位玩文字角色扮演游戏的玩家。根据最近的对话，写出玩家下一句发言：可以是一个行动、一句对白或一个具体问题，一到三句，用中文。不要替角色写正文，不要解释，不要重复角色已经说过的话，不要让玩家扮演旁白。
只输出一个 JSON 对象，键为 message，值为玩家发言字符串，例如 {"message":"我推开门，问他是谁。"}。不要输出代码块、前后缀或任何别的键。`;

export class SimulatedUserOutputError extends Error {
	readonly attempts: number;

	constructor(attempts: number, reason: string) {
		super(`模拟用户连续 ${attempts} 次没有输出合法的 {message}：${reason}`);
		this.name = "SimulatedUserOutputError";
		this.attempts = attempts;
	}
}

/** 严格校验模拟用户的输出：只接受带单一 message 键的 JSON 对象。 */
export function parseSimulatedUserMessage(text: string): string | null {
	let value: unknown;
	try {
		value = JSON.parse(text.trim());
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 1) return null;
	const message = record.message;
	if (typeof message !== "string") return null;
	const trimmed = message.trim();
	return trimmed.length === 0 ? null : trimmed;
}

export async function generateSimulatedUserMessage(input: {
	readonly client: LlmClient;
	readonly model: string;
	readonly round: number;
	readonly transcript: string;
	readonly maxAttempts?: number;
}): Promise<string> {
	const attempts = input.maxAttempts ?? MAX_SIMULATED_USER_ATTEMPTS;
	if (!Number.isInteger(attempts) || attempts < 1) {
		throw new Error(`模拟用户尝试次数必须是正整数：${attempts}`);
	}
	const baseMessages = [
		{ role: "system" as const, content: SIMULATED_USER_SYSTEM_PROMPT },
		{
			role: "user" as const,
			content: `这是第 ${input.round} 轮。最近的对话如下：\n\n${input.transcript}\n\n写出玩家接下来的一句话。`,
		},
	];
	let lastReason = "没有收到输出";
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const result = await input.client.complete({
			model: input.model,
			messages:
				attempt === 1
					? baseMessages
					: [
							...baseMessages,
							{
								role: "assistant" as const,
								content: `（第 ${attempt - 1} 次尝试的输出无法解析）`,
							},
							{
								role: "user" as const,
								content:
									'上一次的输出不是合法的 JSON。只输出 {"message":"..."} 这个对象，不要代码块。',
							},
						],
			temperature: 0.8,
			// 后台模型带思考，思考 token 与正文共用这个上限；400 会让整次输出只剩思考、正文为空。
			maxTokens: 4096,
		});
		const message = parseSimulatedUserMessage(result.text);
		if (message !== null) return message;
		lastReason =
			result.text.trim().length === 0
				? "输出为空"
				: "输出不是单个 message 键的对象";
	}
	throw new SimulatedUserOutputError(attempts, lastReason);
}

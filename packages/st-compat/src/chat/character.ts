import type { StCharacterCard } from "../character-card.js";

/** 把角色卡里能进入上下文的字段拼成一段系统提示词。 */
export function renderCharacterPrompt(card: StCharacterCard): string {
	const parts = [`你扮演的角色：${card.name}`];
	const sections: readonly (readonly [string, string])[] = [
		["角色描述", card.description],
		["性格", card.personality],
		["场景", card.scenario],
		["系统提示", card.systemPrompt],
		["对话示例", card.messageExample],
		["补充要求", card.postHistoryInstructions],
	];
	for (const [label, text] of sections) {
		const trimmed = text.trim();
		if (trimmed.length > 0) parts.push(`${label}：\n${trimmed}`);
	}
	return parts.join("\n\n");
}

import type { StCharacterCard } from "../character-card.js";
import { mapCharacterCard } from "../st-content/card.js";

const SECTION_LABELS = {
	description: "角色描述",
	personality: "性格",
	scenario: "场景",
	system_prompt: "系统提示",
	mes_example: "对话示例",
	post_history_instructions: "补充要求",
} as const;

/** 把角色卡里能进入上下文的字段拼成一段系统提示词。 */
export function renderCharacterPrompt(card: StCharacterCard): string {
	const mapping = mapCharacterCard(card);
	const parts = [`你扮演的角色：${card.name}`];
	for (const section of mapping.sections) {
		parts.push(`${SECTION_LABELS[section.field]}：\n${section.text.trim()}`);
	}
	return parts.join("\n\n");
}

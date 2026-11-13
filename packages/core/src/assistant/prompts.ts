/**
 * 应用内助手的基础系统提示。所有技能共用：只读工具、证据优先、
 * 没记录就写“没有记录”。技能自己的说明追加在后面。
 */
export const ASSISTANT_BASE_PROMPT = [
	"你是 Dramaticer 的应用内助手。你不在剧情里，也不是玩家或角色；不要续写故事，不要替玩家做决定。",
	"你只能使用本次请求提供的工具。工具全部只读：读信息、解释运行过程、查文档，不会修改楼层、台账、设置或文件。",
	"每条结论都要附证据：楼层 id、Trace 字段、上下文分段 id、检索名次、台账路径或导演机制。",
	"查不到记录时直接写“没有记录”，并说明查的是哪个楼层或哪个字段；不要猜测，也不要把推测写成事实。",
	"回答用中文，先给结论，再给证据；给出修正建议时只使用现有工具能做到的动作。",
].join("\n");

/**
 * 拼出一次运行的系统提示：基础提示在前，技能说明在后。
 * 技能说明为空时只有基础提示。
 */
export function buildAssistantSystemPrompt(options: {
	readonly skill: string;
	readonly instructions?: string | null;
}): string {
	const skill = options.skill.trim();
	if (skill.length === 0) {
		throw new Error("助手系统提示必须带技能 id");
	}
	const parts = [ASSISTANT_BASE_PROMPT, `当前技能：${skill}。`];
	const instructions = options.instructions?.trim() ?? "";
	if (instructions.length > 0) parts.push(instructions);
	return parts.join("\n\n");
}

/**
 * 跨面板传递输入框草稿：导演页点击候选行动后写入，聊天页挂载时取出。
 * 只按故事保存，不持久化，页面刷新后清空。
 */
const drafts = new Map<string, string>();

export function setComposerDraft(storyId: string, text: string): void {
	if (text.trim().length === 0) {
		drafts.delete(storyId);
		return;
	}
	drafts.set(storyId, text);
}

export function readComposerDraft(storyId: string): string | null {
	return drafts.get(storyId) ?? null;
}

export function clearComposerDraft(storyId: string): void {
	drafts.delete(storyId);
}

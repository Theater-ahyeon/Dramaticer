import { useOutletContext } from "react-router-dom";

/** 故事页给聊天页的助手入口；抽屉由故事页持有，切换标签页不会丢失运行状态。 */
export interface StoryAssistantContext {
	readonly openAssistant: () => void;
}

export function useStoryAssistant(): StoryAssistantContext {
	return useOutletContext<StoryAssistantContext>();
}

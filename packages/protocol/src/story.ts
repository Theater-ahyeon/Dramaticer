import type { TimelineNode, TimelineRole } from "@dramaticer/core";

/** 故事列表与详情共用的视图；head 为空表示还没有楼层。 */
export interface StoryView {
	readonly id: string;
	readonly title: string;
	readonly createdAt: string;
	readonly headNodeId: string | null;
}

export interface CreateStoryRequest {
	/** 不提供时由服务端生成。 */
	readonly id?: string;
	readonly title: string;
}

export interface UpdateStoryRequest {
	readonly title?: string;
}

/** head 到根节点的完整路径，按根到 head 的顺序。 */
export interface StoryPath {
	readonly storyId: string;
	readonly headNodeId: string | null;
	readonly nodes: readonly TimelineNode[];
}

/** 楼层树里的一个节点；原文只在路径接口里返回。 */
export interface StoryTreeNode {
	readonly id: string;
	readonly parentId: string | null;
	readonly role: TimelineRole;
	readonly createdAt: string;
	/** 原文开头的一小段，供列表显示。 */
	readonly preview: string;
	/** 子节点 id，按创建时间升序。 */
	readonly childIds: readonly string[];
}

export interface StoryTree {
	readonly storyId: string;
	readonly headNodeId: string | null;
	/** 根楼层 id，按创建时间升序。 */
	readonly roots: readonly string[];
	readonly nodes: readonly StoryTreeNode[];
}

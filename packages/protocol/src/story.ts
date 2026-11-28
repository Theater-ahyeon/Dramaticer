import type {
	BackgroundJobCounts,
	BackgroundJobStatus,
	CardDependencyReport,
	StorySettings,
	TimelineNode,
	TimelineRole,
} from "@dramaticer/core";
import type { NodeImage } from "./images.js";

/** 故事列表与详情共用的视图；head 为空表示还没有楼层。 */
export interface StoryView {
	readonly id: string;
	readonly title: string;
	readonly createdAt: string;
	readonly headNodeId: string | null;
}

/** 后台任务最近一次失败；重试中的任务也会出现在这里。 */
export interface StoryJobErrorView {
	readonly jobId: number;
	readonly nodeId: string | null;
	readonly kind: string;
	readonly status: BackgroundJobStatus;
	readonly attempts: number;
	readonly error: string;
	/** 失败时间；重试中的任务还没有最终失败时间时用开始时间或创建时间。 */
	readonly recordedAt: string;
}

/** `GET /api/stories/:id/jobs` 的响应。 */
export interface StoryJobsView {
	readonly storyId: string;
	readonly counts: BackgroundJobCounts;
	/** 按最近一次错误时间倒序，最多 5 条。 */
	readonly recentErrors: readonly StoryJobErrorView[];
	/**
	 * 实际发出的后台模型调用次数，分三类（v5 §3.2 的预算口径）：计入每楼预算的
	 * （局面更新、场末整理、章末清点、预跑）、一次性的导入任务（开局、导入分型、
	 * 角色外观、原著导入）、玩家开的插图。`floors` 是助手楼层数，用来算每楼平均。
	 * `*Tokens` 是对应调用的 token 合计。
	 */
	readonly calls: {
		readonly perFloor: number;
		readonly oneTime: number;
		readonly images: number;
		readonly floors: number;
		readonly perFloorTokens: number;
		readonly oneTimeTokens: number;
	};
}

export interface CreateStoryRequest {
	/** 不提供时由服务端生成。 */
	readonly id?: string;
	readonly title: string;
}

export interface UpdateStoryRequest {
	readonly title?: string;
}

/** PNG 角色卡：`data` 是不带 data URI 前缀的 base64。 */
export interface PngCharacterCard {
	readonly format: "png";
	readonly data: string;
}

/** JSON 角色卡：`data` 是卡片的 JSON 文本。 */
export interface JsonCharacterCard {
	readonly format: "json";
	readonly data: string;
}

export type ImportCharacterCard = PngCharacterCard | JsonCharacterCard;

export interface ImportStoryRequest {
	readonly card: ImportCharacterCard;
	/** 外部世界书的 JSON 文本，按数组顺序导入。 */
	readonly worlds?: readonly string[];
}

export interface CreateStoryFromCardRequest extends ImportStoryRequest {
	/** 不填或为空时取卡片名称。 */
	readonly title?: string;
}

export interface ImportStoryCounts {
	readonly entities: {
		readonly created: number;
		readonly merged: number;
		readonly aliases: number;
		readonly skipped: number;
	};
	readonly lore: {
		readonly inserted: number;
		readonly existing: number;
		readonly skipped: number;
	};
	readonly events: { readonly inserted: number; readonly updated: number };
	readonly npcAgendas: { readonly inserted: number; readonly updated: number };
	/** 卡片随附的剧情小品；重复导入时整批替换。 */
	readonly bits: { readonly replaced: number };
	/** 卡片声明的检定与资源扣减；重复导入时整批替换。 */
	readonly rules: { readonly replaced: number };
	/** 卡片声明的依赖核对结果；全部满足时 `issues` 为空。 */
	readonly dependencies: CardDependencyReport;
}

export interface ImportStoryResult {
	readonly story: StoryView;
	readonly cardName: string;
	readonly settings: StorySettings;
	readonly imported: ImportStoryCounts;
}

/** 路径上的一个楼层：原文加附属插图；图片不属于原文。 */
export interface StoryPathNode extends TimelineNode {
	readonly images: readonly NodeImage[];
}

/** 锚点楼层到根节点的路径，按根到当前页最后一个节点的顺序。 */
export interface StoryPath {
	readonly storyId: string;
	readonly headNodeId: string | null;
	readonly nodes: readonly StoryPathNode[];
	/** 当前页之外还有更早的楼层可以继续向上加载。 */
	readonly hasMore: boolean;
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

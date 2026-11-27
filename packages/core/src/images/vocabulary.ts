/**
 * 生图词表：分格维度与标签库分类。只含常量与纯类型，
 * 不引用任何 Node 模块，浏览器端可以直接导入。
 */

export const VISUAL_SLOT_PARTS = ["face", "upper", "full"] as const;

export type VisualSlotPart = (typeof VISUAL_SLOT_PARTS)[number];

export const VISUAL_SLOT_VIEWS = ["front", "back"] as const;

export type VisualSlotView = (typeof VISUAL_SLOT_VIEWS)[number];

export const VISUAL_DRESS_STATES = ["clothed", "bare"] as const;

export type VisualDressState = (typeof VISUAL_DRESS_STATES)[number];

export type VisualSlotTags = readonly string[];

export type VisualSlotGrid = Readonly<
	Record<
		VisualSlotPart,
		Readonly<
			Record<VisualSlotView, Readonly<Record<VisualDressState, VisualSlotTags>>>
		>
	>
>;

/** 12 格都为空的分格；校验与导入的默认值。 */
export function emptyVisualSlotGrid(): VisualSlotGrid {
	return {
		face: {
			front: { clothed: [], bare: [] },
			back: { clothed: [], bare: [] },
		},
		upper: {
			front: { clothed: [], bare: [] },
			back: { clothed: [], bare: [] },
		},
		full: {
			front: { clothed: [], bare: [] },
			back: { clothed: [], bare: [] },
		},
	};
}

/** 标签库分类；顺序也是画面整理里的分组顺序。 */
export const TAG_LIBRARY_CATEGORIES = [
	"action",
	"pose",
	"composition",
	"expression",
	"clothing",
	"scene",
	"style",
	"other",
] as const;

export type TagLibraryCategory = (typeof TAG_LIBRARY_CATEGORIES)[number];

export const TAG_LIBRARY_CATEGORY_LABELS: Readonly<
	Record<TagLibraryCategory, string>
> = {
	action: "动作",
	pose: "姿势",
	composition: "构图",
	expression: "表情",
	clothing: "服饰",
	scene: "场景",
	style: "风格",
	other: "其他",
};

export function isTagLibraryCategory(
	value: unknown,
): value is TagLibraryCategory {
	return (
		typeof value === "string" &&
		(TAG_LIBRARY_CATEGORIES as readonly string[]).includes(value)
	);
}

export const TAG_LIBRARY_SCOPES = ["story", "global"] as const;

export type TagLibraryScope = (typeof TAG_LIBRARY_SCOPES)[number];

export function isTagLibraryScope(value: unknown): value is TagLibraryScope {
	return (
		typeof value === "string" &&
		(TAG_LIBRARY_SCOPES as readonly string[]).includes(value)
	);
}

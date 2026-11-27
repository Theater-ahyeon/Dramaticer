import type {
	DirectionEdit,
	DirectionEditResult,
	DirectionView,
} from "@dramaticer/core";

/** `POST /api/stories/:id/direction/edit` 的请求体。 */
export type DirectionEditRequest = DirectionEdit;

/** 写入后重新读出的两栏内容。 */
export type { DirectionEditResult, DirectionView };

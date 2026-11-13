import {
	type JsonObject,
	type MessageModificationResult,
	type PluginDisplayState,
	type StoryStore,
	applyMessageModification,
} from "@dramaticer/core";
import { ST_MVU_PLUGIN_ID } from "./ledger.js";

/** MVU 状态栏在楼层原文里的占位符，界面渲染时替换成状态栏。 */
export const ST_MVU_STATUS_PLACEHOLDER = "<StatusPlaceHolderImpl/>";
/** 状态栏 HTML 在插件显示状态里的键。 */
export const ST_MVU_STATUS_BAR_KEY = "statusBar";

export function hasMvuStatusPlaceholder(raw: string): boolean {
	return raw.includes(ST_MVU_STATUS_PLACEHOLDER);
}

export type MvuMessageChange =
	| { readonly kind: "content"; readonly raw: string }
	| { readonly kind: "statusBar"; readonly html: string }
	| { readonly kind: "metadata"; readonly values: Readonly<JsonObject> };

export interface ApplyMvuMessageChangeInput {
	readonly store: StoryStore;
	readonly displayState: PluginDisplayState;
	readonly nodeId: string;
	readonly change: MvuMessageChange;
}

/**
 * 把 MVU 对消息的修改分成两类执行：正文改写生成新的 swipe，原楼层不变（I4）；
 * 状态栏与消息元数据只写插件显示状态，不新建节点、不写台账。
 *
 * MVU 的变量更新走 `MvuLedgerSession` 与台账；这里的元数据只放显示与模板需要、
 * 不属于台账事实的字段。
 */
export function applyMvuMessageChange(
	input: ApplyMvuMessageChangeInput,
): MessageModificationResult {
	switch (input.change.kind) {
		case "content":
			return applyMessageModification({
				store: input.store,
				displayState: input.displayState,
				plugin: ST_MVU_PLUGIN_ID,
				request: { nodeId: input.nodeId, raw: input.change.raw },
			});
		case "metadata":
			return applyMessageModification({
				store: input.store,
				displayState: input.displayState,
				plugin: ST_MVU_PLUGIN_ID,
				request: { nodeId: input.nodeId, metadata: input.change.values },
			});
		case "statusBar":
			return applyMvuStatusBarRefresh({
				store: input.store,
				displayState: input.displayState,
				nodeId: input.nodeId,
				html: input.change.html,
			});
	}
}

export interface ApplyMvuStatusBarRefreshInput {
	readonly store: StoryStore;
	readonly displayState: PluginDisplayState;
	readonly nodeId: string;
	readonly html: string;
}

/** 刷新状态栏：只更新显示状态，占位符仍留在楼层原文里。 */
export function applyMvuStatusBarRefresh(
	input: ApplyMvuStatusBarRefreshInput,
): MessageModificationResult {
	if (typeof input.html !== "string" || input.html.length === 0) {
		throw new Error("状态栏刷新的 HTML 不能为空");
	}
	const node = input.store.getNode(input.nodeId);
	if (node === null) {
		throw new Error(`状态栏刷新的目标楼层不存在：${input.nodeId}`);
	}
	if (!hasMvuStatusPlaceholder(node.raw)) {
		throw new Error(
			`楼层 ${node.id} 没有 ${ST_MVU_STATUS_PLACEHOLDER}，不能写入状态栏显示状态`,
		);
	}
	return applyMessageModification({
		store: input.store,
		displayState: input.displayState,
		plugin: ST_MVU_PLUGIN_ID,
		request: {
			nodeId: input.nodeId,
			display: { [ST_MVU_STATUS_BAR_KEY]: input.html },
		},
	});
}

/** 读当前显示状态里的状态栏；还没有刷新过时返回 null。 */
export function readMvuStatusBar(
	displayState: PluginDisplayState,
	nodeId: string,
): string | null {
	const value = displayState.getValue(
		nodeId,
		ST_MVU_PLUGIN_ID,
		"display",
		ST_MVU_STATUS_BAR_KEY,
	);
	return typeof value === "string" ? value : null;
}

import type { NodeImage } from "@dramaticer/protocol";
import type { ChatFloor } from "./path-state";

export const NODE_IMAGE_POLL_INTERVAL_MS = 2_000;
export const NODE_IMAGE_POLL_ATTEMPTS = 15;

/** 还没出结果的图片需要继续轮询；失败的行等玩家点重试。 */
export function isImagePending(image: NodeImage): boolean {
	return image.status === "pending" || image.status === "running";
}

/** 当前路径上有未完成图片的楼层 id，按楼层顺序。 */
export function nodesWithPendingImages(
	nodes: readonly ChatFloor[],
): readonly string[] {
	return nodes
		.filter((node) => node.images.some(isImagePending))
		.map((node) => node.id);
}

/**
 * 把一次节点图片查询的结果并入路径。只替换目标楼层，其它楼层的对象保持原样；
 * 服务端已经按 `ordinal` 排序。
 */
export function applyNodeImages(
	nodes: readonly ChatFloor[],
	nodeId: string,
	images: readonly NodeImage[],
): readonly ChatFloor[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.id !== nodeId) return node;
		changed = true;
		return { ...node, images };
	});
	return changed ? next : nodes;
}

/** 还有待完成图片且没到次数上限时继续轮询。 */
export function shouldPollNodeImages(
	attempt: number,
	pendingNodeIds: readonly string[],
): boolean {
	if (pendingNodeIds.length === 0) return false;
	return attempt + 1 < NODE_IMAGE_POLL_ATTEMPTS;
}

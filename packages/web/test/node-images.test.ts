import type { NodeImage } from "@dramaticer/protocol";
import { describe, expect, it } from "vitest";
import {
	NODE_IMAGE_POLL_ATTEMPTS,
	applyNodeImages,
	isImagePending,
	nodesWithPendingImages,
	shouldPollNodeImages,
} from "../src/chat/node-images";
import type { ChatFloor } from "../src/chat/path-state";

function image(
	id: string,
	status: NodeImage["status"],
	overrides: Partial<NodeImage> = {},
): NodeImage {
	return {
		id,
		nodeId: "n1",
		ordinal: 0,
		status,
		url: status === "done" ? `/api/images/${id}/file` : null,
		width: status === "done" ? 512 : null,
		height: status === "done" ? 768 : null,
		error: status === "failed" ? "后端失败" : null,
		...overrides,
	};
}

function floor(id: string, images: readonly NodeImage[] = []): ChatFloor {
	return {
		id,
		storyId: "story",
		parentId: null,
		role: "assistant",
		raw: `楼层 ${id}`,
		createdAt: "2026-01-01T00:00:00.000Z",
		images,
	};
}

describe("楼层图片状态", () => {
	it("只替换目标楼层的图片，其它楼层保持原对象", () => {
		const first = floor("n1", [image("a", "pending")]);
		const second = floor("n2");
		const merged = applyNodeImages([first, second], "n1", [image("a", "done")]);
		expect(merged[0]?.images[0]?.status).toBe("done");
		expect(merged[0]?.images[0]?.url).toBe("/api/images/a/file");
		expect(merged[1]).toBe(second);
	});

	it("目标楼层不存在时原样返回", () => {
		const nodes = [floor("n1")];
		expect(applyNodeImages(nodes, "missing", [])).toBe(nodes);
	});

	it("pending 与 running 需要轮询，done 与 failed 不需要", () => {
		expect(isImagePending(image("a", "pending"))).toBe(true);
		expect(isImagePending(image("a", "running"))).toBe(true);
		expect(isImagePending(image("a", "done"))).toBe(false);
		expect(isImagePending(image("a", "failed"))).toBe(false);
		expect(
			nodesWithPendingImages([
				floor("n1", [image("a", "done")]),
				floor("n2", [image("b", "running")]),
				floor("n3", [image("c", "pending")]),
			]),
		).toEqual(["n2", "n3"]);
	});

	it("没有待完成图片或到达次数上限后停止轮询", () => {
		expect(shouldPollNodeImages(0, [])).toBe(false);
		expect(shouldPollNodeImages(0, ["n1"])).toBe(true);
		expect(shouldPollNodeImages(NODE_IMAGE_POLL_ATTEMPTS - 2, ["n1"])).toBe(
			true,
		);
		expect(shouldPollNodeImages(NODE_IMAGE_POLL_ATTEMPTS - 1, ["n1"])).toBe(
			false,
		);
	});
});

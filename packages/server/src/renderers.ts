// 楼层渲染：把故事上安装的声明式渲染器装进真正的主内核，再按注册顺序认领楼层。
// 渲染只产出显示内容，楼层原文不动（I8）；没有渲染器认领或渲染失败时返回空结果，
// 前端按原生方式显示正文。
import {
	type FloorRenderFailure,
	LiteKernel,
	createDeclarativeFloorRendererPlugin,
	readLedger,
	readStoryFloorRenderers,
} from "@dramaticer/core";
import type { StoryStore } from "@dramaticer/core";
import type {
	FloorRenderFailureView,
	FloorRenderView,
	StoryRenderView,
} from "@dramaticer/protocol";

export async function renderStoryFloors(
	store: StoryStore,
	storyId: string,
	nodeIds: readonly string[],
): Promise<StoryRenderView> {
	const stored = readStoryFloorRenderers(store, storyId);
	if (stored.length === 0) {
		return { storyId, floors: nodeIds.map(emptyFloorView) };
	}
	const kernel = new LiteKernel();
	const loadFailures: FloorRenderFailureView[] = [];
	try {
		for (const entry of stored) {
			const status = await kernel.load(
				createDeclarativeFloorRendererPlugin(entry.definition),
			);
			if (status.state !== "active") {
				loadFailures.push({
					renderer: entry.id,
					error: status.reason ?? "渲染器没有激活",
				});
			}
		}
		const floors: FloorRenderView[] = [];
		for (const nodeId of nodeIds) {
			const node = store.getNode(nodeId);
			if (
				node === null ||
				node.storyId !== storyId ||
				node.role !== "assistant"
			) {
				floors.push({ ...emptyFloorView(nodeId), failures: loadFailures });
				continue;
			}
			const outcome = await kernel.renderFloor({
				nodeId,
				raw: node.raw,
				state: readLedger(store, nodeId),
			});
			floors.push({
				nodeId,
				renderer: outcome.floor?.renderer ?? null,
				name: outcome.floor?.name ?? null,
				html: outcome.floor?.html ?? null,
				script: outcome.floor?.script ?? null,
				style: outcome.floor?.style ?? null,
				permissions: outcome.floor?.permissions ?? [],
				failures: [...loadFailures, ...outcome.failures.map(toFailureView)],
			});
		}
		return { storyId, floors };
	} finally {
		await kernel.dispose();
	}
}

function emptyFloorView(nodeId: string): FloorRenderView {
	return {
		nodeId,
		renderer: null,
		name: null,
		html: null,
		script: null,
		style: null,
		permissions: [],
		failures: [],
	};
}

function toFailureView(failure: FloorRenderFailure): FloorRenderFailureView {
	return { renderer: failure.renderer, error: failure.error };
}

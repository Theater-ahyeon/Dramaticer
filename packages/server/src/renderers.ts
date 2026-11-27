// 楼层渲染：把故事上安装的声明式渲染器装进真正的主内核，再按注册顺序认领楼层。
// 渲染只产出显示内容，楼层原文不动（I8）；没有渲染器认领或渲染失败时返回空结果，
// 前端按原生方式显示正文。酒馆卡片的渲染配置由 st-compat 转成原生渲染器（I15）。
import {
	type FloorBridgeCapability,
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
import {
	createStCardFloorRenderer,
	readStCardUiConfig,
	stRendererPermissions,
} from "@dramaticer/st-compat";

export async function renderStoryFloors(
	store: StoryStore,
	storyId: string,
	nodeIds: readonly string[],
): Promise<StoryRenderView> {
	const stored = readStoryFloorRenderers(store, storyId).filter(
		(entry) => entry.enabled,
	);
	const stRenderer = createStCardFloorRenderer(
		readStCardUiConfig(store, storyId),
	);
	if (stored.length === 0 && stRenderer === null) {
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
		if (stRenderer !== null) {
			const status = await kernel.load({
				name: "st-card-ui",
				apply(context) {
					context.floorRenderer(stRenderer);
				},
			});
			if (status.state !== "active") {
				loadFailures.push({
					renderer: stRenderer.id,
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

/** 交互桥写状态前的权限查询：声明式渲染器与 ST 兼容渲染器共用一条路径。 */
export function storyRendererPermissions(
	store: StoryStore,
	storyId: string,
	id: string,
): readonly FloorBridgeCapability[] | null {
	const stored = readStoryFloorRenderers(store, storyId).find(
		(entry) => entry.id === id,
	);
	if (stored !== undefined) {
		return stored.enabled ? stored.definition.payload.permissions : null;
	}
	return stRendererPermissions(store, storyId, id);
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

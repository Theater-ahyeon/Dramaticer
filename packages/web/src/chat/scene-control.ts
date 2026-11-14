import type { SceneControlKind, ScenePace } from "@dramaticer/core";

/** 场面控制的可选项；顺序即界面上的显示顺序。 */
export const SCENE_CONTROL_CHOICES: readonly {
	readonly value: SceneControlKind;
	readonly label: string;
	readonly hint: string;
}[] = [
	{ value: "end-scene", label: "结束这一场", hint: "把这一场的边界落在这一楼" },
	{
		value: "jump-time",
		label: "跳到某个时间",
		hint: "写一句故事内时间，比如「三天后的清晨」",
	},
	{ value: "pace", label: "调整节奏", hint: "换一档，下一轮开始生效" },
];

/** 节奏三档；值直接写进导演配置。 */
export const SCENE_PACE_CHOICES: readonly {
	readonly value: ScenePace;
	readonly label: string;
}[] = [
	{ value: "slow", label: "放慢" },
	{ value: "normal", label: "照常" },
	{ value: "fast", label: "加快" },
];

export function sceneControlLabel(kind: SceneControlKind): string {
	return (
		SCENE_CONTROL_CHOICES.find((choice) => choice.value === kind)?.label ?? kind
	);
}

export function scenePaceLabel(pace: ScenePace): string {
	return (
		SCENE_PACE_CHOICES.find((choice) => choice.value === pace)?.label ?? pace
	);
}

/**
 * 就地纠正的提交条件：选中原文与意见都不能是空白。选中原文还必须逐字
 * 出现在楼层里，界面不在这里判定，服务端按 400 指出字段。
 */
export function isCorrectionReady(input: {
	readonly quote: string;
	readonly instruction: string;
}): boolean {
	return input.quote.trim().length > 0 && input.instruction.trim().length > 0;
}

/**
 * 从楼层正文里取当前选区。选区不在楼层里或为空时返回 null；
 * 跨段落的选区同样返回原文，是否唯一由服务端判定。
 */
export function readSelectionText(
	selection: Selection | null,
	container: Node | null,
): string | null {
	if (selection === null || container === null) return null;
	if (selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (!container.contains(range.commonAncestorContainer)) return null;
	const text = selection.toString();
	return text.trim().length === 0 ? null : text;
}

/**
 * 就地纠正的目标：选区所在的助手楼层与选中的原文。
 * 选区落在玩家楼层或楼层之外时返回 null。
 */
export function readCorrectionTarget(
	selection: Selection | null,
): { readonly nodeId: string; readonly quote: string } | null {
	const quote = readSelectionText(selection, document.body);
	if (quote === null || selection === null) return null;
	const range = selection.getRangeAt(0);
	const start =
		range.startContainer instanceof Element
			? range.startContainer
			: range.startContainer.parentElement;
	if (start === null) return null;
	const floor = start.closest<HTMLElement>(".floor-assistant[data-node-id]");
	const nodeId = floor?.dataset.nodeId;
	if (nodeId === undefined || nodeId.length === 0) return null;
	return { nodeId, quote };
}

/** 场面控制结果的一句话说明；场次数量与生效的节奏都写出来。 */
export function describeSceneControlResult(result: {
	readonly control: { readonly kind: SceneControlKind };
	readonly scenes: readonly { readonly endNodeId: string | null }[];
	readonly directorConfig: { readonly pace: number } | null;
}): string {
	const ended = result.scenes.filter(
		(scene) => scene.endNodeId !== null,
	).length;
	const open = result.scenes.length - ended;
	const base = `共 ${result.scenes.length} 场：已结束 ${ended} 场，进行中 ${open} 场`;
	if (result.control.kind !== "pace" || result.directorConfig === null) {
		return base;
	}
	return `${base}；节奏快慢 ${result.directorConfig.pace}`;
}

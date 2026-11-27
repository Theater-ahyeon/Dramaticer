import type { DirectorPush } from "@dramaticer/core";

/** 推进档位；标签与 core 的 `DIRECTOR_PUSH_LABELS` 一致，界面上写得更短。 */
export const PUSH_CHOICES: readonly {
	readonly value: DirectorPush;
	readonly label: string;
	readonly hint: string;
}[] = [
	{ value: "advance", label: "推进", hint: "在这一场里往下走一步" },
	{ value: "quick", label: "快速", hint: "让这一场收尾并转场" },
	{ value: "jump", label: "大幅", hint: "跳到下一条线到点的时刻" },
];

/** 推进按钮发出的玩家消息；候选行动里固定的一项也用它。 */
export const PUSH_TURN_TEXT = "（让故事自己走）";

/**
 * 点选推进菜单里的方向时发出的玩家消息。方向写在消息里，
 * 这样楼层原文、重试与重新生成都能带回同一个方向。
 */
export function pushDirectionText(direction: string): string {
	return `（推进方向：${direction}）`;
}

export const DEFAULT_PUSH: DirectorPush = "advance";

export function pushLabel(push: DirectorPush): string {
	return PUSH_CHOICES.find((choice) => choice.value === push)?.label ?? push;
}

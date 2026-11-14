import type { RerollReason } from "@dramaticer/core";

/** 重 roll 原因的可选项；顺序即界面上显示的先后。 */
export const REROLL_REASON_CHOICES: readonly {
	readonly value: RerollReason;
	readonly label: string;
}[] = [
	{ value: "not-progressed", label: "没推进" },
	{ value: "ignored-instruction", label: "没听我的" },
	{ value: "too-short", label: "太短" },
	{ value: "off-character", label: "人设不对" },
	{ value: "format", label: "格式乱" },
	{ value: "avoid-line", label: "别推这条线" },
];

export function describeRerollReason(
	reason: RerollReason | null | undefined,
): string {
	if (reason === null || reason === undefined) return "没有";
	return (
		REROLL_REASON_CHOICES.find((choice) => choice.value === reason)?.label ??
		reason
	);
}

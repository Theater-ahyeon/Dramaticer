import type { RerollReason } from "@dramaticer/core";
import { REROLL_REASON_CHOICES } from "../../chat/reroll";

export interface RerollReasonPickerProps {
	readonly busy: boolean;
	readonly onPick: (reason: RerollReason) => void;
	readonly onCancel: () => void;
}

/**
 * 重 roll 的原因选择：六项原因各是一个按钮，选中即开始重写。
 * 不选也可以取消；没有原因的重 roll 仍然可用。
 */
export function RerollReasonPicker({
	busy,
	onPick,
	onCancel,
}: RerollReasonPickerProps) {
	return (
		<fieldset className="reroll-reasons" aria-label="重 roll 的原因">
			<legend className="muted">哪里不满意？</legend>
			{REROLL_REASON_CHOICES.map((choice) => (
				<button
					key={choice.value}
					type="button"
					className="reroll-reason"
					disabled={busy}
					onClick={() => onPick(choice.value)}
				>
					{choice.label}
				</button>
			))}
			<button
				type="button"
				className="reroll-cancel"
				disabled={busy}
				onClick={onCancel}
			>
				取消
			</button>
		</fieldset>
	);
}

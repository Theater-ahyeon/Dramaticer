import type { TurnMode } from "@dramaticer/core";
import type { KeyboardEvent } from "react";
import { TURN_MODE_CHOICES } from "../../chat/settings-form";

export interface ComposerProps {
	readonly value: string;
	readonly streaming: boolean;
	/** 本轮使用的回合模式；初值来自故事设置，玩家可以逐轮改写。 */
	readonly turnMode: TurnMode;
	readonly onTurnModeChange: (mode: TurnMode) => void;
	readonly onChange: (value: string) => void;
	readonly onSend: () => void;
	readonly onStop: () => void;
}

/** 输入框；回车发送，Shift+回车换行。 */
export function Composer({
	value,
	streaming,
	turnMode,
	onTurnModeChange,
	onChange,
	onSend,
	onStop,
}: ComposerProps) {
	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey) return;
		if (event.nativeEvent.isComposing) return;
		event.preventDefault();
		if (!streaming) onSend();
	};
	return (
		<form
			className="composer"
			onSubmit={(event) => {
				event.preventDefault();
				if (!streaming) onSend();
			}}
		>
			<textarea
				aria-label="玩家行动"
				placeholder="写下你的行动；回车发送，Shift+回车换行"
				rows={3}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
			/>
			<div className="composer-actions">
				<label
					className="composer-mode"
					title="故事设置给出默认值，这里只改本轮"
				>
					<span>回合模式</span>
					<select
						aria-label="回合模式"
						disabled={streaming}
						value={turnMode}
						onChange={(event) =>
							onTurnModeChange(event.target.value as TurnMode)
						}
					>
						{TURN_MODE_CHOICES.map((choice) => (
							<option key={choice.value} value={choice.value}>
								{choice.label}
							</option>
						))}
					</select>
				</label>
				{streaming ? (
					<button className="composer-stop" type="button" onClick={onStop}>
						停止
					</button>
				) : (
					<button
						className="composer-send"
						type="submit"
						disabled={value.trim().length === 0}
					>
						发送
					</button>
				)}
			</div>
		</form>
	);
}

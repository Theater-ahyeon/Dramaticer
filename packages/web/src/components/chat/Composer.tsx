import type { TurnMode } from "@dramaticer/core";
import type { KeyboardEvent } from "react";

export interface ComposerProps {
	readonly value: string;
	readonly streaming: boolean;
	/** 故事锁定的回合模式；深回合在 R3b 之前不可运行。 */
	readonly turnMode: TurnMode;
	readonly modeSaving: boolean;
	/** 故事锁定为深回合时提供的“切回快回合”入口。 */
	readonly onUseFastMode: (() => void) | null;
	readonly onChange: (value: string) => void;
	readonly onSend: () => void;
	readonly onStop: () => void;
}

/** 输入框；回车发送，Shift+回车换行。深回合在 R3b 之前不列为可选项。 */
export function Composer({
	value,
	streaming,
	turnMode,
	modeSaving,
	onUseFastMode,
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
				<label className="composer-mode" title="深回合在 R3b 之后提供">
					<span>回合模式</span>
					<select aria-label="回合模式" disabled value={turnMode}>
						<option value="fast">快回合</option>
						{turnMode === "deep" ? (
							<option value="deep">深回合（尚未实现）</option>
						) : null}
					</select>
				</label>
				{onUseFastMode === null ? null : (
					<button
						className="composer-mode-lock"
						type="button"
						disabled={modeSaving}
						onClick={onUseFastMode}
					>
						切回快回合
					</button>
				)}
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

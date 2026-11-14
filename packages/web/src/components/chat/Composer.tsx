import type { DirectorPush, TurnMode } from "@dramaticer/core";
import type { KeyboardEvent } from "react";
import { PUSH_CHOICES } from "../../chat/push";
import { TURN_MODE_CHOICES } from "../../chat/settings-form";

export interface ComposerProps {
	readonly value: string;
	readonly streaming: boolean;
	/** 本轮使用的回合模式；初值来自故事设置，玩家可以逐轮改写。 */
	readonly turnMode: TurnMode;
	readonly onTurnModeChange: (mode: TurnMode) => void;
	/** 推进档位；按下推进按钮时用这一档发一轮不带具体行动的回合。 */
	readonly push: DirectorPush;
	readonly onPushChange: (push: DirectorPush) => void;
	readonly onPush: () => void;
	readonly onChange: (value: string) => void;
	readonly onSend: () => void;
	readonly onStop: () => void;
	/** 深回合运行中：输入框换成追加要求，不再发送新的行动。 */
	readonly steering: boolean;
	readonly steeringValue: string;
	readonly steeringBusy: boolean;
	readonly onSteeringChange: (value: string) => void;
	readonly onSteer: () => void;
}

/** 输入框；回车发送，Shift+回车换行。深回合运行中回车追加要求。 */
export function Composer({
	value,
	streaming,
	turnMode,
	onTurnModeChange,
	push,
	onPushChange,
	onPush,
	onChange,
	onSend,
	onStop,
	steering,
	steeringValue,
	steeringBusy,
	onSteeringChange,
	onSteer,
}: ComposerProps) {
	const handleKeyDown = submitOnEnter(
		() => {
			if (!streaming) onSend();
		},
		() => streaming,
	);
	const handleSteeringKeyDown = submitOnEnter(
		() => {
			if (!steeringBusy) onSteer();
		},
		() => steeringBusy,
	);

	if (steering) {
		return (
			<form
				className="composer composer-steering"
				onSubmit={(event) => {
					event.preventDefault();
					if (!steeringBusy) onSteer();
				}}
			>
				<textarea
					aria-label="追加要求"
					placeholder="深回合运行中；写下的要求会在下一次模型请求前追加，回车提交"
					rows={2}
					value={steeringValue}
					onChange={(event) => onSteeringChange(event.target.value)}
					onKeyDown={handleSteeringKeyDown}
				/>
				<div className="composer-actions">
					<span className="muted">追加要求只影响后续步骤，不写新楼层</span>
					<button className="composer-stop" type="button" onClick={onStop}>
						停止
					</button>
					<button
						className="composer-steer"
						type="submit"
						disabled={steeringBusy || steeringValue.trim().length === 0}
					>
						追加要求
					</button>
				</div>
			</form>
		);
	}

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
			<fieldset className="composer-push" aria-label="推进档位">
				<legend className="muted">推进档位</legend>
				<div className="composer-push-kinds">
					{PUSH_CHOICES.map((choice) => (
						<button
							key={choice.value}
							type="button"
							className="composer-push-kind"
							aria-pressed={push === choice.value}
							disabled={streaming}
							onClick={() => onPushChange(choice.value)}
						>
							{choice.label}
						</button>
					))}
				</div>
				<button
					className="composer-push-send"
					type="button"
					disabled={streaming}
					onClick={onPush}
				>
					让故事自己走
				</button>
				<span className="muted composer-push-hint">
					{PUSH_CHOICES.find((choice) => choice.value === push)?.hint ?? ""}
				</span>
			</fieldset>
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

function submitOnEnter(
	submit: () => void,
	disabled: () => boolean,
): (event: KeyboardEvent<HTMLTextAreaElement>) => void {
	return (event) => {
		if (event.key !== "Enter" || event.shiftKey) return;
		if (event.nativeEvent.isComposing) return;
		event.preventDefault();
		if (!disabled()) submit();
	};
}

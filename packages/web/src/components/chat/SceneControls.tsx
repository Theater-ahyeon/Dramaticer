import type { SceneControlKind, ScenePace } from "@dramaticer/core";
import { useState } from "react";
import {
	SCENE_CONTROL_CHOICES,
	SCENE_PACE_CHOICES,
} from "../../chat/scene-control";

export interface SceneControlsProps {
	/** 当前路径最后一个助手楼层；没有时整块不显示。 */
	readonly nodeId: string;
	readonly busy: boolean;
	readonly onEndScene: (note: string | null) => void;
	readonly onJumpTime: (time: string) => void;
	readonly onPace: (pace: ScenePace) => void;
}

/**
 * 输入区上方的场面控制：结束这一场、跳到某个时间、调整节奏。
 * 三种操作都落在当前路径最后一个助手楼层上；展开后只有一个输入框。
 */
export function SceneControls({
	nodeId,
	busy,
	onEndScene,
	onJumpTime,
	onPace,
}: SceneControlsProps) {
	const [open, setOpen] = useState<SceneControlKind | null>(null);
	const [note, setNote] = useState("");
	const [time, setTime] = useState("");

	const toggle = (kind: SceneControlKind): void => {
		setOpen((current) => (current === kind ? null : kind));
		setNote("");
		setTime("");
	};

	return (
		<div className="scene-controls" data-node-id={nodeId}>
			<fieldset className="scene-controls-kinds" aria-label="场面控制">
				{SCENE_CONTROL_CHOICES.map((choice) => (
					<button
						key={choice.value}
						type="button"
						className="scene-control"
						aria-pressed={open === choice.value}
						disabled={busy}
						title={choice.hint}
						onClick={() => toggle(choice.value)}
					>
						{choice.label}
					</button>
				))}
			</fieldset>
			{open === "end-scene" ? (
				<div className="scene-control-form">
					<label>
						<span>备注（可空）</span>
						<input
							aria-label="结束这一场的备注"
							value={note}
							onChange={(event) => setNote(event.target.value)}
						/>
					</label>
					<button
						type="button"
						className="scene-control-submit"
						disabled={busy}
						onClick={() => onEndScene(note.trim().length === 0 ? null : note)}
					>
						收在这里
					</button>
				</div>
			) : null}
			{open === "jump-time" ? (
				<div className="scene-control-form">
					<label>
						<span>跳到</span>
						<input
							aria-label="跳到的时间"
							placeholder="三天后的清晨"
							value={time}
							onChange={(event) => setTime(event.target.value)}
						/>
					</label>
					<button
						type="button"
						className="scene-control-submit"
						disabled={busy || time.trim().length === 0}
						onClick={() => onJumpTime(time.trim())}
					>
						跳过去
					</button>
				</div>
			) : null}
			{open === "pace" ? (
				<div className="scene-control-form">
					{SCENE_PACE_CHOICES.map((choice) => (
						<button
							key={choice.value}
							type="button"
							className="scene-control-pace"
							disabled={busy}
							onClick={() => onPace(choice.value)}
						>
							{choice.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

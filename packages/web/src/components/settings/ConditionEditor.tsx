import {
	CONDITION_KIND_CHOICES,
	type ConditionDraft,
	STATE_OP_CHOICES,
	type StateConditionDraft,
	switchConditionKind,
} from "../../chat/template-form";

export interface ConditionEditorProps {
	readonly condition: ConditionDraft;
	readonly onChange: (next: ConditionDraft) => void;
	readonly disabled: boolean;
	readonly label: string;
}

/** 递归编辑一个模板条件；子条件增删都在同一份草稿上做不可变更新。 */
export function ConditionEditor({
	condition,
	onChange,
	disabled,
	label,
}: ConditionEditorProps) {
	return (
		<div className="condition-editor">
			<div className="plan-field-row">
				<label className="plan-field">
					<span>{label}类型</span>
					<select
						value={condition.kind}
						onChange={(event) =>
							onChange(
								switchConditionKind(
									condition,
									event.target.value as ConditionDraft["kind"],
								),
							)
						}
						disabled={disabled}
					>
						{CONDITION_KIND_CHOICES.map((choice) => (
							<option key={choice.value} value={choice.value}>
								{choice.label}
							</option>
						))}
					</select>
				</label>
				{condition.kind === "switch" ? (
					<>
						<label className="plan-field plan-field-grow">
							<span>开关名</span>
							<input
								type="text"
								value={condition.name}
								onChange={(event) =>
									onChange({ ...condition, name: event.target.value })
								}
								disabled={disabled}
							/>
						</label>
						<label className="plan-field">
							<span>期望值</span>
							<select
								value={condition.equals ? "true" : "false"}
								onChange={(event) =>
									onChange({
										...condition,
										equals: event.target.value === "true",
									})
								}
								disabled={disabled}
							>
								<option value="true">为真</option>
								<option value="false">为假</option>
							</select>
						</label>
					</>
				) : null}
				{condition.kind === "state" ? (
					<>
						<label className="plan-field plan-field-grow">
							<span>状态路径（英文句点分隔）</span>
							<input
								type="text"
								value={condition.path}
								onChange={(event) =>
									onChange({ ...condition, path: event.target.value })
								}
								disabled={disabled}
								placeholder="角色.卫宫.好感度"
							/>
						</label>
						<label className="plan-field">
							<span>判断</span>
							<select
								value={condition.op}
								onChange={(event) =>
									onChange({
										...condition,
										op: event.target.value as StateConditionDraft["op"],
									})
								}
								disabled={disabled}
							>
								{STATE_OP_CHOICES.map((choice) => (
									<option key={choice.value} value={choice.value}>
										{choice.label}
									</option>
								))}
							</select>
						</label>
						{condition.op === "equals" ? (
							<label className="plan-field plan-field-grow">
								<span>比较值（JSON）</span>
								<input
									type="text"
									value={condition.valueText}
									onChange={(event) =>
										onChange({ ...condition, valueText: event.target.value })
									}
									disabled={disabled}
									placeholder='"山门" 或 3'
								/>
							</label>
						) : null}
					</>
				) : null}
			</div>
			{condition.kind === "all" || condition.kind === "any" ? (
				<div className="condition-children">
					{condition.conditions.map((child, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: 子条件没有独立 id，按位置编辑
						<div className="condition-child" key={index}>
							<div className="plan-toolbar">
								<span className="muted">
									子条件 {index + 1}（
									{condition.kind === "all" ? "全部满足" : "任一满足"}）
								</span>
								<button
									type="button"
									className="plan-remove"
									onClick={() =>
										onChange({
											kind: condition.kind,
											conditions: condition.conditions.filter(
												(_, position) => position !== index,
											),
										})
									}
									disabled={disabled}
								>
									移除子条件
								</button>
							</div>
							<ConditionEditor
								condition={child}
								label="子条件"
								disabled={disabled}
								onChange={(next) =>
									onChange({
										kind: condition.kind,
										conditions: condition.conditions.map((item, position) =>
											position === index ? next : item,
										),
									})
								}
							/>
						</div>
					))}
					<button
						type="button"
						className="plan-add"
						onClick={() =>
							onChange({
								kind: condition.kind,
								conditions: [
									...condition.conditions,
									switchConditionKind(null, "switch"),
								],
							})
						}
						disabled={disabled}
					>
						添加子条件
					</button>
				</div>
			) : null}
			{condition.kind === "not" ? (
				<div className="condition-children">
					<ConditionEditor
						condition={condition.condition}
						label="取反的子条件"
						disabled={disabled}
						onChange={(next) => onChange({ kind: "not", condition: next })}
					/>
				</div>
			) : null}
		</div>
	);
}

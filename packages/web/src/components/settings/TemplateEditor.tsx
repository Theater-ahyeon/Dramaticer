import type { ContextSlotName, ContextStaticSegment } from "@dramaticer/core";
import {
	BLOCK_FORMAT_SEGMENT_ID,
	type ConditionDraft,
	SLOT_CHOICES,
	type TemplateFormDraft,
	addBlockFormatSegment,
	addSlotSegment,
	addStaticSegment,
	describeTemplateSegments,
	hasBlockFormatSegment,
	moveSegmentDraft,
	removeBlockFormatSegment,
	removeSegmentDraft,
	switchConditionKind,
	updateSegmentDraft,
} from "../../chat/template-form";
import { ConditionEditor } from "./ConditionEditor";

export interface TemplateEditorProps {
	readonly draft: TemplateFormDraft;
	readonly onChange: (next: TemplateFormDraft) => void;
	readonly blockFormatSegment: ContextStaticSegment;
	readonly disabled: boolean;
}

const CONDITION_KIND_LABEL: Readonly<
	Record<"none" | ConditionDraft["kind"], string>
> = {
	none: "无条件",
	switch: "开关",
	state: "状态",
	all: "全部满足",
	any: "任一满足",
	not: "取反",
};

const CONDITION_KINDS = [
	"none",
	"switch",
	"state",
	"all",
	"any",
	"not",
] as const;

/** 段落列表编辑器：增删、上下移动、槽位与条件编辑；预览就是同一份顺序。 */
export function TemplateEditor({
	draft,
	onChange,
	blockFormatSegment,
	disabled,
}: TemplateEditorProps) {
	const rows = describeTemplateSegments(draft);
	return (
		<div className="template-editor">
			<div className="plan-field-row">
				<label className="plan-field plan-field-grow">
					<span>模板名称</span>
					<input
						type="text"
						value={draft.name}
						onChange={(event) =>
							onChange({ ...draft, name: event.target.value })
						}
						disabled={disabled}
					/>
				</label>
				<label className="plan-field">
					<span>模板 id</span>
					<input
						type="text"
						value={draft.id}
						onChange={(event) => onChange({ ...draft, id: event.target.value })}
						disabled={disabled}
					/>
				</label>
			</div>
			<label className="settings-check">
				<input
					type="checkbox"
					checked={hasBlockFormatSegment(draft)}
					onChange={(event) =>
						onChange(
							event.target.checked
								? addBlockFormatSegment(draft, blockFormatSegment)
								: removeBlockFormatSegment(draft),
						)
					}
					disabled={disabled}
				/>
				<span>包含块格式说明段（block_format）</span>
			</label>
			<ol className="template-segments">
				{draft.segments.map((segment, index) => (
					<li className="template-segment" key={`${segment.id}-${index}`}>
						<div className="template-segment-head">
							<strong>第 {index + 1} 段</strong>
							<span className="ledger-tag">{segment.id}</span>
							<button
								type="button"
								className="plan-remove"
								onClick={() => onChange(removeSegmentDraft(draft, index))}
								disabled={disabled}
							>
								移除
							</button>
						</div>
						<div className="plan-field-row">
							<label className="plan-field">
								<span>片段 id</span>
								<input
									type="text"
									value={segment.id}
									onChange={(event) =>
										onChange(
											updateSegmentDraft(draft, index, {
												id: event.target.value,
											}),
										)
									}
									disabled={disabled}
								/>
							</label>
							<label className="plan-field">
								<span>类型</span>
								<select
									value={segment.kind}
									onChange={(event) =>
										onChange(
											updateSegmentDraft(draft, index, {
												kind: event.target.value as "static" | "slot",
											}),
										)
									}
									disabled={disabled}
								>
									<option value="static">静态</option>
									<option value="slot">槽位</option>
								</select>
							</label>
							{segment.kind === "slot" ? (
								<label className="plan-field">
									<span>槽位</span>
									<select
										value={segment.slot}
										onChange={(event) =>
											onChange(
												updateSegmentDraft(draft, index, {
													slot: event.target.value as ContextSlotName,
												}),
											)
										}
										disabled={disabled}
									>
										{SLOT_CHOICES.map((choice) => (
											<option key={choice.value} value={choice.value}>
												{choice.label}
											</option>
										))}
									</select>
								</label>
							) : null}
							<label className="plan-field">
								<span>优先级（留空为默认）</span>
								<input
									type="text"
									inputMode="numeric"
									value={segment.priority}
									onChange={(event) =>
										onChange(
											updateSegmentDraft(draft, index, {
												priority: event.target.value,
											}),
										)
									}
									disabled={disabled}
								/>
							</label>
						</div>
						{segment.kind === "static" ? (
							<label className="plan-field">
								<span>静态文本</span>
								<textarea
									rows={4}
									value={segment.text}
									onChange={(event) =>
										onChange(
											updateSegmentDraft(draft, index, {
												text: event.target.value,
											}),
										)
									}
									disabled={disabled}
								/>
							</label>
						) : null}
						<div className="plan-field-row">
							<label className="plan-field">
								<span>条件</span>
								<select
									value={
										segment.condition === null ? "none" : segment.condition.kind
									}
									onChange={(event) => {
										const kind = event.target.value;
										if (kind === "none") {
											onChange(
												updateSegmentDraft(draft, index, {
													condition: null,
												}),
											);
											return;
										}
										onChange(
											updateSegmentDraft(draft, index, {
												condition: switchConditionKind(
													segment.condition,
													kind as ConditionDraft["kind"],
												),
											}),
										);
									}}
									disabled={disabled}
								>
									{CONDITION_KINDS.map((kind) => (
										<option key={kind} value={kind}>
											{CONDITION_KIND_LABEL[kind]}
										</option>
									))}
								</select>
							</label>
							<div className="plan-toolbar">
								<button
									type="button"
									onClick={() => onChange(moveSegmentDraft(draft, index, -1))}
									disabled={disabled || index === 0}
								>
									上移
								</button>
								<button
									type="button"
									onClick={() => onChange(moveSegmentDraft(draft, index, 1))}
									disabled={disabled || index === draft.segments.length - 1}
								>
									下移
								</button>
							</div>
						</div>
						{segment.condition === null ? null : (
							<div className="plan-toolbar">
								<span className="muted">
									条件目前为：{rows[index]?.condition}
								</span>
							</div>
						)}
						{segment.condition === null ? null : (
							<ConditionEditor
								condition={segment.condition}
								label={`第 ${index + 1} 段条件`}
								disabled={disabled}
								onChange={(next) =>
									onChange(
										updateSegmentDraft(draft, index, { condition: next }),
									)
								}
							/>
						)}
					</li>
				))}
			</ol>
			<div className="plan-toolbar">
				<button
					type="button"
					onClick={() => onChange(addStaticSegment(draft))}
					disabled={disabled}
				>
					添加静态段
				</button>
				<button
					type="button"
					onClick={() => onChange(addSlotSegment(draft, "history"))}
					disabled={disabled}
				>
					添加槽位段
				</button>
			</div>
			<section aria-label="组装顺序预览">
				<h3>组装顺序预览</h3>
				<ol className="template-preview">
					{rows.map((row) => (
						<li key={`${row.id}-${row.index}`}>
							<span className="ledger-tag">{row.kindLabel}</span> {row.id} ·{" "}
							{row.detail} · {row.condition} · 优先级 {row.priority}
						</li>
					))}
				</ol>
			</section>
			{hasBlockFormatSegment(draft) ? (
				<p className="muted">
					块格式说明段固定 id 为 {BLOCK_FORMAT_SEGMENT_ID}
					，文本按当前结构化输出生成，可以继续编辑。
				</p>
			) : null}
		</div>
	);
}

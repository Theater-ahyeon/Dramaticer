import type { DirectorPlan } from "@dramaticer/core";
import {
	addDirectorArc,
	addDirectorBeat,
	addDirectorSequence,
	countPlanBeats,
	joinPlanLines,
	removeDirectorArc,
	removeDirectorBeat,
	removeDirectorSequence,
	splitPlanLines,
	updateDirectorArc,
	updateDirectorBeat,
	updateDirectorSequence,
} from "../../chat/director-view";
import { ErrorNotice } from "../ErrorNotice";

export interface DirectorPlanEditorProps {
	readonly saved: DirectorPlan;
	readonly draft: DirectorPlan;
	readonly onChange: (next: DirectorPlan) => void;
	readonly onSave: () => void;
	readonly onReset: () => void;
	readonly saving: boolean;
	readonly savedNotice: boolean;
	readonly error: unknown;
}

/** 导演计划的字段编辑器：整份替换写回，保存前不清空已有的拍 id。 */
export function DirectorPlanEditor({
	saved,
	draft,
	onChange,
	onSave,
	onReset,
	saving,
	savedNotice,
	error,
}: DirectorPlanEditorProps) {
	const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
	const sequenceCount = draft.arcs.reduce(
		(total, arc) => total + arc.sequences.length,
		0,
	);
	return (
		<section className="director-section" aria-label="导演计划">
			<header className="director-section-head">
				<h2>导演计划</h2>
				<span className="ledger-tag">
					{draft.arcs.length} 条弧线 · {sequenceCount} 个序列 ·{" "}
					{countPlanBeats(draft)} 个拍
				</span>
			</header>
			<p className="muted">
				保存时整份替换，所有行标为玩家来源；模型与导入的行不会被合并覆盖。 节拍
				id 用于落拍记录，改动后旧记录找不到对应的拍。
			</p>
			<ErrorNotice error={error} />
			<div className="plan-toolbar">
				<button type="button" onClick={onSave} disabled={saving || !dirty}>
					{saving ? "正在保存…" : "保存计划"}
				</button>
				<button type="button" onClick={onReset} disabled={saving || !dirty}>
					放弃修改
				</button>
				<button
					type="button"
					onClick={() => onChange(addDirectorArc(draft))}
					disabled={saving}
				>
					添加弧线
				</button>
				{dirty ? <span className="ledger-tag">有未保存的修改</span> : null}
				{savedNotice ? <span className="ledger-tag">已保存</span> : null}
			</div>
			{draft.arcs.length === 0 ? (
				<p className="muted">还没有导演计划。添加一条弧线后填写序列与节拍。</p>
			) : null}
			<div className="plan-arcs">
				{draft.arcs.map((arc, arcIndex) => (
					<article key={arc.id} className="plan-arc">
						<header className="plan-arc-head">
							<span className="ledger-badge">弧线 {arcIndex + 1}</span>
							<span className="ledger-path">{arc.id}</span>
							<button
								type="button"
								className="plan-remove"
								onClick={() => onChange(removeDirectorArc(draft, arcIndex))}
								disabled={saving}
							>
								删除弧线
							</button>
						</header>
						<label className="plan-field">
							<span>标题</span>
							<input
								value={arc.title}
								onChange={(event) =>
									onChange(
										updateDirectorArc(draft, arcIndex, {
											title: event.target.value,
										}),
									)
								}
								disabled={saving}
							/>
						</label>
						<label className="plan-field">
							<span>主线</span>
							<textarea
								rows={2}
								value={arc.throughLine}
								onChange={(event) =>
									onChange(
										updateDirectorArc(draft, arcIndex, {
											throughLine: event.target.value,
										}),
									)
								}
								disabled={saving}
							/>
						</label>
						<div className="plan-field-row">
							<label className="plan-field">
								<span>难度（0 到 1）</span>
								<input
									type="number"
									min={0}
									max={1}
									step={0.05}
									value={arc.difficulty}
									onChange={(event) => {
										const value = Number.parseFloat(event.target.value);
										onChange(
											updateDirectorArc(draft, arcIndex, {
												difficulty: Number.isFinite(value) ? value : 0,
											}),
										);
									}}
									disabled={saving}
								/>
							</label>
							<label className="plan-field plan-field-grow">
								<span>红线（每行一条）</span>
								<textarea
									rows={2}
									value={joinPlanLines(arc.redLines)}
									onChange={(event) =>
										onChange(
											updateDirectorArc(draft, arcIndex, {
												redLines: splitPlanLines(event.target.value),
											}),
										)
									}
									disabled={saving}
								/>
							</label>
						</div>
						<div className="plan-sequences">
							{arc.sequences.map((sequence, sequenceIndex) => (
								<div key={sequence.id} className="plan-sequence">
									<header className="plan-sequence-head">
										<span className="ledger-tag">序列 {sequenceIndex + 1}</span>
										<span className="ledger-path">{sequence.id}</span>
										<button
											type="button"
											className="plan-remove"
											onClick={() =>
												onChange(
													removeDirectorSequence(
														draft,
														arcIndex,
														sequenceIndex,
													),
												)
											}
											disabled={saving}
										>
											删除序列
										</button>
									</header>
									<label className="plan-field">
										<span>标题</span>
										<input
											value={sequence.title}
											onChange={(event) =>
												onChange(
													updateDirectorSequence(
														draft,
														arcIndex,
														sequenceIndex,
														{ title: event.target.value },
													),
												)
											}
											disabled={saving}
										/>
									</label>
									<div className="plan-beats">
										{sequence.beats.map((beat, beatIndex) => (
											<div key={beat.id} className="plan-beat">
												<header className="plan-sequence-head">
													<span className="ledger-tag">拍 {beatIndex + 1}</span>
													<span className="ledger-path">{beat.id}</span>
													<button
														type="button"
														className="plan-remove"
														onClick={() =>
															onChange(
																removeDirectorBeat(
																	draft,
																	arcIndex,
																	sequenceIndex,
																	beatIndex,
																),
															)
														}
														disabled={saving}
													>
														删除节拍
													</button>
												</header>
												<label className="plan-field">
													<span>目标</span>
													<textarea
														rows={2}
														value={beat.goal}
														onChange={(event) =>
															onChange(
																updateDirectorBeat(
																	draft,
																	arcIndex,
																	sequenceIndex,
																	beatIndex,
																	{ goal: event.target.value },
																),
															)
														}
														disabled={saving}
													/>
												</label>
												<div className="plan-field-row">
													<label className="plan-field plan-field-grow">
														<span>起始迹象（每行一条，至少一条）</span>
														<textarea
															rows={2}
															value={joinPlanLines(beat.entrySigns)}
															onChange={(event) =>
																onChange(
																	updateDirectorBeat(
																		draft,
																		arcIndex,
																		sequenceIndex,
																		beatIndex,
																		{
																			entrySigns: splitPlanLines(
																				event.target.value,
																			),
																		},
																	),
																)
															}
															disabled={saving}
														/>
													</label>
													<label className="plan-field plan-field-grow">
														<span>契合点（每行一条，至少一条）</span>
														<textarea
															rows={2}
															value={joinPlanLines(beat.fitPoints)}
															onChange={(event) =>
																onChange(
																	updateDirectorBeat(
																		draft,
																		arcIndex,
																		sequenceIndex,
																		beatIndex,
																		{
																			fitPoints: splitPlanLines(
																				event.target.value,
																			),
																		},
																	),
																)
															}
															disabled={saving}
														/>
													</label>
												</div>
											</div>
										))}
									</div>
									<button
										type="button"
										className="plan-add"
										onClick={() =>
											onChange(addDirectorBeat(draft, arcIndex, sequenceIndex))
										}
										disabled={saving}
									>
										添加节拍
									</button>
								</div>
							))}
						</div>
						<button
							type="button"
							className="plan-add"
							onClick={() => onChange(addDirectorSequence(draft, arcIndex))}
							disabled={saving}
						>
							添加序列
						</button>
					</article>
				))}
			</div>
		</section>
	);
}

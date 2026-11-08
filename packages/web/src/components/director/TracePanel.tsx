import type { TurnTrace } from "@dramaticer/core";
import type { TraceRow, TraceView } from "../../chat/director-view";
import { buildTraceView } from "../../chat/director-view";
import { ErrorNotice } from "../ErrorNotice";

export interface TracePanelProps {
	readonly trace: TurnTrace | null;
	readonly note: string | null;
	readonly loading: boolean;
	readonly error: unknown;
}

/** 一个楼层的 Trace：模型、工具、上下文分段、块视图省略量与上下文裁剪。 */
export function TracePanel({ trace, note, loading, error }: TracePanelProps) {
	const view = trace === null ? null : buildTraceView(trace);
	return (
		<section className="director-section" aria-label="Trace">
			<header className="director-section-head">
				<h2>Trace</h2>
			</header>
			<ErrorNotice error={error} />
			{loading ? <p className="muted">正在读取 Trace…</p> : null}
			{note === null ? null : <p className="muted">{note}</p>}
			{view === null ? null : <TraceContent view={view} />}
		</section>
	);
}

function TraceContent({ view }: { readonly view: TraceView }) {
	return (
		<>
			<div className="trace-grid">
				<TraceBlock title="回合" rows={view.turnRows} />
				<TraceBlock title="模型与用量" rows={view.llmRows} />
				<TraceBlock title="工具" rows={view.toolsRows} />
				<TraceBlock title="结构化输出" rows={view.structuredRows} />
				<TraceBlock title="耗时" rows={view.timingRows} />
			</div>
			<div className="trace-context">
				<h3>
					上下文分段（{view.context.totalTokens} / 预算{" "}
					{view.context.budgetTokens} token）
				</h3>
				{view.context.entries.length === 0 ? (
					<p className="muted">这一轮没有上下文分段记录。</p>
				) : (
					<ul className="ledger-diff-list">
						{view.context.entries.map((entry) => (
							<li key={entry.segmentId} className="ledger-diff">
								<div className="ledger-diff-head">
									<span className="ledger-path">{entry.segmentId}</span>
									<span className="ledger-tag">{entry.kindLabel}</span>
									<span className="ledger-tag">{entry.tokens} token</span>
									<span className="ledger-tag">{entry.statusLabel}</span>
								</div>
								<p className="ledger-meta">来源：{entry.source}</p>
								{entry.appendedTo === null ? null : (
									<p className="ledger-meta">拼接到：{entry.appendedTo}</p>
								)}
								{entry.history === null ? null : (
									<div className="trace-history">
										<p className="ledger-meta">
											块视图：{entry.history.policy}，最近{" "}
											{entry.history.recentRawFloors} 楼保留原文
										</p>
										{entry.history.omitted.length === 0 ? (
											<p className="ledger-meta">没有省略块。</p>
										) : (
											<ul className="trace-omissions">
												{entry.history.omitted.map((omission) => (
													<li key={omission.blockType}>
														<span className="ledger-tag">
															{omission.blockType}
														</span>
														<span>
															省略 {omission.characters} 字符、约{" "}
															{omission.tokens} token
														</span>
													</li>
												))}
											</ul>
										)}
									</div>
								)}
							</li>
						))}
					</ul>
				)}
				<div className="trace-cropped">
					<h3>被裁剪的段落与缺失槽位</h3>
					<p className="ledger-meta">
						预算裁掉：{describeList(view.context.dropped)}
					</p>
					<p className="ledger-meta">
						槽位缺失：{describeList(view.context.missingSlots)}
					</p>
					<p className="ledger-meta">
						条件不满足：{describeList(view.context.conditionFalse)}
					</p>
				</div>
			</div>
		</>
	);
}

function TraceBlock({
	title,
	rows,
}: {
	readonly title: string;
	readonly rows: readonly TraceRow[];
}) {
	return (
		<div className="trace-block">
			<h3>{title}</h3>
			<dl className="trace-rows">
				{rows.map((row) => (
					<div key={row.label}>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

function describeList(items: readonly string[]): string {
	return items.length === 0 ? "没有" : items.join("、");
}

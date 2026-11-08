import type { DirectorPlan } from "@dramaticer/core";
import type { NodeDirectorView } from "@dramaticer/protocol";
import {
	describeDirectorIntensity,
	summarizeDirectorView,
} from "../../chat/director-view";
import { formatFloorTime } from "../../chat/format";

export interface DirectorDecisionProps {
	readonly view: NodeDirectorView;
	readonly plan: DirectorPlan | null;
}

/** 导演决策：透明模式显示指令、当前拍与信号，盲盒只显示机制触发状态。 */
export function DirectorDecision({ view, plan }: DirectorDecisionProps) {
	const summary = summarizeDirectorView(view, plan);
	const decision = summary.decision;
	return (
		<section className="director-section" aria-label="导演决策">
			<header className="director-section-head">
				<h2>导演决策</h2>
				<span className="ledger-badge">模式：{summary.label}</span>
			</header>
			{summary.mode === "off" ? (
				<p className="muted">
					导演已关闭，这一楼之后的新回合不再评估与注入；下面是保存下来的历史决策。
				</p>
			) : null}
			{decision === null ? (
				<p className="muted">本楼没有评估。</p>
			) : (
				<>
					{summary.blind ? (
						<p className="muted">
							盲盒模式只显示机制触发状态，指令与信号由服务端隐去。
						</p>
					) : null}
					{summary.blind ? null : decision.directive === null ? (
						<p className="muted">本轮没有机制触发，导演没有给建议。</p>
					) : (
						<blockquote className="director-directive">
							{decision.directive}
						</blockquote>
					)}
					{summary.blind ? null : (
						<div className="director-beat">
							<h3>当前拍</h3>
							{decision.beat === null ? (
								<p className="muted">本楼没有当前拍的信号。</p>
							) : (
								<>
									<div className="ledger-diff-head">
										<span className="ledger-path">{decision.beat.beatId}</span>
										{decision.intensity === null ? null : (
											<span className="ledger-tag">
												强度 {describeDirectorIntensity(decision.intensity)}
											</span>
										)}
										{decision.beat.floorDepth === null ? null : (
											<span className="ledger-tag">
												第 {decision.beat.floorDepth + 1} 楼
											</span>
										)}
										{decision.beat.difficulty === null ? null : (
											<span className="ledger-tag">
												难度 {decision.beat.difficulty.toFixed(2)}
											</span>
										)}
									</div>
									{decision.beat.goal === null ? null : (
										<p className="ledger-meta">目标：{decision.beat.goal}</p>
									)}
									{decision.beat.arcTitle === null ? null : (
										<p className="ledger-meta">
											弧线：{decision.beat.arcTitle}
											{decision.beat.sequenceTitle === null
												? ""
												: ` · 序列：${decision.beat.sequenceTitle}`}
										</p>
									)}
									{decision.beat.usedFitPoints.length === 0 ? null : (
										<p className="ledger-meta">
											契合点：{decision.beat.usedFitPoints.join("；")}
										</p>
									)}
								</>
							)}
						</div>
					)}
					{summary.blind ? null : (
						<div className="director-signals">
							<h3>纠偏信号</h3>
							{decision.signalRows.length === 0 ? (
								<p className="muted">这一轮没有写入信号。</p>
							) : (
								<dl className="ledger-meta-list">
									{decision.signalRows.map((row) => (
										<div key={row.label}>
											<dt>{row.label}</dt>
											<dd>{row.value}</dd>
										</div>
									))}
								</dl>
							)}
						</div>
					)}
					<div className="director-mechanisms">
						<h3>机制</h3>
						<ul className="ledger-diff-list">
							{decision.mechanisms.map((mechanism) => (
								<li
									key={mechanism.name}
									className={
										mechanism.triggered
											? "ledger-diff director-mechanism-triggered"
											: "ledger-diff"
									}
								>
									<div className="ledger-diff-head">
										<span className="ledger-path">{mechanism.name}</span>
										<span className="ledger-tag">{mechanism.label}</span>
										<span className="ledger-tag">
											{mechanism.triggered ? "触发" : "未触发"}
										</span>
									</div>
									<p className="ledger-meta">{mechanism.reason}</p>
								</li>
							))}
						</ul>
					</div>
					<p className="ledger-meta">
						评估时间 {formatFloorTime(decision.createdAt)}
					</p>
				</>
			)}
		</section>
	);
}

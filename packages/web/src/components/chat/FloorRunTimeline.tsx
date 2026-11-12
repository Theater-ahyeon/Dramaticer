import { useState } from "react";
import { ApiError, api } from "../../api";
import {
	type RunTimelineView,
	buildRunTimeline,
} from "../../chat/run-timeline";
import { ErrorNotice } from "../ErrorNotice";

/** 助手楼层的运行时间线；快回合没有运行记录，展开后给出说明。 */
export function FloorRunTimeline({ nodeId }: { readonly nodeId: string }) {
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<RunTimelineView | null>(null);
	const [missing, setMissing] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<unknown>(null);

	const toggle = async (): Promise<void> => {
		if (open) {
			setOpen(false);
			return;
		}
		setOpen(true);
		if (view !== null || missing || loading) return;
		setLoading(true);
		setError(null);
		try {
			setView(buildRunTimeline(await api.getNodeRun(nodeId)));
		} catch (caught) {
			if (caught instanceof ApiError && caught.status === 404) {
				setMissing(true);
			} else {
				setError(caught);
			}
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="floor-run">
			<button
				className="floor-run-toggle"
				type="button"
				aria-expanded={open}
				onClick={() => {
					void toggle();
				}}
			>
				运行时间线
			</button>
			{open ? (
				<section className="run-timeline" aria-label="运行时间线">
					{loading ? <p className="muted">正在读取运行时间线…</p> : null}
					{missing ? (
						<p className="muted">这一楼没有运行记录（快回合不写运行日志）。</p>
					) : null}
					<ErrorNotice error={error} />
					{view === null ? null : <RunTimelineContent view={view} />}
				</section>
			) : null}
		</div>
	);
}

function RunTimelineContent({ view }: { readonly view: RunTimelineView }) {
	return (
		<>
			<p className="ledger-meta">
				运行 {view.runId} · {view.statusLabel} · {view.eventCount} 个事件
			</p>
			{view.stoppedAt === null ? null : (
				<p className="stream-error">停在那里：{view.stoppedAt}</p>
			)}
			<ol className="run-steps">
				{view.rows.map((row) => (
					<li key={row.seq} className="run-step">
						<span className="run-seq">#{row.seq}</span>
						<span className="run-label">{row.label}</span>
						<span className="run-detail">{row.detail}</span>
					</li>
				))}
			</ol>
		</>
	);
}

import type { ChannelProbeResult } from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { type RunTimelineView, buildRunTimeline } from "../chat/run-timeline";
import { RerollStats } from "./RerollStats";
import { errorText, formatTokens, sp, useLoad } from "./ui";

// 检视器：研发与排障用的数字都在这里，一级界面不放（v5 §8.1）。

interface FloorCost {
	readonly nodeId: string;
	readonly no: number;
	readonly cost: {
		readonly input: number | null;
		readonly output: number | null;
		readonly cached: number | null;
		readonly waitMs: number | null;
		readonly mode: string;
	} | null;
}

interface ContextBreakdown {
	readonly breakdown: {
		readonly totalTokens: number;
		readonly categories: readonly {
			readonly id: string;
			readonly label: string;
			readonly tokens: number;
		}[];
	} | null;
}

interface Rejection {
	readonly id: number;
	readonly kind: string;
	readonly text: string;
	readonly reason: string;
}

const ROLES = [
	{ role: "writer", label: "正文" },
	{ role: "settler", label: "记忆整理" },
	{ role: "planner", label: "规划" },
] as const;

const MODE_LABEL: Readonly<Record<string, string>> = {
	fast: "快速",
	plan: "规划",
	deep: "深度",
};

const SUPPORT: Readonly<Record<string, string>> = {
	supported: "支持",
	unsupported: "不支持",
	unknown: "未知",
	streaming: "流式",
	buffered: "整段",
};

function average(count: number, floors: number): string {
	return floors === 0 ? "—" : (count / floors).toFixed(1);
}

export function Inspector({
	storyId,
	onClose,
}: {
	readonly storyId: string | null;
	readonly onClose: () => void;
}) {
	useEffect(() => {
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [onClose]);

	return (
		<>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: Esc 在窗口上处理 */}
			<div className="inspscrim" aria-hidden="true" onClick={onClose} />
			{/* biome-ignore lint/a11y/useSemanticElements: 抽屉随状态挂载，不用 dialog 元素的开合接口 */}
			<aside className="inspector" role="dialog" aria-label="检视器">
				<header>
					<h2>检视器</h2>
					<button
						type="button"
						className="btn ghost sm"
						aria-label="关闭检视器"
						onClick={onClose}
					>
						✕
					</button>
				</header>
				{storyId === null ? null : <StoryInspector storyId={storyId} />}
				<ProbeSection />
			</aside>
		</>
	);
}

function StoryInspector({ storyId }: { readonly storyId: string }) {
	const floors = useLoad<{ floors: readonly FloorCost[] }>(
		() => api.get(sp(storyId, "/floors")),
		[storyId],
	);
	const context = useLoad<ContextBreakdown>(
		() => api.get(sp(storyId, "/context")),
		[storyId],
	);
	const jobs = useLoad(() => api.getJobs(storyId), [storyId]);
	const memory = useLoad<{ rejections: readonly Rejection[] }>(
		() => api.get(sp(storyId, "/memory")),
		[storyId],
	);
	const last = [...(floors.data?.floors ?? [])]
		.reverse()
		.find((floor) => floor.cost !== null);
	const cost = last?.cost ?? null;
	const breakdown = context.data?.breakdown ?? null;
	const calls = jobs.data?.calls;
	const counts = jobs.data?.counts;

	return (
		<>
			<section aria-label="本轮">
				<h3>本轮{last === undefined ? "" : ` · 第 ${last.no} 楼`}</h3>
				{cost === null ? (
					<p className="muted">暂无</p>
				) : (
					<dl>
						<dt>写法</dt>
						<dd>{MODE_LABEL[cost.mode] ?? cost.mode}</dd>
						<dt>输入</dt>
						<dd className="num">{formatTokens(cost.input)}</dd>
						<dt>输出</dt>
						<dd className="num">{formatTokens(cost.output)}</dd>
						<dt>缓存命中</dt>
						<dd className="num">
							{cost.cached !== null && cost.input !== null && cost.input > 0
								? `${Math.round((cost.cached / cost.input) * 100)}%`
								: "—"}
						</dd>
						<dt>耗时</dt>
						<dd className="num">
							{cost.waitMs === null
								? "—"
								: `${(cost.waitMs / 1000).toFixed(1)} 秒`}
						</dd>
					</dl>
				)}
			</section>
			{last === undefined ? null : (
				<RunSection key={last.nodeId} nodeId={last.nodeId} />
			)}
			<section aria-label="上下文">
				<h3>
					上下文
					{breakdown === null
						? ""
						: ` · ${formatTokens(breakdown.totalTokens)}`}
				</h3>
				{breakdown === null ? (
					<p className="muted">暂无</p>
				) : (
					<dl>
						{breakdown.categories.map((item) => (
							<div key={item.id}>
								<dt>{item.label}</dt>
								<dd className="num">{formatTokens(item.tokens)}</dd>
							</div>
						))}
					</dl>
				)}
			</section>
			<section aria-label="后台任务">
				<h3>后台任务</h3>
				{counts === undefined || calls === undefined ? (
					<p className="muted">暂无</p>
				) : (
					<>
						<dl>
							<dt>等待 / 进行</dt>
							<dd className="num">
								{counts.pending} / {counts.running}
							</dd>
							<dt>完成 / 失败</dt>
							<dd className="num">
								{counts.done} / {counts.failed}
							</dd>
							<dt>每楼调用</dt>
							<dd className="num">
								{average(calls.perFloor, calls.floors)}（{calls.floors} 楼）
							</dd>
							<dt>每楼 token</dt>
							<dd className="num">
								{calls.floors === 0
									? "—"
									: formatTokens(
											Math.round(calls.perFloorTokens / calls.floors),
										)}
							</dd>
							<dt>一次性导入</dt>
							<dd className="num">{calls.oneTime}</dd>
							<dt>插图</dt>
							<dd className="num">{calls.images}</dd>
						</dl>
						{(jobs.data?.recentErrors ?? []).length > 0 ? (
							<ul className="insplist">
								{jobs.data?.recentErrors.map((item) => (
									<li key={item.jobId}>
										<b>{item.kind}</b> {item.error}
									</li>
								))}
							</ul>
						) : null}
					</>
				)}
			</section>
			<section aria-label="拒收">
				<h3>拒收</h3>
				{(memory.data?.rejections ?? []).length === 0 ? (
					<p className="muted">无</p>
				) : (
					<ul className="insplist">
						{memory.data?.rejections.map((item) => (
							<li key={item.id}>
								<b>{item.reason}</b> {item.text}
							</li>
						))}
					</ul>
				)}
			</section>
			<section aria-label="重写率" className="insprr">
				<RerollStats storyId={storyId} />
			</section>
		</>
	);
}

/** 这一楼的运行记录：模型请求、工具调用、草稿与追加要求。快速写法不写运行记录。 */
function RunSection({ nodeId }: { readonly nodeId: string }) {
	const [view, setView] = useState<RunTimelineView | "none" | string | null>(
		null,
	);
	useEffect(() => {
		let active = true;
		api
			.getNodeRun(nodeId)
			.then((run) => {
				if (active) setView(buildRunTimeline(run));
			})
			.catch((error: unknown) => {
				if (!active) return;
				setView(
					error instanceof ApiError && error.status === 404
						? "none"
						: errorText(error),
				);
			});
		return () => {
			active = false;
		};
	}, [nodeId]);
	if (view === null || view === "none") return null;
	return (
		<section aria-label="运行记录">
			<h3>运行记录 · {typeof view === "string" ? "" : view.statusLabel}</h3>
			{typeof view === "string" ? (
				<p className="v4err">{view}</p>
			) : (
				<ol className="insplist run-steps">
					{view.rows.map((row) => (
						<li key={row.seq}>
							<b>{row.label}</b> {row.detail}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function ProbeSection() {
	const [results, setResults] = useState<
		Readonly<Record<string, ChannelProbeResult | string>>
	>({});
	const [busy, setBusy] = useState<string | null>(null);

	const probe = async (role: (typeof ROLES)[number]["role"]) => {
		setBusy(role);
		try {
			const result = await api.probeChannel({ role });
			setResults((current) => ({ ...current, [role]: result }));
		} catch (error) {
			setResults((current) => ({ ...current, [role]: errorText(error) }));
		} finally {
			setBusy(null);
		}
	};

	return (
		<section aria-label="渠道体检">
			<h3>渠道体检</h3>
			{ROLES.map(({ role, label }) => {
				const result = results[role];
				return (
					<div className="insprobe" key={role}>
						<div>
							<span>{label}</span>
							<button
								type="button"
								className="btn ghost sm"
								disabled={busy !== null}
								onClick={() => void probe(role)}
							>
								{busy === role ? "体检中…" : "体检"}
							</button>
						</div>
						{result === undefined ? null : typeof result === "string" ? (
							<p className="v4err">{result}</p>
						) : (
							<dl>
								<dt>模型</dt>
								<dd>
									{result.alias} · {result.channel}
								</dd>
								<dt>流式</dt>
								<dd>{SUPPORT[result.probe.streaming]}</dd>
								<dt>工具调用</dt>
								<dd>{SUPPORT[result.probe.functionCalling]}</dd>
								<dt>思考</dt>
								<dd>{SUPPORT[result.probe.thinking]}</dd>
								<dt>缓存统计</dt>
								<dd>{SUPPORT[result.probe.cacheStats]}</dd>
							</dl>
						)}
					</div>
				);
			})}
		</section>
	);
}

import type { StoryView } from "@dramaticer/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { api } from "../api";
import {
	AssistantDrawer,
	type AssistantSummary,
	EMPTY_ASSISTANT_SUMMARY,
} from "../assistant/AssistantDrawer";
import type { StoryAssistantContext } from "../assistant/context";
import { ErrorNotice } from "../components/ErrorNotice";

const TABS = [
	{ path: "chat", label: "聊天" },
	{ path: "import", label: "导入" },
	{ path: "audit", label: "体检" },
	{ path: "branches", label: "分支" },
	{ path: "ledger", label: "台账" },
	{ path: "serial", label: "连载" },
	{ path: "director", label: "导演" },
	{ path: "images", label: "生图" },
	{ path: "settings", label: "设置" },
] as const;

export function StoryTool() {
	const { storyId } = useParams();
	const [story, setStory] = useState<StoryView | null>(null);
	const [error, setError] = useState<unknown>(null);
	const [assistantOpen, setAssistantOpen] = useState(false);
	const [assistantSummary, setAssistantSummary] = useState<AssistantSummary>(
		EMPTY_ASSISTANT_SUMMARY,
	);
	const assistantOpenRef = useRef(false);
	assistantOpenRef.current = assistantOpen;
	const assistantWasOpenRef = useRef(false);

	const openAssistant = useCallback(() => {
		setAssistantOpen(true);
	}, []);

	const closeAssistant = useCallback(() => {
		setAssistantOpen(false);
	}, []);

	const assistantContext = useMemo<StoryAssistantContext>(
		() => ({ openAssistant }),
		[openAssistant],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				if (!assistantOpenRef.current) return;
				setAssistantOpen(false);
				return;
			}
			if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "a") {
				event.preventDefault();
				setAssistantOpen(!assistantOpenRef.current);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	// 隐藏抽屉后浏览器会把焦点退到 body；等这一帧结束再把焦点送回触发按钮。
	useEffect(() => {
		if (assistantWasOpenRef.current && !assistantOpen) {
			const frame = requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					document
						.querySelector<HTMLButtonElement>(".assistant-open-button")
						?.focus();
				});
			});
			assistantWasOpenRef.current = assistantOpen;
			return () => cancelAnimationFrame(frame);
		}
		assistantWasOpenRef.current = assistantOpen;
	}, [assistantOpen]);

	useEffect(() => {
		if (storyId === undefined) return;
		setAssistantSummary(EMPTY_ASSISTANT_SUMMARY);
		setAssistantOpen(false);
	}, [storyId]);

	useEffect(() => {
		if (storyId === undefined) return;
		let active = true;
		setStory(null);
		setError(null);
		api
			.getStory(storyId)
			.then((value) => {
				if (active) setStory(value);
			})
			.catch((value: unknown) => {
				if (active) setError(value);
			});
		return () => {
			active = false;
		};
	}, [storyId]);

	if (storyId === undefined) {
		return (
			<section className="panel">
				<p>地址里缺少故事 id。</p>
			</section>
		);
	}

	return (
		<div className="story-layout">
			<aside className="story-sidebar">
				<div className="story-heading">
					<Link className="muted" to="/">
						返回故事列表
					</Link>
					<div className="story-title-row">
						<img
							className="story-cover story-cover-title"
							src={api.storyCoverUrl(storyId)}
							alt={`${story?.title ?? "故事"} 的封面`}
							width={240}
							height={360}
						/>
						<div>
							<h1>{story?.title ?? "故事"}</h1>
							<p className="muted story-id">{storyId}</p>
						</div>
					</div>
				</div>
				<ErrorNotice error={error} />
				<nav className="story-tabs" aria-label="故事面板">
					{TABS.map((tab) => (
						<NavLink
							key={tab.path}
							to={tab.path}
							className={({ isActive }) =>
								isActive ? "story-tab active" : "story-tab"
							}
						>
							{tab.label}
						</NavLink>
					))}
				</nav>
			</aside>
			<section className="story-content">
				<Outlet context={assistantContext} />
			</section>
			<AssistantDrawer
				key={storyId}
				storyId={storyId}
				open={assistantOpen}
				onClose={closeAssistant}
				onSummaryChange={setAssistantSummary}
			/>
			{assistantOpen ? null : (
				<button
					type="button"
					className={assistantBadgeClass(assistantSummary)}
					onClick={openAssistant}
					aria-label="打开助手"
				>
					<span>{assistantBadgeLabel(assistantSummary)}</span>
					{assistantSummary.pendingActions > 0 ? (
						<span className="assistant-badge-count">
							{assistantSummary.pendingActions}
						</span>
					) : null}
				</button>
			)}
		</div>
	);
}

function assistantBadgeClass(summary: AssistantSummary): string {
	if (summary.running) return "assistant-badge running";
	if (summary.failed) return "assistant-badge failed";
	return "assistant-badge";
}

function assistantBadgeLabel(summary: AssistantSummary): string {
	if (summary.running) return "助手运行中";
	if (summary.failed) return "助手失败";
	return "助手";
}

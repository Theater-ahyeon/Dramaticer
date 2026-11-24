import type { StoryView } from "@dramaticer/protocol";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { api } from "../api";
import type { StoryAssistantContext } from "../assistant/context";
import { ErrorNotice } from "../components/ErrorNotice";
import { useShellActions } from "./shell-actions";

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
	const { openAssistant } = useShellActions();
	const assistantContext = useMemo<StoryAssistantContext>(
		() => ({ openAssistant }),
		[openAssistant],
	);
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
		</div>
	);
}

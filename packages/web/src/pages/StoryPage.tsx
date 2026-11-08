import type { StoryView } from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice } from "../components/ErrorNotice";

const TABS = [
	{ path: "chat", label: "聊天" },
	{ path: "branches", label: "分支" },
	{ path: "ledger", label: "台账" },
	{ path: "director", label: "导演" },
	{ path: "settings", label: "设置" },
	{ path: "channels", label: "渠道" },
] as const;

export function StoryPage() {
	const { storyId } = useParams();
	const [story, setStory] = useState<StoryView | null>(null);
	const [error, setError] = useState<unknown>(null);

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
					<h1>{story?.title ?? "故事"}</h1>
					<p className="muted story-id">{storyId}</p>
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
				<Outlet />
			</section>
		</div>
	);
}

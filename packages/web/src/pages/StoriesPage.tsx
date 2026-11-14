import type { StoryView } from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorNotice } from "../components/ErrorNotice";

export function StoriesPage() {
	const [stories, setStories] = useState<readonly StoryView[] | null>(null);
	const [error, setError] = useState<unknown>(null);

	useEffect(() => {
		let active = true;
		api
			.listStories()
			.then((value) => {
				if (active) setStories(value);
			})
			.catch((value: unknown) => {
				if (active) setError(value);
			});
		return () => {
			active = false;
		};
	}, []);

	return (
		<section className="panel">
			<header className="panel-header">
				<h1>故事</h1>
				<Link to="/login">登录</Link>
			</header>
			<ErrorNotice error={error} />
			{stories === null ? (
				<p className="muted">正在读取故事…</p>
			) : stories.length === 0 ? (
				<p className="muted">还没有故事。用命令行创建，或导入一张角色卡。</p>
			) : (
				<ul className="story-list">
					{stories.map((story) => (
						<li key={story.id}>
							<Link to={`/stories/${encodeURIComponent(story.id)}`}>
								<img
									className="story-cover"
									src={api.storyCoverUrl(story.id)}
									alt={`${story.title} 的封面`}
									width={240}
									height={360}
								/>
								<span className="story-card-text">
									<span className="story-title">{story.title}</span>
									<span className="muted">
										{story.headNodeId === null ? "还没有楼层" : "已有楼层"}
									</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

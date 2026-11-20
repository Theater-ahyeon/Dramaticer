import type { StoryView } from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { NewStoryDialog } from "./NewStoryDialog";
import { Cover, Num, TLink, sp, useLoad } from "./ui";

interface Overview {
	readonly storyId: string;
	readonly floors: number;
	readonly chapter: number;
	readonly lines: number;
	readonly openPromises: number;
	readonly recap: string;
	readonly updatedAt: string | null;
}

function ago(iso: string | null): string {
	if (iso === null) return "还没开始";
	const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
	if (days <= 0) return "今天";
	return `${days} 天前`;
}

/** 书架：最近写过的故事放在最上面，其余排成书脊；卡面图来自卡片本身。 */
export function Library() {
	const stories = useLoad(() => api.listStories(), []);
	const channels = useLoad(() => api.getChannels(), []);
	const needsModel =
		channels.data !== null && channels.data.roles.writer === null;
	const [creating, setCreating] = useState(false);
	const [overviews, setOverviews] = useState<ReadonlyMap<string, Overview>>(
		new Map(),
	);

	useEffect(() => {
		if (stories.data === null) return;
		let active = true;
		Promise.all(
			stories.data.map((story) =>
				api.get<Overview>(sp(story.id, "/overview")).catch(() => null),
			),
		).then((list) => {
			if (!active) return;
			const map = new Map<string, Overview>();
			for (const item of list) if (item !== null) map.set(item.storyId, item);
			setOverviews(map);
		});
		return () => {
			active = false;
		};
	}, [stories.data]);

	if (stories.error !== null) {
		return (
			<section data-view="library">
				<div className="v4err">{stories.error}</div>
				<p className="v4empty">
					需要登录的话去 <Link to="/login">登录</Link>。
				</p>
			</section>
		);
	}
	if (stories.data === null) {
		return <p className="v4empty">正在读取书架…</p>;
	}

	const sorted = [...stories.data].sort((left, right) => {
		const a = overviews.get(left.id)?.updatedAt ?? left.createdAt;
		const b = overviews.get(right.id)?.updatedAt ?? right.createdAt;
		return a < b ? 1 : a > b ? -1 : 0;
	});
	const [latest, ...rest] = sorted;
	const link = (story: StoryView) =>
		`/stories/${encodeURIComponent(story.id)}/play`;
	const latestOverview =
		latest === undefined ? undefined : overviews.get(latest.id);

	return (
		<section data-view="library">
			<div className="lib-bar">
				<button
					type="button"
					className="btn gold"
					onClick={() => setCreating(true)}
				>
					＋ 新建故事
				</button>
			</div>
			{creating ? <NewStoryDialog onClose={() => setCreating(false)} /> : null}
			{needsModel ? (
				<output className="setup-banner">
					<span>还没有连接模型，连接后才能开始写。</span>
					<TLink className="btn gold sm" to="/settings">
						连接模型
					</TLink>
				</output>
			) : null}
			{latest === undefined ? null : (
				<div className="hero">
					<TLink
						className="hero-cover"
						to={link(latest)}
						aria-label={`打开${latest.title}`}
						tabIndex={-1}
					>
						<Cover storyId={latest.id} title={latest.title} />
					</TLink>
					<div className="hero-body">
						<span className="label">
							继续上次 · 第 {latestOverview?.chapter ?? 1} 章
						</span>
						<h1>{latest.title}</h1>
						<p className="recap">
							{latestOverview === undefined || latestOverview.recap === ""
								? "暂无内容"
								: latestOverview.recap}
						</p>
						<div className="stats">
							<span>
								<b>
									<Num value={latestOverview?.floors ?? 0} />
								</b>
								楼
							</span>
							<span>
								<b>
									<Num value={latestOverview?.lines ?? 0} />
								</b>
								条剧情线在走
							</span>
							<span>
								<b>
									<Num value={latestOverview?.openPromises ?? 0} />
								</b>
								个伏笔没收
							</span>
							<span>{ago(latestOverview?.updatedAt ?? null)}</span>
						</div>
						<TLink className="btn gold lg" to={link(latest)}>
							接着写 ▸
						</TLink>
					</div>
				</div>
			)}
			<div className="shelf">
				{rest.map((story, index) => {
					const overview = overviews.get(story.id);
					return (
						<TLink
							className="book"
							to={link(story)}
							key={story.id}
							style={{ "--n": Math.min(index, 10) } as React.CSSProperties}
						>
							<Cover storyId={story.id} title={story.title} />
							<div>
								<span className="label">
									第 {overview?.chapter ?? 1} 章 · {overview?.floors ?? 0} 楼
								</span>
								<h2>{story.title}</h2>
								<p>{overview?.recap ?? ""}</p>
							</div>
						</TLink>
					);
				})}
				<NewStoryCard onOpen={() => setCreating(true)} />
			</div>
		</section>
	);
}

function NewStoryCard({ onOpen }: { readonly onOpen: () => void }) {
	return (
		<button type="button" className="book add" onClick={onOpen}>
			<span className="plus" aria-hidden="true">
				＋
			</span>
			<h2>新建故事</h2>
			<p>导入角色卡，或空白开局</p>
		</button>
	);
}

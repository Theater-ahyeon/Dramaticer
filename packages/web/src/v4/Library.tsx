import type { StoryView } from "@dramaticer/protocol";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
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
		`/stories/${encodeURIComponent(story.id)}/${story.headNodeId === null ? "import" : "play"}`;
	const latestOverview =
		latest === undefined ? undefined : overviews.get(latest.id);

	return (
		<section data-view="library">
			{latest === undefined ? null : (
				<div className="hero">
					<img
						className="hero-amb"
						src={api.storyCoverUrl(latest.id)}
						alt=""
						aria-hidden="true"
					/>
					<TLink
						className="hero-cover tilt"
						to={link(latest)}
						aria-label={`打开${latest.title}`}
						tabIndex={-1}
					>
						<Cover storyId={latest.id} title={latest.title} />
						<span className="shine" />
					</TLink>
					<span className="hero-no" aria-hidden="true">
						{String(latestOverview?.chapter ?? 1).padStart(2, "0")}
					</span>
					<div className="hero-body">
						<span className="label">
							继续上次 · 第 {latestOverview?.chapter ?? 1} 章
						</span>
						<h1>{latest.title}</h1>
						<p className="recap">
							{latestOverview === undefined || latestOverview.recap === ""
								? "还没有写下第一楼。导入一张卡，或者直接开始。"
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
				<NewStory onCreated={stories.reload} />
			</div>
		</section>
	);
}

function NewStory({ onCreated }: { readonly onCreated: () => void }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const create = async () => {
		const title = window.prompt("给新故事起个名字（之后可以改）", "新故事");
		if (title === null || title.trim() === "") return;
		setBusy(true);
		try {
			const story = await api.createStory({ title: title.trim() });
			window.location.assign(`/stories/${encodeURIComponent(story.id)}/import`);
		} catch (value) {
			setError(value instanceof Error ? value.message : String(value));
			setBusy(false);
			onCreated();
		}
	};
	return (
		<button type="button" className="book add" onClick={create} disabled={busy}>
			<span className="plus" aria-hidden="true">
				＋
			</span>
			<h2>导入一张卡</h2>
			<p>卡、世界书、聊天记录都能带进来</p>
			{error === null ? null : <p className="v4err">{error}</p>}
		</button>
	);
}

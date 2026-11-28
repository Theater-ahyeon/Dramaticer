import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { DirectionPanel } from "./Direction";
import {
	Editable,
	Seg,
	formatTokens,
	parseValue,
	showValue,
	sp,
	useAct,
	useLoad,
} from "./ui";

export type DockTab = "dir" | "mem" | "ctx";

interface DockView {
	readonly present: readonly {
		readonly name: string;
		readonly pageId: string | null;
		readonly want: string | null;
		readonly hides: readonly string[];
		readonly now: readonly {
			readonly target: string;
			readonly path: readonly string[];
			readonly item: string;
			readonly value: unknown;
		}[];
	}[];
	readonly secrets: readonly {
		readonly id: string;
		readonly text: string;
		readonly unaware: readonly string[];
	}[];
	readonly soon: readonly {
		readonly pageId: string;
		readonly name: string;
		readonly floorsAgo: number;
	}[];
}

type ContextSource =
	| { readonly kind: "lore"; readonly id: string; readonly name: string }
	| {
			readonly kind: "record";
			readonly ids: readonly string[];
			readonly nodeId: string;
			readonly floorNo: number;
	  }
	| { readonly kind: "wiki"; readonly id: string; readonly name: string }
	| { readonly kind: "state"; readonly target: string; readonly label: string }
	| {
			readonly kind: "floor";
			readonly nodeId: string;
			readonly floorNo: number;
	  }
	| { readonly kind: "scene"; readonly nodeId: string }
	| { readonly kind: "summary"; readonly id: string }
	| { readonly kind: "pref"; readonly id: string }
	| { readonly kind: "card"; readonly id: "character" | "persona" }
	| { readonly kind: "outline"; readonly id: string }
	| { readonly kind: "slot"; readonly slot: string }
	| { readonly kind: "segment"; readonly segmentId: string }
	| {
			readonly kind: "canon";
			readonly bookId: string;
			readonly eventId: number;
			readonly chapterOrdinal: number;
	  };

interface ContextItemView {
	readonly label: string;
	readonly tokens: number;
	readonly page: string;
	readonly tab: string | null;
	readonly source: ContextSource;
}

interface ContextView {
	readonly breakdown: {
		readonly totalTokens: number;
		readonly categories: readonly {
			readonly id: string;
			readonly label: string;
			readonly tokens: number;
			readonly items: readonly ContextItemView[];
		}[];
	} | null;
}

/** 这一条在哪个页面、哪一处能改；拿不到具体对象时回到它所属的分页。 */
function contextHref(base: string, item: ContextItemView): string {
	const source = item.source;
	switch (source.kind) {
		case "lore":
			return `${base}/lore?entry=${encodeURIComponent(source.id)}`;
		case "wiki":
			return `${base}/memory?tab=wiki&page=${encodeURIComponent(source.id)}`;
		case "state":
			return `${base}/memory?tab=state&focus=${encodeURIComponent(source.target)}`;
		case "summary":
			return `${base}/memory?tab=line&focus=${encodeURIComponent(source.id)}`;
		case "pref":
			return `${base}/memory?tab=rule&focus=${encodeURIComponent(source.id)}`;
		case "outline":
			return `${base}/outline?focus=${encodeURIComponent(source.id)}`;
		case "floor":
		case "scene":
			return `${base}/play?node=${encodeURIComponent(source.nodeId)}`;
		case "card":
			return `${base}/prefs?tab=model`;
		case "canon":
			return `${base}/memory?tab=canon&event=${source.eventId}`;
		default:
			return `${base}/${item.page}${item.tab === null ? "" : `?tab=${item.tab}`}`;
	}
}

const CTX_COLOR: Record<string, string> = {
	pref: "--ctx-pref",
	timeline: "--ctx-timeline",
	raw: "--ctx-raw",
	state: "--ctx-state",
	record: "--ctx-record",
	wiki: "--ctx-wiki",
	lore: "--ctx-lore",
	director: "--ctx-director",
	other: "--ctx-other",
};

/** 故事页右侧的停靠栏：导演、记忆、上下文三页。 */
export function Dock({
	storyId,
	tab,
	onTab,
	tick,
	onChanged,
}: {
	readonly storyId: string;
	readonly tab: DockTab;
	readonly onTab: (tab: DockTab) => void;
	readonly tick: number;
	readonly onChanged: () => void;
}) {
	const act = useAct();
	const memory = useLoad<DockView>(
		() => api.get(sp(storyId, "/dock")),
		[storyId, tick],
	);
	const context = useLoad<ContextView>(
		() => api.get(sp(storyId, "/context")),
		[storyId, tick],
	);
	const [category, setCategory] = useState<string | null>(null);

	const categories = context.data?.breakdown?.categories ?? [];
	useEffect(() => {
		if (category === null && categories[0] !== undefined) {
			setCategory(categories[0].id);
		}
	}, [category, categories]);

	const base = `/stories/${encodeURIComponent(storyId)}`;
	const active = categories.find((item) => item.id === category) ?? null;

	return (
		<aside className="dock" id="dock">
			<div className="tabs" role="tablist">
				{(
					[
						["dir", "导演"],
						["mem", "记忆"],
						["ctx", "上下文"],
					] as const
				).map(([id, label]) => (
					<button
						type="button"
						role="tab"
						key={id}
						aria-selected={tab === id}
						onClick={() => onTab(id)}
					>
						{label}
					</button>
				))}
			</div>

			{tab === "dir" ? (
				<div className="sec">
					<DirectionPanel
						storyId={storyId}
						compact
						tick={tick}
						onChanged={onChanged}
					/>
				</div>
			) : null}

			{tab === "mem" ? (
				<div className="sec">
					<div className="label">
						<span>在场</span>
						<Link
							to={`${base}/memory`}
							className="btn ghost sm"
							style={{ textDecoration: "none" }}
						>
							打开记忆 ›
						</Link>
					</div>
					{(memory.data?.present ?? []).map((person) => (
						<div className="card who-card" key={person.name}>
							<h3>{person.name}</h3>
							<dl>
								{person.want === null ? null : (
									<>
										<dt>想要</dt>
										<dd>{person.want}</dd>
									</>
								)}
								{person.hides.length === 0 ? null : (
									<>
										<dt>瞒着</dt>
										<dd>{person.hides.join("；")}</dd>
									</>
								)}
								{person.now.map((item) => (
									<span key={item.target} style={{ display: "contents" }}>
										<dt>{item.item}</dt>
										<Editable
											as="dd"
											value={showValue(item.value)}
											onCommit={(text) =>
												act(
													() =>
														api.call("POST", sp(storyId, "/memory/state"), {
															path: item.path,
															value: parseValue(text, item.value),
														}),
													"已保存并锁定，下一轮生效",
												)
											}
										/>
									</span>
								))}
							</dl>
						</div>
					))}
					{memory.data !== null && memory.data.present.length === 0 ? (
						<p className="v4empty flush">自动记录还没有记下这一场谁在场。</p>
					) : null}
					<div className="label">
						<span>秘密</span>
					</div>
					<div className="rows">
						{(memory.data?.secrets ?? []).length === 0 &&
						memory.data !== null ? (
							<p className="muted fine">暂无</p>
						) : (
							(memory.data?.secrets ?? []).map((secret) => (
								<div key={secret.id}>
									<span>{secret.text}</span>
									<span>{secret.unaware.join("、")}不知道</span>
								</div>
							))
						)}
					</div>
					<div className="label">
						<span>快要相关</span>
					</div>
					<div className="rows">
						{(memory.data?.soon ?? []).length === 0 && memory.data !== null ? (
							<p className="muted fine">暂无</p>
						) : (
							(memory.data?.soon ?? []).map((person) => (
								<div key={person.pageId}>
									<span>{person.name}</span>
									<span>{person.floorsAgo} 楼没出场</span>
								</div>
							))
						)}
					</div>
				</div>
			) : null}

			{tab === "ctx" ? (
				<div className="sec">
					<div className="label">
						<span>本轮上下文</span>
						{context.data?.breakdown === null ||
						context.data?.breakdown === undefined ? null : (
							<span className="num">
								共 {formatTokens(context.data.breakdown.totalTokens)}
							</span>
						)}
					</div>
					{context.data !== null && context.data.breakdown === null ? (
						<p className="v4empty flush">暂无</p>
					) : null}
					<div className="ctxbar">
						{categories.map((item) => (
							<button
								type="button"
								key={item.id}
								style={{
									flex: Math.max(item.tokens, 1),
									background: `var(${CTX_COLOR[item.id] ?? "--soft"})`,
								}}
								title={item.label}
								aria-label={item.label}
								aria-pressed={item.id === category}
								onClick={() => setCategory(item.id)}
							/>
						))}
					</div>
					{categories.length === 0 ? null : (
						<div className="ctxlegend" aria-label="上下文分类图例">
							{categories.map((item) => (
								<span
									key={item.id}
									className="legenditem"
									data-active={item.id === category || undefined}
								>
									<i
										style={{
											background: `var(${CTX_COLOR[item.id] ?? "--soft"})`,
										}}
									/>
									<span>{item.label}</span>
									<span className="num">{formatTokens(item.tokens)}</span>
								</span>
							))}
						</div>
					)}
					<div className="rows ctxitems">
						{active === null ? null : (
							<>
								<div>
									<span>
										<b>{active.label}</b>
									</span>
								</div>
								{active.items.map((item, index) => (
									<div key={`${item.label}-${index}`}>
										<span>{item.label}</span>
										<span>
											<Link
												className="btn ghost sm"
												style={{ textDecoration: "none" }}
												to={contextHref(base, item)}
											>
												去修改 ›
											</Link>
										</span>
									</div>
								))}
							</>
						)}
					</div>
				</div>
			) : null}
		</aside>
	);
}

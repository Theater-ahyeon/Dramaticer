import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
	Clock,
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

interface Line {
	readonly id: string;
	readonly kind: "main" | "relationship" | "opposition" | "promise";
	readonly who: string;
	readonly want: string;
	readonly obstacle: string;
	readonly countdown: number | null;
	readonly preparations: readonly string[];
	readonly mustInterrupt?: boolean;
	readonly remaining: number | null;
	readonly lastTouchedDepth: number;
	readonly muted: boolean;
	readonly pinned: boolean;
	readonly locked: boolean;
	readonly by: "player" | "ai";
}

interface LinesView {
	readonly lines: readonly Line[];
	readonly maxOpenPromises: number;
}

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
	readonly sceneGoal: {
		readonly nodeId: string;
		readonly present: readonly {
			readonly who: string;
			readonly want: string;
		}[];
		readonly change: string;
		readonly source: "player" | "ai";
		readonly locked: boolean;
	} | null;
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
	| { readonly kind: "segment"; readonly segmentId: string };

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

const KIND_LABEL: Record<Line["kind"], { text: string; pill: string }> = {
	main: { text: "主线", pill: "gold" },
	relationship: { text: "人物", pill: "teal" },
	opposition: { text: "对手", pill: "gold" },
	promise: { text: "伏笔", pill: "mute" },
};

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
		default:
			return `${base}/${item.page}${item.tab === null ? "" : `?tab=${item.tab}`}`;
	}
}

const CTX_COLOR: Record<string, string> = {
	pref: "--gold",
	timeline: "--muted",
	raw: "--line",
	state: "--teal",
	record: "--ok",
	wiki: "--ok",
	lore: "--bad",
	director: "--gold-ink",
	other: "--soft",
};

type DirectorWhen = "off" | "push" | "always";

interface EditHistoryView {
	readonly edits: readonly {
		readonly id: number;
		readonly source: "player" | "restore" | "ai" | "rejected";
		readonly note: string | null;
		readonly createdAt: string;
	}[];
}

/** 规划对象的修改历史：玩家改过的每一版都能回到。 */
function EditHistory({
	storyId,
	kind,
	target,
	onRollback,
}: {
	readonly storyId: string;
	readonly kind: "line" | "scene";
	readonly target: string;
	readonly onRollback: () => void;
}) {
	const act = useAct();
	const history = useLoad<EditHistoryView>(
		() =>
			api.get(
				sp(
					storyId,
					`/memory/history?kind=${kind}&target=${encodeURIComponent(target)}`,
				),
			),
		[storyId, kind, target],
	);
	const versions = (history.data?.edits ?? []).filter(
		(edit) => edit.source !== "rejected",
	);
	if (versions.length === 0) {
		return <div className="hist">还没有你改过的版本。</div>;
	}
	return (
		<div className="hist">
			{[...versions].reverse().map((edit) => (
				<span key={edit.id}>
					{new Date(edit.createdAt).toLocaleString()} ·{" "}
					{edit.source === "player" ? "你" : "自动"}
					{edit.note === null ? "" : ` · ${edit.note}`}{" "}
					<button
						type="button"
						onClick={() =>
							act(
								() =>
									api.call("POST", sp(storyId, "/memory/rollback"), {
										editId: edit.id,
									}),
								() => onRollback(),
							)
						}
					>
						回到这一版
					</button>
				</span>
			))}
		</div>
	);
}

/** 故事页右侧的停靠栏：导演、记忆、上下文三页。 */
export function Dock({
	storyId,
	tab,
	onTab,
	tick,
	moves,
	onChanged,
}: {
	readonly storyId: string;
	readonly tab: DockTab;
	readonly onTab: (tab: DockTab) => void;
	readonly tick: number;
	readonly moves: readonly {
		key: string;
		label: string;
		no: number;
		nodeId: string;
		undoLineId?: string;
	}[];
	readonly onChanged: () => void;
}) {
	const act = useAct();
	const lines = useLoad<LinesView>(
		() => api.get(sp(storyId, "/director/lines")),
		[storyId, tick],
	);
	const features = useLoad(
		() => api.getStoryFeatures(storyId),
		[storyId, tick],
	);
	const memory = useLoad<DockView>(
		() => api.get(sp(storyId, "/dock")),
		[storyId, tick],
	);
	const context = useLoad<ContextView>(
		() => api.get(sp(storyId, "/context")),
		[storyId, tick],
	);
	const [category, setCategory] = useState<string | null>(null);
	const [adding, setAdding] = useState<string | null>(null);
	const [history, setHistory] = useState<string | null>(null);

	const categories = context.data?.breakdown?.categories ?? [];
	useEffect(() => {
		if (category === null && categories[0] !== undefined) {
			setCategory(categories[0].id);
		}
	}, [category, categories]);

	const when = (features.data?.groups
		.flatMap((group) => group.switches)
		.find((item) => item.id === "director")?.value ?? "push") as DirectorWhen;

	const base = `/stories/${encodeURIComponent(storyId)}`;
	const saveLine = (line: Line, patch: Partial<Line>) =>
		act(
			() =>
				api.call("POST", sp(storyId, "/director/line"), {
					line: {
						id: line.id,
						kind: line.kind,
						who: line.who,
						want: line.want,
						obstacle: line.obstacle,
						countdown: line.countdown,
						preparations: line.preparations,
						...(line.mustInterrupt === true ? { mustInterrupt: true } : {}),
						...patch,
					},
				}),
			() => {
				lines.reload();
				onChanged();
			},
		);

	const saveScene = (patch: { change?: string; locked?: boolean }) =>
		act(
			() =>
				api.call("POST", sp(storyId, "/director/scene"), {
					...patch,
				}),
			() => {
				memory.reload();
				onChanged();
			},
		);

	const threads = (lines.data?.lines ?? [])
		.filter((line) => line.kind !== "promise")
		.sort((left, right) =>
			left.pinned === right.pinned ? 0 : left.pinned ? -1 : 1,
		);
	const promises = (lines.data?.lines ?? []).filter(
		(line) => line.kind === "promise",
	);
	const sceneGoal = memory.data?.sceneGoal ?? null;
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
					<div className="label">
						<span>导演何时出手</span>
						<Seg<DirectorWhen>
							small
							label="导演何时出手"
							value={when}
							options={[
								{ v: "off", label: "关" },
								{ v: "push", label: "仅推进时" },
								{ v: "always", label: "始终" },
							]}
							onChange={(value) =>
								act(
									() =>
										api.updateSettings(storyId, {
											featureSwitches: { director: value },
										}),
									() => features.reload(),
								)
							}
						/>
					</div>
					{sceneGoal ? (
						<div className="label">
							<span>
								本场目标：
								<Editable
									as="span"
									value={sceneGoal.change}
									onCommit={(text) => saveScene({ change: text })}
								/>
							</span>
							<span
								className={`pill ${sceneGoal.source === "player" ? "gold" : "mute"}`}
							>
								{sceneGoal.source === "player" ? "你改的" : "AI 写的"}
							</span>
							<button
								type="button"
								className="lock"
								aria-pressed={sceneGoal.locked}
								onClick={() => saveScene({ locked: !sceneGoal.locked })}
							>
								{sceneGoal.locked ? "已锁定" : "锁定"}
							</button>
							<button
								type="button"
								className="btn ghost sm"
								onClick={() =>
									setHistory(
										history === `scene:${sceneGoal.nodeId}`
											? null
											: `scene:${sceneGoal.nodeId}`,
									)
								}
							>
								历史
							</button>
							{history === `scene:${sceneGoal.nodeId}` ? (
								<EditHistory
									storyId={storyId}
									kind="scene"
									target={sceneGoal.nodeId}
									onRollback={() => {
										memory.reload();
										onChanged();
									}}
								/>
							) : null}
						</div>
					) : null}
					<div className="label">
						<span>剧情线</span>
						<button
							type="button"
							className="btn ghost sm"
							onClick={() => setAdding(adding === null ? "" : null)}
						>
							＋ 加一条
						</button>
					</div>
					{adding === null ? null : (
						<div className="say">
							<textarea
								rows={1}
								value={adding}
								placeholder="写一句你想看的事，例如「我想要一场背叛」"
								onChange={(event) => setAdding(event.target.value)}
							/>
							<button
								type="button"
								className="btn"
								onClick={() => {
									const want = adding.trim();
									if (want === "") return;
									void act(
										() =>
											api.call("POST", sp(storyId, "/director/line"), {
												line: {
													id: `p-${Date.now().toString(36)}`,
													kind: "main",
													who: "玩家",
													want,
													obstacle: "还没有定",
													countdown: null,
													preparations: [],
												},
											}),
										() => {
											setAdding(null);
											lines.reload();
										},
									);
								}}
							>
								加上
							</button>
						</div>
					)}
					<div className="sec">
						{threads.length === 0 ? (
							<p className="v4empty" style={{ padding: 0 }}>
								还没有剧情线。写几楼之后，章末规划会整理出来。
							</p>
						) : null}
						{threads.map((line) => {
							const total = line.countdown ?? 0;
							const left = Math.max(0, line.remaining ?? 0);
							const kind = KIND_LABEL[line.kind];
							return (
								<div
									key={line.id}
									className={`thread${line.muted ? " off" : ""}${line.pinned ? " pin" : ""}`}
								>
									{line.countdown === null ? (
										<Clock done={0} total={1} />
									) : (
										<Clock done={total - left} total={Math.max(total, 1)} />
									)}
									<div>
										<span className={`pill ${kind.pill}`}>{kind.text}</span>{" "}
										<span
											className={`pill ${line.by === "player" ? "gold" : "mute"}`}
										>
											{line.by === "player" ? "你改的" : "AI 写的"}
										</span>
										<Editable
											as="h3"
											value={`${line.who}想要${line.want}`}
											onCommit={(text) => {
												const index = text.indexOf("想要");
												void saveLine(
													line,
													index > 0
														? {
																who: text.slice(0, index),
																want: text.slice(index + 2),
															}
														: { want: text },
												);
											}}
										/>
										<p>
											阻碍：{line.obstacle}
											{line.countdown !== null && left === 0
												? " · 到点了，等你按推进才发生"
												: ""}
										</p>
										<div className="ctl">
											<button
												type="button"
												className="btn ghost sm"
												onClick={() =>
													act(
														() =>
															api.call("POST", sp(storyId, "/director/line"), {
																pin: line.id,
															}),
														() => lines.reload(),
													)
												}
											>
												{line.pinned ? "取消置顶" : "我想看这条"}
											</button>
											<button
												type="button"
												className="btn ghost sm"
												onClick={() =>
													act(
														() =>
															api.call(
																line.muted ? "DELETE" : "PUT",
																sp(
																	storyId,
																	`/director/muted/${encodeURIComponent(line.id)}`,
																),
															),
														() => {
															lines.reload();
															onChanged();
														},
													)
												}
											>
												{line.muted ? "恢复" : "别再提了"}
											</button>
											<button
												type="button"
												className="lock"
												aria-pressed={line.locked}
												onClick={() =>
													act(
														() =>
															api.call("POST", sp(storyId, "/director/line"), {
																id: line.id,
																locked: !line.locked,
															}),
														() => lines.reload(),
													)
												}
											>
												{line.locked ? "已锁定" : "锁定"}
											</button>
											<button
												type="button"
												className="btn ghost sm"
												onClick={() =>
													setHistory(
														history === `line:${line.id}`
															? null
															: `line:${line.id}`,
													)
												}
											>
												历史
											</button>
										</div>
										{history === `line:${line.id}` ? (
											<EditHistory
												storyId={storyId}
												kind="line"
												target={line.id}
												onRollback={() => {
													lines.reload();
													onChanged();
												}}
											/>
										) : null}
									</div>
								</div>
							);
						})}
					</div>
					<div className="label">
						<span>伏笔</span>
						<span className="num">
							没收 {promises.length} / 上限 {lines.data?.maxOpenPromises ?? "—"}
						</span>
					</div>
					<div className="rows">
						{promises.map((line) => (
							<div key={line.id}>
								<Editable
									as="span"
									value={line.want}
									onCommit={(text) => saveLine(line, { want: text })}
								/>
								<span
									className={`pill ${line.by === "player" ? "gold" : "mute"}`}
								>
									{line.by === "player" ? "你改的" : "AI 写的"}
								</span>
								<span>
									{line.muted ? "已静音" : line.who}
									{line.locked ? " · 已锁定" : ""}
								</span>
								<button
									type="button"
									className="lock"
									aria-pressed={line.locked}
									onClick={() =>
										act(
											() =>
												api.call("POST", sp(storyId, "/director/line"), {
													id: line.id,
													locked: !line.locked,
												}),
											() => lines.reload(),
										)
									}
								>
									{line.locked ? "已锁定" : "锁定"}
								</button>
								<button
									type="button"
									className="btn ghost sm"
									onClick={() =>
										setHistory(
											history === `line:${line.id}` ? null : `line:${line.id}`,
										)
									}
								>
									历史
								</button>
								{history === `line:${line.id}` ? (
									<EditHistory
										storyId={storyId}
										kind="line"
										target={line.id}
										onRollback={() => {
											lines.reload();
											onChanged();
										}}
									/>
								) : null}
							</div>
						))}
					</div>
					<div className="label">
						<span>导演做过什么</span>
					</div>
					<div className="rows">
						{moves.map((move) => (
							<div key={move.key}>
								<span>{move.label}</span>
								<span>第 {move.no} 楼</span>
								{move.undoLineId === undefined ? null : (
									<button
										type="button"
										className="btn ghost sm"
										onClick={() =>
											act(
												() =>
													api.call("POST", sp(storyId, "/director/undo"), {
														nodeId: move.nodeId,
													}),
												() => {
													lines.reload();
													memory.reload();
													onChanged();
												},
											)
										}
									>
										撤回
									</button>
								)}
							</div>
						))}
					</div>
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
						<p className="v4empty" style={{ padding: 0 }}>
							自动记录还没有记下这一场谁在场。
						</p>
					) : null}
					<div className="label">
						<span>秘密</span>
					</div>
					<div className="rows">
						{(memory.data?.secrets ?? []).map((secret) => (
							<div key={secret.id}>
								<span>{secret.text}</span>
								<span>{secret.unaware.join("、")}不知道</span>
							</div>
						))}
					</div>
					<div className="label">
						<span>快要相关</span>
					</div>
					<div className="rows">
						{(memory.data?.soon ?? []).map((person) => (
							<div key={person.pageId}>
								<span>{person.name}</span>
								<span>{person.floorsAgo} 楼没出场</span>
							</div>
						))}
					</div>
				</div>
			) : null}

			{tab === "ctx" ? (
				<div className="sec">
					<div className="label">
						<span>本轮上下文</span>
					</div>
					{context.data !== null && context.data.breakdown === null ? (
						<p className="v4empty" style={{ padding: 0 }}>
							暂无
						</p>
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

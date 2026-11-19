import type {
	BlueprintDiff,
	BlueprintEntry,
	BlueprintMilestone,
	BlueprintPremise,
	BlueprintSuggestionOperation,
	BlueprintTension,
	BlueprintVolume,
} from "@dramaticer/core";
import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { usePaletteCommands } from "./Shell";
import { Editable, Seg, Tog, useAct, useLoad, useToast } from "./ui";

const STATE_PILL: Record<string, [string, string]> = {
	achieved: ["ok", "已发生"],
	reachable: ["mute", "还能走到"],
	blocked: ["bad", "走不通了"],
	lost: ["bad", "走不通了"],
};

const STATE_CLASS: Record<string, string> = {
	achieved: "done",
	reachable: "open",
	blocked: "blocked",
	lost: "blocked",
};

const OPERATIONS: readonly {
	op: BlueprintSuggestionOperation;
	label: string;
	gold?: boolean;
}[] = [
	{ op: "complete", label: "帮我补全", gold: true },
	{ op: "find-flaws", label: "找漏洞" },
	{ op: "three-directions", label: "三种走向" },
	{ op: "expand-volume", label: "展开这一卷" },
];

/** 大纲页：总纲、分卷的关键事件、走不通时的选择、AI 的建议逐条决定。 */
export function Outline() {
	const { storyId = "" } = useParams();
	const act = useAct();
	const toast = useToast();
	const blueprint = useLoad(() => api.getStoryBlueprint(storyId), [storyId]);
	const deviation = useLoad(
		() => api.getBlueprintDeviation(storyId),
		[storyId],
	);
	const suggestions = useLoad(
		() => api.getBlueprintSuggestions(storyId, "pending"),
		[storyId],
	);
	const versions = useLoad(() => api.getBlueprintVersions(storyId), [storyId]);
	const [idea, setIdea] = useState("");

	usePaletteCommands(
		useCallback(
			() => [
				{
					label: "让 AI 补全大纲",
					run: () => {
						void api
							.requestBlueprintSuggestions(storyId, { operation: "complete" })
							.then(() => toast("已经交给后台，建议生成后会出现在大纲页"))
							.catch(() => toast("没能交给后台，稍后再试"));
					},
				},
				{
					label: "让 AI 找大纲的漏洞",
					run: () => {
						void api
							.requestBlueprintSuggestions(storyId, {
								operation: "find-flaws",
							})
							.then(() => toast("已经交给后台，建议生成后会出现在大纲页"))
							.catch(() => toast("没能交给后台，稍后再试"));
					},
				},
			],
			[storyId, toast],
		),
	);

	if (blueprint.error !== null)
		return <div className="v4err">{blueprint.error}</div>;
	if (blueprint.data === null) return <p className="v4empty">正在读取大纲…</p>;

	const entries = blueprint.data.entries;
	const premise =
		(entries.find((entry) => entry.kind === "premise") as
			| BlueprintPremise
			| undefined) ?? null;
	const volumes = entries.filter(
		(entry): entry is BlueprintVolume => entry.kind === "volume",
	);
	const milestones = entries.filter(
		(entry): entry is BlueprintMilestone => entry.kind === "milestone",
	);
	const states = new Map(
		(deviation.data?.deviations ?? []).map(
			(item) => [item.milestoneId, item] as const,
		),
	);
	const spoilersHidden = blueprint.data.spoilers === "hide";

	const reload = () => {
		blueprint.reload();
		deviation.reload();
		versions.reload();
	};
	/** 写一批修改；成功后重新读取并可选地提示。 */
	const write = (diffs: readonly BlueprintDiff[], message?: string) =>
		act(
			() => api.editStoryBlueprint(storyId, { diffs }),
			() => {
				reload();
				if (message !== undefined) toast(message);
			},
		);
	/** 玩家的修改：来源记为玩家并自动锁定。 */
	const save = (entry: BlueprintEntry, message = "已保存并锁定") =>
		write(
			[{ action: "set", entry: { ...entry, source: "player", locked: true } }],
			message,
		);
	const basePremise: BlueprintPremise = premise ?? {
		id: "premise",
		kind: "premise",
		source: "player",
		locked: true,
		coreQuestion: "",
		tone: "",
		endings: [],
		redLines: [],
		tension: "loose",
	};
	const firstOpen = milestones.find(
		(item) => (states.get(item.id)?.state ?? "reachable") === "reachable",
	);

	const ask = (op: BlueprintSuggestionOperation) =>
		act(
			() =>
				api.requestBlueprintSuggestions(storyId, {
					operation: op,
					...(idea.trim() === "" ? {} : { note: idea.trim() }),
				}),
			() => {
				toast("已经交给后台，建议生成后会出现在下面");
				setTimeout(() => suggestions.reload(), 6000);
				setTimeout(() => suggestions.reload(), 20000);
			},
		);

	return (
		<section data-view="outline">
			<div className="vh">
				<div>
					<h1>大纲</h1>
					<p>
						只定要发生什么，不定怎么走到那里。远的写一句就够，快到了再展开。你写的可以锁定，AI
						只能提建议。
					</p>
				</div>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 10,
						alignItems: "center",
					}}
				>
					<span className="label">约束</span>
					<Seg<BlueprintTension>
						label="大纲约束"
						value={premise?.tension ?? "loose"}
						options={[
							{ v: "loose", label: "弱" },
							{ v: "medium", label: "中" },
							{ v: "tight", label: "强" },
						]}
						onChange={(tension) =>
							save({ ...basePremise, tension }, "约束已调整")
						}
					/>
					<Tog
						pressed={spoilersHidden}
						onChange={(hide) =>
							act(
								() =>
									api.updateSettings(storyId, {
										blueprintSpoilers: hide ? "hide" : "show",
									}),
								reload,
							)
						}
					>
						AI 写的先别给我看
					</Tog>
				</div>
			</div>
			<div className="bp">
				<div id="outlineBox">
					<div className="premise">
						<div>
							<span className="label">核心问题</span>
							<Editable
								value={basePremise.coreQuestion || "（点这里写）"}
								onCommit={(text) =>
									save({ ...basePremise, coreQuestion: text })
								}
							/>
						</div>
						<div>
							<span className="label">基调</span>
							<Editable
								value={basePremise.tone || "（点这里写）"}
								onCommit={(text) => save({ ...basePremise, tone: text })}
							/>
						</div>
						<div>
							<span className="label">不要发生</span>
							<Editable
								value={
									basePremise.redLines.join("；") ||
									"（点这里写，多条用分号隔开）"
								}
								onCommit={(text) =>
									save({
										...basePremise,
										redLines: text
											.split(/[；;]/)
											.map((item) => item.trim())
											.filter((item) => item !== ""),
									})
								}
							/>
						</div>
					</div>
					{blueprint.data.hidden !== null && blueprint.data.hidden.total > 0 ? (
						<p className="v4empty">
							AI 还补了 {blueprint.data.hidden.total} 条，已按你的设置隐藏。
						</p>
					) : null}
					<div id="vols">
						{volumes.map((volume) => (
							<div className="vol" key={volume.id}>
								<header>
									<Editable
										as="h3"
										value={volume.title}
										onCommit={(text) => save({ ...volume, title: text })}
									/>
									<p>{volume.coreQuestion}</p>
								</header>
								{milestones
									.filter((item) => item.volumeId === volume.id)
									.map((item) => {
										const deviationItem = states.get(item.id);
										const state = deviationItem?.state ?? "reachable";
										const live = firstOpen?.id === item.id;
										const pill = live
											? ["gold", "下一个"]
											: (STATE_PILL[state] ?? ["mute", state]);
										return (
											<div
												key={item.id}
												className={`ms ${live ? "live" : (STATE_CLASS[state] ?? "open")}${item.source === "ai" ? " ai" : ""}`}
											>
												<span className="dot" />
												<div>
													<Editable
														as="h3"
														value={item.want}
														onCommit={(text) => save({ ...item, want: text })}
													/>
													<div className="tags">
														<span className={`pill ${pill[0]}`}>{pill[1]}</span>
														<span
															className={`pill ${item.source === "ai" ? "teal" : "mute"}`}
														>
															{item.source === "ai" ? "AI 写的" : "你写的"}
														</span>
														<button
															type="button"
															className="pill mute"
															style={{ border: 0 }}
															onClick={() =>
																write([
																	{
																		action: "set",
																		entry: {
																			...item,
																			hardness:
																				item.hardness === "hard"
																					? "soft"
																					: "hard",
																		},
																	},
																])
															}
														>
															{item.hardness === "hard"
																? "一定要发生"
																: "有机会就发生"}
														</button>
														<button
															type="button"
															className="lock"
															aria-pressed={item.locked}
															onClick={() =>
																write([
																	{
																		action: "set",
																		entry: { ...item, locked: !item.locked },
																	},
																])
															}
														>
															{item.locked ? "已锁定" : "锁定"}
														</button>
													</div>
													<p className="sub">
														{deviationItem?.reason ??
															(item.prerequisites.length > 0
																? `要先埋：${item.prerequisites.join("；")}`
																: "")}
													</p>
													{deviationItem !== undefined &&
													deviationItem.options.length > 0 ? (
														<div className="fix">
															<button
																type="button"
																className="btn sm"
																onClick={() => {
																	const next = window.prompt(
																		"把这件事改成什么？",
																		item.want,
																	);
																	if (next !== null && next.trim() !== "") {
																		void save(
																			{
																				...item,
																				want: next.trim(),
																				prerequisites: [],
																			},
																			"已改大纲",
																		);
																	}
																}}
															>
																改大纲
															</button>
															<button
																type="button"
																className="btn sm"
																onClick={() =>
																	save(
																		{ ...item, hardness: "hard" },
																		"已标成一定要发生，导演会设法把剧情拉回来",
																	)
																}
															>
																把剧情拉回来
															</button>
															<button
																type="button"
																className="btn sm"
																onClick={() =>
																	write(
																		[{ action: "delete", id: item.id }],
																		"已放弃这件事",
																	)
																}
															>
																不要了
															</button>
														</div>
													) : null}
												</div>
											</div>
										);
									})}
								<button
									type="button"
									className="btn ghost sm"
									onClick={() => {
										const want = window.prompt("这一卷里要发生什么？");
										if (want === null || want.trim() === "") return;
										void save({
											id: `m-${Date.now().toString(36)}`,
											kind: "milestone",
											source: "player",
											locked: true,
											volumeId: volume.id,
											want: want.trim(),
											prerequisites: [],
											after: [],
											hardness: "soft",
										});
									}}
								>
									＋ 加一件要发生的事
								</button>
							</div>
						))}
						<button
							type="button"
							className="btn"
							style={{ marginTop: 18 }}
							onClick={() => {
								const title = window.prompt("这一卷叫什么？");
								if (title === null || title.trim() === "") return;
								void save({
									id: `v-${Date.now().toString(36)}`,
									kind: "volume",
									source: "player",
									locked: true,
									title: title.trim(),
									coreQuestion: "还没有写",
									startState: "还没有写",
									endState: "还没有写",
								});
							}}
						>
							＋ 加一卷
						</button>
					</div>
					{(versions.data?.versions.length ?? 0) > 0 ? (
						<details style={{ marginTop: 22 }}>
							<summary className="label">
								修改历史 · {versions.data?.versions.length} 版
							</summary>
							<div className="rows">
								{[...(versions.data?.versions ?? [])]
									.reverse()
									.map((version) => (
										<div key={`${version.nodeId}-${version.seq}`}>
											<span>
												{version.source === "ai" ? "AI" : "你"} ·{" "}
												{version.changes} 处修改 ·{" "}
												{new Date(version.createdAt).toLocaleString()}
											</span>
											<span>
												<button
													type="button"
													className="btn ghost sm"
													onClick={() =>
														act(
															() =>
																api.editStoryBlueprint(storyId, {
																	versionNodeId: version.nodeId,
																	versionSeq: version.seq,
																}),
															() => {
																reload();
																toast("已回到这一版，导演从下一轮起按它来");
															},
														)
													}
												>
													回到这一版
												</button>
											</span>
										</div>
									))}
							</div>
						</details>
					) : null}
				</div>
				<aside className="sec">
					<div className="idea">
						<span className="label">写下你的想法，粗细都行</span>
						<textarea
							value={idea}
							onChange={(event) => setIdea(event.target.value)}
						/>
						<div className="row">
							{OPERATIONS.map((item) => (
								<button
									type="button"
									key={item.op}
									className={item.gold ? "btn gold sm" : "btn sm"}
									onClick={() => ask(item.op)}
								>
									{item.label}
								</button>
							))}
						</div>
					</div>
					<div className="label">
						<span>AI 的建议 · 逐条决定</span>
						<button
							type="button"
							className="btn ghost sm"
							onClick={suggestions.reload}
						>
							刷新
						</button>
					</div>
					<div className="sec">
						{(suggestions.data?.suggestions ?? []).length === 0 ? (
							<p style={{ color: "var(--muted)", fontSize: 13 }}>
								没有待处理的建议。
							</p>
						) : null}
						{(suggestions.data?.suggestions ?? []).map((suggestion) => (
							<div className="card sug" key={suggestion.id}>
								<span className="pill teal">{suggestion.title}</span>
								<p>{suggestion.reason}</p>
								<div className="row">
									<button
										type="button"
										className="btn sm gold"
										onClick={() =>
											act(
												() => api.acceptBlueprintSuggestion(suggestion.id),
												() => {
													suggestions.reload();
													reload();
													toast("已按建议修改，标记为 AI 写的");
												},
											)
										}
									>
										接受
									</button>
									<button
										type="button"
										className="btn sm"
										onClick={() =>
											act(
												() => api.rejectBlueprintSuggestion(suggestion.id),
												() => {
													suggestions.reload();
													toast("已忽略，不会再提");
												},
											)
										}
									>
										不要
									</button>
								</div>
							</div>
						))}
					</div>
				</aside>
			</div>
		</section>
	);
}

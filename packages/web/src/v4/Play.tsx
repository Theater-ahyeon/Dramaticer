import type { RerollReason } from "@dramaticer/core";
import { parseBlocks } from "@dramaticer/core/blocks";
import {
	type DisplayedContent,
	type SseEvent,
	type StoryPath,
	type StoryView,
	toDisplayedBlocks,
} from "@dramaticer/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { blockViewKind, optionLinesOf, plainTextOf } from "../chat/blocks";
import { PUSH_TURN_TEXT } from "../chat/push";
import { BlockContent } from "../components/chat/BlockContent";
import { Dock, type DockTab } from "./Dock";
import { usePaletteCommands } from "./Shell";
import { stage } from "./stage";
import {
	Cover,
	Seg,
	Tog,
	errorText,
	formatTokens,
	sp,
	useLoad,
	useToast,
} from "./ui";

interface FloorNote {
	readonly tone: "gold" | "plain";
	readonly title: string;
	readonly text: string;
	readonly undoLineId?: string;
}

interface FloorMeta {
	readonly nodeId: string;
	readonly role: string;
	readonly no: number;
	readonly slate: {
		readonly scene: number;
		readonly present: readonly string[];
		readonly change: string | null;
	} | null;
	readonly notes: readonly FloorNote[];
	readonly cost: {
		readonly input: number | null;
		readonly output: number | null;
		readonly cached: number | null;
		readonly waitMs: number | null;
		readonly mode: string;
	} | null;
}

interface FloorsView {
	readonly headNodeId: string | null;
	readonly floors: readonly FloorMeta[];
}

type Mode = "fast" | "plan" | "deep";
type Step = "advance" | "quick" | "jump";

const STEP_HINT: Record<Step, string> = {
	advance: "在这一场里往下走一步",
	quick: "把这一场走完，换下一场",
	jump: "跳到下一件大事发生的时刻",
};

const MODE_HINT: Record<Mode, string> = {
	fast: "快速：写一遍就交",
	plan: "规划：先理清再写；你点推进或选项时已经提前备好",
	deep: "深度：起草、自查、修改后再交，最慢最细",
};

const WHY: readonly { reason: RerollReason; label: string }[] = [
	{ reason: "not-progressed", label: "没推进" },
	{ reason: "ignored-instruction", label: "没听我的" },
	{ reason: "too-short", label: "太短" },
	{ reason: "off-character", label: "人设不对" },
	{ reason: "avoid-line", label: "别推这条线" },
];

/** 一楼写作过程里界面看到的东西：阶段、自查项、草稿与正文。 */
interface Streaming {
	readonly said: string | null;
	readonly pushLabel: string | null;
	readonly text: string;
	readonly blocks: readonly DisplayedContent[] | null;
	readonly stages: readonly string[];
	readonly checks: readonly string[];
	readonly error: string | null;
}

function Prose({
	items,
	nodeId,
}: {
	readonly items: readonly DisplayedContent[];
	readonly nodeId: string | null;
}) {
	return (
		<>
			{items.map((item, index) => {
				const key = `${index}`;
				if (item.kind === "text") {
					return item.text
						.split(/\n+/)
						.map((line) => line.trim())
						.filter((line) => line.length > 0)
						.map((line, position) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 段落没有稳定的 id
							<p key={`${key}-${position}`}>{line}</p>
						));
				}
				const kind = blockViewKind(item);
				// 行动选项放到输入台上，不在正文里重复。
				if (kind === "options" || kind === "hidden") return null;
				if (kind === "thinking") {
					return (
						<details key={key}>
							<summary>思考</summary>
							{plainTextOf(item.content)}
						</details>
					);
				}
				if (kind === "narration" || kind === "raw") {
					return <Prose key={key} items={item.content} nodeId={nodeId} />;
				}
				return (
					<BlockContent
						key={key}
						items={[item]}
						nodeId={nodeId}
						onChooseOption={() => {}}
					/>
				);
			})}
		</>
	);
}

function collectOptions(items: readonly DisplayedContent[]): string[] {
	const lines: string[] = [];
	for (const item of items) {
		if (item.kind !== "block") continue;
		if (blockViewKind(item) === "options") lines.push(...optionLinesOf(item));
		else lines.push(...collectOptions(item.content));
	}
	return lines;
}

function costLine(meta: FloorMeta | undefined): string {
	const cost = meta?.cost;
	if (cost === null || cost === undefined) return "";
	const cache =
		cost.cached !== null && cost.input !== null && cost.input > 0
			? ` · 缓存 ${Math.round((cost.cached / cost.input) * 100)}%`
			: "";
	const wait =
		cost.waitMs === null ? "" : ` · 等了 ${(cost.waitMs / 1000).toFixed(1)} 秒`;
	return `上一轮 ${formatTokens(cost.input)} 入 · ${formatTokens(cost.output)} 出${cache}${wait}`;
}

/** 故事页：书页式正文、页边批注、玻璃输入台，右侧是停靠栏。 */
export function Play() {
	const { storyId = "" } = useParams();
	const toast = useToast();
	const story = useLoad<StoryView>(() => api.getStory(storyId), [storyId]);
	const path = useLoad<StoryPath>(
		() => api.getPath(storyId, { limit: 60 }),
		[storyId],
	);
	const floors = useLoad<FloorsView>(
		() => api.get<FloorsView>(sp(storyId, "/floors")),
		[storyId],
	);
	const settings = useLoad(() => api.getSettings(storyId), [storyId]);
	const dock = useLoad<{ recap: string | null }>(
		() => api.get(sp(storyId, "/dock")),
		[storyId],
	);

	const [mode, setMode] = useState<Mode>("fast");
	const [step, setStep] = useState<Step>("advance");
	const [text, setText] = useState("");
	const [whyOpen, setWhyOpen] = useState(false);
	const [notesOn, setNotesOn] = useState(
		() => localStorage.getItem("dramaticer.notes") !== "off",
	);
	const [streaming, setStreaming] = useState<Streaming | null>(null);
	const [actions, setActions] = useState<readonly string[]>([]);
	const [dockTab, setDockTab] = useState<DockTab>("dir");
	const [dockTick, setDockTick] = useState(0);
	const abort = useRef<AbortController | null>(null);
	const lastRef = useRef<HTMLElement | null>(null);
	const dockRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const stored = settings.data?.turnMode as Mode | undefined;
		if (stored !== undefined) setMode(stored);
	}, [settings.data]);

	const nodes = path.data?.nodes ?? [];
	const metaById = useMemo(
		() =>
			new Map(
				(floors.data?.floors ?? []).map((meta) => [meta.nodeId, meta] as const),
			),
		[floors.data],
	);
	const lastAssistant = [...nodes]
		.reverse()
		.find((node) => node.role === "assistant");
	const parsed = useMemo(
		() =>
			new Map(
				nodes
					.filter((node) => node.role === "assistant")
					.map(
						(node) =>
							[node.id, toDisplayedBlocks(parseBlocks(node.raw))] as const,
					),
			),
		[nodes],
	);

	const lastId = lastAssistant?.id ?? null;
	useEffect(() => {
		if (lastId === null) {
			setActions([]);
			return;
		}
		let active = true;
		const inline = collectOptions(parsed.get(lastId) ?? []);
		setActions(inline);
		api
			.getActions(lastId)
			.then((view) => {
				if (!active) return;
				const prepared = view.actions.map((action) => action.text);
				if (prepared.length > 0)
					setActions([...new Set([...inline, ...prepared])]);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [lastId, parsed]);

	const refresh = useCallback(() => {
		path.reload();
		floors.reload();
		dock.reload();
		setDockTick((value) => value + 1);
	}, [path.reload, floors.reload, dock.reload]);

	const consume = async (
		events: AsyncGenerator<SseEvent>,
		initial: Streaming,
	) => {
		setStreaming(initial);
		setWhyOpen(false);
		let state = initial;
		const update = (patch: Partial<Streaming>) => {
			state = { ...state, ...patch };
			setStreaming(state);
		};
		try {
			for await (const event of events) {
				switch (event.event) {
					case "text.delta":
						update({ text: state.text + event.data.delta });
						break;
					case "blocks.replace":
						update({ blocks: event.data.blocks });
						break;
					case "draft.replace":
						update({ text: event.data.text, blocks: null });
						break;
					case "turn.progress":
						if (!state.stages.includes(event.data.phase)) {
							update({ stages: [...state.stages, event.data.phase] });
						}
						if (
							event.data.detail !== "" &&
							!state.checks.includes(event.data.detail)
						) {
							update({
								checks: [...state.checks, event.data.detail].slice(-8),
							});
						}
						break;
					case "turn.error":
						update({ error: event.data.message });
						break;
					default:
						break;
				}
			}
		} catch (error) {
			update({ error: errorText(error) });
		}
		abort.current = null;
		if (state.error === null) setStreaming(null);
		refresh();
	};

	const send = (message: string, push: Step | null) => {
		if (streaming !== null && streaming.error === null) return;
		const controller = new AbortController();
		abort.current = controller;
		stage.pulse(push === null ? 0.8 : 1.3);
		void consume(
			api.streamTurn(
				storyId,
				// 写法由玩家选；服务端按这个值走对应的流程。
				{
					text: message,
					mode: mode as "fast",
					...(push === null ? {} : { push }),
				},
				controller.signal,
			),
			{
				said: push === null ? message : null,
				pushLabel:
					push === null
						? null
						: `推进 · ${{ advance: "一步", quick: "一场", jump: "跳跃" }[push]}`,
				text: "",
				blocks: null,
				stages: [],
				checks: [],
				error: null,
			},
		);
	};

	const submit = () => {
		const message = text.trim();
		if (message === "") {
			toast("先写点什么，或者直接按「推进」");
			return;
		}
		setText("");
		send(message, null);
	};

	const reroll = (reason: RerollReason, label: string) => {
		if (lastAssistant === undefined) return;
		const controller = new AbortController();
		abort.current = controller;
		stage.pulse(1);
		void consume(
			api.streamRegenerate(lastAssistant.id, { reason }, controller.signal),
			{
				said: null,
				pushLabel: `重写 · ${label}`,
				text: "",
				blocks: null,
				stages: [],
				checks: [],
				error: null,
			},
		).then(() =>
			toast(`已带着「${label}」重写。上一版还在，可以在分支里切回去`),
		);
	};

	const changeMode = (value: Mode) => {
		setMode(value);
		toast(MODE_HINT[value]);
		api.updateSettings(storyId, { turnMode: value as "fast" }).catch(() => {});
	};

	const undo = async (nodeId: string) => {
		try {
			await api.call("POST", sp(storyId, "/director/undo"), { nodeId });
			toast("已撤回，这条线不会再出现。要重写这一楼吗？点「重写」");
			refresh();
		} catch (error) {
			toast(errorText(error));
		}
	};

	const showContext = useCallback(() => {
		setDockTab("ctx");
		dockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}, []);

	usePaletteCommands(
		// biome-ignore lint/correctness/useExhaustiveDependencies: send 每次渲染都是新的，用它依赖的状态代替
		useCallback(
			() => [
				{ label: "推进一步", run: () => send(PUSH_TURN_TEXT, "advance") },
				{ label: "看它这一轮看到了什么", run: showContext },
				{
					label: notesOn ? "关掉批注" : "打开批注",
					run: () => setNotesOn((v) => !v),
				},
			],
			[showContext, notesOn, mode, storyId, streaming],
		),
	);

	useEffect(() => {
		localStorage.setItem("dramaticer.notes", notesOn ? "on" : "off");
	}, [notesOn]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 新楼层出现或开始写时滚到最后
	useEffect(() => {
		lastRef.current?.scrollIntoView({ block: "nearest" });
	}, [nodes.length, streaming === null]);

	// 写作期间背景的潮水涨起来、灯塔转得更快；离开页面时恢复。
	const busy = streaming !== null && streaming.error === null;
	useEffect(() => {
		stage.setWriting(busy);
		return () => stage.setWriting(false);
	}, [busy]);

	if (path.error !== null) return <div className="v4err">{path.error}</div>;
	const title = story.data?.title ?? "";
	const lastMeta =
		lastAssistant === undefined ? undefined : metaById.get(lastAssistant.id);
	const stageNames =
		mode === "deep"
			? ["起草", "自查", "修改", "交稿"]
			: mode === "plan"
				? ["挑记忆", "角色意图", "定计划", "正文"]
				: [];

	return (
		<section data-view="play">
			<div className="play">
				<div className={notesOn ? "sheet" : "sheet nonotes"} id="sheet">
					<div className="sheet-head">
						<div className="ttl">
							<Cover storyId={storyId} title={title} />
							<h1>{title}</h1>
						</div>
						<span className="label">第 {nodes.length} 楼</span>
					</div>
					{dock.data?.recap ? (
						<details className="recapbox" open>
							<summary>上回说到</summary>
							<p>{dock.data.recap}</p>
						</details>
					) : null}
					<div id="script">
						{nodes.length === 0 && path.data !== null ? (
							<p className="v4empty" style={{ padding: "24px 28px" }}>
								这个故事还没有第一楼。写下你的开场，或者按「推进」让故事自己开始。
							</p>
						) : null}
						{nodes.map((node) => {
							const meta = metaById.get(node.id);
							if (node.role === "user") {
								return (
									<div className="said" key={node.id}>
										<span className="label">你</span>
										<p>{node.raw}</p>
									</div>
								);
							}
							if (node.role !== "assistant") return null;
							return (
								<div key={node.id}>
									{meta?.slate ? (
										<div className="slate">
											<i />
											<span>第 {meta.slate.scene} 场</span>
											{meta.slate.change ? (
												<span>{meta.slate.change}</span>
											) : null}
											<span className="who">
												在场：{meta.slate.present.join("、") || "—"}
											</span>
										</div>
									) : null}
									<article
										className="flr"
										ref={node.id === lastId ? lastRef : undefined}
									>
										<div className="prose">
											<Prose
												items={parsed.get(node.id) ?? []}
												nodeId={node.id}
											/>
										</div>
										<aside className="notes">
											<span className="fno">第 {meta?.no ?? "?"} 楼</span>
											{(meta?.notes ?? []).map((note, index) => (
												<div
													// biome-ignore lint/suspicious/noArrayIndexKey: 批注没有稳定的 id
													key={index}
													className={
														note.tone === "gold" ? "note gold" : "note"
													}
												>
													<b>{note.title}</b>
													{note.text}
													{note.undoLineId === undefined ? null : (
														<>
															<br />
															<button
																type="button"
																onClick={() => undo(node.id)}
															>
																这不是我要的
															</button>
														</>
													)}
												</div>
											))}
										</aside>
									</article>
								</div>
							);
						})}
						{streaming === null ? null : (
							<>
								{streaming.pushLabel === null ? null : (
									<div className="pushmark">▸ {streaming.pushLabel}</div>
								)}
								{streaming.said === null ? null : (
									<div className="said">
										<span className="label">你</span>
										<p>{streaming.said}</p>
									</div>
								)}
								<article className="flr" ref={lastRef}>
									<div className="prose">
										{stageNames.length > 0 ? (
											<div className="stages">
												{stageNames.map((name, index) => (
													<span
														key={name}
														className={
															streaming.stages.length > index ||
															(index === stageNames.length - 1 &&
																streaming.text !== "")
																? "on"
																: undefined
														}
													>
														{name}
													</span>
												))}
											</div>
										) : null}
										{streaming.checks.length > 0 ? (
											<div className="checks">
												{streaming.checks.map((check) => (
													<span key={check}>{check}</span>
												))}
											</div>
										) : null}
										{streaming.blocks !== null ? (
											<Prose items={streaming.blocks} nodeId={null} />
										) : (
											streaming.text
												.split(/\n+/)
												.filter((line) => line.trim() !== "")
												.map((line, index, all) => (
													<p
														// biome-ignore lint/suspicious/noArrayIndexKey: 流式段落
														key={index}
														className={
															index === all.length - 1 ? "caret" : undefined
														}
													>
														{line}
													</p>
												))
										)}
										{streaming.error === null ? null : (
											<div className="v4err">
												{streaming.error}{" "}
												<button
													type="button"
													className="btn sm"
													onClick={() => setStreaming(null)}
												>
													知道了
												</button>
											</div>
										)}
									</div>
									<aside className="notes">
										<span className="fno">正在写</span>
									</aside>
								</article>
							</>
						)}
					</div>
					<div className="acts">
						<button
							type="button"
							className="btn ghost sm"
							disabled={busy || lastAssistant === undefined}
							onClick={() => setWhyOpen((value) => !value)}
						>
							重写
						</button>
						<button
							type="button"
							className="btn ghost sm"
							onClick={showContext}
						>
							它看到了什么
						</button>
						{busy ? (
							<button
								type="button"
								className="btn ghost sm"
								onClick={() => abort.current?.abort()}
							>
								停下
							</button>
						) : null}
					</div>
					{whyOpen ? (
						<div className="why">
							<span>哪里不满意？</span>
							{WHY.map((item) => (
								<button
									type="button"
									className="chip"
									key={item.reason}
									onClick={() => reroll(item.reason, item.label)}
								>
									{item.label}
								</button>
							))}
						</div>
					) : null}
					<div className="cmp" data-busy={busy ? "" : undefined}>
						<div className="opts">
							{actions.slice(0, 5).map((action) => (
								<button
									type="button"
									className="chip"
									key={action}
									onClick={() => setText(action)}
								>
									{action}
								</button>
							))}
						</div>
						<div className="push">
							<button
								type="button"
								className="btn gold"
								disabled={busy}
								onClick={() => send(PUSH_TURN_TEXT, step)}
							>
								推进 ▸
							</button>
							<Seg<Step>
								label="推进多少"
								value={step}
								onChange={setStep}
								options={[
									{ v: "advance", label: "一步" },
									{ v: "quick", label: "一场" },
									{ v: "jump", label: "跳跃" },
								]}
							/>
							<small id="stepHint">{STEP_HINT[step]}</small>
						</div>
						<div className="say">
							<textarea
								rows={1}
								value={text}
								placeholder="写下你的行动或台词。只要你写了，导演就不插手"
								onChange={(event) => setText(event.target.value)}
								onKeyDown={(event) => {
									if (
										event.key === "Enter" &&
										!event.shiftKey &&
										!event.nativeEvent.isComposing
									) {
										event.preventDefault();
										submit();
									}
								}}
							/>
							<button
								type="button"
								className="btn"
								disabled={busy}
								onClick={submit}
							>
								发送
							</button>
						</div>
						<div className="meta">
							<Seg<Mode>
								small
								label="写法"
								value={mode}
								onChange={changeMode}
								options={[
									{ v: "fast", label: "快速" },
									{ v: "plan", label: "规划" },
									{ v: "deep", label: "深度" },
								]}
							/>
							<Tog pressed={notesOn} onChange={setNotesOn}>
								批注
							</Tog>
							<span className="num">{costLine(lastMeta)}</span>
						</div>
					</div>
				</div>
				<div ref={dockRef}>
					<Dock
						storyId={storyId}
						tab={dockTab}
						onTab={setDockTab}
						tick={dockTick}
						moves={(floors.data?.floors ?? [])
							.flatMap((meta) =>
								meta.notes
									.filter((note) => note.title.startsWith("导演"))
									.map((note) => ({
										key: `${meta.nodeId}:${note.title}`,
										label: note.title.replace("导演 · ", ""),
										no: meta.no,
									})),
							)
							.reverse()
							.slice(0, 8)}
						onChanged={refresh}
					/>
				</div>
			</div>
		</section>
	);
}

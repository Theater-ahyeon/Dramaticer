import type {
	ImageWorkflowRecord,
	PushDirection,
	RerollReason,
	StoryFeatureSwitchView,
} from "@dramaticer/core";
import { parseBlocks } from "@dramaticer/core/blocks";
import {
	type DisplayedContent,
	type FloorRenderView,
	type ImageWorkflowsView,
	type NodeImage,
	type SceneControlRequest,
	type SseEvent,
	type StoryPath,
	type StorySandboxView,
	type StoryView,
	toDisplayedBlocks,
} from "@dramaticer/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { blockViewKind, optionLinesOf, plainTextOf } from "../chat/blocks";
import { PUSH_TURN_TEXT, pushDirectionText } from "../chat/push";
import { BlockContent } from "../components/chat/BlockContent";
import { FloorFrame } from "../components/chat/FloorFrame";
import { BackgroundNotice } from "./BackgroundNotice";
import { Dock, type DockTab } from "./Dock";
import { FloorImage, FloorImageList } from "./FloorImages";
import { Opening } from "./Opening";
import { usePaletteCommands } from "./Shell";
import {
	ONCE_SWITCH_IDS,
	type OnceOverrides,
	onceValue,
	toggleOnce,
} from "./once";
import { isDialogueLine } from "./prose";
import { useShellActions } from "./shell-actions";
import { stage } from "./stage";
import {
	Cover,
	Seg,
	TLink,
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

const STEP_LABEL: Record<Step, string> = {
	advance: "一步",
	quick: "一场",
	jump: "跳跃",
};

const STEP_HINT: Record<Step, string> = {
	advance: "只走一拍",
	quick: "把这一场走完",
	jump: "跳到下一件大事",
};

/** 每种写法在写作期间依次点亮的阶段；快速写法只有正文一段。 */
const MODE_STAGES: Record<Mode, readonly string[]> = {
	fast: ["写正文"],
	plan: ["挑记忆", "角色意图", "定计划", "正文"],
	deep: ["起草", "自查", "修改", "交稿"],
};

/** 深度写法的服务端进度按工具标签发出，映射回阶段条上的位置。 */
const DEEP_PROGRESS_STAGES: readonly {
	readonly needle: string;
	readonly stage: number;
}[] = [
	{ needle: "自查", stage: 1 },
	{ needle: "草稿", stage: 2 },
	{ needle: "手记", stage: 2 },
	{ needle: "提交", stage: 3 },
];

function reachedStage(
	mode: Mode,
	phases: readonly string[],
	writing: boolean,
): number {
	const stages = MODE_STAGES[mode];
	if (mode === "fast") return writing ? 0 : -1;
	if (mode === "plan") {
		const settled = stages.length - 1;
		let reached = writing ? settled : -1;
		for (const phase of phases) {
			const index = stages.indexOf(phase);
			if (index >= 0 && index < settled) reached = Math.max(reached, index);
		}
		return reached;
	}
	let reached = writing ? 0 : -1;
	for (const phase of phases) {
		for (const rule of DEEP_PROGRESS_STAGES) {
			if (phase.includes(rule.needle)) reached = Math.max(reached, rule.stage);
		}
	}
	// 自查之后还在出的正文就是改过的稿子，所以「修改」也亮了。
	if (writing && reached >= 1) reached = Math.max(reached, 2);
	return reached;
}

const WHY: readonly { reason: RerollReason; label: string }[] = [
	{ reason: "not-progressed", label: "没推进" },
	{ reason: "ignored-instruction", label: "没听我的" },
	{ reason: "too-short", label: "太短" },
	{ reason: "off-character", label: "人设不对" },
	{ reason: "format", label: "格式乱" },
	{ reason: "avoid-line", label: "别推这条线" },
];

/** 一楼写作过程里界面看到的东西：阶段、自查项、草稿与正文。 */
interface Streaming {
	readonly mode: Mode;
	readonly said: string | null;
	readonly pushLabel: string | null;
	readonly text: string;
	readonly blocks: readonly DisplayedContent[] | null;
	readonly stages: readonly string[];
	readonly checks: readonly string[];
	readonly error: string | null;
	/** 运行 id；有它才能在运行中追加要求。 */
	readonly runId: string | null;
}

/** 输入台的「本轮」：几个影响这一轮怎么写的开关，只随下一次发送生效。 */
function OncePanel({
	switches,
	once,
	onChange,
}: {
	readonly switches: ReadonlyMap<string, StoryFeatureSwitchView>;
	readonly once: OnceOverrides;
	readonly onChange: (next: OnceOverrides) => void;
}) {
	const items = ONCE_SWITCH_IDS.flatMap((id) => {
		const view = switches.get(id);
		return view !== undefined && view.kind === "toggle" && view.wired
			? [{ id, view, story: view.value === true }]
			: [];
	});
	if (items.length === 0) return null;
	const count = Object.keys(once).length;
	return (
		<details className="once">
			<summary>{count === 0 ? "本轮" : `本轮 · 改了 ${count} 项`}</summary>
			<div className="once-list">
				{items.map(({ id, view, story }) => (
					<button
						type="button"
						key={id}
						className="tog"
						aria-pressed={onceValue(once, id, story)}
						data-changed={once[id] === undefined ? undefined : ""}
						title={view.description}
						onClick={() => onChange(toggleOnce(once, id, story))}
					>
						{view.label}
					</button>
				))}
			</div>
		</details>
	);
}

/** 与样式表里手机布局的断点一致。 */
function narrowScreen(): boolean {
	return window.matchMedia("(max-width: 760px)").matches;
}

interface ParagraphCursor {
	count: number;
}

/**
 * 正文渲染。插图按段落序号插在对应段落之后；没有段落位置或超出段落数的
 * 插图排在楼层末尾。插件渲染的楼层由调用方把插图统一放到下方。
 */
function Prose({
	items,
	nodeId,
	hideStatus = false,
	images = [],
	workflows = [],
	onImagesChanged,
	cursor,
}: {
	readonly items: readonly DisplayedContent[];
	readonly nodeId: string | null;
	/** 功能页关掉「状态面板」时不显示状态栏块。 */
	readonly hideStatus?: boolean;
	readonly images?: readonly NodeImage[];
	readonly workflows?: readonly ImageWorkflowRecord[];
	readonly onImagesChanged?: () => void;
	/** 递归渲染内部块时共享同一份段落计数。 */
	readonly cursor?: ParagraphCursor;
}) {
	const root = cursor === undefined;
	const position = cursor ?? { count: 0 };
	const grouped = new Map<number, NodeImage[]>();
	for (const image of images) {
		const at = image.insertAfterParagraph;
		if (at === null) continue;
		const list = grouped.get(at);
		if (list === undefined) grouped.set(at, [image]);
		else list.push(image);
	}
	const renderImage = (image: NodeImage) => (
		<FloorImage
			key={image.id}
			image={image}
			workflows={workflows}
			onChanged={onImagesChanged ?? (() => {})}
		/>
	);

	return (
		<>
			{root ? (grouped.get(0) ?? []).map((image) => renderImage(image)) : null}
			{items.map((item, index) => {
				const key = `${index}`;
				if (item.kind === "text") {
					return item.text
						.split(/\n+/)
						.map((line) => line.trim())
						.filter((line) => line.length > 0)
						.flatMap((line, lineIndex) => {
							position.count += 1;
							return [
								<p
									// biome-ignore lint/suspicious/noArrayIndexKey: 段落没有稳定的 id
									key={`${key}-${lineIndex}`}
									className={isDialogueLine(line) ? "dlg" : undefined}
								>
									{line}
								</p>,
								...(grouped.get(position.count) ?? []).map((image) =>
									renderImage(image),
								),
							];
						});
				}
				const kind = blockViewKind(item);
				// 行动选项放到输入台上，不在正文里重复。
				if (kind === "options" || kind === "hidden") return null;
				if (kind === "status" && hideStatus) return null;
				if (kind === "status") {
					const pairs = plainTextOf(item.content)
						.split(/\n+/)
						.map((line) => line.trim())
						.filter((line) => line.length > 0)
						.map((line) => {
							const at = line.search(/[:：]/);
							return at < 0
								? { k: "", v: line }
								: { k: line.slice(0, at).trim(), v: line.slice(at + 1).trim() };
						});
					return (
						<ul className="statusline" key={key} aria-label="状态">
							{pairs.map((pair, pairIndex) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: 状态行没有稳定的 id
								<li key={pairIndex}>
									{pair.k === "" ? null : <span>{pair.k}</span>}
									{pair.v}
								</li>
							))}
						</ul>
					);
				}
				if (kind === "thinking") {
					return (
						<details key={key}>
							<summary>思考</summary>
							{plainTextOf(item.content)}
						</details>
					);
				}
				if (kind === "narration" || kind === "raw") {
					return (
						<Prose
							key={key}
							items={item.content}
							nodeId={nodeId}
							hideStatus={hideStatus}
							images={images}
							workflows={workflows}
							onImagesChanged={onImagesChanged}
							cursor={position}
						/>
					);
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
			{root
				? images
						.filter(
							(image) =>
								image.insertAfterParagraph === null ||
								image.insertAfterParagraph > position.count,
						)
						.sort((left, right) => left.ordinal - right.ordinal)
						.map((image) => renderImage(image))
				: null}
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

const PAGE = 60;

/** 故事页：书页式正文、页边批注、玻璃输入台，右侧是停靠栏。 */
export function Play() {
	const { storyId = "" } = useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const shell = useShellActions();
	const story = useLoad<StoryView>(() => api.getStory(storyId), [storyId]);
	// 先读最近 60 楼；往上翻时一次多读 60 楼。
	const [limit, setLimit] = useState(PAGE);
	const olderRef = useRef(false);
	const path = useLoad<StoryPath>(
		() => api.getPath(storyId, { limit }),
		[storyId, limit],
	);
	const floors = useLoad<FloorsView>(
		() => api.get<FloorsView>(sp(storyId, "/floors")),
		[storyId],
	);
	const settings = useLoad(() => api.getSettings(storyId), [storyId]);
	const imageWorkflows = useLoad<ImageWorkflowsView>(
		() => api.getImageWorkflows(),
		[],
	);
	const features = useLoad(() => api.getStoryFeatures(storyId), [storyId]);
	const canon = useLoad(() => api.getStoryCanon(storyId), [storyId]);
	const switchView = useMemo(
		() =>
			new Map(
				(features.data?.groups ?? []).flatMap((group) =>
					group.switches.map((item) => [item.id, item] as const),
				),
			),
		[features.data],
	);
	const statusOn = switchView.get("status")?.value !== false;
	const [once, setOnce] = useState<OnceOverrides>({});
	const dock = useLoad<{ recap: string | null }>(
		() => api.get(sp(storyId, "/dock")),
		[storyId],
	);

	const [mode, setMode] = useState<Mode>("fast");
	const [step, setStep] = useState<Step>("advance");
	const [text, setText] = useState("");
	const [whyOpen, setWhyOpen] = useState(false);
	// 批注默认关：正文是主角，系统记了什么去检视器或记事里看。
	const [notesOn, setNotesOn] = useState(() => {
		try {
			return localStorage.getItem("dramaticer.notes") === "on";
		} catch {
			return false;
		}
	});
	const [moreOpen, setMoreOpen] = useState(false);
	const [headMenu, setHeadMenu] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [renameDraft, setRenameDraft] = useState("");
	const [renameBusy, setRenameBusy] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
	const [sandboxDismissed, setSandboxDismissed] = useState(false);
	const [allowingDomain, setAllowingDomain] = useState<string | null>(null);
	const [jumpTo, setJumpTo] = useState("");
	const [pushMenu, setPushMenu] = useState(false);
	const [fromHere, setFromHere] = useState("");
	const [fix, setFix] = useState<{
		readonly nodeId: string;
		readonly quote: string;
	} | null>(null);
	const [fixText, setFixText] = useState("");
	const [fixBusy, setFixBusy] = useState(false);
	const [undoFor, setUndoFor] = useState<string | null>(null);
	const tree = useLoad(() => api.getTree(storyId), [storyId]);
	const [streaming, setStreaming] = useState<Streaming | null>(null);
	const [actions, setActions] = useState<readonly string[]>([]);
	const [directions, setDirections] = useState<readonly PushDirection[]>([]);
	const [dockTab, setDockTab] = useState<DockTab>("dir");
	const [dockTick, setDockTick] = useState(0);
	// 手机上停靠栏是底部抽屉，批注折叠成每楼末尾的小标记。
	const [dockOpen, setDockOpen] = useState(false);
	const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(new Set());
	const [organizing, setOrganizing] = useState<ReadonlySet<string>>(new Set());
	const [imageHint, setImageHint] = useState<{
		readonly nodeId: string;
		readonly text: string;
	} | null>(null);
	const [search] = useSearchParams();
	const focusNode = search.get("node");
	const abort = useRef<AbortController | null>(null);
	const lastRef = useRef<HTMLElement | null>(null);
	const dockRef = useRef<HTMLDivElement | null>(null);
	const sheetRef = useRef<HTMLDivElement | null>(null);
	const cmpRef = useRef<HTMLDivElement | null>(null);
	const bgTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

	// 输入台会随选项和「⋯」展开变高。把实际高度写进 CSS 变量，正文留白与滚动定位跟着变，
	// 滚到底时最后几行不会被浮层盖住。
	useEffect(() => {
		const cmp = cmpRef.current;
		const sheet = sheetRef.current;
		if (cmp === null || sheet === null) return;
		const sync = () => {
			sheet.style.setProperty("--cmp-h", `${cmp.offsetHeight}px`);
		};
		sync();
		const observer = new ResizeObserver(sync);
		observer.observe(cmp);
		return () => observer.disconnect();
	}, []);

	// 顶上那条细线只在真正写作时出现，空闲时不留下一条像卡住的线。
	useEffect(() => {
		const root = document.documentElement;
		if (streaming === null) delete root.dataset.writing;
		else root.dataset.writing = "";
		return () => {
			delete root.dataset.writing;
		};
	}, [streaming]);

	useEffect(() => {
		const stored = settings.data?.turnMode as Mode | undefined;
		if (stored !== undefined) setMode(stored);
	}, [settings.data]);

	// 换故事或开关菜单时复位临时拦截/确认态。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 切换故事时清零
	useEffect(() => {
		setBlockedDomains([]);
		setSandboxDismissed(false);
		setRenaming(false);
		setConfirmRemove(false);
	}, [storyId]);

	useEffect(() => {
		if (!headMenu) setConfirmRemove(false);
	}, [headMenu]);

	useEffect(() => {
		if (!pushMenu && !headMenu && !moreOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setPushMenu(false);
			setHeadMenu(false);
			setMoreOpen(false);
		};
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (target === null) return;
			if (pushMenu && target.closest(".pushsplit") === null) {
				setPushMenu(false);
			}
			if (headMenu && target.closest(".headmenu") === null) {
				setHeadMenu(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("pointerdown", onPointerDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("pointerdown", onPointerDown);
		};
	}, [pushMenu, headMenu, moreOpen]);

	useEffect(
		() => () => {
			for (const timer of bgTimers.current) clearTimeout(timer);
			bgTimers.current = [];
		},
		[],
	);

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
	const sandbox = useLoad<StorySandboxView>(
		() => api.getStorySandbox(storyId),
		[storyId],
	);
	const assistantIds = useMemo(
		() =>
			nodes.filter((node) => node.role === "assistant").map((node) => node.id),
		[nodes],
	);
	// 渲染片断由服务端的插件内核派生；没有渲染器认领时这里只有空结果。
	const [rendered, setRendered] = useState<
		ReadonlyMap<string, FloorRenderView>
	>(() => new Map());
	useEffect(() => {
		if (assistantIds.length === 0) {
			setRendered(new Map());
			return;
		}
		let active = true;
		api
			.renderFloors(storyId, assistantIds)
			.then((view) => {
				if (!active) return;
				setRendered(
					new Map(
						view.floors
							.filter((floor) => floor.renderer !== null)
							.map((floor) => [floor.nodeId, floor] as const),
					),
				);
			})
			.catch(() => {
				if (active) setRendered(new Map());
			});
		return () => {
			active = false;
		};
	}, [storyId, assistantIds]);

	// 从上下文跳过来时，直接翻到这一条对应的楼层。
	useEffect(() => {
		if (focusNode === null) return;
		const node = nodes.find((item) => item.id === focusNode);
		if (node === undefined) return;
		document
			.getElementById(`floor-${node.id}`)
			?.scrollIntoView({ block: "center" });
	}, [focusNode, nodes]);

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

	// 打开推进菜单时才读剧情走向：方向由走向页的两栏当场派生，不额外占后台调用。
	useEffect(() => {
		if (!pushMenu) return;
		let active = true;
		api
			.getDirection(storyId)
			.then((view) => {
				if (active) setDirections(view.pushDirections);
			})
			.catch(() => {
				if (active) setDirections([]);
			});
		return () => {
			active = false;
		};
	}, [pushMenu, storyId]);

	const refresh = useCallback(() => {
		canon.reload();
		path.reload();
		floors.reload();
		dock.reload();
		tree.reload();
		setDockTick((value) => value + 1);
	}, [canon.reload, path.reload, floors.reload, dock.reload, tree.reload]);

	// 有插图在画、或刚点了「画这一幕」时轮询路径，直到结果落定或整理出记录。
	const imagesWorking = nodes.some((node) =>
		node.images.some(
			(image) => image.status === "pending" || image.status === "running",
		),
	);
	useEffect(() => {
		if (!imagesWorking && organizing.size === 0) return;
		const timer = setInterval(() => path.reload(), 1_500);
		return () => clearInterval(timer);
	}, [imagesWorking, organizing.size, path.reload]);
	useEffect(() => {
		if (organizing.size === 0) return;
		const arrived = nodes.filter(
			(node) => organizing.has(node.id) && node.images.length > 0,
		);
		if (arrived.length === 0) return;
		setOrganizing((previous) => {
			const next = new Set(previous);
			for (const node of arrived) next.delete(node.id);
			return next;
		});
	}, [nodes, organizing]);
	// 整理可能一张图都没给出；不要让轮询一直跑下去。
	useEffect(() => {
		if (organizing.size === 0) return;
		const timer = setTimeout(() => setOrganizing(new Set()), 45_000);
		return () => clearTimeout(timer);
	}, [organizing]);

	const organizeImages = (nodeId: string) => {
		const config = settings.data?.imageConfig;
		if (config === undefined) return;
		if (config.mode === "off") {
			setImageHint({
				nodeId,
				text: "生图模式已关闭；先在故事设置的「生图」里开启。",
			});
			return;
		}
		const workflowId = config.workflowId.trim();
		const ready = (imageWorkflows.data?.workflows ?? []).some(
			(workflow) => workflow.id === workflowId,
		);
		if (workflowId === "" || !ready) {
			setImageHint({
				nodeId,
				text: "还没有可用的生图模板；先在故事设置的「生图」里选择 workflow。",
			});
			return;
		}
		setImageHint(null);
		setOrganizing((previous) => new Set(previous).add(nodeId));
		api
			.organizeNodeImages(storyId, nodeId)
			.then(() => toast("已排入后台画面整理"))
			.catch((error: unknown) => {
				setOrganizing((previous) => {
					const next = new Set(previous);
					next.delete(nodeId);
					return next;
				});
				toast(errorText(error));
			});
	};

	// 每个叶子是一条分支；只有一条时不显示分支选择。
	const branches = useMemo(() => {
		const data = tree.data;
		if (data === null) return [];
		const byId = new Map(data.nodes.map((node) => [node.id, node] as const));
		const depth = (id: string): number => {
			let count = 0;
			let current = byId.get(id);
			while (current !== undefined) {
				count += 1;
				current =
					current.parentId === null ? undefined : byId.get(current.parentId);
			}
			return count;
		};
		return data.nodes
			.filter((node) => node.childIds.length === 0)
			.map((node) => ({
				id: node.id,
				label: `第 ${depth(node.id)} 楼 · ${node.preview.slice(0, 18)}`,
			}));
	}, [tree.data]);

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
					case "turn.started":
						update({ runId: event.data.runId });
						break;
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
		if (state.error === null) {
			setStreaming(null);
			for (const timer of bgTimers.current) clearTimeout(timer);
			bgTimers.current = [
				setTimeout(() => {
					floors.reload();
					dock.reload();
					setDockTick((value) => value + 1);
				}, 4_000),
				setTimeout(() => {
					floors.reload();
					dock.reload();
					setDockTick((value) => value + 1);
				}, 12_000),
			];
		}
		refresh();
	};

	const send = (message: string, push: Step | null) => {
		if (streaming !== null && streaming.error === null) return;
		setPushMenu(false);
		setHeadMenu(false);
		const controller = new AbortController();
		abort.current = controller;
		stage.pulse(push === null ? 0.8 : 1.3);
		setOnce({});
		void consume(
			api.streamTurn(
				storyId,
				// 写法由玩家选；服务端按这个值走对应的流程。
				{
					text: message,
					mode: mode as "fast",
					...(push === null ? {} : { push }),
					// 本轮临时开关只随这一次发送，发完清空。
					...(Object.keys(once).length === 0 ? {} : { features: once }),
				},
				controller.signal,
			),
			{
				mode,
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
				runId: null,
			},
		);
	};

	const submit = () => {
		const message = text.trim();
		if (message === "") {
			toast("输入为空");
			return;
		}
		setText("");
		send(message, null);
	};

	const reroll = (reason: RerollReason | null, label: string) => {
		if (lastAssistant === undefined) return;
		setPushMenu(false);
		setHeadMenu(false);
		const controller = new AbortController();
		abort.current = controller;
		stage.pulse(1);
		void consume(
			api.streamRegenerate(
				lastAssistant.id,
				reason === null ? {} : { reason },
				controller.signal,
			),
			{
				mode,
				said: null,
				pushLabel: reason === null ? "重写" : `重写 · ${label}`,
				text: "",
				blocks: null,
				stages: [],
				checks: [],
				error: null,
				runId: null,
			},
		).then(() => toast("已重写"));
	};

	const startFix = (nodeId: string) => {
		const selection = window.getSelection();
		const floor = document.getElementById(`floor-${nodeId}`);
		const selected =
			selection !== null &&
			floor !== null &&
			selection.anchorNode !== null &&
			floor.contains(selection.anchorNode)
				? selection.toString().trim()
				: "";
		setFix({ nodeId, quote: selected });
		setFixText("");
	};

	const submitFix = async () => {
		if (fix === null) return;
		setFixBusy(true);
		try {
			await api.correctNode(fix.nodeId, {
				quote: fix.quote.trim(),
				instruction: fixText.trim(),
			});
			setFix(null);
			toast("已改写");
			refresh();
		} catch (error) {
			toast(errorText(error));
		} finally {
			setFixBusy(false);
		}
	};

	const steer = async () => {
		const message = text.trim();
		const runId = streaming?.runId ?? null;
		if (message === "" || runId === null) return;
		try {
			await api.steerTurn(storyId, runId, { text: message });
			setText("");
			toast("已追加");
		} catch (error) {
			toast(errorText(error));
		}
	};

	const sceneControl = async (request: SceneControlRequest, done: string) => {
		if (lastAssistant === undefined) return;
		try {
			await api.sceneControl(lastAssistant.id, request);
			toast(done);
			refresh();
		} catch (error) {
			toast(errorText(error));
		}
	};

	const exportBook = async () => {
		setHeadMenu(false);
		try {
			const book = await api.exportBook(storyId);
			const url = URL.createObjectURL(
				new Blob([book.markdown], { type: "text/markdown;charset=utf-8" }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = book.fileName;
			link.rel = "noopener";
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
			toast("已导出");
		} catch (error) {
			toast(errorText(error));
		}
	};

	const branchHere = async (nodeId: string, no: number | undefined) => {
		try {
			await api.setHead(storyId, nodeId);
			toast(`已回到第 ${no ?? "?"} 楼`);
			refresh();
		} catch (error) {
			toast(errorText(error));
		}
	};

	const switchBranch = async (leafId: string) => {
		try {
			await api.setHead(storyId, leafId);
			refresh();
		} catch (error) {
			toast(errorText(error));
		}
	};

	const saveRename = async () => {
		const next = renameDraft.trim();
		if (next === "") {
			toast("标题不能为空");
			return;
		}
		setRenameBusy(true);
		try {
			await api.updateStory(storyId, { title: next });
			setRenaming(false);
			story.reload();
			toast("已重命名");
		} catch (error) {
			toast(errorText(error));
		} finally {
			setRenameBusy(false);
		}
	};

	const removeStory = async () => {
		try {
			await api.deleteStory(storyId);
			try {
				localStorage.removeItem("dramaticer.lastStory");
			} catch {
				// 隐私模式忽略。
			}
			toast("已移出书架");
			navigate("/");
		} catch (error) {
			toast(errorText(error));
		}
	};

	const allowBlockedDomain = async (domain: string) => {
		setAllowingDomain(domain);
		try {
			await api.updateSandboxDomain(storyId, domain, true);
			sandbox.reload();
			setBlockedDomains((previous) =>
				previous.filter((item) => item !== domain),
			);
			toast(`已放行 ${domain}`);
		} catch (error) {
			toast(errorText(error));
		} finally {
			setAllowingDomain(null);
		}
	};

	const allowAllBlockedDomains = async () => {
		const allowed = new Set(sandbox.data?.allowedDomains ?? []);
		const targets = blockedDomains.filter((domain) => !allowed.has(domain));
		if (targets.length === 0) return;
		setAllowingDomain("*");
		try {
			for (const domain of targets) {
				await api.updateSandboxDomain(storyId, domain, true);
			}
			sandbox.reload();
			setBlockedDomains((previous) =>
				previous.filter((domain) => !targets.includes(domain)),
			);
			toast(`已放行 ${targets.length} 个域名`);
		} catch (error) {
			toast(errorText(error));
		} finally {
			setAllowingDomain(null);
		}
	};

	const changeMode = (value: Mode) => {
		setMode(value);
		api.updateSettings(storyId, { turnMode: value as "fast" }).catch(() => {});
	};

	const advanceCanon = async (count: number) => {
		try {
			await api.advanceCanon(storyId, count);
			canon.reload();
			send(PUSH_TURN_TEXT, step);
		} catch (error) {
			toast(errorText(error));
		}
	};

	const jumpCanon = async () => {
		const eventId = Number(fromHere);
		if (!Number.isInteger(eventId) || eventId < 1) return;
		try {
			await api.startCanonFromHere(storyId, { eventId });
			setFromHere("");
			toast("已从这里开始");
			refresh();
		} catch (error) {
			toast(errorText(error));
		}
	};

	const undo = async (nodeId: string, rewrite: boolean) => {
		setUndoFor(null);
		try {
			await api.call("POST", sp(storyId, "/director/undo"), { nodeId });
			if (rewrite && nodeId === lastAssistant?.id) {
				reroll("avoid-line", "别推这条线");
			} else {
				toast("已撤回");
				refresh();
			}
		} catch (error) {
			toast(errorText(error));
		}
	};

	const showContext = useCallback(() => {
		setDockTab("ctx");
		if (narrowScreen()) setDockOpen(true);
		else
			dockRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}, []);

	useEffect(() => {
		if (!dockOpen) return;
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") setDockOpen(false);
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [dockOpen]);

	// 从抽屉里跳到某一楼时，抽屉让开。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在目标楼层变化时收起
	useEffect(() => {
		setDockOpen(false);
	}, [focusNode]);

	const toggleNotes = (nodeId: string) =>
		setOpenNotes((current) => {
			const next = new Set(current);
			if (next.has(nodeId)) next.delete(nodeId);
			else next.add(nodeId);
			return next;
		});

	usePaletteCommands(
		// biome-ignore lint/correctness/useExhaustiveDependencies: send 每次渲染都是新的，用它依赖的状态代替
		useCallback(
			() => [
				{ label: "推进一步", run: () => send(PUSH_TURN_TEXT, "advance") },
				{ label: "查看上下文", run: showContext },
				{
					label: notesOn ? "关掉批注" : "打开批注",
					run: () => setNotesOn((v) => !v),
				},
			],
			[showContext, notesOn, mode, storyId, streaming],
		),
	);

	useEffect(() => {
		try {
			localStorage.setItem("dramaticer.notes", notesOn ? "on" : "off");
		} catch {
			// 隐私模式下存不了，只影响下次打开时的默认值。
		}
	}, [notesOn]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 新楼层出现或开始写时滚到最后
	useEffect(() => {
		// 往上加载更早的楼层时留在原处。
		if (olderRef.current) {
			olderRef.current = false;
			return;
		}
		lastRef.current?.scrollIntoView({ block: "nearest" });
	}, [nodes.length, streaming === null]);

	// 写作期间背景的潮水涨起来、灯塔转得更快；离开页面时恢复。
	const busy = streaming !== null && streaming.error === null;
	useEffect(() => {
		stage.setWriting(busy);
		return () => stage.setWriting(false);
	}, [busy]);

	if (path.error !== null) {
		return (
			<div className="v4err">
				{path.error} <TLink to="/">回到书架</TLink>
			</div>
		);
	}
	const title = story.data?.title ?? "";
	const allowedSet = new Set(sandbox.data?.allowedDomains ?? []);
	const unallowedBlocked = blockedDomains.filter(
		(domain) => !allowedSet.has(domain),
	);
	const stageNames = streaming === null ? [] : MODE_STAGES[streaming.mode];
	const stageReached =
		streaming === null
			? -1
			: reachedStage(
					streaming.mode,
					streaming.stages,
					streaming.text !== "" || streaming.blocks !== null,
				);

	return (
		<section data-view="play">
			<BackgroundNotice storyId={storyId} tick={dockTick} />
			<div className="play">
				<div
					className={notesOn ? "sheet" : "sheet nonotes"}
					id="sheet"
					ref={sheetRef}
				>
					<div className="sheet-head">
						<div className="ttl">
							<Cover storyId={storyId} title={title} />
							<h1>{title}</h1>
						</div>
						<div className="sheet-tools">
							{branches.length > 1 ? (
								<select
									className="branchsel"
									aria-label="分支"
									value={
										branches.find(
											(branch) => branch.id === tree.data?.headNodeId,
										)?.id ?? ""
									}
									onChange={(event) => void switchBranch(event.target.value)}
									disabled={busy}
								>
									{branches.find(
										(branch) => branch.id === tree.data?.headNodeId,
									) === undefined ? (
										<option value="">当前位置（中途）</option>
									) : null}
									{branches.map((branch) => (
										<option key={branch.id} value={branch.id}>
											{branch.label}
										</option>
									))}
								</select>
							) : null}
							<span className="label">第 {nodes.length} 楼</span>
							<div className="headmenu">
								<button
									type="button"
									className="btn ghost sm"
									aria-label="故事菜单"
									aria-haspopup="menu"
									aria-expanded={headMenu}
									onClick={() => setHeadMenu((value) => !value)}
								>
									⋯
								</button>
								{headMenu ? (
									<div className="pushmenu" role="menu" aria-label="故事菜单">
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												setHeadMenu(false);
												setRenameDraft(title);
												setRenaming(true);
											}}
										>
											重命名
										</button>
										<button
											type="button"
											role="menuitem"
											onClick={() => void exportBook()}
										>
											导出
										</button>
										<TLink
											role="menuitem"
											to={`/stories/${encodeURIComponent(storyId)}/prefs`}
										>
											本故事设置
										</TLink>
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												setHeadMenu(false);
												shell.openAssistant();
											}}
										>
											助手
										</button>
										<button
											type="button"
											role="menuitem"
											onClick={() => {
												setHeadMenu(false);
												shell.openInspector();
											}}
										>
											检视器
										</button>
										{confirmRemove ? (
											<button
												type="button"
												role="menuitem"
												className="danger"
												onClick={() => {
													setHeadMenu(false);
													void removeStory();
												}}
											>
												确认移出书架
											</button>
										) : (
											<button
												type="button"
												role="menuitem"
												className="danger"
												onClick={() => setConfirmRemove(true)}
											>
												移出书架
											</button>
										)}
									</div>
								) : null}
							</div>
							<button
								type="button"
								className="btn sm dockbtn"
								aria-expanded={dockOpen}
								aria-controls="dock"
								onClick={() => setDockOpen(true)}
							>
								导演 · 记忆 · 上下文
							</button>
						</div>
					</div>
					{renaming ? (
						<form
							className="rename-bar"
							onSubmit={(event) => {
								event.preventDefault();
								void saveRename();
							}}
						>
							<input
								className="v4in"
								aria-label="故事新标题"
								value={renameDraft}
								onChange={(event) => setRenameDraft(event.target.value)}
								disabled={renameBusy}
							/>
							<button
								type="submit"
								className="btn gold sm"
								disabled={renameBusy || renameDraft.trim() === ""}
							>
								{renameBusy ? "保存中…" : "保存"}
							</button>
							<button
								type="button"
								className="btn ghost sm"
								onClick={() => setRenaming(false)}
								disabled={renameBusy}
							>
								取消
							</button>
						</form>
					) : null}
					{dock.data?.recap ? (
						<details className="recapbox" open>
							<summary>上回说到</summary>
							<p>{dock.data.recap}</p>
						</details>
					) : null}
					<div id="script">
						{path.data?.hasMore ? (
							<button
								type="button"
								className="btn ghost sm older"
								onClick={() => {
									olderRef.current = true;
									setLimit((value) => value + PAGE);
								}}
							>
								更早的楼层
							</button>
						) : null}
						{nodes.length === 0 && path.data !== null ? (
							<p className="v4empty lede">暂无内容</p>
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
							const frame = rendered.get(node.id);
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
										id={`floor-${node.id}`}
										ref={node.id === lastId ? lastRef : undefined}
									>
										<div className="prose">
											{frame === undefined ? (
												<>
													<Prose
														items={parsed.get(node.id) ?? []}
														nodeId={node.id}
														hideStatus={!statusOn}
														images={node.images}
														workflows={imageWorkflows.data?.workflows ?? []}
														onImagesChanged={() => path.reload()}
													/>
													{meta?.no === 1 &&
													(parsed.get(node.id) ?? []).length === 0 ? (
														<p className="flr-empty">
															这一楼没有可显示的正文：开场白是空白或只含卡片脚本。直接输入行动就能开始。
														</p>
													) : null}
												</>
											) : (
												<>
													<FloorFrame
														storyId={storyId}
														render={frame}
														allowedDomains={sandbox.data?.allowedDomains ?? []}
														onSendMessage={(message) => send(message, null)}
														onFillInput={setText}
														onRejected={(rejection) => {
															if (rejection.kind === "network") {
																try {
																	const host = new URL(
																		rejection.target,
																	).hostname.toLowerCase();
																	if (host !== "") {
																		setBlockedDomains((previous) =>
																			previous.includes(host)
																				? previous
																				: [...previous, host],
																		);
																	}
																} catch {
																	// 忽略非 URL 目标。
																}
															}
															api
																.recordSandboxRejection(storyId, {
																	nodeId: rejection.nodeId,
																	renderer: rejection.renderer,
																	kind: rejection.kind,
																	target: rejection.target,
																	reason: rejection.reason,
																})
																.catch(() => {});
														}}
													/>
													<FloorImageList
														images={node.images}
														workflows={imageWorkflows.data?.workflows ?? []}
														onChanged={() => path.reload()}
													/>
												</>
											)}
										</div>
										<aside
											className={
												openNotes.has(node.id) ? "notes open" : "notes"
											}
										>
											<span className="fno">第 {meta?.no ?? "?"} 楼</span>
											{(meta?.notes ?? []).length > 0 ? (
												<button
													type="button"
													className="nmark"
													aria-expanded={openNotes.has(node.id)}
													onClick={() => toggleNotes(node.id)}
												>
													批注 {meta?.notes.length}
												</button>
											) : null}
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
															{undoFor === node.id ? (
																<span className="undo-choice">
																	<button
																		type="button"
																		onClick={() => void undo(node.id, false)}
																	>
																		仅撤回
																	</button>
																	{node.id === lastId ? (
																		<button
																			type="button"
																			onClick={() => void undo(node.id, true)}
																		>
																			撤回并重写
																		</button>
																	) : null}
																</span>
															) : (
																<button
																	type="button"
																	onClick={() => setUndoFor(node.id)}
																>
																	撤回
																</button>
															)}
														</>
													)}
												</div>
											))}
										</aside>
									</article>
									<div
										className="flr-acts"
										data-node-id={node.id}
										aria-label={`第 ${meta?.no ?? "?"} 楼的操作`}
									>
										{node.id === lastId ? (
											<button
												type="button"
												disabled={busy}
												aria-expanded={whyOpen}
												onClick={() => setWhyOpen((value) => !value)}
											>
												重写
											</button>
										) : null}
										<button
											type="button"
											disabled={busy}
											onClick={() => startFix(node.id)}
										>
											改这句
										</button>
										{node.id === lastId ? null : (
											<button
												type="button"
												disabled={busy}
												onClick={() => void branchHere(node.id, meta?.no)}
											>
												从这里分支
											</button>
										)}
										<button
											type="button"
											disabled={busy || organizing.has(node.id)}
											onClick={() => organizeImages(node.id)}
										>
											{organizing.has(node.id) ? "整理中…" : "画这一幕"}
										</button>
										<button type="button" onClick={showContext}>
											上下文
										</button>
									</div>
									{imageHint?.nodeId === node.id ? (
										<output className="image-hint">
											{imageHint.text}{" "}
											<TLink
												to={`/stories/${encodeURIComponent(storyId)}/prefs?tab=adv`}
											>
												去故事设置
											</TLink>
										</output>
									) : null}
									{node.id === lastId && whyOpen ? (
										<div className="why">
											<span>重写原因（可选）</span>
											<button
												type="button"
												className="chip"
												onClick={() => reroll(null, "")}
											>
												直接重写
											</button>
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
									{fix?.nodeId === node.id ? (
										<form
											className="fixbox"
											aria-label="改这句"
											onSubmit={(event) => {
												event.preventDefault();
												void submitFix();
											}}
										>
											<label>
												<span>要改的原文</span>
												<textarea
													rows={2}
													value={fix.quote}
													placeholder="原句"
													onChange={(event) =>
														setFix({
															nodeId: fix.nodeId,
															quote: event.target.value,
														})
													}
												/>
											</label>
											<label>
												<span>改成什么样</span>
												<textarea
													rows={2}
													value={fixText}
													placeholder="改成…"
													onChange={(event) => setFixText(event.target.value)}
												/>
											</label>
											<div className="fixbox-acts">
												<button
													type="button"
													className="btn ghost sm"
													onClick={() => setFix(null)}
													disabled={fixBusy}
												>
													取消
												</button>
												<button
													type="submit"
													className="btn gold sm"
													disabled={
														fixBusy ||
														fix.quote.trim() === "" ||
														fixText.trim() === ""
													}
												>
													{fixBusy ? "改写中…" : "只改这一段"}
												</button>
											</div>
										</form>
									) : null}
								</div>
							);
						})}
						{streaming === null ? (
							<Opening
								storyId={storyId}
								tick={dockTick}
								busy={busy}
								onChanged={refresh}
							/>
						) : null}
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
														className={index <= stageReached ? "on" : undefined}
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
											<Prose
												items={streaming.blocks}
												nodeId={null}
												hideStatus={!statusOn}
											/>
										) : (
											streaming.text
												.split(/\n+/)
												.filter((line) => line.trim() !== "")
												.map((line, index, all) => (
													<p
														// biome-ignore lint/suspicious/noArrayIndexKey: 流式段落
														key={index}
														className={
															[
																isDialogueLine(line) ? "dlg" : "",
																index === all.length - 1 ? "caret" : "",
															]
																.join(" ")
																.trim() || undefined
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
					{unallowedBlocked.length > 0 && !sandboxDismissed ? (
						<output className="sandbox-notice">
							<span>
								{unallowedBlocked.length === 1
									? `卡片试图加载外部资源（${unallowedBlocked[0]}），已按安全沙箱拦截。`
									: `卡片请求了 ${unallowedBlocked.length} 个外部域名（${unallowedBlocked
											.slice(0, 3)
											.join(
												"、",
											)}${unallowedBlocked.length > 3 ? " 等" : ""}），已按安全沙箱拦截。`}
							</span>
							{unallowedBlocked.length === 1 ? (
								<button
									type="button"
									className="btn sm"
									disabled={allowingDomain !== null}
									onClick={() =>
										void allowBlockedDomain(unallowedBlocked[0] ?? "")
									}
								>
									{allowingDomain === unallowedBlocked[0]
										? "放行中…"
										: `允许 ${unallowedBlocked[0]}`}
								</button>
							) : (
								<button
									type="button"
									className="btn sm"
									disabled={allowingDomain !== null}
									onClick={() => void allowAllBlockedDomains()}
								>
									{allowingDomain === "*" ? "放行中…" : "放行全部"}
								</button>
							)}
							<TLink
								className="btn ghost sm"
								to={`/stories/${encodeURIComponent(storyId)}/lore`}
							>
								管理设定
							</TLink>
							<button
								type="button"
								className="btn ghost sm"
								onClick={() => setSandboxDismissed(true)}
							>
								忽略
							</button>
						</output>
					) : null}
					{/* 输入台里的按钮不抢走输入框的焦点：手机键盘不收起，打字时收起的导航也不会
					    在按下与松开之间弹回来，让点击落空。键盘的 Tab 照常能聚焦按钮。 */}
					<div
						className="cmp"
						ref={cmpRef}
						data-busy={busy ? "" : undefined}
						onMouseDown={(event) => {
							if ((event.target as HTMLElement).closest("button") !== null) {
								event.preventDefault();
							}
						}}
					>
						{actions.length > 0 && !busy ? (
							<div className="opts">
								{actions.slice(0, 4).map((action) => (
									<span className="opt" key={action}>
										<button
											type="button"
											className="chip"
											onClick={() => {
												// 选了哪个选项是偏好信号；记录失败不影响发送。
												if (lastId !== null)
													api
														.recordChoice(lastId, { text: action })
														.catch(() => {});
												send(action, null);
											}}
										>
											{action}
										</button>
										<button
											type="button"
											className="chip-edit"
											aria-label={`改一改再发：${action}`}
											title="改后再发"
											onClick={() => setText(action)}
										>
											✎
										</button>
									</span>
								))}
							</div>
						) : null}
						<div className="say">
							<button
								type="button"
								className="btn ghost cmp-more-btn"
								aria-label="写法与本轮设置"
								aria-expanded={moreOpen}
								onClick={() => setMoreOpen((value) => !value)}
							>
								⋯
							</button>
							<textarea
								rows={1}
								aria-label="输入行动或对话"
								value={text}
								placeholder="输入行动或对话"
								onChange={(event) => setText(event.target.value)}
								onKeyDown={(event) => {
									if (
										event.key === "Enter" &&
										!event.shiftKey &&
										!event.nativeEvent.isComposing &&
										!narrowScreen()
									) {
										event.preventDefault();
										if (text.trim() !== "") submit();
									}
								}}
							/>
							{busy && text.trim() !== "" && streaming?.runId != null ? (
								<button
									type="button"
									className="btn gold"
									onClick={() => void steer()}
								>
									追加
								</button>
							) : null}
							{busy ? (
								<button
									type="button"
									className="btn"
									onClick={() => abort.current?.abort()}
								>
									停下
								</button>
							) : text.trim() !== "" ? (
								<button type="button" className="btn gold" onClick={submit}>
									发送
								</button>
							) : (
								<div className="pushsplit">
									<button
										type="button"
										className="btn gold"
										onClick={() => send(PUSH_TURN_TEXT, step)}
									>
										推进<span className="steplbl"> · {STEP_LABEL[step]}</span>
									</button>
									<button
										type="button"
										className="btn gold caret"
										aria-label="选择推进多少"
										aria-haspopup="menu"
										aria-expanded={pushMenu}
										onClick={() => setPushMenu((value) => !value)}
									>
										▾
									</button>
									{pushMenu ? (
										<div className="pushmenu" role="menu" aria-label="推进">
											{directions.length === 0 ? null : (
												<>
													<small className="menuhead">往哪走</small>
													{directions.map((direction) => (
														<button
															type="button"
															role="menuitem"
															key={direction.id}
															data-direction={direction.id}
															onClick={() => {
																setPushMenu(false);
																send(pushDirectionText(direction.text), step);
															}}
														>
															<span>{direction.text}</span>
															{direction.detail === null ? null : (
																<small>{direction.detail}</small>
															)}
														</button>
													))}
												</>
											)}
											{canon.data?.bound === null ||
											canon.data?.bound === undefined ? null : (
												<>
													<small className="menuhead">原著</small>
													<button
														type="button"
														role="menuitem"
														data-canon-advance="1"
														onClick={() => {
															setPushMenu(false);
															void advanceCanon(1);
														}}
													>
														推进到下一件
													</button>
													{([2, 3] as const).map((count) => (
														<button
															type="button"
															role="menuitem"
															key={count}
															data-canon-advance={count}
															onClick={() => {
																setPushMenu(false);
																void advanceCanon(count);
															}}
														>
															推进 {count} 件
														</button>
													))}
												</>
											)}
											<small className="menuhead">走多远</small>
											{(["advance", "quick", "jump"] as const).map((value) => (
												<button
													type="button"
													role="menuitem"
													key={value}
													aria-current={step === value ? "true" : undefined}
													onClick={() => {
														setStep(value);
														setPushMenu(false);
														send(PUSH_TURN_TEXT, value);
													}}
												>
													<span>
														{STEP_LABEL[value]}
														{step === value ? (
															<span className="stepmark" aria-hidden="true">
																✓
															</span>
														) : null}
													</span>
													<small>{STEP_HINT[value]}</small>
												</button>
											))}
										</div>
									) : null}
								</div>
							)}
						</div>
						{moreOpen ? (
							<div className="meta">
								<div className="metagroup" aria-label="写法与开关">
									<span className="label metatitle">写法与开关</span>
									<Seg<Mode>
										small
										label="写法"
										value={mode}
										onChange={changeMode}
										options={[
											{ v: "fast", label: "快速" },
											...(mode === "fast"
												? []
												: [
														{
															v: mode,
															label:
																mode === "plan"
																	? "规划（实验）"
																	: "深度（实验）",
														},
													]),
										]}
									/>
									<Tog pressed={notesOn} onChange={setNotesOn}>
										批注
									</Tog>
									<OncePanel
										switches={switchView}
										once={once}
										onChange={setOnce}
									/>
								</div>
								<div className="metagroup" aria-label="场景跳转">
									<span className="label metatitle">场景跳转</span>
									{lastAssistant === undefined ? null : (
										<div className="scenectl">
											<button
												type="button"
												className="btn sm"
												disabled={busy}
												onClick={() =>
													void sceneControl(
														{ kind: "end-scene" },
														"这一场已结束",
													)
												}
											>
												结束这一场
											</button>
											<form
												className="jumpto"
												onSubmit={(event) => {
													event.preventDefault();
													const time = jumpTo.trim();
													if (time === "") return;
													setJumpTo("");
													void sceneControl(
														{ kind: "jump-time", time },
														`已跳到${time}`,
													);
												}}
											>
												<span className="jumpto-label">跳到</span>
												<input
													className="v4in"
													aria-label="跳到的时间"
													placeholder="某个时间"
													value={jumpTo}
													onChange={(event) => setJumpTo(event.target.value)}
												/>
												<button
													type="submit"
													className="btn sm"
													disabled={busy || jumpTo.trim() === ""}
												>
													跳转
												</button>
											</form>
										</div>
									)}
									{canon.data?.bound === null ||
									canon.data?.bound === undefined ? null : (
										<div className="canonctl" aria-label="原著">
											<span>
												原著 · {canon.data.bound.currentEvent?.title ?? "—"}
												{canon.data.bound.pendingAdvance > 0
													? ` · 待推进 ${canon.data.bound.pendingAdvance} 件`
													: ""}
											</span>
											<select
												className="v4in"
												aria-label="从这里开始"
												value={fromHere}
												onChange={(event) => setFromHere(event.target.value)}
											>
												<option value="">从这里开始…</option>
												{canon.data.bound.timeline.map((event) => (
													<option key={event.id} value={event.id}>
														{event.eventOrdinal}. {event.title}
													</option>
												))}
											</select>
											<button
												type="button"
												className="btn sm"
												disabled={fromHere === "" || busy}
												onClick={() => void jumpCanon()}
											>
												跳到这里
											</button>
										</div>
									)}
								</div>
								<div className="metagroup metatools" aria-label="工具">
									<button
										type="button"
										className="btn ghost sm meta-tool"
										onClick={shell.openInspector}
									>
										检视器
									</button>
									<button
										type="button"
										className="btn ghost sm meta-tool"
										onClick={shell.openAssistant}
									>
										助手
									</button>
								</div>
							</div>
						) : null}
					</div>
				</div>
				{dockOpen ? (
					// biome-ignore lint/a11y/useKeyWithClickEvents: Esc 在窗口上处理
					<div
						className="dockscrim"
						aria-hidden="true"
						onClick={() => setDockOpen(false)}
					/>
				) : null}
				<div ref={dockRef} className={dockOpen ? "dockwrap open" : "dockwrap"}>
					<button
						type="button"
						className="dockclose"
						aria-label="收起停靠栏"
						onClick={() => setDockOpen(false)}
					/>
					<Dock
						storyId={storyId}
						tab={dockTab}
						onTab={setDockTab}
						tick={dockTick}
						onChanged={refresh}
					/>
				</div>
			</div>
		</section>
	);
}

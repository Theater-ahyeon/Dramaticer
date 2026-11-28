import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import {
	AssistantDrawer,
	type AssistantSummary,
	EMPTY_ASSISTANT_SUMMARY,
} from "../assistant/AssistantDrawer";
import { Mark } from "./Backdrop";
import { Inspector } from "./Inspector";
import { type ShellActions, ShellActionsContext } from "./shell-actions";
import {
	type Theme,
	nextTheme,
	onThemeChange,
	routeCommitted,
	setTheme,
	storedTheme,
	travel,
} from "./stage";
import { TLink, ToastProvider } from "./ui";
import "./v4.css";

const LAST_STORY_KEY = "dramaticer.lastStory";

export function rememberStory(storyId: string): void {
	try {
		localStorage.setItem(LAST_STORY_KEY, storyId);
	} catch {
		// 隐私模式下存不了也不影响使用。
	}
}

function lastStory(): string | null {
	try {
		return localStorage.getItem(LAST_STORY_KEY);
	} catch {
		return null;
	}
}

function forgetStory(): void {
	try {
		localStorage.removeItem(LAST_STORY_KEY);
	} catch {
		// 隐私模式下忽略即可。
	}
}

const NAV = [
	{ view: "play", glyph: "文", label: "故事" },
	{ view: "memory", glyph: "忆", label: "记忆" },
	{ view: "outline", glyph: "走", label: "走向" },
	{ view: "lore", glyph: "设", label: "设定" },
	{ view: "prefs", glyph: "调", label: "设置" },
] as const;

const THEME_LABEL: Record<Theme, string> = {
	auto: "跟随系统",
	dark: "暗",
	light: "亮",
};

/** 外观按钮的三态图标：太阳、月亮、半明半暗。 */
function ThemeIcon({ theme }: { readonly theme: Theme }) {
	if (theme === "dark") {
		return (
			<svg
				viewBox="0 0 24 24"
				width="18"
				height="18"
				aria-hidden="true"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
			</svg>
		);
	}
	if (theme === "auto") {
		return (
			<svg
				viewBox="0 0 24 24"
				width="18"
				height="18"
				aria-hidden="true"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
			>
				<circle cx="12" cy="12" r="8" />
				<path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" stroke="none" />
			</svg>
		);
	}
	return (
		<svg
			viewBox="0 0 24 24"
			width="18"
			height="18"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
		>
			<circle cx="12" cy="12" r="4.2" />
			<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" />
		</svg>
	);
}

/** 命令面板里除了跳转之外的动作，由当前页面登记。 */
export interface PaletteCommand {
	readonly label: string;
	readonly run: () => void;
}

const pageCommands = new Set<() => readonly PaletteCommand[]>();

/** 页面登记自己的命令；卸载时取消。 */
export function usePaletteCommands(
	provider: () => readonly PaletteCommand[],
): void {
	useEffect(() => {
		pageCommands.add(provider);
		return () => {
			pageCommands.delete(provider);
		};
	}, [provider]);
}

/** 新界面的外壳：桌面在左侧、手机在底部的印章式导航，加命令面板。 */
export function Shell() {
	const params = useParams();
	const location = useLocation();
	const navigate = useNavigate();
	const [validatedStoryId, setValidatedStoryId] = useState<string | null>(null);
	const storyId = params.storyId ?? validatedStoryId;
	const [palette, setPalette] = useState(false);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const [theme, setThemeState] = useState<Theme>(storedTheme);
	const [assistantOpen, setAssistantOpen] = useState(false);
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [assistantSummary, setAssistantSummary] = useState<AssistantSummary>(
		EMPTY_ASSISTANT_SUMMARY,
	);
	const openAssistant = useCallback(() => {
		setInspectorOpen(false);
		setAssistantOpen(true);
	}, []);
	const openInspector = useCallback(() => {
		setAssistantOpen(false);
		setInspectorOpen(true);
	}, []);
	const closeAssistant = useCallback(() => setAssistantOpen(false), []);
	const closeInspector = useCallback(() => setInspectorOpen(false), []);
	const actions = useMemo<ShellActions>(
		() => ({ openAssistant, openInspector }),
		[openAssistant, openInspector],
	);

	// 换故事时助手跟着换，旧故事的抽屉收起。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在故事变化时执行
	useEffect(() => {
		setAssistantOpen(false);
		setAssistantSummary(EMPTY_ASSISTANT_SUMMARY);
	}, [storyId]);

	useEffect(() => onThemeChange(setThemeState), []);

	useEffect(() => {
		if (params.storyId !== undefined) {
			rememberStory(params.storyId);
			setValidatedStoryId(params.storyId);
			return;
		}
		const cached = lastStory();
		if (cached === null) {
			setValidatedStoryId(null);
			return;
		}
		let active = true;
		api
			.getStory(cached)
			.then(() => {
				if (active) setValidatedStoryId(cached);
			})
			.catch(() => {
				forgetStory();
				if (active) setValidatedStoryId(null);
			});
		return () => {
			active = false;
		};
	}, [params.storyId]);

	// 新页面一提交就回到顶部，并告诉转场可以拍新画面了。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在换页时执行
	useLayoutEffect(() => {
		window.scrollTo(0, 0);
		routeCommitted();
	}, [location.pathname]);

	const base =
		storyId === null ? null : `/stories/${encodeURIComponent(storyId)}`;
	const current =
		location.pathname === "/"
			? "library"
			: location.pathname.startsWith("/canon")
				? "library"
				: location.pathname.startsWith("/settings")
					? "settings"
					: location.pathname.split("/")[3];
	const viewIndex = NAV.findIndex((item) => item.view === current);
	// 书架第 0 格，五个主页面第 1 到 5 格，全局设置最后一格。
	const activeIndex =
		current === "library"
			? 0
			: current === "settings"
				? NAV.length + 1
				: Math.max(viewIndex, 0) + 1;

	const commands = useMemo(() => {
		const visit = (path: string) => travel(path, () => navigate(path));
		const list: { label: string; kind: string; run: () => void }[] = [
			{ label: "去书架", kind: "前往", run: () => visit("/") },
			{ label: "原著 · 导入与分章", kind: "前往", run: () => visit("/canon") },
			{ label: "打开检视器", kind: "执行", run: openInspector },
			{
				label: "设置 · 模型与渠道",
				kind: "前往",
				run: () => visit("/settings"),
			},
		];
		if (base !== null) {
			list.push({ label: "打开助手", kind: "执行", run: openAssistant });
			const go = (label: string, path: string) =>
				list.push({
					label,
					kind: "前往",
					run: () => visit(`${base}/${path}`),
				});
			go("继续写故事", "play");
			go("打开记忆 · 故事记事", "memory");
			go("打开记忆 · 此刻局面", "memory?tab=state");
			go("打开记忆 · 秘密", "memory?tab=secret");
			go("打开记忆 · 时间线", "memory?tab=line");
			go("打开记忆 · 偏好", "memory?tab=rule");
			go("打开剧情走向", "outline");
			go("改设定", "lore");
			go("设置 · 写作", "prefs");
			go("设置 · 功能", "prefs?tab=feat");
			go("设置 · 模型", "prefs?tab=model");
			go("设置 · 高级", "prefs?tab=adv");
		}
		if (palette) {
			for (const provider of pageCommands) {
				for (const command of provider()) {
					list.push({ label: command.label, kind: "执行", run: command.run });
				}
			}
		}
		const text = query.trim();
		return list.filter((command) => command.label.includes(text));
	}, [base, navigate, query, palette, openAssistant, openInspector]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// 助手 Ctrl+Shift+A，检视器 Ctrl+.；都是开合切换。
			if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "a") {
				event.preventDefault();
				setInspectorOpen(false);
				setAssistantOpen((value) => !value);
				return;
			}
			if ((event.ctrlKey || event.metaKey) && event.key === ".") {
				event.preventDefault();
				setAssistantOpen(false);
				setInspectorOpen((value) => !value);
				return;
			}
			if (event.key === "Escape") {
				setAssistantOpen(false);
				setToolsOpen(false);
			}
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPalette((value) => !value);
				setQuery("");
				setSelected(0);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const run = (index: number) => {
		const command = commands[index];
		if (command === undefined) return;
		setPalette(false);
		command.run();
	};

	return (
		<ToastProvider>
			<ShellActionsContext.Provider value={actions}>
				<div className="app">
					<nav
						className="rail"
						aria-label="主导航"
						style={{ "--i": activeIndex } as React.CSSProperties}
					>
						<TLink className="logo" to="/" aria-label="Dramaticer">
							<Mark />
						</TLink>
						<div className="navs">
							<span className="ind" />
							<TLink
								className="nav"
								to="/"
								aria-current={current === "library" ? "page" : undefined}
							>
								<i>书</i>书架
							</TLink>
							{NAV.map((item) => (
								<TLink
									key={item.view}
									className={base === null ? "nav disabled" : "nav"}
									to={base === null ? "/" : `${base}/${item.view}`}
									aria-disabled={base === null ? true : undefined}
									title={base === null ? "先在书架打开一个故事" : undefined}
									aria-current={current === item.view ? "page" : undefined}
								>
									<i>{item.glyph}</i>
									{item.label}
								</TLink>
							))}
							<TLink
								className="nav"
								to="/settings"
								aria-current={current === "settings" ? "page" : undefined}
							>
								<i>⚙</i>
								全局
							</TLink>
						</div>
						<span className="sp" />
						<button
							type="button"
							className="btn ghost toolsbtn"
							aria-label="工具"
							aria-haspopup="menu"
							aria-expanded={toolsOpen}
							onClick={() => setToolsOpen((value) => !value)}
						>
							⋯
						</button>
						{storyId === null ? null : (
							<button
								type="button"
								className="btn ghost toolbtn"
								aria-label="打开助手"
								title="助手（Ctrl+Shift+A）"
								onClick={openAssistant}
							>
								<i>助</i>
								<span>助手</span>
							</button>
						)}
						<button
							type="button"
							className="btn ghost toolbtn"
							aria-label="打开检视器"
							title="检视器（Ctrl+.）"
							onClick={openInspector}
						>
							<i>检</i>
							<span>检视</span>
						</button>
						<button
							type="button"
							className="btn ghost themebtn"
							aria-label={`外观：${THEME_LABEL[theme]}，点一下切换`}
							title={`外观：${THEME_LABEL[theme]}`}
							data-mode={theme}
							onClick={() => {
								const value = nextTheme(theme);
								setThemeState(value);
								setTheme(value);
							}}
						>
							<span className="orb">
								<ThemeIcon theme={theme} />
							</span>
						</button>
						<button
							type="button"
							className="btn ghost kbdbtn"
							aria-label="打开命令面板"
							onClick={() => {
								setPalette(true);
								setQuery("");
								setSelected(0);
							}}
						>
							<span className="kbd">Ctrl K</span>
						</button>
					</nav>
					{toolsOpen ? (
						<div className="toolmenu" role="menu" aria-label="工具">
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									const value = nextTheme(theme);
									setThemeState(value);
									setTheme(value);
								}}
							>
								外观：{THEME_LABEL[theme]}，点一下切换
							</button>
							<button
								type="button"
								role="menuitem"
								disabled={storyId === null}
								onClick={() => {
									setToolsOpen(false);
									openAssistant();
								}}
							>
								助手
							</button>
							<button
								type="button"
								role="menuitem"
								onClick={() => {
									setToolsOpen(false);
									openInspector();
								}}
							>
								检视器
							</button>
						</div>
					) : null}
					<main className="main">
						<div className="inner" key={location.pathname}>
							<Outlet />
						</div>
					</main>
				</div>
				{storyId === null ? null : (
					<AssistantDrawer
						key={storyId}
						storyId={storyId}
						open={assistantOpen}
						onClose={closeAssistant}
						onSummaryChange={setAssistantSummary}
					/>
				)}
				{storyId !== null &&
				!assistantOpen &&
				(assistantSummary.running ||
					assistantSummary.failed ||
					assistantSummary.pendingActions > 0) ? (
					// 助手有状态要报（在跑、出错、有待确认）时才浮出来；平时从导航或快捷键打开。
					<button
						type="button"
						className={
							assistantSummary.running
								? "assistant-badge running"
								: assistantSummary.failed
									? "assistant-badge failed"
									: "assistant-badge"
						}
						onClick={openAssistant}
					>
						<span>
							{assistantSummary.running
								? "助手运行中"
								: assistantSummary.failed
									? "助手失败"
									: "助手"}
						</span>
						{assistantSummary.pendingActions > 0 ? (
							<span className="assistant-badge-count">
								{assistantSummary.pendingActions}
							</span>
						) : null}
					</button>
				) : null}
				{inspectorOpen ? (
					<Inspector
						key={location.pathname}
						storyId={params.storyId ?? null}
						onClose={closeInspector}
					/>
				) : null}
				{palette ? (
					// biome-ignore lint/a11y/useKeyWithClickEvents: 键盘操作在输入框里处理
					<div
						className="scrim"
						onClick={(event) => {
							if (event.target === event.currentTarget) setPalette(false);
						}}
					>
						{/* biome-ignore lint/a11y/useSemanticElements: 面板随状态挂载，不用 dialog 元素的开合接口 */}
						<div className="pal" role="dialog" aria-label="命令面板">
							<input
								// biome-ignore lint/a11y/noAutofocus: 面板打开就是为了输入
								autoFocus
								placeholder="搜索页面或动作"
								autoComplete="off"
								value={query}
								onChange={(event) => {
									setQuery(event.target.value);
									setSelected(0);
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape") setPalette(false);
									if (event.key === "ArrowDown") {
										event.preventDefault();
										setSelected((value) =>
											Math.min(value + 1, commands.length - 1),
										);
									}
									if (event.key === "ArrowUp") {
										event.preventDefault();
										setSelected((value) => Math.max(value - 1, 0));
									}
									if (event.key === "Enter") {
										event.preventDefault();
										run(selected);
									}
								}}
							/>
							<ul>
								{commands.map((command, index) => (
									// biome-ignore lint/a11y/useKeyWithClickEvents: 键盘操作在输入框里处理
									// biome-ignore lint/a11y/useFocusableInteractive: 焦点留在输入框，用方向键选
									<li
										key={command.label}
										// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: 原型的列表结构
										// biome-ignore lint/a11y/useSemanticElements: 原型的列表结构
										role="option"
										aria-selected={index === selected}
										style={
											{ "--n": Math.min(index, 12) } as React.CSSProperties
										}
										onClick={() => run(index)}
									>
										<span>{command.label}</span>
										<small>{command.kind}</small>
									</li>
								))}
							</ul>
							{commands.length === 0 ? <p className="none">没有结果</p> : null}
							<footer>
								<span>
									<span className="kbd">↑</span>
									<span className="kbd">↓</span> 选择
								</span>
								<span>
									<span className="kbd">Enter</span> 执行
								</span>
								<span>
									<span className="kbd">Esc</span> 关闭
								</span>
							</footer>
						</div>
					</div>
				) : null}
			</ShellActionsContext.Provider>
		</ToastProvider>
	);
}

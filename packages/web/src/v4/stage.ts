/** 舞台：界面与三维背景之间的一条窄通道，外加主题与页面转场。背景只读这里的状态，不反过来依赖页面。 */

export type RouteName =
	| "library"
	| "play"
	| "memory"
	| "outline"
	| "lore"
	| "prefs"
	| "classic"
	| "login";

/** 导航栏里的先后顺序；转场按它决定往上还是往下滑。 */
const ORDER: readonly RouteName[] = [
	"library",
	"play",
	"memory",
	"outline",
	"lore",
	"prefs",
];

export function routeOf(pathname: string): RouteName {
	if (pathname === "/") return "library";
	if (pathname === "/login") return "login";
	const view = pathname.split("/")[3];
	return (ORDER as readonly string[]).includes(view ?? "")
		? (view as RouteName)
		: "classic";
}

type PulseListener = (strength: number) => void;

const pulseListeners = new Set<PulseListener>();

export const stage = {
	route: "library" as RouteName,
	writing: false,
	/** 海面上荡开一圈光：玩家推进、发送、换页时调用。 */
	pulse(strength = 1): void {
		for (const listener of pulseListeners) listener(strength);
	},
	onPulse(listener: PulseListener): () => void {
		pulseListeners.add(listener);
		return () => {
			pulseListeners.delete(listener);
		};
	},
	setWriting(value: boolean): void {
		stage.writing = value;
		if (typeof document === "undefined") return;
		if (value) document.documentElement.dataset.writing = "";
		else delete document.documentElement.dataset.writing;
	},
};

export function reducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

// ---- 页面转场 ----

let settle: (() => void) | null = null;

/** 新页面已经提交到 DOM；外壳在 layout effect 里调用。 */
export function routeCommitted(): void {
	settle?.();
	settle = null;
}

function direction(from: RouteName, to: RouteName): string {
	if (from === "library" && to !== "library") return "in";
	if (to === "library" && from !== "library") return "out";
	return ORDER.indexOf(to) >= ORDER.indexOf(from) ? "down" : "up";
}

/**
 * 带转场地换页。路由的状态更新走 React 的 transition，不会同步提交，
 * 所以回调返回一个等到新页面真正提交才结束的 promise，浏览器才能拍到新页面。
 */
export function travel(toPath: string, change: () => void): void {
	const from = routeOf(window.location.pathname);
	const to = routeOf(toPath.split("?")[0] ?? toPath);
	const samePage =
		(toPath.split("?")[0] ?? toPath) === window.location.pathname;
	if (
		samePage ||
		reducedMotion() ||
		typeof document.startViewTransition !== "function"
	) {
		change();
		return;
	}
	const root = document.documentElement;
	root.dataset.dir = direction(from, to);
	stage.pulse(0.6);
	const transition = document.startViewTransition(
		() =>
			new Promise<void>((resolve) => {
				settle = resolve;
				change();
				// 路由没有变化（例如被拦下）时也要放行。
				setTimeout(resolve, 400);
			}),
	);
	transition.finished.finally(() => {
		delete root.dataset.dir;
	});
}

// ---- 主题 ----

export type Theme = "auto" | "light" | "dark";

const THEME_KEY = "dramaticer.theme";
const THEMES: readonly Theme[] = ["auto", "dark", "light"];

export function storedTheme(): Theme {
	try {
		const value = localStorage.getItem(THEME_KEY);
		return THEMES.includes(value as Theme) ? (value as Theme) : "auto";
	} catch {
		return "auto";
	}
}

function applyTheme(theme: Theme): void {
	const root = document.documentElement;
	if (theme === "auto") delete root.dataset.theme;
	else root.dataset.theme = theme;
}

/** 换主题：从按钮的位置起，新主题像灯光一样一圈铺开。 */
export function setTheme(
	theme: Theme,
	origin?: { x: number; y: number },
): void {
	try {
		localStorage.setItem(THEME_KEY, theme);
	} catch {
		// 存不了就只在这一次生效。
	}
	if (
		origin === undefined ||
		reducedMotion() ||
		typeof document.startViewTransition !== "function"
	) {
		applyTheme(theme);
		return;
	}
	const root = document.documentElement;
	root.style.setProperty("--tx", `${origin.x}px`);
	root.style.setProperty("--ty", `${origin.y}px`);
	root.classList.add("theme-swap");
	const transition = document.startViewTransition(() => applyTheme(theme));
	transition.finished.finally(() => root.classList.remove("theme-swap"));
}

export function nextTheme(theme: Theme): Theme {
	return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "auto";
}

if (typeof document !== "undefined") applyTheme(storedTheme());

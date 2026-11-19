import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { reducedMotion, routeOf, stage } from "./stage";
import "./v4.css";

/** 灯塔标记：导航栏、登录页、开场都用它。 */
export function Mark({ size = 34 }: { readonly size?: number }) {
	return (
		<svg
			className="mark"
			viewBox="0 0 40 40"
			width={size}
			height={size}
			aria-hidden="true"
		>
			<path className="ray" d="M19 11.6 L1 7 L1 13.5 Z" />
			<path className="ray" d="M21 11.6 L39 7 L39 13.5 Z" />
			<path d="M16.5 14h7l2.4 20h-11.8z" />
			<path d="M15 9.5h10v4.5h-10z" />
			<path d="M20 4l5.5 5.5h-11z" />
		</svg>
	);
}

/** 指针走到哪，背景上就跟着一团光；卡片上也有，带 tilt 的元素还会朝指针倾斜。 */
function usePointerLight(): void {
	useEffect(() => {
		const root = document.documentElement;
		let tilted: HTMLElement | null = null;
		const release = () => {
			tilted?.style.removeProperty("--rx");
			tilted?.style.removeProperty("--ry");
			tilted = null;
		};
		const onMove = (event: PointerEvent) => {
			root.style.setProperty("--px", `${event.clientX}px`);
			root.style.setProperty("--py", `${event.clientY}px`);
			if (!(event.target instanceof Element)) return;
			const lit = event.target.closest<HTMLElement>(
				".book, .hero, .card, .thread, .btn.gold, .pal, .premise > div, .panel, .login-card",
			);
			if (lit !== null) {
				const box = lit.getBoundingClientRect();
				lit.style.setProperty("--mx", `${event.clientX - box.left}px`);
				lit.style.setProperty("--my", `${event.clientY - box.top}px`);
			}
			const tilt =
				event.pointerType === "mouse"
					? event.target.closest<HTMLElement>(".tilt")
					: null;
			if (tilt !== tilted) release();
			if (tilt !== null) {
				const box = tilt.getBoundingClientRect();
				const x = (event.clientX - box.left) / box.width - 0.5;
				const y = (event.clientY - box.top) / box.height - 0.5;
				tilt.style.setProperty("--rx", `${(-y * 10).toFixed(2)}deg`);
				tilt.style.setProperty("--ry", `${(x * 13).toFixed(2)}deg`);
				tilted = tilt;
			}
		};
		window.addEventListener("pointermove", onMove, { passive: true });
		document.addEventListener("pointerleave", release);
		return () => {
			window.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerleave", release);
		};
	}, []);
}

const INTRO_KEY = "dramaticer.intro";

/** 开场：每次打开浏览器标签只放一遍，不挡操作。 */
function Intro() {
	const [show, setShow] = useState(() => {
		if (reducedMotion()) return false;
		try {
			return sessionStorage.getItem(INTRO_KEY) === null;
		} catch {
			return false;
		}
	});
	useEffect(() => {
		if (!show) return;
		try {
			sessionStorage.setItem(INTRO_KEY, "1");
		} catch {
			// 存不了就每次都放。
		}
		const timer = setTimeout(() => setShow(false), 3000);
		return () => clearTimeout(timer);
	}, [show]);
	if (!show) return null;
	return (
		<div className="intro" aria-hidden="true">
			<div className="intro-inner">
				<Mark size={72} />
				<div className="intro-name">
					{[..."Dramaticer"].map((letter, index) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: 固定的十个字母
							key={index}
							style={{ "--n": index } as React.CSSProperties}
						>
							{letter}
						</span>
					))}
				</div>
				<div className="intro-tag">记忆管过去 · 导演管未来</div>
			</div>
		</div>
	);
}

/** 整个应用共用的三维背景：雾港、灯塔与潮水。three.js 单独分包，加载失败或没有 WebGL 时退回 CSS 的光束。 */
export function Backdrop() {
	const canvas = useRef<HTMLCanvasElement | null>(null);
	const location = useLocation();
	const route = routeOf(location.pathname);

	usePointerLight();

	useEffect(() => {
		stage.route = route;
		document.documentElement.dataset.route = route;
	}, [route]);

	useEffect(() => {
		const element = canvas.current;
		if (element === null) return;
		let dispose: (() => void) | null = null;
		let cancelled = false;
		const fallback = () => document.documentElement.classList.add("no-gl");
		import("./scene")
			.then((module) => {
				if (cancelled) return;
				dispose = module.mountScene(element);
				document.documentElement.classList.remove("no-gl");
				element.dataset.ready = "";
			})
			.catch(fallback);
		return () => {
			cancelled = true;
			dispose?.();
		};
	}, []);

	return (
		<>
			<div className="backdrop" aria-hidden="true">
				<div className="beam" />
				<canvas ref={canvas} className="stage" />
				<div className="cursor-light" />
				<div className="grain" />
			</div>
			<div className="progress" aria-hidden="true" />
			<Intro />
		</>
	);
}

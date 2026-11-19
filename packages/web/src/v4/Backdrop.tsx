import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { routeOf, stage } from "./stage";
import "./v4.css";

/** 灯塔标记：导航栏、登录页都用它。 */
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

/**
 * 整个应用共用的底色。以前是 three.js 的三维场景加指针光与开场动画；为了轻量
 * 与长时间阅读改成纯 CSS 的静态底色（ui-lite/01）。路由仍写到根元素上，
 * 样式可以按页面微调底色。
 */
export function Backdrop() {
	const location = useLocation();
	const route = routeOf(location.pathname);

	useEffect(() => {
		stage.route = route;
		document.documentElement.dataset.route = route;
	}, [route]);

	return (
		<>
			<div className="backdrop" aria-hidden="true" />
			<div className="progress" aria-hidden="true" />
		</>
	);
}

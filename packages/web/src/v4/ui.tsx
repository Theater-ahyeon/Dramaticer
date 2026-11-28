import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Link, type LinkProps, useNavigate } from "react-router-dom";
import { api } from "../api";
import { reducedMotion, travel } from "./stage";

/** 故事级接口的路径前缀。 */
export function sp(storyId: string, rest = ""): string {
	return `/api/stories/${encodeURIComponent(storyId)}${rest}`;
}

export function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** 读一份数据；`reload` 重新读取，读取失败时保留上一次的数据。 */
export function useLoad<T>(
	load: () => Promise<T>,
	deps: readonly unknown[],
): {
	data: T | null;
	error: string | null;
	pending: boolean;
	reload: () => void;
} {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(true);
	const [tick, setTick] = useState(0);
	const loader = useRef(load);
	loader.current = load;
	// biome-ignore lint/correctness/useExhaustiveDependencies: 依赖由调用方给出
	useEffect(() => {
		let active = true;
		setPending(true);
		loader
			.current()
			.then((value) => {
				if (!active) return;
				setData(value);
				setError(null);
			})
			.catch((value: unknown) => {
				if (active) setError(errorText(value));
			})
			.finally(() => {
				if (active) setPending(false);
			});
		return () => {
			active = false;
		};
	}, [...deps, tick]);
	const reload = useCallback(() => setTick((value) => value + 1), []);
	return { data, error, pending, reload };
}

interface ToastState {
	readonly message: string;
	readonly undo: (() => void) | null;
}

const ToastContext = createContext<
	(message: string, undo?: () => void) => void
>(() => {});

export function useToast(): (message: string, undo?: () => void) => void {
	return useContext(ToastContext);
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
	const [toast, setToast] = useState<ToastState | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const show = useCallback((message: string, undo?: () => void) => {
		setToast({ message, undo: undo ?? null });
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = setTimeout(() => setToast(null), 3800);
	}, []);
	return (
		<ToastContext.Provider value={show}>
			{children}
			{toast === null ? null : (
				// biome-ignore lint/a11y/useSemanticElements: 提示条里还有撤销按钮，output 元素放不了
				<div className="toast" role="status" key={toast.message}>
					{toast.message}
					{toast.undo === null ? null : (
						<button
							type="button"
							onClick={() => {
								toast.undo?.();
								setToast(null);
							}}
						>
							撤销
						</button>
					)}
				</div>
			)}
		</ToastContext.Provider>
	);
}

/** 做一次写操作：失败时用提示条说明原因，成功后执行 `then`。 */
export function useAct(): (
	work: () => Promise<unknown>,
	done?: string | (() => void),
) => Promise<boolean> {
	const toast = useToast();
	return useCallback(
		async (work, done) => {
			try {
				await work();
			} catch (error) {
				toast(errorText(error));
				return false;
			}
			if (typeof done === "string") toast(done);
			else done?.();
			return true;
		},
		[toast],
	);
}

export interface SegOption<T extends string> {
	readonly v: T;
	readonly label: string;
}

export function Seg<T extends string>({
	options,
	value,
	onChange,
	label,
	small,
}: {
	readonly options: readonly SegOption<T>[];
	readonly value: T | null;
	readonly onChange: (value: T) => void;
	readonly label: string;
	readonly small?: boolean;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: 原型用 div 分组
		<div className={small ? "seg sm" : "seg"} role="group" aria-label={label}>
			{options.map((option) => (
				<button
					type="button"
					key={option.v}
					aria-pressed={option.v === value}
					onClick={() => onChange(option.v)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

export function Sw({
	checked,
	onChange,
	label,
	disabled,
}: {
	readonly checked: boolean;
	readonly onChange: (value: boolean) => void;
	readonly label: string;
	readonly disabled?: boolean;
}) {
	return (
		<button
			type="button"
			className="sw"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
		/>
	);
}

export function Tog({
	pressed,
	onChange,
	children,
}: {
	readonly pressed: boolean;
	readonly onChange: (value: boolean) => void;
	readonly children: ReactNode;
}) {
	return (
		<button
			type="button"
			className="tog"
			aria-pressed={pressed}
			onClick={() => onChange(!pressed)}
		>
			{children}
		</button>
	);
}

/** 就地修改：点一下就能改，离开时内容变了才提交。 */
export function Editable({
	value,
	onCommit,
	as = "p",
	className,
	placeholder,
}: {
	readonly value: string;
	readonly onCommit: (text: string) => void;
	readonly as?: "p" | "h3" | "span" | "dd" | "td";
	readonly className?: string;
	/** 空的时候显示的浅色提示；不算内容，也不会被保存。 */
	readonly placeholder?: string;
}) {
	const Tag = as;
	return (
		<Tag
			className={className}
			data-placeholder={placeholder}
			contentEditable
			suppressContentEditableWarning
			onBlur={(event) => {
				const text = (event.currentTarget.textContent ?? "").trim();
				if (text !== value.trim()) onCommit(text);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					event.currentTarget.blur();
				}
			}}
		>
			{value}
		</Tag>
	);
}

export function Cover({
	storyId,
	title,
	style,
}: {
	readonly storyId: string;
	readonly title: string;
	readonly style?: React.CSSProperties;
}) {
	return (
		<img
			className="cover"
			src={api.storyCoverUrl(storyId)}
			alt={`${title}的卡面图`}
			width={240}
			height={360}
			// 同一个故事的卡面图在页面之间共用一个转场名，换页时图会飞到新位置。
			style={{ viewTransitionName: coverName(storyId), ...style }}
		/>
	);
}

function coverName(storyId: string): string {
	return `cover-${storyId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** 带转场的站内链接：浏览器不支持时就是普通链接。 */
export function TLink({ to, onClick, ...rest }: LinkProps & { to: string }) {
	const navigate = useNavigate();
	return (
		<Link
			to={to}
			{...rest}
			onClick={(event) => {
				onClick?.(event);
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				) {
					return;
				}
				event.preventDefault();
				travel(to, () => navigate(to));
			}}
		/>
	);
}

/** 数字从上一个值滚到新值。 */
export function Num({ value }: { readonly value: number }) {
	const [shown, setShown] = useState(0);
	const from = useRef(0);
	useEffect(() => {
		if (reducedMotion() || from.current === value) {
			from.current = value;
			setShown(value);
			return;
		}
		const start = from.current;
		const began = performance.now();
		let frame = requestAnimationFrame(function tick(now) {
			const t = Math.min((now - began) / 900, 1);
			const eased = 1 - (1 - t) ** 4;
			setShown(Math.round(start + (value - start) * eased));
			if (t < 1) frame = requestAnimationFrame(tick);
			else from.current = value;
		});
		return () => cancelAnimationFrame(frame);
	}, [value]);
	return <>{shown}</>;
}

/** 倒计时环：`total` 段里亮 `done` 段。 */
export function Clock({
	done,
	total,
}: {
	readonly done: number;
	readonly total: number;
}) {
	const size = 46;
	const center = size / 2;
	const radius = center - 5;
	const gap = 0.2;
	const count = Math.max(1, Math.min(total, 12));
	const lit = Math.round((Math.max(0, Math.min(done, total)) / total) * count);
	const point = (angle: number) =>
		`${(center + radius * Math.cos(angle)).toFixed(2)} ${(center + radius * Math.sin(angle)).toFixed(2)}`;
	const arcs = Array.from({ length: count }, (_, index) => {
		const from = (index / count) * 2 * Math.PI - Math.PI / 2 + gap / 2;
		const to = ((index + 1) / count) * 2 * Math.PI - Math.PI / 2 - gap / 2;
		return {
			key: `arc-${index}`,
			on: index < lit,
			d: `M${point(from)} A${radius} ${radius} 0 0 1 ${point(to)}`,
		};
	});
	return (
		<svg
			className="clock"
			viewBox={`0 0 ${size} ${size}`}
			width={size}
			height={size}
			role="img"
			aria-label={`倒计时 ${done}/${total}`}
		>
			{arcs.map((arc) => (
				<path key={arc.key} className={arc.on ? "on" : "off"} d={arc.d} />
			))}
			<text x={center} y={center + 3.5} textAnchor="middle">
				{done}/{total}
			</text>
		</svg>
	);
}

export function formatTokens(value: number | null | undefined): string {
	if (value === null || value === undefined) return "—";
	return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
}

export function showValue(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value) ?? "";
}

/** 就地修改的文本转回状态值：能当 JSON 读就按 JSON，否则是字符串。 */
export function parseValue(text: string, previous: unknown): unknown {
	if (typeof previous === "string") return text;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

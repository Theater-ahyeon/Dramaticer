import type { RerollReason } from "@dramaticer/core";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { ChatFloor } from "../../chat/path-state";
import type { TurnDraft } from "../../chat/stream-state";
import { computeVirtualWindow } from "../../chat/virtual-window";
import { ChatFloorView } from "./ChatFloorView";
import { StreamingBubble } from "./StreamingBubble";

const ESTIMATED_FLOOR_HEIGHT = 200;
const OVERSCAN_PX = 600;
const LOAD_OLDER_THRESHOLD = 240;
const NEAR_BOTTOM_PX = 96;

export interface ChatFloorListProps {
	readonly nodes: readonly ChatFloor[];
	readonly draft: TurnDraft | null;
	readonly pendingUserText: string | null;
	readonly canLoadOlder: boolean;
	readonly latestAssistantId: string | null;
	/** 每次加一表示页面要求跳到最新楼层。 */
	readonly bottomSignal: number;
	readonly retryingImageId: string | null;
	/** 正在选重 roll 原因的楼层；null 表示没有打开。 */
	readonly rerollNodeId: string | null;
	readonly onLoadOlder: () => void;
	readonly onRegenerate: (nodeId: string) => void;
	readonly onPickRerollReason: (nodeId: string, reason: RerollReason) => void;
	readonly onCancelReroll: () => void;
	readonly onChooseOption: (nodeId: string, text: string) => void;
	readonly onRetryImage: (nodeId: string, imageId: string) => void;
}

/**
 * 聊天楼层列表：只渲染视口附近的楼层，向上滚动到顶时请求更早的一页，
 * 加页后保持视口停在原来的楼层上。
 */
export function ChatFloorList(props: ChatFloorListProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const heightsRef = useRef(new Map<string, number>());
	const rowElementsRef = useRef(new Map<string, HTMLElement>());
	const observerRef = useRef<ResizeObserver | null>(null);
	const [, setMeasureVersion] = useState(0);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(600);
	const [atBottom, setAtBottom] = useState(true);
	const stickRef = useRef(true);
	const scrollTopRef = useRef(0);
	const previousFirstIdRef = useRef<string | undefined>(props.nodes[0]?.id);
	const lastBottomSignalRef = useRef(props.bottomSignal);

	const registerRow = useCallback(
		(nodeId: string, element: HTMLElement | null) => {
			const existing = rowElementsRef.current.get(nodeId);
			if (existing !== undefined && existing !== element) {
				observerRef.current?.unobserve(existing);
				rowElementsRef.current.delete(nodeId);
			}
			if (element === null) return;
			rowElementsRef.current.set(nodeId, element);
			observerRef.current?.observe(element);
		},
		[],
	);

	useEffect(() => {
		const observer = new ResizeObserver((entries) => {
			let changed = false;
			for (const entry of entries) {
				const target = entry.target as HTMLElement;
				const id = target.dataset.nodeId;
				if (id === undefined) continue;
				const box = entry.borderBoxSize[0];
				const height = box
					? box.blockSize
					: target.getBoundingClientRect().height;
				if (height > 0 && heightsRef.current.get(id) !== height) {
					heightsRef.current.set(id, height);
					changed = true;
				}
			}
			if (changed) setMeasureVersion((version) => version + 1);
		});
		observerRef.current = observer;
		for (const element of rowElementsRef.current.values()) {
			observer.observe(element);
		}
		return () => {
			observer.disconnect();
			observerRef.current = null;
		};
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (element === null) return;
		setViewportHeight(element.clientHeight);
		const observer = new ResizeObserver(() => {
			setViewportHeight(element.clientHeight);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	// 每次渲染都按最新测量结果算高度；2000 楼的线性扫描开销可以忽略。
	const heights = props.nodes.map(
		(node) => heightsRef.current.get(node.id) ?? ESTIMATED_FLOOR_HEIGHT,
	);
	const virtual = computeVirtualWindow(
		heights,
		scrollTop,
		viewportHeight,
		OVERSCAN_PX,
	);
	const visible = props.nodes.slice(virtual.start, virtual.end);

	const scrollToBottom = useCallback(() => {
		const element = scrollRef.current;
		if (element === null) return;
		element.scrollTop = element.scrollHeight;
		stickRef.current = true;
		setAtBottom(true);
	}, []);

	useEffect(() => {
		if (props.bottomSignal === lastBottomSignalRef.current) return;
		lastBottomSignalRef.current = props.bottomSignal;
		scrollToBottom();
	}, [props.bottomSignal, scrollToBottom]);

	useEffect(() => {
		if (props.draft !== null && stickRef.current) scrollToBottom();
	}, [props.draft, scrollToBottom]);

	useLayoutEffect(() => {
		const element = scrollRef.current;
		const previousFirst = previousFirstIdRef.current;
		const first = props.nodes[0]?.id;
		if (
			element !== null &&
			previousFirst !== undefined &&
			first !== previousFirst
		) {
			const index = props.nodes.findIndex((node) => node.id === previousFirst);
			if (index > 0) {
				const offset = heights
					.slice(0, index)
					.reduce((total, height) => total + height, 0);
				element.scrollTop = offset + scrollTopRef.current;
			}
		}
		previousFirstIdRef.current = first;
	}, [props.nodes, heights]);

	const handleScroll = () => {
		const element = scrollRef.current;
		if (element === null) return;
		scrollTopRef.current = element.scrollTop;
		setScrollTop(element.scrollTop);
		const bottom =
			element.scrollTop + element.clientHeight >=
			element.scrollHeight - NEAR_BOTTOM_PX;
		stickRef.current = bottom;
		setAtBottom(bottom);
		if (element.scrollTop < LOAD_OLDER_THRESHOLD && props.canLoadOlder) {
			props.onLoadOlder();
		}
	};

	return (
		<div className="chat-list-wrap">
			<div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
				{props.canLoadOlder ? (
					<button
						className="chat-load-older"
						type="button"
						onClick={props.onLoadOlder}
					>
						加载更早楼层
					</button>
				) : null}
				{props.nodes.length === 0 ? (
					<p className="chat-empty">还没有楼层，写下第一条行动开始故事。</p>
				) : null}
				<div className="chat-spacer" style={{ height: virtual.top }} />
				{visible.map((node) => (
					<ChatFloorView
						key={node.id}
						node={node}
						canRegenerate={
							props.draft === null && node.id === props.latestAssistantId
						}
						retryingImageId={props.retryingImageId}
						rerollOpen={props.rerollNodeId === node.id}
						onRegenerate={props.onRegenerate}
						onPickRerollReason={props.onPickRerollReason}
						onCancelReroll={props.onCancelReroll}
						onChooseOption={props.onChooseOption}
						onRetryImage={props.onRetryImage}
						registerRow={registerRow}
					/>
				))}
				{props.pendingUserText !== null ? (
					<article className="floor floor-user floor-pending">
						<header className="floor-meta">
							<span className="floor-speaker">你</span>
							<span className="muted">已发送</span>
						</header>
						<div className="floor-body">
							<span className="text-segment">{props.pendingUserText}</span>
						</div>
					</article>
				) : null}
				{props.draft !== null ? <StreamingBubble draft={props.draft} /> : null}
				<div className="chat-spacer" style={{ height: virtual.bottom }} />
			</div>
			{atBottom ? null : (
				<button
					className="chat-to-bottom"
					type="button"
					onClick={scrollToBottom}
				>
					回到底部
				</button>
			)}
		</div>
	);
}

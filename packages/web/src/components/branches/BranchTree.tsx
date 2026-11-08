import { useEffect, useRef } from "react";
import type { BranchRow } from "../../chat/branch-tree";
import { formatFloorTime } from "../../chat/format";

export interface BranchTreeProps {
	readonly rows: readonly BranchRow[];
	readonly selectedId: string | null;
	/** 每次变化都把当前 head 滚到视野中央；刷新后定位到最新的楼层。 */
	readonly focusSignal: number;
	readonly onSelect: (nodeId: string) => void;
	readonly onToggle: (nodeId: string) => void;
}

/** 楼层树的一行：分叉后的子树缩进一层，线性楼层保持平齐。 */
export function BranchTree({
	rows,
	selectedId,
	focusSignal,
	onSelect,
	onToggle,
}: BranchTreeProps) {
	const headRef = useRef<HTMLLIElement | null>(null);
	useEffect(() => {
		// 页码加载完成与 head 切换都会增加这个计数；0 表示还没有可定位的树。
		if (focusSignal > 0) headRef.current?.scrollIntoView({ block: "center" });
	}, [focusSignal]);
	if (rows.length === 0) {
		return <p className="muted">这个故事还没有楼层。</p>;
	}
	return (
		<ul className="branch-tree" role="tree" aria-label="楼层树">
			{rows.map((row) => {
				const hasChildren = row.node.childIds.length > 0;
				const isHead = row.isHead;
				return (
					<li
						key={row.node.id}
						role="treeitem"
						aria-level={row.depth + 1}
						aria-expanded={hasChildren ? !row.collapsed : undefined}
						aria-selected={selectedId === row.node.id}
						ref={isHead ? headRef : undefined}
						className={[
							"branch-row",
							row.onPath ? "branch-row-on-path" : "",
							isHead ? "branch-row-head" : "",
							selectedId === row.node.id ? "branch-row-selected" : "",
						]
							.join(" ")
							.trim()}
					>
						<div
							className="branch-row-inner"
							style={{ paddingLeft: `${row.depth * 14}px` }}
						>
							{hasChildren ? (
								<button
									type="button"
									className="branch-toggle"
									aria-label={row.collapsed ? "展开子树" : "收起子树"}
									onClick={() => onToggle(row.node.id)}
								>
									{row.collapsed ? "▸" : "▾"}
								</button>
							) : (
								<span className="branch-toggle" aria-hidden="true" />
							)}
							<button
								type="button"
								className="branch-select"
								onClick={() => onSelect(row.node.id)}
							>
								<span className={`branch-role branch-role-${row.node.role}`}>
									{row.node.role === "user" ? "你" : "剧情"}
								</span>
								<span className="branch-preview">{row.node.preview}</span>
								<span className="branch-time">
									{formatFloorTime(row.node.createdAt)}
								</span>
								{isHead ? <span className="branch-badge">当前</span> : null}
								{row.collapsed ? (
									<span className="branch-badge branch-badge-muted">
										已收起 {row.hiddenDescendants} 楼
									</span>
								) : null}
							</button>
						</div>
					</li>
				);
			})}
		</ul>
	);
}

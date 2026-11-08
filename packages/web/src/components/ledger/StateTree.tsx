import type { JsonValue } from "@dramaticer/core";
import {
	hasHighlightedDescendant,
	isPathHighlighted,
} from "../../chat/ledger-view";
import { LedgerValue } from "./LedgerValue";

export interface StateTreeProps {
	readonly value: JsonValue;
	/** 本楼写入的完整路径集合；只按完整路径高亮。 */
	readonly highlighted: ReadonlySet<string>;
	readonly basePath: readonly string[];
	readonly depth?: number;
}

/** 递归展示台账快照；对象与数组可以展开，叶子值交给 LedgerValue。 */
export function StateTree({
	value,
	highlighted,
	basePath,
	depth = 0,
}: StateTreeProps) {
	if (typeof value !== "object" || value === null) {
		return (
			<div className="ledger-leaf">
				<span className="ledger-key">{basePath.at(-1) ?? "值"}</span>
				<LedgerValue value={value} />
			</div>
		);
	}
	const entries = Object.entries(value);
	if (entries.length === 0) {
		return (
			<div className="ledger-leaf">
				<span className="ledger-key">{basePath.at(-1) ?? "值"}</span>
				<span className="muted">（空）</span>
			</div>
		);
	}
	return (
		<div className="ledger-children">
			{entries.map(([key, child]) => {
				const path = [...basePath, key];
				const marked = isPathHighlighted(highlighted, path);
				const expanded =
					depth < 1 || hasHighlightedDescendant(highlighted, path);
				return (
					<div
						key={key}
						className={marked ? "ledger-node ledger-node-diff" : "ledger-node"}
					>
						{typeof child === "object" && child !== null ? (
							<details open={expanded}>
								<summary className="ledger-key">{key}</summary>
								<StateTree
									value={child}
									highlighted={highlighted}
									basePath={path}
									depth={depth + 1}
								/>
							</details>
						) : (
							<div className="ledger-leaf">
								<span className="ledger-key">{key}</span>
								<LedgerValue value={child} />
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

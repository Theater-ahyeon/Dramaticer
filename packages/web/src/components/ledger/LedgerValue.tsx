import { describeLedgerValue } from "../../chat/ledger-view";

/**
 * 台账值的统一显示：短值一行显示，长值与多行值折叠成摘要，
 * 展开后显示完整内容，原文不做改写。
 */
export function LedgerValue({ value }: { readonly value: unknown }) {
	const described = describeLedgerValue(value);
	if (described.expandable) {
		return (
			<details className="ledger-value-long">
				<summary className="ledger-value">{described.inline}</summary>
				<pre className="ledger-value-full">{described.full}</pre>
			</details>
		);
	}
	return <span className="ledger-value">{described.inline}</span>;
}

import type { ParsedBlock, ParsedContent } from "@dramaticer/core/blocks";
import {
	blockViewKind,
	imageSourceOf,
	optionLinesOf,
	plainTextOf,
} from "../../chat/blocks";

export interface BlockContentProps {
	readonly items: readonly ParsedContent[];
	/** 选项所属的助手楼层；流式生成时还不知道楼层 id，传 null 时选项只显示不可点。 */
	readonly nodeId: string | null;
	readonly onChooseOption: (nodeId: string, text: string) => void;
}

/** 递归渲染块；层内嵌套的块（例如旁白里的备忘）走同一条路径。 */
export function BlockContent({
	items,
	nodeId,
	onChooseOption,
}: BlockContentProps) {
	return (
		<>
			{items.map((item, index) => {
				const key = `${index}:${item.kind === "block" ? item.name : "text"}`;
				return item.kind === "text" ? (
					<span className="text-segment" key={key}>
						{item.text}
					</span>
				) : (
					<BlockView
						block={item}
						key={key}
						nodeId={nodeId}
						onChooseOption={onChooseOption}
					/>
				);
			})}
		</>
	);
}

function BlockView({
	block,
	nodeId,
	onChooseOption,
}: {
	readonly block: ParsedBlock;
	readonly nodeId: string | null;
	readonly onChooseOption: (nodeId: string, text: string) => void;
}) {
	const kind = blockViewKind(block);
	if (kind === "hidden") return null;
	switch (kind) {
		case "thinking":
			return (
				<details className="block block-thinking">
					<summary>思考</summary>
					<div className="block-body">{plainTextOf(block.content)}</div>
				</details>
			);
		case "analysis":
			return (
				<details className="block block-analysis">
					<summary>分析</summary>
					<div className="block-body">
						<BlockContent
							items={block.content}
							nodeId={nodeId}
							onChooseOption={onChooseOption}
						/>
					</div>
				</details>
			);
		case "options": {
			const lines = optionLinesOf(block);
			return (
				<div className="block block-options">
					{lines.map((line, index) =>
						nodeId === null ? (
							<span className="option-line" key={`${index}:${line}`}>
								{line}
							</span>
						) : (
							<button
								className="option-line"
								key={`${index}:${line}`}
								type="button"
								onClick={() => onChooseOption(nodeId, line)}
							>
								{line}
							</button>
						),
					)}
				</div>
			);
		}
		case "image": {
			const source = imageSourceOf(block.raw);
			if (source === null) {
				return <pre className="block block-raw">{block.raw}</pre>;
			}
			return (
				<figure className="block block-image">
					<img alt={plainTextOf(block.content) || "剧情插图"} src={source} />
				</figure>
			);
		}
		case "header":
			return (
				<h3 className="block block-header">
					<BlockContent
						items={block.content}
						nodeId={nodeId}
						onChooseOption={onChooseOption}
					/>
				</h3>
			);
		case "whisper":
			return (
				<div className="block block-whisper">
					<BlockContent
						items={block.content}
						nodeId={nodeId}
						onChooseOption={onChooseOption}
					/>
				</div>
			);
		case "narration":
			return (
				<div className="block block-narration">
					<BlockContent
						items={block.content}
						nodeId={nodeId}
						onChooseOption={onChooseOption}
					/>
				</div>
			);
		case "memo":
			return (
				<div className="block block-memo">
					<BlockContent
						items={block.content}
						nodeId={nodeId}
						onChooseOption={onChooseOption}
					/>
				</div>
			);
		case "status":
			return (
				<div className="block block-status">
					<BlockContent
						items={block.content}
						nodeId={nodeId}
						onChooseOption={onChooseOption}
					/>
				</div>
			);
		case "raw":
			return (
				<pre className="block block-raw">
					{`<${block.name}>`}
					{block.raw}
					{block.complete ? `</${block.name}>` : ""}
				</pre>
			);
		case "text":
			return <span className="text-segment">{block.raw}</span>;
	}
}

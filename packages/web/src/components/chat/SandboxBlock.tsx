import { useEffect, useRef, useState } from "react";
import {
	MIN_SANDBOX_HEIGHT,
	buildSandboxDocument,
	parseSandboxMessage,
	sandboxAck,
} from "../../chat/sandbox";

export interface SandboxBlockProps {
	readonly blockName: string;
	readonly template: string;
	readonly content: string;
	/** 图片块的地址；只有图片块允许放大。 */
	readonly imageSource: string | null;
	readonly nodeId: string | null;
	readonly onChooseOption: (nodeId: string, text: string) => void;
}

/**
 * 用 sandbox="allow-scripts" 的 iframe 渲染 HTML 模板。没有 allow-same-origin，
 * 脚本拿到的是不透明来源，读不到父页面的 DOM 与 cookie。
 */
export function SandboxBlock({
	blockName,
	template,
	content,
	imageSource,
	nodeId,
	onChooseOption,
}: SandboxBlockProps) {
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const [height, setHeight] = useState(MIN_SANDBOX_HEIGHT);
	const [zoomed, setZoomed] = useState(false);

	useEffect(() => {
		const frame = frameRef.current;
		if (frame === null) return;
		const onMessage = (event: MessageEvent): void => {
			if (event.source !== frame.contentWindow) return;
			if (event.origin !== "null") return;
			const message = parseSandboxMessage(event.data);
			if (message === null) return;
			if (message.kind === "height") {
				setHeight(message.height);
			}
			if (message.kind === "action") {
				if (message.action.kind === "zoom") setZoomed(true);
				if (message.action.kind === "choice" && nodeId !== null) {
					onChooseOption(nodeId, message.action.text);
				}
			}
			const ack = sandboxAck(message);
			if (ack !== null) frame.contentWindow?.postMessage(ack, "*");
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [nodeId, onChooseOption]);

	return (
		<div className="block block-sandbox">
			<iframe
				ref={frameRef}
				title={`沙箱块：${blockName}`}
				sandbox="allow-scripts"
				srcDoc={buildSandboxDocument(template, content)}
				style={{ height: `${height}px` }}
			/>
			{zoomed && imageSource !== null ? (
				<dialog
					open
					className="image-zoom"
					aria-modal="true"
					aria-label="放大图片"
					onClick={() => setZoomed(false)}
					onKeyDown={(event) => {
						if (event.key === "Escape") setZoomed(false);
					}}
				>
					<img src={imageSource} alt="剧情插图" />
					<button
						className="image-zoom-close"
						type="button"
						onClick={() => setZoomed(false)}
					>
						关闭
					</button>
				</dialog>
			) : null}
		</div>
	);
}

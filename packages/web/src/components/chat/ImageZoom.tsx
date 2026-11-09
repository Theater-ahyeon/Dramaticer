export interface ImageZoomProps {
	readonly src: string;
	readonly onClose: () => void;
}

/** 全屏放大图片；点击遮罩、关闭按钮或按 Escape 退出。 */
export function ImageZoom({ src, onClose }: ImageZoomProps) {
	return (
		<dialog
			open
			className="image-zoom"
			aria-modal="true"
			aria-label="放大图片"
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") onClose();
			}}
		>
			<img src={src} alt="剧情插图" />
			<button className="image-zoom-close" type="button" onClick={onClose}>
				关闭
			</button>
		</dialog>
	);
}

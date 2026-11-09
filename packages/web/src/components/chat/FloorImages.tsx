import type { NodeImage } from "@dramaticer/protocol";
import { useState } from "react";
import { isImagePending } from "../../chat/node-images";
import { ImageZoom } from "./ImageZoom";

export interface FloorImagesProps {
	readonly images: readonly NodeImage[];
	/** 正在重试的图片 id；请求期间禁用对应按钮。 */
	readonly retryingImageId: string | null;
	readonly onRetry: (imageId: string) => void;
}

/** 楼层正文后的插图区；占位、失败与放大都只影响附属数据。 */
export function FloorImages({
	images,
	retryingImageId,
	onRetry,
}: FloorImagesProps) {
	const [zoomSource, setZoomSource] = useState<string | null>(null);
	if (images.length === 0) return null;
	return (
		<div className="floor-images">
			{images.map((image) => {
				if (image.status === "done" && image.url !== null) {
					return (
						<button
							key={image.id}
							className="floor-image-thumb"
							type="button"
							aria-label="放大插图"
							onClick={() => setZoomSource(image.url)}
						>
							<img
								src={image.url}
								width={image.width ?? undefined}
								height={image.height ?? undefined}
								alt="剧情插图"
							/>
						</button>
					);
				}
				if (image.status === "failed") {
					const retrying = retryingImageId === image.id;
					return (
						<div
							key={image.id}
							className="floor-image-state floor-image-failed"
						>
							<span>{image.error ?? "出图失败"}</span>
							<button
								type="button"
								disabled={retrying}
								onClick={() => onRetry(image.id)}
							>
								{retrying ? "重试中…" : "重试"}
							</button>
						</div>
					);
				}
				return (
					<div key={image.id} className="floor-image-state">
						{isImagePending(image) ? "正在生成插图……" : "插图状态未知"}
					</div>
				);
			})}
			{zoomSource === null ? null : (
				<ImageZoom src={zoomSource} onClose={() => setZoomSource(null)} />
			)}
		</div>
	);
}

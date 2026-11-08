/** 一次渲染的楼层区间；`end` 不含，上下留白由调用方写成占位高度。 */
export interface VirtualWindow {
	readonly start: number;
	readonly end: number;
	readonly top: number;
	readonly bottom: number;
}

/**
 * 按每层高度把视口换算成要渲染的楼层区间。没测量过的楼层用估算高度，
 * 所以 2000 楼的长路径只渲染视口附近的一小段。
 */
export function computeVirtualWindow(
	heights: readonly number[],
	scrollTop: number,
	viewportHeight: number,
	overscan: number,
): VirtualWindow {
	if (heights.length === 0) {
		return { start: 0, end: 0, top: 0, bottom: 0 };
	}
	const offsets: number[] = [];
	let total = 0;
	for (const height of heights) {
		if (!Number.isFinite(height) || height <= 0) {
			throw new Error(`楼层高度必须是正数，收到 ${String(height)}`);
		}
		offsets.push(total);
		total += height;
	}
	const clampedScroll = Math.max(0, Math.min(scrollTop, total));
	const visibleTop = clampedScroll - overscan;
	const visibleBottom = clampedScroll + viewportHeight + overscan;
	let start = 0;
	while (
		start < heights.length &&
		(offsets[start] ?? 0) + (heights[start] ?? 0) < visibleTop
	) {
		start += 1;
	}
	let end = start;
	while (end < heights.length && (offsets[end] ?? 0) < visibleBottom) {
		end += 1;
	}
	return {
		start,
		end,
		top: offsets[start] ?? 0,
		bottom: total - (offsets[end] ?? total),
	};
}

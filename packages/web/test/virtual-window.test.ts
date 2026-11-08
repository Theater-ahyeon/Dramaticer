import { describe, expect, it } from "vitest";
import { computeVirtualWindow } from "../src/chat/virtual-window";

describe("虚拟窗口", () => {
	it("2000 楼只取视口附近的楼层", () => {
		const heights = Array.from({ length: 2000 }, () => 120);
		const window = computeVirtualWindow(heights, 0, 800, 200);
		expect(window.start).toBe(0);
		expect(window.top).toBe(0);
		expect(window.end).toBeLessThan(15);
		expect(window.end - window.start).toBeLessThan(15);
		expect(window.bottom).toBe((2000 - window.end) * 120);
	});

	it("滚动到中间时上下留白与总高度一致", () => {
		const heights = Array.from({ length: 2000 }, () => 120);
		const window = computeVirtualWindow(heights, 120_000, 800, 200);
		expect(window.start).toBeGreaterThan(900);
		expect(window.end).toBeLessThan(1_100);
		expect(window.top).toBe(window.start * 120);
		expect(window.top + (window.end - window.start) * 120 + window.bottom).toBe(
			2000 * 120,
		);
	});

	it("按每层自己的高度定位", () => {
		const heights = [100, 300, 100, 500, 100];
		const window = computeVirtualWindow(heights, 250, 100, 0);
		expect(window.start).toBe(1);
		expect(window.end).toBe(2);
		expect(window.top).toBe(100);
		expect(window.bottom).toBe(700);
	});

	it("空楼层与越界滚动都收敛", () => {
		expect(computeVirtualWindow([], 0, 800, 200)).toEqual({
			start: 0,
			end: 0,
			top: 0,
			bottom: 0,
		});
		const heights = Array.from({ length: 10 }, () => 100);
		const window = computeVirtualWindow(heights, 99_999, 300, 0);
		expect(window.end).toBe(10);
		expect(window.bottom).toBe(0);
	});

	it("高度不是正数时直接失败", () => {
		expect(() => computeVirtualWindow([100, 0], 0, 100, 0)).toThrow(
			"楼层高度必须是正数",
		);
	});
});

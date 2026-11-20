import { describe, expect, it } from "vitest";
import { onceValue, toggleOnce } from "../src/v4/once";

describe("本轮临时开关", () => {
	it("没有临时值时按功能页取值", () => {
		expect(onceValue({}, "search", true)).toBe(true);
		expect(onceValue({ search: false }, "search", true)).toBe(false);
	});

	it("点一下记下与功能页相反的值，再点一下去掉", () => {
		const off = toggleOnce({}, "search", true);
		expect(off).toEqual({ search: false });
		expect(toggleOnce(off, "search", true)).toEqual({});
	});

	it("各个开关互不影响", () => {
		const once = toggleOnce(toggleOnce({}, "style", true), "rules", false);
		expect(once).toEqual({ style: false, rules: true });
		expect(toggleOnce(once, "style", true)).toEqual({ rules: true });
	});
});

import { describe, expect, it } from "vitest";
import { formatFloorTime } from "../src/chat/format";

// 钉死时区：CI 的 runner 默认 UTC，不钉死的话把实现写成 getUTC* 也照样通过。
process.env.TZ = "Asia/Shanghai";

describe("楼层时间", () => {
	it("按本地时区显示到分钟", () => {
		expect(formatFloorTime("2026-11-28T13:05:09.000Z")).toBe("11-28 21:05");
	});

	it("午夜与个位分钟都补零", () => {
		expect(formatFloorTime("2026-01-02T16:07:00.000Z")).toBe("01-03 00:07");
	});

	it("不是今年的时间带上年份", () => {
		expect(
			formatFloorTime("2025-12-30T13:00:00.000Z", new Date(2026, 10, 28)),
		).toBe("2025-12-30 21:00");
	});

	it("解析不了的时间原样返回", () => {
		expect(formatFloorTime("昨天下午")).toBe("昨天下午");
	});
});

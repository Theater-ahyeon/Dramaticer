import { describe, expect, it } from "vitest";
import { getCoreVersion } from "../src/index.js";

describe("core", () => {
	it("returns engine version", () => {
		const version = getCoreVersion();
		expect(version.major).toBe(0);
		expect(version.minor).toBe(1);
		expect(version.patch).toBe(0);
	});
});

import { describe, expect, it } from "vitest";
import { getCompatInfo } from "../src/index.js";

describe("st-compat", () => {
	it("resolves the workspace core package", () => {
		expect(getCompatInfo()).toEqual({
			format: "sillytavern",
			coreVersion: "0.1.0",
		});
	});
});

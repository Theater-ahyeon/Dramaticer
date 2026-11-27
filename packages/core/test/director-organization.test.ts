import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_ORGANIZATION,
	assertDirectorOrganizationKind,
	isDirectorOrganizationKind,
} from "../src/index.js";

describe("导演组织方式", () => {
	it("只保留 lines；旧值 mechanisms 与 bits 安全降级", () => {
		expect(DEFAULT_DIRECTOR_ORGANIZATION).toBe("lines");
		expect(isDirectorOrganizationKind("lines")).toBe(true);
		expect(isDirectorOrganizationKind("mechanisms")).toBe(false);
		expect(assertDirectorOrganizationKind("lines")).toBe("lines");
		expect(assertDirectorOrganizationKind("mechanisms")).toBe("lines");
		expect(assertDirectorOrganizationKind("bits")).toBe("lines");
		expect(() => assertDirectorOrganizationKind("sequence", "旧设置")).toThrow(
			"旧设置不合法：sequence",
		);
	});
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapPresetToWritingDials, parsePresetJson } from "../src/index.js";

function preset() {
	const text = readFileSync(
		join(import.meta.dirname, "fixtures", "writing-preset.json"),
		"utf8",
	);
	return parsePresetJson(text);
}

describe("导入预设时的写作选项对应", () => {
	it("按条目名与内容对应到选项，其余按原顺序拼成文风包", () => {
		const { dials, mapping } = mapPresetToWritingDials(preset());

		expect(mapping).toEqual({
			name: "清风预设",
			total: 5,
			mapped: 3,
			packCount: 2,
			packText: "多写眼前的景物。\n\n语气温和，不用感叹号。",
		});
		expect(dials).toEqual({ style: "cold", person: "first", length: "long" });
	});

	it("标记类条目与停用的条目不参与对应也不进文风包", () => {
		const { mapping } = mapPresetToWritingDials(preset());
		expect(mapping.packText).not.toContain("这条已经停用");
		expect(mapping.packText).not.toContain("世界书前");
	});

	it("预设没有名字时用给定的名字", () => {
		const parsed = preset();
		const { mapping } = mapPresetToWritingDials(
			{ ...parsed, name: null },
			"手写的预设",
		);
		expect(mapping.name).toBe("手写的预设");
	});
});

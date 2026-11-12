import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	CONTEXT_SLOT_NAMES,
	DECLARATIVE_PLUGIN_FORMAT,
	DECLARATIVE_PLUGIN_FORMAT_VERSION,
	DECLARATIVE_PLUGIN_KINDS,
	DEFAULT_DIRECTOR_CONFIG,
	DIRECTOR_INTENSITIES,
	DIRECTOR_MODES,
	LEDGER_FIELD_TYPES,
	LEDGER_NAMESPACES,
	PLAYPACK_FORMAT,
	PLAYPACK_FORMAT_VERSION,
	parseDeclarativePlugin,
	parseDeclarativePlugins,
} from "../src/index.js";

const docsDir = join(import.meta.dirname, "../../../docs/plugins");
const examplesDir = join(docsDir, "examples");
const docPath = join(docsDir, "declarative-plugins.md");

const EXPECTED_KINDS: Readonly<Record<string, string>> = {
	"block-renderer.status-bar.json": "block-renderer",
	"ledger-schema.cultivation.json": "ledger-schema",
	"skill.dialogue-craft.json": "skill",
};

function readExample(file: string): unknown {
	return JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
}

describe("声明式插件示例", () => {
	it("三个示例文件都存在并全部通过解析", () => {
		const files = readdirSync(examplesDir)
			.filter((file) => file.endsWith(".json"))
			.sort();
		expect(files).toEqual(Object.keys(EXPECTED_KINDS).sort());
		const plugins = parseDeclarativePlugins(
			files.map((file) => readExample(file)),
			"examples",
		);
		expect(plugins.map((plugin) => plugin.name).sort()).toEqual([
			"example.cultivation-ledger",
			"example.dialogue-craft",
			"example.status-bar",
		]);
		for (const [index, file] of files.entries()) {
			expect(plugins[index]?.kind).toBe(EXPECTED_KINDS[file]);
			expect(plugins[index]?.format).toBe(DECLARATIVE_PLUGIN_FORMAT);
			expect(plugins[index]?.formatVersion).toBe(
				DECLARATIVE_PLUGIN_FORMAT_VERSION,
			);
		}
	});

	it("示例负载是文档描述的三种类型", () => {
		const ledger = parseDeclarativePlugin(
			readExample("ledger-schema.cultivation.json"),
		);
		expect(ledger.kind).toBe("ledger-schema");
		if (ledger.kind !== "ledger-schema") return;
		expect(ledger.payload.namespace).toBe("character");
		expect(ledger.payload.fields.map((field) => field.type)).toEqual([
			"enum",
			"integer",
			"string",
			"string-array",
			"boolean",
		]);

		const renderer = parseDeclarativePlugin(
			readExample("block-renderer.status-bar.json"),
		);
		expect(renderer.kind).toBe("block-renderer");
		if (renderer.kind !== "block-renderer") return;
		expect(renderer.payload.block).toBe("状态栏");
		expect(renderer.payload.display.kind).toBe("html");
		expect(renderer.payload.context).toEqual({ kind: "keep-depth", depth: 2 });

		const skill = parseDeclarativePlugin(
			readExample("skill.dialogue-craft.json"),
		);
		expect(skill.kind).toBe("skill");
		if (skill.kind !== "skill") return;
		expect(skill.payload.name).toBe("对白分寸");
		expect(skill.payload.content.startsWith("# 对白分寸")).toBe(true);
	});

	it("格式文档与解析器常量一致", () => {
		const doc = readFileSync(docPath, "utf8");
		for (const kind of DECLARATIVE_PLUGIN_KINDS) {
			expect(doc).toContain(`\`${kind}\``);
		}
		for (const namespace of LEDGER_NAMESPACES) {
			expect(doc).toContain(`\`${namespace}\``);
		}
		for (const type of LEDGER_FIELD_TYPES) {
			expect(doc).toContain(`\`${type}\``);
		}
		for (const slot of CONTEXT_SLOT_NAMES) {
			expect(doc).toContain(`\`${slot}\``);
		}
		for (const mode of DIRECTOR_MODES) {
			expect(doc).toContain(`\`${mode}\``);
		}
		for (const intensity of DIRECTOR_INTENSITIES) {
			expect(doc).toContain(`\`${intensity}\``);
		}
		for (const key of Object.keys(DEFAULT_DIRECTOR_CONFIG)) {
			expect(doc).toContain(`\`${key}\``);
		}
		expect(doc).toContain(`\`${DECLARATIVE_PLUGIN_FORMAT}\``);
		expect(doc).toContain(`\`${PLAYPACK_FORMAT}\``);
		expect(doc).toContain(`\`${PLAYPACK_FORMAT_VERSION}\``);
		for (const key of ["plugins", "requires", "recommends", "versionRange"]) {
			expect(doc).toContain(`\`${key}\``);
		}
	});
});

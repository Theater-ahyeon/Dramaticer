import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseBlocks } from "@dramaticer/core/blocks";
import { describe, expect, it } from "vitest";
import {
	API_ERROR_CODES,
	SSE_EVENT_NAMES,
	toDisplayedBlocks,
} from "../src/index.js";

const distDir = join(import.meta.dirname, "..", "dist");

function collectJavaScript(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (name.endsWith(".js")) out.push(path);
		else if (!name.includes(".")) collectJavaScript(path, out);
	}
	return out;
}

describe("协议常量", () => {
	it("SSE 事件名互不重复且符合 event 命名", () => {
		const names = Object.values(SSE_EVENT_NAMES);
		expect(new Set(names).size).toBe(names.length);
		for (const name of names) {
			expect(name).toMatch(/^[a-z]+\.[a-z]+$/);
		}
	});

	it("错误码互不重复", () => {
		expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
	});
});

describe("显示载荷", () => {
	it("保留块注册表给出的显示策略，不带注册表定义", () => {
		const [block] = toDisplayedBlocks(
			parseBlocks("<旁白>风<备忘>钥匙</备忘></旁白>"),
		);
		expect(block).toMatchObject({
			kind: "block",
			name: "旁白",
			complete: true,
			raw: "风钥匙",
			display: { kind: "native", component: "narration" },
		});
		expect(block).not.toHaveProperty("type");
		if (block?.kind !== "block") throw new Error("没有解析出块");
		expect(block.content[1]).toMatchObject({
			kind: "block",
			name: "备忘",
			display: { kind: "native", component: "memo" },
		});
	});
});

describe("编译产物", () => {
	it.skipIf(!existsSync(distDir))(
		"dist 的 JavaScript 不引用 core 的运行时代码",
		() => {
			const files = collectJavaScript(distDir);
			expect(files.length).toBeGreaterThan(0);
			for (const file of files) {
				const text = readFileSync(file, "utf8");
				expect(text).not.toContain("@dramaticer/core");
			}
		},
	);
});

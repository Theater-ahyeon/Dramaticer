import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { loadDotEnv } from "../src/index.js";

function tempEnv(content: string): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-env-"));
	onTestFinished(() => {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	const file = join(dir, ".env");
	writeFileSync(file, content, "utf8");
	return file;
}

describe("loadDotEnv", () => {
	it("文件缺失时抛错并包含文件路径", () => {
		const missing = join(import.meta.dirname, "不存在的目录", ".env");
		expect(() => loadDotEnv(missing)).toThrow(missing);
	});

	it("文件里的值覆盖进程里已有的同名变量", () => {
		const name = "DRAMATICER_TEST_LOAD_DOT_ENV";
		const previous = process.env[name];
		process.env[name] = "来自进程";
		onTestFinished(() => {
			if (previous === undefined) delete process.env[name];
			else process.env[name] = previous;
		});

		loadDotEnv(tempEnv(`${name}=来自文件\n`));
		expect(process.env[name]).toBe("来自文件");
	});
});

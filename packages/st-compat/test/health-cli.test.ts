import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHealthCli } from "../src/health/cli.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/", import.meta.url));

describe("runHealthCli", () => {
	it("按注入的路径写出私有版与统计版报告", async () => {
		const outputRoot = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-cli-"),
		);
		try {
			const messages: string[] = [];
			const result = await runHealthCli({
				rawRoot: fixturesPath,
				evalsetRoot: path.join(fixturesPath, "evalset"),
				privateReportPath: path.join(outputRoot, "private", "health.md"),
				publicReportPath: path.join(outputRoot, "public", "M0-health.md"),
				generatedAt: "2026-01-07T00:00:00.000Z",
				log: (message) => messages.push(message),
			});
			expect(result.report.totals.messageCount).toBe(5);
			const privateText = await readFile(result.privateReportPath, "utf8");
			const publicText = await readFile(result.publicReportPath, "utf8");
			expect(privateText).toContain("测试角色");
			expect(publicText).toContain("# M0 体检报告（统计版）");
			expect(publicText).not.toContain("测试角色");
			expect(publicText).toContain("## 检索基线（BM25）");
			expect(publicText).toContain("## ACU 对照组（表格覆盖）");
			expect(messages.some((message) => message.includes("体检完成"))).toBe(
				true,
			);
		} finally {
			await rm(outputRoot, { recursive: true, force: true });
		}
	});
});

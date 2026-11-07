import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runReferenceCli } from "../src/reference/cli.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/", import.meta.url));

describe("runReferenceCli", () => {
	it("生成私有版与统计版报告，统计版不含作品名与原文", async () => {
		const outputRoot = await mkdtemp(
			path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				".tmp-reference-",
			),
		);
		try {
			const referenceRoot = path.join(outputRoot, "reference");
			await mkdir(referenceRoot, { recursive: true });
			await writeFile(
				path.join(referenceRoot, "作品甲.txt"),
				"他说：“这是私有作品的第一句话。”然后他离开了。\n第二段继续讲述故事。",
				"utf8",
			);
			const messages: string[] = [];
			const result = await runReferenceCli({
				publicFixturePath: path.join(
					fixturesPath,
					"reference",
					"public-domain.txt",
				),
				referenceRoot,
				chatRoot: fixturesPath,
				cosine: {
					modelLabel: "fake@2",
					pairsPerWork: 1,
					blockCount: 2,
					pairCount: 1,
					duplicatePairCount: 0,
					meanCosine: 0.5,
					percentiles: { p50: 0.5, p90: 0.5, p95: 0.5, p99: 0.5 },
					works: [
						{ name: "作品甲", pairCount: 1, meanCosine: 0.5, p95Cosine: 0.5 },
					],
				},
				privateReportPath: path.join(outputRoot, "private", "reference.md"),
				publicReportPath: path.join(outputRoot, "public", "reference.md"),
				generatedAt: "2026-01-07T00:00:00.000Z",
				log: (message) => messages.push(message),
			});
			expect(result.baseline.privateWorks).toHaveLength(1);
			expect(result.baseline.conversations).toHaveLength(1);
			const privateText = await readFile(result.privateReportPath, "utf8");
			const publicText = await readFile(result.publicReportPath, "utf8");
			expect(privateText).toContain("# 参照文本统计（私有版）");
			expect(privateText).toContain("作品甲");
			expect(privateText).toContain("句长分布：");
			expect(privateText).toContain("词汇丰富度");
			expect(privateText).toContain("## 评测对话对照");
			expect(privateText).toContain("## 参照 embedding 余弦");
			expect(privateText).toContain("作品甲");
			expect(publicText).toContain("# 参照文本统计（统计版）");
			expect(publicText).toContain("作品 2");
			expect(publicText).not.toContain("作品甲");
			expect(publicText).not.toContain("这是私有作品的第一句话");
			expect(publicText).not.toContain("测试角色");
			expect(publicText).toContain("## 评测对话对照");
			expect(publicText).toContain("对话 1");
			expect(publicText).toContain("句长分布：");
			expect(publicText).toContain("对话占比");
			expect(publicText).toContain("连续含对白块");
			expect(publicText).toContain("连续无对白块");
			expect(publicText).toContain("相邻相似度分位");
			expect(messages.some((message) => message.includes("参照统计"))).toBe(
				true,
			);
			expect(messages.some((message) => message.includes("评测对话对照"))).toBe(
				true,
			);
		} finally {
			await rm(outputRoot, { recursive: true, force: true });
		}
	});

	it("参照目录不存在时仍然生成两份报告", async () => {
		const outputRoot = await mkdtemp(
			path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				".tmp-reference-",
			),
		);
		try {
			const result = await runReferenceCli({
				publicFixturePath: path.join(
					fixturesPath,
					"reference",
					"public-domain.txt",
				),
				referenceRoot: path.join(outputRoot, "missing"),
				privateReportPath: path.join(outputRoot, "private", "reference.md"),
				publicReportPath: path.join(outputRoot, "public", "reference.md"),
				generatedAt: "2026-01-07T00:00:00.000Z",
				log: () => undefined,
			});
			expect(result.baseline.privateWorks).toHaveLength(0);
			expect(result.baseline.aggregate.workCount).toBe(1);
			const privateText = await readFile(result.privateReportPath, "utf8");
			expect(privateText).toContain("私有参照基线尚未建立");
			expect(privateText).toContain("没有提供快照目录，未统计评测对话");
			expect(privateText).toContain("未运行 embedding 余弦校准");
		} finally {
			await rm(outputRoot, { recursive: true, force: true });
		}
	});
});

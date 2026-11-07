import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	collectHealthReport,
	parseSnapshotManifest,
	renderPrivateReport,
	renderPublicReport,
} from "../src/health/report.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/", import.meta.url));

describe("parseSnapshotManifest", () => {
	it("拒绝缺少 files 的 manifest", () => {
		expect(() => parseSnapshotManifest({})).toThrow();
		expect(() => parseSnapshotManifest({ files: [{}] })).toThrow();
		expect(() =>
			parseSnapshotManifest({ files: [{ role: "chat", target: 1 }] }),
		).toThrow();
	});

	it("保留角色和字符名", () => {
		const manifest = parseSnapshotManifest({
			generatedAt: "2026-01-01",
			files: [{ role: "chat", character: "角色", target: "a.jsonl" }],
		});
		expect(manifest.generatedAt).toBe("2026-01-01");
		expect(manifest.files[0]).toEqual({
			role: "chat",
			character: "角色",
			target: "a.jsonl",
		});
	});
});

describe("collectHealthReport", () => {
	it("汇总 fixture 里的对话、卡、世界书和预设", async () => {
		const report = await collectHealthReport({
			rawRoot: fixturesPath,
			generatedAt: "2026-01-02T00:00:00.000Z",
		});
		expect(report.generatedAt).toBe("2026-01-02T00:00:00.000Z");
		expect(report.manifestGeneratedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(report.chats).toHaveLength(1);
		expect(report.chats[0]?.character).toBe("测试角色");
		expect(report.totals.messageCount).toBe(5);
		expect(report.totals.diffCount).toBe(3);
		expect(report.entities.totals.embeddedBookEntryCount).toBe(2);
		expect(report.entities.totals.enabledWorldEntryCount).toBe(1);
		expect(report.presets.presetCount).toBe(1);
	});
});

describe("报告渲染", () => {
	it("统计版不包含角色名、文件名和原文", async () => {
		const report = await collectHealthReport({
			rawRoot: fixturesPath,
			generatedAt: "2026-01-02T00:00:00.000Z",
		});
		const text = renderPublicReport(report);
		expect(text).toContain("# M0 体检报告（统计版）");
		expect(text).toContain("对话 1");
		expect(text).toContain("hash_sheets");
		expect(text).not.toContain("测试角色");
		expect(text).not.toContain("测试卡");
		expect(text).not.toContain("测试预设");
		expect(text).not.toContain("health-chat.jsonl");
		expect(text).not.toContain("alpha beta gamma");
	});

	it("私有版包含角色名和文件名", async () => {
		const report = await collectHealthReport({
			rawRoot: fixturesPath,
			generatedAt: "2026-01-02T00:00:00.000Z",
		});
		const text = renderPrivateReport(report);
		expect(text).toContain("测试角色");
		expect(text).toContain("health-chat.jsonl");
		expect(text).toContain("测试卡");
		expect(text).toContain("正则作用范围");
		expect(text).toContain("diff/快照");
	});
});

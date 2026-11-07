import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AcuBaseline } from "../src/evalset/acu.js";
import type { RetrievalBaseline } from "../src/evalset/retrieval.js";
import { parseSnapshotManifest } from "../src/health/manifest.js";
import {
	collectHealthReport,
	renderPrivateReport,
	renderPublicReport,
} from "../src/health/report.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fieldsFixturesPath = path.join(fixturesPath, "health-fields");

const retrieval: RetrievalBaseline = {
	generatedAt: "2026-01-03T00:00:00.000Z",
	maxChars: 400,
	overlapChars: 80,
	stories: [
		{
			story: "私有角色名",
			floorCount: 5,
			chunkCount: 6,
			byKind: [
				{ kind: "state", questionCount: 2, hitAt5: 1, hitAt10: 2, hitAt20: 2 },
			],
			total: { questionCount: 2, hitAt5: 1, hitAt10: 2, hitAt20: 2 },
		},
	],
	byKind: [
		{ kind: "state", questionCount: 2, hitAt5: 1, hitAt10: 2, hitAt20: 2 },
	],
	total: { questionCount: 2, hitAt5: 1, hitAt10: 2, hitAt20: 2 },
};

const acu: AcuBaseline = {
	generatedAt: "2026-01-04T00:00:00.000Z",
	stories: [
		{
			story: "私有表格故事",
			applicable: true,
			snapshotFloorCount: 2,
			byKind: [{ kind: "state", questionCount: 2, coveredCount: 1 }],
			byAnswerLength: [{ label: "1 字符", questionCount: 1, coveredCount: 1 }],
			questionCount: 2,
			coveredCount: 1,
		},
		{
			story: "私有空表故事",
			applicable: false,
			snapshotFloorCount: 0,
			byKind: [],
			byAnswerLength: [],
			questionCount: 0,
			coveredCount: 0,
		},
		{
			story: "私有零题故事",
			applicable: true,
			snapshotFloorCount: 0,
			byKind: [],
			byAnswerLength: [],
			questionCount: 0,
			coveredCount: 0,
		},
	],
	byKind: [{ kind: "state", questionCount: 2, coveredCount: 1 }],
	byAnswerLength: [{ label: "1 字符", questionCount: 1, coveredCount: 1 }],
	total: { questionCount: 2, coveredCount: 1 },
};

describe("parseSnapshotManifest", () => {
	it("拒绝缺少 files 的 manifest", () => {
		expect(() => parseSnapshotManifest({})).toThrow();
		expect(() => parseSnapshotManifest({ files: [{}] })).toThrow();
		expect(() =>
			parseSnapshotManifest({ files: [{ role: "chat", target: 1 }] }),
		).toThrow();
	});

	it("保留角色、大小与 sha256", () => {
		const manifest = parseSnapshotManifest({
			generatedAt: "2026-01-01",
			files: [
				{
					role: "chat",
					character: "角色",
					target: "a.jsonl",
					size: 12,
					sha256: "a".repeat(64),
				},
			],
		});
		expect(manifest.generatedAt).toBe("2026-01-01");
		expect(manifest.files[0]).toEqual({
			role: "chat",
			character: "角色",
			target: "a.jsonl",
			size: 12,
			sha256: "a".repeat(64),
		});
	});

	it("拒绝缺少大小或 sha256 的条目", () => {
		const base = { role: "chat", target: "a.jsonl" };
		expect(() => parseSnapshotManifest({ files: [base] })).toThrow(
			"manifest.files[0].size 必须是非负整数",
		);
		expect(() =>
			parseSnapshotManifest({ files: [{ ...base, size: 1.5 }] }),
		).toThrow("manifest.files[0].size 必须是非负整数");
		expect(() =>
			parseSnapshotManifest({ files: [{ ...base, size: -1 }] }),
		).toThrow("manifest.files[0].size 必须是非负整数");
		expect(() =>
			parseSnapshotManifest({ files: [{ ...base, size: 10 }] }),
		).toThrow("manifest.files[0].sha256 必须是 64 位小写十六进制");
		expect(() =>
			parseSnapshotManifest({
				files: [{ ...base, size: 10, sha256: "A".repeat(64) }],
			}),
		).toThrow("manifest.files[0].sha256 必须是 64 位小写十六进制");
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
		expect(report.regex.scriptCount).toBe(2);
		expect(report.regex.categories).toHaveLength(8);
		expect(
			report.regex.categories.find((item) => item.category === "text_replace")
				?.scriptCount,
		).toBe(2);
	});

	it("合计覆盖头部字节，差额只来自行分隔符", async () => {
		const report = await collectHealthReport({
			rawRoot: fixturesPath,
			generatedAt: "2026-01-02T00:00:00.000Z",
		});
		const totals = report.totals;
		expect(totals.headerBytes).toBe(
			report.chats.reduce((sum, chat) => sum + chat.stats.headerBytes, 0),
		);
		const classified =
			totals.headerBytes +
			totals.bodyBytes +
			totals.variablesBytes +
			totals.otherBytes;
		expect(
			Math.abs(totals.fileBytes - classified) / totals.fileBytes,
		).toBeLessThan(0.01);
	});

	it("字段统计保留全量，每个对话的第 11 名字段进入合计", async () => {
		const report = await collectHealthReport({
			rawRoot: fieldsFixturesPath,
			generatedAt: "2026-01-06T00:00:00.000Z",
		});
		expect(report.chats).toHaveLength(2);
		for (const chat of report.chats) {
			expect(chat.stats.fieldBytes).toHaveLength(13);
			expect(chat.stats.fieldBytes[10]?.field).toBe("common_11");
		}
		const text = renderPublicReport(report);
		expect(text).toContain("common_11");
	});

	it("manifest 没有 chat 时抛错", async () => {
		const dir = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-report-"),
		);
		try {
			await writeFile(
				path.join(dir, "manifest.json"),
				JSON.stringify({
					files: [
						{
							role: "card",
							target: "card.json",
							size: 0,
							sha256: "0".repeat(64),
						},
					],
				}),
				"utf8",
			);
			await expect(collectHealthReport({ rawRoot: dir })).rejects.toThrow(
				"manifest 里没有 chat",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("manifest 路径越界时抛错", async () => {
		const dir = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-report-"),
		);
		try {
			await writeFile(
				path.join(dir, "manifest.json"),
				JSON.stringify({
					files: [
						{
							role: "chat",
							target: "../outside.jsonl",
							size: 0,
							sha256: "0".repeat(64),
						},
					],
				}),
				"utf8",
			);
			await expect(collectHealthReport({ rawRoot: dir })).rejects.toThrow(
				"manifest 路径越界",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("raw 文件大小与 manifest 不一致时抛错并指出 target", async () => {
		const dir = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-report-"),
		);
		try {
			const target = "chat.jsonl";
			const content = await readFile(
				path.join(fixturesPath, "health-chat.jsonl"),
				"utf8",
			);
			await writeFile(path.join(dir, target), content, "utf8");
			await writeFile(
				path.join(dir, "manifest.json"),
				JSON.stringify({
					files: [
						{
							role: "chat",
							target,
							size: Buffer.byteLength(content),
							sha256: createHash("sha256").update(content).digest("hex"),
						},
					],
				}),
				"utf8",
			);
			await collectHealthReport({ rawRoot: dir });

			await writeFile(path.join(dir, target), `${content} `, "utf8");
			await expect(collectHealthReport({ rawRoot: dir })).rejects.toThrow(
				`快照文件大小与 manifest 不一致：${target}`,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("raw 文件 sha256 与 manifest 不一致时抛错并指出 target", async () => {
		const dir = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-report-"),
		);
		try {
			const target = "chat.jsonl";
			const content = await readFile(
				path.join(fixturesPath, "health-chat.jsonl"),
				"utf8",
			);
			await writeFile(path.join(dir, target), content, "utf8");
			await writeFile(
				path.join(dir, "manifest.json"),
				JSON.stringify({
					files: [
						{
							role: "chat",
							target,
							size: Buffer.byteLength(content),
							sha256: createHash("sha256").update(content).digest("hex"),
						},
					],
				}),
				"utf8",
			);
			const tampered = `${content.slice(0, -1)}${content.endsWith("x") ? "y" : "x"}`;
			await writeFile(path.join(dir, target), tampered, "utf8");
			await expect(collectHealthReport({ rawRoot: dir })).rejects.toThrow(
				`快照文件 sha256 与 manifest 不一致：${target}`,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("raw 文件不存在时抛错并指出 target", async () => {
		const dir = await mkdtemp(
			path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-report-"),
		);
		try {
			await writeFile(
				path.join(dir, "manifest.json"),
				JSON.stringify({
					files: [
						{
							role: "chat",
							target: "missing.jsonl",
							size: 0,
							sha256: "0".repeat(64),
						},
					],
				}),
				"utf8",
			);
			await expect(collectHealthReport({ rawRoot: dir })).rejects.toThrow(
				"快照文件不存在：missing.jsonl",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
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
		expect(text).toContain("## 正则分类");
		expect(text).toContain("启用的脚本里可升级比例");
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
		expect(text).toContain("目标标签前 20");
		expect(text).toContain("diff/快照");
	});

	it("检索基线按对话统计，统计版不出现私有故事名", async () => {
		const report = await collectHealthReport({
			rawRoot: fixturesPath,
			generatedAt: "2026-01-02T00:00:00.000Z",
		});
		const publicText = renderPublicReport(report, retrieval);
		expect(publicText).toContain("## 检索基线（BM25）");
		expect(publicText).toContain("命中@5");
		expect(publicText).toContain("50.0%");
		expect(publicText).not.toContain("私有角色名");
		const privateText = renderPrivateReport(report, retrieval);
		expect(privateText).toContain("私有角色名");
		expect(privateText).toContain("50.0%");
	});

	it("ACU 段按对话渲染，0/0 的覆盖率显示破折号", async () => {
		const report = await collectHealthReport({
			rawRoot: fixturesPath,
			generatedAt: "2026-01-02T00:00:00.000Z",
		});
		const publicText = renderPublicReport(report, undefined, acu);
		expect(publicText).toContain("## ACU 对照组（表格覆盖）");
		expect(publicText).toContain("50.0%");
		expect(publicText).toContain("不适用");
		expect(publicText).toContain("| 对话 3 | 0 | 0 | 0 | — |");
		expect(publicText).not.toContain("私有表格故事");
		const privateText = renderPrivateReport(report, undefined, acu);
		expect(privateText).toContain("私有表格故事");
		expect(privateText).toContain("私有空表故事");
		expect(privateText).toContain("私有零题故事");
		expect(privateText).toContain("—");
	});

	it("统计版不出现私有版的整表标识", async () => {
		const report = await collectHealthReport({
			rawRoot: fixturesPath,
			generatedAt: "2026-01-02T00:00:00.000Z",
		});
		const privateText = renderPrivateReport(report, retrieval, acu);
		const publicText = renderPublicReport(report, retrieval, acu);
		const identifiers = new Set<string>();
		for (const chat of report.chats) {
			if (chat.character !== null) identifiers.add(chat.character);
			identifiers.add(chat.fileName);
		}
		for (const card of report.entities.cards) identifiers.add(card.name);
		for (const world of report.entities.worlds) {
			if (world.name !== null) identifiers.add(world.name);
		}
		for (const tag of report.regex.topTags) identifiers.add(tag.tag);
		for (const story of retrieval.stories) identifiers.add(story.story);
		for (const story of acu.stories) identifiers.add(story.story);
		expect(identifiers.size).toBeGreaterThan(0);
		for (const identifier of identifiers) {
			expect(privateText).toContain(identifier);
			expect(publicText).not.toContain(identifier);
		}
	});
});

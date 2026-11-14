import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type NewImportAuditEntry,
	StoryStore,
	buildImportAuditReport,
	createTokenEstimator,
} from "../src/index.js";

function openStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-import-report-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), { recursive: true, force: true, maxRetries: 5 });
	});
	store.createStory({ id: "s1", title: "山门" });
	return store;
}

function auditEntry(
	overrides: Partial<NewImportAuditEntry> = {},
): NewImportAuditEntry {
	return {
		source: "world-info:旧世:0",
		title: "世界背景",
		content: "灵潮退去三百年后，修行者依靠旧时代的遗物行走世间。",
		matches: [{ kind: "common", rules: ["title:common"] }],
		rulePrimary: "common",
		constant: true,
		...overrides,
	};
}

describe("导入体检数据", () => {
	it("按生效类型计数并列出未识别、作者选项与插件残留", () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [
			auditEntry(),
			auditEntry({
				source: "world-info:旧世:1",
				title: "苏瑾",
				content: "青云宗剑修，随身带着断剑。",
				matches: [{ kind: "entity", rules: ["content:profile-fields"] }],
				rulePrimary: "entity",
				constant: false,
			}),
			auditEntry({
				source: "world-info:旧世:2",
				title: "章节回顾",
				content: "第一章：山门被攻破。",
				matches: [{ kind: "unknown", rules: ["no-rule"] }],
				rulePrimary: "unknown",
				constant: false,
			}),
			auditEntry({
				source: "world-info:旧世:3",
				title: "开局菜单",
				content: "一、留在山门。二、下山。",
				matches: [{ kind: "options", rules: ["title:options"] }],
				rulePrimary: "options",
				constant: false,
			}),
			auditEntry({
				source: "world-info:旧世:4",
				title: "状态栏脚本",
				content: "<script>setvar('hp', 10)</script>",
				matches: [{ kind: "plugin-residue", rules: ["content:script"] }],
				rulePrimary: "plugin-residue",
				constant: false,
			}),
		]);
		store.setImportAuditEntryKind("s1", "world-info:旧世:2", "event", "player");

		const report = buildImportAuditReport({
			storyId: "s1",
			entries: store.listImportAuditEntries("s1"),
			loreEntries: [],
		});

		expect(report.total).toBe(5);
		const byKind = new Map(report.counts.map((row) => [row.kind, row.count]));
		expect(byKind.get("common")).toBe(1);
		expect(byKind.get("entity")).toBe(1);
		expect(byKind.get("event")).toBe(1);
		expect(byKind.get("unknown")).toBe(0);
		expect(byKind.get("options")).toBe(1);
		expect(byKind.get("plugin-residue")).toBe(1);
		expect(report.unknown).toEqual([]);
		expect(report.authorOptions.map((entry) => entry.source)).toEqual([
			"world-info:旧世:3",
		]);
		expect(report.pluginResidue.map((entry) => entry.title)).toEqual([
			"状态栏脚本",
		]);
		const adjusted = report.entries.find(
			(entry) => entry.source === "world-info:旧世:2",
		);
		expect(adjusted).toMatchObject({
			kind: "event",
			kindSource: "player",
			rulePrimary: "unknown",
		});
	});

	it("未识别清单跟着生效类型变化，但与规则判定分开保存", () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [
			auditEntry({
				source: "world-info:旧世:0",
				title: "附录",
				content: "那一年的冬天格外漫长。\n人们把粮食藏进地窖。",
				matches: [{ kind: "unknown", rules: ["no-rule"] }],
				rulePrimary: "unknown",
				constant: false,
			}),
		]);
		const before = buildImportAuditReport({
			storyId: "s1",
			entries: store.listImportAuditEntries("s1"),
			loreEntries: [],
		});
		expect(before.unknown).toHaveLength(1);

		store.setImportAuditEntryKind(
			"s1",
			"world-info:旧世:0",
			"writing",
			"player",
		);
		const after = buildImportAuditReport({
			storyId: "s1",
			entries: store.listImportAuditEntries("s1"),
			loreEntries: [],
		});
		expect(after.unknown).toEqual([]);
		expect(after.entries[0]).toMatchObject({
			kind: "writing",
			kindSource: "player",
			rulePrimary: "unknown",
		});
	});

	it("token 前后只算真正导入的条目：前是常驻全文，后是常识全文加实体索引", () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [
			auditEntry({
				source: "world-info:旧世:0",
				title: "世界背景",
				content: "灵潮退去三百年。",
				constant: true,
			}),
			auditEntry({
				source: "world-info:旧世:1",
				title: "苏瑾",
				content: "青云宗剑修，随身带着断剑。",
				matches: [{ kind: "entity", rules: ["content:profile-fields"] }],
				rulePrimary: "entity",
				constant: false,
			}),
			auditEntry({
				source: "world-info:旧世:2",
				title: "伏笔",
				content: "山后埋着历代断剑。",
				matches: [{ kind: "event", rules: ["title:event"] }],
				rulePrimary: "event",
				constant: true,
			}),
			auditEntry({
				source: "world-info:旧世:3",
				title: "停用条目",
				content: "停用条目的正文。",
				matches: [{ kind: "common", rules: ["title:common"] }],
				rulePrimary: "common",
				constant: true,
			}),
		]);
		store.insertLoreEntries([
			{
				storyId: "s1",
				name: "世界背景",
				content: "灵潮退去三百年。",
				constant: true,
				source: "world-info:旧世:0",
			},
			{
				storyId: "s1",
				name: "苏瑾",
				content: "青云宗剑修，随身带着断剑。",
				constant: false,
				keywords: ["阿瑾", "剑修"],
				source: "world-info:旧世:1",
			},
			{
				storyId: "s1",
				name: "伏笔",
				content: "山后埋着历代断剑。",
				constant: true,
				source: "world-info:旧世:2",
			},
		]);

		const estimator = createTokenEstimator();
		const report = buildImportAuditReport({
			storyId: "s1",
			entries: store.listImportAuditEntries("s1"),
			loreEntries: store.listLoreEntries("s1"),
			estimator,
		});

		expect(report.tokens.beforeEntries).toBe(2);
		expect(report.tokens.before).toBe(
			estimator(
				[
					"世界书条目：",
					"【常驻】世界背景：灵潮退去三百年。",
					"【常驻】伏笔：山后埋着历代断剑。",
				].join("\n"),
			),
		);
		expect(report.tokens.afterEntries).toBe(2);
		expect(report.tokens.after).toBe(
			estimator(
				["世界书条目：", "世界背景：灵潮退去三百年。", "苏瑾：阿瑾、剑修"].join(
					"\n",
				),
			),
		);
		expect(report.tokens.after).toBeLessThan(report.tokens.before);
	});

	it("没有条目时 token 估算为 0", () => {
		const store = openStore();
		const report = buildImportAuditReport({
			storyId: "s1",
			entries: store.listImportAuditEntries("s1"),
			loreEntries: [],
		});
		expect(report.total).toBe(0);
		expect(report.counts.every((row) => row.count === 0)).toBe(true);
		expect(report.tokens).toEqual({
			before: 0,
			after: 0,
			beforeEntries: 0,
			afterEntries: 0,
		});
	});
});

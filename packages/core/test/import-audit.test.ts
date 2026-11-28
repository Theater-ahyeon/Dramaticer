import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type NewImportAuditEntry, StoryStore } from "../src/index.js";

function openStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-import-audit-")),
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
		source: "character-book:山神:0",
		title: "世界背景",
		content: "灵潮退去三百年后，修行者依靠旧时代的遗物行走世间。",
		matches: [{ kind: "common", rules: ["title:world", "short-constant"] }],
		rulePrimary: "common",
		constant: true,
		...overrides,
	};
}

describe("导入分型结果", () => {
	it("逐条保存并读回类型、规则依据与原文", () => {
		const store = openStore();
		const saved = store.saveImportAuditEntries("s1", [
			auditEntry(),
			auditEntry({
				source: "character-book:山神:1",
				title: "章节回顾",
				content: "第一章：山门被攻破。",
				matches: [{ kind: "unknown", rules: ["no-rule"] }],
				rulePrimary: "unknown",
				constant: false,
			}),
		]);

		expect(saved).toHaveLength(2);
		expect(saved[0]).toMatchObject({
			storyId: "s1",
			source: "character-book:山神:0",
			title: "世界背景",
			content: "灵潮退去三百年后，修行者依靠旧时代的遗物行走世间。",
			matches: [{ kind: "common", rules: ["title:world", "short-constant"] }],
			rulePrimary: "common",
			kind: "common",
			kindSource: "rule",
			constant: true,
		});
		expect(saved[1]).toMatchObject({
			kind: "unknown",
			kindSource: "rule",
			constant: false,
		});
		expect(store.listImportAuditEntries("s1")).toHaveLength(2);
	});

	it("玩家与模型改过的类型在重复导入时保留，规则判定的类型跟着新规则变化", () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [
			auditEntry(),
			auditEntry({ source: "character-book:山神:1", title: "苏瑾" }),
		]);
		store.setImportAuditEntryKind(
			"s1",
			"character-book:山神:0",
			"writing",
			"player",
		);
		store.setImportAuditEntryKind(
			"s1",
			"character-book:山神:1",
			"entity",
			"model",
		);

		const saved = store.saveImportAuditEntries("s1", [
			auditEntry({
				content: "改写后的世界背景。",
				matches: [{ kind: "rule", rules: ["title:rule"] }],
				rulePrimary: "rule",
			}),
			auditEntry({
				source: "character-book:山神:1",
				title: "苏瑾",
				matches: [{ kind: "entity", rules: ["structure:keyed"] }],
				rulePrimary: "entity",
			}),
		]);

		expect(saved[0]).toMatchObject({
			kind: "writing",
			kindSource: "player",
			rulePrimary: "rule",
			content: "改写后的世界背景。",
		});
		expect(saved[1]).toMatchObject({
			kind: "entity",
			kindSource: "model",
			rulePrimary: "entity",
		});
	});

	it("回到规则判定时类型必须等于规则结果", () => {
		const store = openStore();
		store.saveImportAuditEntries("s1", [auditEntry()]);
		store.setImportAuditEntryKind(
			"s1",
			"character-book:山神:0",
			"writing",
			"player",
		);

		expect(() =>
			store.setImportAuditEntryKind(
				"s1",
				"character-book:山神:0",
				"event",
				"rule",
			),
		).toThrow("回到规则判定时类型必须是 common");
		const reset = store.setImportAuditEntryKind(
			"s1",
			"character-book:山神:0",
			"common",
			"rule",
		);
		expect(reset).toMatchObject({ kind: "common", kindSource: "rule" });
		const saved = store.saveImportAuditEntries("s1", [
			auditEntry({
				matches: [{ kind: "rule", rules: ["title:rule"] }],
				rulePrimary: "rule",
			}),
		]);
		expect(saved[0]).toMatchObject({ kind: "rule", kindSource: "rule" });
	});

	it("非法类型、来源、命中组合与重复来源都抛错", () => {
		const store = openStore();
		expect(() =>
			store.saveImportAuditEntries("missing", [auditEntry()]),
		).toThrow("故事不存在");
		expect(() =>
			store.saveImportAuditEntries("s1", [
				auditEntry({ rulePrimary: "lore" as never }),
			]),
		).toThrow("规则判定不合法");
		expect(() =>
			store.saveImportAuditEntries("s1", [
				auditEntry({
					matches: [
						{ kind: "unknown", rules: ["no-rule"] },
						{ kind: "common", rules: ["title:world"] },
					],
					rulePrimary: "unknown",
				}),
			]),
		).toThrow("unknown 不能与其他类型并列");
		expect(() =>
			store.saveImportAuditEntries("s1", [
				auditEntry({ rulePrimary: "entity" }),
			]),
		).toThrow("必须出现在命中类型里");
		expect(
			store.saveImportAuditEntries("s1", [
				auditEntry({
					source: "character-book:山神:empty",
					content: "",
				}),
			]),
		).toHaveLength(1);
		expect(() =>
			store.saveImportAuditEntries("s1", [
				auditEntry({ content: 123 as never }),
			]),
		).toThrow("content 必须是字符串");
		expect(() =>
			store.saveImportAuditEntries("s1", [auditEntry(), auditEntry()]),
		).toThrow("source 重复");
		store.saveImportAuditEntries("s1", [auditEntry()]);
		expect(() =>
			store.setImportAuditEntryKind(
				"s1",
				"character-book:山神:0",
				"entity",
				"manual" as never,
			),
		).toThrow("类型来源不合法");
		expect(() =>
			store.setImportAuditEntryKind(
				"s1",
				"character-book:山神:9",
				"entity",
				"player",
			),
		).toThrow("导入审计条目不存在");
	});

	it("插件残留转成初始记忆后不再常驻，撤销后恢复，重复导入保留转换", () => {
		const store = openStore();
		const residue = auditEntry({
			source: "character-book:山神:2",
			title: "总结",
			content: "前情提要：山门被攻破。",
			matches: [{ kind: "plugin-residue", rules: ["title:plugin-residue"] }],
			rulePrimary: "plugin-residue",
			constant: true,
		});
		const secondResidue = auditEntry({
			source: "character-book:山神:3",
			title: "统计表",
			content: "好感度统计。",
			matches: [{ kind: "plugin-residue", rules: ["title:plugin-residue"] }],
			rulePrimary: "plugin-residue",
			constant: false,
		});
		store.saveImportAuditEntries("s1", [auditEntry(), residue, secondResidue]);
		store.insertLoreEntries([
			{
				storyId: "s1",
				name: "世界背景",
				content: "灵潮退去三百年后。",
				constant: true,
				source: "character-book:山神:0",
			},
			{
				storyId: "s1",
				name: "总结",
				content: "前情提要：山门被攻破。",
				constant: true,
				keywords: ["前情提要"],
				source: "character-book:山神:2",
			},
		]);

		expect(store.listImportAuditInjectionRules("s1")).toContainEqual({
			source: "character-book:山神:2",
			kind: "plugin-residue",
			memory: false,
		});
		expect(() =>
			store.setImportAuditEntryMemory("s1", "character-book:山神:0", true),
		).toThrow("只有插件残留条目可以转成初始记忆");
		expect(() =>
			store.setImportAuditEntryMemory(
				"s1",
				"character-book:山神:2",
				"yes" as never,
			),
		).toThrow("memory 必须是布尔值");

		const converted = store.setImportAuditEntryMemory(
			"s1",
			"character-book:山神:2",
			true,
		);
		expect(converted.memory).toBe(true);
		expect(
			store
				.listLoreEntries("s1")
				.find((entry) => entry.source === "character-book:山神:2")?.constant,
		).toBe(false);

		const reimported = store.saveImportAuditEntries("s1", [residue]);
		expect(reimported[0]).toMatchObject({
			memory: true,
			constant: true,
		});

		expect(store.convertImportAuditPluginResidueToMemory("s1")).toBe(1);
		expect(store.convertImportAuditPluginResidueToMemory("s1")).toBe(0);

		const restored = store.setImportAuditEntryMemory(
			"s1",
			"character-book:山神:2",
			false,
		);
		expect(restored.memory).toBe(false);
		expect(
			store
				.listLoreEntries("s1")
				.find((entry) => entry.source === "character-book:山神:2")?.constant,
		).toBe(true);
	});
});

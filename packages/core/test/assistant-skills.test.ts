import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	AssistantDocsIndex,
	GUIDE_TOOL_NAMES,
	TROUBLESHOOT_TOOL_NAMES,
	buildAssistantSystemPrompt,
	createDocsSearchTool,
	getAssistantSkill,
	isAssistantSkillRegistered,
	listAssistantSkills,
	requireAssistantSkill,
} from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-assistant-skills-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

function writeDocs(root: string): void {
	mkdirSync(join(root, "dev", "reports"), { recursive: true });
	writeFileSync(
		join(root, "DESIGN.md"),
		[
			"# 设计",
			"",
			"## 记忆",
			"",
			"门禁会在每次提交前运行，失败时先修门禁。",
			"",
			"## 助手",
			"",
			"助手技能从文档目录读取设计说明。",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(root, "dev", "TASKS.md"),
		[
			"# 任务清单",
			"",
			"## H-T04 排障与使用指南技能",
			"",
			"docs_search 按标题与文本块切分，查询返回路径、标题与片段。",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(root, "dev", "HUMAN.md"),
		"# 人类事项\n\n没有待处理的事项。\n",
	);
	writeFileSync(
		join(root, "dev", "reports", "R3.md"),
		"# R3 报告\n\n快回合的首字延迟与生成耗时。\n",
	);
}

describe("助手技能注册表", () => {
	it("注册排障与使用指南，未注册的技能被拒绝", () => {
		expect(listAssistantSkills().map((skill) => skill.id)).toEqual([
			"troubleshoot",
			"guide",
		]);
		const troubleshoot = requireAssistantSkill("troubleshoot");
		expect(troubleshoot.name).toBe("排障");
		expect(troubleshoot.toolNames).toEqual([...TROUBLESHOOT_TOOL_NAMES]);
		expect(troubleshoot.instructions).toContain("没有记录");
		expect(troubleshoot.instructions).toContain("修正建议");
		const guide = requireAssistantSkill("guide");
		expect(guide.name).toBe("使用指南");
		expect(guide.toolNames).toEqual([...GUIDE_TOOL_NAMES]);
		expect(guide.instructions).toContain("docs_search");
		expect(guide.instructions).toContain("路径与标题");

		expect(getAssistantSkill("guide")).toBe(guide);
		expect(getAssistantSkill("strategy")).toBeNull();
		expect(() => requireAssistantSkill("ledger_revision")).toThrow(
			/助手技能未注册：ledger_revision/,
		);
		expect(isAssistantSkillRegistered("troubleshoot")).toBe(true);
		expect(isAssistantSkillRegistered("research")).toBe(false);
		expect(isAssistantSkillRegistered(42)).toBe(false);
	});

	it("系统提示把技能说明接在基础提示之后", () => {
		const guide = requireAssistantSkill("guide");
		const prompt = buildAssistantSystemPrompt({
			skill: guide.id,
			instructions: guide.instructions,
		});
		expect(prompt.startsWith("你是 Dramaticer 的应用内助手。")).toBe(true);
		expect(prompt).toContain("当前技能：guide。");
		expect(prompt).toContain("引用文档时写出相对路径与标题");
	});
});

describe("内置文档索引", () => {
	it("按标题与文本块检索，两字查询命中文档路径与标题", async () => {
		const root = tempDir();
		writeDocs(root);
		const index = await AssistantDocsIndex.load(root);
		expect(index.files).toEqual([
			"DESIGN.md",
			"dev/TASKS.md",
			"dev/HUMAN.md",
			"dev/reports/R3.md",
		]);

		const short = index.search("门禁");
		expect(short[0]?.path).toBe("DESIGN.md");
		expect(short[0]?.title).toBe("设计 > 记忆");
		expect(short[0]?.snippet).toContain("门禁");
		expect(short[0]?.matchedTerms).toEqual(["门禁"]);

		const guide = index.search("使用指南");
		expect(guide[0]?.path).toBe("dev/TASKS.md");
		expect(guide[0]?.title).toBe("任务清单 > H-T04 排障与使用指南技能");
		expect(guide[0]?.line).toBe(5);
		expect(guide[0]?.matchedTerms).toContain("使用指");

		const missing = index.search("不存在的词语");
		expect(missing).toEqual([]);
	});

	it("文档目录缺失或没有可读文件时启动失败并指出路径", async () => {
		const root = tempDir();
		const missing = join(root, "missing-docs");
		await expect(AssistantDocsIndex.load(missing)).rejects.toThrow(
			new RegExp(`文档目录不存在：${escapeRegExp(missing)}`),
		);

		const empty = join(root, "empty-docs");
		mkdirSync(join(empty, "dev", "reports"), { recursive: true });
		await expect(AssistantDocsIndex.load(empty)).rejects.toThrow(
			/文档目录下没有可读文档/,
		);
	});

	it("docs_search 工具只读检索并校验参数", async () => {
		const root = tempDir();
		writeDocs(root);
		const tool = createDocsSearchTool(await AssistantDocsIndex.load(root));
		expect(tool.name).toBe("docs_search");
		expect(tool.permission).toBe("read");
		expect(tool.execute).toBeTypeOf("function");

		const output = await tool.execute?.({ query: "门禁", limit: 2 });
		expect(typeof output).toBe("string");
		expect(output).toContain("DESIGN.md");
		expect(output).toContain("标题「设计 > 记忆」");
		expect(output).toContain("匹配词：门禁");
		expect(output).toContain("片段：");
		await expect(tool.execute?.({ query: "门禁", nope: 1 })).rejects.toThrow(
			/不接受参数 nope/,
		);
		await expect(tool.execute?.({ query: "门禁", limit: 0 })).rejects.toThrow(
			/limit 必须是 1 到 10 之间的整数/,
		);
		await expect(tool.execute?.({ query: "   " })).rejects.toThrow(
			/query 必须是非空字符串/,
		);
	});
});

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

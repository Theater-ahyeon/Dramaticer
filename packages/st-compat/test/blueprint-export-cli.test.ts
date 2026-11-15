import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BlueprintPremise,
	type BlueprintVolume,
	StoryStore,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { runBlueprintExportCli } from "../src/blueprint-export-cli.js";
import { parseCharacterCardJson, readCardBlueprint } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-blueprint-export-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

const CARD_JSON = JSON.stringify({
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "云裳",
		description: "青云宗剑修",
		personality: "",
		scenario: "",
		first_mes: "",
		mes_example: "",
		creator_notes: "",
		system_prompt: "",
		post_history_instructions: "",
		tags: [],
		creator: "",
		character_version: "",
		extensions: {},
	},
});

function premise(): BlueprintPremise {
	return {
		id: "premise",
		kind: "premise",
		source: "player",
		locked: false,
		coreQuestion: "卫宫能不能在仪式开始前找到妹妹",
		tone: "阴冷",
		endings: [],
		redLines: [],
		tension: "medium",
	};
}

function volume(): BlueprintVolume {
	return {
		id: "volume-1",
		kind: "volume",
		source: "player",
		locked: false,
		title: "第一卷 钟楼",
		coreQuestion: "谁在钟楼里等她",
		startState: "卫宫刚进城",
		endState: "卫宫知道钟楼下埋着什么",
	};
}

describe("蓝图导出命令行", () => {
	it("把 head 上的蓝图写进卡文件，其他字段保留", async () => {
		const dir = tempDir();
		const cardPath = join(dir, "card.json");
		const dbPath = join(dir, "story.db");
		const outPath = join(dir, "exported.json");
		writeFileSync(cardPath, CARD_JSON, "utf8");
		const store = StoryStore.open(dbPath);
		store.createStory({ id: "s1", title: "测试故事" });
		store.appendNode({
			id: "n0",
			storyId: "s1",
			parentId: null,
			role: "assistant",
			raw: "开场。",
		});
		store.saveStoryBlueprintBaseline("s1", [premise()]);
		store.saveStoryBlueprint({
			nodeId: "n0",
			storyId: "s1",
			source: "player",
			diffs: [{ action: "set", entry: volume() }],
		});
		store.close();

		const result = await runBlueprintExportCli([
			"--card",
			cardPath,
			"--db",
			dbPath,
			"--story",
			"s1",
			"--out",
			outPath,
		]);
		expect(result).toEqual({ outPath, entries: 2 });

		const exported = parseCharacterCardJson(readFileSync(outPath, "utf8"));
		expect(readCardBlueprint(exported)).toEqual([premise(), volume()]);
		const original = parseCharacterCardJson(CARD_JSON);
		expect(exported.name).toBe(original.name);
		expect(exported.description).toBe(original.description);
		expect(exported.extensions).toEqual({
			dramaticer: { blueprint: [premise(), volume()] },
		});
	});

	it("还没有楼层时导出卡导入的默认蓝图", async () => {
		const dir = tempDir();
		const cardPath = join(dir, "card.json");
		const dbPath = join(dir, "story.db");
		const outPath = join(dir, "exported.json");
		writeFileSync(cardPath, CARD_JSON, "utf8");
		const store = StoryStore.open(dbPath);
		store.createStory({ id: "s1", title: "测试故事" });
		store.saveStoryBlueprintBaseline("s1", [premise()]);
		store.close();

		await runBlueprintExportCli([
			`--card=${cardPath}`,
			`--db=${dbPath}`,
			"--story=s1",
			`--out=${outPath}`,
		]);
		const exported = parseCharacterCardJson(readFileSync(outPath, "utf8"));
		expect(readCardBlueprint(exported)).toEqual([premise()]);
	});

	it("缺少必填参数与不存在的故事都抛错", async () => {
		const dir = tempDir();
		const cardPath = join(dir, "card.json");
		const dbPath = join(dir, "story.db");
		writeFileSync(cardPath, CARD_JSON, "utf8");
		StoryStore.open(dbPath).close();
		await expect(
			runBlueprintExportCli(["--card", cardPath, "--db", dbPath]),
		).rejects.toThrow("--story 必填");
		await expect(
			runBlueprintExportCli([
				"--card",
				cardPath,
				"--db",
				dbPath,
				"--story",
				"missing",
				"--out",
				join(dir, "out.json"),
			]),
		).rejects.toThrow("故事不存在：missing");
	});
});

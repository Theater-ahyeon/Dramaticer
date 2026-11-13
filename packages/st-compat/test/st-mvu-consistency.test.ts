import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	StoryStore,
	applySettlementProposals,
	prepareSettlement,
	readLedger,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { parseCharacterCardFile } from "../src/character-card.js";
import {
	MvuLedgerSession,
	buildMvuCardInitState,
	buildMvuInitState,
	parseMvuSchema,
	parseMvuUpdate,
	validateMvuSchemaValue,
} from "../src/st-mvu/index.js";

function openTempStore(): StoryStore {
	const path = join(
		mkdtempSync(join(import.meta.dirname, ".tmp-mvu-consistency-")),
		"story.db",
	);
	const store = StoryStore.open(path);
	onTestFinished(() => {
		store.close();
		rmSync(dirname(path), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		});
	});
	return store;
}

function seed(store: StoryStore): void {
	store.createStory({ id: "s1", title: "一致性测试" });
	store.appendNode({
		id: "u1",
		storyId: "s1",
		parentId: null,
		role: "user",
		raw: "推门进来。",
	});
}

describe("MVU 一致性：角色卡初始变量", () => {
	it("世界书 [initvar] 与开场白合并，坏条目只记原因", () => {
		const init = buildMvuCardInitState({
			worldBookEntries: [
				{
					name: "[initvar]变量初始化",
					content: "角色:\n  好感度: 10\n世界:\n  时间: 出发前",
				},
				{ name: "[initvar]坏条目", content: "- 一\n- 二" },
			],
			firstMessage: "向导点头。<initvar>\n世界:\n  时间: 早晨\n</initvar>",
		});
		expect(init.usedSources).toEqual(["[initvar]变量初始化", "开场白"]);
		expect(init.issues).toHaveLength(1);
		expect(init.issues[0]).toContain("坏条目");
		expect(init.state?.data).toEqual({
			角色: { 好感度: 10 },
			世界: { 时间: "早晨" },
		});
	});

	it("没有初始变量时插件不启用，损坏的 $meta 直接抛错", () => {
		const empty = buildMvuCardInitState({
			worldBookEntries: [{ name: "普通条目", content: "角色: 甲" }],
			firstMessage: "开场白没有变量块。",
		});
		expect(empty.state).toBeNull();
		expect(empty.usedSources).toEqual([]);

		expect(() =>
			buildMvuCardInitState({
				worldBookEntries: [
					{
						name: "[initvar]",
						content: JSON.stringify({ $meta: { strictSet: "是" }, 甲: 1 }),
					},
				],
			}),
		).toThrow("strictSet 必须是布尔值");
	});
});

describe("MVU 一致性：一轮回复的变量更新", () => {
	it("只写台账 mvu 命名空间，原楼层逐字节不变，拒绝条目留 Trace", () => {
		const store = openTempStore();
		seed(store);
		const raw =
			'向导点头。<UpdateVariable><JSONPatch>[{"op":"delta","path":"/角色/好感度","value":2},{"op":"insert","path":"/角色/年龄","value":18}]</JSONPatch></UpdateVariable>';
		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw,
		});
		const state = buildMvuInitState({
			角色: { $meta: { extensible: false }, 好感度: 10 },
			世界: { 时间: "早晨" },
		});
		const trace: string[] = [];
		const session = MvuLedgerSession.open({
			store,
			nodeId: "a1",
			state,
			onTrace: (entry) =>
				trace.push(`${entry.outcome}:${entry.path?.join("/") ?? "-"}`),
		});
		const parsed = parseMvuUpdate(raw);
		expect(parsed.issues).toEqual([]);
		const applied = session.apply(parsed.operations);
		expect(applied.applied).toBe(1);
		expect(applied.rejected).toHaveLength(1);
		expect(applied.rejected[0]?.reason).toContain("/角色/年龄");
		const commit = session.commit({ storyId: "s1" });
		expect(commit.accepted.map((diff) => diff.path)).toEqual([
			["mvu", "角色", "好感度"],
			["mvu", "世界", "时间"],
			["mvu", "角色", "好感度"],
		]);

		expect(store.getNode("a1")?.raw).toBe(raw);
		expect(readLedger(store, "a1", ["mvu"])).toEqual({
			角色: { 好感度: 12 },
			世界: { 时间: "早晨" },
		});
		expect(
			store.getStateDiffs("a1").every((diff) => diff.path[0] === "mvu"),
		).toBe(true);
		expect(trace[0]).toBe("rejected:角色/年龄");
		expect(trace).toContain("accepted:角色/好感度");

		const window = prepareSettlement(store, "s1");
		expect(window?.floors[0]?.covered.map((item) => item.path)).toContainEqual([
			"mvu",
			"角色",
			"好感度",
		]);
		applySettlementProposals(
			store,
			window as NonNullable<typeof window>,
			new Map([
				[
					"a1",
					{
						diffs: [
							{
								path: ["mvu", "角色", "好感度"],
								op: "set",
								value: 99,
								confidence: 0.9,
							},
						],
						conflicts: [],
						beatCompleted: false,
						beatCompletedError: null,
					},
				],
			]),
		);
		expect(readLedger(store, "a1", ["mvu"])).toEqual({
			角色: { 好感度: 12 },
			世界: { 时间: "早晨" },
		});
	});

	it("多个块与代码围栏合并解析，非法条目逐条拒绝其余照常写入", () => {
		const store = openTempStore();
		seed(store);
		const raw = `向导抬头。
<UpdateVariable>
<Analysis>天色变了</Analysis>
<JSONPatch>[{"op":"delta","path":"/角色/好感度","value":1}]</JSONPatch>
</UpdateVariable>
<UpdateVariable>
<JSONPatch>
\`\`\`json
[{"op":"replace","path":"/世界/时间","value":"夜晚"},{"op":"frobnicate","path":"/世界/时间"}]
\`\`\`
</JSONPatch>
</UpdateVariable>`;
		const parsed = parseMvuUpdate(raw);
		expect(parsed.analysis).toBe("天色变了");
		expect(parsed.operations).toHaveLength(2);
		expect(parsed.issues).toHaveLength(1);
		expect(parsed.issues[0]).toContain("frobnicate");

		store.appendNode({
			id: "a1",
			storyId: "s1",
			parentId: "u1",
			role: "assistant",
			raw,
		});
		const session = MvuLedgerSession.open({
			store,
			nodeId: "a1",
			state: buildMvuInitState({
				$meta: { strictSet: true },
				角色: { 好感度: 10 },
				世界: { 时间: "早晨" },
			}),
		});
		session.apply(parsed.operations);
		session.commit({ storyId: "s1" });
		expect(readLedger(store, "a1", ["mvu"])).toEqual({
			角色: { 好感度: 11 },
			世界: { 时间: "夜晚" },
		});
		expect(store.getNode("a1")?.raw).toBe(raw);
	});
});

describe("MVU 一致性：变量结构（zod 卡生成的 schema）校验口径", () => {
	it("保存下来的结构 JSON 能原样读回，并给出相同的校验结果", () => {
		const state = buildMvuInitState({
			$meta: { strictSet: true },
			角色: {
				$meta: { extensible: true, required: ["名字"] },
				名字: "甲",
			},
			清单: ["$__META_EXTENSIBLE__$", "剑"],
		});
		const saved = JSON.parse(JSON.stringify(state.schema)) as unknown;
		const restored = parseMvuSchema(saved);
		expect(restored).toEqual(state.schema);

		const valid = { 角色: { 名字: "甲" }, 清单: ["剑"] };
		expect(validateMvuSchemaValue(state.schema, valid)).toEqual([]);
		expect(validateMvuSchemaValue(restored, valid)).toEqual([]);

		const invalid = { 角色: { 年龄: 18 }, 清单: ["剑", "盾"], 额外: true };
		const issues = validateMvuSchemaValue(restored, invalid);
		expect(issues).toEqual(validateMvuSchemaValue(state.schema, invalid));
		expect(issues).toContain("/角色/名字 是必填项");
		expect(issues).toContain("/额外 不在锁定的对象结构里");
	});

	it("角色卡开场白生成的变量结构同样可以读回", async () => {
		const card = await parseCharacterCardFile(
			join(import.meta.dirname, "fixtures", "coexist-mvu-card.json"),
		);
		const init = buildMvuCardInitState({
			worldBookEntries: [],
			firstMessage: card.firstMessage,
		});
		if (init.state === null) throw new Error("开场白没有初始变量");
		const restored = parseMvuSchema(
			JSON.parse(JSON.stringify(init.state.schema)) as unknown,
		);
		expect(validateMvuSchemaValue(restored, init.state.data)).toEqual([]);
		expect(restored.properties.世界?.type).toBe("object");
	});
});

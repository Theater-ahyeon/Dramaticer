import {
	type ContextSlotProvider,
	type ContextSlotRequest,
	StoryStore,
} from "@dramaticer/core";
import { describe, expect, it, onTestFinished } from "vitest";
import type { JsonObject } from "../src/index.js";
import {
	EMPTY_ST_WORLD_INFO_TIMED_EFFECTS,
	ST_WORLD_INFO_LOGIC,
	ST_WORLD_INFO_POSITION,
	type StWorldInfoTimedEffectsState,
	activateStWorldInfo,
	createStWorldInfoProviders,
	formatStWorldInfo,
	parseStWorldInfoKeyRegex,
} from "../src/st-content/world-info-activation.js";
import {
	parseWorldInfoJson,
	worldInfoFromCharacterBook,
} from "../src/world-info.js";

function entry(
	uid: number,
	keys: readonly string[],
	content: string,
	overrides: JsonObject = {},
): JsonObject {
	return {
		uid,
		key: keys,
		keysecondary: [],
		content,
		constant: false,
		disable: false,
		selective: true,
		useProbability: true,
		position: ST_WORLD_INFO_POSITION.before,
		...overrides,
	};
}

function world(entries: readonly JsonObject[], name = "测试世界") {
	const raw: JsonObject = {};
	entries.forEach((item, index) => {
		raw[String(item.uid ?? index)] = item;
	});
	const parsed = parseWorldInfoJson(JSON.stringify({ entries: raw }));
	return { ...parsed, name };
}

function scan(
	entries: readonly JsonObject[],
	messages: readonly string[],
	options: {
		readonly settings?: Parameters<typeof activateStWorldInfo>[0]["settings"];
		readonly timedEffects?: StWorldInfoTimedEffectsState;
		readonly random?: () => number;
		readonly now?: () => number;
		readonly deadline?: number;
		readonly globalScanData?: Parameters<
			typeof activateStWorldInfo
		>[0]["globalScanData"];
		readonly chatLength?: number;
	} = {},
) {
	return activateStWorldInfo({
		worlds: [world(entries)],
		messages,
		chatLength: options.chatLength ?? messages.length,
		settings: options.settings,
		timedEffects: options.timedEffects,
		random: options.random,
		now: options.now,
		deadline: options.deadline,
		globalScanData: options.globalScanData,
	});
}

describe("世界书解析", () => {
	it("角色卡内嵌世界书保留位置、深度、角色与分组字段", () => {
		const parsed = worldInfoFromCharacterBook(
			{
				entries: [
					{
						id: 7,
						keys: ["龙"],
						secondary_keys: ["金"],
						content: "内嵌正文",
						enabled: true,
						insertion_order: 5,
						extensions: {
							position: 4,
							depth: 2,
							role: 1,
							group: "阵营",
							group_weight: 30,
							probability: 20,
							useProbability: true,
							match_scenario: true,
						},
					},
				],
			},
			"卡内世界",
		);
		const entry = parsed.entries[0];
		expect(entry).toMatchObject({
			uid: 7,
			keys: ["龙"],
			secondaryKeys: ["金"],
			content: "内嵌正文",
			insertionOrder: 5,
			position: 4,
			depth: 2,
			role: 1,
			group: "阵营",
			groupWeight: 30,
			probability: 20,
			useProbability: true,
			matchScenario: true,
		});
	});
});

describe("世界书激活：关键词与逻辑", () => {
	it("主关键词命中，默认忽略大小写", () => {
		const result = scan(
			[entry(1, ["Dragon"], "龙条目")],
			["最近一楼：一条 dragon 出现"],
		);
		expect(result.before).toEqual(["龙条目"]);
		const sensitive = scan(
			[entry(1, ["Dragon"], "龙条目")],
			["最近一楼：一条 dragon 出现"],
			{ settings: { caseSensitive: true } },
		);
		expect(sensitive.before).toEqual([]);
	});

	it("整词匹配只接受独立的词", () => {
		const entries = [entry(1, ["cat"], "猫条目")];
		expect(
			scan(entries, ["concatenate"], { settings: { matchWholeWords: true } })
				.before,
		).toEqual([]);
		expect(
			scan(entries, ["a cat!"], { settings: { matchWholeWords: true } }).before,
		).toEqual(["猫条目"]);
	});

	it("正则关键词按 /pattern/flags 解释，非法正则退回普通文本", () => {
		expect(parseStWorldInfoKeyRegex("/Dragon\\s+King/i")).toBeInstanceOf(
			RegExp,
		);
		expect(parseStWorldInfoKeyRegex("/[/")).toBeNull();
		expect(
			scan(
				[entry(1, ["/Dragon\\s+King/i"], "龙王安危")],
				["the dragon   king rises"],
			).before,
		).toEqual(["龙王安危"]);
		expect(scan([entry(1, ["/[/"], "非法正则条目")], ["/[/"]).before).toEqual([
			"非法正则条目",
		]);
	});

	it("次关键词四种逻辑与酒馆一致", () => {
		const base = [
			entry(1, ["龙"], "次关键词条目", {
				keysecondary: ["金", "火"],
			}),
		];
		const withLogic = (logic: number) => [
			entry(1, ["龙"], "次关键词条目", {
				keysecondary: ["金", "火"],
				selectiveLogic: logic,
			}),
		];
		expect(
			scan(withLogic(ST_WORLD_INFO_LOGIC.andAny), ["龙 金"]).before,
		).toEqual(["次关键词条目"]);
		expect(
			scan(withLogic(ST_WORLD_INFO_LOGIC.andAll), ["龙 金"]).before,
		).toEqual([]);
		expect(
			scan(withLogic(ST_WORLD_INFO_LOGIC.andAll), ["龙 金 火"]).before,
		).toEqual(["次关键词条目"]);
		expect(scan(withLogic(ST_WORLD_INFO_LOGIC.notAny), ["龙"]).before).toEqual([
			"次关键词条目",
		]);
		expect(
			scan(withLogic(ST_WORLD_INFO_LOGIC.notAny), ["龙 金"]).before,
		).toEqual([]);
		expect(
			scan(withLogic(ST_WORLD_INFO_LOGIC.notAll), ["龙 金"]).before,
		).toEqual(["次关键词条目"]);
		expect(
			scan(withLogic(ST_WORLD_INFO_LOGIC.notAll), ["龙 金 火"]).before,
		).toEqual([]);
		expect(scan(base, ["龙 金"]).before).toEqual(["次关键词条目"]);
	});

	it("装饰器强制激活与拒绝激活，并从正文里移除", () => {
		expect(
			scan([entry(1, [], "@@activate\n无需关键词")], ["无关"]).before,
		).toEqual(["无需关键词"]);
		expect(
			scan([entry(1, ["龙"], "@@dont_activate\n不注入")], ["龙"]).before,
		).toEqual([]);
	});

	it("扫描深度与全局扫描字段按条目设置生效", () => {
		const entries = [entry(1, ["龙"], "深层条目")];
		expect(
			scan(entries, ["最近无关", "上一楼有龙"], { settings: { scanDepth: 1 } })
				.before,
		).toEqual([]);
		expect(
			scan(entries, ["最近无关", "上一楼有龙"], { settings: { scanDepth: 2 } })
				.before,
		).toEqual(["深层条目"]);
		expect(
			scan(
				[
					entry(1, ["龙"], "深层条目", {
						scanDepth: 2,
					}),
				],
				["最近无关", "上一楼有龙"],
				{ settings: { scanDepth: 1 } },
			).before,
		).toEqual(["深层条目"]);
		expect(
			scan(
				[
					entry(1, ["剑修"], "人设条目", {
						extensions: { match_persona_description: true },
					}),
				],
				["无关"],
				{ globalScanData: { personaDescription: "青云宗剑修" } },
			).before,
		).toEqual(["人设条目"]);
		expect(
			scan([entry(1, ["剑修"], "人设条目")], ["无关"], {
				globalScanData: { personaDescription: "青云宗剑修" },
			}).before,
		).toEqual([]);
	});
});

describe("世界书激活：递归与计时效果", () => {
	it("递归扫描把已激活正文加入下一轮缓冲", () => {
		const entries = [
			entry(1, ["龙"], "宝剑", { order: 100 }),
			entry(2, ["宝剑"], "剑的秘密", { order: 90 }),
		];
		expect(scan(entries, ["一条龙"]).before).toEqual(["宝剑"]);
		expect(
			scan(entries, ["一条龙"], { settings: { recursive: true } }).before,
		).toEqual(["剑的秘密", "宝剑"]);
		expect(
			scan(
				[
					entry(1, ["龙"], "宝剑", { order: 100, preventRecursion: true }),
					entry(2, ["宝剑"], "剑的秘密", { order: 90 }),
				],
				["一条龙"],
				{ settings: { recursive: true } },
			).before,
		).toEqual(["宝剑"]);
		expect(
			scan(
				[
					entry(1, ["龙"], "宝剑", { order: 100 }),
					entry(2, ["宝剑"], "剑的秘密", {
						order: 90,
						excludeRecursion: true,
					}),
				],
				["一条龙"],
				{ settings: { recursive: true } },
			).before,
		).toEqual(["宝剑"]);
	});

	it("delayUntilRecursion 只在递归轮次激活", () => {
		const entries = [
			entry(1, ["龙"], "首轮条目", { order: 100 }),
			entry(2, ["龙"], "延后条目", {
				order: 90,
				delayUntilRecursion: true,
			}),
		];
		const result = scan(entries, ["一条龙"], {
			settings: { recursive: true },
		});
		expect(result.before).toEqual(["延后条目", "首轮条目"]);
		expect(result.steps).toBe(3);
	});

	it("sticky 跨轮保持，结束后进入 cooldown，delay 抑制前几轮", () => {
		const entries = [
			entry(1, ["龙"], "粘性条目", {
				sticky: 2,
				cooldown: 2,
			}),
		];
		const first = scan(entries, ["龙"], { chatLength: 1 });
		expect(first.before).toEqual(["粘性条目"]);
		const second = scan(entries, ["无关"], {
			chatLength: 2,
			timedEffects: first.timedEffects,
		});
		expect(second.before).toEqual(["粘性条目"]);
		const third = scan(entries, ["无关"], {
			chatLength: 3,
			timedEffects: second.timedEffects,
		});
		expect(third.before).toEqual([]);
		const fourth = scan(entries, ["龙"], {
			chatLength: 5,
			timedEffects: third.timedEffects,
		});
		expect(fourth.before).toEqual(["粘性条目"]);

		const delayed = [entry(2, ["龙"], "延迟条目", { delay: 3 })];
		expect(scan(delayed, ["龙"], { chatLength: 2 }).before).toEqual([]);
		expect(scan(delayed, ["龙"], { chatLength: 3 }).before).toEqual([
			"延迟条目",
		]);
	});

	it("空状态不改变任何计时效果", () => {
		const result = scan([], ["龙"]);
		expect(result.timedEffects).toEqual(EMPTY_ST_WORLD_INFO_TIMED_EFFECTS);
	});
});

describe("世界书激活：分组与概率", () => {
	it("groupOverride 选中顺序最高的条目", () => {
		const entries = [
			entry(1, ["龙"], "普通", { group: "阵营", order: 100 }),
			entry(2, ["龙"], "优先", {
				group: "阵营",
				groupOverride: true,
				order: 50,
			}),
		];
		expect(scan(entries, ["龙"]).before).toEqual(["优先"]);
	});

	it("没有 groupOverride 时按权重随机选中一个", () => {
		const entries = [
			entry(1, ["龙"], "轻", { group: "阵营", groupWeight: 10 }),
			entry(2, ["龙"], "重", { group: "阵营", groupWeight: 90 }),
		];
		expect(scan(entries, ["龙"], { random: () => 0.05 }).before).toEqual([
			"轻",
		]);
		expect(scan(entries, ["龙"], { random: () => 0.5 }).before).toEqual(["重"]);
	});

	it("组内评分只保留命中关键词最多的条目", () => {
		const entries = [
			entry(1, ["龙"], "单关键词", { group: "阵营" }),
			entry(2, ["龙", "剑"], "双关键词", { group: "阵营" }),
		];
		expect(
			scan(entries, ["龙 剑"], {
				settings: { useGroupScoring: true },
			}).before,
		).toEqual(["双关键词"]);
	});

	it("概率失败后不会在同一轮递归里重试", () => {
		const entries = [entry(1, ["龙"], "概率条目", { probability: 30 })];
		expect(scan(entries, ["龙"], { random: () => 0.9 }).before).toEqual([]);
		expect(
			scan(entries, ["龙"], {
				random: () => 0.1,
				settings: { recursive: true },
			}).before,
		).toEqual(["概率条目"]);
	});
});

describe("世界书激活：位置、顺序与预算", () => {
	it("按位置分类，并保持酒馆的升序拼接结果", () => {
		const entries = [
			entry(1, ["龙"], "前二", { order: 20 }),
			entry(2, ["龙"], "前一", { order: 10 }),
			entry(3, ["龙"], "后一", {
				order: 10,
				position: ST_WORLD_INFO_POSITION.after,
			}),
			entry(4, ["龙"], "注上", {
				position: ST_WORLD_INFO_POSITION.authorNoteTop,
			}),
			entry(5, ["龙"], "注下", {
				position: ST_WORLD_INFO_POSITION.authorNoteBottom,
			}),
			entry(6, ["龙"], "深用户", {
				position: ST_WORLD_INFO_POSITION.atDepth,
				depth: 0,
				role: 1,
			}),
			entry(7, ["龙"], "深系统", {
				position: ST_WORLD_INFO_POSITION.atDepth,
				depth: 0,
				role: 0,
			}),
			entry(8, ["龙"], "状态栏", {
				position: ST_WORLD_INFO_POSITION.outlet,
				outletName: "status",
			}),
			entry(9, ["龙"], "扩展上", {
				position: ST_WORLD_INFO_POSITION.extensionTop,
			}),
			entry(10, ["龙"], "扩展下", {
				position: ST_WORLD_INFO_POSITION.extensionBottom,
			}),
		];
		const result = scan(entries, ["龙"]);
		expect(result.before).toEqual(["前一", "前二"]);
		expect(result.after).toEqual(["后一"]);
		expect(result.authorNoteTop).toEqual(["注上"]);
		expect(result.authorNoteBottom).toEqual(["注下"]);
		expect(result.extensionTop).toEqual(["扩展上"]);
		expect(result.extensionBottom).toEqual(["扩展下"]);
		expect(result.depth).toEqual([
			{ depth: 0, role: "user", contents: ["深用户"] },
			{ depth: 0, role: "system", contents: ["深系统"] },
		]);
		expect(result.outlets).toEqual({ status: ["状态栏"] });
	});

	it("outlet 没有名字时记录问题而不注入", () => {
		const result = scan(
			[
				entry(1, ["龙"], "无名 outlet", {
					position: ST_WORLD_INFO_POSITION.outlet,
				}),
			],
			["龙"],
		);
		expect(result.outlets).toEqual({});
		expect(result.issues).toEqual([
			{ world: "测试世界", uid: 1, code: "outlet-without-name" },
		]);
	});

	it("token 预算用尽后停止写入并标记", () => {
		const result = scan(
			[
				entry(1, ["龙"], "四个字符", { order: 20 }),
				entry(2, ["龙"], "四个字符", { order: 10 }),
			],
			["龙"],
			{
				settings: {
					budgetTokens: 10,
					estimateTokens: (text) => text.length,
				},
			},
		);
		expect(result.before).toEqual(["四个字符"]);
		expect(result.budgetExceeded).toBe(true);
	});

	it("时间预算用尽时保留已激活结果并停止递归", () => {
		let tick = 0;
		const result = scan(
			[
				entry(1, ["龙"], "宝剑", { order: 100 }),
				entry(2, ["宝剑"], "剑的秘密", { order: 90 }),
			],
			["龙"],
			{
				settings: { recursive: true },
				deadline: 5,
				now: () => (tick++ === 0 ? 0 : 10),
			},
		);
		expect(result.before).toEqual(["宝剑"]);
		expect(result.deadlineExceeded).toBe(true);
	});

	it("wi_format 用 {0} 包裹整组内容", () => {
		expect(formatStWorldInfo("正文", "<world>{0}</world>")).toBe(
			"<world>正文</world>",
		);
		expect(formatStWorldInfo("正文", "{0}")).toBe("正文");
		expect(formatStWorldInfo("正文", "  ")).toBe("正文");
		expect(formatStWorldInfo("", "{0}")).toBe("");
	});
});

describe("世界书槽位提供者", () => {
	function openStore(): StoryStore {
		const store = StoryStore.open(":memory:");
		store.createStory({ id: "story-1", title: "测试故事" });
		onTestFinished(() => store.close());
		store.appendNode({
			id: "n-1",
			storyId: "story-1",
			parentId: null,
			role: "user",
			raw: "一条龙出现",
		});
		return store;
	}

	function request(nodeId: string | null): ContextSlotRequest {
		return {
			slot: "lore",
			storyId: "story-1",
			nodeId,
			switches: {},
			state: null,
		};
	}

	it("before/after 进入 lore 槽位并应用 wi_format", async () => {
		const store = openStore();
		const providers = createStWorldInfoProviders({
			worlds: [
				world([
					entry(1, ["龙"], "前文"),
					entry(2, ["龙"], "后文", {
						position: ST_WORLD_INFO_POSITION.after,
					}),
				]),
			],
			store,
			wiFormat: "<w>{0}</w>",
		});
		const content = await providers.lore.provide(request("n-1"));
		expect(content?.messages).toEqual([
			{ role: "system", content: "<w>前文</w>" },
			{ role: "system", content: "<w>后文</w>" },
		]);
		expect(content?.source).toContain("前 1 条、后 1 条");
	});

	it("只启用 worldInfoBefore 时不注入 after 条目", async () => {
		const store = openStore();
		const providers = createStWorldInfoProviders({
			worlds: [
				world([
					entry(1, ["龙"], "前文", {
						position: ST_WORLD_INFO_POSITION.before,
					}),
					entry(2, ["龙"], "后文", {
						position: ST_WORLD_INFO_POSITION.after,
					}),
				]),
			],
			store,
			includeAfter: false,
		});
		const content = await providers.lore.provide(request("n-1"));
		expect(content?.messages).toEqual([{ role: "system", content: "前文" }]);
	});

	it("深度条目叠到历史槽位，且与 lore 共用一次激活", async () => {
		const store = openStore();
		const providers = createStWorldInfoProviders({
			worlds: [
				world([
					entry(1, ["龙"], "前文"),
					entry(2, ["龙"], "深系统", {
						position: ST_WORLD_INFO_POSITION.atDepth,
						depth: 0,
						role: 0,
					}),
				]),
			],
			store,
		});
		const base: ContextSlotProvider = {
			provide: () => ({
				messages: [
					{ role: "user", content: "旧楼" },
					{ role: "assistant", content: "新楼" },
				],
				source: "history:2",
			}),
		};
		const history = providers.wrapHistory(base);
		const [lore, wrapped] = await Promise.all([
			providers.lore.provide(request("n-1")),
			history.provide(request("n-1")),
		]);
		expect(lore?.messages).toEqual([{ role: "system", content: "前文" }]);
		expect(wrapped?.messages).toEqual([
			{ role: "user", content: "旧楼" },
			{ role: "assistant", content: "新楼" },
			{ role: "system", content: "深系统" },
		]);
		expect(await providers.activate(request("n-1"))).toBe(
			await providers.activate(request("n-1")),
		);
	});
});

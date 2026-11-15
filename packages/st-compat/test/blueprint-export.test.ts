import {
	type BlueprintMilestone,
	type BlueprintPremise,
	type BlueprintVolume,
	StoryStore as CoreStore,
	type JsonObject,
	isJsonObject,
} from "@dramaticer/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
	attachBlueprintExtension,
	importDramaticerExtension,
	parseCharacterCardJson,
	readCardBlueprint,
} from "../src/index.js";

function makePremise(): BlueprintPremise {
	return {
		id: "premise",
		kind: "premise",
		source: "player",
		locked: false,
		coreQuestion: "卫宫能不能在仪式开始前找到妹妹",
		tone: "阴冷",
		endings: ["救回妹妹", "妹妹成为代价"],
		redLines: ["不写虐待儿童"],
		tension: "medium",
	};
}

function makeVolume(): BlueprintVolume {
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

function makeMilestone(): BlueprintMilestone {
	return {
		id: "milestone-1",
		kind: "milestone",
		source: "ai",
		locked: false,
		volumeId: "volume-1",
		want: "找到钟楼的钥匙",
		prerequisites: ["拿到管家写的信"],
		after: [],
		hardness: "soft",
	};
}

function v2CardJson(extensions: unknown): string {
	return JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "云裳",
			description: "青云宗剑修",
			personality: "寡言",
			scenario: "山门被围",
			first_mes: "你来了。",
			mes_example: "",
			creator_notes: "",
			system_prompt: "",
			post_history_instructions: "",
			tags: ["仙侠"],
			creator: "测试",
			character_version: "1",
			extensions,
		},
	});
}

function cardContainer(raw: JsonObject): JsonObject {
	const data = raw.data;
	if (!isJsonObject(data)) throw new Error("测试卡缺少 data 节点");
	return data;
}

let store: CoreStore;

beforeEach(() => {
	store = CoreStore.open(":memory:");
	store.createStory({ id: "s1", title: "测试故事" });
	store.createStory({ id: "s2", title: "另一个故事" });
});

describe("蓝图写进卡扩展", () => {
	it("导出再导入内容一致，卡里其他字段不变", () => {
		const card = parseCharacterCardJson(v2CardJson({}));
		const entries = store.saveStoryBlueprintBaseline("s1", [
			makePremise(),
			makeVolume(),
			makeMilestone(),
		]);
		const exported = attachBlueprintExtension(card, entries);
		expect(cardContainer(exported).extensions).toEqual({
			dramaticer: { blueprint: entries },
		});

		const stripped = structuredClone(exported);
		Reflect.deleteProperty(
			cardContainer(stripped).extensions as JsonObject,
			"dramaticer",
		);
		expect(stripped).toEqual(card.raw);

		const parsed = parseCharacterCardJson(JSON.stringify(exported));
		expect(readCardBlueprint(parsed)).toEqual(entries);
		importDramaticerExtension(store, "s2", parsed);
		expect(store.readStoryBlueprintBaseline("s2")).toEqual(entries);
	});

	it("保留卡里已有的扩展字段，原卡对象不被修改", () => {
		const card = parseCharacterCardJson(
			v2CardJson({
				dramaticer: { rules: [{ id: "climb", label: "攀墙", target: "云裳" }] },
				other: { keep: true },
			}),
		);
		const before = structuredClone(card.raw);
		const exported = attachBlueprintExtension(card, [makePremise()]);
		expect(card.raw).toEqual(before);
		expect(cardContainer(exported).extensions).toEqual({
			dramaticer: {
				rules: [{ id: "climb", label: "攀墙", target: "云裳" }],
				blueprint: [makePremise()],
			},
			other: { keep: true },
		});
	});

	it("V1 卡把扩展写在根节点", () => {
		const card = parseCharacterCardJson(
			JSON.stringify({
				name: "云裳",
				description: "",
				extensions: {},
			}),
		);
		const exported = attachBlueprintExtension(card, [makePremise()]);
		expect(exported.extensions).toEqual({
			dramaticer: { blueprint: [makePremise()] },
		});
		expect(exported.data).toBeUndefined();
		expect(parseCharacterCardJson(JSON.stringify(exported)).name).toBe("云裳");
	});

	it("没有条目时删掉蓝图字段，不动其他扩展字段", () => {
		const card = parseCharacterCardJson(
			v2CardJson({
				dramaticer: { blueprint: [makePremise()], rules: [] },
			}),
		);
		const exported = attachBlueprintExtension(card, []);
		expect(cardContainer(exported).extensions).toEqual({
			dramaticer: { rules: [] },
		});
		const untouched = parseCharacterCardJson(v2CardJson({}));
		expect(attachBlueprintExtension(untouched, [])).toEqual(untouched.raw);
	});

	it("非法条目抛错并指出路径", () => {
		const card = parseCharacterCardJson(v2CardJson({}));
		expect(() =>
			attachBlueprintExtension(card, [
				{ ...makeMilestone(), volumeId: "volume-missing" },
			]),
		).toThrow("导出的蓝图 的里程碑 milestone-1 指向的卷 volume-missing 不存在");
		expect(cardContainer(card.raw).extensions).toEqual({});
	});

	it("导入结果报告写进故事的蓝图条数", () => {
		const card = parseCharacterCardJson(
			v2CardJson({ dramaticer: { blueprint: [makePremise()] } }),
		);
		const result = importDramaticerExtension(store, "s1", card);
		expect(result.blueprint).toEqual({ entries: 1 });
		expect(store.readStoryBlueprintBaseline("s1")).toEqual([makePremise()]);
		importDramaticerExtension(
			store,
			"s1",
			parseCharacterCardJson(v2CardJson({})),
		);
		expect(store.readStoryBlueprintBaseline("s1")).toEqual([]);
	});
});

import { describe, expect, it } from "vitest";
import { parseCharacterCardJson } from "../src/character-card.js";
import { parsePresetJson } from "../src/preset.js";
import {
	StEjsDataError,
	createStEjsRuntime,
	normalizeStEjsQuickReplySet,
} from "../src/st-ejs/index.js";

const card = parseCharacterCardJson(
	JSON.stringify({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "测试角色",
			description: "角色描述",
			personality: "冷静",
			scenario: "雨夜",
			first_mes: "你好",
			mes_example: "<START>",
			creator_notes: "作者注释",
			system_prompt: "系统提示",
			post_history_instructions: "历史之后",
			creator: "作者",
			character_version: "1.2",
			tags: ["测试", "角色"],
			alternate_greetings: ["另一个开场"],
			group_only_greetings: [],
		},
	}),
);

const preset = parsePresetJson(
	JSON.stringify({
		name: "预设甲",
		temperature: 0.7,
		openai_max_tokens: 256,
		prompts: [
			{
				identifier: "main",
				name: "主提示",
				content: "预设内容",
				role: "system",
			},
		],
		prompt_order: [
			{
				character_id: 100001,
				order: [{ identifier: "main", enabled: true }],
			},
		],
		extensions: { regex_scripts: [] },
	}),
);

const quickReplies = [
	normalizeStEjsQuickReplySet("默认", {
		qrList: [
			{ id: "1", label: "打招呼", message: "你好" },
			{ id: 2, label: "告别", message: "再见" },
		],
	}),
	normalizeStEjsQuickReplySet("备用", {
		qrList: [{ label: "打招呼", message: "备用你好" }],
	}),
];

function runtime() {
	return createStEjsRuntime({
		data: {
			character: card,
			presets: { 预设甲: preset },
			activePreset: "预设甲",
			quickReplies,
		},
	});
}

describe("EJS 数据读取函数", () => {
	it("getchar 读取单个字段，getCharData 返回整张卡", async () => {
		const ejs = runtime();
		expect(await ejs.render("<%- getchar('description') %>")).toBe("角色描述");
		expect(await ejs.render("<%- getCharData('firstMessage') %>")).toBe("你好");
		const all = ejs.getCharData() as Record<string, unknown>;
		expect(all.name).toBe("测试角色");
		expect(all.tags).toEqual(["测试", "角色"]);
		expect(all.nickname).toBe("");
	});

	it("未知角色字段直接抛错并列出可用字段", () => {
		const ejs = runtime();
		expect(() => ejs.getCharData("unknown")).toThrow(StEjsDataError);
	});

	it("getpreset 优先使用当前预设，也可以指定名称", async () => {
		const ejs = runtime();
		expect(await ejs.render("<%- getpreset().name %>")).toBe("预设甲");
		expect(ejs.getPreset("预设甲")).toMatchObject({
			temperature: 0.7,
			maxTokens: 256,
		});
		expect(() => ejs.getPreset("不存在")).toThrow(StEjsDataError);
	});

	it("没有当前预设时直接抛错", () => {
		const ejs = createStEjsRuntime({ data: { character: card } });
		expect(() => ejs.getPreset()).toThrow(StEjsDataError);
	});

	it("getqr 按标签查找，getqr(set, label) 限定集合", async () => {
		const ejs = runtime();
		expect(await ejs.render("<%- getqr('打招呼') %>")).toBe("你好");
		expect(ejs.getQuickReply("默认", "告别")).toBe("再见");
		expect(ejs.getQuickReply("备用", "打招呼")).toBe("备用你好");
		expect(() => ejs.getQuickReply("不存在")).toThrow(StEjsDataError);
	});

	it("getQuickReplyData 返回全部或指定的回复集", () => {
		const ejs = runtime();
		const all = ejs.getQuickReplyData() as readonly {
			name: string;
			replies: readonly { id: string | null; label: string }[];
		}[];
		expect(all.map((set) => set.name)).toEqual(["默认", "备用"]);
		expect(all[0]?.replies[0]?.id).toBe("1");
		expect(all[0]?.replies[1]?.id).toBe("2");
		const one = ejs.getQuickReplyData("备用") as {
			name: string;
			replies: readonly { message: string }[];
		};
		expect(one.replies[0]?.message).toBe("备用你好");
	});

	it("缺少角色卡与非法快捷回复数据时抛错", () => {
		const ejs = createStEjsRuntime({});
		expect(() => ejs.getCharData()).toThrow(StEjsDataError);
		expect(() => normalizeStEjsQuickReplySet("坏", {})).toThrow(StEjsDataError);
		expect(() =>
			normalizeStEjsQuickReplySet("坏", {
				qrList: [{ label: "缺正文" }],
			}),
		).toThrow(StEjsDataError);
	});
});
